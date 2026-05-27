import { createMapIndex, getNeighborCoordinates, isWaterHex } from "./map.js";
import {
  createTileIndex,
  getPlacedTileAt,
  getPlacedTileCoordinates,
  isOverstrainedPlacedTile
} from "./tiles.js";

export function isTravelTileDefinition(tile) {
  return tile?.tile_category === "Travel" || /contributes to the Travel Network/i.test(tile?.benefit ?? "");
}

export function isBridgeTileDefinition(tile) {
  return tile?.tile_name === "Bridge" || tile?.tile_name === "Stone Bridge";
}

function isDocksTileDefinition(tile) {
  return /connects its Travel Network to every other placed Docks/i.test(tile?.benefit ?? "");
}

export function isActiveTravelTile(placedTile, tileIndex) {
  const definition = tileIndex.get(placedTile.tileId);
  return isTravelTileDefinition(definition) && !isOverstrainedPlacedTile(placedTile);
}

export function createPlacedTileCoordinateIndex(placedTiles) {
  return new Map(
    placedTiles.flatMap((placedTile) =>
      getPlacedTileCoordinates(placedTile).map((coordinate) => [coordinate, placedTile])
    )
  );
}

function sortTileIds(tileIds) {
  return [...tileIds].sort((left, right) => {
    const leftNumber = Number(left.replace(/\D+/g, ""));
    const rightNumber = Number(right.replace(/\D+/g, ""));
    return leftNumber - rightNumber;
  });
}

function buildTravelAdjacency(state, tileIndex) {
  const mapIndex = createMapIndex(state.map.hexes);
  const placedByCoordinate = createPlacedTileCoordinateIndex(state.map.placedTiles);
  const activeTravelTiles = state.map.placedTiles.filter((placedTile) => isActiveTravelTile(placedTile, tileIndex));
  const activeTravelIds = new Set(activeTravelTiles.map((placedTile) => placedTile.id));
  const adjacency = new Map(activeTravelTiles.map((placedTile) => [placedTile.id, new Set()]));
  const riverAdjacentDocks = [];

  for (const placedTile of activeTravelTiles) {
    const definition = tileIndex.get(placedTile.tileId);
    const riverAdjacent = getPlacedTileCoordinates(placedTile).some((coordinate) =>
      getNeighborCoordinates(coordinate, mapIndex).some((neighborCoordinate) => isWaterHex(mapIndex.get(neighborCoordinate)))
    );

    if (isDocksTileDefinition(definition) && riverAdjacent) {
      riverAdjacentDocks.push(placedTile);
    }

    for (const coordinate of getPlacedTileCoordinates(placedTile)) {
      for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
        const neighborTile = placedByCoordinate.get(neighborCoordinate);

        if (!neighborTile || neighborTile.id === placedTile.id || !activeTravelIds.has(neighborTile.id)) {
          continue;
        }

        adjacency.get(placedTile.id).add(neighborTile.id);
      }
    }
  }

  for (const docks of riverAdjacentDocks) {
    for (const otherDocks of riverAdjacentDocks) {
      if (docks.id !== otherDocks.id) {
        adjacency.get(docks.id).add(otherDocks.id);
      }
    }
  }

  return { activeTravelTiles, adjacency };
}

function getAdjacentNonTravelTileIds(state, networkTileIds, tileIndex) {
  const mapIndex = createMapIndex(state.map.hexes);
  const placedByCoordinate = createPlacedTileCoordinateIndex(state.map.placedTiles);
  const networkTileIdSet = new Set(networkTileIds);
  const adjacent = new Set();

  for (const placedTile of state.map.placedTiles.filter((tile) => networkTileIdSet.has(tile.id))) {
    for (const coordinate of getPlacedTileCoordinates(placedTile)) {
      for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
        const neighborTile = placedByCoordinate.get(neighborCoordinate);

        if (!neighborTile || networkTileIdSet.has(neighborTile.id) || isOverstrainedPlacedTile(neighborTile)) {
          continue;
        }

        const neighborDefinition = tileIndex.get(neighborTile.tileId);
        if (!isTravelTileDefinition(neighborDefinition)) {
          adjacent.add(neighborTile.id);
        }
      }
    }
  }

  return sortTileIds(adjacent);
}

export function buildTravelNetworks(state, context) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles);
  const { activeTravelTiles, adjacency } = buildTravelAdjacency(state, tileIndex);
  const activeById = new Map(activeTravelTiles.map((placedTile) => [placedTile.id, placedTile]));
  const unvisited = new Set(activeTravelTiles.map((placedTile) => placedTile.id));
  const networks = [];

  while (unvisited.size > 0) {
    const [startId] = unvisited;
    const stack = [startId];
    const tileIds = [];
    unvisited.delete(startId);

    while (stack.length > 0) {
      const tileId = stack.pop();
      tileIds.push(tileId);

      for (const neighborId of adjacency.get(tileId) ?? []) {
        if (unvisited.has(neighborId)) {
          unvisited.delete(neighborId);
          stack.push(neighborId);
        }
      }
    }

    const sortedTileIds = sortTileIds(tileIds);
    const coordinates = sortedTileIds
      .flatMap((tileId) => getPlacedTileCoordinates(activeById.get(tileId)))
      .sort();

    networks.push({
      id: `network-${String(networks.length + 1).padStart(3, "0")}`,
      tileIds: sortedTileIds,
      coordinates,
      adjacentNonTravelTileIds: getAdjacentNonTravelTileIds(state, sortedTileIds, tileIndex)
    });
  }

  return networks;
}

export function getNetworkForPlacedTile(networks, placedTileId) {
  return networks.find((network) => network.tileIds.includes(placedTileId)) ?? null;
}

export function getRiverCrossingActionCost(state, riverCoordinate, context) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles);
  const mapIndex = createMapIndex(state.map.hexes);
  const hex = mapIndex.get(riverCoordinate);

  if (!hex || !isWaterHex(hex)) {
    return {
      valid: false,
      cost: null,
      hasBridgeConnection: false,
      reason: `${riverCoordinate} is not a River hex.`
    };
  }

  const placedTile = getPlacedTileAt(state, riverCoordinate);
  const definition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const hasBridgeConnection =
    Boolean(placedTile) &&
    isBridgeTileDefinition(definition) &&
    isTravelTileDefinition(definition) &&
    !isOverstrainedPlacedTile(placedTile);

  return {
    valid: true,
    cost: hasBridgeConnection ? 0 : 1,
    hasBridgeConnection,
    reason: hasBridgeConnection
      ? "Active Bridge connection available."
      : "No active Bridge connection; crossing costs 1 Action."
  };
}

export function isPlacementConnectedToTravelNetwork(state, footprintCoordinates, context) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles);
  const networks = buildTravelNetworks(state, { tileIndex });

  if (networks.length === 0) {
    return true;
  }

  const mapIndex = createMapIndex(state.map.hexes);
  const activeTravelCoordinates = new Set(networks.flatMap((network) => network.coordinates));

  return footprintCoordinates.some((coordinate) =>
    getNeighborCoordinates(coordinate, mapIndex).some((neighborCoordinate) =>
      activeTravelCoordinates.has(neighborCoordinate)
    )
  );
}

export function isPlacedTileConnectedToTravelNetwork(state, placedTile, context) {
  if (!placedTile) {
    return false;
  }

  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles);
  const networks = buildTravelNetworks(state, { tileIndex });

  if (networks.length === 0) {
    return true;
  }

  return networks.some(
    (network) =>
      network.tileIds.includes(placedTile.id) ||
      network.adjacentNonTravelTileIds.includes(placedTile.id)
  );
}

export function calculatePlacementActionCost(state, footprintCoordinates, context) {
  const connected = isPlacementConnectedToTravelNetwork(state, footprintCoordinates, context);
  const placeActionCost = 1;
  const disconnectedTravelActionCost = connected ? 0 : 1;

  return {
    connected,
    placeActionCost,
    disconnectedTravelActionCost,
    total: placeActionCost + disconnectedTravelActionCost
  };
}

export function calculatePlacedTileActionCost(state, placedTile, context, operationActionKey = "tileActionCost") {
  const connected = isPlacedTileConnectedToTravelNetwork(state, placedTile, context);
  const disconnectedTravelActionCost = connected ? 0 : 1;

  return {
    connected,
    [operationActionKey]: 1,
    disconnectedTravelActionCost,
    total: 1 + disconnectedTravelActionCost
  };
}

function getOperationActionCostKey(operation) {
  return {
    placement: "placeActionCost",
    upgrade: "upgradeActionCost"
  }[operation];
}

function effectMatchesTileActionDiscount(effect, tile, operation) {
  if (!tile || effect.type !== "tile_action_discount") {
    return false;
  }

  if ((effect.uses ?? 0) >= (effect.maxUses ?? 1)) {
    return false;
  }

  if (!(effect.appliesTo ?? []).includes(operation)) {
    return false;
  }

  return !effect.targetCategories || effect.targetCategories.includes(tile.tile_category);
}

function getPendingTileActionDiscountEffect(state, tile, operation) {
  return (
    (state.encounter?.roundEffects ?? []).find((effect) =>
      effectMatchesTileActionDiscount(effect, tile, operation)
    ) ?? null
  );
}

export function getDiscountedTileActionCost(state, tile, operation, baseActionCost) {
  const effect = getPendingTileActionDiscountEffect(state, tile, operation);

  if (!effect || baseActionCost.total <= 0) {
    return {
      actionCost: baseActionCost,
      actionCostDiscount: null
    };
  }

  const operationActionCostKey = getOperationActionCostKey(operation);
  const operationActionCost =
    operationActionCostKey && Number.isInteger(baseActionCost[operationActionCostKey])
      ? baseActionCost[operationActionCostKey]
      : baseActionCost.total;
  const amountReduced = Math.min(operationActionCost, baseActionCost.total);
  const actionCost = {
    ...baseActionCost,
    originalTotal: baseActionCost.total,
    ...(operationActionCostKey ? { [operationActionCostKey]: 0 } : {}),
    total: Math.max(0, baseActionCost.total - amountReduced)
  };

  return {
    actionCost,
    actionCostDiscount: {
      source: "boon",
      type: effect.type,
      reason: "next_eligible_tile_action_cost",
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: effect.cardName,
      round: state.round,
      targetCategories: effect.targetCategories,
      appliesTo: effect.appliesTo ?? [operation],
      operation,
      originalActionCost: baseActionCost,
      actionCost,
      amountReduced
    }
  };
}
