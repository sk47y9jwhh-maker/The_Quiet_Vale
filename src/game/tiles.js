import { HEX_DIRECTIONS, createMapIndex, getFootprintCoordinates, getNeighborCoordinates, isWaterHex } from "./map.js";

export const TILE_ACTION_TYPES = Object.freeze({
  PLACE_TILE: "PLACE_TILE",
  UPGRADE_TILE: "UPGRADE_TILE",
  ACTIVATE_TILE: "ACTIVATE_TILE",
  APPLY_STRAIN: "APPLY_STRAIN",
  COMPLETE_ARRIVAL: "COMPLETE_ARRIVAL",
  USE_STEWARD_POWER: "USE_STEWARD_POWER",
  RESOLVE_BURDEN: "RESOLVE_BURDEN",
  RESOLVE_BURDEN_CHOICE: "RESOLVE_BURDEN_CHOICE",
  RESOLVE_BOON: "RESOLVE_BOON",
  DEBUG_FILL_WAREHOUSE: "DEBUG_FILL_WAREHOUSE",
  DEBUG_SET_TILE_STRAIN: "DEBUG_SET_TILE_STRAIN",
  DEBUG_SET_TILE_SUPPORTED: "DEBUG_SET_TILE_SUPPORTED",
  DEBUG_SET_PLAYER_MARKER: "DEBUG_SET_PLAYER_MARKER",
  DEBUG_RESET_ACTIONS: "DEBUG_RESET_ACTIONS",
  END_TURN: "END_TURN",
  END_ROUND: "END_ROUND",
  SEED_ENCOUNTERS: "SEED_ENCOUNTERS",
  REVEAL_ENCOUNTERS: "REVEAL_ENCOUNTERS"
});

export const STRAIN_MAX_PER_TILE = 3;

const TERRAIN_PLACEMENT = Object.freeze({
  "Place on Woodland.": "Woodland",
  "Place on Mountains.": "Mountains",
  "Place on Heaths.": "Heaths",
  "Place on Arable Land.": "Arable Land",
  "Place on Ruins.": "Ruins"
});

const CATEGORY_ADJACENCY_RULES = Object.freeze({
  "Place adjacent to a Housing Tile.": ["Housing"],
  "Place adjacent to a Travel Tile.": ["Travel"],
  "Place adjacent to a Social Tile.": ["Social"],
  "Place adjacent to a Merchant Tile.": ["Merchant"],
  "Place adjacent to a Wellbeing Tile.": ["Wellbeing"],
  "Place adjacent to a Housing Tile or Wellbeing Tile.": ["Housing", "Wellbeing"]
});

const TILE_NAME_ADJACENCY_RULES = Object.freeze({
  "Place adjacent to a Farm.": ["Farm"],
  "Place adjacent to a Forest.": ["Forest"],
  "Place adjacent to a Mine.": ["Mine"],
  "Place adjacent to a Dig Site.": ["Dig Site"],
  "Place adjacent to Wildlands.": ["Wildlands"]
});

const FREE_ADJACENT_PLACEMENT_COST =
  /^Once per round,\s*when any player places a tile adjacent to this tile,\s*that tile costs 0 Resources\./i;
const REDUCE_ADJACENT_PLACEMENT_COST =
  /^Once per round,\s*when any player places a tile adjacent to this tile,\s*reduce that tile's cost by (\d+) resource of the group's choice\./i;

export function createTileIndex(tiles) {
  return new Map(tiles.map((tile) => [tile.tile_id, tile]));
}

export function isRoleRestrictedTile(tile) {
  return / only\.$/i.test(tile.placement_rules ?? "");
}

export function isDirectlyPlaceableTile(tile) {
  return tile.tile_source_type === "Core" && tile.side === "Basic" && !isRoleRestrictedTile(tile);
}

export function getDirectlyPlaceableTiles(tiles) {
  return tiles.filter(isDirectlyPlaceableTile);
}

export function parseResourceCost(costText) {
  if (!costText || costText === 0 || costText === "0") {
    return [];
  }

  return String(costText)
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d+)\s+(.+)$/.exec(part);

      if (!match) {
        throw new Error(`Unsupported resource cost: ${part}`);
      }

      return {
        amount: Number(match[1]),
        resource: match[2]
      };
    });
}

export function getPlacedTileAt(state, coordinate) {
  return (
    state.map.placedTiles.find((placedTile) => {
      const coordinates = placedTile.coordinates ?? [placedTile.coordinate];
      return coordinates.includes(coordinate);
    }) ?? null
  );
}

export function getPlacedTileCoordinates(placedTile) {
  return placedTile.coordinates ?? [placedTile.coordinate];
}

export function isOverstrainedPlacedTile(placedTile) {
  return (placedTile?.strain ?? 0) >= STRAIN_MAX_PER_TILE;
}

export function getTileSupplyEntry(state, tileId) {
  return [...state.tileSupply.core, ...state.tileSupply.special].find((entry) => entry.tileId === tileId) ?? null;
}

export function findUpgradeTile(tile, tileIndex) {
  if (!tile?.upgrade_to) {
    return null;
  }

  const candidates = [...tileIndex.values()].filter(
    (candidate) =>
      candidate.tile_source_type === tile.tile_source_type &&
      candidate.side === "Upgraded" &&
      candidate.tile_name === tile.upgrade_to
  );

  return candidates.find((candidate) => candidate.base_tile === tile.tile_name) ?? candidates[0] ?? null;
}

export function canAffordCost(warehouse, cost) {
  return cost.every(({ resource, amount }) => (warehouse.resources[resource] ?? 0) >= amount);
}

function describeCost(cost) {
  return cost.map(({ amount, resource }) => `${amount} ${resource}`).join(", ");
}

function summarizeResourceAmounts(amounts = []) {
  const totals = new Map();

  for (const { resource, amount } of amounts) {
    totals.set(resource, (totals.get(resource) ?? 0) + amount);
  }

  return [...totals.entries()].map(([resource, amount]) => ({ resource, amount }));
}

function getPendingCoreUpgradeDiscountEffect(state) {
  return (
    (state.encounter?.roundEffects ?? []).find(
      (effect) => effect.type === "core_upgrade_discount" && (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function getCoreUpgradeCostReduction(state, action, tile, cost) {
  const effect = getPendingCoreUpgradeDiscountEffect(state);

  if (!effect || tile?.tile_source_type !== "Core") {
    return {
      reduction: null,
      cost,
      errors: []
    };
  }

  const totalCost = cost.reduce((sum, entry) => sum + entry.amount, 0);
  const amount = Math.min(effect.amount, totalCost);
  const selectedResources = (action.upgradeCostReductionResources ?? []).filter(Boolean);

  if (selectedResources.length !== amount) {
    return {
      reduction: null,
      cost,
      errors: [
        `Choose exactly ${amount} resource${amount === 1 ? "" : "s"} for ${effect.cardName}'s Core upgrade cost reduction.`
      ]
    };
  }

  const reduction = summarizeResourceAmounts(selectedResources.map((resource) => ({ resource, amount: 1 })));
  const errors = [];

  for (const entry of reduction) {
    const costEntry = cost.find((candidate) => candidate.resource === entry.resource);

    if (!costEntry) {
      errors.push(`${effect.cardName} can only reduce resources in the upgrade cost.`);
    } else if (entry.amount > costEntry.amount) {
      errors.push(
        `${effect.cardName} cannot reduce ${entry.resource} by ${entry.amount}; the upgrade only costs ${costEntry.amount}.`
      );
    }
  }

  if (errors.length > 0) {
    return {
      reduction: null,
      cost,
      errors
    };
  }

  const reducedCost = cost
    .map((entry) => {
      const reductionEntry = reduction.find((candidate) => candidate.resource === entry.resource);

      return reductionEntry
        ? {
            ...entry,
            amount: entry.amount - reductionEntry.amount
          }
        : entry;
    })
    .filter((entry) => entry.amount > 0);

  return {
    reduction: {
      source: "boon",
      type: "core_upgrade_discount",
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: effect.cardName,
      discardAfterUse: effect.discardAfterUse === true,
      originalCost: cost,
      cost: reducedCost,
      reduction,
      selectedResources,
      amountReduced: amount
    },
    cost: reducedCost,
    errors: []
  };
}

function effectMatchesTileResourceDiscount(effect, tile, operation) {
  if (!tile) {
    return false;
  }

  if (effect.type === "placement_resource_discount" && operation !== "placement") {
    return false;
  }

  if (effect.type !== "placement_resource_discount" && effect.type !== "tile_resource_discount") {
    return false;
  }

  if ((effect.uses ?? 0) >= (effect.maxUses ?? 1)) {
    return false;
  }

  if (effect.type === "tile_resource_discount" && !(effect.appliesTo ?? []).includes(operation)) {
    return false;
  }

  return !effect.targetCategories || effect.targetCategories.includes(tile.tile_category);
}

function getPendingTileResourceDiscountEffect(state, tile, operation) {
  return (
    (state.encounter?.roundEffects ?? []).find((effect) =>
      effectMatchesTileResourceDiscount(effect, tile, operation)
    ) ?? null
  );
}

function getBoonResourceCostReductionFromEffect(state, action, cost, tile, effect, selectedResourcesKey, description) {
  if (!effect) {
    return {
      reduction: null,
      cost,
      errors: []
    };
  }

  const totalCost = cost.reduce((sum, entry) => sum + entry.amount, 0);

  if (effect.freeResourceCost) {
    return {
      reduction: {
        source: "boon",
        type: effect.type,
        reason: "next_eligible_tile_cost",
        effectId: effect.id,
        cardId: effect.cardId,
        cardName: effect.cardName,
        round: state.round,
        targetCategories: effect.targetCategories,
        allowedResources: effect.allowedResources ?? null,
        appliesTo: effect.appliesTo ?? [description],
        discardAfterUse: effect.discardAfterUse === true,
        originalCost: cost,
        cost: [],
        reduction: cost,
        selectedResources: [],
        amountReduced: totalCost
      },
      cost: [],
      errors: []
    };
  }

  const allowedResources = effect.allowedResources ?? [];
  const eligibleCost = allowedResources.length
    ? cost.filter((entry) => allowedResources.includes(entry.resource))
    : cost;
  const eligibleTotal = eligibleCost.reduce((sum, entry) => sum + entry.amount, 0);
  const amount = Math.min(effect.amount ?? 0, eligibleTotal);
  const selectedResources = (action[selectedResourcesKey] ?? []).filter(Boolean);

  if (selectedResources.length !== amount) {
    return {
      reduction: null,
      cost,
      errors: [
        `Choose exactly ${amount} resource${amount === 1 ? "" : "s"} for ${effect.cardName}'s ${description} cost reduction.`
      ]
    };
  }

  const reduction = summarizeResourceAmounts(
    selectedResources.map((resource) => ({
      resource,
      amount: 1
    }))
  );
  const errors = [];

  for (const entry of reduction) {
    const costEntry = eligibleCost.find((candidate) => candidate.resource === entry.resource);

    if (!costEntry) {
      const resourceList = allowedResources.length ? allowedResources.join(" or ") : `resources in the ${description} cost`;
      errors.push(`${effect.cardName} can only reduce ${resourceList}.`);
    } else if (entry.amount > costEntry.amount) {
      errors.push(
        `${effect.cardName} cannot reduce ${entry.resource} by ${entry.amount}; ${tile.tile_name} only costs ${costEntry.amount}.`
      );
    }
  }

  if (errors.length > 0) {
    return {
      reduction: null,
      cost,
      errors
    };
  }

  const reducedCost = cost
    .map((entry) => {
      const reductionEntry = reduction.find((candidate) => candidate.resource === entry.resource);

      return reductionEntry
        ? {
            ...entry,
            amount: entry.amount - reductionEntry.amount
          }
        : entry;
    })
    .filter((entry) => entry.amount > 0);

  return {
    reduction: {
      source: "boon",
      type: effect.type,
      reason: "next_eligible_tile_cost",
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: effect.cardName,
      round: state.round,
      targetCategories: effect.targetCategories,
      allowedResources,
      appliesTo: effect.appliesTo ?? [description],
      discardAfterUse: effect.discardAfterUse === true,
      originalCost: cost,
      cost: reducedCost,
      reduction,
      selectedResources,
      amountReduced: amount
    },
    cost: reducedCost,
    errors: []
  };
}

function getTileUpgradeResourceDiscount(state, action, tile, cost) {
  return getBoonResourceCostReductionFromEffect(
    state,
    action,
    cost,
    tile,
    getPendingTileResourceDiscountEffect(state, tile, "upgrade"),
    "upgradeCostReductionResources",
    "upgrade"
  );
}

function getUpgradeCostReduction(state, action, tile, cost) {
  const coreReduction = getCoreUpgradeCostReduction(state, action, tile, cost);

  if (coreReduction.reduction || coreReduction.errors.length > 0) {
    return coreReduction;
  }

  return getTileUpgradeResourceDiscount(state, action, tile, cost);
}

function hasAdjacentHexMatching(state, coordinates, predicate) {
  const mapIndex = createMapIndex(state.map.hexes);
  const footprint = new Set(coordinates);

  return coordinates.some((coordinate) =>
    getNeighborCoordinates(coordinate, mapIndex)
      .filter((neighborCoordinate) => !footprint.has(neighborCoordinate))
      .some((neighborCoordinate) => {
        const neighborHex = mapIndex.get(neighborCoordinate);
        return predicate(neighborHex, neighborCoordinate);
      })
  );
}

function getAdjacentPlacedTileDefinitions(state, coordinates, tileIndex) {
  const placedByCoordinate = new Map(
    state.map.placedTiles.flatMap((placedTile) =>
      (placedTile.coordinates ?? [placedTile.coordinate]).map((coordinate) => [coordinate, placedTile])
    )
  );
  const mapIndex = createMapIndex(state.map.hexes);
  const footprint = new Set(coordinates);

  return coordinates
    .flatMap((coordinate) => getNeighborCoordinates(coordinate, mapIndex))
    .filter((neighborCoordinate) => !footprint.has(neighborCoordinate))
    .map((neighborCoordinate) => placedByCoordinate.get(neighborCoordinate))
    .filter(Boolean)
    .filter((placedTile) => !isOverstrainedPlacedTile(placedTile))
    .map((placedTile) => tileIndex.get(placedTile.tileId))
    .filter(Boolean);
}

function getAdjacentPlacedTiles(state, coordinates) {
  const placedByCoordinate = new Map(
    state.map.placedTiles.flatMap((placedTile) =>
      getPlacedTileCoordinates(placedTile).map((coordinate) => [coordinate, placedTile])
    )
  );
  const mapIndex = createMapIndex(state.map.hexes);
  const footprint = new Set(coordinates);
  const adjacentTileIds = new Set();

  for (const coordinate of coordinates) {
    for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
      if (footprint.has(neighborCoordinate)) {
        continue;
      }

      const placedTile = placedByCoordinate.get(neighborCoordinate);
      if (placedTile) {
        adjacentTileIds.add(placedTile.id);
      }
    }
  }

  return state.map.placedTiles.filter((placedTile) => adjacentTileIds.has(placedTile.id));
}

function sortPlacedTilesById(placedTiles) {
  return [...placedTiles].sort((left, right) => {
    const leftNumber = Number(left.id.replace(/\D+/g, ""));
    const rightNumber = Number(right.id.replace(/\D+/g, ""));
    return leftNumber - rightNumber;
  });
}

function providesFreeAdjacentPlacementCost(tile) {
  return FREE_ADJACENT_PLACEMENT_COST.test(String(tile?.benefit ?? "").trim());
}

function getAdjacentPlacementCostReduction(tile) {
  const match = REDUCE_ADJACENT_PLACEMENT_COST.exec(String(tile?.benefit ?? "").trim());

  if (!match) {
    return null;
  }

  return {
    amount: Number(match[1])
  };
}

function getPendingFreePlacementCostEffect(state, tile) {
  return (
    (state.encounter?.roundEffects ?? []).find(
      (effect) =>
        effect.type === "free_tile_placement_cost" &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1) &&
        (!effect.targetCategories || effect.targetCategories.includes(tile.tile_category))
    ) ?? null
  );
}

function getPendingPlacementResourceDiscountEffect(state, tile) {
  return getPendingTileResourceDiscountEffect(state, tile, "placement");
}

function getFreeBoonPlacementCostReduction(state, cost, tile) {
  const effect = getPendingFreePlacementCostEffect(state, tile);

  if (!effect) {
    return null;
  }

  return {
    source: "boon",
    type: "free_tile_placement_cost",
    reason: "next_eligible_tile_placed",
    effectId: effect.id,
    cardId: effect.cardId,
    cardName: effect.cardName,
    round: state.round,
    targetCategories: effect.targetCategories,
    originalCost: cost,
    cost: [],
    amountReduced: cost.reduce((sum, entry) => sum + entry.amount, 0)
  };
}

function getBoonPlacementResourceDiscount(state, action, cost, tile) {
  const effect = getPendingPlacementResourceDiscountEffect(state, tile);

  const result = getBoonResourceCostReductionFromEffect(
    state,
    action,
    cost,
    tile,
    effect,
    "placementCostReductionResources",
    "placement"
  );

  return {
    reduction: result.reduction,
    errors: result.errors
  };
}

function findUnusedAdjacentProvider(state, coordinates, tileIndex, predicate) {
  return sortPlacedTilesById(getAdjacentPlacedTiles(state, coordinates)).find((placedTile) => {
    if (isOverstrainedPlacedTile(placedTile) || placedTile.placementDiscountRounds?.includes(state.round)) {
      return false;
    }

    return predicate(tileIndex.get(placedTile.tileId));
  });
}

function getFreeAdjacentPlacementCostReduction(state, coordinates, cost, tileIndex) {
  if (cost.length === 0) {
    return null;
  }

  const providerTile = findUnusedAdjacentProvider(state, coordinates, tileIndex, providesFreeAdjacentPlacementCost);

  if (!providerTile) {
    return null;
  }

  const providerDefinition = tileIndex.get(providerTile.tileId);

  return {
    source: "passive",
    type: "free_adjacent_placement_cost",
    reason: "adjacent_tile_placed",
    providerPlacedTileId: providerTile.id,
    providerTileId: providerTile.tileId,
    providerTileName: providerDefinition?.tile_name ?? providerTile.tileId,
    round: state.round,
    originalCost: cost,
    cost: []
  };
}

function getReducedAdjacentPlacementCostReduction(state, action, coordinates, cost, tileIndex, targetTile) {
  if (cost.length === 0) {
    return {
      reduction: null,
      errors: []
    };
  }

  const providerTile = findUnusedAdjacentProvider(state, coordinates, tileIndex, (tile) =>
    Boolean(getAdjacentPlacementCostReduction(tile))
  );

  if (!providerTile) {
    return {
      reduction: null,
      errors: []
    };
  }

  const providerDefinition = tileIndex.get(providerTile.tileId);
  const reduction = getAdjacentPlacementCostReduction(providerDefinition);
  const selectedResource = action.placementCostReductionResource ?? cost[0]?.resource;
  const selectedCost = cost.find((entry) => entry.resource === selectedResource);

  if (!selectedCost) {
    return {
      reduction: null,
      errors: [
        `${providerDefinition?.tile_name ?? providerTile.tileId} can only reduce a resource in ${targetTile.tile_name}'s placement cost.`
      ]
    };
  }

  const amountReduced = Math.min(reduction.amount, selectedCost.amount);
  const reducedCost = cost
    .map((entry) =>
      entry.resource === selectedResource
        ? {
            ...entry,
            amount: entry.amount - amountReduced
          }
        : entry
    )
    .filter((entry) => entry.amount > 0);

  return {
    reduction: {
      source: "passive",
      type: "reduce_adjacent_placement_cost",
      reason: "adjacent_tile_placed",
      providerPlacedTileId: providerTile.id,
      providerTileId: providerTile.tileId,
      providerTileName: providerDefinition?.tile_name ?? providerTile.tileId,
      round: state.round,
      originalCost: cost,
      cost: reducedCost,
      resource: selectedResource,
      amountReduced
    },
    errors: []
  };
}

function getPlacementCostReduction(state, action, coordinates, cost, tileIndex, targetTile) {
  const boonReduction = getFreeBoonPlacementCostReduction(state, cost, targetTile);

  if (boonReduction) {
    return {
      reduction: boonReduction,
      errors: []
    };
  }

  const boonResourceDiscount = getBoonPlacementResourceDiscount(state, action, cost, targetTile);

  if (boonResourceDiscount.reduction || boonResourceDiscount.errors.length > 0) {
    return boonResourceDiscount;
  }

  const freeReduction = getFreeAdjacentPlacementCostReduction(state, coordinates, cost, tileIndex);

  if (freeReduction) {
    return {
      reduction: freeReduction,
      errors: []
    };
  }

  return getReducedAdjacentPlacementCostReduction(state, action, coordinates, cost, tileIndex, targetTile);
}

export function markPlacementDiscountRound(placedTile, round) {
  const placementDiscountRounds = placedTile.placementDiscountRounds ?? [];

  if (placementDiscountRounds.includes(round)) {
    return placedTile;
  }

  return {
    ...placedTile,
    placementDiscountRounds: [...placementDiscountRounds, round]
  };
}

function tilePermitsRiverPlacement(tile) {
  return tile.placement_rules === "Place on a River hex.";
}

function validateTerrainRule(tile, hexes) {
  const requiredTerrain = TERRAIN_PLACEMENT[tile.placement_rules];

  if (!requiredTerrain) {
    return null;
  }

  const matches = hexes.some((hex) => hex.Terrain === requiredTerrain);

  if (tile.size_hexes > 1) {
    return matches ? null : `${tile.tile_name} must cover at least one ${requiredTerrain} hex.`;
  }

  return matches ? null : `${tile.tile_name} must be placed on ${requiredTerrain}.`;
}

function validateTileTerrainPlacement(tile, footprintHexes) {
  const errors = [];
  const coveredRiverHexes = footprintHexes.filter(isWaterHex);

  if (coveredRiverHexes.length > 0 && !tilePermitsRiverPlacement(tile)) {
    errors.push(`${tile.tile_name} cannot cover a River hex.`);
  }

  if (coveredRiverHexes.length === 0 && tilePermitsRiverPlacement(tile)) {
    errors.push(`${tile.tile_name} must be placed on a River hex.`);
  }

  const terrainError = validateTerrainRule(tile, footprintHexes);
  if (terrainError) {
    errors.push(terrainError);
  }

  return errors;
}

function validateAdjacencyRule(state, tile, coordinates, tileIndex) {
  if (tile.placement_rules === "Place adjacent to a River hex.") {
    const adjacentToRiver = hasAdjacentHexMatching(state, coordinates, (neighborHex) => isWaterHex(neighborHex));
    return adjacentToRiver ? null : `${tile.tile_name} must be placed adjacent to a River hex.`;
  }

  if (tile.placement_rules === "Place adjacent to Ruins terrain.") {
    const adjacentToRuins = hasAdjacentHexMatching(
      state,
      coordinates,
      (neighborHex) => neighborHex?.Terrain === "Ruins"
    );
    return adjacentToRuins ? null : `${tile.tile_name} must be placed adjacent to Ruins terrain.`;
  }

  const requiredCategories = CATEGORY_ADJACENCY_RULES[tile.placement_rules];
  if (requiredCategories) {
    const adjacentDefinitions = getAdjacentPlacedTileDefinitions(state, coordinates, tileIndex);
    const valid = adjacentDefinitions.some((definition) => requiredCategories.includes(definition.tile_category));
    return valid ? null : `${tile.tile_name} must be placed adjacent to ${requiredCategories.join(" or ")}.`;
  }

  const requiredTileNames = TILE_NAME_ADJACENCY_RULES[tile.placement_rules];
  if (requiredTileNames) {
    const adjacentDefinitions = getAdjacentPlacedTileDefinitions(state, coordinates, tileIndex);
    const valid = adjacentDefinitions.some((definition) => requiredTileNames.includes(definition.tile_name));
    return valid ? null : `${tile.tile_name} must be placed adjacent to ${requiredTileNames.join(" or ")}.`;
  }

  return null;
}

export function validatePlaceTile(state, action, context) {
  const tileIndex = createTileIndex(context.tiles);
  const mapIndex = createMapIndex(state.map.hexes);
  const tile = tileIndex.get(action.tileId);
  const hex = mapIndex.get(action.coordinate);
  const errors = [];

  if (!tile) {
    return { valid: false, errors: [`Unknown tile: ${action.tileId}`] };
  }

  if (!hex) {
    return { valid: false, errors: [`Unknown map coordinate: ${action.coordinate}`] };
  }

  const supplyEntry = getTileSupplyEntry(state, action.tileId);
  const baseCost = parseResourceCost(tile.place_cost);
  const directionId = action.orientation ?? HEX_DIRECTIONS[0].id;
  const footprintCoordinates = getFootprintCoordinates(action.coordinate, tile.size_hexes, directionId, mapIndex);
  const footprintHexes = footprintCoordinates?.map((coordinate) => mapIndex.get(coordinate)) ?? [];
  const placementCostReductionResult = footprintCoordinates
    ? getPlacementCostReduction(state, action, footprintCoordinates, baseCost, tileIndex, tile)
    : { reduction: null, errors: [] };
  const placementCostReduction = placementCostReductionResult.reduction;
  const cost = placementCostReduction?.cost ?? baseCost;

  errors.push(...placementCostReductionResult.errors);

  if (!supplyEntry) {
    errors.push(`${tile.tile_name} is not in the tile supply.`);
  } else {
    if (supplyEntry.locked) {
      errors.push(`${tile.tile_name} is not available for direct placement yet.`);
    }

    if (supplyEntry.available <= 0) {
      errors.push(`${tile.tile_name} has no remaining stock.`);
    }
  }

  if (!footprintCoordinates) {
    errors.push(`${tile.tile_name} footprint leaves the approved map.`);
  }

  for (const coordinate of footprintCoordinates ?? [action.coordinate]) {
    if (getPlacedTileAt(state, coordinate)) {
      errors.push(`${coordinate} already has a placed tile.`);
    }
  }

  if (footprintCoordinates) {
    errors.push(...validateTileTerrainPlacement(tile, footprintHexes));

    if (!footprintHexes.some(isWaterHex)) {
      const adjacencyError = validateAdjacencyRule(state, tile, footprintCoordinates, tileIndex);
      if (adjacencyError) {
        errors.push(adjacencyError);
      }
    }
  }

  if (!canAffordCost(state.warehouse, cost)) {
    errors.push(`${tile.tile_name} costs ${describeCost(cost)}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    baseCost,
    cost,
    placementCostReduction,
    footprintCoordinates,
    hex,
    tile
  };
}

export function validateRelocatePlacedTiles(state, action, context) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  const mapIndex = createMapIndex(state.map.hexes);
  const relocations = action.relocations ?? [];
  const errors = [];
  const moves = [];

  if (!Array.isArray(relocations)) {
    return {
      valid: false,
      errors: ["Tile relocation choices must be a list."],
      moves: []
    };
  }

  if (relocations.length > 5) {
    errors.push("The Golden Signet Ring can move up to 5 placed tiles.");
  }

  const duplicateIds = relocations
    .map((relocation) => relocation.placedTileId)
    .filter((placedTileId, index, placedTileIds) => placedTileId && placedTileIds.indexOf(placedTileId) !== index);

  if (duplicateIds.length > 0) {
    errors.push("Each placed tile can only be chosen once for The Golden Signet Ring.");
  }

  const selectedIds = new Set(relocations.map((relocation) => relocation.placedTileId).filter(Boolean));
  const occupiedByUnselectedTile = new Map(
    state.map.placedTiles
      .filter((placedTile) => !selectedIds.has(placedTile.id))
      .flatMap((placedTile) => getPlacedTileCoordinates(placedTile).map((coordinate) => [coordinate, placedTile]))
  );
  const finalFootprintByCoordinate = new Map();

  for (const relocation of relocations) {
    const placedTile = state.map.placedTiles.find((candidate) => candidate.id === relocation.placedTileId);
    if (!placedTile) {
      errors.push(`Unknown placed tile: ${relocation.placedTileId}`);
      continue;
    }

    const tile = tileIndex.get(placedTile.tileId);
    if (!tile) {
      errors.push(`Unknown tile definition: ${placedTile.tileId}`);
      continue;
    }

    const coordinate = relocation.coordinate;
    if (!mapIndex.has(coordinate)) {
      errors.push(`Unknown map coordinate: ${coordinate}`);
      continue;
    }

    const orientation =
      tile.size_hexes > 1
        ? relocation.orientation ?? placedTile.orientation ?? HEX_DIRECTIONS[0].id
        : placedTile.orientation ?? HEX_DIRECTIONS[0].id;
    const footprintCoordinates = getFootprintCoordinates(coordinate, tile.size_hexes, orientation, mapIndex);

    if (!footprintCoordinates) {
      errors.push(`${tile.tile_name} footprint leaves the approved map.`);
      continue;
    }

    const footprintHexes = footprintCoordinates.map((footprintCoordinate) => mapIndex.get(footprintCoordinate));
    errors.push(...validateTileTerrainPlacement(tile, footprintHexes));

    for (const footprintCoordinate of footprintCoordinates) {
      const occupiedTile = occupiedByUnselectedTile.get(footprintCoordinate);
      if (occupiedTile) {
        errors.push(`${footprintCoordinate} already has a placed tile.`);
      }

      const previousMove = finalFootprintByCoordinate.get(footprintCoordinate);
      if (previousMove && previousMove.placedTileId !== placedTile.id) {
        errors.push(`${footprintCoordinate} would be occupied by multiple moved tiles.`);
      }

      finalFootprintByCoordinate.set(footprintCoordinate, {
        placedTileId: placedTile.id,
        tileName: tile.tile_name
      });
    }

    moves.push({
      placedTile,
      tile,
      fromCoordinate: placedTile.coordinate ?? getPlacedTileCoordinates(placedTile)[0],
      fromCoordinates: getPlacedTileCoordinates(placedTile),
      toCoordinate: coordinate,
      toCoordinates: footprintCoordinates,
      orientation
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    moves
  };
}

export function validateUpgradeTile(state, action, context) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  const placedTile = state.map.placedTiles.find((tile) => tile.id === action.placedTileId);
  const errors = [];

  if (!placedTile) {
    return {
      valid: false,
      errors: [`Unknown placed tile: ${action.placedTileId}`]
    };
  }

  const tile = tileIndex.get(placedTile.tileId);
  if (!tile) {
    return {
      valid: false,
      errors: [`Unknown tile definition: ${placedTile.tileId}`],
      placedTile
    };
  }

  if (isOverstrainedPlacedTile(placedTile)) {
    errors.push("Overstrained tiles cannot be upgraded.");
  }

  if (!tile.upgrade_to) {
    errors.push(`${tile.tile_name} has no upgrade side.`);
  }

  const upgradeTile = findUpgradeTile(tile, tileIndex);
  if (!upgradeTile) {
    errors.push(`${tile.tile_name} has no matching upgrade tile in the source data.`);
  }

  let cost = [];
  if (upgradeTile) {
    try {
      cost = parseResourceCost(upgradeTile.upgrade_cost);
    } catch (error) {
      errors.push(`${upgradeTile.tile_name} has an unsupported upgrade cost: ${upgradeTile.upgrade_cost}.`);
    }
  }

  const baseCost = cost;
  const costReduction = getUpgradeCostReduction(state, action, tile, baseCost);
  errors.push(...costReduction.errors);
  cost = costReduction.cost;

  if (cost.length > 0 && !canAffordCost(state.warehouse, cost)) {
    errors.push(`${upgradeTile.tile_name} upgrade costs ${describeCost(cost)}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    placedTile,
    tile,
    upgradeTile,
    baseCost,
    upgradeCostReduction: costReduction.reduction,
    cost
  };
}

export function spendWarehouseResources(warehouse, cost) {
  const resources = { ...warehouse.resources };

  for (const { resource, amount } of cost) {
    resources[resource] = (resources[resource] ?? 0) - amount;
  }

  return {
    ...warehouse,
    resources
  };
}

export function gainWarehouseResources(warehouse, gains) {
  const resources = { ...warehouse.resources };
  const applied = gains.map(({ resource, amount }) => {
    const before = resources[resource] ?? 0;
    const after = Math.min(warehouse.cap, before + amount);
    const gained = after - before;

    resources[resource] = after;

    return {
      resource,
      amount,
      gained,
      capped: gained < amount
    };
  });

  return {
    warehouse: {
      ...warehouse,
      resources
    },
    applied
  };
}

export function fillWarehouse(warehouse) {
  return {
    ...warehouse,
    resources: Object.fromEntries(Object.keys(warehouse.resources).map((resource) => [resource, warehouse.cap]))
  };
}
