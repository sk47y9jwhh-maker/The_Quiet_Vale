import { getActivationDetails, getAdjacentPlacedTiles } from "./activation.js";
import { SEED_PACKET_POSITIONS, getBurdenResolutionCost, getEncounterSeasonEffect } from "./encounters.js";
import { HEX_DIRECTIONS, createMapIndex, getNeighborCoordinates, isWaterHex } from "./map.js";
import { dispatchGameAction } from "./reducer.js";
import { calculateScore } from "./scoring.js";
import { ENCOUNTER_TYPES, GAME_PHASES, createInitialGameState } from "./setup.js";
import { getPendingOpeningResourcePlacement } from "./stewards.js";
import {
  TILE_ACTION_TYPES,
  canAffordCost,
  createTileIndex,
  findUpgradeTile,
  getDirectlyPlaceableTiles,
  getPlacedTileCoordinates,
  isOverstrainedPlacedTile,
  parseResourceCost,
  validatePlaceTile,
  validateUpgradeTile
} from "./tiles.js";

export const SIMULATION_BOT_PROFILES = Object.freeze({
  builder: Object.freeze({
    id: "builder",
    label: "Builder Bot",
    burdenCostLimit: 2,
    strainRemovalThreshold: 3,
    choicePressure: "strain",
    priorities: ["place", "upgrade", "produce", "resolve_burden", "remove_strain", "complete_arrival"]
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "Balanced Bot",
    burdenCostLimit: 8,
    strainRemovalThreshold: 2,
    choicePressure: "pay_if_affordable",
    priorities: ["complete_arrival", "resolve_burden", "remove_strain", "produce", "place", "upgrade"]
  }),
  careful: Object.freeze({
    id: "careful",
    label: "Careful Bot",
    burdenCostLimit: 99,
    strainRemovalThreshold: 1,
    choicePressure: "pay_if_affordable",
    priorities: ["resolve_burden", "remove_strain", "complete_arrival", "produce", "place", "upgrade"]
  }),
  score: Object.freeze({
    id: "score",
    label: "Score Bot",
    burdenCostLimit: 99,
    strainRemovalThreshold: 1,
    choicePressure: "pay_if_affordable",
    optimizeForScore: true,
    maxPlacementCandidates: 12,
    maxPlacementsPerTile: 1,
    maxUpgradeCandidates: 10,
    priorities: ["complete_arrival", "resolve_burden", "upgrade", "place", "remove_strain", "utility", "produce"]
  })
});

export const SIMULATION_SUMMARY_FIELDS = Object.freeze([
  "game_id",
  "random_seed",
  "player_count",
  "bot_profile",
  "final_score",
  "final_population",
  "final_renown",
  "final_strain_tokens",
  "final_active_burdens",
  "total_burdens_revealed",
  "total_burden_applications",
  "total_burden_applications_with_no_valid_target",
  "total_strain_attempted",
  "total_strain_placed",
  "total_strain_prevented_by_supported",
  "total_strain_blocked_by_cap",
  "total_strain_removed",
  "actions_spent_resolving_burdens",
  "actions_spent_removing_strain",
  "max_tiles_at_1_strain",
  "max_tiles_at_2_strain",
  "max_overstrained_tiles",
  "rounds_with_at_least_one_overstrained_tile",
  "arrivals_completed",
  "arrivals_expired"
]);

export const SIMULATION_ROUND_FIELDS = Object.freeze([
  "game_id",
  "round",
  "season",
  "encounter_cards_revealed",
  "burdens_revealed_this_round",
  "burden_applications_this_round",
  "no_valid_target_burden_applications_this_round",
  "strain_attempted_this_round",
  "strain_placed_this_round",
  "strain_prevented_by_supported_this_round",
  "strain_removed_this_round",
  "active_burdens_end_of_round",
  "total_strain_tokens_end_of_round",
  "tiles_at_1_strain_end_of_round",
  "tiles_at_2_strain_end_of_round",
  "overstrained_tiles_end_of_round",
  "population_end_of_round",
  "renown_end_of_round"
]);

const TILE_CATEGORY_PRIORITY = Object.freeze({
  builder: Object.freeze(["Resource", "Housing", "Travel", "Wellbeing", "Social", "Crafting", "Merchant"]),
  balanced: Object.freeze(["Resource", "Wellbeing", "Social", "Housing", "Travel", "Crafting", "Merchant"]),
  careful: Object.freeze(["Wellbeing", "Social", "Resource", "Housing", "Travel", "Crafting", "Merchant"]),
  score: Object.freeze(["Housing", "Merchant", "Social", "Crafting", "Wellbeing", "Travel", "Resource"])
});

const SCORE_RESOURCE_WEIGHTS = Object.freeze({
  Goods: 0.35,
  Food: 0.2,
  Metal: 0.18,
  Stone: 0.16,
  Wood: 0.14,
  Herbs: 0.14
});

const SCORE_BOT_WEIGHTS = Object.freeze({
  population: 2.2,
  renown: 0.55,
  burdenResolution: 9000,
  arrivalCompletion: 1600,
  strainRemoval: 1100,
  arrivalTimer: 275,
  resourceEngine: 340,
  resourceProduction: 520
});

function numberValue(value) {
  return Number(value ?? 0) || 0;
}

function sumCost(cost = []) {
  return cost.reduce((total, entry) => total + Number(entry.amount ?? 0), 0);
}

function summarizePayment(payment = []) {
  const totals = new Map();

  for (const { resource, amount } of payment) {
    totals.set(resource, (totals.get(resource) ?? 0) + amount);
  }

  return [...totals.entries()].map(([resource, amount]) => ({ resource, amount }));
}

function getResourcePaymentOrder(state, excludedResources = []) {
  const excluded = new Set(excludedResources);

  return [...state.rules.resources]
    .filter((resource) => !excluded.has(resource))
    .sort((left, right) => {
      const amountDifference = numberValue(state.warehouse.resources[right]) - numberValue(state.warehouse.resources[left]);

      if (amountDifference !== 0) {
        return amountDifference;
      }

      return (SCORE_RESOURCE_WEIGHTS[left] ?? 0.1) - (SCORE_RESOURCE_WEIGHTS[right] ?? 0.1);
    });
}

function getResourceGainOrder(state, excludedResources = []) {
  const excluded = new Set(excludedResources);

  return [...state.rules.resources]
    .filter((resource) => !excluded.has(resource))
    .sort((left, right) => {
      const weightDifference = (SCORE_RESOURCE_WEIGHTS[right] ?? 0.1) - (SCORE_RESOURCE_WEIGHTS[left] ?? 0.1);

      if (weightDifference !== 0) {
        return weightDifference;
      }

      const leftSpace = state.warehouse.cap - numberValue(state.warehouse.resources[left]);
      const rightSpace = state.warehouse.cap - numberValue(state.warehouse.resources[right]);

      return rightSpace - leftSpace;
    });
}

function createSimulationAccumulator(gameId, randomSeed, playerCount, profileId) {
  return {
    game_id: gameId,
    random_seed: randomSeed,
    player_count: playerCount,
    bot_profile: profileId,
    final_score: 0,
    final_population: 0,
    final_renown: 0,
    final_strain_tokens: 0,
    final_active_burdens: 0,
    total_burdens_revealed: 0,
    total_burden_applications: 0,
    total_burden_applications_with_no_valid_target: 0,
    total_strain_attempted: 0,
    total_strain_placed: 0,
    total_strain_prevented_by_supported: 0,
    total_strain_blocked_by_cap: 0,
    total_strain_removed: 0,
    actions_spent_resolving_burdens: 0,
    actions_spent_removing_strain: 0,
    max_tiles_at_1_strain: 0,
    max_tiles_at_2_strain: 0,
    max_overstrained_tiles: 0,
    rounds_with_at_least_one_overstrained_tile: 0,
    arrivals_completed: 0,
    arrivals_expired: 0
  };
}

function createRoundAccumulator(gameId, round, season) {
  return {
    game_id: gameId,
    round,
    season,
    encounter_cards_revealed: 0,
    burdens_revealed_this_round: 0,
    burden_applications_this_round: 0,
    no_valid_target_burden_applications_this_round: 0,
    strain_attempted_this_round: 0,
    strain_placed_this_round: 0,
    strain_prevented_by_supported_this_round: 0,
    strain_removed_this_round: 0,
    active_burdens_end_of_round: 0,
    total_strain_tokens_end_of_round: 0,
    tiles_at_1_strain_end_of_round: 0,
    tiles_at_2_strain_end_of_round: 0,
    overstrained_tiles_end_of_round: 0,
    population_end_of_round: 0,
    renown_end_of_round: 0
  };
}

function countBoardPressure(state) {
  const placedTiles = state.map.placedTiles ?? [];

  return {
    strainTokens: placedTiles.reduce((total, placedTile) => total + numberValue(placedTile.strain), 0),
    tilesAt1: placedTiles.filter((placedTile) => numberValue(placedTile.strain) === 1).length,
    tilesAt2: placedTiles.filter((placedTile) => numberValue(placedTile.strain) === 2).length,
    overstrained: placedTiles.filter(isOverstrainedPlacedTile).length
  };
}

function addStrainApplications(summary, round, applications = []) {
  for (const application of applications) {
    const attempted = numberValue(application.requestedStrain);

    summary.total_strain_attempted += attempted;
    summary.total_strain_placed += numberValue(application.strainAdded);
    summary.total_strain_prevented_by_supported += numberValue(application.strainPrevented);
    summary.total_strain_blocked_by_cap += numberValue(application.blockedByMax);

    round.strain_attempted_this_round += attempted;
    round.strain_placed_this_round += numberValue(application.strainAdded);
    round.strain_prevented_by_supported_this_round += numberValue(application.strainPrevented);
  }
}

function recordBurdenApplication(summary, round, effect) {
  summary.total_burden_applications += 1;
  round.burden_applications_this_round += 1;

  const applications = effect?.applications ?? [];
  const hasNoValidTarget =
    !effect ||
    (applications.length === 0 &&
      ["strain_placement", "pay_or_strain_choice", "arrival_pay_or_timer_choice", "resource_loss_or_strain_choice"].includes(
        effect.type
      ));

  if (hasNoValidTarget) {
    summary.total_burden_applications_with_no_valid_target += 1;
    round.no_valid_target_burden_applications_this_round += 1;
  }

  addStrainApplications(summary, round, applications);
}

function recordSeasonEffect(summary, round, effect) {
  if (effect?.type !== "end_season_overstrained_spread") {
    return;
  }

  addStrainApplications(summary, round, effect.applications ?? []);
}

function recordDispatchResult(summary, round, result) {
  if (!result?.ok) {
    return;
  }

  if (result.action === TILE_ACTION_TYPES.REVEAL_ENCOUNTERS) {
    round.encounter_cards_revealed += result.revealed.length;

    for (const entry of result.revealed) {
      if (entry.encounterType !== ENCOUNTER_TYPES.BURDEN) {
        continue;
      }

      summary.total_burdens_revealed += 1;
      round.burdens_revealed_this_round += 1;
      recordBurdenApplication(summary, round, entry.burdenEffect);
    }
  }

  if (result.action === TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE) {
    addStrainApplications(summary, round, result.applications ?? []);
  }

  if (result.action === TILE_ACTION_TYPES.RESOLVE_BURDEN) {
    summary.actions_spent_resolving_burdens += numberValue(result.actionCost?.total);
  }

  if (result.action === TILE_ACTION_TYPES.COMPLETE_ARRIVAL) {
    summary.arrivals_completed += 1;
  }

  if (result.action === TILE_ACTION_TYPES.ACTIVATE_TILE && result.strainRemoved > 0) {
    summary.total_strain_removed += result.strainRemoved;
    round.strain_removed_this_round += result.strainRemoved;
    summary.actions_spent_removing_strain += numberValue(result.actionCost?.total);
  }

  if (result.action === TILE_ACTION_TYPES.RESOLVE_BOON && result.strainRemoved > 0) {
    summary.total_strain_removed += result.strainRemoved;
    round.strain_removed_this_round += result.strainRemoved;
  }

  if (result.action === TILE_ACTION_TYPES.END_ROUND) {
    summary.arrivals_expired += result.expiredArrivals?.length ?? 0;

    for (const burden of result.reappliedBurdens ?? []) {
      recordBurdenApplication(summary, round, burden.effect);
    }

    for (const effect of result.seasonEffects ?? []) {
      recordSeasonEffect(summary, round, effect);
    }
  }
}

function finalizeRound(summary, round, state, context) {
  const pressure = countBoardPressure(state);
  const score = calculateScore(state, context);

  round.active_burdens_end_of_round = score.activeBurdenCount;
  round.total_strain_tokens_end_of_round = pressure.strainTokens;
  round.tiles_at_1_strain_end_of_round = pressure.tilesAt1;
  round.tiles_at_2_strain_end_of_round = pressure.tilesAt2;
  round.overstrained_tiles_end_of_round = pressure.overstrained;
  round.population_end_of_round = score.population;
  round.renown_end_of_round = score.renown;

  summary.max_tiles_at_1_strain = Math.max(summary.max_tiles_at_1_strain, pressure.tilesAt1);
  summary.max_tiles_at_2_strain = Math.max(summary.max_tiles_at_2_strain, pressure.tilesAt2);
  summary.max_overstrained_tiles = Math.max(summary.max_overstrained_tiles, pressure.overstrained);

  if (pressure.overstrained > 0) {
    summary.rounds_with_at_least_one_overstrained_tile += 1;
  }

  return round;
}

function getEncounterIndex(encounterCards) {
  return new Map(encounterCards.map((card) => [card.card_id, card]));
}

function parseSeedResourceCost(text, resources) {
  const requirementText = String(text ?? "").split(/\bwithin\b/i)[0].trim();
  const housingMatch = /^Have at least \d+ Housing Tiles? and pay (.+)$/i.exec(requirementText);
  const resourceText = housingMatch ? housingMatch[1] : requirementText;

  try {
    return parseResourceCost(resourceText).filter((entry) => resources.includes(entry.resource));
  } catch {
    return [];
  }
}

function countMissingResources(warehouse, cost) {
  return cost.reduce(
    (total, entry) => total + Math.max(0, numberValue(entry.amount) - numberValue(warehouse.resources[entry.resource])),
    0
  );
}

function getBoonSeedValue(card, state) {
  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "");
  let value = 55;

  if (/0 Actions|0 Resources|fewer resources?|discount|reduce/i.test(effectText)) {
    value += 18;
  }

  if (/Remove .*Strain|Supported/i.test(effectText)) {
    value += 14 + countBoardPressure(state).strainTokens;
  }

  if (/Production|gain \d+/i.test(effectText)) {
    value += 8;
  }

  return value;
}

function getArrivalSeedValue(card, state) {
  const cost = parseSeedResourceCost(card.requirement, state.rules.resources);
  const missing = countMissingResources(state.warehouse, cost);
  const rewardValue = /x\s*2/i.test(String(card.reward ?? "")) ? 12 : 8;

  return 42 + rewardValue - missing * 4 - sumCost(cost) / 2;
}

function getBurdenSeedValue(card, state) {
  const resolution = getBurdenResolutionCost(card, state.season);
  const pressure = countBoardPressure(state);
  const cost = resolution.supported ? sumCost(resolution.cost) + numberValue(resolution.amount) : 12;
  const affordable = resolution.supported && resolution.requiresPaymentChoice
    ? Boolean(choosePaymentResources(state.warehouse, resolution.amount, resolution.allowedResources ?? state.rules.resources))
    : canAffordCost(state.warehouse, resolution.cost ?? []);

  return -70 - pressure.strainTokens * 3 - pressure.overstrained * 20 + (affordable ? 16 : -12) - cost * 3;
}

function getSeedCardValue(card, state) {
  if (card?.encounter_type === ENCOUNTER_TYPES.BOON) {
    return getBoonSeedValue(card, state);
  }

  if (card?.encounter_type === ENCOUNTER_TYPES.ARRIVAL) {
    return getArrivalSeedValue(card, state);
  }

  if (card?.encounter_type === ENCOUNTER_TYPES.BURDEN) {
    return getBurdenSeedValue(card, state);
  }

  return 0;
}

function buildScoreSeedAction(state, profile, context) {
  if (!profile.optimizeForScore) {
    return {
      type: TILE_ACTION_TYPES.SEED_ENCOUNTERS
    };
  }

  const encounterIndex = getEncounterIndex(context.encounterCards ?? []);
  const selectedValues = [];
  const seedSelections = Object.fromEntries(
    state.players
      .filter((player) => player.hand.length > 0)
      .map((player) => {
        const best = player.hand
          .map((cardId) => {
            const card = encounterIndex.get(cardId);

            return {
              cardId,
              value: getSeedCardValue(card, state)
            };
          })
          .sort((left, right) => right.value - left.value || left.cardId.localeCompare(right.cardId))[0];

        selectedValues.push(best.value);
        return [player.id, best.cardId];
      })
  );
  const averageValue = selectedValues.length
    ? selectedValues.reduce((total, value) => total + value, 0) / selectedValues.length
    : 0;
  const seedPosition =
    averageValue >= 35
      ? SEED_PACKET_POSITIONS.TOP
      : averageValue >= 0
        ? SEED_PACKET_POSITIONS.UPPER_THIRD
        : averageValue >= -45
          ? SEED_PACKET_POSITIONS.LOWER_THIRD
          : SEED_PACKET_POSITIONS.BOTTOM;

  return {
    type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
    seedSelections,
    seedPosition
  };
}

function getTilePriority(profileId, tile) {
  const order = TILE_CATEGORY_PRIORITY[profileId] ?? TILE_CATEGORY_PRIORITY.balanced;
  const categoryIndex = order.indexOf(tile?.tile_category);
  return categoryIndex === -1 ? order.length : categoryIndex;
}

function getScoreBotTileValue(tile) {
  return numberValue(tile?.population) * SCORE_BOT_WEIGHTS.population +
    numberValue(tile?.renown) * SCORE_BOT_WEIGHTS.renown;
}

function compareTilesForProfile(profile, left, right) {
  if (profile.optimizeForScore) {
    const scoreDifference = getScoreBotTileValue(right) - getScoreBotTileValue(left);

    if (scoreDifference !== 0) {
      return scoreDifference;
    }
  }

  const priorityDifference = getTilePriority(profile.id, left) - getTilePriority(profile.id, right);

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const leftCost = sumCost(parseResourceCost(left?.place_cost ?? left?.upgrade_cost));
  const rightCost = sumCost(parseResourceCost(right?.place_cost ?? right?.upgrade_cost));

  return leftCost - rightCost || String(left?.tile_name ?? "").localeCompare(String(right?.tile_name ?? ""));
}

function addResourceNeed(needs, resource, amount) {
  if (!resource || amount <= 0) {
    return;
  }

  needs.set(resource, (needs.get(resource) ?? SCORE_RESOURCE_WEIGHTS[resource] ?? 0.1) + amount);
}

function getScoreBotResourceNeeds(state, context) {
  const needs = new Map(state.rules.resources.map((resource) => [resource, SCORE_RESOURCE_WEIGHTS[resource] ?? 0.1]));
  const encounterIndex = getEncounterIndex(context.encounterCards ?? []);
  const activeBurdens = state.encounter.active.filter(
    (active) => active.encounterType === ENCOUNTER_TYPES.BURDEN && !active.resolved
  );

  for (const activeBurden of activeBurdens) {
    const card = encounterIndex.get(activeBurden.cardId);
    const resolution = getBurdenResolutionCost(card, state.season);

    if (!resolution.supported) {
      continue;
    }

    if (resolution.requiresPaymentChoice) {
      const allowedResources = resolution.allowedResources ?? state.rules.resources;
      const needPerResource = numberValue(resolution.amount) / Math.max(1, allowedResources.length);

      for (const resource of allowedResources) {
        addResourceNeed(needs, resource, needPerResource * 2.5);
      }
      continue;
    }

    for (const costEntry of resolution.cost ?? []) {
      const available = numberValue(state.warehouse.resources[costEntry.resource]);
      const missing = Math.max(0, numberValue(costEntry.amount) - available);

      addResourceNeed(needs, costEntry.resource, Math.max(missing, numberValue(costEntry.amount) * 0.75) * 3);
    }
  }

  const populationTileGoals = getAvailablePlacementTiles(state, context)
    .filter((tile) => numberValue(tile.population) > 0)
    .sort((left, right) => getScoreBotTileValue(right) - getScoreBotTileValue(left))
    .slice(0, 8);

  for (const tile of populationTileGoals) {
    const populationValue = numberValue(tile.population) / 10;

    for (const costEntry of parseResourceCost(tile.place_cost)) {
      const available = numberValue(state.warehouse.resources[costEntry.resource]);
      const missing = Math.max(0, numberValue(costEntry.amount) - available);

      addResourceNeed(needs, costEntry.resource, (missing + numberValue(costEntry.amount) * 0.15) * populationValue);
    }
  }

  return needs;
}

function getResourceNeedValue(context, resource) {
  return context.scoreResourceNeeds?.get(resource) ?? SCORE_RESOURCE_WEIGHTS[resource] ?? 0.1;
}

function getProductionPotentialValue(tile, context, multiplier = SCORE_BOT_WEIGHTS.resourceEngine) {
  let activation = null;

  try {
    activation = getActivationDetails(tile);
  } catch {
    return 0;
  }

  if (activation?.type !== "production") {
    return 0;
  }

  return activation.gains.reduce(
    (total, gain) => total + numberValue(gain.amount) * getResourceNeedValue(context, gain.resource) * multiplier,
    0
  );
}

function sortTilesForProfile(profileId, tileIndex, placedTilesOrEntries) {
  return [...placedTilesOrEntries].sort((left, right) => {
    const leftTile = tileIndex.get(left.tileId ?? left.tile_id);
    const rightTile = tileIndex.get(right.tileId ?? right.tile_id);
    const priorityDifference = getTilePriority(profileId, leftTile) - getTilePriority(profileId, rightTile);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return String(leftTile?.tile_name ?? "").localeCompare(String(rightTile?.tile_name ?? ""));
  });
}

function choosePaymentResources(warehouse, amount, allowedResources) {
  const payment = [];
  let remaining = amount;

  for (const resource of allowedResources) {
    if (remaining <= 0) {
      break;
    }

    const available = warehouse.resources[resource] ?? 0;
    const paid = Math.min(available, remaining);

    if (paid > 0) {
      payment.push({ resource, amount: paid });
      remaining -= paid;
    }
  }

  return remaining === 0 ? payment : null;
}

function getAffordablePaymentOption(state, options = []) {
  return options.find((option) => canAffordCost(state.warehouse, [option])) ?? null;
}

function getPendingBurdenResolutionDiscountEffect(state) {
  return (
    (state.encounter.roundEffects ?? []).find(
      (effect) => effect.type === "burden_resolution_discount" && (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function chooseCostReductionResources(cost, discountEffect, context) {
  if (!discountEffect || cost.length === 0) {
    return [];
  }

  const amount = Math.min(discountEffect.amount, sumCost(cost));
  const expandedResources = cost
    .flatMap((entry) => Array.from({ length: entry.amount }, () => entry.resource))
    .sort((left, right) => getResourceNeedValue(context, right) - getResourceNeedValue(context, left));

  return expandedResources.slice(0, amount);
}

function applyCostReduction(cost, selectedResources) {
  const reduction = summarizePayment(selectedResources.map((resource) => ({ resource, amount: 1 })));

  return cost
    .map((entry) => {
      const reducedBy = reduction.find((candidate) => candidate.resource === entry.resource)?.amount ?? 0;

      return {
        ...entry,
        amount: entry.amount - reducedBy
      };
    })
    .filter((entry) => entry.amount > 0);
}

function shouldPayForPressureChoice(profile, state, effect) {
  if (profile.choicePressure === "strain") {
    return false;
  }

  return Boolean(getAffordablePaymentOption(state, effect.paymentOptions ?? []));
}

function buildBurdenChoiceAction(state, activeBurden, profile) {
  const effect = activeBurden.pendingChoice;
  const fallbackMode = effect.type === "arrival_pay_or_timer_choice" ? "timer" : "strain";
  const pay = shouldPayForPressureChoice(profile, state, effect);
  const paymentOption = pay ? getAffordablePaymentOption(state, effect.paymentOptions ?? []) : null;
  const mode = paymentOption ? "pay" : fallbackMode;
  const resource = paymentOption?.resource ?? null;

  if (effect.type === "resource_loss_or_strain_choice") {
    return {
      type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
      activeEncounterId: activeBurden.id,
      choice: { mode, resource }
    };
  }

  return {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: activeBurden.id,
    decisions: (effect.targets ?? []).map((target) => ({
      placedTileId: target.placedTileId,
      activeEncounterId: target.activeEncounterId,
      mode,
      resource
    }))
  };
}

function resolvePendingBurdenChoices(state, profile, context, dispatchWithTelemetry) {
  let workingState = state;
  let guard = 0;

  while (guard < 50) {
    guard += 1;
    const pendingBurden = workingState.encounter.active.find(
      (active) => active.encounterType === ENCOUNTER_TYPES.BURDEN && active.pendingChoice
    );

    if (!pendingBurden) {
      break;
    }

    const action = buildBurdenChoiceAction(workingState, pendingBurden, profile);
    const outcome = dispatchWithTelemetry(workingState, action, context);

    if (!outcome.result.ok) {
      const fallbackAction = {
        ...action,
        decisions: action.decisions?.map((decision) => ({
          ...decision,
          mode: pendingBurden.pendingChoice.type === "arrival_pay_or_timer_choice" ? "timer" : "strain",
          resource: null
        })),
        choice: action.choice
          ? {
              mode: "strain",
              resource: null
            }
          : undefined
      };
      const fallback = dispatchWithTelemetry(workingState, fallbackAction, context);

      if (!fallback.result.ok) {
        break;
      }

      workingState = fallback.state;
      continue;
    }

    workingState = outcome.state;
  }

  return workingState;
}

function buildCompleteArrivalCandidates(state) {
  return state.encounter.active
    .filter((active) => active.encounterType === ENCOUNTER_TYPES.ARRIVAL && !active.completed)
    .map((active) => ({
      type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
      activeEncounterId: active.id
    }));
}

function buildResolveBurdenCandidates(state, profile, context) {
  const encounterIndex = getEncounterIndex(context.encounterCards ?? []);
  const activeBurdens = state.encounter.active.filter(
    (active) => active.encounterType === ENCOUNTER_TYPES.BURDEN && !active.resolved
  );
  const candidates = [];
  const discountEffect = getPendingBurdenResolutionDiscountEffect(state);

  for (const activeBurden of activeBurdens) {
    const card = encounterIndex.get(activeBurden.cardId);
    const resolution = getBurdenResolutionCost(card, state.season);

    if (!resolution.supported || resolution.actionCost > 1 || sumCost(resolution.cost) > profile.burdenCostLimit) {
      continue;
    }

    const payment = resolution.requiresPaymentChoice
      ? choosePaymentResources(state.warehouse, resolution.amount, resolution.allowedResources ?? state.rules.resources)
      : resolution.cost;

    if (!payment) {
      continue;
    }

    const burdenResolutionReductionResources = chooseCostReductionResources(payment, discountEffect, context);
    const discountedPayment = applyCostReduction(payment, burdenResolutionReductionResources);

    if (!canAffordCost(state.warehouse, discountedPayment)) {
      continue;
    }

    candidates.push({
      type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
      activeEncounterId: activeBurden.id,
      payment,
      burdenResolutionReductionResources
    });
  }

  return candidates;
}

function buildRemoveStrainCandidates(state, profile, context) {
  const tileIndex = context.tileIndex;
  const candidates = [];
  const strainedTargets = [...state.map.placedTiles]
    .filter((placedTile) => (placedTile.strain ?? 0) >= profile.strainRemovalThreshold)
    .sort((left, right) => (right.strain ?? 0) - (left.strain ?? 0));

  for (const active of state.encounter.active) {
    if (active.effect?.type !== "optional_resource_strain_relief") {
      continue;
    }

    const targets = strainedTargets
      .filter((placedTile) => !active.effect.targetCategories?.length || active.effect.targetCategories.includes(tileIndex.get(placedTile.tileId)?.tile_category))
      .slice(0, active.effect.maxTargets)
      .map((placedTile) => placedTile.id);

    if (targets.length > 0 && canAffordCost(state.warehouse, active.effect.cost)) {
      candidates.push({
        type: TILE_ACTION_TYPES.RESOLVE_BOON,
        activeEncounterId: active.id,
        targetPlacedTileIds: targets
      });
    }
  }

  for (const placedTile of sortTilesForProfile(profile.id, tileIndex, state.map.placedTiles)) {
    const tile = tileIndex.get(placedTile.tileId);
    const activation = getActivationDetails(tile);

    if (activation?.type !== "remove_strain_adjacent" || isOverstrainedPlacedTile(placedTile)) {
      continue;
    }

    const adjacentTargets = getAdjacentPlacedTiles(state, placedTile)
      .filter((target) => (target.strain ?? 0) >= profile.strainRemovalThreshold)
      .sort((left, right) => (right.strain ?? 0) - (left.strain ?? 0));

    for (const target of adjacentTargets) {
      candidates.push({
        type: TILE_ACTION_TYPES.ACTIVATE_TILE,
        placedTileId: placedTile.id,
        targetPlacedTileId: target.id
      });
    }
  }

  return candidates;
}

function buildProductionCandidates(state, profile, context) {
  const tileIndex = context.tileIndex;
  const candidates = [];

  for (const placedTile of sortTilesForProfile(profile.id, tileIndex, state.map.placedTiles)) {
    const tile = tileIndex.get(placedTile.tileId);
    const activation = getActivationDetails(tile);

    if (activation?.type !== "production" || isOverstrainedPlacedTile(placedTile)) {
      continue;
    }

    const hasWarehouseSpace = activation.gains.some(
      (gain) => (state.warehouse.resources[gain.resource] ?? 0) < state.warehouse.cap
    );

    if (hasWarehouseSpace) {
      candidates.push({
        type: TILE_ACTION_TYPES.ACTIVATE_TILE,
        placedTileId: placedTile.id
      });
    }
  }

  return candidates;
}

function buildUtilityActivationCandidates(state, profile, context) {
  const tileIndex = context.tileIndex;
  const candidates = [];

  for (const placedTile of sortTilesForProfile(profile.id, tileIndex, state.map.placedTiles)) {
    const tile = tileIndex.get(placedTile.tileId);
    const activation = getActivationDetails(tile);

    if (!activation || isOverstrainedPlacedTile(placedTile)) {
      continue;
    }

    if (activation.type === "resolve_active_burden") {
      const activeBurdens = state.encounter.active.filter(
        (active) => active.encounterType === ENCOUNTER_TYPES.BURDEN && !active.resolved
      );

      for (const activeBurden of activeBurdens) {
        candidates.push({
          type: TILE_ACTION_TYPES.ACTIVATE_TILE,
          placedTileId: placedTile.id,
          targetActiveEncounterId: activeBurden.id
        });
      }
      continue;
    }

    if (activation.type === "add_arrival_timer") {
      const timerMax = state.rules.arrivalTimerMax ?? 3;
      const activeArrivals = state.encounter.active.filter((active) => {
        const timerTokens = numberValue(active.timerTokens ?? state.rules.arrivalStartTimerTokens);

        return active.encounterType === ENCOUNTER_TYPES.ARRIVAL && !active.completed && timerTokens < timerMax;
      });

      for (const activeArrival of activeArrivals) {
        candidates.push({
          type: TILE_ACTION_TYPES.ACTIVATE_TILE,
          placedTileId: placedTile.id,
          targetActiveEncounterId: activeArrival.id
        });
      }
      continue;
    }

    if (activation.type === "resource_exchange") {
      const gainResource = activation.gain.resource;
      const gainSpace = state.warehouse.cap - numberValue(state.warehouse.resources[gainResource]);
      const payment = gainSpace >= activation.gain.amount
        ? choosePaymentResources(state.warehouse, activation.paymentAmount, getResourcePaymentOrder(state, [gainResource]))
        : null;

      if (payment) {
        candidates.push({
          type: TILE_ACTION_TYPES.ACTIVATE_TILE,
          placedTileId: placedTile.id,
          payment
        });
      }
      continue;
    }

    if (activation.type === "flexible_resource_exchange") {
      const gainResource = getResourceGainOrder(state, activation.excludedGainResources).find(
        (resource) => numberValue(state.warehouse.resources[resource]) < state.warehouse.cap
      );
      const paymentResource = gainResource
        ? getResourcePaymentOrder(state, [gainResource]).find((resource) => numberValue(state.warehouse.resources[resource]) > 0)
        : null;

      if (!gainResource || !paymentResource) {
        continue;
      }

      const amount = Math.min(
        activation.maxAmount,
        numberValue(state.warehouse.resources[paymentResource]),
        state.warehouse.cap - numberValue(state.warehouse.resources[gainResource])
      );

      if (amount > 0) {
        candidates.push({
          type: TILE_ACTION_TYPES.ACTIVATE_TILE,
          placedTileId: placedTile.id,
          payment: [{ resource: paymentResource, amount }],
          gains: [{ resource: gainResource, amount }]
        });
      }
    }
  }

  return candidates;
}

function getAvailablePlacementTiles(state, context) {
  const supplyByTileId = new Map(
    [...state.tileSupply.core, ...state.tileSupply.special].map((entry) => [entry.tileId, entry])
  );
  const directCoreTileIds = new Set(getDirectlyPlaceableTiles(context.tiles ?? []).map((tile) => tile.tile_id));
  const unlockedCoreTiles = (context.tiles ?? []).filter((tile) => {
    const supply = supplyByTileId.get(tile.tile_id);

    return (
      tile.tile_source_type === "Core" &&
      tile.side === "Basic" &&
      supply &&
      !supply.locked &&
      (directCoreTileIds.has(tile.tile_id) || supply.unlockedBySteward)
    );
  });
  const unlockedSpecialTiles = (context.tiles ?? []).filter((tile) => {
    const supply = supplyByTileId.get(tile.tile_id);
    return tile.tile_source_type === "Special" && supply && !supply.locked;
  });

  return [...unlockedCoreTiles, ...unlockedSpecialTiles].filter((tile) => {
    const supply = supplyByTileId.get(tile.tile_id);
    return supply && supply.available > 0 && !supply.locked;
  });
}

function getOccupiedCoordinates(state) {
  return new Set(state.map.placedTiles.flatMap(getPlacedTileCoordinates));
}

function getAdjacentEmptyCoordinates(state, predicate = () => true) {
  const mapIndex = createMapIndex(state.map.hexes);
  const occupied = getOccupiedCoordinates(state);
  const coordinates = new Set();

  for (const placedTile of state.map.placedTiles) {
    if (isOverstrainedPlacedTile(placedTile)) {
      continue;
    }

    if (!predicate(placedTile)) {
      continue;
    }

    for (const coordinate of getPlacedTileCoordinates(placedTile)) {
      for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
        const hex = mapIndex.get(neighborCoordinate);

        if (hex && !occupied.has(neighborCoordinate)) {
          coordinates.add(neighborCoordinate);
        }
      }
    }
  }

  return coordinates;
}

function getTerrainPlacementCoordinates(state, terrain) {
  const occupied = getOccupiedCoordinates(state);
  return state.map.hexes
    .filter((hex) => hex.Terrain === terrain && !occupied.has(hex.Coordinate))
    .map((hex) => hex.Coordinate);
}

function getWaterAdjacentCoordinates(state) {
  const mapIndex = createMapIndex(state.map.hexes);
  const occupied = getOccupiedCoordinates(state);
  const coordinates = new Set();

  for (const hex of state.map.hexes.filter(isWaterHex)) {
    for (const neighborCoordinate of getNeighborCoordinates(hex.Coordinate, mapIndex)) {
      const neighborHex = mapIndex.get(neighborCoordinate);

      if (neighborHex && !isWaterHex(neighborHex) && !occupied.has(neighborCoordinate)) {
        coordinates.add(neighborCoordinate);
      }
    }
  }

  return [...coordinates];
}

function getPlacementCoordinateCandidates(state, tile, context) {
  const tileIndex = context.tileIndex;
  const occupied = getOccupiedCoordinates(state);
  const rule = tile.placement_rules;
  const terrainRules = {
    "Place on Woodland.": "Woodland",
    "Place on Mountains.": "Mountains",
    "Place on Heaths.": "Heaths",
    "Place on Arable Land.": "Arable Land",
    "Place on Ruins.": "Ruins",
    "Place on Water terrain.": "Water",
    "Place on a River hex.": "Water"
  };
  const categoryRules = {
    "Place adjacent to a Housing Tile.": ["Housing"],
    "Place adjacent to a Travel Tile.": ["Travel"],
    "Place adjacent to a Social Tile.": ["Social"],
    "Place adjacent to a Merchant Tile.": ["Merchant"],
    "Place adjacent to a Wellbeing Tile.": ["Wellbeing"],
    "Place adjacent to a Housing Tile or Wellbeing Tile.": ["Housing", "Wellbeing"]
  };
  const nameRules = {
    "Place adjacent to a Farm.": ["Farm"],
    "Place adjacent to a Forest.": ["Forest"],
    "Place adjacent to a Mine.": ["Mine"],
    "Place adjacent to a Dig Site.": ["Dig Site"],
    "Place adjacent to Wildlands.": ["Wildlands"]
  };

  if (terrainRules[rule]) {
    return getTerrainPlacementCoordinates(state, terrainRules[rule]);
  }

  if (rule === "Place adjacent to Water terrain." || rule === "Place adjacent to a River hex.") {
    return getWaterAdjacentCoordinates(state);
  }

  if (rule === "Place adjacent to any placed, non-Overstrained tile.") {
    return [...getAdjacentEmptyCoordinates(state)];
  }

  if (rule === "Place adjacent to Ruins terrain.") {
    const mapIndex = createMapIndex(state.map.hexes);
    const coordinates = new Set();

    for (const hex of state.map.hexes.filter((candidate) => candidate.Terrain === "Ruins")) {
      for (const neighborCoordinate of getNeighborCoordinates(hex.Coordinate, mapIndex)) {
        if (!occupied.has(neighborCoordinate) && !isWaterHex(mapIndex.get(neighborCoordinate))) {
          coordinates.add(neighborCoordinate);
        }
      }
    }

    return [...coordinates];
  }

  const categories = categoryRules[rule];
  if (categories) {
    return [
      ...getAdjacentEmptyCoordinates(state, (placedTile) => {
        const definition = tileIndex.get(placedTile.tileId);
        return categories.includes(definition?.tile_category) || categories.includes(definition?.internal_role_tag);
      })
    ];
  }

  const names = nameRules[rule];
  if (names) {
    return [
      ...getAdjacentEmptyCoordinates(state, (placedTile) => {
        const definition = tileIndex.get(placedTile.tileId);
        return names.includes(definition?.tile_name) || names.includes(definition?.base_tile);
      })
    ];
  }

  return state.map.hexes
    .filter((hex) => !isWaterHex(hex) && !occupied.has(hex.Coordinate))
    .map((hex) => hex.Coordinate);
}

function buildPlacementCandidates(state, profile, context) {
  const tileIndex = context.tileIndex;
  const candidates = [];
  const maxCandidates = profile.maxPlacementCandidates ?? 8;
  const maxPlacementsPerTile = profile.maxPlacementsPerTile ?? 1;
  const tiles = getAvailablePlacementTiles(state, context).filter((tile) =>
    canAffordCost(state.warehouse, parseResourceCost(tile.place_cost))
  ).sort((left, right) => compareTilesForProfile(profile, left, right));

  for (const tile of tiles) {
    const orientations = tile.size_hexes > 1 ? HEX_DIRECTIONS.map((direction) => direction.id) : [HEX_DIRECTIONS[0].id];
    const coordinateCandidates = getPlacementCoordinateCandidates(state, tile, context).slice(0, 36);
    let placementCountForTile = 0;

    for (const coordinate of coordinateCandidates) {
      for (const orientation of orientations) {
        const action = {
          type: TILE_ACTION_TYPES.PLACE_TILE,
          tileId: tile.tile_id,
          coordinate,
          orientation
        };
        const validation = validatePlaceTile(state, action, { ...context, tileIndex });

        if (validation.valid) {
          candidates.push(action);
          placementCountForTile += 1;

          if (candidates.length >= maxCandidates) {
            return candidates;
          }
          break;
        }
      }

      if (placementCountForTile >= maxPlacementsPerTile) {
        break;
      }
    }
  }

  return candidates;
}

function buildOpeningPlacementCandidates(state, profile, context) {
  const pending = getPendingOpeningResourcePlacement(state, state.activePlayerId);

  if (!pending) {
    return [];
  }

  const allowedTileIds = new Set(pending.tileIds);
  const tiles = getAvailablePlacementTiles(state, context)
    .filter((tile) => allowedTileIds.has(tile.tile_id))
    .sort((left, right) => compareTilesForProfile(profile, left, right));
  const candidates = [];

  for (const tile of tiles) {
    for (const coordinate of getPlacementCoordinateCandidates(state, tile, context)) {
      const action = {
        type: TILE_ACTION_TYPES.PLACE_TILE,
        tileId: tile.tile_id,
        coordinate,
        orientation: HEX_DIRECTIONS[0].id
      };
      const validation = validatePlaceTile(state, action, context);

      if (validation.valid) {
        candidates.push(action);
        break;
      }
    }
  }

  return candidates;
}

function buildUpgradeCandidates(state, profile, context) {
  const tileIndex = context.tileIndex;
  const candidates = [];
  const maxCandidates = profile.maxUpgradeCandidates ?? 8;

  for (const placedTile of sortTilesForProfile(profile.id, tileIndex, state.map.placedTiles)) {
    const tile = tileIndex.get(placedTile.tileId);
    const upgradeTile = findUpgradeTile(tile, tileIndex);

    if (!upgradeTile || isOverstrainedPlacedTile(placedTile)) {
      continue;
    }

    const action = {
      type: TILE_ACTION_TYPES.UPGRADE_TILE,
      placedTileId: placedTile.id
    };
    const validation = validateUpgradeTile(state, action, context);

    if (validation.valid) {
      candidates.push(action);

      if (candidates.length >= maxCandidates) {
        return candidates;
      }
    }
  }

  return candidates;
}

function buildActionCandidates(state, profile, context, priority) {
  const builders = {
    complete_arrival: buildCompleteArrivalCandidates,
    resolve_burden: (currentState) => buildResolveBurdenCandidates(currentState, profile, context),
    remove_strain: (currentState) => buildRemoveStrainCandidates(currentState, profile, context),
    produce: (currentState) => buildProductionCandidates(currentState, profile, context),
    utility: (currentState) => buildUtilityActivationCandidates(currentState, profile, context),
    place: (currentState) => buildPlacementCandidates(currentState, profile, context),
    upgrade: (currentState) => buildUpgradeCandidates(currentState, profile, context)
  };

  return builders[priority]?.(state) ?? [];
}

function estimateActivationCandidateValue(state, action, context) {
  const placedTile = state.map.placedTiles.find((candidate) => candidate.id === action.placedTileId);
  const tile = context.tileIndex.get(placedTile?.tileId);
  const activation = getActivationDetails(tile);

  if (!activation) {
    return 0;
  }

  if (activation.type === "resolve_active_burden") {
    return SCORE_BOT_WEIGHTS.burdenResolution;
  }

  if (activation.type === "remove_strain_adjacent") {
    const targetIds = action.targetPlacedTileIds ?? [action.targetPlacedTileId];
    const removed = targetIds
      .filter(Boolean)
      .map((targetId) => state.map.placedTiles.find((candidate) => candidate.id === targetId))
      .filter(Boolean)
      .reduce(
        (total, target) =>
          total +
          Math.min(activation.amount, numberValue(target.strain)) +
          (isOverstrainedPlacedTile(target) ? 1 : 0),
        0
      );

    return removed * SCORE_BOT_WEIGHTS.strainRemoval;
  }

  if (activation.type === "production") {
    return activation.gains.reduce(
      (total, gain) =>
        total + numberValue(gain.amount) * getResourceNeedValue(context, gain.resource) * SCORE_BOT_WEIGHTS.resourceProduction,
      0
    );
  }

  if (activation.type === "resource_exchange" || activation.type === "flexible_resource_exchange") {
    const gained = summarizePayment(action.gains ?? (activation.gain ? [activation.gain] : []));
    const paid = summarizePayment(action.payment ?? []);
    const gainValue = gained.reduce(
      (total, gain) => total + numberValue(gain.amount) * getResourceNeedValue(context, gain.resource),
      0
    );
    const paymentValue = paid.reduce(
      (total, payment) => total + numberValue(payment.amount) * getResourceNeedValue(context, payment.resource),
      0
    );

    return (gainValue - paymentValue) * SCORE_BOT_WEIGHTS.resourceProduction;
  }

  if (activation.type === "add_arrival_timer") {
    return SCORE_BOT_WEIGHTS.arrivalTimer;
  }

  return 0;
}

function estimateScoreCandidateValue(state, action, context, candidateIndex) {
  const activeBurdenCount = state.encounter.active.filter(
    (active) => active.encounterType === ENCOUNTER_TYPES.BURDEN && !active.resolved
  ).length;

  if (action.type === TILE_ACTION_TYPES.COMPLETE_ARRIVAL) {
    return Math.max(450, SCORE_BOT_WEIGHTS.arrivalCompletion - activeBurdenCount * 180) - candidateIndex / 1000;
  }

  if (action.type === TILE_ACTION_TYPES.RESOLVE_BURDEN) {
    return SCORE_BOT_WEIGHTS.burdenResolution + activeBurdenCount * 150 - sumCost(action.payment) * 60 - candidateIndex / 1000;
  }

  if (action.type === TILE_ACTION_TYPES.PLACE_TILE) {
    const tile = context.tileIndex.get(action.tileId);

    return getScoreBotTileValue(tile) * 100 +
      getProductionPotentialValue(tile, context) -
      sumCost(parseResourceCost(tile?.place_cost)) * 25 -
      candidateIndex / 1000;
  }

  if (action.type === TILE_ACTION_TYPES.UPGRADE_TILE) {
    const placedTile = state.map.placedTiles.find((candidate) => candidate.id === action.placedTileId);
    const currentTile = context.tileIndex.get(placedTile?.tileId);
    const upgradeTile = findUpgradeTile(currentTile, context.tileIndex);
    const scoreGain = getScoreBotTileValue(upgradeTile) - getScoreBotTileValue(currentTile);
    const productionGain = getProductionPotentialValue(upgradeTile, context) - getProductionPotentialValue(currentTile, context);

    return scoreGain * 100 + productionGain - sumCost(parseResourceCost(upgradeTile?.upgrade_cost)) * 25 - candidateIndex / 1000;
  }

  if (action.type === TILE_ACTION_TYPES.ACTIVATE_TILE) {
    return estimateActivationCandidateValue(state, action, context) - candidateIndex / 1000;
  }

  return -candidateIndex / 1000;
}

function buildScoreOptimizedCandidates(state, profile, context) {
  return profile.priorities.flatMap((priority) => buildActionCandidates(state, profile, context, priority));
}

function tryScoreOptimizedAction(state, profile, context, dispatchWithTelemetry) {
  const scoreContext = {
    ...context,
    scoreResourceNeeds: getScoreBotResourceNeeds(state, context)
  };
  const roughRanked = buildScoreOptimizedCandidates(state, profile, scoreContext)
    .map((candidate, index) => ({
      action: candidate,
      candidateIndex: index,
      estimate: estimateScoreCandidateValue(state, candidate, scoreContext, index)
    }))
    .sort((left, right) => right.estimate - left.estimate || left.candidateIndex - right.candidateIndex);

  for (const candidate of roughRanked) {
    const outcome = dispatchWithTelemetry(state, candidate.action, scoreContext);

    if (outcome.result.ok) {
      return outcome;
    }
  }

  return null;
}

function tryActionCandidates(state, candidates, context, dispatchWithTelemetry) {
  for (const candidate of candidates) {
    const outcome = dispatchWithTelemetry(state, candidate, context);

    if (outcome.result.ok) {
      return outcome;
    }
  }

  return null;
}

function playActivePlayerTurn(state, profile, context, dispatchWithTelemetry) {
  let workingState = resolvePendingBurdenChoices(state, profile, context, dispatchWithTelemetry);
  let guard = 0;

  while (workingState.phase === GAME_PHASES.PLAYER_TURNS && guard < 80) {
    guard += 1;
    const player = workingState.players.find((candidate) => candidate.id === workingState.activePlayerId);

    if (!player || player.actionsRemaining <= 0) {
      break;
    }

    let outcome = null;
    const openingCandidates = buildOpeningPlacementCandidates(workingState, profile, context);

    if (openingCandidates.length > 0) {
      outcome = tryActionCandidates(workingState, openingCandidates, context, dispatchWithTelemetry);

      if (outcome) {
        workingState = resolvePendingBurdenChoices(outcome.state, profile, context, dispatchWithTelemetry);
        break;
      }
    }

    if (profile.optimizeForScore) {
      outcome = tryScoreOptimizedAction(workingState, profile, context, dispatchWithTelemetry);
    } else {
      for (const priority of profile.priorities) {
        const candidates = buildActionCandidates(workingState, profile, context, priority);
        outcome = tryActionCandidates(workingState, candidates, context, dispatchWithTelemetry);

        if (outcome) {
          break;
        }
      }
    }

    if (!outcome) {
      break;
    }

    workingState = resolvePendingBurdenChoices(outcome.state, profile, context, dispatchWithTelemetry);
  }

  const endTurn = dispatchWithTelemetry(workingState, { type: TILE_ACTION_TYPES.END_TURN }, context);
  return endTurn.result.ok ? endTurn.state : workingState;
}

function createCsv(rows, fields) {
  const escapeValue = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  return [fields.join(","), ...rows.map((row) => fields.map((field) => escapeValue(row[field])).join(","))].join("\n");
}

export function simulationSummaryToCsv(rows) {
  return createCsv(rows, SIMULATION_SUMMARY_FIELDS);
}

export function simulationRoundsToCsv(rows) {
  return createCsv(rows, SIMULATION_ROUND_FIELDS);
}

export function runAutomatedGame({
  gameIndex = 1,
  playerCount,
  botProfile,
  seed,
  encounterCards,
  tiles,
  mapHexes
}) {
  const profile = typeof botProfile === "string" ? SIMULATION_BOT_PROFILES[botProfile] : botProfile;
  const profileId = profile?.id ?? "balanced";
  const gameId = `sim-${profileId}-${playerCount}p-${String(gameIndex).padStart(3, "0")}`;
  const tileIndex = createTileIndex(tiles);
  const context = { encounterCards, tiles, tileIndex };
  let state = createInitialGameState({
    playerCount,
    seed,
    encounterCards,
    tiles,
    mapHexes,
    enforceOpeningResourcePlacement: true
  });
  const summary = createSimulationAccumulator(gameId, seed, playerCount, profileId);
  const rounds = [];
  let round = createRoundAccumulator(gameId, state.round, state.season);

  const dispatchWithTelemetry = (currentState, action, actionContext = context) => {
    const outcome = dispatchGameAction(currentState, action, actionContext);
    recordDispatchResult(summary, round, outcome.result);
    return outcome;
  };

  let guard = 0;

  while (state.phase !== GAME_PHASES.COMPLETE && guard < 2500) {
    guard += 1;

    if (state.phase === GAME_PHASES.SEED_ENCOUNTERS) {
      const outcome = dispatchWithTelemetry(state, buildScoreSeedAction(state, profile, context), context);
      if (!outcome.result.ok) {
        throw new Error(outcome.result.errors.join(" "));
      }
      state = outcome.state;
      continue;
    }

    if (state.phase === GAME_PHASES.REVEAL_ENCOUNTERS) {
      const outcome = dispatchWithTelemetry(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }, context);
      if (!outcome.result.ok) {
        throw new Error(outcome.result.errors.join(" "));
      }
      state = resolvePendingBurdenChoices(outcome.state, profile, context, dispatchWithTelemetry);
      continue;
    }

    if (state.phase === GAME_PHASES.PLAYER_TURNS) {
      state = playActivePlayerTurn(state, profile, context, dispatchWithTelemetry);
      continue;
    }

    if (state.phase === GAME_PHASES.END_ROUND) {
      const endingRound = state.round;
      const outcome = dispatchWithTelemetry(state, { type: TILE_ACTION_TYPES.END_ROUND }, context);
      if (!outcome.result.ok) {
        throw new Error(outcome.result.errors.join(" "));
      }

      rounds.push(finalizeRound(summary, round, outcome.state, context));
      state = outcome.state;

      if (state.phase !== GAME_PHASES.COMPLETE) {
        round = createRoundAccumulator(gameId, state.round, state.season);
      } else if (endingRound !== round.round) {
        round = createRoundAccumulator(gameId, state.round, state.season);
      }
      continue;
    }
  }

  if (guard >= 2500) {
    throw new Error(`${gameId} exceeded the simulation step guard.`);
  }

  const finalScore = calculateScore(state, context);
  summary.final_score = finalScore.total;
  summary.final_population = finalScore.population;
  summary.final_renown = finalScore.renown;
  summary.final_strain_tokens = finalScore.strainTokens;
  summary.final_active_burdens = finalScore.activeBurdenCount;

  return {
    game: summary,
    rounds,
    finalState: state
  };
}

export function runSimulationBatch({
  gamesPerCombination = 100,
  playerCounts = [1, 2, 3, 4],
  botProfiles = Object.keys(SIMULATION_BOT_PROFILES),
  seedPrefix = "quiet-vale-simulation",
  encounterCards,
  tiles,
  mapHexes
}) {
  const gameRows = [];
  const roundRows = [];
  const errors = [];

  for (const botProfile of botProfiles) {
    for (const playerCount of playerCounts) {
      for (let gameIndex = 1; gameIndex <= gamesPerCombination; gameIndex += 1) {
        const seed = `${seedPrefix}-${botProfile}-${playerCount}p-${gameIndex}`;

        try {
          const result = runAutomatedGame({
            gameIndex,
            playerCount,
            botProfile,
            seed,
            encounterCards,
            tiles,
            mapHexes
          });

          gameRows.push(result.game);
          roundRows.push(...result.rounds);
        } catch (error) {
          errors.push({
            bot_profile: botProfile,
            player_count: playerCount,
            game_index: gameIndex,
            random_seed: seed,
            message: error.message
          });
        }
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    games_per_combination: gamesPerCombination,
    player_counts: playerCounts,
    bot_profiles: botProfiles,
    game_rows: gameRows,
    round_rows: roundRows,
    errors,
    csv: {
      games: simulationSummaryToCsv(gameRows),
      rounds: simulationRoundsToCsv(roundRows)
    }
  };
}
