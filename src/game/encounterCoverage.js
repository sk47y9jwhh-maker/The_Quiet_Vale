import {
  SEASON_EFFECT_FIELDS,
  getBoonEffectSupport,
  getBurdenEffectSupport,
  getBurdenResolutionCost,
  getEncounterSeasonEffect,
  getGoldenBoonEffectSupport
} from "./encounters.js";
import { ENCOUNTER_TYPES } from "./setup.js";

export const ENCOUNTER_COVERAGE_STATUSES = Object.freeze({
  SUPPORTED: "supported",
  PARTIAL: "partial",
  UNSUPPORTED: "unsupported"
});

const DEFAULT_RESOURCES = Object.freeze(["Food", "Wood", "Stone", "Goods", "Metal", "Herbs"]);
const ACTIVE_BURDEN_WITHOUT_RESOLUTION =
  /^Place this card on the Stewards Board as an active Burden\.$/i;

function summarizeResourceAmounts(payment = []) {
  const amounts = new Map();

  for (const { resource, amount } of payment) {
    amounts.set(resource, (amounts.get(resource) ?? 0) + amount);
  }

  return [...amounts.entries()].map(([resource, amount]) => ({ resource, amount }));
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
    cost: summarizeResourceAmounts(cost),
    errors
  };
}

function auditArrivalRequirement(requirementText, resources = DEFAULT_RESOURCES) {
  const text = String(requirementText ?? "").trim();
  if (!text) {
    return {
      supported: true,
      template: "no_resource_requirement",
      errors: [],
      cost: [],
      tileRequirements: []
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
    template: housingMatch ? "housing_plus_resource_requirement" : "resource_requirement",
    errors,
    cost: parsed.cost,
    tileRequirements
  };
}

function getStatus(allSupported, anySupported) {
  if (allSupported) {
    return ENCOUNTER_COVERAGE_STATUSES.SUPPORTED;
  }

  return anySupported ? ENCOUNTER_COVERAGE_STATUSES.PARTIAL : ENCOUNTER_COVERAGE_STATUSES.UNSUPPORTED;
}

function auditSeasonEffects(card, classifyEffect) {
  return Object.keys(SEASON_EFFECT_FIELDS).map((season) => ({
    season,
    ...classifyEffect(getEncounterSeasonEffect(card, season))
  }));
}

function auditBurdenLifecycle(card, resolution) {
  const lifecycleText = String(card.lifecycle_or_resolution ?? "").trim();

  if (resolution.supported) {
    return {
      supported: true,
      hasResolutionCost: true,
      template: `resolution_${resolution.mode}`,
      mode: resolution.mode,
      errors: [],
      lifecycleText
    };
  }

  if (ACTIVE_BURDEN_WITHOUT_RESOLUTION.test(lifecycleText)) {
    return {
      supported: true,
      hasResolutionCost: false,
      template: "persistent_active_burden_no_resolution",
      mode: "persistent_no_resolution",
      errors: [],
      lifecycleText
    };
  }

  return {
    supported: false,
    hasResolutionCost: false,
    template: null,
    mode: resolution.mode,
    errors: resolution.errors ?? [],
    lifecycleText
  };
}

function auditBoon(card) {
  const seasons = auditSeasonEffects(card, getBoonEffectSupport);
  const supportedRows = seasons.filter((season) => season.supported);
  const unsupportedRows = seasons.filter((season) => !season.supported);

  return {
    status: getStatus(unsupportedRows.length === 0, supportedRows.length > 0),
    reason:
      unsupportedRows.length === 0
        ? "All Season effects match implemented Boon templates."
        : "One or more Season effects does not match an implemented Boon template.",
    seasons,
    implementationAreas: [...new Set(supportedRows.map((season) => season.template).filter(Boolean))]
  };
}

function auditBurden(card) {
  const seasons = auditSeasonEffects(card, getBurdenEffectSupport);
  const resolution = getBurdenResolutionCost(card, "I");
  const lifecycle = auditBurdenLifecycle(card, resolution);
  const supportedRows = seasons.filter((season) => season.supported);
  const unsupportedRows = seasons.filter((season) => !season.supported);
  const allSupported = unsupportedRows.length === 0 && lifecycle.supported;

  return {
    status: getStatus(allSupported, supportedRows.length > 0 || lifecycle.supported),
    reason:
      unsupportedRows.length > 0
        ? "One or more Season effects does not match an implemented Burden template."
        : lifecycle.supported && lifecycle.hasResolutionCost
          ? "All Season effects and the resolution cost match implemented Burden templates."
          : lifecycle.supported
            ? "All Season effects and the persistent active-Burden lifecycle are covered."
            : "Season effects are covered, but the lifecycle or resolution text needs implementation coverage.",
    seasons,
    lifecycle,
    resolution: {
      supported: resolution.supported,
      mode: resolution.mode,
      errors: resolution.errors ?? []
    },
    implementationAreas: [
      ...new Set([
        ...supportedRows.map((season) => season.template).filter(Boolean),
        lifecycle.supported ? lifecycle.template : null
      ].filter(Boolean))
    ]
  };
}

function auditArrival(card, options) {
  const requirement = auditArrivalRequirement(card.requirement, options.resources);
  const unlockedSpecialTiles = (options.tiles ?? []).filter((tile) => tile.unlocked_by_arrival === card.card_name);
  const unlockSupported = unlockedSpecialTiles.length > 0;
  const allSupported = requirement.supported && unlockSupported;

  return {
    status: getStatus(allSupported, requirement.supported || unlockSupported),
    reason: allSupported
      ? "Arrival timer, requirement, completion, and Special Tile unlock are covered."
      : "Arrival lifecycle is covered, but a requirement or Special Tile unlock needs audit attention.",
    requirement,
    unlockedSpecialTileIds: unlockedSpecialTiles.map((tile) => tile.tile_id),
    implementationAreas: [
      "arrival_timer_lifecycle",
      requirement.template,
      unlockSupported ? "special_tile_unlock" : null
    ].filter(Boolean)
  };
}

function auditGoldenBoon(card) {
  const effect = getGoldenBoonEffectSupport(card.effect);

  if (effect.supported) {
    return {
      status: ENCOUNTER_COVERAGE_STATUSES.SUPPORTED,
      reason: "Golden Boon reveal cadence and bespoke effect are covered.",
      effect,
      implementationAreas: ["golden_boon_extra_reveal", effect.template]
    };
  }

  return {
    status: ENCOUNTER_COVERAGE_STATUSES.PARTIAL,
    reason: "Golden Boon reveal cadence is covered; bespoke Golden Boon effects are not implemented yet.",
    effect,
    implementationAreas: ["golden_boon_extra_reveal"]
  };
}

function auditCard(card, options) {
  const coverage =
    card.encounter_type === ENCOUNTER_TYPES.BOON
      ? auditBoon(card)
      : card.encounter_type === ENCOUNTER_TYPES.BURDEN
        ? auditBurden(card)
        : card.encounter_type === ENCOUNTER_TYPES.ARRIVAL
          ? auditArrival(card, options)
          : card.encounter_type === ENCOUNTER_TYPES.GOLDEN_BOON
            ? auditGoldenBoon(card)
            : {
                status: ENCOUNTER_COVERAGE_STATUSES.UNSUPPORTED,
                reason: `Unknown Encounter type: ${card.encounter_type}`,
                implementationAreas: []
              };

  return {
    cardId: card.card_id,
    cardName: card.card_name,
    encounterType: card.encounter_type,
    ...coverage
  };
}

function createEmptyStatusCounts() {
  return {
    [ENCOUNTER_COVERAGE_STATUSES.SUPPORTED]: 0,
    [ENCOUNTER_COVERAGE_STATUSES.PARTIAL]: 0,
    [ENCOUNTER_COVERAGE_STATUSES.UNSUPPORTED]: 0
  };
}

export function createEncounterCoverageAudit(encounterCards, options = {}) {
  const auditOptions = {
    tiles: options.tiles ?? [],
    resources: options.resources ?? DEFAULT_RESOURCES
  };
  const cards = encounterCards.map((card) => auditCard(card, auditOptions));
  const statusCounts = createEmptyStatusCounts();
  const typeCounts = {};

  for (const card of cards) {
    statusCounts[card.status] += 1;
    typeCounts[card.encounterType] ??= {
      total: 0,
      statuses: createEmptyStatusCounts()
    };
    typeCounts[card.encounterType].total += 1;
    typeCounts[card.encounterType].statuses[card.status] += 1;
  }

  return {
    total: cards.length,
    statusCounts,
    typeCounts,
    cards
  };
}
