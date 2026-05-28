import { ENCOUNTER_TYPES, GAME_PHASES } from "./setup.js";
import { createTileIndex, isOverstrainedPlacedTile } from "./tiles.js";

const MAP_ACTION_TYPES = Object.freeze(["place_tile", "upgrade_tile", "activate_tile"]);

function numberValue(value) {
  return Number(value ?? 0) || 0;
}

function getTileIndex(context = {}) {
  return context.tileIndex ?? createTileIndex(context.tiles ?? []);
}

function countLogs(log, type) {
  return log.filter((entry) => entry.type === type).length;
}

function getLoggedActionCost(entry) {
  const total = entry.data?.actionCost?.total;

  if (Number.isFinite(total)) {
    return total;
  }

  if (entry.type === "encounter" && entry.message?.startsWith("Completed ")) {
    return 1;
  }

  return 0;
}

function getLoggedSavedActions(entry) {
  const actionCost = entry.data?.actionCost;
  const originalTotal = actionCost?.originalTotal;
  const total = actionCost?.total;

  if (!Number.isFinite(originalTotal) || !Number.isFinite(total)) {
    return 0;
  }

  return Math.max(0, originalTotal - total);
}

function getActiveEncounterCounts(activeEncounters) {
  return {
    arrivals: activeEncounters.filter(
      (active) => active.encounterType === ENCOUNTER_TYPES.ARRIVAL && !active.completed
    ).length,
    burdens: activeEncounters.filter((active) => active.encounterType === ENCOUNTER_TYPES.BURDEN && !active.resolved)
      .length,
    boons: activeEncounters.filter((active) => active.encounterType === ENCOUNTER_TYPES.BOON && !active.resolved)
      .length,
    goldenBoons: activeEncounters.filter(
      (active) => active.encounterType === ENCOUNTER_TYPES.GOLDEN_BOON && !active.resolved
    ).length
  };
}

function getTileCategoryCounts(state, tileIndex) {
  return state.map.placedTiles.reduce((counts, placedTile) => {
    const tile = tileIndex.get(placedTile.tileId);
    const category = tile?.tile_category ?? "Unknown";

    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
}

function getCompletedEncounterCounts(completed = []) {
  return {
    arrivals: completed.filter((active) => active.encounterType === ENCOUNTER_TYPES.ARRIVAL).length,
    burdens: completed.filter((active) => active.encounterType === ENCOUNTER_TYPES.BURDEN).length
  };
}

function getExpiredArrivalCount(log = []) {
  return log.reduce((count, entry) => count + (entry.data?.expiredArrivalIds?.length ?? 0), 0);
}

function getCurrentRoundActionsSpent(state) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return 0;
  }

  const totalAvailable = state.playerCount * state.rules.actionsPerPlayer;
  const remaining = state.players.reduce((sum, player) => sum + numberValue(player.actionsRemaining), 0);

  return Math.max(0, totalAvailable - remaining);
}

export function calculatePlaytestMetrics(state, context = {}) {
  const tileIndex = getTileIndex(context);
  const placedTiles = state.map.placedTiles;
  const log = state.log ?? [];
  const mapActionCounts = Object.fromEntries(MAP_ACTION_TYPES.map((type) => [type, countLogs(log, type)]));
  const actionCosts = log.map(getLoggedActionCost);
  const savedActions = log.map(getLoggedSavedActions);
  const activeEncounters = getActiveEncounterCounts(state.encounter.active ?? []);
  const completedEncounters = getCompletedEncounterCounts(state.encounter.completed ?? []);
  const resources = state.warehouse.resources;

  return {
    round: state.round,
    season: state.season,
    phase: state.phase,
    roundProgress: state.round / state.rules.totalRounds,
    turnsEnded: countLogs(log, "turn"),
    roundsCompleted: countLogs(log, "round"),
    totalLoggedActionsSpent: actionCosts.reduce((sum, amount) => sum + amount, 0),
    currentRoundActionsSpent: getCurrentRoundActionsSpent(state),
    actionsSavedByDiscounts: savedActions.reduce((sum, amount) => sum + amount, 0),
    actionMix: {
      placements: mapActionCounts.place_tile,
      upgrades: mapActionCounts.upgrade_tile,
      activations: mapActionCounts.activate_tile,
      mapActions: MAP_ACTION_TYPES.reduce((sum, type) => sum + mapActionCounts[type], 0)
    },
    disconnectedTravel: {
      paid: log.filter((entry) => numberValue(entry.data?.actionCost?.disconnectedTravelActionCost) > 0).length,
      waived: log.filter((entry) => Boolean(entry.data?.disconnectedTravelActionDiscount)).length
    },
    encounters: {
      active: activeEncounters,
      completed: completedEncounters,
      expiredArrivals: getExpiredArrivalCount(log)
    },
    board: {
      placedTiles: placedTiles.length,
      upgradedTiles: placedTiles.filter((placedTile) => tileIndex.get(placedTile.tileId)?.side === "Upgraded").length,
      specialTiles: placedTiles.filter((placedTile) => tileIndex.get(placedTile.tileId)?.tile_source_type === "Special")
        .length,
      overstrainedTiles: placedTiles.filter(isOverstrainedPlacedTile).length,
      supportedTiles: placedTiles.filter((placedTile) => placedTile.supported).length,
      strainTokens: placedTiles.reduce((sum, placedTile) => sum + numberValue(placedTile.strain), 0),
      categories: getTileCategoryCounts(state, tileIndex)
    },
    economy: {
      totalResources: Object.values(resources).reduce((sum, amount) => sum + numberValue(amount), 0),
      cappedResources: Object.entries(resources)
        .filter(([, amount]) => numberValue(amount) >= state.warehouse.cap)
        .map(([resource]) => resource),
      emptyResources: Object.entries(resources)
        .filter(([, amount]) => numberValue(amount) === 0)
        .map(([resource]) => resource)
    },
    score: state.score
  };
}

export function getPlaytestPacingSignals(metrics) {
  const signals = [];
  const mapActions = metrics.actionMix.mapActions;

  if (mapActions >= 4 && metrics.actionMix.upgrades === 0) {
    signals.push("Lots of building, no upgrades yet. Watch whether upgrades are arriving late or feeling unattractive.");
  }

  if (mapActions >= 4 && metrics.actionMix.activations === 0) {
    signals.push("No tile activations yet. Watch whether production choices are too delayed or easy to overlook.");
  }

  if (metrics.board.placedTiles >= 4 && metrics.board.strainTokens === 0 && metrics.encounters.active.burdens === 0) {
    signals.push("Low pressure so far. Watch whether the settlement feels too safe.");
  }

  if (metrics.board.placedTiles > 0 && metrics.board.strainTokens >= metrics.board.placedTiles) {
    signals.push("Strain is matching or exceeding tile count. Watch whether pressure feels exciting or punishing.");
  }

  if (metrics.encounters.active.arrivals > 1) {
    signals.push("Multiple Arrivals are active. Watch whether this creates good urgency or too much attention split.");
  }

  if (metrics.encounters.expiredArrivals > 0) {
    signals.push("At least one Arrival expired. Check whether failure felt fair and readable.");
  }

  if (metrics.disconnectedTravel.paid >= 3) {
    signals.push("Disconnected Travel is being paid often. Watch whether expansion feels costly in a satisfying way.");
  }

  if (metrics.actionsSavedByDiscounts >= 3) {
    signals.push("Discounts have saved several Actions. Watch whether Boons feel generous without flattening choices.");
  }

  if (metrics.economy.cappedResources.length > 0) {
    signals.push(`Warehouse cap reached for ${metrics.economy.cappedResources.join(", ")}. Watch for resource overflow or hoarding.`);
  }

  if (signals.length === 0) {
    signals.push("No strong pacing signal yet. Play a few more turns and watch choice tension, resource pressure, and travel friction.");
  }

  return signals;
}
