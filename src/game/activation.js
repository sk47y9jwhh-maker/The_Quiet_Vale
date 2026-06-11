import { createMapIndex, getNeighborCoordinates } from "./map.js";
import { ENCOUNTER_TYPES } from "./setup.js";
import {
  canAffordCost,
  createTileIndex,
  getPlacedTileCoordinates,
  isOverstrainedPlacedTile,
  spendWarehouseResources
} from "./tiles.js";
import { isSupportedPlacedTile } from "./strain.js";
import { buildTravelNetworks, getNetworkForPlacedTile, isTravelTileDefinition } from "./travel.js";

const ACTIVATED_PREFIX = "(?:Activated Effect|Activate)";
const PRODUCTION_PREFIX = /^(?:Production|Activate):\s*Gain\s+(.+)\.$/i;
const REMOVE_ONE_ADJACENT_STRAIN = new RegExp(
  `^${ACTIVATED_PREFIX}:\\s*Remove 1 Strain from an adjacent tile\\.$`,
  "i"
);
const REMOVE_UP_TO_FROM_ONE_ADJACENT_TILE = new RegExp(
  `^${ACTIVATED_PREFIX}:\\s*Remove up to (\\d+) Strain from 1 adjacent tile\\.$`,
  "i"
);
const REMOVE_ONE_FROM_UP_TO_ADJACENT_TILES =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Remove 1 Strain from up to (\\d+) adjacent tiles\\.$`, "i");
const REMOVE_ONE_FROM_ONE_ADJACENT_CATEGORIES =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Remove 1 Strain from one adjacent (.+?) Tile\\.$`, "i");
const REMOVE_ONE_FROM_ONE_CATEGORIES =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Remove 1 Strain from one (.+?) Tile\\.$`, "i");
const ADD_ONE_ARRIVAL_TIMER =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Add 1 timer token to (?:one|an) active Arrival(?:, up to the normal maximum of 3 timer tokens| \\(max 3\\))\\.$`, "i");
const ADD_UP_TO_ARRIVAL_TIMERS =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Add up to (\\d+) timer tokens to (?:one|an) active Arrival(?:, up to the normal maximum of 3 timer tokens| \\(max 3\\))\\.$`, "i");
const FIXED_RESOURCE_EXCHANGE =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Exchange (\\d+) resources? in the Warehouse for (\\d+) ([A-Za-z]+)\\.$`, "i");
const FLEXIBLE_RESOURCE_EXCHANGE =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Exchange up to (\\d+) total resources in the Warehouse for the same number of non-Goods resources in any mix\\.`, "i");
const RESOLVE_ONE_ACTIVE_BURDEN = new RegExp(`^${ACTIVATED_PREFIX}:\\s*Resolve 1 active Burden\\.$`, "i");
const ENCOUNTER_DECK_PEEK =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Look at the top (\\d+) cards of the Encounter Deck, then return them in any order\\.$`, "i");
const GIVE_SUPPORTED_TO_ONE_ADJACENT =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Give Supported to (?:1|one) adjacent(?: (.+?))? Tiles?\\.$`, "i");
const GIVE_SUPPORTED_TO_UP_TO_ADJACENT =
  new RegExp(`^${ACTIVATED_PREFIX}:\\s*Give Supported to up to (\\d+) adjacent(?: (.+?))? Tiles?\\.$`, "i");
const RECEIVE_SUPPORTED_ON_PLACE_OR_ACTIVATE =
  /^(?:When placed\s*&\s*When Activated|When placed and When Activated)[:,]?\s*While this tile is not Overstrained,\s*up to (?:two|(\d+)) adjacent(?: (.+?))? tiles receive 1 Supported\.$/i;
const TRAVEL_NETWORK_SUPPORTED_ON_PLACE_OR_ACTIVATE =
  /^(?:When placed\s*&\s*When Activated|When placed and When Activated)[:,]?\s*While this tile is not Overstrained,\s*Travel Tiles in this tile's connected settlement network gain 1 Supported\.$/i;

export function parseProductionBenefit(benefitText) {
  const match = PRODUCTION_PREFIX.exec(String(benefitText ?? "").trim());

  if (!match) {
    return null;
  }

  return match[1]
    .split(/\s+and\s+|,/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const amountMatch = /^(\d+)\s+(.+)$/.exec(part);

      if (!amountMatch) {
        throw new Error(`Unsupported production benefit: ${part}`);
      }

      return {
        amount: Number(amountMatch[1]),
        resource: amountMatch[2]
      };
    });
}

export function getProductionGains(tile) {
  return parseProductionBenefit(tile?.benefit);
}

function getActivatedEffectBenefit(tile) {
  const benefit = String(tile?.benefit ?? "").trim();
  const oncePerSeason = /^(?:Activated Effect|Activate),\s*once per Season:/i.test(benefit);

  return {
    benefit: oncePerSeason ? benefit.replace(/^(?:Activated Effect|Activate),\s*once per Season:/i, "Activate:") : benefit,
    oncePerSeason
  };
}

function parseTargetCategories(categoryText) {
  return String(categoryText)
    .replace(/,\s*or\s+/i, ", ")
    .replace(/\s+or\s+/i, ", ")
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean);
}

export function getStrainRemovalEffect(tile) {
  const { benefit, oncePerSeason } = getActivatedEffectBenefit(tile);
  const upToMatch = REMOVE_UP_TO_FROM_ONE_ADJACENT_TILE.exec(benefit);
  const multiTargetMatch = REMOVE_ONE_FROM_UP_TO_ADJACENT_TILES.exec(benefit);
  const categoryMatch = REMOVE_ONE_FROM_ONE_ADJACENT_CATEGORIES.exec(benefit);
  const categoryAnywhereMatch = REMOVE_ONE_FROM_ONE_CATEGORIES.exec(benefit);

  if (REMOVE_ONE_ADJACENT_STRAIN.test(benefit)) {
    return {
      type: "remove_strain_adjacent",
      amount: 1,
      maxTargets: 1,
      oncePerSeason
    };
  }

  if (upToMatch) {
    return {
      type: "remove_strain_adjacent",
      amount: Number(upToMatch[1]),
      maxTargets: 1,
      oncePerSeason
    };
  }

  if (multiTargetMatch) {
    return {
      type: "remove_strain_adjacent",
      amount: 1,
      maxTargets: Number(multiTargetMatch[1]),
      oncePerSeason
    };
  }

  if (categoryMatch) {
    return {
      type: "remove_strain_adjacent",
      amount: 1,
      maxTargets: 1,
      targetCategories: parseTargetCategories(categoryMatch[1]),
      oncePerSeason
    };
  }

  if (categoryAnywhereMatch) {
    return {
      type: "remove_strain_adjacent",
      amount: 1,
      maxTargets: 1,
      targetCategories: parseTargetCategories(categoryAnywhereMatch[1]),
      adjacent: false,
      oncePerSeason
    };
  }

  return null;
}

export function getArrivalTimerEffect(tile) {
  const { benefit, oncePerSeason } = getActivatedEffectBenefit(tile);
  const upToMatch = ADD_UP_TO_ARRIVAL_TIMERS.exec(benefit);

  if (ADD_ONE_ARRIVAL_TIMER.test(benefit)) {
    return {
      type: "add_arrival_timer",
      amount: 1,
      maxTargets: 1,
      oncePerSeason
    };
  }

  if (upToMatch) {
    return {
      type: "add_arrival_timer",
      amount: Number(upToMatch[1]),
      maxTargets: 1,
      oncePerSeason
    };
  }

  return null;
}

export function getResourceExchangeEffect(tile) {
  const { benefit, oncePerSeason } = getActivatedEffectBenefit(tile);
  const match = FIXED_RESOURCE_EXCHANGE.exec(benefit);
  const flexibleMatch = FLEXIBLE_RESOURCE_EXCHANGE.exec(benefit);

  if (match) {
    return {
      type: "resource_exchange",
      oncePerSeason,
      paymentAmount: Number(match[1]),
      gain: {
        amount: Number(match[2]),
        resource: match[3]
      }
    };
  }

  if (flexibleMatch) {
    return {
      type: "flexible_resource_exchange",
      oncePerSeason,
      maxAmount: Number(flexibleMatch[1]),
      excludedGainResources: ["Goods"]
    };
  }

  return null;
}

export function getResolveActiveBurdenEffect(tile) {
  const { benefit, oncePerSeason } = getActivatedEffectBenefit(tile);

  if (!RESOLVE_ONE_ACTIVE_BURDEN.test(benefit)) {
    return null;
  }

  return {
    type: "resolve_active_burden",
    oncePerSeason,
    maxTargets: 1
  };
}

export function getEncounterDeckPeekEffect(tile) {
  const { benefit, oncePerSeason } = getActivatedEffectBenefit(tile);
  const match = ENCOUNTER_DECK_PEEK.exec(benefit);

  if (!match) {
    return null;
  }

  return {
    type: "encounter_deck_peek",
    oncePerSeason,
    count: Number(match[1])
  };
}

function parseSupportedTargetCategories(categoryText) {
  if (!categoryText) {
    return [];
  }

  const normalized = String(categoryText)
    .replace(/\btiles?\b/gi, "")
    .trim();

  if (!normalized || normalized.toLowerCase() === "placed") {
    return [];
  }

  return parseTargetCategories(normalized);
}

export function getGiveSupportedEffect(tile) {
  const { benefit, oncePerSeason } = getActivatedEffectBenefit(tile);
  const upToMatch = GIVE_SUPPORTED_TO_UP_TO_ADJACENT.exec(benefit);
  const oneMatch = GIVE_SUPPORTED_TO_ONE_ADJACENT.exec(benefit);
  const onPlaceOrActivateMatch = RECEIVE_SUPPORTED_ON_PLACE_OR_ACTIVATE.exec(benefit);
  const travelNetworkMatch = TRAVEL_NETWORK_SUPPORTED_ON_PLACE_OR_ACTIVATE.exec(benefit);

  if (onPlaceOrActivateMatch) {
    return {
      type: "give_supported_adjacent",
      maxTargets: Number(onPlaceOrActivateMatch[1] ?? 2),
      targetCategories: parseSupportedTargetCategories(onPlaceOrActivateMatch[2]),
      oncePerSeason,
      triggers: ["placement", "activation"]
    };
  }

  if (travelNetworkMatch) {
    return {
      type: "give_supported_travel_network",
      maxTargets: null,
      targetCategories: ["Travel"],
      oncePerSeason,
      triggers: ["placement", "activation"]
    };
  }

  if (upToMatch) {
    return {
      type: "give_supported_adjacent",
      maxTargets: Number(upToMatch[1]),
      targetCategories: parseSupportedTargetCategories(upToMatch[2]),
      oncePerSeason,
      triggers: ["activation"]
    };
  }

  if (oneMatch) {
    return {
      type: "give_supported_adjacent",
      maxTargets: 1,
      targetCategories: parseSupportedTargetCategories(oneMatch[1]),
      oncePerSeason,
      triggers: ["activation"]
    };
  }

  return null;
}

export function getPlacementSupportEffect(tile) {
  const support = getGiveSupportedEffect(tile);

  if (!support?.triggers?.includes("placement")) {
    return null;
  }

  return support;
}

export function getActivationDetails(tile) {
  const gains = getProductionGains(tile);

  if (gains) {
    return {
      type: "production",
      gains
    };
  }

  return (
    getStrainRemovalEffect(tile) ??
    getArrivalTimerEffect(tile) ??
    getResourceExchangeEffect(tile) ??
    getResolveActiveBurdenEffect(tile) ??
    getEncounterDeckPeekEffect(tile) ??
    getGiveSupportedEffect(tile)
  );
}

export function getAdjacentPlacedTiles(state, placedTile) {
  if (!placedTile) {
    return [];
  }

  const mapIndex = createMapIndex(state.map.hexes);
  const placedTileCoordinates = getPlacedTileCoordinates(placedTile);
  const neighborCoordinates = new Set(
    placedTileCoordinates.flatMap((coordinate) => getNeighborCoordinates(coordinate, mapIndex))
  );

  return state.map.placedTiles.filter((candidate) => {
    if (candidate.id === placedTile.id) {
      return false;
    }

    return getPlacedTileCoordinates(candidate).some((coordinate) => neighborCoordinates.has(coordinate));
  });
}

function getRequestedStrainRemovalTargets(action, activation) {
  const maxTargets = activation.maxTargets ?? 1;
  const ids = maxTargets > 1 ? action.targetPlacedTileIds : [action.targetPlacedTileId];

  return (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
}

function summarizePayment(payment = []) {
  const amounts = new Map();

  for (const { resource, amount } of payment) {
    amounts.set(resource, (amounts.get(resource) ?? 0) + amount);
  }

  return [...amounts.entries()].map(([resource, amount]) => ({ resource, amount }));
}

function describeCategories(categories) {
  if (categories.length <= 1) {
    return categories[0] ?? "";
  }

  return `${categories.slice(0, -1).join(", ")} or ${categories.at(-1)}`;
}

export function getTravelNetworkSupportTargets(state, sourcePlacedTile, tileIndex) {
  const networks = buildTravelNetworks(state, { tileIndex });
  const network = getNetworkForPlacedTile(networks, sourcePlacedTile.id);

  if (!network) {
    return [];
  }

  return state.map.placedTiles.filter((candidate) => {
    if (!network.tileIds.includes(candidate.id) || candidate.id === sourcePlacedTile.id) {
      return false;
    }

    if (isOverstrainedPlacedTile(candidate) || isSupportedPlacedTile(candidate)) {
      return false;
    }

    return isTravelTileDefinition(tileIndex.get(candidate.tileId));
  });
}

export function validateActivateTile(state, action, context) {
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
    errors.push("Overstrained tiles cannot be activated.");
  }

  let activation = null;
  try {
    activation = getActivationDetails(tile);
  } catch (error) {
    errors.push(`${tile.tile_name} has an unsupported activation benefit.`);
  }

  if (!activation) {
    errors.push(`${tile.tile_name} does not have a supported activation yet.`);
  }

  if (activation?.oncePerSeason && placedTile.activatedEffectSeasons?.includes(state.season)) {
    errors.push(`${tile.tile_name} has already used its activated effect in Season ${state.season}.`);
  }

  let targetPlacedTile = null;
  let targetPlacedTiles = [];
  let strainRemovals = [];
  let strainRemoved = 0;
  let targetActiveEncounter = null;
  let timerTokensAdded = 0;
  let exchangeCost = [];
  let exchangeGain = null;
  let exchangeGains = [];
  let encounterDeckPeek = null;
  let supportTargetPlacedTiles = [];
  if (activation?.type === "remove_strain_adjacent") {
    const maxTargets = activation.maxTargets ?? 1;
    const requestedTargetIds = getRequestedStrainRemovalTargets(action, activation);
    const uniqueTargetIds = new Set(requestedTargetIds);
    const requiresAdjacency = activation.adjacent !== false;
    const adjacentPlacedTiles = getAdjacentPlacedTiles(state, placedTile);
    const targetScopeText = requiresAdjacency ? "adjacent tile" : "tile";

    if (requestedTargetIds.length === 0) {
      errors.push(`Choose a ${targetScopeText} with Strain to target.`);
    }

    if (requestedTargetIds.length > maxTargets) {
      errors.push(`${tile.tile_name} can target at most ${maxTargets} ${requiresAdjacency ? "adjacent " : ""}tile${maxTargets === 1 ? "" : "s"}.`);
    }

    if (uniqueTargetIds.size !== requestedTargetIds.length) {
      errors.push("Choose each Strain removal target only once.");
    }

    targetPlacedTiles = requestedTargetIds
      .map((targetId) => state.map.placedTiles.find((candidate) => candidate.id === targetId))
      .filter(Boolean);
    targetPlacedTile = targetPlacedTiles[0] ?? null;

    for (const targetId of requestedTargetIds) {
      const target = state.map.placedTiles.find((candidate) => candidate.id === targetId);

      if (!target) {
        errors.push(`Unknown Strain removal target: ${targetId}`);
      } else if (requiresAdjacency && !adjacentPlacedTiles.some((candidate) => candidate.id === target.id)) {
        errors.push(`${target.id} is not adjacent to ${tile.tile_name}.`);
      } else if (
        activation.targetCategories?.length &&
        !activation.targetCategories.includes(tileIndex.get(target.tileId)?.tile_category)
      ) {
        errors.push(`${target.id} is not a ${describeCategories(activation.targetCategories)} Tile.`);
      } else if ((target.strain ?? 0) <= 0) {
        errors.push(`${target.id} has no Strain to remove.`);
      }
    }

    if (errors.length === 0) {
      strainRemovals = targetPlacedTiles.map((target) => ({
        placedTile: target,
        strainRemoved: Math.min(activation.amount, target.strain ?? 0)
      }));
      strainRemoved = strainRemovals.reduce((total, removal) => total + removal.strainRemoved, 0);
    }
  }

  if (activation?.type === "give_supported_adjacent") {
    const maxTargets = activation.maxTargets ?? 1;
    const requestedTargetIds = getRequestedStrainRemovalTargets(action, activation);
    const uniqueTargetIds = new Set(requestedTargetIds);
    const adjacentPlacedTiles = getAdjacentPlacedTiles(state, placedTile);

    if (requestedTargetIds.length === 0) {
      errors.push("Choose an adjacent tile to give Supported.");
    }

    if (requestedTargetIds.length > maxTargets) {
      errors.push(`${tile.tile_name} can give Supported to at most ${maxTargets} adjacent tile${maxTargets === 1 ? "" : "s"}.`);
    }

    if (uniqueTargetIds.size !== requestedTargetIds.length) {
      errors.push("Choose each Supported target only once.");
    }

    supportTargetPlacedTiles = requestedTargetIds
      .map((targetId) => state.map.placedTiles.find((candidate) => candidate.id === targetId))
      .filter(Boolean);
    targetPlacedTiles = supportTargetPlacedTiles;
    targetPlacedTile = targetPlacedTiles[0] ?? null;

    for (const targetId of requestedTargetIds) {
      const target = state.map.placedTiles.find((candidate) => candidate.id === targetId);

      if (!target) {
        errors.push(`Unknown Supported target: ${targetId}`);
      } else if (!adjacentPlacedTiles.some((candidate) => candidate.id === target.id)) {
        errors.push(`${target.id} is not adjacent to ${tile.tile_name}.`);
      } else if (
        activation.targetCategories?.length &&
        !activation.targetCategories.includes(tileIndex.get(target.tileId)?.tile_category)
      ) {
        errors.push(`${target.id} is not a ${describeCategories(activation.targetCategories)} Tile.`);
      } else if (isOverstrainedPlacedTile(target)) {
        errors.push(`${target.id} is Overstrained and cannot receive Supported.`);
      } else if (isSupportedPlacedTile(target)) {
        errors.push(`${target.id} already has Supported.`);
      }
    }
  }

  if (activation?.type === "give_supported_travel_network") {
    supportTargetPlacedTiles = getTravelNetworkSupportTargets(state, placedTile, tileIndex);
    targetPlacedTiles = supportTargetPlacedTiles;
    targetPlacedTile = supportTargetPlacedTiles[0] ?? null;

    if (supportTargetPlacedTiles.length === 0) {
      errors.push("No eligible Travel Tiles in this tile's connected settlement network can receive Supported.");
    }
  }

  if (activation?.type === "add_arrival_timer") {
    targetActiveEncounter = state.encounter.active.find(
      (activeEncounter) => activeEncounter.id === action.targetActiveEncounterId
    );

    if (!targetActiveEncounter) {
      errors.push("Choose an active Arrival to receive timer tokens.");
    } else if (targetActiveEncounter.encounterType !== ENCOUNTER_TYPES.ARRIVAL || targetActiveEncounter.completed) {
      errors.push(`${targetActiveEncounter.id} is not an active Arrival.`);
    } else {
      const timerMax = state.rules.arrivalTimerMax ?? 3;
      const currentTimerTokens = Number(targetActiveEncounter.timerTokens ?? state.rules.arrivalStartTimerTokens ?? 3);
      const availableTimerSlots = Math.max(0, timerMax - currentTimerTokens);

      if (availableTimerSlots <= 0) {
        errors.push(`${targetActiveEncounter.id} already has the maximum timer tokens.`);
      } else {
        timerTokensAdded = Math.min(activation.amount, availableTimerSlots);
      }
    }
  }

  if (activation?.type === "resolve_active_burden") {
    targetActiveEncounter = state.encounter.active.find(
      (activeEncounter) => activeEncounter.id === action.targetActiveEncounterId
    );

    if (!targetActiveEncounter) {
      errors.push("Choose an active Burden to resolve.");
    } else if (targetActiveEncounter.encounterType !== ENCOUNTER_TYPES.BURDEN || targetActiveEncounter.resolved) {
      errors.push(`${targetActiveEncounter.id} is not an unresolved active Burden.`);
    }
  }

  if (activation?.type === "resource_exchange") {
    exchangeCost = summarizePayment(action.payment ?? []);
    exchangeGain = activation.gain;
    exchangeGains = [activation.gain];
    const allowedResources = state.rules.resources;
    const totalPaid = exchangeCost.reduce((total, entry) => total + entry.amount, 0);

    for (const { resource, amount } of exchangeCost) {
      if (!allowedResources.includes(resource)) {
        errors.push(`${resource} is not a valid Warehouse resource.`);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Exchange payment amounts must be positive whole numbers.");
      }
    }

    if (totalPaid !== activation.paymentAmount) {
      errors.push(`Choose exactly ${activation.paymentAmount} resources to exchange.`);
    }

    if (errors.length === 0 && !canAffordCost(state.warehouse, exchangeCost)) {
      errors.push(`${tile.tile_name} needs ${activation.paymentAmount} resources available in the Warehouse.`);
    }

    if (errors.length === 0) {
      const warehouseAfterPayment = spendWarehouseResources(state.warehouse, exchangeCost);
      const targetResourceAfterPayment = warehouseAfterPayment.resources[exchangeGain.resource] ?? 0;
      const availableGainSpace = state.warehouse.cap - targetResourceAfterPayment;

      if (availableGainSpace < exchangeGain.amount) {
        errors.push(`${exchangeGain.resource} is at the Warehouse cap.`);
      }
    }
  }

  if (activation?.type === "flexible_resource_exchange") {
    exchangeCost = summarizePayment(action.payment ?? []);
    exchangeGains = summarizePayment(action.gains ?? []);
    const allowedPaymentResources = state.rules.resources;
    const allowedGainResources = state.rules.resources.filter(
      (resource) => !activation.excludedGainResources.includes(resource)
    );
    const totalPaid = exchangeCost.reduce((total, entry) => total + entry.amount, 0);
    const totalGained = exchangeGains.reduce((total, entry) => total + entry.amount, 0);

    for (const { resource, amount } of exchangeCost) {
      if (!allowedPaymentResources.includes(resource)) {
        errors.push(`${resource} is not a valid Warehouse resource.`);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Exchange payment amounts must be positive whole numbers.");
      }
    }

    for (const { resource, amount } of exchangeGains) {
      if (!allowedGainResources.includes(resource)) {
        errors.push(`${resource} is not a valid exchange gain resource.`);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Exchange gain amounts must be positive whole numbers.");
      }
    }

    if (totalPaid < 1 || totalPaid > activation.maxAmount) {
      errors.push(`Choose 1-${activation.maxAmount} resources to exchange.`);
    }

    if (totalGained !== totalPaid) {
      errors.push("Choose the same number of resources to gain as you pay.");
    }

    if (errors.length === 0 && !canAffordCost(state.warehouse, exchangeCost)) {
      errors.push(`${tile.tile_name} needs the chosen resources available in the Warehouse.`);
    }

    if (errors.length === 0) {
      const warehouseAfterPayment = spendWarehouseResources(state.warehouse, exchangeCost);

      for (const { resource, amount } of exchangeGains) {
        const availableGainSpace = state.warehouse.cap - (warehouseAfterPayment.resources[resource] ?? 0);

        if (availableGainSpace < amount) {
          errors.push(`${resource} does not have enough Warehouse space.`);
        }
      }
    }
  }

  if (activation?.type === "encounter_deck_peek") {
    const peekedCardIds = state.encounter.deck.slice(0, activation.count);
    const orderedCardIds = action.orderedEncounterCardIds ?? peekedCardIds;

    if (peekedCardIds.length === 0) {
      errors.push("Encounter Deck is empty.");
    }

    if (!Array.isArray(orderedCardIds)) {
      errors.push("Return order must be a list of Encounter card ids.");
    } else {
      const peekedCounts = summarizePayment(peekedCardIds.map((cardId) => ({ resource: cardId, amount: 1 })));
      const orderedCounts = summarizePayment(orderedCardIds.map((cardId) => ({ resource: cardId, amount: 1 })));

      if (orderedCardIds.length !== peekedCardIds.length) {
        errors.push(`Return exactly ${peekedCardIds.length} peeked Encounter card${peekedCardIds.length === 1 ? "" : "s"}.`);
      }

      const sameCards =
        peekedCounts.length === orderedCounts.length &&
        peekedCounts.every((peeked) =>
          orderedCounts.some((ordered) => ordered.resource === peeked.resource && ordered.amount === peeked.amount)
        );

      if (!sameCards) {
        errors.push("Return order must contain the same Encounter cards that were peeked.");
      }
    }

    if (errors.length === 0) {
      encounterDeckPeek = {
        peekedCardIds,
        orderedCardIds: [...orderedCardIds]
      };
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    placedTile,
    tile,
    activation,
    gains: activation?.type === "production" ? activation.gains : [],
    targetPlacedTile,
    targetPlacedTiles,
    strainRemovalTargets: strainRemovals,
    strainRemoved,
    targetActiveEncounter,
    timerTokensAdded,
    exchangeCost,
    exchangeGain,
    exchangeGains,
    encounterDeckPeek,
    supportTargetPlacedTiles
  };
}
