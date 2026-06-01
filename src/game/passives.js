import { createMapIndex, getNeighborCoordinates } from "./map.js";
import { createTileIndex, getPlacedTileCoordinates, isOverstrainedPlacedTile } from "./tiles.js";
import { buildTravelNetworks, getNetworkForPlacedTile, isTravelTileDefinition } from "./travel.js";
import { isSupportedPlacedTile } from "./strain.js";
import { getProductionGains } from "./activation.js";

const FIXED_ADJACENT_PRODUCTION_BONUS =
  /^Passive:\s*When an adjacent (.+?) is activated for Resource production, gain (\d+) additional ([A-Za-z ]+)\.$/i;
const MATCHING_TYPES_ADJACENT_PRODUCTION_BONUS =
  /^Passive:\s*When an adjacent (.+?) is activated for Resource production, gain (\d+) additional resources of types that (.+?) can produce\.$/i;
const LIMITED_ADJACENT_CATEGORY_SUPPORT =
  /^Passive:\s*While this tile is not Overstrained,\s*(?:(\d+)|up to (\d+)) adjacent ([A-Za-z]+) Tiles? (?:has|have) Supported/i;
const BURDEN_RESOLUTION_STRAIN_RELIEF =
  /^Passive:\s*When players resolve an active Burden, remove 1 Strain from 1 placed tile\.$/i;

function getTileIndex(context) {
  return context.tileIndex ?? createTileIndex(context.tiles ?? []);
}

function hasSelfSupportedPassive(tile) {
  return /This tile has Supported/i.test(tile?.benefit ?? "");
}

function supportsAdjacentTiles(tile) {
  return /adjacent tiles have Supported/i.test(tile?.benefit ?? "");
}

function supportsAdjacentResourceTiles(tile) {
  return /adjacent Resource Tiles have Supported/i.test(tile?.benefit ?? "");
}

function supportsTravelTilesInNetwork(tile) {
  return /Travel Tiles in this tile's (?:Travel Network|connected settlement network) have Supported/i.test(
    tile?.benefit ?? ""
  );
}

function relievesStrainWhenBurdenResolved(tile) {
  return BURDEN_RESOLUTION_STRAIN_RELIEF.test(String(tile?.benefit ?? "").trim());
}

function getLimitedAdjacentCategorySupport(tile) {
  const match = LIMITED_ADJACENT_CATEGORY_SUPPORT.exec(String(tile?.benefit ?? ""));

  if (!match) {
    return null;
  }

  return {
    maxTargets: Number(match[1] ?? match[2]),
    category: match[3]
  };
}

function summarizeGains(gains = []) {
  const amounts = new Map();

  for (const { resource, amount } of gains) {
    amounts.set(resource, (amounts.get(resource) ?? 0) + amount);
  }

  return [...amounts.entries()].map(([resource, amount]) => ({ resource, amount }));
}

function arePlacedTilesAdjacent(state, leftTile, rightTile) {
  const mapIndex = createMapIndex(state.map.hexes);
  const rightCoordinates = new Set(getPlacedTileCoordinates(rightTile));

  return getPlacedTileCoordinates(leftTile).some((coordinate) =>
    getNeighborCoordinates(coordinate, mapIndex).some((neighborCoordinate) =>
      rightCoordinates.has(neighborCoordinate)
    )
  );
}

function sortPlacedTilesById(placedTiles) {
  return [...placedTiles].sort((left, right) => {
    const leftNumber = Number(left.id.replace(/\D+/g, ""));
    const rightNumber = Number(right.id.replace(/\D+/g, ""));
    return leftNumber - rightNumber;
  });
}

function getAdjacentTravelNetwork(state, placedTile, tileIndex) {
  const networks = buildTravelNetworks(state, { tileIndex });
  const directNetwork = getNetworkForPlacedTile(networks, placedTile.id);

  if (directNetwork) {
    return directNetwork;
  }

  const mapIndex = createMapIndex(state.map.hexes);
  const adjacentCoordinates = new Set(
    getPlacedTileCoordinates(placedTile).flatMap((coordinate) => getNeighborCoordinates(coordinate, mapIndex))
  );

  return networks.find((network) =>
    network.coordinates.some((coordinate) => adjacentCoordinates.has(coordinate))
  ) ?? null;
}

function createProviderEntry(providerTile, providerDefinition, reason) {
  return {
    source: "passive",
    providerPlacedTileId: providerTile.id,
    providerTileId: providerTile.tileId,
    providerTileName: providerDefinition.tile_name,
    reason
  };
}

function providesLimitedAdjacentCategorySupport(state, providerTile, targetTile, support, tileIndex) {
  const supportedTargets = sortPlacedTilesById(
    state.map.placedTiles.filter((candidate) => {
      if (candidate.id === providerTile.id || isOverstrainedPlacedTile(candidate)) {
        return false;
      }

      const candidateDefinition = tileIndex.get(candidate.tileId);
      return candidateDefinition?.tile_category === support.category && arePlacedTilesAdjacent(state, providerTile, candidate);
    })
  ).slice(0, support.maxTargets);

  return supportedTargets.some((candidate) => candidate.id === targetTile.id);
}

function parseAdjacentProductionBonus(tile) {
  const benefit = String(tile?.benefit ?? "").trim();
  const matchingTypesMatch = MATCHING_TYPES_ADJACENT_PRODUCTION_BONUS.exec(benefit);
  const fixedMatch = FIXED_ADJACENT_PRODUCTION_BONUS.exec(benefit);

  if (matchingTypesMatch) {
    return {
      type: "matching_first_production_resource",
      sourceTileName: matchingTypesMatch[1],
      amount: Number(matchingTypesMatch[2])
    };
  }

  if (fixedMatch) {
    return {
      type: "fixed_resource",
      sourceTileName: fixedMatch[1],
      amount: Number(fixedMatch[2]),
      resource: fixedMatch[3]
    };
  }

  return null;
}

function targetMatchesProductionSource(targetDefinition, sourceTileName) {
  return [targetDefinition?.tile_name, targetDefinition?.base_tile].filter(Boolean).includes(sourceTileName);
}

function createProductionBonusEntry(providerTile, providerDefinition, passive, gains) {
  return {
    source: "passive",
    providerPlacedTileId: providerTile.id,
    providerTileId: providerTile.tileId,
    providerTileName: providerDefinition.tile_name,
    sourceTileName: passive.sourceTileName,
    reason: passive.type,
    gains
  };
}

function createRoundProductionBonusEntry(effect) {
  return {
    source: "boon",
    roundEffectId: effect.id,
    cardId: effect.cardId,
    cardName: effect.cardName,
    providerTileName: effect.cardName,
    sourceTileName: effect.sourceTileName,
    reason: "boon_round_resource_production",
    gains: effect.gains
  };
}

function getRoundProductionBonuses(state, targetDefinition) {
  return (state.encounter.roundEffects ?? [])
    .filter((effect) => {
      if (effect.type !== "resource_production_bonus" || effect.round !== state.round) {
        return false;
      }

      if (effect.maxUses !== null && (effect.uses ?? 0) >= effect.maxUses) {
        return false;
      }

      return targetMatchesProductionSource(targetDefinition, effect.sourceTileName);
    })
    .map(createRoundProductionBonusEntry);
}

export function getProductionBonusDetails(state, placedTileId, context = {}) {
  const tileIndex = getTileIndex(context);
  const targetTile = state.map.placedTiles.find((placedTile) => placedTile.id === placedTileId);

  if (!targetTile || isOverstrainedPlacedTile(targetTile)) {
    return {
      gains: [],
      bonuses: []
    };
  }

  const targetDefinition = tileIndex.get(targetTile.tileId);
  const productionGains = getProductionGains(targetDefinition);
  if (!targetDefinition || !productionGains) {
    return {
      gains: [],
      bonuses: []
    };
  }

  const bonuses = [];

  for (const providerTile of state.map.placedTiles) {
    if (providerTile.id === targetTile.id || isOverstrainedPlacedTile(providerTile)) {
      continue;
    }

    const providerDefinition = tileIndex.get(providerTile.tileId);
    const passive = parseAdjacentProductionBonus(providerDefinition);
    if (!providerDefinition || !passive) {
      continue;
    }

    if (!arePlacedTilesAdjacent(state, providerTile, targetTile)) {
      continue;
    }

    if (!targetMatchesProductionSource(targetDefinition, passive.sourceTileName)) {
      continue;
    }

    const resource = passive.resource ?? productionGains[0]?.resource;
    if (!resource) {
      continue;
    }

    const gains = [{ amount: passive.amount, resource }];
    bonuses.push(createProductionBonusEntry(providerTile, providerDefinition, passive, gains));
  }

  bonuses.push(...getRoundProductionBonuses(state, targetDefinition));

  return {
    gains: summarizeGains(bonuses.flatMap((bonus) => bonus.gains)),
    bonuses
  };
}

export function getBurdenResolutionStrainReliefDetails(state, context = {}) {
  const tileIndex = getTileIndex(context);
  const providerTile = sortPlacedTilesById(state.map.placedTiles).find((placedTile) => {
    if (isOverstrainedPlacedTile(placedTile)) {
      return false;
    }

    return relievesStrainWhenBurdenResolved(tileIndex.get(placedTile.tileId));
  });
  const targetTile = sortPlacedTilesById(
    state.map.placedTiles.filter((placedTile) => (placedTile.strain ?? 0) > 0)
  )[0];

  if (!providerTile || !targetTile) {
    return null;
  }

  const providerDefinition = tileIndex.get(providerTile.tileId);
  const targetDefinition = tileIndex.get(targetTile.tileId);

  return {
    source: "passive",
    reason: "burden_resolved",
    providerPlacedTileId: providerTile.id,
    providerTileId: providerTile.tileId,
    providerTileName: providerDefinition?.tile_name ?? providerTile.tileId,
    targetPlacedTileId: targetTile.id,
    targetTileId: targetTile.tileId,
    targetTileName: targetDefinition?.tile_name ?? targetTile.tileId,
    strainRemoved: 1
  };
}

export function getPassiveSupportDetails(state, placedTileId, context = {}) {
  const tileIndex = getTileIndex(context);
  const targetTile = state.map.placedTiles.find((placedTile) => placedTile.id === placedTileId);

  if (!targetTile || isOverstrainedPlacedTile(targetTile)) {
    return {
      supported: false,
      providers: []
    };
  }

  const targetDefinition = tileIndex.get(targetTile.tileId);
  const providers = [];

  if (hasSelfSupportedPassive(targetDefinition)) {
    providers.push(createProviderEntry(targetTile, targetDefinition, "self_supported"));
  }

  for (const providerTile of state.map.placedTiles) {
    if (providerTile.id === targetTile.id || isOverstrainedPlacedTile(providerTile)) {
      continue;
    }

    const providerDefinition = tileIndex.get(providerTile.tileId);
    if (!providerDefinition) {
      continue;
    }

    const adjacent = arePlacedTilesAdjacent(state, providerTile, targetTile);
    if (adjacent && supportsAdjacentTiles(providerDefinition)) {
      providers.push(createProviderEntry(providerTile, providerDefinition, "adjacent_any"));
      continue;
    }

    const limitedCategorySupport = getLimitedAdjacentCategorySupport(providerDefinition);
    if (
      adjacent &&
      limitedCategorySupport &&
      targetDefinition?.tile_category === limitedCategorySupport.category &&
      providesLimitedAdjacentCategorySupport(state, providerTile, targetTile, limitedCategorySupport, tileIndex)
    ) {
      providers.push(createProviderEntry(providerTile, providerDefinition, "adjacent_category_limited"));
      continue;
    }

    if (adjacent && supportsAdjacentResourceTiles(providerDefinition) && targetDefinition?.tile_category === "Resource") {
      providers.push(createProviderEntry(providerTile, providerDefinition, "adjacent_resource"));
      continue;
    }

    if (supportsTravelTilesInNetwork(providerDefinition) && isTravelTileDefinition(targetDefinition)) {
      const providerNetwork = getAdjacentTravelNetwork(state, providerTile, tileIndex);
      if (providerNetwork?.tileIds.includes(targetTile.id)) {
        providers.push(createProviderEntry(providerTile, providerDefinition, "connected_settlement_network"));
      }
    }
  }

  return {
    supported: providers.length > 0,
    providers
  };
}

export function getEffectiveSupportDetails(state, placedTileId, context = {}) {
  const placedTile = state.map.placedTiles.find((tile) => tile.id === placedTileId);
  const manualProvider = isSupportedPlacedTile(placedTile)
    ? [
        {
          source: "debug",
          providerPlacedTileId: placedTile.id,
          providerTileId: placedTile.tileId,
          providerTileName: "Debug Support",
          reason: "debug"
        }
      ]
    : [];
  const passive = getPassiveSupportDetails(state, placedTileId, context);
  const providers = [...manualProvider, ...passive.providers];

  return {
    supported: providers.length > 0,
    providers,
    passiveProviders: passive.providers,
    manual: manualProvider.length > 0
  };
}
