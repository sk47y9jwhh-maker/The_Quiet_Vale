import { ENCOUNTER_TYPES } from "./setup.js";
import { createMapIndex, getNeighborCoordinates, isWaterHex } from "./map.js";
import { createTileIndex, getPlacedTileCoordinates, isOverstrainedPlacedTile } from "./tiles.js";
import { buildTravelNetworks, isBridgeTileDefinition, isTravelTileDefinition } from "./travel.js";

const STEWARD_OBJECTIVE_RENOWN = 15;

function numberValue(value) {
  return Number(value ?? 0) || 0;
}

function getTileIndex(context) {
  if (context.tileIndex) {
    return context.tileIndex;
  }

  return createTileIndex(context.tiles ?? []);
}

function getPlacedTileDefinition(tileIndex, placedTile) {
  return tileIndex.get(placedTile?.tileId) ?? null;
}

function getActivePlacedTiles(state) {
  return state.map.placedTiles.filter((placedTile) => !isOverstrainedPlacedTile(placedTile));
}

function getPlacedByCoordinate(placedTiles) {
  return new Map(
    placedTiles.flatMap((placedTile) =>
      getPlacedTileCoordinates(placedTile).map((coordinate) => [coordinate, placedTile])
    )
  );
}

function getAdjacentPlacedTiles(state, placedTile, placedTiles = state.map.placedTiles) {
  const mapIndex = createMapIndex(state.map.hexes);
  const ownCoordinates = new Set(getPlacedTileCoordinates(placedTile));
  const placedByCoordinate = getPlacedByCoordinate(placedTiles);
  const adjacentIds = new Set();

  for (const coordinate of ownCoordinates) {
    for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
      if (ownCoordinates.has(neighborCoordinate)) {
        continue;
      }

      const adjacentTile = placedByCoordinate.get(neighborCoordinate);
      if (adjacentTile && adjacentTile.id !== placedTile.id) {
        adjacentIds.add(adjacentTile.id);
      }
    }
  }

  return placedTiles.filter((candidate) => adjacentIds.has(candidate.id));
}

function getCategoryComponents(state, tileIndex, category) {
  const activeTiles = getActivePlacedTiles(state).filter(
    (placedTile) => getPlacedTileDefinition(tileIndex, placedTile)?.tile_category === category
  );
  const activeById = new Map(activeTiles.map((placedTile) => [placedTile.id, placedTile]));
  const unvisited = new Set(activeTiles.map((placedTile) => placedTile.id));
  const components = [];

  while (unvisited.size > 0) {
    const [startId] = unvisited;
    const stack = [startId];
    const component = [];
    unvisited.delete(startId);

    while (stack.length > 0) {
      const tileId = stack.pop();
      const placedTile = activeById.get(tileId);
      component.push(placedTile);

      for (const adjacentTile of getAdjacentPlacedTiles(state, placedTile, activeTiles)) {
        if (unvisited.has(adjacentTile.id)) {
          unvisited.delete(adjacentTile.id);
          stack.push(adjacentTile.id);
        }
      }
    }

    components.push(component);
  }

  return components;
}

function getHousingClusterSizeByTileId(state, tileIndex) {
  const sizes = new Map();

  for (const component of getCategoryComponents(state, tileIndex, "Housing")) {
    for (const placedTile of component) {
      sizes.set(placedTile.id, component.length);
    }
  }

  return sizes;
}

function hasAdjacentCategory(state, placedTile, tileIndex, category) {
  return getAdjacentPlacedTiles(state, placedTile, getActivePlacedTiles(state)).some(
    (adjacentTile) => getPlacedTileDefinition(tileIndex, adjacentTile)?.tile_category === category
  );
}

function countAdjacentNonTravelTiles(state, placedTile, tileIndex) {
  return getAdjacentPlacedTiles(state, placedTile, getActivePlacedTiles(state)).filter(
    (adjacentTile) => !isTravelTileDefinition(getPlacedTileDefinition(tileIndex, adjacentTile))
  ).length;
}

function getTravelNetworkSizeByTileId(state, tileIndex) {
  const sizes = new Map();

  for (const network of buildTravelNetworks(state, { tileIndex })) {
    const travelTileIds = network.tileIds.filter((tileId) => {
      const placedTile = state.map.placedTiles.find((candidate) => candidate.id === tileId);
      return isTravelTileDefinition(getPlacedTileDefinition(tileIndex, placedTile));
    });

    for (const tileId of travelTileIds) {
      sizes.set(tileId, travelTileIds.length);
    }
  }

  return sizes;
}

function getDynamicTileScore(state, placedTile, definition, tileIndex, housingClusterSizes, travelNetworkSizes) {
  const benefit = String(definition?.benefit ?? "");
  const dynamic = {
    population: 0,
    renown: 0,
    notes: []
  };
  const housingMatch = /\+(\d+) Population if part of a Housing cluster/i.exec(benefit);
  if (housingMatch && (housingClusterSizes.get(placedTile.id) ?? 0) >= 2) {
    dynamic.population += Number(housingMatch[1]);
    dynamic.notes.push(`Housing cluster +${housingMatch[1]} Population`);
  }

  const adjacentTravelMatch = /\+(\d+) Renown if adjacent to Travel/i.exec(benefit);
  if (adjacentTravelMatch && hasAdjacentCategory(state, placedTile, tileIndex, "Travel")) {
    dynamic.renown += Number(adjacentTravelMatch[1]);
    dynamic.notes.push(`Adjacent Travel +${adjacentTravelMatch[1]} Renown`);
  }

  const adjacentNonTravelMatch = /\+(\d+) Renown if adjacent to 3 or more non-Travel Tiles/i.exec(benefit);
  if (adjacentNonTravelMatch && countAdjacentNonTravelTiles(state, placedTile, tileIndex) >= 3) {
    dynamic.renown += Number(adjacentNonTravelMatch[1]);
    dynamic.notes.push(`Adjacent non-Travel +${adjacentNonTravelMatch[1]} Renown`);
  }

  const travelGroupMatch = /\+(\d+) Renown for each Travel Tile in this connected Travel group, max \+(\d+)/i.exec(benefit);
  if (travelGroupMatch) {
    const amount = Math.min(
      Number(travelGroupMatch[2]),
      Number(travelGroupMatch[1]) * (travelNetworkSizes.get(placedTile.id) ?? 0)
    );
    dynamic.renown += amount;
    dynamic.notes.push(`Travel group +${amount} Renown`);
  }

  return dynamic;
}

function getTerrainTypesForPlacedTile(state, placedTile) {
  const mapIndex = createMapIndex(state.map.hexes);
  return new Set(
    getPlacedTileCoordinates(placedTile)
      .map((coordinate) => mapIndex.get(coordinate)?.Terrain)
      .filter(Boolean)
  );
}

function hasBridgeAcrossRiver(state, tileIndex) {
  const mapIndex = createMapIndex(state.map.hexes);
  return getActivePlacedTiles(state).some((placedTile) => {
    const definition = getPlacedTileDefinition(tileIndex, placedTile);
    return (
      isBridgeTileDefinition(definition) &&
      getPlacedTileCoordinates(placedTile).some((coordinate) => isWaterHex(mapIndex.get(coordinate)))
    );
  });
}

function calculateStewardObjectives(state, tileIndex, housingClusterSizes) {
  const activeTiles = getActivePlacedTiles(state);
  const activeBurdenCount = state.encounter.active.filter(
    (activeState) => activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved
  ).length;
  const objectives = [];
  const completedRoleIds = new Set();

  for (const player of state.players ?? []) {
    const roleId = player.stewardRoleId;
    if (!roleId || completedRoleIds.has(roleId)) {
      continue;
    }

    let completed = false;
    let label = "";

    if (roleId === "vanguard") {
      completed = hasBridgeAcrossRiver(state, tileIndex);
      label = "Bridge connects settlement across river";
    } else if (roleId === "knight") {
      completed = Math.max(0, ...housingClusterSizes.values()) >= 4;
      label = "Housing cluster of 4+";
    } else if (roleId === "sentinel") {
      completed = activeTiles.filter((placedTile) => {
        const definition = getPlacedTileDefinition(tileIndex, placedTile);
        return definition?.tile_source_type === "Core" && definition?.side === "Upgraded";
      }).length >= 5;
      label = "5+ upgraded Core Tiles";
    } else if (roleId === "ranger") {
      const terrainTypes = new Set();
      for (const placedTile of activeTiles) {
        for (const terrain of getTerrainTypesForPlacedTile(state, placedTile)) {
          if (!["Grasslands", "Water", "River"].includes(terrain)) {
            terrainTypes.add(terrain);
          }
        }
      }
      completed = terrainTypes.size >= 3;
      label = "Tiles on 3+ non-Grasslands terrain types";
    } else if (roleId === "warden") {
      completed = activeBurdenCount < (state.players?.length ?? 0);
      label = "Active Burdens fewer than player count";
    } else if (roleId === "quartermaster") {
      completed = Object.values(state.warehouse.resources ?? {}).filter((amount) => Number(amount ?? 0) >= 5).length >= 4;
      label = "5+ resources in 4 Warehouse types";
    }

    if (completed) {
      completedRoleIds.add(roleId);
      objectives.push({
        playerId: player.id,
        roleId,
        label,
        renown: STEWARD_OBJECTIVE_RENOWN
      });
    }
  }

  return objectives;
}

export function calculateScore(state, context = {}) {
  const tileIndex = getTileIndex(context);
  const housingClusterSizes = getHousingClusterSizeByTileId(state, tileIndex);
  const travelNetworkSizes = getTravelNetworkSizeByTileId(state, tileIndex);
  const placedTileScores = state.map.placedTiles.map((placedTile) => {
    const definition = tileIndex.get(placedTile.tileId);
    const overstrained = isOverstrainedPlacedTile(placedTile);
    const dynamic = overstrained
      ? { population: 0, renown: 0, notes: [] }
      : getDynamicTileScore(state, placedTile, definition, tileIndex, housingClusterSizes, travelNetworkSizes);
    const basePopulation = overstrained ? 0 : numberValue(definition?.population);
    const baseRenown = overstrained ? 0 : numberValue(definition?.renown);

    return {
      placedTileId: placedTile.id,
      tileId: placedTile.tileId,
      tileName: definition?.tile_name ?? placedTile.tileId,
      population: basePopulation + dynamic.population,
      renown: baseRenown + dynamic.renown,
      basePopulation,
      baseRenown,
      bonusPopulation: dynamic.population,
      bonusRenown: dynamic.renown,
      dynamicScoreNotes: dynamic.notes,
      strain: numberValue(placedTile.strain),
      overstrained
    };
  });
  const population = placedTileScores.reduce((sum, entry) => sum + entry.population, 0);
  const tileRenown = placedTileScores.reduce((sum, entry) => sum + entry.renown, 0);
  const stewardObjectives = calculateStewardObjectives(state, tileIndex, housingClusterSizes);
  const stewardObjectiveRenown = stewardObjectives.reduce((sum, objective) => sum + objective.renown, 0);
  const renown = tileRenown + stewardObjectiveRenown;
  const strainTokens = placedTileScores.reduce((sum, entry) => sum + entry.strain, 0);
  const activeBurdenCount = state.encounter.active.filter(
    (activeState) => activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved
  ).length;
  const activeBurdenPenalty = activeBurdenCount * numberValue(state.rules.activeBurdenPenaltyRenown);
  const strainPenalty = strainTokens * numberValue(state.rules.strainPenaltyRenown);

  return {
    population,
    renown,
    tileRenown,
    stewardObjectiveRenown,
    stewardObjectives,
    activeBurdenPenalty,
    strainPenalty,
    total: population + renown - activeBurdenPenalty - strainPenalty,
    activeBurdenCount,
    strainTokens,
    scoringTileCount: placedTileScores.filter((entry) => !entry.overstrained).length,
    overstrainedExcludedTileIds: placedTileScores
      .filter((entry) => entry.overstrained)
      .map((entry) => entry.placedTileId),
    placedTileScores
  };
}
