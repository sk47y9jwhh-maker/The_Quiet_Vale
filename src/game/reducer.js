import {
  TILE_ACTION_TYPES,
  STRAIN_MAX_PER_TILE,
  createTileIndex,
  fillWarehouse,
  gainWarehouseResources,
  canAffordCost,
  getTileSupplyEntry,
  getPlacedTileAt,
  getPlacedTileCoordinates,
  isOverstrainedPlacedTile,
  markGoodsSubstitutionRound,
  markPlacementDiscountSeason,
  markUpgradeDiscountRound,
  spendWarehouseResources,
  validatePlaceTile,
  validateRelocatePlacedTiles,
  validateUpgradeTile
} from "./tiles.js";
import {
  getDiscountedDisconnectedTravelActionCost,
  calculatePlacedTileActionCost,
  calculatePlacementActionCost,
  getDiscountedTileActionCost
} from "./travel.js";
import {
  ENCOUNTER_TYPES,
  GAME_PHASES,
  createSeededRandom,
  getSeasonForRound,
  isSeasonSeedRound,
  shuffle
} from "./setup.js";
import {
  applyStrainReliefEffect,
  applyPersistentArrivalTimerRoundEffects,
  getBurdenResolutionCost,
  getOptionalBoonStrainReliefApplications,
  resolveBurdenSeasonEffect,
  revealEncounters,
  seedEncounterCards
} from "./encounters.js";
import { applyStrainToPlacedTile, resetRoundSupportUsage, setPlacedTileSupported } from "./strain.js";
import { calculateScore } from "./scoring.js";
import {
  getAdjacentPlacedTiles as getActivationAdjacentPlacedTiles,
  getPlacementSupportEffect,
  getTravelNetworkSupportTargets,
  validateActivateTile
} from "./activation.js";
import {
  STEWARD_POWER_TYPES,
  getAvailableStewardPowerProviders,
  getPendingOpeningResourcePlacement,
  getPendingStewardHousePlacement,
  getRequestedStewardPowerProvider,
  isStewardHousePlacementTerrainForRole,
  isOpeningResourceTileForPlayer,
  markOpeningResourcePlacementComplete,
  markStewardHousePlacementComplete,
  markPlayerStewardPowerUsed,
  markStewardPowerUsed
} from "./stewards.js";
import {
  getBurdenResolutionStrainReliefDetails,
  getEffectiveSupportDetails,
  getProductionBonusDetails
} from "./passives.js";
import { createMapIndex, getNeighborCoordinates } from "./map.js";

function nextLogId(state, offset = 0) {
  return `log-${String(state.log.length + 1 + offset).padStart(3, "0")}`;
}

function createActionLogEntry(state, type, message, data = {}, offset = 0) {
  return {
    id: nextLogId(state, offset),
    round: state.round,
    season: state.season,
    type,
    message,
    data
  };
}

function hasSeedableEncounterCards(state) {
  return (state.players ?? []).some((player) => (player.hand ?? []).length > 0);
}

function canCalculateScore(context) {
  return Boolean(context.tiles || context.tileIndex);
}

function withScore(state, context) {
  return canCalculateScore(context)
    ? {
        ...state,
        score: calculateScore(state, context)
      }
    : state;
}

function updateTileSupply(state, tileId, updateEntry) {
  return {
    ...state.tileSupply,
    core: state.tileSupply.core.map((entry) => (entry.tileId === tileId ? updateEntry(entry) : entry)),
    special: state.tileSupply.special.map((entry) => (entry.tileId === tileId ? updateEntry(entry) : entry))
  };
}

function getActivePlayer(state, playerId = state.activePlayerId) {
  return state.players.find((player) => player.id === playerId) ?? null;
}

function spendPlayerActions(state, playerId, actionCost) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            actionsRemaining: player.actionsRemaining - actionCost.total
          }
        : player
    )
  };
}

function markPlayerMapInteraction(state, playerId, placedTile, type) {
  if (!placedTile?.id) {
    return state;
  }

  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            lastInteraction: {
              type,
              placedTileId: placedTile.id,
              coordinate: placedTile.coordinate ?? placedTile.coordinates?.[0] ?? null,
              round: state.round,
              season: state.season
            }
          }
        : player
    )
  };
}

function markPlayerTokenMapInteraction(state, playerId, coordinate, type) {
  if (!coordinate) {
    return state;
  }

  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            lastInteraction: {
              type,
              placedTileId: null,
              coordinate,
              round: state.round,
              season: state.season
            }
          }
        : player
    )
  };
}

function markPlayerOpeningResourcePlacement(state, playerId, placedTile) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? markOpeningResourcePlacementComplete(player, placedTile) : player
    )
  };
}

function markPlayerStewardHousePlacement(state, playerId, placedTile) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? markStewardHousePlacementComplete(player, placedTile) : player
    )
  };
}

function validateStewardHouseSetupPlacement(state, action, context, pendingPlacement) {
  const mapIndex = createMapIndex(state.map.hexes);
  const hex = mapIndex.get(action.coordinate);
  const errors = [];
  const rangerAdjacentHeathsStart =
    pendingPlacement?.role?.id === "ranger" &&
    hex?.Terrain !== "Water" &&
    getNeighborCoordinates(action.coordinate, mapIndex).some(
      (neighborCoordinate) => mapIndex.get(neighborCoordinate)?.Terrain === "Heaths"
    );

  if (!pendingPlacement) {
    errors.push("No Steward token placement is currently pending.");
  }

  if (!hex) {
    errors.push(`Unknown map coordinate: ${action.coordinate}.`);
  } else if (
    !isStewardHousePlacementTerrainForRole(pendingPlacement?.role, hex.Terrain) &&
    !rangerAdjacentHeathsStart
  ) {
    errors.push(`${pendingPlacement?.role?.name ?? "This Steward"} must place their token on ${pendingPlacement?.terrainOptions?.join(" or ") ?? "their setup terrain"}.`);
  }

  if (hex?.Terrain === "Water") {
    errors.push("Steward tokens cannot start on River hexes.");
  }

  if (getPlacedTileAt(state, action.coordinate)) {
    errors.push(`${action.coordinate} already has a placed tile.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    hex,
    footprintCoordinates: action.coordinate ? [action.coordinate] : []
  };
}

function placeStewardHouse(state, action, context) {
  if (state.phase !== GAME_PHASES.PLACE_STEWARD_HOUSES) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
        errors: ["Steward tokens can only be placed during the Steward token setup phase."]
      }
    };
  }

  const pendingPlacement = getPendingStewardHousePlacement(state, state.activePlayerId);
  const validation = validateStewardHouseSetupPlacement(state, action, context, pendingPlacement);

  if (!validation.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
        errors: validation.errors
      }
    };
  }

  const player = pendingPlacement.player;
  const placedToken = {
    coordinate: action.coordinate,
    roleId: player.stewardRoleId,
    playerId: player.id
  };
  const actionState = markPlayerStewardHousePlacement(
    markPlayerTokenMapInteraction(state, player.id, placedToken.coordinate, "setup_token"),
    player.id,
    placedToken
  );
  const nextPendingPlayer = actionState.players.find((candidate) => !candidate.stewardHousePlacement?.completed);
  const setupComplete = !nextPendingPlayer;
  const nextState = {
    ...actionState,
    phase: setupComplete ? GAME_PHASES.SEED_ENCOUNTERS : GAME_PHASES.PLACE_STEWARD_HOUSES,
    activePlayerId: setupComplete ? null : nextPendingPlayer.id,
    log: [
      ...actionState.log,
      createActionLogEntry(
        actionState,
        "setup",
        `${player.name} placed their ${pendingPlacement.role.name} token on ${placedToken.coordinate}.`,
        {
          playerId: player.id,
          stewardRoleId: player.stewardRoleId,
          coordinate: placedToken.coordinate,
          setupComplete
        }
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
      message: `Placed ${pendingPlacement.role.name} token on ${placedToken.coordinate}.`,
      placedToken,
      placedTiles: [],
      actionCost: {
        connected: true,
        disconnectedTravelIgnored: true,
        disconnectedTravelIgnoreReason: "steward_token_setup",
        placeActionCost: 0,
        disconnectedTravelActionCost: 0,
        total: 0
      },
      cost: [],
      setupComplete
    }
  };
}

function getOpeningPlacementBlockMessage(state, playerId = state.activePlayerId) {
  const pending = getPendingOpeningResourcePlacement(state, playerId);

  if (!pending) {
    return "";
  }

  return `${pending.player.name}'s first Round 1 action must be their ${pending.role.name} opening move: ${pending.summary}.`;
}

function blockForPendingOpeningPlacement(state, actionType, playerId = state.activePlayerId) {
  const message = getOpeningPlacementBlockMessage(state, playerId);

  return message
    ? {
        state,
        result: {
          ok: false,
          action: actionType,
          errors: [message]
        }
      }
    : null;
}

function isStablesPlacementTile(tile) {
  return tile?.tile_name === "Stables";
}

function createPlacedTileRecord(state, action, validation, indexOffset = 0) {
  return {
    id: `tile-${String(state.map.placedTiles.length + 1 + indexOffset).padStart(3, "0")}`,
    tileId: action.tileId,
    coordinate: action.coordinate,
    coordinates: validation.footprintCoordinates,
    orientation: action.orientation,
    strain: 0,
    supported: false,
    supportedUsedThisRound: false
  };
}

function createStablesPairActionCost() {
  return {
    connected: true,
    disconnectedTravelIgnored: true,
    disconnectedTravelIgnoreReason: "stables_pair_placement",
    placeActionCost: 1,
    disconnectedTravelActionCost: 0,
    total: 1
  };
}

function categoryMatchesSupportTarget(tile, categories = []) {
  return (
    !categories?.length ||
    categories.includes(tile?.tile_category) ||
    categories.includes(tile?.internal_role_tag)
  );
}

function applyPlacementSupportEffects(state, placedTiles, context = {}) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  let workingState = {
    ...state,
    map: {
      ...state.map,
      placedTiles: [...state.map.placedTiles, ...placedTiles]
    }
  };
  const applications = [];

  for (const sourcePlacedTile of placedTiles) {
    const sourceDefinition = tileIndex.get(sourcePlacedTile.tileId);
    const supportEffect = getPlacementSupportEffect(sourceDefinition);

    if (!supportEffect) {
      continue;
    }

    const candidates =
      supportEffect.type === "give_supported_travel_network"
        ? getTravelNetworkSupportTargets(workingState, sourcePlacedTile, tileIndex)
        : getActivationAdjacentPlacedTiles(workingState, sourcePlacedTile)
            .filter((candidate) => !isOverstrainedPlacedTile(candidate))
            .filter((candidate) => !candidate.supported)
            .filter((candidate) => categoryMatchesSupportTarget(tileIndex.get(candidate.tileId), supportEffect.targetCategories));

    const targets = sortPlacedTilesById(candidates).slice(0, supportEffect.maxTargets ?? candidates.length);

    if (targets.length === 0) {
      continue;
    }

    const targetIds = new Set(targets.map((target) => target.id));
    workingState = {
      ...workingState,
      map: {
        ...workingState.map,
        placedTiles: workingState.map.placedTiles.map((placedTile) =>
          targetIds.has(placedTile.id) ? setPlacedTileSupported(placedTile, true) : placedTile
        )
      }
    };

    for (const target of targets) {
      applications.push({
        sourcePlacedTileId: sourcePlacedTile.id,
        sourceTileId: sourcePlacedTile.tileId,
        sourceTileName: sourceDefinition?.tile_name ?? sourcePlacedTile.tileId,
        targetPlacedTileId: target.id,
        targetTileId: target.tileId,
        targetTileName: getTileName(context, target.tileId),
        supportType: supportEffect.type
      });
    }
  }

  return {
    placedTiles: workingState.map.placedTiles,
    applications
  };
}

function createStewardPowerUse(provider, actionCost, operation) {
  if (!provider) {
    return null;
  }

  return {
    source: "steward_power",
    type: provider.details.type,
    operation,
    providerPlayerId: provider.player?.id ?? null,
    providerRoleId: provider.role?.id ?? null,
    providerPlacedTileId: provider.placedTile?.id ?? null,
    providerTileId: provider.placedTile?.tileId ?? provider.tile?.tile_id ?? null,
    providerTileName: provider.tile?.tile_name ?? provider.placedTile?.tileId ?? "Steward Power",
    actionCost
  };
}

function reduceFirstAffordableResource(cost, preferredResource = null) {
  const target = preferredResource
    ? cost.find((entry) => entry.resource === preferredResource && entry.amount > 0)
    : cost.find((entry) => entry.amount > 0);

  if (!target) {
    return null;
  }

  const reducedCost = cost
    .map((entry) =>
      entry.resource === target.resource
        ? {
            ...entry,
            amount: Math.max(0, entry.amount - 1)
          }
        : entry
    )
    .filter((entry) => entry.amount > 0);

  return {
    originalCost: cost,
    cost: reducedCost,
    reduction: [{ amount: 1, resource: target.resource }]
  };
}

function reduceResourceCostByAmount(cost, amount) {
  let remaining = Math.max(0, Number(amount ?? 0));
  const reduction = [];
  const reducedCost = [];

  for (const entry of cost) {
    const reducible = Math.min(entry.amount, remaining);
    const nextAmount = entry.amount - reducible;

    if (reducible > 0) {
      reduction.push({ resource: entry.resource, amount: reducible });
      remaining -= reducible;
    }

    if (nextAmount > 0) {
      reducedCost.push({ ...entry, amount: nextAmount });
    }
  }

  if (reduction.length === 0) {
    return null;
  }

  return {
    originalCost: cost,
    cost: reducedCost,
    reduction
  };
}

function getStewardPlacementResourceDiscount(provider, tile, cost) {
  if (
    provider?.details.type !== STEWARD_POWER_TYPES.PLACEMENT_RESOURCE_DISCOUNT ||
    !provider.details.categories?.includes(tile.tile_category) ||
    cost.length === 0
  ) {
    return null;
  }

  const reduced = reduceResourceCostByAmount(cost, provider.details.amount ?? 2);

  return reduced
    ? {
        source: "steward_power",
        roleId: provider.role?.id,
        operation: "placement",
        stewardPowerProviderId: provider.placedTile?.id ?? null,
        ...reduced
      }
    : null;
}

function getStewardStartingCostReduction(player, tile, operation, cost, action = {}) {
  if (!player || player.stewardStartingBenefitUsed || cost.length === 0) {
    return null;
  }

  const roleId = player.stewardRoleId;
  const qualifies =
    (roleId === "vanguard" && operation === "placement" && ["Travel", "Resource"].includes(tile.tile_category)) ||
    (roleId === "knight" && operation === "placement" && tile.tile_category === "Housing") ||
    (roleId === "sentinel" && operation === "upgrade");

  if (!qualifies) {
    return null;
  }

  const reduced = reduceFirstAffordableResource(cost, action.stewardStartingBenefitResource);
  if (!reduced) {
    return null;
  }

  return {
    source: "steward_starting_benefit",
    roleId,
    operation,
    ...reduced
  };
}

function shouldApplyWardenStartingSupport(player, operation) {
  return (
    player?.stewardRoleId === "warden" &&
    !player.stewardStartingBenefitUsed &&
    operation === "placement"
  );
}

function markPlayerStartingBenefitUsed(players, playerId, benefit) {
  if (!benefit) {
    return players;
  }

  return players.map((player) =>
    player.id === playerId
      ? {
          ...player,
          stewardStartingBenefitUsed: true
        }
      : player
  );
}

function getQuartermasterStartingExchangePlayer(state, playerId) {
  if (playerId) {
    return state.players.find((player) => player.id === playerId) ?? null;
  }

  return (
    state.players.find((player) => player.id === state.activePlayerId && player.stewardRoleId === "quartermaster") ??
    state.players.find((player) => player.stewardRoleId === "quartermaster") ??
    null
  );
}

function useQuartermasterStartingExchange(state, action) {
  const player = getQuartermasterStartingExchangePlayer(state, action.playerId);
  const payment = summarizeResourcePayment(action.payment ?? []);
  const gains = summarizeResourcePayment(action.gains ?? []);
  const totalPaid = payment.reduce((total, entry) => total + entry.amount, 0);
  const totalGained = gains.reduce((total, entry) => total + entry.amount, 0);
  const errors = [];

  if (!player) {
    errors.push(`Unknown player: ${action.playerId ?? state.activePlayerId ?? "Quartermaster"}`);
  } else if (player.stewardRoleId !== "quartermaster") {
    errors.push("Only the Quartermaster can use the Season I Warehouse exchange.");
  } else if (player.stewardStartingBenefitUsed) {
    errors.push("Quartermaster Season I exchange has already been used.");
  }

  if (
    state.season !== "I" ||
    state.phase === GAME_PHASES.PLACE_STEWARD_HOUSES ||
    state.phase === GAME_PHASES.COMPLETE
  ) {
    errors.push("Quartermaster Season I exchange must be used during Season I after Steward tokens are placed.");
  }

  for (const { resource, amount } of [...payment, ...gains]) {
    if (!state.rules.resources.includes(resource)) {
      errors.push(`${resource} is not a valid Warehouse resource.`);
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      errors.push("Quartermaster Season I exchange amounts must be positive whole numbers.");
    }
  }

  if (totalPaid < 1 || totalPaid > 2) {
    errors.push("Choose 1-2 resources to exchange.");
  }

  if (totalGained !== totalPaid) {
    errors.push("Choose the same number of resources to gain as you pay.");
  }

  if (errors.length === 0 && !canAffordCost(state.warehouse, payment)) {
    errors.push("Quartermaster needs the chosen resources available in the Warehouse.");
  }

  if (errors.length > 0) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        errors,
        payment,
        gains
      }
    };
  }

  const warehouseAfterPayment = spendWarehouseResources(state.warehouse, payment);
  const resourceGain = gainWarehouseResources(warehouseAfterPayment, gains);
  const nextState = {
    ...state,
    players: state.players.map((candidate) =>
      candidate.id === player.id
        ? {
            ...candidate,
            stewardStartingBenefitUsed: true
          }
        : candidate
    ),
    warehouse: resourceGain.warehouse,
    log: [
      ...state.log,
      createActionLogEntry(state, "steward_power", "Quartermaster exchanged Warehouse resources during Season I.", {
        playerId: player.id,
        stewardRoleId: player.stewardRoleId,
        payment,
        gains,
        applied: resourceGain.applied
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
      message: `Quartermaster exchanged ${describeResourceAmounts(payment)} for ${describeResourceAmounts(gains)} during Season I.`,
      stewardStartingBenefit: {
        source: "steward_starting_benefit",
        type: STEWARD_POWER_TYPES.STARTING_RESOURCE_EXCHANGE,
        playerId: player.id,
        roleId: player.stewardRoleId,
        payment,
        gains,
        applied: resourceGain.applied
      },
      payment,
      gains,
      applied: resourceGain.applied
    }
  };
}

function applyStewardPowerActionReduction(actionCost, provider, operation, reduceCost) {
  if (!provider) {
    return {
      actionCost,
      stewardPower: null
    };
  }

  const nextActionCost = reduceCost(actionCost);

  return {
    actionCost: nextActionCost,
    stewardPower: createStewardPowerUse(provider, nextActionCost, operation)
  };
}

function markStewardPowerProviderUsed(placedTiles, stewardPower, season) {
  if (!stewardPower?.providerPlacedTileId) {
    return placedTiles;
  }

  return placedTiles.map((placedTile) =>
    placedTile.id === stewardPower.providerPlacedTileId ? markStewardPowerUsed(placedTile, season) : placedTile
  );
}

function markPlayerStewardPowerProviderUsed(players, stewardPower, season) {
  if (!stewardPower?.providerPlayerId || !stewardPower?.type) {
    return players;
  }

  return players.map((player) =>
    player.id === stewardPower.providerPlayerId ? markPlayerStewardPowerUsed(player, season, stewardPower.type) : player
  );
}

function getRequestedPlacementStewardPowerProvider(state, action, context, tile, baseActionCost) {
  if (!action.stewardPowerPlacedTileId) {
    return {
      valid: true,
      provider: null,
      errors: []
    };
  }

  const placementProviders = getAvailableStewardPowerProviders(
    state,
    context,
    STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION,
    (provider) => provider.details.categories.includes(tile.tile_category)
  );
  const placementResourceDiscountProviders = getAvailableStewardPowerProviders(
    state,
    context,
    STEWARD_POWER_TYPES.PLACEMENT_RESOURCE_DISCOUNT,
    (provider) => provider.details.categories.includes(tile.tile_category)
  );
  const disconnectedProviders = getAvailableStewardPowerProviders(
    state,
    context,
    STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION,
    (provider) =>
      baseActionCost.blockedByReachability === true &&
      (!provider.details.categories || provider.details.categories.includes(tile.tile_category))
  );
  const provider = [...placementProviders, ...placementResourceDiscountProviders, ...disconnectedProviders].find(
    (candidate) => candidate.placedTile.id === action.stewardPowerPlacedTileId
  );

  return provider
    ? {
        valid: true,
        provider,
        errors: []
      }
    : {
        valid: false,
        provider: null,
        errors: ["Selected Steward Power is not available for this placement."]
      };
}

function getRequestedUpgradeStewardPowerProvider(state, action, context, tile, baseActionCost) {
  if (!action.stewardPowerPlacedTileId) {
    return {
      valid: true,
      provider: null,
      errors: []
    };
  }

  const upgradeProviders = getAvailableStewardPowerProviders(
    state,
    context,
    STEWARD_POWER_TYPES.FREE_CORE_UPGRADE_ACTION,
    () => tile.tile_source_type === "Core"
  );
  const rangerProviders = getAvailableStewardPowerProviders(
    state,
    context,
    STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION,
    () => baseActionCost.blockedByReachability === true
  );
  const provider = [...upgradeProviders, ...rangerProviders].find(
    (candidate) => candidate.placedTile.id === action.stewardPowerPlacedTileId
  );

  return provider
    ? {
        valid: true,
        provider,
        errors: []
      }
    : {
        valid: false,
        provider: null,
        errors: ["Selected Steward Power is not available for this upgrade."]
      };
}

function getRequestedReachabilityStewardPowerProvider(state, action, context, baseActionCost, operationLabel) {
  if (!action.stewardPowerPlacedTileId) {
    return {
      valid: true,
      provider: null,
      errors: []
    };
  }

  const providers = getAvailableStewardPowerProviders(
    state,
    context,
    STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION,
    () => baseActionCost.blockedByReachability === true
  );
  const provider = providers.find((candidate) => candidate.placedTile.id === action.stewardPowerPlacedTileId);

  return provider
    ? {
        valid: true,
        provider,
        errors: []
      }
    : {
        valid: false,
        provider: null,
        errors: [`Selected Steward Power is not available for this ${operationLabel}.`]
      };
}

function allowStewardReachabilityBypass(actionCost, provider) {
  if (provider?.details.type !== STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION) {
    return actionCost;
  }

  const nextActionCost = {
    ...actionCost,
    originalTotal: actionCost.originalTotal ?? actionCost.total,
    connected: true,
    blockedByReachability: false,
    disconnectedTravelIgnored: true,
    disconnectedTravelIgnoreReason: `${provider.role?.id ?? "steward"}_steward_power`,
    total: actionCost.total
  };

  return nextActionCost;
}

function getReachabilityBlockError(player, tileName, operation) {
  return `${player.name}'s Steward is not connected to ${tileName}. Place or use tiles on that Steward's connected network.`;
}

function describeResourceAmounts(amounts, amountKey = "amount") {
  return amounts.map((entry) => `${entry[amountKey]} ${entry.resource}`).join(", ");
}

function describeList(items) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function getTileName(context, tileId) {
  return context.tiles?.find((tile) => tile.tile_id === tileId)?.tile_name ?? tileId;
}

function getEncounterCardName(context, cardId) {
  return context.encounterCards?.find((card) => card.card_id === cardId)?.card_name ?? cardId;
}

function summarizeResourcePayment(payment = []) {
  const amounts = new Map();

  for (const { resource, amount } of payment) {
    amounts.set(resource, (amounts.get(resource) ?? 0) + amount);
  }

  return [...amounts.entries()].map(([resource, amount]) => ({ resource, amount }));
}

function subtractResourceAmounts(cost, reduction) {
  return cost
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
}

function resolveStewardResourceSubstitution(state, action, context, cost, operation) {
  const providerId =
    action.stewardResourceSubstitutionPowerId ??
    action.resourceSubstitutionStewardPowerPlacedTileId ??
    action.resourceSubstitutionPowerId ??
    "";

  if (!providerId || cost.length === 0) {
    return {
      valid: true,
      errors: [],
      cost,
      substitution: null,
      stewardPower: null
    };
  }

  const stewardPowerProvider = getRequestedStewardPowerProvider(
    state,
    {
      ...context,
      allowAnyPlayer: true
    },
    providerId,
    STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
  );

  if (!stewardPowerProvider.valid || !stewardPowerProvider.provider) {
    return {
      valid: false,
      errors: stewardPowerProvider.errors.length
        ? stewardPowerProvider.errors
        : ["Choose an available Quartermaster substitution."],
      cost,
      substitution: null,
      stewardPower: null
    };
  }

  const selectedResources = (action.stewardResourceSubstitutionResources ?? action.substitutedCostResources ?? [])
    .filter(Boolean);
  const payment = summarizeResourcePayment(
    action.stewardResourceSubstitutionPayment ?? action.substitutionPayment ?? []
  );
  const reduction = summarizeResourcePayment(
    selectedResources.map((resource) => ({
      resource,
      amount: 1
    }))
  );
  const amountSubstituted = reduction.reduce((total, entry) => total + entry.amount, 0);
  const amountPaid = payment.reduce((total, entry) => total + entry.amount, 0);
  const maxAmount = stewardPowerProvider.provider.details.maxAmount ?? 3;
  const errors = [];

  if (amountSubstituted < 1 || amountSubstituted > maxAmount) {
    errors.push(`Choose 1-${maxAmount} resources from the cost for Quartermaster to substitute.`);
  }

  if (amountPaid !== amountSubstituted) {
    errors.push("Choose the same number of replacement resources to pay.");
  }

  for (const entry of reduction) {
    const costEntry = cost.find((candidate) => candidate.resource === entry.resource);

    if (!costEntry) {
      errors.push(`${entry.resource} is not part of this cost.`);
    } else if (entry.amount > costEntry.amount) {
      errors.push(`This cost only contains ${costEntry.amount} ${entry.resource}.`);
    }
  }

  for (const { resource, amount } of payment) {
    if (!state.rules.resources.includes(resource)) {
      errors.push(`${resource} is not a valid Warehouse resource.`);
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      errors.push("Quartermaster replacement amounts must be positive whole numbers.");
    }
  }

  const substitutedCost = summarizeResourcePayment([...subtractResourceAmounts(cost, reduction), ...payment]);

  if (errors.length === 0 && !canAffordCost(state.warehouse, substitutedCost)) {
    errors.push(`Quartermaster substitution would cost ${describeResourceAmounts(substitutedCost)}, which is not available in the Warehouse.`);
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      cost,
      substitution: null,
      stewardPower: null
    };
  }

  const stewardPower = createStewardPowerUse(
    stewardPowerProvider.provider,
    { total: 0 },
    `${operation}_resource_substitution`
  );

  return {
    valid: true,
    errors: [],
    cost: substitutedCost,
    substitution: {
      source: "steward_power",
      type: STEWARD_POWER_TYPES.RESOURCE_EXCHANGE,
      originalCost: cost,
      cost: substitutedCost,
      reduction,
      payment,
      amountSubstituted,
      stewardPower
    },
    stewardPower
  };
}

function parseArrivalResourceAmounts(text) {
  const errors = [];
  const cost = String(text ?? "")
    .replace(/^Pay\s+/i, "")
    .replace(/\.$/, "")
    .split(/\n|,|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d+)\s+([A-Za-z ]+)$/.exec(part.replace(/\.$/, ""));

      if (!match) {
        errors.push(`Unsupported Arrival resource requirement: ${part}`);
        return null;
      }

      return {
        amount: Number(match[1]),
        resource: match[2].trim()
      };
    })
    .filter(Boolean);

  return {
    cost: summarizeResourcePayment(cost),
    errors
  };
}

function parseArrivalRequirement(requirementText, resources = []) {
  const text = String(requirementText ?? "").trim();
  if (!text) {
    return {
      supported: true,
      text: "",
      cost: [],
      tileRequirements: [],
      errors: []
    };
  }

  const requirement = text.split(/\bwithin\b/i)[0].trim();
  const housingMatch = /^Have at least (\d+) Housing Tiles? and pay (.+)$/i.exec(requirement);
  const tileRequirements = housingMatch
    ? [
        {
          category: "Housing",
          amount: Number(housingMatch[1])
        }
      ]
    : [];
  const parsed = parseArrivalResourceAmounts(housingMatch ? housingMatch[2] : requirement);
  const unknownResources = parsed.cost
    .filter((entry) => resources.length > 0 && !resources.includes(entry.resource))
    .map((entry) => entry.resource);
  const errors = [
    ...parsed.errors,
    ...unknownResources.map((resource) => `${resource} is not a valid Arrival requirement resource.`)
  ];

  return {
    supported: errors.length === 0,
    text: requirement,
    cost: parsed.cost,
    tileRequirements,
    errors
  };
}

function getTileDefinition(context, tileId) {
  if (context.tileIndex) {
    return context.tileIndex.get(tileId) ?? null;
  }

  return context.tiles?.find((tile) => tile.tile_id === tileId) ?? null;
}

function countPlacedTilesByCategory(state, context, category) {
  return state.map.placedTiles.filter(
    (placedTile) => getTileDefinition(context, placedTile.tileId)?.tile_category === category
  ).length;
}

function validateArrivalTileRequirements(state, context, tileRequirements) {
  const errors = [];

  for (const requirement of tileRequirements) {
    const count = countPlacedTilesByCategory(state, context, requirement.category);

    if (count < requirement.amount) {
      errors.push(
        `Arrival requires at least ${requirement.amount} ${requirement.category} Tile${requirement.amount === 1 ? "" : "s"}.`
      );
    }
  }

  return errors;
}

function getPendingArrivalRequirementDiscountEffect(state) {
  return (
    (state.encounter.roundEffects ?? []).find(
      (effect) =>
        effect.type === "arrival_requirement_discount" &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function resolveArrivalRequirementDiscount(state, action, cost) {
  const effect = getPendingArrivalRequirementDiscountEffect(state);

  if (!effect || cost.length === 0) {
    return {
      valid: true,
      errors: [],
      cost,
      discount: null
    };
  }

  const totalCost = cost.reduce((sum, entry) => sum + entry.amount, 0);
  const amount = Math.min(effect.amount, totalCost);
  const selectedResources = (action.arrivalRequirementReductionResources ?? []).filter(Boolean);

  if (selectedResources.length !== amount) {
    return {
      valid: false,
      errors: [
        `Choose exactly ${amount} resource${amount === 1 ? "" : "s"} for ${effect.cardName}'s Arrival requirement reduction.`
      ],
      cost,
      discount: null
    };
  }

  const reduction = summarizeResourcePayment(
    selectedResources.map((resource) => ({
      resource,
      amount: 1
    }))
  );
  const errors = [];

  for (const entry of reduction) {
    const costEntry = cost.find((candidate) => candidate.resource === entry.resource);

    if (!costEntry) {
      errors.push(`${effect.cardName} can only reduce resources in the Arrival requirement.`);
    } else if (entry.amount > costEntry.amount) {
      errors.push(
        `${effect.cardName} cannot reduce ${entry.resource} by ${entry.amount}; the Arrival only requires ${costEntry.amount}.`
      );
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      cost,
      discount: null
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
    valid: true,
    errors: [],
    cost: reducedCost,
    discount: {
      source: "boon",
      type: "arrival_requirement_discount",
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: effect.cardName,
      originalCost: cost,
      cost: reducedCost,
      reduction,
      selectedResources,
      amountReduced: amount
    }
  };
}

function getPendingBurdenResolutionDiscountEffect(state) {
  return (
    (state.encounter.roundEffects ?? []).find(
      (effect) =>
        effect.type === "burden_resolution_discount" &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function resolveBurdenResolutionDiscount(state, action, cost) {
  const effect = getPendingBurdenResolutionDiscountEffect(state);

  if (!effect || cost.length === 0) {
    return {
      valid: true,
      errors: [],
      cost,
      discount: null
    };
  }

  const totalCost = cost.reduce((sum, entry) => sum + entry.amount, 0);
  const amount = Math.min(effect.amount, totalCost);
  const selectedResources = (action.burdenResolutionReductionResources ?? []).filter(Boolean);

  if (selectedResources.length !== amount) {
    return {
      valid: false,
      errors: [
        `Choose exactly ${amount} resource${amount === 1 ? "" : "s"} for ${effect.cardName}'s Burden resolution reduction.`
      ],
      cost,
      discount: null
    };
  }

  const reduction = summarizeResourcePayment(
    selectedResources.map((resource) => ({
      resource,
      amount: 1
    }))
  );
  const errors = [];

  for (const entry of reduction) {
    const costEntry = cost.find((candidate) => candidate.resource === entry.resource);

    if (!costEntry) {
      errors.push(`${effect.cardName} can only reduce resources in the Burden resolution cost.`);
    } else if (entry.amount > costEntry.amount) {
      errors.push(
        `${effect.cardName} cannot reduce ${entry.resource} by ${entry.amount}; the Burden only costs ${costEntry.amount}.`
      );
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      cost,
      discount: null
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
    valid: true,
    errors: [],
    cost: reducedCost,
    discount: {
      source: "boon",
      type: "burden_resolution_discount",
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: effect.cardName,
      originalCost: cost,
      cost: reducedCost,
      reduction,
      selectedResources,
      amountReduced: amount
    }
  };
}

function markActivatedEffectSeason(placedTile, activation, season) {
  if (!activation.oncePerSeason) {
    return placedTile;
  }

  const activatedEffectSeasons = placedTile.activatedEffectSeasons ?? [];
  if (activatedEffectSeasons.includes(season)) {
    return placedTile;
  }

  return {
    ...placedTile,
    activatedEffectSeasons: [...activatedEffectSeasons, season]
  };
}

function applyRoundEffectUses(encounter, bonuses) {
  const useCounts = bonuses
    .filter((bonus) => bonus.source === "boon" && bonus.roundEffectId)
    .reduce((counts, bonus) => {
      counts.set(bonus.roundEffectId, (counts.get(bonus.roundEffectId) ?? 0) + 1);
      return counts;
    }, new Map());

  if (useCounts.size === 0) {
    return encounter;
  }

  return {
    ...encounter,
    roundEffects: (encounter.roundEffects ?? []).map((effect) =>
      useCounts.has(effect.id)
        ? {
            ...effect,
            uses: (effect.uses ?? 0) + useCounts.get(effect.id)
          }
        : effect
    )
  };
}

function applyPlacementCostReductionUse(encounter, placementCostReduction) {
  if (placementCostReduction?.source !== "boon" || !placementCostReduction.effectId) {
    return encounter;
  }

  return {
    ...encounter,
    roundEffects: (encounter.roundEffects ?? []).map((effect) =>
      effect.id === placementCostReduction.effectId
        ? {
            ...effect,
            uses: (effect.uses ?? 0) + 1
          }
        : effect
    )
  };
}

function applyActionCostDiscountUse(encounter, actionCostDiscount) {
  if (!["boon", "golden_boon"].includes(actionCostDiscount?.source) || !actionCostDiscount.effectId) {
    return encounter;
  }

  const effect = (encounter.roundEffects ?? []).find((candidate) => candidate.id === actionCostDiscount.effectId);

  if (effect?.discardAfterUse && (effect.uses ?? 0) + 1 >= (effect.maxUses ?? 1)) {
    return {
      ...encounter,
      discard: [...encounter.discard, effect.cardId],
      roundEffects: (encounter.roundEffects ?? []).filter((candidate) => candidate.id !== effect.id)
    };
  }

  return {
    ...encounter,
    roundEffects: (encounter.roundEffects ?? []).map((effect) =>
      effect.id === actionCostDiscount.effectId
        ? {
            ...effect,
            uses: (effect.uses ?? 0) + 1
          }
        : effect
    )
  };
}

function resetRecurringRoundEffects(roundEffects = []) {
  return roundEffects.map((effect) =>
    effect.resetUsesEachRound
      ? {
          ...effect,
          uses: 0
        }
      : effect
  );
}

function getPendingExtraPlayerTurnsEffect(state) {
  return (
    (state.encounter.roundEffects ?? []).find(
      (effect) =>
        effect.type === "golden_eyed_traveler_extra_turns" &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function markRoundEffectUsed(encounter, effectId) {
  return {
    ...encounter,
    roundEffects: (encounter.roundEffects ?? []).map((effect) =>
      effect.id === effectId
        ? {
            ...effect,
            uses: (effect.uses ?? 0) + 1
          }
        : effect
    )
  };
}

function applyUpgradeCostReductionUse(encounter, upgradeCostReduction) {
  if (upgradeCostReduction?.source !== "boon" || !upgradeCostReduction.effectId) {
    return encounter;
  }

  if (upgradeCostReduction.discardAfterUse) {
    return {
      ...encounter,
      discard: [...encounter.discard, upgradeCostReduction.cardId],
      roundEffects: (encounter.roundEffects ?? []).filter((effect) => effect.id !== upgradeCostReduction.effectId)
    };
  }

  return applyPlacementCostReductionUse(encounter, upgradeCostReduction);
}

function applyBurdenResolutionStrainRelief(state, context) {
  const relief = getBurdenResolutionStrainReliefDetails(state, context);

  if (!relief) {
    return {
      state,
      relief: null
    };
  }

  return {
    state: {
      ...state,
      map: {
        ...state.map,
        placedTiles: state.map.placedTiles.map((placedTile) =>
          placedTile.id === relief.targetPlacedTileId
            ? {
                ...placedTile,
                strain: Math.max(0, (placedTile.strain ?? 0) - relief.strainRemoved)
              }
            : placedTile
        )
      }
    },
    relief
  };
}

function resolveBurdenPaymentCost(resolution, action, state) {
  if (!resolution.requiresPaymentChoice) {
    return {
      valid: true,
      errors: [],
      cost: resolution.cost
    };
  }

  const payment = summarizeResourcePayment(action.payment ?? []);
  const allowedResources = resolution.allowedResources ?? state.rules.resources;
  const errors = [];

  for (const { resource, amount } of payment) {
    if (!allowedResources.includes(resource)) {
      errors.push(`${resource} is not valid for this Burden resolution.`);
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      errors.push("Burden resolution payment amounts must be positive whole numbers.");
    }
  }

  const total = payment.reduce((sum, entry) => sum + entry.amount, 0);
  if (total !== resolution.amount) {
    errors.push(`Choose exactly ${resolution.amount} resource${resolution.amount === 1 ? "" : "s"} to pay.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    cost: payment
  };
}

function getPendingBurdenChoice(state, action) {
  const activeBurden = state.encounter.active.find((activeState) => activeState.id === action.activeEncounterId);

  if (!activeBurden) {
    return {
      valid: false,
      errors: [`Unknown active Encounter: ${action.activeEncounterId}`]
    };
  }

  if (activeBurden.encounterType !== ENCOUNTER_TYPES.BURDEN || activeBurden.resolved) {
    return {
      valid: false,
      errors: ["Only unresolved active Burdens can have reveal choices applied."]
    };
  }

  if (
    !["pay_or_strain_choice", "arrival_pay_or_timer_choice", "resource_loss_or_strain_choice"].includes(
      activeBurden.pendingChoice?.type
    )
  ) {
    return {
      valid: false,
      errors: ["This Burden has no pending reveal choice."]
    };
  }

  return {
    valid: true,
    activeBurden,
    effect: activeBurden.pendingChoice
  };
}

function getBurdenChoicePaymentOption(effect, resource) {
  return effect.paymentOptions.find((option) => option.resource === resource) ?? null;
}

function getBurdenChoiceFallbackMode(effect) {
  return effect.type === "arrival_pay_or_timer_choice" ? "timer" : "strain";
}

function getBurdenChoiceTargetId(target) {
  return target.placedTileId ?? target.activeEncounterId;
}

function getBurdenChoiceTargetLabel(target) {
  return target.tileName ?? target.cardName ?? getBurdenChoiceTargetId(target);
}

function createBurdenChoiceDecisionTarget(target) {
  return target.placedTileId
    ? { placedTileId: target.placedTileId }
    : { activeEncounterId: target.activeEncounterId };
}

function normalizeBurdenChoiceDecisions(effect, action) {
  const errors = [];
  const fallbackMode = getBurdenChoiceFallbackMode(effect);

  if (effect.type === "resource_loss_or_strain_choice") {
    const choice = action.choice ?? action.decisions?.[0] ?? {};
    const mode = choice.mode ?? action.mode;
    const resource = choice.resource ?? action.resource;

    if (!["pay", "strain"].includes(mode)) {
      errors.push(`Choose whether to lose resources or place Strain for ${effect.cardName}.`);
    }

    if (mode === "pay" && !getBurdenChoicePaymentOption(effect, resource)) {
      errors.push(`Choose a valid resource to lose for ${effect.cardName}.`);
    }

    return {
      valid: errors.length === 0,
      errors,
      decisions:
        mode === "pay"
          ? [{ mode, resource }]
          : effect.targets.map((target) => ({
              placedTileId: target.placedTileId,
              mode,
              resource: null
            }))
    };
  }

  if (effect.decisionMode === "all_or_strain_all" || effect.decisionMode === "all_or_timer_all") {
    const choice = action.choice ?? action.decisions?.[0] ?? {};
    const mode = choice.mode ?? action.mode;
    const resource = choice.resource ?? action.resource;

    if (!["pay", fallbackMode].includes(mode)) {
      errors.push(`Choose whether to pay or ${fallbackMode === "timer" ? "remove a timer" : "place Strain"} for ${effect.cardName}.`);
    }

    if (mode === "pay" && !getBurdenChoicePaymentOption(effect, resource)) {
      errors.push(`Choose a valid payment resource for ${effect.cardName}.`);
    }

    return {
      valid: errors.length === 0,
      errors,
      decisions: effect.targets.map((target) => ({
        ...createBurdenChoiceDecisionTarget(target),
        mode,
        resource: mode === "pay" ? resource : null
      }))
    };
  }

  const decisionsByTargetId = new Map(
    (action.decisions ?? []).map((decision) => [decision.placedTileId ?? decision.activeEncounterId, decision])
  );
  const decisions = effect.targets.map((target) => {
    const decision = decisionsByTargetId.get(getBurdenChoiceTargetId(target)) ?? {};
    const mode = decision.mode;
    const resource = decision.resource;

    if (!["pay", fallbackMode].includes(mode)) {
      errors.push(`Choose whether to pay or ${fallbackMode === "timer" ? "remove a timer" : "place Strain"} for ${getBurdenChoiceTargetLabel(target)}.`);
    }

    if (mode === "pay" && !getBurdenChoicePaymentOption(effect, resource)) {
      errors.push(`Choose a valid payment resource for ${getBurdenChoiceTargetLabel(target)}.`);
    }

    return {
      ...createBurdenChoiceDecisionTarget(target),
      mode,
      resource: mode === "pay" ? resource : null
    };
  });

  return {
    valid: errors.length === 0,
    errors,
    decisions
  };
}

function getBurdenChoicePayment(effect, decisions) {
  if (effect.decisionMode === "all_or_strain_all" || effect.type === "resource_loss_or_strain_choice") {
    const paymentDecision = decisions.find((decision) => decision.mode === "pay");
    const paymentOption = paymentDecision ? getBurdenChoicePaymentOption(effect, paymentDecision.resource) : null;

    return paymentOption ? [paymentOption] : [];
  }

  return summarizeResourcePayment(
    decisions
      .filter((decision) => decision.mode === "pay")
      .map((decision) => getBurdenChoicePaymentOption(effect, decision.resource))
      .filter(Boolean)
  );
}

function applyBurdenChoiceStrain(state, effect, decisions, context) {
  let workingState = state;
  const applications = [];
  const strainAmount = Number(effect.strainAmount ?? 1);

  for (const decision of decisions) {
    if (decision.mode !== "strain") {
      continue;
    }

    const placedTile = workingState.map.placedTiles.find((tile) => tile.id === decision.placedTileId);
    if (!placedTile) {
      continue;
    }

    const support = getEffectiveSupportDetails(workingState, placedTile.id, context);
    const result = applyStrainToPlacedTile(placedTile, strainAmount, {
      supportDetails: support
    });

    if (!result.valid) {
      continue;
    }

    workingState = {
      ...workingState,
      map: {
        ...workingState.map,
        placedTiles: workingState.map.placedTiles.map((tile) =>
          tile.id === placedTile.id ? result.placedTile : tile
        )
      }
    };

    applications.push({
      placedTileId: placedTile.id,
      tileId: placedTile.tileId,
      tileName: getTileName(context, placedTile.tileId),
      before: placedTile.strain ?? 0,
      after: result.placedTile.strain,
      requestedStrain: strainAmount,
      strainAdded: result.strainAdded,
      strainPrevented: result.strainPrevented,
      blockedByMax: result.blockedByMax,
      becameOverstrained: result.becameOverstrained,
      supportProviders: support.providers,
      reason: "burden_choice"
    });
  }

  return {
    state: workingState,
    applications
  };
}

function applyBurdenChoiceTimers(state, effect, decisions, context) {
  const encounterIndex = context.encounterCards
    ? new Map(context.encounterCards.map((card) => [card.card_id, card]))
    : new Map();
  const timerDecisionsById = new Set(
    decisions.filter((decision) => decision.mode === "timer").map((decision) => decision.activeEncounterId)
  );
  const applications = [];
  const active = state.encounter.active.map((activeState) => {
    if (!timerDecisionsById.has(activeState.id)) {
      return activeState;
    }

    const before = Number(activeState.timerTokens ?? state.rules.arrivalStartTimerTokens ?? 0);
    const after = Math.max(0, before - 1);
    const card = encounterIndex.get(activeState.cardId);
    applications.push({
      activeEncounterId: activeState.id,
      cardId: activeState.cardId,
      cardName: card?.card_name ?? activeState.cardId,
      before,
      after,
      timerTokensRemoved: before - after,
      reason: "burden_choice"
    });

    return {
      ...activeState,
      timerTokens: after
    };
  });

  return {
    state: {
      ...state,
      encounter: {
        ...state.encounter,
        active
      }
    },
    applications
  };
}

function resolveBurdenChoice(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
        errors: ["Burden reveal choices can only be applied during the Player Turns phase."]
      }
    };
  }

  const pending = getPendingBurdenChoice(state, action);
  if (!pending.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
        errors: pending.errors
      }
    };
  }

  const { activeBurden, effect } = pending;
  const decisions = normalizeBurdenChoiceDecisions(effect, action);
  if (!decisions.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
        errors: decisions.errors
      }
    };
  }

  const currentTargetErrors = decisions.decisions.flatMap((decision) => {
    if (decision.mode === "pay") {
      return [];
    }

    if (effect.type === "arrival_pay_or_timer_choice") {
      const target = state.encounter.active.find((activeState) => activeState.id === decision.activeEncounterId);

      if (!target) {
        return [`Unknown active Arrival: ${decision.activeEncounterId}`];
      }

      if (target.encounterType !== ENCOUNTER_TYPES.ARRIVAL || target.completed) {
        return [`${decision.activeEncounterId} is not an active Arrival.`];
      }

      if (decision.mode === "timer" && Number(target.timerTokens ?? state.rules.arrivalStartTimerTokens ?? 0) <= 0) {
        return [`${getEncounterCardName(context, target.cardId)} has no timer token to remove.`];
      }

      return [];
    }

    const target = state.map.placedTiles.find((placedTile) => placedTile.id === decision.placedTileId);

    if (!target) {
      return [`Unknown placed tile: ${decision.placedTileId}`];
    }

    if (decision.mode === "strain" && (target.strain ?? 0) >= STRAIN_MAX_PER_TILE) {
      return [`${getTileName(context, target.tileId)} already has maximum Strain.`];
    }

    return [];
  });

  if (currentTargetErrors.length > 0) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
        errors: currentTargetErrors
      }
    };
  }

  const payment = getBurdenChoicePayment(effect, decisions.decisions);
  const stewardResourceSubstitution = resolveStewardResourceSubstitution(
    state,
    action,
    context,
    payment,
    "burden_choice"
  );

  if (!stewardResourceSubstitution.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
        errors: stewardResourceSubstitution.errors,
        payment
      }
    };
  }

  const finalPayment = stewardResourceSubstitution.cost;

  if (!canAffordCost(state.warehouse, finalPayment)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
        errors: [`${effect.cardName} needs ${describeResourceAmounts(finalPayment)} available in the Warehouse.`],
        payment: finalPayment,
        basePayment: payment,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution
      }
    };
  }

  const paidState = {
    ...state,
    players: markPlayerStewardPowerProviderUsed(
      state.players,
      stewardResourceSubstitution.stewardPower,
      state.season
    ),
    map: {
      ...state.map,
      placedTiles: markStewardPowerProviderUsed(
        state.map.placedTiles,
        stewardResourceSubstitution.stewardPower,
        state.season
      )
    },
    warehouse: spendWarehouseResources(state.warehouse, finalPayment)
  };
  const choiceApplication =
    effect.type === "arrival_pay_or_timer_choice"
      ? applyBurdenChoiceTimers(paidState, effect, decisions.decisions, context)
      : applyBurdenChoiceStrain(paidState, effect, decisions.decisions, context);
  const resolvedEffect = {
    ...effect,
    resolved: true,
    decisions: decisions.decisions,
    payment: finalPayment,
    basePayment: payment,
    stewardResourceSubstitution: stewardResourceSubstitution.substitution,
    applications: choiceApplication.applications,
    strainAdded: choiceApplication.applications.reduce((total, application) => total + (application.strainAdded ?? 0), 0),
    strainPrevented: choiceApplication.applications.reduce(
      (total, application) => total + (application.strainPrevented ?? 0),
      0
    ),
    blockedByMax: choiceApplication.applications.reduce((total, application) => total + (application.blockedByMax ?? 0), 0),
    timerTokensRemoved: choiceApplication.applications.reduce(
      (total, application) => total + (application.timerTokensRemoved ?? 0),
      0
    )
  };
  const paidText = finalPayment.length ? `paid ${describeResourceAmounts(finalPayment)}` : "";
  const strainedNames = choiceApplication.applications
    .filter((application) => application.strainAdded > 0 || application.strainPrevented > 0)
    .map((application) => application.tileName);
  const strainedText = strainedNames.length ? `placed Strain on ${describeList(strainedNames)}` : "";
  const timerNames = choiceApplication.applications
    .filter((application) => application.timerTokensRemoved > 0)
    .map((application) => application.cardName);
  const timerText = timerNames.length ? `removed timer tokens from ${describeList(timerNames)}` : "";
  const summary = [paidText, strainedText, timerText].filter(Boolean).join(" and ") || "made no changes";
  const nextState = {
    ...choiceApplication.state,
    encounter: {
      ...choiceApplication.state.encounter,
      active: choiceApplication.state.encounter.active.map((activeState) => {
        if (activeState.id !== activeBurden.id) {
          return activeState;
        }

        return {
          ...activeState,
          pendingChoice: null,
          applications: (activeState.applications ?? []).map((application, index, applications) =>
            index === applications.length - 1
              ? {
                  ...application,
                  effect: resolvedEffect
                }
              : application
          )
        };
      })
    },
    log: [
      ...choiceApplication.state.log,
      createActionLogEntry(choiceApplication.state, "encounter", `Applied ${effect.cardName}: ${summary}.`, {
        activeEncounterId: activeBurden.id,
        cardId: activeBurden.cardId,
        effect: resolvedEffect,
        payment: finalPayment,
        basePayment: payment,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution,
        decisions: decisions.decisions
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
      message: `Applied ${effect.cardName}: ${summary}.`,
      effect: resolvedEffect,
      payment: finalPayment,
      basePayment: payment,
      stewardResourceSubstitution: stewardResourceSubstitution.substitution,
      decisions: decisions.decisions,
      applications: choiceApplication.applications
    }
  };
}

function placeTile(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: ["Tiles can only be placed during the Player Turns phase."]
      }
    };
  }

  const player = getActivePlayer(state, action.playerId);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: [`Unknown player: ${action.playerId ?? state.activePlayerId}`]
      }
    };
  }

  const pendingOpeningPlacement = getPendingOpeningResourcePlacement(state, player.id);

  if (pendingOpeningPlacement && !isOpeningResourceTileForPlayer(player, action.tileId)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: [
          `${player.name}'s first Round 1 action must be their ${pendingOpeningPlacement.role.name} opening move: ${pendingOpeningPlacement.summary}.`
        ]
      }
    };
  }

  const validation = validatePlaceTile(
    state,
    {
      ...action,
      deferAffordabilityCheck: Boolean(action.stewardResourceSubstitutionPowerId || action.stewardPowerPlacedTileId)
    },
    context
  );

  if (!validation.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: validation.errors
      }
    };
  }

  const pairedStablesPlacement = isStablesPlacementTile(validation.tile);
  const stewardStartingCostReduction = getStewardStartingCostReduction(
    player,
    validation.tile,
    "placement",
    validation.cost,
    action
  );
  const wardenStartingSupport = shouldApplyWardenStartingSupport(player, "placement")
    ? {
        source: "steward_starting_benefit",
        roleId: "warden",
        effect: "first_placed_tile_supported"
      }
    : null;
  const pairedCoordinate = action.pairedCoordinate ?? action.secondCoordinate ?? null;
  const pairedValidation = pairedStablesPlacement && pairedCoordinate
    ? validatePlaceTile(
        state,
        {
          ...action,
          coordinate: pairedCoordinate,
          orientation: action.pairedOrientation ?? action.orientation,
          deferAffordabilityCheck: Boolean(action.stewardResourceSubstitutionPowerId || action.stewardPowerPlacedTileId)
        },
        context
      )
    : null;
  const supplyEntry = getTileSupplyEntry(state, action.tileId);
  const pairedPlacementErrors = [];

  if (pairedStablesPlacement) {
    if (!pairedCoordinate) {
      pairedPlacementErrors.push("Choose a second Stables site; Stables place as two single-hex tiles in one action.");
    } else if (pairedCoordinate === action.coordinate) {
      pairedPlacementErrors.push("The two Stables must be placed on different hexes.");
    }

    if (pairedValidation && !pairedValidation.valid) {
      pairedPlacementErrors.push(...pairedValidation.errors.map((error) => `Second Stables site: ${error}`));
    }

    if (supplyEntry && supplyEntry.available < 2) {
      pairedPlacementErrors.push("Stables need two remaining copies to place as their paired one-action tile.");
    }
  }

  if (pairedPlacementErrors.length > 0) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: pairedPlacementErrors
      }
    };
  }

  const baseActionCost = pairedStablesPlacement
    ? createStablesPairActionCost()
    : calculatePlacementActionCost(state, validation.footprintCoordinates, {
        ...context,
        playerId: player.id,
        ignoreDisconnectedTravel: Boolean(pendingOpeningPlacement),
        ignoreDisconnectedTravelReason: pendingOpeningPlacement ? "opening_placement" : null
      });
  const actionDiscount = getDiscountedTileActionCost(
    state,
    validation.tile,
    "placement",
    baseActionCost
  );
  const travelDiscount = getDiscountedDisconnectedTravelActionCost(
    state,
    "placement",
    actionDiscount.actionCost
  );
  let actionCost = travelDiscount.actionCost;
  const actionCostDiscount = actionDiscount.actionCostDiscount;
  const disconnectedTravelActionDiscount = travelDiscount.actionCostDiscount;
  const stewardPowerProvider = getRequestedPlacementStewardPowerProvider(
    state,
    action,
    context,
    validation.tile,
    actionCost
  );

  if (!stewardPowerProvider.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: stewardPowerProvider.errors
      }
    };
  }

  let stewardPower = createStewardPowerUse(stewardPowerProvider.provider, actionCost, "placement");

  if (stewardPowerProvider.provider?.details.type === STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION) {
    actionCost = allowStewardReachabilityBypass(actionCost, stewardPowerProvider.provider);
    stewardPower = createStewardPowerUse(stewardPowerProvider.provider, actionCost, "placement");
  } else if (stewardPowerProvider.provider?.details.type === STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION) {
    actionCost = {
      ...actionCost,
      originalTotal: actionCost.originalTotal ?? actionCost.total,
      placeActionCost: 0,
      total: Math.max(0, actionCost.total - (actionCost.placeActionCost ?? actionCost.total))
    };
    stewardPower = createStewardPowerUse(stewardPowerProvider.provider, actionCost, "placement");
  }
  const placementCostBeforeStewardPower = stewardStartingCostReduction?.cost ?? validation.cost;
  const stewardPlacementResourceDiscount = getStewardPlacementResourceDiscount(
    stewardPowerProvider.provider,
    validation.tile,
    placementCostBeforeStewardPower
  );
  const placementCostBeforeStewardSubstitution =
    stewardPlacementResourceDiscount?.cost ?? placementCostBeforeStewardPower;
  const stewardResourceSubstitution = resolveStewardResourceSubstitution(
    state,
    action,
    context,
    placementCostBeforeStewardSubstitution,
    "placement"
  );

  if (!stewardResourceSubstitution.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: stewardResourceSubstitution.errors,
        cost: placementCostBeforeStewardSubstitution
      }
    };
  }

  const placementCost = stewardResourceSubstitution.cost;

  if (actionCost.blockedByReachability) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: [getReachabilityBlockError(player, validation.tile.tile_name, "place")],
        actionCost
      }
    };
  }

  if (player.actionsRemaining < actionCost.total) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: [
          `${player.name} needs ${actionCost.total} Action${actionCost.total === 1 ? "" : "s"} to place ${validation.tile.tile_name}, but has ${player.actionsRemaining}.`
        ],
        actionCost
      }
    };
  }

  if (!canAffordCost(state.warehouse, placementCost)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.PLACE_TILE,
        errors: [`${validation.tile.tile_name} costs ${describeResourceAmounts(placementCost)}.`],
        cost: placementCost,
        baseCost: validation.baseCost,
        stewardStartingCostReduction,
        stewardPlacementResourceDiscount,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution
      }
    };
  }

  const placedTile = createPlacedTileRecord(state, action, validation);
  const pairedPlacedTile =
    pairedStablesPlacement && pairedValidation
      ? createPlacedTileRecord(
          state,
          {
            ...action,
            coordinate: pairedCoordinate,
            orientation: action.pairedOrientation ?? action.orientation
          },
          pairedValidation,
          1
        )
      : null;
  const placedTiles = pairedPlacedTile ? [placedTile, pairedPlacedTile] : [placedTile];
  const lastPlacedTile = pairedPlacedTile ?? placedTile;
  const stockSpent = placedTiles.length;
  const actionState = markPlayerOpeningResourcePlacement(
    markPlayerMapInteraction(
      spendPlayerActions(state, player.id, actionCost),
      player.id,
      lastPlacedTile,
      "place"
    ),
    player.id,
    lastPlacedTile
  );
  const placedTilesAfterDiscount = actionState.map.placedTiles.map((existingTile) =>
    existingTile.id === validation.placementCostReduction?.providerPlacedTileId
      ? markPlacementDiscountSeason(existingTile, actionState.season)
      : existingTile
  );
  const placedTilesAfterGoodsSubstitution = placedTilesAfterDiscount.map((existingTile) =>
    existingTile.id === validation.resourceCostSubstitution?.providerPlacedTileId
      ? markGoodsSubstitutionRound(existingTile, actionState.round)
      : existingTile
  );
  const placedTilesAfterStewardPower = markStewardPowerProviderUsed(
    markStewardPowerProviderUsed(
      placedTilesAfterGoodsSubstitution,
      stewardResourceSubstitution.stewardPower,
      actionState.season
    ),
    stewardPower,
    actionState.season
  );
  const playersAfterStewardPower = markPlayerStewardPowerProviderUsed(
    markPlayerStewardPowerProviderUsed(
      markPlayerStartingBenefitUsed(
        actionState.players,
        player.id,
        stewardStartingCostReduction ?? wardenStartingSupport
      ),
      stewardResourceSubstitution.stewardPower,
      actionState.season
    ),
    stewardPower,
    actionState.season
  );
  const encounterAfterPlacementDiscount = applyPlacementCostReductionUse(
    actionState.encounter,
    validation.placementCostReduction
  );
  const encounterAfterActionDiscount = applyActionCostDiscountUse(
    encounterAfterPlacementDiscount,
    actionCostDiscount
  );
  const encounterAfterTravelDiscount = applyActionCostDiscountUse(
    encounterAfterActionDiscount,
    disconnectedTravelActionDiscount
  );
  const placementSupport = applyPlacementSupportEffects(
    {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: placedTilesAfterStewardPower
      }
    },
    placedTiles,
    context
  );
  const placedTilesAfterStartingSupport = wardenStartingSupport
    ? placementSupport.placedTiles.map((candidate) =>
        placedTiles.some((placedTileRecord) => placedTileRecord.id === candidate.id)
          ? setPlacedTileSupported(candidate, true)
          : candidate
      )
    : placementSupport.placedTiles;
  const placementTileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  const knightHousingSupport =
    stewardPower?.providerRoleId === "knight" && validation.tile.tile_category === "Housing"
      ? placedTiles.some((newTile) =>
          getActivationAdjacentPlacedTiles(
            {
              ...actionState,
              map: {
                ...actionState.map,
                placedTiles: placedTilesAfterStartingSupport
              }
            },
            newTile
          ).some((adjacentTile) => placementTileIndex.get(adjacentTile.tileId)?.tile_category === "Housing")
        )
      : false;
  const placedTilesAfterKnightSupport = knightHousingSupport
    ? placedTilesAfterStartingSupport.map((candidate) =>
        placedTiles.some((placedTileRecord) => placedTileRecord.id === candidate.id)
          ? setPlacedTileSupported(candidate, true)
          : candidate
      )
    : placedTilesAfterStartingSupport;
  const nextState = {
    ...actionState,
    players: playersAfterStewardPower,
    map: {
      ...actionState.map,
      placedTiles: placedTilesAfterKnightSupport
    },
    encounter: encounterAfterTravelDiscount,
    tileSupply: updateTileSupply(actionState, action.tileId, (entry) => ({
      ...entry,
      available: entry.available - stockSpent
    })),
    warehouse: spendWarehouseResources(actionState.warehouse, placementCost),
    log: [
      ...actionState.log,
      createActionLogEntry(actionState, "place_tile", `Placed ${validation.tile.tile_name} on ${placedTiles.map((tile) => tile.coordinate).join(" and ")}.`, {
        playerId: player.id,
        tileId: action.tileId,
        coordinate: action.coordinate,
        pairedCoordinate,
        coordinates: validation.footprintCoordinates,
        pairedCoordinates: pairedValidation?.footprintCoordinates ?? null,
        orientation: action.orientation,
        pairedOrientation: pairedPlacedTile?.orientation ?? null,
        actionCost,
        actionCostDiscount,
        disconnectedTravelActionDiscount,
        stewardPower,
        baseCost: validation.baseCost,
        cost: placementCost,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution,
        stewardStartingCostReduction,
        stewardPlacementResourceDiscount,
        wardenStartingSupport,
        knightHousingSupport,
        placementCostReduction: validation.placementCostReduction,
        resourceCostSubstitution: validation.resourceCostSubstitution,
        placementSupportApplications: placementSupport.applications,
        remainingStock: supplyEntry.available - stockSpent
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.PLACE_TILE,
      message: `Placed ${validation.tile.tile_name} on ${placedTiles.map((tile) => tile.coordinate).join(" and ")} for ${actionCost.total} Action${actionCost.total === 1 ? "" : "s"}.`,
      actionCost,
      actionCostDiscount,
      disconnectedTravelActionDiscount,
      stewardPower,
      baseCost: validation.baseCost,
      cost: placementCost,
      stewardResourceSubstitution: stewardResourceSubstitution.substitution,
      stewardStartingCostReduction,
      wardenStartingSupport,
      placementCostReduction: validation.placementCostReduction,
      resourceCostSubstitution: validation.resourceCostSubstitution,
      placedTile,
      placedTiles: placedTilesAfterKnightSupport.filter((candidate) =>
        placedTiles.some((placedTileRecord) => placedTileRecord.id === candidate.id)
      ),
      placementSupportApplications: placementSupport.applications
    }
  };
}

function activateTile(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        errors: ["Tiles can only be activated during the Player Turns phase."]
      }
    };
  }

  const validation = validateActivateTile(state, action, context);
  if (!validation.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        errors: validation.errors
      }
    };
  }

  const player = getActivePlayer(state, action.playerId);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        errors: [`Unknown player: ${action.playerId ?? state.activePlayerId}`]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.ACTIVATE_TILE, player.id);
  if (openingBlock) {
    return openingBlock;
  }

  const baseActionCost = calculatePlacedTileActionCost(
    state,
    validation.placedTile,
    {
      ...context,
      playerId: player.id
    },
    "activationActionCost"
  );
  const actionDiscount = getDiscountedTileActionCost(
    state,
    validation.tile,
    "activation",
    baseActionCost
  );
  const stewardPowerProvider = getRequestedReachabilityStewardPowerProvider(
    state,
    action,
    context,
    actionDiscount.actionCost,
    "activation"
  );

  if (!stewardPowerProvider.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        errors: stewardPowerProvider.errors
      }
    };
  }

  const travelDiscount = getDiscountedDisconnectedTravelActionCost(
    state,
    "activation",
    actionDiscount.actionCost
  );
  const stewardPowerReduction = applyStewardPowerActionReduction(
    travelDiscount.actionCost,
    stewardPowerProvider.provider,
    "activation",
    (currentActionCost) => allowStewardReachabilityBypass(currentActionCost, stewardPowerProvider.provider)
  );
  const actionCost = stewardPowerReduction.actionCost;
  const stewardPower = stewardPowerReduction.stewardPower;
  const actionCostDiscount = actionDiscount.actionCostDiscount;
  const disconnectedTravelActionDiscount = travelDiscount.actionCostDiscount;

  if (actionCost.blockedByReachability) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        errors: [getReachabilityBlockError(player, validation.tile.tile_name, "activate")],
        actionCost
      }
    };
  }

  if (player.actionsRemaining < actionCost.total) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        errors: [
          `${player.name} needs ${actionCost.total} Action${actionCost.total === 1 ? "" : "s"} to activate ${validation.tile.tile_name}, but has ${player.actionsRemaining}.`
        ],
        actionCost
      }
    };
  }

  const interactionState = markPlayerMapInteraction(
    spendPlayerActions(state, player.id, actionCost),
    player.id,
    validation.placedTile,
    "activate"
  );
  const actionState = {
    ...interactionState,
    players: markPlayerStewardPowerProviderUsed(interactionState.players, stewardPower, interactionState.season),
    map: {
      ...interactionState.map,
      placedTiles: markStewardPowerProviderUsed(interactionState.map.placedTiles, stewardPower, interactionState.season)
    },
    encounter: applyActionCostDiscountUse(
      applyActionCostDiscountUse(interactionState.encounter, actionCostDiscount),
      disconnectedTravelActionDiscount
    )
  };

  if (validation.activation.type === "remove_strain_adjacent") {
    const nextTargetsById = new Map(
      validation.strainRemovalTargets.map(({ placedTile, strainRemoved }) => [
        placedTile.id,
        {
          ...placedTile,
          strain: Math.max(0, (placedTile.strain ?? 0) - strainRemoved)
        }
      ])
    );
    const targetTileNames = validation.strainRemovalTargets.map(({ placedTile }) =>
      getTileName(context, placedTile.tileId)
    );
    const message = `Activated ${validation.tile.tile_name} to remove ${validation.strainRemoved} Strain from ${describeList(targetTileNames)}.`;
    const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) => {
      const updatedPlacedTile = nextTargetsById.get(placedTile.id) ?? placedTile;

      return updatedPlacedTile.id === validation.placedTile.id
        ? markActivatedEffectSeason(updatedPlacedTile, validation.activation, actionState.season)
        : updatedPlacedTile;
    });
    const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
    const nextState = {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: nextPlacedTiles
      },
      log: [
        ...actionState.log,
        createActionLogEntry(actionState, "activate_tile", message, {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          targetPlacedTileId: validation.targetPlacedTile?.id,
          targetPlacedTileIds: [...nextTargetsById.keys()],
          actionCost,
          strainRemovalTargets: validation.strainRemovalTargets.map(({ placedTile, strainRemoved }) => ({
            placedTileId: placedTile.id,
            strainRemoved
          })),
          strainRemoved: validation.strainRemoved,
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? []
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        message,
        placedTile: activatedPlacedTile,
        targetPlacedTile: nextTargetsById.get(validation.targetPlacedTile?.id),
        targetPlacedTiles: [...nextTargetsById.values()],
        strainRemovalTargets: validation.strainRemovalTargets,
        strainRemoved: validation.strainRemoved,
        actionCost
      }
    };
  }

  if (
    validation.activation.type === "give_supported_adjacent" ||
    validation.activation.type === "give_supported_travel_network"
  ) {
    const supportTargetsById = new Map(
      validation.supportTargetPlacedTiles.map((target) => [target.id, setPlacedTileSupported(target, true)])
    );
    const targetTileNames = validation.supportTargetPlacedTiles.map((placedTile) =>
      getTileName(context, placedTile.tileId)
    );
    const message = `Activated ${validation.tile.tile_name} to give Supported to ${describeList(targetTileNames)}.`;
    const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) => {
      const updatedPlacedTile = supportTargetsById.get(placedTile.id) ?? placedTile;

      return updatedPlacedTile.id === validation.placedTile.id
        ? markActivatedEffectSeason(updatedPlacedTile, validation.activation, actionState.season)
        : updatedPlacedTile;
    });
    const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
    const nextState = {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: nextPlacedTiles
      },
      log: [
        ...actionState.log,
        createActionLogEntry(actionState, "activate_tile", message, {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          targetPlacedTileId: validation.targetPlacedTile?.id,
          targetPlacedTileIds: [...supportTargetsById.keys()],
          actionCost,
          supportTargetPlacedTileIds: [...supportTargetsById.keys()],
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? []
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        message,
        placedTile: activatedPlacedTile,
        targetPlacedTile: supportTargetsById.get(validation.targetPlacedTile?.id),
        targetPlacedTiles: [...supportTargetsById.values()],
        supportTargetPlacedTiles: [...supportTargetsById.values()],
        actionCost
      }
    };
  }

  if (validation.activation.type === "add_arrival_timer") {
    const currentTimerTokens = Number(
      validation.targetActiveEncounter.timerTokens ?? state.rules.arrivalStartTimerTokens ?? 3
    );
    const nextActiveEncounter = {
      ...validation.targetActiveEncounter,
      timerTokens: currentTimerTokens + validation.timerTokensAdded
    };
    const arrivalName = getEncounterCardName(context, validation.targetActiveEncounter.cardId);
    const tokenLabel = `timer token${validation.timerTokensAdded === 1 ? "" : "s"}`;
    const message = `Activated ${validation.tile.tile_name} to add ${validation.timerTokensAdded} ${tokenLabel} to ${arrivalName}.`;
    const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) =>
      placedTile.id === validation.placedTile.id
        ? markActivatedEffectSeason(placedTile, validation.activation, actionState.season)
        : placedTile
    );
    const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
    const nextState = {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: nextPlacedTiles
      },
      encounter: {
        ...actionState.encounter,
        active: actionState.encounter.active.map((activeEncounter) =>
          activeEncounter.id === nextActiveEncounter.id ? nextActiveEncounter : activeEncounter
        )
      },
      log: [
        ...actionState.log,
        createActionLogEntry(actionState, "activate_tile", message, {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          targetActiveEncounterId: nextActiveEncounter.id,
          actionCost,
          timerTokensAdded: validation.timerTokensAdded,
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? []
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        message,
        placedTile: activatedPlacedTile,
        targetActiveEncounter: nextActiveEncounter,
        timerTokensAdded: validation.timerTokensAdded,
        actionCost
      }
    };
  }

  if (validation.activation.type === "resolve_active_burden") {
    const resolvedBurden = {
      ...validation.targetActiveEncounter,
      resolved: true,
      resolvedRound: actionState.round,
      resolvedSeason: actionState.season,
      resolvedByTileId: validation.placedTile.id
    };
    const burdenName = getEncounterCardName(context, validation.targetActiveEncounter.cardId);
    const message = `Activated ${validation.tile.tile_name} to resolve ${burdenName}.`;
    const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) =>
      placedTile.id === validation.placedTile.id
        ? markActivatedEffectSeason(placedTile, validation.activation, actionState.season)
        : placedTile
    );
    const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
    const prePassiveState = {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: nextPlacedTiles
      }
    };
    const relief = applyBurdenResolutionStrainRelief(prePassiveState, context);
    const nextState = {
      ...relief.state,
      encounter: {
        ...relief.state.encounter,
        active: relief.state.encounter.active.filter(
          (activeEncounter) => activeEncounter.id !== validation.targetActiveEncounter.id
        ),
        discard: [...relief.state.encounter.discard, validation.targetActiveEncounter.cardId],
        completed: [...(relief.state.encounter.completed ?? []), resolvedBurden]
      },
      log: [
        ...relief.state.log,
        createActionLogEntry(actionState, "activate_tile", message, {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          targetActiveEncounterId: validation.targetActiveEncounter.id,
          cardId: validation.targetActiveEncounter.cardId,
          actionCost,
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? [],
          burdenResolutionStrainRelief: relief.relief
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        message,
        placedTile: activatedPlacedTile,
        targetActiveEncounter: validation.targetActiveEncounter,
        resolvedBurden,
        burdenResolutionStrainRelief: relief.relief,
        actionCost
      }
    };
  }

  if (validation.activation.type === "resource_exchange" || validation.activation.type === "flexible_resource_exchange") {
    const warehouseAfterPayment = spendWarehouseResources(actionState.warehouse, validation.exchangeCost);
    const resourceGain = gainWarehouseResources(warehouseAfterPayment, validation.exchangeGains);
    const message = `Activated ${validation.tile.tile_name} to exchange ${describeResourceAmounts(validation.exchangeCost)} for ${describeResourceAmounts(validation.exchangeGains)}.`;
    const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) =>
      placedTile.id === validation.placedTile.id
        ? markActivatedEffectSeason(placedTile, validation.activation, actionState.season)
        : placedTile
    );
    const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
    const nextState = {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: nextPlacedTiles
      },
      warehouse: resourceGain.warehouse,
      log: [
        ...actionState.log,
        createActionLogEntry(actionState, "activate_tile", message, {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          actionCost,
          exchangeCost: validation.exchangeCost,
          exchangeGain: validation.exchangeGain,
          exchangeGains: validation.exchangeGains,
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? [],
          applied: resourceGain.applied
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        message,
        placedTile: activatedPlacedTile,
        exchangeCost: validation.exchangeCost,
        exchangeGain: validation.exchangeGain,
        exchangeGains: validation.exchangeGains,
        applied: resourceGain.applied,
        actionCost
      }
    };
  }

  if (validation.activation.type === "encounter_deck_peek") {
    const { peekedCardIds, orderedCardIds } = validation.encounterDeckPeek;
    const remainingDeck = actionState.encounter.deck.slice(peekedCardIds.length);
    const peekedCardNames = peekedCardIds.map((cardId) => getEncounterCardName(context, cardId));
    const message = `Activated ${validation.tile.tile_name} to look at ${describeList(peekedCardNames)}.`;
    const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) =>
      placedTile.id === validation.placedTile.id
        ? markActivatedEffectSeason(placedTile, validation.activation, actionState.season)
        : placedTile
    );
    const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
    const nextState = {
      ...actionState,
      map: {
        ...actionState.map,
        placedTiles: nextPlacedTiles
      },
      encounter: {
        ...actionState.encounter,
        deck: [...orderedCardIds, ...remainingDeck]
      },
      log: [
        ...actionState.log,
        createActionLogEntry(actionState, "activate_tile", message, {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          actionCost,
          peekedCardIds,
          orderedCardIds,
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? []
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.ACTIVATE_TILE,
        message,
        placedTile: activatedPlacedTile,
        peekedCardIds,
        orderedCardIds,
        peekedCardNames,
        actionCost
      }
    };
  }

  const productionBonus = getProductionBonusDetails(actionState, validation.placedTile.id, context);
  const totalGains = summarizeResourcePayment([...validation.gains, ...productionBonus.gains]);
  const resourceGain = gainWarehouseResources(actionState.warehouse, totalGains);
  const message = `Activated ${validation.tile.tile_name} for ${describeResourceAmounts(resourceGain.applied, "gained")}.`;
  const nextPlacedTiles = actionState.map.placedTiles.map((placedTile) =>
    placedTile.id === validation.placedTile.id
      ? markActivatedEffectSeason(placedTile, validation.activation, actionState.season)
      : placedTile
  );
  const activatedPlacedTile = nextPlacedTiles.find((placedTile) => placedTile.id === validation.placedTile.id);
  const nextState = {
    ...actionState,
    map: {
      ...actionState.map,
      placedTiles: nextPlacedTiles
    },
    encounter: applyRoundEffectUses(actionState.encounter, productionBonus.bonuses),
    warehouse: resourceGain.warehouse,
    log: [
      ...actionState.log,
      createActionLogEntry(
        actionState,
        "activate_tile",
        message,
        {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          tileId: validation.tile.tile_id,
          actionCost,
          gains: validation.gains,
          bonusGains: productionBonus.gains,
          totalGains,
          productionBonuses: productionBonus.bonuses,
          oncePerSeason: validation.activation.oncePerSeason,
          activatedEffectSeasons: activatedPlacedTile?.activatedEffectSeasons ?? [],
          applied: resourceGain.applied
        }
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.ACTIVATE_TILE,
      message,
      placedTile: activatedPlacedTile,
      gains: validation.gains,
      bonusGains: productionBonus.gains,
      totalGains,
      productionBonuses: productionBonus.bonuses,
      applied: resourceGain.applied,
      actionCost
    }
  };
}

function upgradeTile(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: ["Tiles can only be upgraded during the Player Turns phase."]
      }
    };
  }

  const validation = validateUpgradeTile(
    state,
    {
      ...action,
      deferAffordabilityCheck: Boolean(action.stewardResourceSubstitutionPowerId)
    },
    context
  );
  if (!validation.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: validation.errors
      }
    };
  }

  const player = getActivePlayer(state, action.playerId);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: [`Unknown player: ${action.playerId ?? state.activePlayerId}`]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.UPGRADE_TILE, player.id);
  if (openingBlock) {
    return openingBlock;
  }

  const baseActionCost = calculatePlacedTileActionCost(
    state,
    validation.placedTile,
    {
      ...context,
      playerId: player.id
    },
    "upgradeActionCost"
  );
  const actionDiscount = getDiscountedTileActionCost(
    state,
    validation.tile,
    "upgrade",
    baseActionCost
  );
  const travelDiscount = getDiscountedDisconnectedTravelActionCost(
    state,
    "upgrade",
    actionDiscount.actionCost
  );
  let actionCost = travelDiscount.actionCost;
  const actionCostDiscount = actionDiscount.actionCostDiscount;
  const disconnectedTravelActionDiscount = travelDiscount.actionCostDiscount;
  const stewardPowerProvider = getRequestedUpgradeStewardPowerProvider(
    state,
    action,
    context,
    validation.tile,
    actionCost
  );

  if (!stewardPowerProvider.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: stewardPowerProvider.errors
      }
    };
  }

  const stewardPowerReduction = applyStewardPowerActionReduction(
    actionCost,
    stewardPowerProvider.provider,
    "upgrade",
    (currentActionCost) =>
      stewardPowerProvider.provider?.details.type === STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION
        ? allowStewardReachabilityBypass(currentActionCost, stewardPowerProvider.provider)
        : {
            ...currentActionCost,
            originalTotal: currentActionCost.originalTotal ?? currentActionCost.total,
            upgradeActionCost: 0,
            total: Math.max(0, currentActionCost.total - (currentActionCost.upgradeActionCost ?? currentActionCost.total))
          }
  );
  actionCost = stewardPowerReduction.actionCost;
  const stewardPower = stewardPowerReduction.stewardPower;

  if (actionCost.blockedByReachability) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: [getReachabilityBlockError(player, validation.tile.tile_name, "upgrade")],
        actionCost
      }
    };
  }

  if (player.actionsRemaining < actionCost.total) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: [
          `${player.name} needs ${actionCost.total} Action${actionCost.total === 1 ? "" : "s"} to upgrade ${validation.tile.tile_name}, but has ${player.actionsRemaining}.`
        ],
        actionCost
      }
    };
  }

  const stewardStartingCostReduction = getStewardStartingCostReduction(
    player,
    validation.upgradeTile,
    "upgrade",
    validation.cost,
    action
  );
  const upgradeCostBeforeStewardSubstitution = stewardStartingCostReduction?.cost ?? validation.cost;
  const stewardResourceSubstitution = resolveStewardResourceSubstitution(
    state,
    action,
    context,
    upgradeCostBeforeStewardSubstitution,
    "upgrade"
  );

  if (!stewardResourceSubstitution.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.UPGRADE_TILE,
        errors: stewardResourceSubstitution.errors,
        cost: upgradeCostBeforeStewardSubstitution
      }
    };
  }

  const upgradeCost = stewardResourceSubstitution.cost;
  const upgradedPlacedTile = {
    ...validation.placedTile,
    tileId: validation.upgradeTile.tile_id,
    upgradedFromTileId: validation.placedTile.tileId
  };
  const actionState = markPlayerMapInteraction(
    spendPlayerActions(state, player.id, actionCost),
    player.id,
    upgradedPlacedTile,
    "upgrade"
  );
  const encounterAfterUpgradeCostReduction = applyUpgradeCostReductionUse(
    actionState.encounter,
    validation.upgradeCostReduction
  );
  const encounterAfterActionDiscount = applyActionCostDiscountUse(
    encounterAfterUpgradeCostReduction,
    actionCostDiscount
  );
  const encounterAfterTravelDiscount = applyActionCostDiscountUse(
    encounterAfterActionDiscount,
    disconnectedTravelActionDiscount
  );
  const placedTilesAfterUpgrade = actionState.map.placedTiles.map((placedTile) =>
    placedTile.id === action.placedTileId ? upgradedPlacedTile : placedTile
  );
  const placedTilesAfterPassiveUpgradeDiscount = placedTilesAfterUpgrade.map((placedTile) =>
    placedTile.id === validation.upgradeCostReduction?.providerPlacedTileId
      ? markUpgradeDiscountRound(placedTile, actionState.round)
      : placedTile
  );
  const placedTilesAfterGoodsSubstitution = placedTilesAfterPassiveUpgradeDiscount.map((placedTile) =>
    placedTile.id === validation.resourceCostSubstitution?.providerPlacedTileId
      ? markGoodsSubstitutionRound(placedTile, actionState.round)
      : placedTile
  );
  const nextState = {
    ...actionState,
    players: markPlayerStewardPowerProviderUsed(
      markPlayerStewardPowerProviderUsed(
        markPlayerStartingBenefitUsed(actionState.players, player.id, stewardStartingCostReduction),
        stewardResourceSubstitution.stewardPower,
        actionState.season
      ),
      stewardPower,
      actionState.season
    ),
    map: {
      ...actionState.map,
      placedTiles: markStewardPowerProviderUsed(
        markStewardPowerProviderUsed(
          placedTilesAfterGoodsSubstitution,
          stewardResourceSubstitution.stewardPower,
          actionState.season
        ),
        stewardPower,
        actionState.season
      )
    },
    encounter: encounterAfterTravelDiscount,
    warehouse: spendWarehouseResources(actionState.warehouse, upgradeCost),
    log: [
      ...actionState.log,
      createActionLogEntry(
        actionState,
        "upgrade_tile",
        `Upgraded ${validation.tile.tile_name} to ${validation.upgradeTile.tile_name}.`,
        {
          playerId: player.id,
          placedTileId: validation.placedTile.id,
          fromTileId: validation.tile.tile_id,
          toTileId: validation.upgradeTile.tile_id,
          actionCost,
          actionCostDiscount,
          disconnectedTravelActionDiscount,
          stewardPower,
          baseCost: validation.baseCost,
          upgradeCostReduction: validation.upgradeCostReduction,
          resourceCostSubstitution: validation.resourceCostSubstitution,
          stewardStartingCostReduction,
          stewardResourceSubstitution: stewardResourceSubstitution.substitution,
          cost: upgradeCost
        }
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.UPGRADE_TILE,
      message: `Upgraded ${validation.tile.tile_name} to ${validation.upgradeTile.tile_name}.`,
      placedTile: upgradedPlacedTile,
      baseCost: validation.baseCost,
      upgradeCostReduction: validation.upgradeCostReduction,
      resourceCostSubstitution: validation.resourceCostSubstitution,
      stewardStartingCostReduction,
      stewardResourceSubstitution: stewardResourceSubstitution.substitution,
      cost: upgradeCost,
      actionCost,
      actionCostDiscount,
      disconnectedTravelActionDiscount,
      stewardPower
    }
  };
}

function useStewardPower(state, action, context) {
  if ((action.stewardPowerType ?? action.powerType) === STEWARD_POWER_TYPES.STARTING_RESOURCE_EXCHANGE) {
    return useQuartermasterStartingExchange(state, action);
  }

  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        errors: ["Steward Powers can only be used during the Player Turns phase."]
      }
    };
  }

  const player = getActivePlayer(state, action.playerId);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        errors: [`Unknown player: ${action.playerId ?? state.activePlayerId}`]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.USE_STEWARD_POWER, player.id);
  if (openingBlock) {
    return openingBlock;
  }

  if ((action.stewardPowerType ?? action.powerType) === STEWARD_POWER_TYPES.SUPPRESS_BURDEN) {
    const activeBurden = state.encounter.active.find((activeState) => activeState.id === action.activeEncounterId);

    if (!activeBurden) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
          errors: [`Unknown active Encounter: ${action.activeEncounterId}`]
        }
      };
    }

    if (activeBurden.encounterType !== ENCOUNTER_TYPES.BURDEN || activeBurden.resolved) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
          errors: ["Warden can only suppress an unresolved active Burden."]
        }
      };
    }

    const stewardPowerProvider = getRequestedStewardPowerProvider(
      state,
      context,
      action.placedTileId ?? action.stewardPowerPlacedTileId,
      STEWARD_POWER_TYPES.SUPPRESS_BURDEN
    );

    if (!stewardPowerProvider.valid || !stewardPowerProvider.provider) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
          errors: stewardPowerProvider.errors.length
            ? stewardPowerProvider.errors
            : ["Choose an available Warden Steward Power."]
        }
      };
    }

    const encounterIndex = getEncounterIndex(context);
    const cardName = encounterIndex.get(activeBurden.cardId)?.card_name ?? activeBurden.cardId;
    const stewardPower = createStewardPowerUse(
      stewardPowerProvider.provider,
      { total: 0 },
      "burden_suppression"
    );
    const suppression = {
      type: "steward_burden_suppression",
      activeEncounterId: activeBurden.id,
      cardId: activeBurden.cardId,
      cardName,
      round: state.round,
      season: state.season,
      stewardPower
    };
    const nextState = {
      ...state,
      players: markPlayerStewardPowerProviderUsed(state.players, stewardPower, state.season),
      map: {
        ...state.map,
        placedTiles: markStewardPowerProviderUsed(state.map.placedTiles, stewardPower, state.season)
      },
      encounter: {
        ...state.encounter,
        active: state.encounter.active.map((activeState) =>
          activeState.id === activeBurden.id
            ? {
                ...activeState,
                pendingChoice: null,
                suppressedByStewardPower: suppression,
                applications: [...(activeState.applications ?? []), suppression]
              }
            : activeState
        )
      },
      log: [
        ...state.log,
        createActionLogEntry(state, "steward_power", `Warden ignored ${cardName} until the end of this round.`, {
          playerId: player.id,
          activeEncounterId: activeBurden.id,
          cardId: activeBurden.cardId,
          stewardPower,
          suppression
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        message: `Warden ignored ${cardName} until the end of this round.`,
        activeEncounterId: activeBurden.id,
        cardId: activeBurden.cardId,
        stewardPower,
        suppression
      }
    };
  }

  const stewardPowerProvider = getRequestedStewardPowerProvider(
    state,
    context,
    action.placedTileId,
    STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
  );

  if (!stewardPowerProvider.valid || !stewardPowerProvider.provider) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        errors: stewardPowerProvider.errors.length
          ? stewardPowerProvider.errors
          : ["Choose an available Steward Power."]
      }
    };
  }

  const payment = summarizeResourcePayment(action.payment ?? []);
  const gains = summarizeResourcePayment(action.gains ?? []);
  const totalPaid = payment.reduce((total, entry) => total + entry.amount, 0);
  const totalGained = gains.reduce((total, entry) => total + entry.amount, 0);
  const maxAmount = stewardPowerProvider.provider.details.maxAmount;
  const errors = [];

  for (const { resource, amount } of [...payment, ...gains]) {
    if (!state.rules.resources.includes(resource)) {
      errors.push(`${resource} is not a valid Warehouse resource.`);
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      errors.push("Steward Power resource amounts must be positive whole numbers.");
    }
  }

  if (totalPaid < 1 || totalPaid > maxAmount) {
    errors.push(`Choose 1-${maxAmount} resources to exchange.`);
  }

  if (totalGained !== totalPaid) {
    errors.push("Choose the same number of resources to gain as you pay.");
  }

  if (errors.length === 0 && !canAffordCost(state.warehouse, payment)) {
    errors.push(`${stewardPowerProvider.provider.tile.tile_name} needs the chosen resources available in the Warehouse.`);
  }

  if (errors.length > 0) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        errors,
        payment,
        gains
      }
    };
  }

  const warehouseAfterPayment = spendWarehouseResources(state.warehouse, payment);
  const resourceGain = gainWarehouseResources(warehouseAfterPayment, gains);
  const stewardPower = createStewardPowerUse(
    stewardPowerProvider.provider,
    { total: 0 },
    "resource_exchange"
  );
  const nextState = {
    ...state,
    players: markPlayerStewardPowerProviderUsed(state.players, stewardPower, state.season),
    warehouse: resourceGain.warehouse,
    map: {
      ...state.map,
      placedTiles: markStewardPowerProviderUsed(state.map.placedTiles, stewardPower, state.season)
    },
    log: [
      ...state.log,
      createActionLogEntry(state, "steward_power", `Used ${stewardPower.providerTileName}.`, {
        playerId: player.id,
        placedTileId: stewardPower.providerPlacedTileId,
        stewardPower,
        payment,
        gains,
        applied: resourceGain.applied
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.USE_STEWARD_POWER,
      message: `Used ${stewardPower.providerTileName} to exchange ${describeResourceAmounts(payment)} for ${describeResourceAmounts(gains)}.`,
      stewardPower,
      payment,
      gains,
      applied: resourceGain.applied
    }
  };
}

function debugFillWarehouse(state) {
  const nextState = {
    ...state,
    warehouse: fillWarehouse(state.warehouse),
    log: [
      ...state.log,
      createActionLogEntry(state, "debug", "Filled the Warehouse for local placement testing.", {
        cap: state.warehouse.cap
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE,
      message: "Warehouse filled for local placement testing."
    }
  };
}

function debugSetTileStrain(state, action) {
  const strain = Math.max(0, Math.min(STRAIN_MAX_PER_TILE, Number(action.strain ?? 0)));
  const placedTile = state.map.placedTiles.find((tile) => tile.id === action.placedTileId);

  if (!placedTile) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
        errors: [`Unknown placed tile: ${action.placedTileId}`]
      }
    };
  }

  const nextState = {
    ...state,
    map: {
      ...state.map,
      placedTiles: state.map.placedTiles.map((tile) => (tile.id === action.placedTileId ? { ...tile, strain } : tile))
    },
    log: [
      ...state.log,
      createActionLogEntry(state, "debug", `Set ${placedTile.id} Strain to ${strain}.`, {
        placedTileId: placedTile.id,
        strain
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
      message: `Set ${placedTile.id} Strain to ${strain}.`
    }
  };
}

function applyTileStrain(state, action, context) {
  const placedTile = state.map.placedTiles.find((tile) => tile.id === action.placedTileId);
  const support = placedTile
    ? getEffectiveSupportDetails(state, action.placedTileId, context)
    : { supported: false, providers: [] };
  const strain = applyStrainToPlacedTile(placedTile, action.amount ?? 1, {
    ignoreSupported: action.ignoreSupported,
    supportDetails: support
  });

  if (!strain.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.APPLY_STRAIN,
        errors: strain.errors
      }
    };
  }

  const nextState = {
    ...state,
    map: {
      ...state.map,
      placedTiles: state.map.placedTiles.map((tile) =>
        tile.id === action.placedTileId ? strain.placedTile : tile
      )
    },
    log: [
      ...state.log,
      createActionLogEntry(
        state,
        "strain",
        strain.strainPrevented > 0
          ? `${placedTile.id} used Supported and took ${strain.strainAdded} Strain.`
          : `${placedTile.id} took ${strain.strainAdded} Strain.`,
        {
          placedTileId: placedTile.id,
          amount: Number(action.amount ?? 1),
          strainAdded: strain.strainAdded,
          strainPrevented: strain.strainPrevented,
          supportProviders: support.providers,
          blockedByMax: strain.blockedByMax,
          becameOverstrained: strain.becameOverstrained
        }
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.APPLY_STRAIN,
      message:
        strain.strainPrevented > 0
          ? `Supported prevented ${strain.strainPrevented} Strain. ${placedTile.id} took ${strain.strainAdded}.`
          : `${placedTile.id} took ${strain.strainAdded} Strain.`,
      placedTile: strain.placedTile,
      strainAdded: strain.strainAdded,
      strainPrevented: strain.strainPrevented,
      supportProviders: support.providers,
      blockedByMax: strain.blockedByMax,
      becameOverstrained: strain.becameOverstrained
    }
  };
}

function debugSetTileSupported(state, action) {
  const placedTile = state.map.placedTiles.find((tile) => tile.id === action.placedTileId);

  if (!placedTile) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
        errors: [`Unknown placed tile: ${action.placedTileId}`]
      }
    };
  }

  const supported = Boolean(action.supported);
  const nextPlacedTile = setPlacedTileSupported(placedTile, supported);
  const nextState = {
    ...state,
    map: {
      ...state.map,
      placedTiles: state.map.placedTiles.map((tile) => (tile.id === action.placedTileId ? nextPlacedTile : tile))
    },
    log: [
      ...state.log,
      createActionLogEntry(state, "debug", `${supported ? "Marked" : "Cleared"} ${placedTile.id} Supported.`, {
        placedTileId: placedTile.id,
        supported
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
      message: `${placedTile.id} ${supported ? "has Supported" : "no longer has Supported"}.`,
      placedTile: nextPlacedTile
    }
  };
}

function debugSetPlayerMarker(state, action) {
  const player = state.players.find((candidate) => candidate.id === action.playerId);

  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
        errors: [`Unknown player: ${action.playerId}`]
      }
    };
  }

  const placedTileId = action.placedTileId || null;
  const placedTile = placedTileId ? state.map.placedTiles.find((tile) => tile.id === placedTileId) : null;

  if (placedTileId && !placedTile) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
        errors: [`Unknown placed tile: ${placedTileId}`]
      }
    };
  }

  const nextLastInteraction = placedTile
    ? {
        type: "debug",
        placedTileId: placedTile.id,
        coordinate: placedTile.coordinate ?? placedTile.coordinates?.[0] ?? null,
        round: state.round,
        season: state.season
      }
    : null;
  const nextState = {
    ...state,
    players: state.players.map((candidate) =>
      candidate.id === player.id
        ? {
            ...candidate,
            lastInteraction: nextLastInteraction
          }
        : candidate
    ),
    log: [
      ...state.log,
      createActionLogEntry(
        state,
        "debug",
        placedTile ? `Set ${player.name}'s marker to ${placedTile.id}.` : `Cleared ${player.name}'s marker.`,
        {
          playerId: player.id,
          placedTileId: placedTile?.id ?? null
        }
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
      message: placedTile ? `${player.name} marker set to ${placedTile.id}.` : `${player.name} marker cleared.`,
      playerId: player.id,
      placedTileId: placedTile?.id ?? null
    }
  };
}

function debugResetActions(state) {
  const nextState = {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      actionsRemaining: state.rules.actionsPerPlayer
    })),
    log: [...state.log, createActionLogEntry(state, "debug", "Reset player Actions for local testing.")]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS,
      message: "Player Actions reset for local testing."
    }
  };
}

function resetRoundActions(state) {
  return state.players.map((player) => ({
    ...player,
    actionsRemaining: state.rules.actionsPerPlayer
  }));
}

function completeArrival(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: ["Arrivals can only be completed during the Player Turns phase."]
      }
    };
  }

  const player = getActivePlayer(state, action.playerId);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: [`Unknown player: ${action.playerId ?? state.activePlayerId}`]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.COMPLETE_ARRIVAL, player.id);
  if (openingBlock) {
    return openingBlock;
  }

  if (player.actionsRemaining < 1) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: [`${player.name} needs 1 Action to complete an Arrival, but has ${player.actionsRemaining}.`]
      }
    };
  }

  const activeArrival = state.encounter.active.find((activeState) => activeState.id === action.activeEncounterId);
  if (!activeArrival) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: [`Unknown active Encounter: ${action.activeEncounterId}`]
      }
    };
  }

  if (activeArrival.encounterType !== ENCOUNTER_TYPES.ARRIVAL) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: ["Only active Arrivals can be completed."]
      }
    };
  }

  const encounterIndex = context.encounterCards ? new Map(context.encounterCards.map((card) => [card.card_id, card])) : null;
  const arrivalCard = encounterIndex?.get(activeArrival.cardId);
  if (!arrivalCard) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: [`Unknown Arrival card: ${activeArrival.cardId}`]
      }
    };
  }

  const requirement = parseArrivalRequirement(arrivalCard.requirement, state.rules.resources);
  if (!requirement.supported) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: requirement.errors
      }
    };
  }

  const tileRequirementErrors = validateArrivalTileRequirements(state, context, requirement.tileRequirements);
  if (tileRequirementErrors.length > 0) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: tileRequirementErrors
      }
    };
  }

  const discountedRequirement = resolveArrivalRequirementDiscount(state, action, requirement.cost);
  if (!discountedRequirement.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: discountedRequirement.errors
      }
    };
  }

  const stewardResourceSubstitution = resolveStewardResourceSubstitution(
    state,
    action,
    context,
    discountedRequirement.cost,
    "arrival_completion"
  );

  if (!stewardResourceSubstitution.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: stewardResourceSubstitution.errors,
        requirementCost: discountedRequirement.cost,
        baseRequirementCost: requirement.cost,
        arrivalRequirementDiscount: discountedRequirement.discount
      }
    };
  }

  const requirementCost = stewardResourceSubstitution.cost;

  if (!canAffordCost(state.warehouse, requirementCost)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
        errors: [`Arrival requires ${describeResourceAmounts(requirementCost)}.`],
        requirementCost,
        baseRequirementCost: requirement.cost,
        arrivalRequirementDiscount: discountedRequirement.discount
      }
    };
  }

  const completedArrival = {
    ...activeArrival,
    completed: true,
    resolved: true,
    completedRound: state.round,
    baseRequirementCost: requirement.cost,
    requirementCost,
    arrivalRequirementDiscount: discountedRequirement.discount,
    stewardResourceSubstitution: stewardResourceSubstitution.substitution,
    tileRequirements: requirement.tileRequirements
  };
  const unlockedSpecialEntries = state.tileSupply.special.filter(
    (entry) => entry.unlockedByArrival === arrivalCard.card_name
  );
  const actionState = spendPlayerActions(state, player.id, { total: 1 });
  const nextState = {
    ...actionState,
    players: markPlayerStewardPowerProviderUsed(
      actionState.players,
      stewardResourceSubstitution.stewardPower,
      actionState.season
    ),
    map: {
      ...actionState.map,
      placedTiles: markStewardPowerProviderUsed(
        actionState.map.placedTiles,
        stewardResourceSubstitution.stewardPower,
        actionState.season
      )
    },
    encounter: {
      ...actionState.encounter,
      active: actionState.encounter.active.filter((activeState) => activeState.id !== action.activeEncounterId),
      completed: [...(actionState.encounter.completed ?? []), completedArrival],
      discard: discountedRequirement.discount
        ? [...actionState.encounter.discard, discountedRequirement.discount.cardId]
        : actionState.encounter.discard,
      roundEffects: discountedRequirement.discount
        ? (actionState.encounter.roundEffects ?? []).filter(
            (effect) => effect.id !== discountedRequirement.discount.effectId
          )
        : actionState.encounter.roundEffects
    },
    warehouse: spendWarehouseResources(actionState.warehouse, requirementCost),
    tileSupply: {
      ...actionState.tileSupply,
      special: actionState.tileSupply.special.map((entry) =>
        entry.unlockedByArrival === arrivalCard.card_name
          ? {
              ...entry,
              locked: false,
              available: entry.stock
            }
          : entry
      )
    },
    log: [
      ...actionState.log,
      createActionLogEntry(actionState, "encounter", `Completed ${arrivalCard.card_name}.`, {
        playerId: player.id,
        activeEncounterId: activeArrival.id,
        cardId: activeArrival.cardId,
        requirementText: requirement.text,
        baseRequirementCost: requirement.cost,
        requirementCost,
        arrivalRequirementDiscount: discountedRequirement.discount,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution,
        tileRequirements: requirement.tileRequirements,
        unlockedTileIds: unlockedSpecialEntries.map((entry) => entry.tileId)
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
      message: `Completed ${arrivalCard.card_name}${unlockedSpecialEntries.length ? ` and unlocked ${unlockedSpecialEntries.map((entry) => entry.name).join(", ")}` : ""}.`,
      completedArrival,
      baseRequirementCost: requirement.cost,
      requirementCost,
      arrivalRequirementDiscount: discountedRequirement.discount,
      stewardResourceSubstitution: stewardResourceSubstitution.substitution,
      tileRequirements: requirement.tileRequirements,
      unlockedTileIds: unlockedSpecialEntries.map((entry) => entry.tileId)
    }
  };
}

function getEncounterCardIdsInPlay(state) {
  return new Set([
    ...(state.encounter.setup?.selectedStandardPoolIds ?? []),
    ...(state.encounter.setup?.selectedGoldenBoonIds ?? []),
    ...(state.encounter.deck ?? []),
    ...(state.encounter.discard ?? []),
    ...(state.encounter.active ?? []).map((activeState) => activeState.cardId),
    ...(state.encounter.completed ?? []).map((activeState) => activeState.cardId),
    ...(state.players ?? []).flatMap((player) => player.hand ?? [])
  ]);
}

function getStandardEncounterBoxCandidates(state, encounterCards) {
  const cardIdsInPlay = getEncounterCardIdsInPlay(state);

  return encounterCards.filter(
    (card) => card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON && !cardIdsInPlay.has(card.card_id)
  );
}

function getGoldenScrollDiscardSelections(state, action, encounterIndex) {
  const selectionsByPlayer = action.discardSelections ?? {};
  const errors = [];
  const playerSelections = [];

  for (const player of state.players) {
    const rawCardIds = selectionsByPlayer[player.id] ?? [];
    const uniqueCardIds = [...new Set(rawCardIds)];

    if (uniqueCardIds.length !== rawCardIds.length) {
      errors.push(`${player.name} selected the same hand card more than once.`);
    }

    const selectedHandCardIds = [];

    for (const cardId of uniqueCardIds) {
      if (!player.hand.includes(cardId)) {
        errors.push(`${player.name} cannot discard ${cardId}; it is not in their hand.`);
        continue;
      }

      const card = encounterIndex.get(cardId);
      if (!card) {
        errors.push(`Unknown Encounter card: ${cardId}`);
        continue;
      }

      if (card.encounter_type === ENCOUNTER_TYPES.GOLDEN_BOON) {
        errors.push(`${player.name} cannot draw-discard ${card.card_name}; Golden Boons are not standard Encounter Cards.`);
        continue;
      }

      selectedHandCardIds.push(cardId);
    }

    playerSelections.push({
      playerId: player.id,
      discardedCardIds: player.hand.filter((cardId) => selectedHandCardIds.includes(cardId))
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    playerSelections
  };
}

function updatePlayerMarkersForRelocations(players, moves, state) {
  const movesByPlacedTileId = new Map(moves.map((move) => [move.placedTile.id, move]));

  return players.map((player) => {
    const move = movesByPlacedTileId.get(player.lastInteraction?.placedTileId);

    return move
      ? {
          ...player,
          lastInteraction: {
            ...player.lastInteraction,
            coordinate: move.toCoordinate,
            round: state.round,
            season: state.season
          }
        }
      : player;
  });
}

function resolveBoon(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: ["Boon choices can only be resolved during the Player Turns phase."]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.RESOLVE_BOON);
  if (openingBlock) {
    return openingBlock;
  }

  const activeBoon = state.encounter.active.find((activeState) => activeState.id === action.activeEncounterId);
  if (!activeBoon) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: [`Unknown active Encounter: ${action.activeEncounterId}`]
      }
    };
  }

  const effect = activeBoon.effect;
  const supportedOptionalBoonTypes = [
    "optional_resource_strain_relief",
    "optional_resource_exchange",
    "steward_help",
    "golden_scroll_hand_refresh",
    "golden_signet_ring_relocate_tiles"
  ];
  const supportedEncounterType =
    activeBoon.encounterType === ENCOUNTER_TYPES.BOON ||
    activeBoon.encounterType === ENCOUNTER_TYPES.GOLDEN_BOON;

  if (!supportedEncounterType || !supportedOptionalBoonTypes.includes(effect?.type)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: ["Only pending optional Boons can be resolved this way."]
      }
    };
  }

  const activeWithoutBoon = state.encounter.active.filter((activeState) => activeState.id !== activeBoon.id);

  if (action.skip && effect.type === "steward_help") {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: [`${effect.cardName} is not optional.`]
      }
    };
  }

  if (action.skip) {
    const nextState = {
      ...state,
      encounter: {
        ...state.encounter,
        active: activeWithoutBoon,
        discard: [...state.encounter.discard, activeBoon.cardId]
      },
      log: [
        ...state.log,
        createActionLogEntry(state, "encounter", `Skipped ${effect.cardName}.`, {
          activeEncounterId: activeBoon.id,
          cardId: activeBoon.cardId,
          skipped: true
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        message: `Skipped ${effect.cardName}.`,
        skipped: true
      }
    };
  }

  if (effect.type === "golden_signet_ring_relocate_tiles") {
    const relocation = validateRelocatePlacedTiles(state, action, context);

    if (!relocation.valid) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.RESOLVE_BOON,
          errors: relocation.errors
        }
      };
    }

    const movesByPlacedTileId = new Map(relocation.moves.map((move) => [move.placedTile.id, move]));
    const nextState = {
      ...state,
      players: updatePlayerMarkersForRelocations(state.players, relocation.moves, state),
      map: {
        ...state.map,
        placedTiles: state.map.placedTiles.map((placedTile) => {
          const move = movesByPlacedTileId.get(placedTile.id);

          return move
            ? {
                ...placedTile,
                coordinate: move.toCoordinate,
                coordinates: move.toCoordinates,
                orientation: move.orientation
              }
            : placedTile;
        })
      },
      encounter: {
        ...state.encounter,
        active: activeWithoutBoon,
        discard: [...state.encounter.discard, activeBoon.cardId]
      },
      log: [
        ...state.log,
        createActionLogEntry(state, "encounter", `Resolved ${effect.cardName}.`, {
          activeEncounterId: activeBoon.id,
          cardId: activeBoon.cardId,
          moves: relocation.moves.map((move) => ({
            placedTileId: move.placedTile.id,
            tileId: move.placedTile.tileId,
            tileName: move.tile.tile_name,
            fromCoordinate: move.fromCoordinate,
            fromCoordinates: move.fromCoordinates,
            toCoordinate: move.toCoordinate,
            toCoordinates: move.toCoordinates,
            orientation: move.orientation
          }))
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        message: `Resolved ${effect.cardName}; moved ${relocation.moves.length} tile${relocation.moves.length === 1 ? "" : "s"}.`,
        activeEncounterId: activeBoon.id,
        cardId: activeBoon.cardId,
        moves: relocation.moves
      }
    };
  }

  if (effect.type === "golden_scroll_hand_refresh") {
    const encounterIndex = context.encounterCards
      ? new Map(context.encounterCards.map((card) => [card.card_id, card]))
      : null;

    if (!encounterIndex) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.RESOLVE_BOON,
          errors: ["Golden Scroll choices need Encounter card data."]
        }
      };
    }

    const selections = getGoldenScrollDiscardSelections(state, action, encounterIndex);
    if (!selections.valid) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.RESOLVE_BOON,
          errors: selections.errors
        }
      };
    }

    const random = createSeededRandom(`${state.seed}-golden-scroll-${state.round}-${activeBoon.id}`);
    const drawPool = shuffle(getStandardEncounterBoxCandidates(state, context.encounterCards), random).map(
      (card) => card.card_id
    );
    let drawIndex = 0;
    const playerResults = [];
    const players = state.players.map((player) => {
      const playerSelection =
        selections.playerSelections.find((selection) => selection.playerId === player.id) ?? {
          discardedCardIds: []
        };
      const discardSet = new Set(playerSelection.discardedCardIds);
      const drawCount = Math.min(playerSelection.discardedCardIds.length, drawPool.length - drawIndex);
      const drawnCardIds = drawPool.slice(drawIndex, drawIndex + drawCount);
      drawIndex += drawCount;

      playerResults.push({
        playerId: player.id,
        discardedCardIds: playerSelection.discardedCardIds,
        drawnCardIds
      });

      return {
        ...player,
        hand: [...player.hand.filter((cardId) => !discardSet.has(cardId)), ...drawnCardIds]
      };
    });
    const discardedCardIds = playerResults.flatMap((result) => result.discardedCardIds);
    const drawnCardIds = playerResults.flatMap((result) => result.drawnCardIds);
    const nextState = {
      ...state,
      players,
      encounter: {
        ...state.encounter,
        active: activeWithoutBoon,
        discard: [...state.encounter.discard, ...discardedCardIds, activeBoon.cardId]
      },
      log: [
        ...state.log,
        createActionLogEntry(state, "encounter", `Resolved ${effect.cardName}.`, {
          activeEncounterId: activeBoon.id,
          cardId: activeBoon.cardId,
          playerResults,
          discardedCardIds,
          drawnCardIds,
          availableDraws: drawPool.length
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        message: `Resolved ${effect.cardName}; discarded ${discardedCardIds.length} hand card${discardedCardIds.length === 1 ? "" : "s"} and drew ${drawnCardIds.length}.`,
        activeEncounterId: activeBoon.id,
        cardId: activeBoon.cardId,
        playerResults,
        discardedCardIds,
        drawnCardIds,
        availableDraws: drawPool.length
      }
    };
  }

  if (effect.type === "steward_help") {
    const gains = summarizeResourcePayment(action.gains ?? []);
    const totalGained = gains.reduce((total, entry) => total + entry.amount, 0);
    const errors = [];

    for (const { resource, amount } of gains) {
      if (!state.rules.resources.includes(resource)) {
        errors.push(`${resource} is not a valid Warehouse resource.`);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Boon gain amounts must be positive whole numbers.");
      }
    }

    if (totalGained !== effect.resourceGainAmount) {
      errors.push(`Choose exactly ${effect.resourceGainAmount} resource${effect.resourceGainAmount === 1 ? "" : "s"} to gain.`);
    }

    if (errors.length > 0) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.RESOLVE_BOON,
          errors,
          gains
        }
      };
    }

    const reliefState = applyStrainReliefEffect(state, effect);
    const resourceGain = gainWarehouseResources(reliefState.warehouse, gains);
    const nextState = {
      ...reliefState,
      warehouse: resourceGain.warehouse,
      encounter: {
        ...reliefState.encounter,
        active: activeWithoutBoon,
        discard: [...reliefState.encounter.discard, activeBoon.cardId]
      },
      log: [
        ...reliefState.log,
        createActionLogEntry(state, "encounter", `Resolved ${effect.cardName}.`, {
          activeEncounterId: activeBoon.id,
          cardId: activeBoon.cardId,
          gains,
          applied: resourceGain.applied,
          applications: effect.applications,
          strainRemoved: effect.strainRemoved
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        message: `Resolved ${effect.cardName}, removed ${effect.strainRemoved} Strain and gained ${describeResourceAmounts(resourceGain.applied, "gained")}.`,
        activeEncounterId: activeBoon.id,
        cardId: activeBoon.cardId,
        gains,
        applied: resourceGain.applied,
        applications: effect.applications,
        strainRemoved: effect.strainRemoved
      }
    };
  }

  if (effect.type === "optional_resource_exchange") {
    const payment = summarizeResourcePayment(action.payment ?? []);
    const gains = summarizeResourcePayment(action.gains ?? []);
    const totalPaid = payment.reduce((total, entry) => total + entry.amount, 0);
    const totalGained = gains.reduce((total, entry) => total + entry.amount, 0);
    const errors = [];

    for (const { resource, amount } of payment) {
      if (!state.rules.resources.includes(resource)) {
        errors.push(`${resource} is not a valid Warehouse resource.`);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Exchange payment amounts must be positive whole numbers.");
      }
    }

    for (const { resource, amount } of gains) {
      if (!state.rules.resources.includes(resource)) {
        errors.push(`${resource} is not a valid exchange gain resource.`);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Exchange gain amounts must be positive whole numbers.");
      }
    }

    if (totalPaid < 1 || totalPaid > effect.maxAmount) {
      errors.push(`Choose 1-${effect.maxAmount} resources to exchange.`);
    }

    if (totalGained !== totalPaid) {
      errors.push("Choose the same number of resources to gain as you pay.");
    }

    if (errors.length === 0 && !canAffordCost(state.warehouse, payment)) {
      errors.push(`${effect.cardName} needs the chosen resources available in the Warehouse.`);
    }

    if (errors.length === 0) {
      const warehouseAfterPayment = spendWarehouseResources(state.warehouse, payment);

      for (const { resource, amount } of gains) {
        const availableGainSpace = state.warehouse.cap - (warehouseAfterPayment.resources[resource] ?? 0);

        if (availableGainSpace < amount) {
          errors.push(`${resource} does not have enough Warehouse space.`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        state,
        result: {
          ok: false,
          action: TILE_ACTION_TYPES.RESOLVE_BOON,
          errors,
          payment,
          gains
        }
      };
    }

    const warehouseAfterPayment = spendWarehouseResources(state.warehouse, payment);
    const resourceGain = gainWarehouseResources(warehouseAfterPayment, gains);
    const nextState = {
      ...state,
      warehouse: resourceGain.warehouse,
      encounter: {
        ...state.encounter,
        active: activeWithoutBoon,
        discard: [...state.encounter.discard, activeBoon.cardId]
      },
      log: [
        ...state.log,
        createActionLogEntry(state, "encounter", `Resolved ${effect.cardName}.`, {
          activeEncounterId: activeBoon.id,
          cardId: activeBoon.cardId,
          payment,
          gains,
          applied: resourceGain.applied
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        message: `Resolved ${effect.cardName} and exchanged ${describeResourceAmounts(payment)} for ${describeResourceAmounts(gains)}.`,
        activeEncounterId: activeBoon.id,
        cardId: activeBoon.cardId,
        payment,
        gains,
        applied: resourceGain.applied
      }
    };
  }

  const relief = getOptionalBoonStrainReliefApplications(
    state,
    effect,
    action.targetPlacedTileIds,
    context
  );

  if (!relief.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: relief.errors
      }
    };
  }

  const stewardResourceSubstitution = resolveStewardResourceSubstitution(
    state,
    action,
    context,
    effect.cost,
    "boon_resolution"
  );

  if (!stewardResourceSubstitution.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: stewardResourceSubstitution.errors,
        cost: effect.cost
      }
    };
  }

  const boonCost = stewardResourceSubstitution.cost;

  if (!canAffordCost(state.warehouse, boonCost)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BOON,
        errors: [`${effect.cardName} costs ${describeResourceAmounts(boonCost)}.`],
        cost: boonCost,
        baseCost: effect.cost,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution
      }
    };
  }

  const reliefEffect = {
    ...effect,
    applications: relief.applications,
    strainRemoved: relief.strainRemoved
  };
  const reliefState = applyStrainReliefEffect(state, reliefEffect);
  const nextState = {
    ...reliefState,
    players: markPlayerStewardPowerProviderUsed(
      reliefState.players,
      stewardResourceSubstitution.stewardPower,
      reliefState.season
    ),
    map: {
      ...reliefState.map,
      placedTiles: markStewardPowerProviderUsed(
        reliefState.map.placedTiles,
        stewardResourceSubstitution.stewardPower,
        reliefState.season
      )
    },
    encounter: {
      ...reliefState.encounter,
      active: activeWithoutBoon,
      discard: [...reliefState.encounter.discard, activeBoon.cardId]
    },
    warehouse: spendWarehouseResources(reliefState.warehouse, boonCost),
    log: [
      ...reliefState.log,
      createActionLogEntry(state, "encounter", `Resolved ${effect.cardName}.`, {
        activeEncounterId: activeBoon.id,
        cardId: activeBoon.cardId,
        baseCost: effect.cost,
        cost: boonCost,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution,
        applications: relief.applications,
        strainRemoved: relief.strainRemoved
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.RESOLVE_BOON,
      message: `Resolved ${effect.cardName} and removed ${relief.strainRemoved} Strain.`,
      activeEncounterId: activeBoon.id,
      cardId: activeBoon.cardId,
      baseCost: effect.cost,
      cost: boonCost,
      stewardResourceSubstitution: stewardResourceSubstitution.substitution,
      applications: relief.applications,
      strainRemoved: relief.strainRemoved
    }
  };
}

function resolveBurden(state, action, context) {
  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: ["Burdens can only be resolved during the Player Turns phase."]
      }
    };
  }

  const activeBurden = state.encounter.active.find((activeState) => activeState.id === action.activeEncounterId);
  if (!activeBurden) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: [`Unknown active Encounter: ${action.activeEncounterId}`]
      }
    };
  }

  if (activeBurden.encounterType !== ENCOUNTER_TYPES.BURDEN || activeBurden.resolved) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: ["Only unresolved active Burdens can be resolved."]
      }
    };
  }

  const encounterIndex = context.encounterCards ? new Map(context.encounterCards.map((card) => [card.card_id, card])) : null;
  const burdenCard = encounterIndex?.get(activeBurden.cardId);
  if (!burdenCard) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: [`Unknown Burden card: ${activeBurden.cardId}`]
      }
    };
  }

  const resolution = getBurdenResolutionCost(burdenCard, state.season);
  if (!resolution.supported) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: resolution.errors
      }
    };
  }
  const paymentCost = resolveBurdenPaymentCost(resolution, action, state);
  if (!paymentCost.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: paymentCost.errors
      }
    };
  }
  const discountedPayment = resolveBurdenResolutionDiscount(state, action, paymentCost.cost);
  if (!discountedPayment.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: discountedPayment.errors
      }
    };
  }

  const player = getActivePlayer(state, action.playerId);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: [`Unknown player: ${action.playerId ?? state.activePlayerId}`]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.RESOLVE_BURDEN, player.id);
  if (openingBlock) {
    return openingBlock;
  }

  const stewardPowerProvider = getRequestedStewardPowerProvider(
    state,
    context,
    action.stewardPowerPlacedTileId,
    STEWARD_POWER_TYPES.FREE_BURDEN_RESOLUTION_ACTION
  );

  if (!stewardPowerProvider.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: stewardPowerProvider.errors
      }
    };
  }

  const actionCost = stewardPowerProvider.provider
    ? {
        total: 0,
        originalTotal: resolution.actionCost
      }
    : { total: resolution.actionCost };
  const stewardPower = createStewardPowerUse(stewardPowerProvider.provider, actionCost, "burden_resolution");

  if (player.actionsRemaining < actionCost.total) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: [
          `${player.name} needs ${actionCost.total} Action to resolve ${burdenCard.card_name}, but has ${player.actionsRemaining}.`
        ]
      }
    };
  }

  const stewardResourceSubstitution = resolveStewardResourceSubstitution(
    state,
    action,
    context,
    discountedPayment.cost,
    "burden_resolution"
  );

  if (!stewardResourceSubstitution.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: stewardResourceSubstitution.errors,
        baseCost: paymentCost.cost,
        cost: discountedPayment.cost,
        burdenResolutionDiscount: discountedPayment.discount
      }
    };
  }

  const burdenResolutionCost = stewardResourceSubstitution.cost;

  if (!canAffordCost(state.warehouse, burdenResolutionCost)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
        errors: [`${burdenCard.card_name} resolution costs ${describeResourceAmounts(burdenResolutionCost)}.`],
        baseCost: paymentCost.cost,
        cost: burdenResolutionCost,
        burdenResolutionDiscount: discountedPayment.discount
      }
    };
  }

  const resolvedBurden = {
    ...activeBurden,
    resolved: true,
    resolvedRound: state.round,
    resolvedSeason: state.season,
    baseResolutionCost: paymentCost.cost,
    resolutionCost: burdenResolutionCost,
    burdenResolutionDiscount: discountedPayment.discount,
    stewardResourceSubstitution: stewardResourceSubstitution.substitution,
    stewardPower
  };
  const actionState = spendPlayerActions(state, player.id, actionCost);
  const relief = applyBurdenResolutionStrainRelief(actionState, context);
  const nextState = {
    ...relief.state,
    players: markPlayerStewardPowerProviderUsed(
      markPlayerStewardPowerProviderUsed(
        relief.state.players,
        stewardResourceSubstitution.stewardPower,
        relief.state.season
      ),
      stewardPower,
      relief.state.season
    ),
    map: {
      ...relief.state.map,
      placedTiles: markStewardPowerProviderUsed(
        markStewardPowerProviderUsed(
          relief.state.map.placedTiles,
          stewardResourceSubstitution.stewardPower,
          relief.state.season
        ),
        stewardPower,
        relief.state.season
      )
    },
    warehouse: spendWarehouseResources(relief.state.warehouse, burdenResolutionCost),
    encounter: {
      ...relief.state.encounter,
      active: relief.state.encounter.active.filter((activeState) => activeState.id !== activeBurden.id),
      discard: [
        ...relief.state.encounter.discard,
        activeBurden.cardId,
        ...(discountedPayment.discount ? [discountedPayment.discount.cardId] : [])
      ],
      completed: [...(relief.state.encounter.completed ?? []), resolvedBurden],
      roundEffects: discountedPayment.discount
        ? (relief.state.encounter.roundEffects ?? []).filter(
            (effect) => effect.id !== discountedPayment.discount.effectId
          )
        : relief.state.encounter.roundEffects
    },
    log: [
      ...relief.state.log,
      createActionLogEntry(actionState, "encounter", `Resolved ${burdenCard.card_name}.`, {
        playerId: player.id,
        activeEncounterId: activeBurden.id,
        cardId: activeBurden.cardId,
        baseCost: paymentCost.cost,
        cost: burdenResolutionCost,
        burdenResolutionDiscount: discountedPayment.discount,
        stewardResourceSubstitution: stewardResourceSubstitution.substitution,
        actionCost,
        stewardPower,
        burdenResolutionStrainRelief: relief.relief
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.RESOLVE_BURDEN,
      message: `Resolved ${burdenCard.card_name}.`,
      resolvedBurden,
      baseCost: paymentCost.cost,
      cost: burdenResolutionCost,
      burdenResolutionDiscount: discountedPayment.discount,
      stewardResourceSubstitution: stewardResourceSubstitution.substitution,
      burdenResolutionStrainRelief: relief.relief,
      actionCost,
      stewardPower
    }
  };
}

function endTurn(state) {
  if (state.phase === GAME_PHASES.COMPLETE) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.END_TURN,
        errors: ["The game is already complete."]
      }
    };
  }

  if (state.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.END_TURN,
        errors: ["Turns can only be ended during the Player Turns phase."]
      }
    };
  }

  const player = getActivePlayer(state);
  if (!player) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.END_TURN,
        errors: [`Unknown active player: ${state.activePlayerId}`]
      }
    };
  }

  const openingBlock = blockForPendingOpeningPlacement(state, TILE_ACTION_TYPES.END_TURN, player.id);
  if (openingBlock) {
    return openingBlock;
  }

  const activePlayerIndex = state.players.findIndex((candidate) => candidate.id === player.id);
  const passedActions = player.actionsRemaining;
  const playersAfterPass = state.players.map((candidate) =>
    candidate.id === player.id ? { ...candidate, actionsRemaining: 0 } : candidate
  );
  const nextPlayer = state.players[activePlayerIndex + 1];

  if (nextPlayer) {
    const nextState = {
      ...state,
      activePlayerId: nextPlayer.id,
      players: playersAfterPass,
      log: [
        ...state.log,
        createActionLogEntry(state, "turn", `${player.name} ended their turn. ${nextPlayer.name} is active.`, {
          playerId: player.id,
          nextPlayerId: nextPlayer.id,
          passedActions
        })
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.END_TURN,
        message: `${player.name} ended their turn. ${nextPlayer.name} is active.`,
        advancedRound: false
      }
    };
  }

  const extraPlayerTurnsEffect = getPendingExtraPlayerTurnsEffect(state);
  if (extraPlayerTurnsEffect) {
    const playersAfterReset = resetRoundActions({
      ...state,
      players: playersAfterPass
    });
    const nextState = {
      ...state,
      phase: GAME_PHASES.PLAYER_TURNS,
      activePlayerId: playersAfterReset[0]?.id ?? null,
      players: playersAfterReset,
      encounter: markRoundEffectUsed(state.encounter, extraPlayerTurnsEffect.id),
      log: [
        ...state.log,
        createActionLogEntry(
          state,
          "turn",
          `${player.name} ended their turn. ${extraPlayerTurnsEffect.cardName} opens one additional Player Turns phase.`,
          {
            playerId: player.id,
            passedActions,
            cardId: extraPlayerTurnsEffect.cardId,
            roundEffectId: extraPlayerTurnsEffect.id,
            extraPlayerTurnsRound: state.round
          }
        )
      ]
    };

    return {
      state: nextState,
      result: {
        ok: true,
        action: TILE_ACTION_TYPES.END_TURN,
        message: `${extraPlayerTurnsEffect.cardName} opens one additional Player Turns phase.`,
        advancedRound: false,
        readyForEndRound: false,
        extraPlayerTurns: true,
        roundEffect: extraPlayerTurnsEffect
      }
    };
  }

  const nextState = {
    ...state,
    phase: GAME_PHASES.END_ROUND,
    activePlayerId: null,
    players: playersAfterPass,
    log: [
      ...state.log,
      createActionLogEntry(
        state,
        "turn",
        `${player.name} ended their turn. Round ${state.round} is ready for end-of-round effects.`,
        {
          playerId: player.id,
          passedActions,
          completedPlayerTurnsRound: state.round
        }
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.END_TURN,
      message: `${player.name} ended their turn. Resolve end-of-round effects next.`,
      advancedRound: false,
      readyForEndRound: true
    }
  };
}

function resolveEndRoundEncounters(state) {
  const active = [];
  const expiredArrivals = [];
  let timersRemoved = 0;

  for (const activeState of state.encounter.active) {
    if (activeState.encounterType !== ENCOUNTER_TYPES.ARRIVAL || activeState.completed) {
      active.push(activeState);
      continue;
    }

    const currentTimerTokens = Number(activeState.timerTokens ?? state.rules.arrivalStartTimerTokens);
    const timerTokens = Math.max(0, currentTimerTokens - 1);
    timersRemoved += currentTimerTokens === timerTokens ? 0 : 1;

    if (timerTokens === 0) {
      expiredArrivals.push({
        ...activeState,
        timerTokens,
        expiredRound: state.round
      });
      continue;
    }

    active.push({
      ...activeState,
      timerTokens
    });
  }

  return {
    active,
    expiredArrivals,
    timersRemoved,
    discard: [...state.encounter.discard, ...expiredArrivals.map((arrival) => arrival.cardId)]
  };
}

function clearRoundStewardSuppression(activeStates) {
  return activeStates.map((activeState) => {
    if (!activeState.suppressedByStewardPower) {
      return activeState;
    }

    const { suppressedByStewardPower, ...rest } = activeState;
    return rest;
  });
}

function applyExpiredArrivalStrain(state, expiredArrivals, context) {
  if (!expiredArrivals.length) {
    return {
      state,
      applications: []
    };
  }

  let workingState = state;
  const applications = [];

  for (const arrival of expiredArrivals) {
    const target = sortPlacedTilesById(workingState.map.placedTiles)
      .filter((placedTile) => (placedTile.strain ?? 0) < STRAIN_MAX_PER_TILE)
      .sort((left, right) => {
        const strainDifference = (left.strain ?? 0) - (right.strain ?? 0);
        if (strainDifference !== 0) {
          return strainDifference;
        }

        return Number(left.id.replace(/\D+/g, "")) - Number(right.id.replace(/\D+/g, ""));
      })[0];

    if (!target) {
      applications.push({
        activeEncounterId: arrival.id,
        cardId: arrival.cardId,
        cardName: getEncounterCardName(context, arrival.cardId),
        requestedStrain: 1,
        strainAdded: 0,
        strainPrevented: 0,
        blockedByMax: 0,
        noValidTarget: true,
        reason: "arrival_expired"
      });
      continue;
    }

    const support = getEffectiveSupportDetails(workingState, target.id, context);
    const result = applyStrainToPlacedTile(target, 1, {
      supportDetails: support
    });

    if (!result.valid) {
      applications.push({
        activeEncounterId: arrival.id,
        cardId: arrival.cardId,
        cardName: getEncounterCardName(context, arrival.cardId),
        targetPlacedTileId: target.id,
        targetTileId: target.tileId,
        requestedStrain: 1,
        strainAdded: 0,
        strainPrevented: 0,
        blockedByMax: 1,
        noValidTarget: false,
        reason: "arrival_expired",
        errors: result.errors
      });
      continue;
    }

    workingState = {
      ...workingState,
      map: {
        ...workingState.map,
        placedTiles: workingState.map.placedTiles.map((placedTile) =>
          placedTile.id === target.id ? result.placedTile : placedTile
        )
      }
    };
    applications.push({
      activeEncounterId: arrival.id,
      cardId: arrival.cardId,
      cardName: getEncounterCardName(context, arrival.cardId),
      targetPlacedTileId: target.id,
      targetTileId: target.tileId,
      targetTileName: getTileName(context, target.tileId),
      before: target.strain ?? 0,
      after: result.placedTile.strain,
      requestedStrain: 1,
      strainAdded: result.strainAdded,
      strainPrevented: result.strainPrevented,
      blockedByMax: result.blockedByMax,
      becameOverstrained: result.becameOverstrained,
      supportProviders: support.providers,
      noValidTarget: false,
      reason: "arrival_expired"
    });
  }

  return {
    state: workingState,
    applications
  };
}

function getEncounterIndex(context) {
  return context.encounterCards ? new Map(context.encounterCards.map((card) => [card.card_id, card])) : new Map();
}

function isSeasonStartReapplicationRound(round) {
  return round === 5 || round === 9;
}

function reapplySeasonStartBurdens(state, activeStates, nextRound, nextSeason, context) {
  let workingState = {
    ...state,
    round: nextRound,
    season: nextSeason,
    map: {
      ...state.map,
      placedTiles: state.map.placedTiles.map(resetRoundSupportUsage)
    },
    encounter: {
      ...state.encounter,
      active: activeStates
    }
  };

  if (!isSeasonStartReapplicationRound(nextRound)) {
    return {
      active: activeStates,
      map: workingState.map,
      warehouse: workingState.warehouse,
      reappliedBurdens: []
    };
  }

  const encounterIndex = getEncounterIndex(context);
  const reappliedBurdens = [];
  const active = [];

  for (const activeState of activeStates) {
    if (
      activeState.encounterType !== ENCOUNTER_TYPES.BURDEN ||
      activeState.resolved ||
      activeState.appliedSeasons?.includes(nextSeason)
    ) {
      active.push(activeState);
      continue;
    }

    const card = encounterIndex.get(activeState.cardId);
    const burdenEffect = resolveBurdenSeasonEffect(workingState, card, "season_start", context);
    workingState = burdenEffect.state;
    const choiceType = burdenEffect.application.effect?.type;
    const pendingChoice =
      ["pay_or_strain_choice", "arrival_pay_or_timer_choice", "resource_loss_or_strain_choice"].includes(choiceType) &&
      (burdenEffect.application.effect.targets.length > 0 ||
        (choiceType === "resource_loss_or_strain_choice" && burdenEffect.application.effect.paymentOptions.length > 0))
        ? burdenEffect.application.effect
        : null;

    const nextActiveState = {
      ...activeState,
      appliedSeasons: [...(activeState.appliedSeasons ?? []), nextSeason],
      applications: [...(activeState.applications ?? []), burdenEffect.application],
      pendingChoice
    };
    active.push(nextActiveState);
    workingState = {
      ...workingState,
      encounter: {
        ...workingState.encounter,
        active
      }
    };

    reappliedBurdens.push({
      activeEncounterId: activeState.id,
      cardId: activeState.cardId,
      cardName: card?.card_name ?? activeState.cardId,
      round: nextRound,
      season: nextSeason,
      effectText: burdenEffect.application.effectText,
      effect: burdenEffect.effect
    });
  }

  return {
    active,
    map: workingState.map,
    warehouse: workingState.warehouse,
    reappliedBurdens
  };
}

function sortPlacedTilesById(placedTiles) {
  return [...placedTiles].sort((left, right) => {
    const leftNumber = Number(left.id.replace(/\D+/g, ""));
    const rightNumber = Number(right.id.replace(/\D+/g, ""));
    return leftNumber - rightNumber;
  });
}

function getAdjacentPlacedTileCandidates(state, placedTile) {
  const mapIndex = createMapIndex(state.map.hexes);
  const ownCoordinates = new Set(getPlacedTileCoordinates(placedTile));
  const placedByCoordinate = new Map(
    state.map.placedTiles.flatMap((tile) => getPlacedTileCoordinates(tile).map((coordinate) => [coordinate, tile]))
  );
  const adjacentIds = new Set();

  for (const coordinate of ownCoordinates) {
    for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
      if (ownCoordinates.has(neighborCoordinate)) {
        continue;
      }

      const candidate = placedByCoordinate.get(neighborCoordinate);
      if (candidate && candidate.id !== placedTile.id) {
        adjacentIds.add(candidate.id);
      }
    }
  }

  return sortPlacedTilesById(state.map.placedTiles.filter((tile) => adjacentIds.has(tile.id)));
}

function applyEndOfSeasonOverstrainedSpread(state, context) {
  if (![state.rules.roundsPerSeason, state.rules.roundsPerSeason * 2].includes(state.round)) {
    return {
      state,
      effect: null
    };
  }

  let workingState = state;
  const applications = [];

  for (const sourceTile of sortPlacedTilesById(state.map.placedTiles.filter(isOverstrainedPlacedTile))) {
    const currentSource = workingState.map.placedTiles.find((tile) => tile.id === sourceTile.id);
    const target = getAdjacentPlacedTileCandidates(workingState, currentSource).find(
      (candidate) => (candidate.strain ?? 0) < STRAIN_MAX_PER_TILE
    );

    if (!target) {
      applications.push({
        sourcePlacedTileId: sourceTile.id,
        requestedStrain: 1,
        strainAdded: 0,
        strainPrevented: 0,
        blockedByMax: 0,
        noValidTarget: true
      });
      continue;
    }

    const support = getEffectiveSupportDetails(workingState, target.id, context);
    const result = applyStrainToPlacedTile(target, 1, {
      supportDetails: support
    });

    if (!result.valid) {
      applications.push({
        sourcePlacedTileId: sourceTile.id,
        targetPlacedTileId: target.id,
        requestedStrain: 1,
        strainAdded: 0,
        strainPrevented: 0,
        blockedByMax: 1,
        noValidTarget: false,
        errors: result.errors
      });
      continue;
    }

    workingState = {
      ...workingState,
      map: {
        ...workingState.map,
        placedTiles: workingState.map.placedTiles.map((tile) =>
          tile.id === target.id ? result.placedTile : tile
        )
      }
    };
    applications.push({
      sourcePlacedTileId: sourceTile.id,
      targetPlacedTileId: target.id,
      targetTileId: target.tileId,
      before: target.strain ?? 0,
      after: result.placedTile.strain,
      requestedStrain: 1,
      strainAdded: result.strainAdded,
      strainPrevented: result.strainPrevented,
      blockedByMax: result.blockedByMax,
      becameOverstrained: result.becameOverstrained,
      supportProviders: support.providers,
      noValidTarget: false
    });
  }

  return {
    state: workingState,
    effect: {
      type: "end_season_overstrained_spread",
      season: state.season,
      round: state.round,
      applications,
      strainAdded: applications.reduce((total, application) => total + application.strainAdded, 0),
      strainPrevented: applications.reduce((total, application) => total + application.strainPrevented, 0),
      blockedByMax: applications.reduce((total, application) => total + application.blockedByMax, 0),
      noValidTargetApplications: applications.filter((application) => application.noValidTarget).length
    }
  };
}

function applyEndOfSeasonEffects(state, context) {
  const spread = applyEndOfSeasonOverstrainedSpread(state, context);

  return {
    state: spread.state,
    effects: [spread.effect].filter(Boolean)
  };
}

function endRound(state, context) {
  if (state.phase === GAME_PHASES.COMPLETE) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.END_ROUND,
        errors: ["The game is already complete."]
      }
    };
  }

  if (state.phase !== GAME_PHASES.END_ROUND) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.END_ROUND,
        errors: ["End-of-round effects can only be resolved during the End of Round phase."]
      }
    };
  }

  const arrivalTimerEffects = applyPersistentArrivalTimerRoundEffects(
    state,
    state.encounter.active,
    state.encounter.roundEffects ?? []
  );
  const stateAfterArrivalTimerEffects = {
    ...state,
    encounter: {
      ...state.encounter,
      active: arrivalTimerEffects.active,
      discard: [...state.encounter.discard, ...arrivalTimerEffects.discardedCardIds],
      roundEffects: arrivalTimerEffects.roundEffects
    }
  };
  const encounterResolution = resolveEndRoundEncounters(stateAfterArrivalTimerEffects);
  const activeAfterSuppressionExpiry = clearRoundStewardSuppression(encounterResolution.active);
  const stateAfterEncounterResolution = {
    ...stateAfterArrivalTimerEffects,
    encounter: {
      ...stateAfterArrivalTimerEffects.encounter,
      active: activeAfterSuppressionExpiry,
      discard: encounterResolution.discard
    }
  };
  const expiredArrivalStrain = applyExpiredArrivalStrain(
    stateAfterEncounterResolution,
    encounterResolution.expiredArrivals,
    context
  );
  const seasonEffects = applyEndOfSeasonEffects(
    expiredArrivalStrain.state,
    context
  );
  const nextRound = state.round + 1;
  const isComplete = nextRound > state.rules.totalRounds;
  const nextSeason = isComplete ? state.season : getSeasonForRound(nextRound);
  const nextRoundNeedsSeeding = !isComplete && isSeasonSeedRound(nextRound, state.rules);
  const burdenReapplication = isComplete
    ? {
        active: activeAfterSuppressionExpiry,
        map: {
          ...seasonEffects.state.map,
          placedTiles: seasonEffects.state.map.placedTiles.map(resetRoundSupportUsage)
        },
        warehouse: seasonEffects.state.warehouse,
        reappliedBurdens: []
      }
    : reapplySeasonStartBurdens(seasonEffects.state, activeAfterSuppressionExpiry, nextRound, nextSeason, context);
  const shouldSkipSeeding = nextRoundNeedsSeeding && !hasSeedableEncounterCards(state);
  const endRoundMessage = isComplete
    ? `Resolved end-of-round effects for Round ${state.round}. The standard game is complete.`
    : shouldSkipSeeding
      ? `Resolved end-of-round effects for Round ${state.round}. Round ${nextRound} has no cards to seed and is ready to reveal.`
      : nextRoundNeedsSeeding
        ? `Resolved end-of-round effects for Round ${state.round}. Round ${nextRound} is ready for seasonal seeding.`
        : `Resolved end-of-round effects for Round ${state.round}. Round ${nextRound} is ready to reveal.`;
  const nextState = {
    ...stateAfterArrivalTimerEffects,
    phase: isComplete
      ? GAME_PHASES.COMPLETE
      : nextRoundNeedsSeeding && !shouldSkipSeeding
        ? GAME_PHASES.SEED_ENCOUNTERS
        : GAME_PHASES.REVEAL_ENCOUNTERS,
    round: isComplete ? state.round : nextRound,
    season: nextSeason,
    activePlayerId: null,
    players: isComplete
      ? state.players.map((player) => ({ ...player, actionsRemaining: 0 }))
      : resetRoundActions(state),
    warehouse: burdenReapplication.warehouse,
    map: burdenReapplication.map,
    encounter: {
      ...stateAfterArrivalTimerEffects.encounter,
      active: burdenReapplication.active,
      discard: encounterResolution.discard,
      seededRounds: shouldSkipSeeding
        ? [...stateAfterArrivalTimerEffects.encounter.seededRounds, nextRound]
        : stateAfterArrivalTimerEffects.encounter.seededRounds,
      roundEffects: resetRecurringRoundEffects(
        (stateAfterArrivalTimerEffects.encounter.roundEffects ?? []).filter(
          (effect) => {
            if (effect.expiresAtEndOfSeason && effect.season !== nextSeason) {
              return false;
            }

            return effect.expiresAtEndOfRound === false || effect.round > state.round;
          }
        )
      )
    },
    log: [
      ...state.log,
      createActionLogEntry(
        state,
        "round",
        endRoundMessage,
        {
          completedRound: state.round,
          nextRound: isComplete ? null : nextRound,
          nextSeason: isComplete ? null : nextSeason,
          seasonalSeedWindow: nextRoundNeedsSeeding,
          autoSkippedSeeding: shouldSkipSeeding,
          timersRemoved: encounterResolution.timersRemoved,
          expiredArrivalIds: encounterResolution.expiredArrivals.map((arrival) => arrival.cardId),
          expiredArrivalStrain: expiredArrivalStrain.applications,
          reappliedBurdenIds: burdenReapplication.reappliedBurdens.map((burden) => burden.cardId),
          seasonEffects: seasonEffects.effects
        }
      ),
      ...seasonEffects.effects.map((effect, index) =>
        createActionLogEntry(
          state,
          "season_effect",
          effect.type === "end_season_resource_gain"
            ? `End of Season ${effect.season}: added ${effect.resourcesGained} resources to the Warehouse.`
            : `End of Season ${effect.season}: Overstrained tiles spread ${effect.strainAdded} Strain.`,
          effect,
          index + 1
        )
      ),
      ...burdenReapplication.reappliedBurdens.map((burden, index) => ({
        ...createActionLogEntry(
          state,
          "encounter",
          `Reapplied ${burden.cardName} for Season ${burden.season}.`,
          burden,
          index + 1
        ),
        round: burden.round,
        season: burden.season
      })),
      ...expiredArrivalStrain.applications.map((application, index) =>
        createActionLogEntry(
          state,
          "strain",
          application.noValidTarget
            ? `${application.cardName} expired, but there was no valid tile for its Strain.`
            : `${application.cardName} expired and added ${application.strainAdded} Strain to ${application.targetTileName}.`,
          application,
          1 + seasonEffects.effects.length + burdenReapplication.reappliedBurdens.length + index
        )
      ),
      ...(shouldSkipSeeding
        ? [
            {
              ...createActionLogEntry(
                state,
                "encounter",
                `Skipped seeding for Round ${nextRound}; no players have Encounter Cards in hand.`,
                {
                  seededCount: 0,
                  skippedNoCards: true
                },
                1 +
                  seasonEffects.effects.length +
                  burdenReapplication.reappliedBurdens.length +
                  expiredArrivalStrain.applications.length
              ),
              round: nextRound,
              season: nextSeason
            }
          ]
        : [])
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.END_ROUND,
      message: endRoundMessage,
      advancedRound: !isComplete,
      complete: isComplete,
      autoSkippedSeeding: shouldSkipSeeding,
      timersRemoved: encounterResolution.timersRemoved,
      expiredArrivals: encounterResolution.expiredArrivals,
      expiredArrivalStrain: expiredArrivalStrain.applications,
      reappliedBurdens: burdenReapplication.reappliedBurdens,
      seasonEffects: seasonEffects.effects
    }
  };
}

function seedEncounters(state, action = {}) {
  if (state.encounter.seededRounds.includes(state.round)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        errors: [`Round ${state.round} has already seeded Encounter Cards.`]
      }
    };
  }

  if (state.phase !== GAME_PHASES.SEED_ENCOUNTERS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        errors: ["Encounter Cards can only be seeded during the Seed Encounters phase."]
      }
    };
  }

  if (!isSeasonSeedRound(state.round, state.rules)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        errors: [`Round ${state.round} is not a seasonal Encounter seeding round.`]
      }
    };
  }

  const seed = seedEncounterCards(state, {
    seedSelectionsByPosition: action.seedSelectionsByPosition,
    seedSelections: action.seedSelections,
    seedPosition: action.seedPosition
  });

  if (!seed.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        errors: seed.errors
      }
    };
  }

  const skippedNoCards = seed.seeded.length === 0 && !hasSeedableEncounterCards(state);
  const seedMessage = skippedNoCards
    ? `Skipped seeding for Round ${state.round}; no players have Encounter Cards in hand.`
    : `Seeded ${seed.seeded.length} Encounter Card${seed.seeded.length === 1 ? "" : "s"} for Season ${state.season}.`;
  const nextState = {
    ...state,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    activePlayerId: null,
    players: seed.players,
    encounter: seed.encounter,
    log: [
      ...state.log,
      createActionLogEntry(state, "encounter", seedMessage, {
        seededCount: seed.seeded.length,
        skippedNoCards,
        playerIds: seed.seeded.map((entry) => entry.playerId),
        cardIds: seed.seeded.map((entry) => entry.cardId),
        seedPositions: seed.seedPositions,
        insertIndices: seed.insertIndices,
        seededByPosition: seed.seeded.reduce((entries, seededCard) => {
          entries[seededCard.seedPosition] = [...(entries[seededCard.seedPosition] ?? []), seededCard.cardId];
          return entries;
        }, {})
      })
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
      message: seedMessage,
      seededCount: seed.seeded.length,
      skippedNoCards,
      seedPositions: seed.seedPositions,
      insertIndices: seed.insertIndices,
      seeded: seed.seeded
    }
  };
}

function revealRoundEncounters(state, context) {
  if (state.encounter.revealedRounds.includes(state.round)) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS,
        errors: [`Round ${state.round} has already revealed Encounter Cards.`]
      }
    };
  }

  if (state.phase !== GAME_PHASES.REVEAL_ENCOUNTERS) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS,
        errors: ["Encounters can only be revealed during the Reveal Encounters phase."]
      }
    };
  }

  const reveal = revealEncounters(state, context.encounterCards, context);

  if (!reveal.valid) {
    return {
      state,
      result: {
        ok: false,
        action: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS,
        errors: reveal.errors
      }
    };
  }

  const nextState = {
    ...state,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: state.players[0]?.id ?? null,
    players: resetRoundActions(state),
    warehouse: reveal.warehouse ?? state.warehouse,
    map: reveal.map ?? state.map,
    encounter: reveal.encounter,
    log: [
      ...state.log,
      ...reveal.revealed.map((entry, index) =>
        createActionLogEntry(
          state,
          "encounter",
          `Revealed ${entry.cardName}${entry.countsAsStandardReveal ? "" : " as an extra Golden Boon reveal"}.`,
          entry,
          index
        )
      )
    ]
  };

  return {
    state: nextState,
    result: {
      ok: true,
      action: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS,
      message: `Revealed ${reveal.standardRevealed} standard Encounter Card${reveal.standardRevealed === 1 ? "" : "s"}${reveal.goldenRevealed ? ` plus ${reveal.goldenRevealed} Golden Boon` : ""}.`,
      revealed: reveal.revealed,
      standardRevealed: reveal.standardRevealed,
      goldenRevealed: reveal.goldenRevealed
    }
  };
}

export function dispatchGameAction(state, action, context = {}) {
  let outcome;

  switch (action.type) {
    case TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE:
      outcome = placeStewardHouse(state, action, context);
      break;

    case TILE_ACTION_TYPES.PLACE_TILE:
      outcome = placeTile(state, action, context);
      break;

    case TILE_ACTION_TYPES.ACTIVATE_TILE:
      outcome = activateTile(state, action, context);
      break;

    case TILE_ACTION_TYPES.UPGRADE_TILE:
      outcome = upgradeTile(state, action, context);
      break;

    case TILE_ACTION_TYPES.APPLY_STRAIN:
      outcome = applyTileStrain(state, action, context);
      break;

    case TILE_ACTION_TYPES.COMPLETE_ARRIVAL:
      outcome = completeArrival(state, action, context);
      break;

    case TILE_ACTION_TYPES.USE_STEWARD_POWER:
      outcome = useStewardPower(state, action, context);
      break;

    case TILE_ACTION_TYPES.RESOLVE_BURDEN:
      outcome = resolveBurden(state, action, context);
      break;

    case TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE:
      outcome = resolveBurdenChoice(state, action, context);
      break;

    case TILE_ACTION_TYPES.RESOLVE_BOON:
      outcome = resolveBoon(state, action, context);
      break;

    case TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE:
      outcome = debugFillWarehouse(state);
      break;

    case TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN:
      outcome = debugSetTileStrain(state, action);
      break;

    case TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED:
      outcome = debugSetTileSupported(state, action);
      break;

    case TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER:
      outcome = debugSetPlayerMarker(state, action);
      break;

    case TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS:
      outcome = debugResetActions(state);
      break;

    case TILE_ACTION_TYPES.END_TURN:
      outcome = endTurn(state);
      break;

    case TILE_ACTION_TYPES.END_ROUND:
      outcome = endRound(state, context);
      break;

    case TILE_ACTION_TYPES.SEED_ENCOUNTERS:
      outcome = seedEncounters(state, action);
      break;

    case TILE_ACTION_TYPES.REVEAL_ENCOUNTERS:
      outcome = revealRoundEncounters(state, context);
      break;

    default:
      outcome = {
        state,
        result: {
          ok: false,
          action: action.type,
          errors: [`Unknown action: ${action.type}`]
        }
      };
      break;
  }

  return outcome.result.ok
    ? {
        ...outcome,
        state: withScore(outcome.state, context)
      }
    : outcome;
}
