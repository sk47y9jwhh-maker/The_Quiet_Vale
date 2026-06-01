import { createMapIndex, getNeighborCoordinates, isWaterHex } from "./map.js";
import {
  createTileIndex,
  getPlacedTileAt,
  getPlacedTileCoordinates,
  isOverstrainedPlacedTile
} from "./tiles.js";

export function isTravelTileDefinition(tile) {
  return (
    tile?.tile_category === "Travel" ||
    tile?.internal_role_tag === "Travel" ||
    /contributes to the Travel Network/i.test(tile?.benefit ?? "")
  );
}

export function isBridgeTileDefinition(tile) {
  return tile?.tile_name === "Bridge" || tile?.tile_name === "Stone Bridge";
}

function isDocksTileDefinition(tile) {
  return (
    tile?.tile_name === "Docks" ||
    /connects its Travel Network to every other placed Docks/i.test(tile?.benefit ?? "") ||
    /connects its connected settlement network to every other placed tile adjacent to Water terrain/i.test(
      tile?.benefit ?? ""
    )
  );
}

export function isActiveTravelTile(placedTile, tileIndex) {
  const definition = tileIndex.get(placedTile.tileId);
  return isTravelTileDefinition(definition) && !isOverstrainedPlacedTile(placedTile);
}

function isActiveNetworkTile(placedTile) {
  return !isOverstrainedPlacedTile(placedTile);
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

function buildSettlementAdjacency(state, tileIndex) {
  const mapIndex = createMapIndex(state.map.hexes);
  const placedByCoordinate = createPlacedTileCoordinateIndex(state.map.placedTiles);
  const activeNetworkTiles = state.map.placedTiles.filter(isActiveNetworkTile);
  const activeNetworkIds = new Set(activeNetworkTiles.map((placedTile) => placedTile.id));
  const adjacency = new Map(activeNetworkTiles.map((placedTile) => [placedTile.id, new Set()]));
  const waterLinkedDocks = [];
  const waterLinkedTiles = [];

  for (const placedTile of activeNetworkTiles) {
    const definition = tileIndex.get(placedTile.tileId);
    const waterLinked = getPlacedTileCoordinates(placedTile).some(
      (coordinate) =>
        isWaterHex(mapIndex.get(coordinate)) ||
        getNeighborCoordinates(coordinate, mapIndex).some((neighborCoordinate) =>
          isWaterHex(mapIndex.get(neighborCoordinate))
        )
    );

    if (waterLinked) {
      waterLinkedTiles.push(placedTile);
    }

    if (isDocksTileDefinition(definition) && waterLinked) {
      waterLinkedDocks.push(placedTile);
    }

    for (const coordinate of getPlacedTileCoordinates(placedTile)) {
      for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
        const neighborTile = placedByCoordinate.get(neighborCoordinate);

        if (!neighborTile || neighborTile.id === placedTile.id || !activeNetworkIds.has(neighborTile.id)) {
          continue;
        }

        adjacency.get(placedTile.id).add(neighborTile.id);
      }
    }
  }

  for (const docks of waterLinkedDocks) {
    for (const waterLinkedTile of waterLinkedTiles) {
      if (docks.id !== waterLinkedTile.id) {
        adjacency.get(docks.id).add(waterLinkedTile.id);
        adjacency.get(waterLinkedTile.id)?.add(docks.id);
      }
    }
  }

  return { activeNetworkTiles, adjacency };
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
  const { activeNetworkTiles, adjacency } = buildSettlementAdjacency(state, tileIndex);
  const activeById = new Map(activeNetworkTiles.map((placedTile) => [placedTile.id, placedTile]));
  const unvisited = new Set(activeNetworkTiles.map((placedTile) => placedTile.id));
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

function getPlayerTravelAnchorTile(state, context = {}) {
  const playerId = context.playerId ?? state.activePlayerId;
  const player = state.players.find((candidate) => candidate.id === playerId);
  const placedTileId = player?.lastInteraction?.placedTileId;

  if (!placedTileId) {
    return null;
  }

  return state.map.placedTiles.find((placedTile) => placedTile.id === placedTileId) ?? null;
}

function getReachableNetworkCoordinates(state, networks, context = {}) {
  const anchorTile = getPlayerTravelAnchorTile(state, context);

  if (!anchorTile) {
    return new Set(networks.flatMap((network) => network.coordinates));
  }

  const anchorNetwork = getNetworkForPlacedTile(networks, anchorTile.id);
  const networkCoordinates = anchorNetwork?.coordinates ?? [];
  return new Set([...networkCoordinates, ...getPlacedTileCoordinates(anchorTile)]);
}

function hasFootprintAdjacencyToCoordinates(state, footprintCoordinates, targetCoordinates) {
  const mapIndex = createMapIndex(state.map.hexes);
  const footprint = new Set(footprintCoordinates);

  return [...footprint].some((coordinate) =>
    getNeighborCoordinates(coordinate, mapIndex).some((neighborCoordinate) =>
      targetCoordinates.has(neighborCoordinate)
    )
  );
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

  const activeTravelCoordinates = getReachableNetworkCoordinates(state, networks, context);

  return hasFootprintAdjacencyToCoordinates(state, footprintCoordinates, activeTravelCoordinates);
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

  if (getPlayerTravelAnchorTile(state, context)?.id === placedTile.id) {
    return true;
  }

  const anchorTile = getPlayerTravelAnchorTile(state, context);

  if (!anchorTile) {
    return networks.some((network) => network.tileIds.includes(placedTile.id));
  }

  const anchorNetwork = getNetworkForPlacedTile(networks, anchorTile.id);
  return Boolean(anchorNetwork?.tileIds.includes(placedTile.id));
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

function effectMatchesDisconnectedTravelDiscount(effect, baseActionCost) {
  return (
    effect.type === "golden_vial_disconnected_travel" &&
    baseActionCost.disconnectedTravelActionCost > 0 &&
    (effect.uses ?? 0) < (effect.maxUses ?? 1)
  );
}

function getPendingDisconnectedTravelDiscountEffect(state, baseActionCost) {
  return (
    (state.encounter?.roundEffects ?? []).find((effect) =>
      effectMatchesDisconnectedTravelDiscount(effect, baseActionCost)
    ) ?? null
  );
}

export function getDiscountedDisconnectedTravelActionCost(state, operation, baseActionCost) {
  const effect = getPendingDisconnectedTravelDiscountEffect(state, baseActionCost);

  if (!effect) {
    return {
      actionCost: baseActionCost,
      actionCostDiscount: null
    };
  }

  const amountReduced = Math.min(baseActionCost.disconnectedTravelActionCost, baseActionCost.total);
  const actionCost = {
    ...baseActionCost,
    originalTotal: baseActionCost.originalTotal ?? baseActionCost.total,
    disconnectedTravelActionCost: 0,
    total: Math.max(0, baseActionCost.total - amountReduced)
  };

  return {
    actionCost,
    actionCostDiscount: {
      source: "golden_boon",
      type: effect.type,
      reason: "once_per_round_disconnected_travel_action",
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: effect.cardName,
      round: state.round,
      operation,
      originalActionCost: baseActionCost,
      actionCost,
      amountReduced
    }
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

  return (
    !effect.targetCategories ||
    effect.targetCategories.includes(tile.tile_category) ||
    effect.targetCategories.includes(tile.internal_role_tag)
  );
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
