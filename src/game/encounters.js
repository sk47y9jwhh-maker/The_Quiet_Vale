import { createMapIndex, getNeighborCoordinates } from "./map.js";
import { ENCOUNTER_TYPES, createEncounterIndex } from "./setup.js";
import { getEffectiveSupportDetails } from "./passives.js";
import { applyStrainToPlacedTile } from "./strain.js";
import { createTileIndex, getPlacedTileCoordinates, isOverstrainedPlacedTile } from "./tiles.js";

export const SEASON_EFFECT_FIELDS = Object.freeze({
  I: "season_i",
  II: "season_ii",
  III: "season_iii"
});

const EACH_RESOURCE_PRODUCTION_BONUS =
  /^Each time this round a (.+?) is activated for its Resource production, gain (.+)\.$/i;
const LIMITED_RESOURCE_PRODUCTION_BONUS =
  /^The (next time|first two times) this round (.+?) are activated for Resource production, gain (.+)\.$/i;
const NEXT_RESOURCE_PRODUCTION_BONUS =
  /^The next time this round a (.+?) is activated for Resource production, gain (.+)\.$/i;
const CHOICE_RESOURCE_PRODUCTION_BONUS =
  /^Each time this round a (.+?) is activated for its Resource production, gain (\d+) additional resources; choose ([A-Za-z]+) or ([A-Za-z]+) each time\.$/i;
const ADD_ONE_TIMER_TO_ACTIVE_ARRIVAL =
  /^Add 1 timer token to 1 active Arrival, up to the normal maximum of (\d+) timer tokens\.$/i;
const ADD_TIMERS_AMONG_ACTIVE_ARRIVALS =
  /^Add up to (\d+) timer tokens divided among active Arrivals, up to the normal maximum of (\d+) timer tokens on each Arrival\.$/i;
const LOOK_AT_ENCOUNTER_DECK_SAME_ORDER =
  /^Look at the top (\d+) cards of the Encounter Deck, then return them in the same order\.$/i;
const LOOK_AT_ENCOUNTER_DECK_ANY_ORDER =
  /^Look at the top (\d+) cards of the Encounter Deck, then return them in any order(?:, then you may place the bottom one on top)?\.$/i;
const NEXT_CORE_UPGRADE_DISCOUNT =
  /^Keep this card face-up\. The next time players upgrade a Core Tile, reduce that upgrade's resource cost by (\d+) resources? of your choice\. Then discard this card\.$/i;
const NEXT_ARRIVAL_REQUIREMENT_DISCOUNT =
  /^Keep this card face-up\. The next time players complete an Arrival, reduce its resource Requirement by (\d+) resources? of your choice\. Then discard this card\.$/i;
const NEXT_BURDEN_RESOLUTION_DISCOUNT =
  /^Keep this card face-up\. The next time players resolve an active Burden, reduce its resource cost by (\d+) resources? of your choice\. Then discard this card\.$/i;
const NEXT_PLACED_CATEGORY_ALLOWED_RESOURCE_DISCOUNT =
  /^The next ([A-Za-z]+) Tile placed this round costs (\d+) fewer ([A-Za-z]+) or ([A-Za-z]+)\.$/i;
const TILE_PLACEMENT_RESOURCE_DISCOUNT =
  /^The next (?:(two) tiles?|tile) placed this round (?:each )?costs? (\d+) fewer resources? of your choice\.$/i;
const CATEGORY_PLACED_OR_UPGRADED_RESOURCE_DISCOUNT =
  /^(?:The next|One) ([A-Za-z]+) Tile placed or upgraded this round costs (?:(\d+) fewer resources?(?: of your choice| total)?|0 Resources)(?:; it still costs its normal action)?\.$/i;
const TILE_PLACED_OR_UPGRADED_RESOURCE_DISCOUNT =
  /^The next (?:(two) tiles?|tile) placed or upgraded this round (?:each )?costs? (\d+) fewer resources?(?: of your choice| total)?\.$/i;
const FREE_NEXT_TILE_PLACEMENT =
  /^The next (?:(.+?) Tile|tile) placed this round costs 0 Resources\.?$/i;
const TRAVEL_TILE_ACTION_DISCOUNT =
  /^The next (?:(two) )?Travel Tiles? placed( or upgraded)? this round costs? 0 Actions?\.$/i;
const REMOVE_STRAIN_FROM_SUPPORTED_TILE =
  /^Remove 1 Strain from (?:(\d+)|up to (\d+)) Supported tiles?\.$/i;
const FROM_THE_BRINK_STRAIN_RELIEF =
  /^Remove up to 2 Strain from (?:(\d+) Overstrained tile|up to (\d+) Overstrained tiles)\. If no Strain was removed this way, remove 1 Strain from (?:(\d+) placed tile|up to (\d+) placed tiles) instead\.$/i;
const OPTIONAL_RESOURCE_STRAIN_RELIEF = /^You may spend (\d+) ([A-Za-z]+) to remove (?:1 Strain|up to (\d+) Strain from one(?: (.+?))? tile|up to (\d+) Strain split across up to (\d+)(?: (.+?))? tiles)$/i;
const OPTIONAL_RESOURCE_EXCHANGE =
  /^Exchange up to (\d+) resources in the Warehouse for the same number of resources of any type\.$/i;
const STEWARD_TOKEN_BOON_HELP =
  /^Choose each tile occupied by one or more Steward Tokens\. For each chosen tile, remove 1 Strain from it\. For each chosen tile that had no Strain, gain (\d+) resources? of your choice instead\. Gain no more than (\d+) total resources this way\.$/i;
const RESOURCE_BURDEN_STRAIN_PLACEMENT =
  /^Choose 1 (Farm|Forest|Mine|Wildlands|Dig Site) with fewer than 3 Strain\. Place (\d+) Strain on it(?:\. Then choose 1 adjacent (placed tile|Travel Tile or Resource Tile|Housing Tile or Travel Tile) with fewer than 3 Strain\. Place 1 Strain on it)?\.$/i;
const ADJACENT_CATEGORY_BURDEN_STRAIN_PLACEMENT =
  /^Choose (\d+) ([A-Za-z]+) Tiles? adjacent to (?:a )?([A-Za-z]+) Tiles?, (?:each )?with fewer than 3 Strain\. Place 1 Strain on (?:it|each chosen tile)\.$/i;
const ADJACENT_STRAINED_CATEGORY_BURDEN_STRAIN_PLACEMENT =
  /^Choose (\d+) ([A-Za-z]+) Tiles? adjacent to (?:a )?([A-Za-z]+) Tiles? with 1 or more Strain, (?:each )?with fewer than 3 Strain\. Place 1 Strain on (?:it|each chosen tile)\.$/i;
const NOT_ADJACENT_CATEGORY_BURDEN_STRAIN_PLACEMENT =
  /^Choose (\d+) ([A-Za-z]+) Tiles? not adjacent to (?:a )?([A-Za-z]+) Tiles?, (?:each )?with fewer than 3 Strain\. Place 1 Strain on (?:it|each chosen tile)\.$/i;
const OTHER_CATEGORY_BURDEN_STRAIN_PLACEMENT =
  /^Choose (?:(\d+) Merchant Tiles? or Crafting Tiles?|(\d+) Merchant Tiles? and (\d+) Crafting Tiles?)(?:,)? (?:each )?adjacent to the other category(?:,| and) with fewer than 3 Strain\. Place 1 Strain on (?:it|each chosen tile)\.$/i;
const DIRECT_CATEGORY_CHOICE_BURDEN_STRAIN_PLACEMENT =
  /^Choose (\d+) ([A-Za-z]+) Tiles? or ([A-Za-z]+) Tiles? with fewer than 3 Strain\. Place 1 Strain on (?:it|each chosen tile)(?:\. Then lose 1 ([A-Za-z]+) if able)?\.$/i;
const CATEGORY_PAY_OR_STRAIN_BURDEN_CHOICE =
  /^Choose (\d+) (.+?) with fewer than 3 Strain\. (?:(For each chosen tile), )?Pay (.+?)(?:,)? or place 1 Strain on (it|each chosen tile)\.$/i;
const ARRIVAL_PAY_OR_TIMER_BURDEN_CHOICE =
  /^Choose (\d+) active Arrivals?\. (?:(For each chosen Arrival), )?Pay (\d+) ([A-Za-z]+) or remove 1 timer token from it\. If there are no active Arrivals, this Burden has no effect\.$/i;
const CHOSEN_RESOURCE_LOSS_OR_STRAIN_BURDEN_CHOICE =
  /^Choose (.+?)\. Lose (\d+) of that resource, or choose (\d+) (Resource Tiles?|placed tiles?) with fewer than 3 Strain and place 1 Strain on (it|each chosen tile)\.$/i;
const MOST_RESOURCE_LOSS_OR_STRAIN_BURDEN_CHOICE =
  /^Identify the resource type with the most markers in the Warehouse\. Lose (\d+) of that resource, or choose (\d+) placed tiles? with fewer than 3 Strain\. Place 1 Strain on (it|each chosen tile)\.$/i;
const UPGRADED_CORE_BURDEN_STRAIN_PLACEMENT =
  /^Choose 1 upgraded Core Tile with fewer than 3 Strain\. Place (\d+) Strain on it(?:\. Then choose 1 adjacent placed tile with fewer than 3 Strain\. Place 1 Strain on it)?\.$/i;
const RENOWN_BURDEN_STRAIN_PLACEMENT =
  /^Choose (\d+) tiles? with Renown and fewer than 3 Strain\. Place 1 Strain on (?:it|each chosen tile)\.$/i;
const QUIET_FRACTURES_STRAINED_TILE =
  /^Choose 1 tile with 1 or more Strain and fewer than 3 Strain\. Place 1 Strain on it(?:\. Then choose 1 adjacent placed tile with 0 Strain\. Place 1 Strain on it)?\.$/i;
const QUIET_FRACTURES_OVERSTRAINED_SPREAD =
  /^Choose 1 Overstrained tile\. Then choose 2 adjacent placed tiles with 0 Strain\. Place 1 Strain on each chosen tile\. If there are no Overstrained tiles, resolve the Season II effect instead\.$/i;
const STEWARD_TOKEN_BURDEN_STRAIN_PLACEMENT =
  /^Choose each tile occupied by one or more Steward Tokens with fewer than 3 Strain\. Place 1 Strain on each chosen tile(?:\. Then choose 1 Steward House with fewer than 3 Strain\. Place 1 Strain on it)?\.$/i;

export function createEncounterStateId(state) {
  return `encounter-r${String(state.round).padStart(2, "0")}-${String(state.encounter.active.length + 1).padStart(2, "0")}`;
}

export function getEncounterSeasonEffect(card, season) {
  return card?.[SEASON_EFFECT_FIELDS[season]] ?? null;
}

function normalizeResourceSourceName(sourceName) {
  if (sourceName === "Wildlands") {
    return sourceName;
  }

  return sourceName.endsWith("s") ? sourceName.slice(0, -1) : sourceName;
}

function parseAdditionalGains(gainText) {
  return gainText
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d+) additional ([A-Za-z]+)$/.exec(part);

      if (!match) {
        return null;
      }

      return {
        amount: Number(match[1]),
        resource: match[2]
      };
    });
}

export function createBoonRoundEffect(state, card, index = 0) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = getEncounterSeasonEffect(card, state.season);
  const coreUpgradeDiscountMatch = NEXT_CORE_UPGRADE_DISCOUNT.exec(String(effectText ?? "").trim());
  const arrivalRequirementDiscountMatch = NEXT_ARRIVAL_REQUIREMENT_DISCOUNT.exec(String(effectText ?? "").trim());
  const burdenResolutionDiscountMatch = NEXT_BURDEN_RESOLUTION_DISCOUNT.exec(String(effectText ?? "").trim());
  const placedCategoryAllowedResourceDiscountMatch = NEXT_PLACED_CATEGORY_ALLOWED_RESOURCE_DISCOUNT.exec(
    String(effectText ?? "").trim()
  );
  const tilePlacementResourceDiscountMatch = TILE_PLACEMENT_RESOURCE_DISCOUNT.exec(String(effectText ?? "").trim());
  const categoryPlacedOrUpgradedResourceDiscountMatch = CATEGORY_PLACED_OR_UPGRADED_RESOURCE_DISCOUNT.exec(
    String(effectText ?? "").trim()
  );
  const tilePlacedOrUpgradedResourceDiscountMatch = TILE_PLACED_OR_UPGRADED_RESOURCE_DISCOUNT.exec(
    String(effectText ?? "").trim()
  );
  const freeNextPlacementMatch = FREE_NEXT_TILE_PLACEMENT.exec(String(effectText ?? "").trim());
  const travelTileActionDiscountMatch = TRAVEL_TILE_ACTION_DISCOUNT.exec(String(effectText ?? "").trim());
  const choiceMatch = CHOICE_RESOURCE_PRODUCTION_BONUS.exec(String(effectText ?? "").trim());
  const nextMatch = NEXT_RESOURCE_PRODUCTION_BONUS.exec(String(effectText ?? "").trim());
  const limitedMatch = LIMITED_RESOURCE_PRODUCTION_BONUS.exec(String(effectText ?? "").trim());
  const eachMatch = EACH_RESOURCE_PRODUCTION_BONUS.exec(String(effectText ?? "").trim());

  if (coreUpgradeDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "core_upgrade_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: Number(coreUpgradeDiscountMatch[1]),
      maxUses: 1,
      uses: 0,
      expiresAtEndOfRound: false,
      discardOnReveal: false,
      discardAfterUse: true
    };
  }

  if (arrivalRequirementDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "arrival_requirement_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: Number(arrivalRequirementDiscountMatch[1]),
      maxUses: 1,
      uses: 0,
      expiresAtEndOfRound: false,
      discardOnReveal: false,
      discardAfterUse: true
    };
  }

  if (burdenResolutionDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "burden_resolution_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: Number(burdenResolutionDiscountMatch[1]),
      maxUses: 1,
      uses: 0,
      expiresAtEndOfRound: false,
      discardOnReveal: false,
      discardAfterUse: true
    };
  }

  if (placedCategoryAllowedResourceDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "placement_resource_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: Number(placedCategoryAllowedResourceDiscountMatch[2]),
      targetCategories: [placedCategoryAllowedResourceDiscountMatch[1]],
      allowedResources: [
        placedCategoryAllowedResourceDiscountMatch[3],
        placedCategoryAllowedResourceDiscountMatch[4]
      ],
      maxUses: 1,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  if (tilePlacementResourceDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "tile_resource_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: Number(tilePlacementResourceDiscountMatch[2]),
      freeResourceCost: false,
      targetCategories: null,
      allowedResources: null,
      appliesTo: ["placement"],
      maxUses: tilePlacementResourceDiscountMatch[1] ? 2 : 1,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  if (categoryPlacedOrUpgradedResourceDiscountMatch) {
    const isFree = !categoryPlacedOrUpgradedResourceDiscountMatch[2];

    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "tile_resource_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: isFree ? null : Number(categoryPlacedOrUpgradedResourceDiscountMatch[2]),
      freeResourceCost: isFree,
      targetCategories: [categoryPlacedOrUpgradedResourceDiscountMatch[1]],
      allowedResources: null,
      appliesTo: ["placement", "upgrade"],
      maxUses: 1,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  if (tilePlacedOrUpgradedResourceDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "tile_resource_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      amount: Number(tilePlacedOrUpgradedResourceDiscountMatch[2]),
      freeResourceCost: false,
      targetCategories: null,
      allowedResources: null,
      appliesTo: ["placement", "upgrade"],
      maxUses: tilePlacedOrUpgradedResourceDiscountMatch[1] ? 2 : 1,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  if (freeNextPlacementMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "free_tile_placement_cost",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      targetCategories: freeNextPlacementMatch[1]?.split(/\s+or\s+/i) ?? null,
      maxUses: 1,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  if (travelTileActionDiscountMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "tile_action_discount",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      targetCategories: ["Travel"],
      appliesTo: travelTileActionDiscountMatch[2] ? ["placement", "upgrade"] : ["placement"],
      maxUses: travelTileActionDiscountMatch[1] ? 2 : 1,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  if (choiceMatch) {
    return {
      id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
      source: "boon",
      type: "resource_production_bonus",
      cardId: card.card_id,
      cardName: card.card_name,
      round: state.round,
      season: state.season,
      effectText,
      sourceTileName: normalizeResourceSourceName(choiceMatch[1]),
      gains: [
        {
          amount: Number(choiceMatch[2]),
          resource: choiceMatch[3]
        }
      ],
      choiceResources: [choiceMatch[3], choiceMatch[4]],
      deterministicChoice: true,
      maxUses: null,
      uses: 0,
      expiresAtEndOfRound: true,
      discardOnReveal: true
    };
  }

  const match = nextMatch ?? limitedMatch ?? eachMatch;
  if (!match) {
    return null;
  }

  const limited = Boolean(nextMatch ?? limitedMatch);
  const gains = parseAdditionalGains(eachMatch && !limited ? match[2] : match[3] ?? match[2]);

  if (gains.length === 0 || gains.some((gain) => !gain)) {
    return null;
  }

  return {
    id: `round-effect-${card.card_id}-${state.round}-${index + 1}`,
    source: "boon",
    type: "resource_production_bonus",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    sourceTileName: normalizeResourceSourceName(nextMatch ? match[1] : limitedMatch ? match[2] : match[1]),
    gains,
    maxUses: limited ? (limitedMatch?.[1] === "first two times" ? 2 : 1) : null,
    uses: 0,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function getBoonArrivalTimerEffect(state, card) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const oneTimerMatch = ADD_ONE_TIMER_TO_ACTIVE_ARRIVAL.exec(effectText);
  const dividedMatch = ADD_TIMERS_AMONG_ACTIVE_ARRIVALS.exec(effectText);

  if (!oneTimerMatch && !dividedMatch) {
    return null;
  }

  return {
    source: "boon",
    type: "arrival_timer_tokens",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    amount: oneTimerMatch ? 1 : Number(dividedMatch[1]),
    timerMax: Number(oneTimerMatch?.[1] ?? dividedMatch?.[2] ?? state.rules.arrivalTimerMax ?? 3)
  };
}

function getBoonEncounterDeckPeekEffect(state, card, deck) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const sameOrderMatch = LOOK_AT_ENCOUNTER_DECK_SAME_ORDER.exec(effectText);
  const anyOrderMatch = LOOK_AT_ENCOUNTER_DECK_ANY_ORDER.exec(effectText);

  if (!sameOrderMatch && !anyOrderMatch) {
    return null;
  }

  const count = Number(sameOrderMatch?.[1] ?? anyOrderMatch?.[1]);
  const peekedCardIds = deck.slice(0, count);

  return {
    source: "boon",
    type: "encounter_deck_peek",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    count,
    peekedCardIds,
    orderedCardIds: [...peekedCardIds],
    canReorder: Boolean(anyOrderMatch),
    deterministicOrder: "same_order",
    bottomPlacedOnTop: false
  };
}

function sortPlacedTilesById(placedTiles) {
  return [...placedTiles].sort((left, right) => {
    const leftNumber = Number(left.id.replace(/\D+/g, ""));
    const rightNumber = Number(right.id.replace(/\D+/g, ""));
    return leftNumber - rightNumber;
  });
}

function getTileName(context, placedTile) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  const definition = tileIndex.get(placedTile.tileId);

  return definition?.tile_name ?? placedTile.tileId;
}

function getTileDefinition(context, placedTile) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  return tileIndex.get(placedTile.tileId);
}

function getTileFamilyName(definition) {
  return definition?.base_tile ?? definition?.tile_name ?? null;
}

function placedTileMatchesFamilyName(context, placedTile, familyName) {
  const definition = getTileDefinition(context, placedTile);
  return getTileFamilyName(definition) === familyName || definition?.tile_name === familyName;
}

function placedTileMatchesCategory(context, placedTile, category) {
  const definition = getTileDefinition(context, placedTile);
  return definition?.tile_category === category;
}

function placedTileMatchesAnyCategory(context, placedTile, categories) {
  if (!categories) {
    return true;
  }

  const definition = getTileDefinition(context, placedTile);
  return categories.includes(definition?.tile_category);
}

function placedTileIsStewardHouse(context, placedTile) {
  const definition = getTileDefinition(context, placedTile);
  return definition?.subtype === "Steward House";
}

function parseAdjacentTargetCategories(targetText) {
  if (targetText === "placed tile") {
    return null;
  }

  return targetText.split(/\s+or\s+/).map((part) => part.replace(/\s+Tile$/i, ""));
}

function parsePayOrStrainTargetCategories(targetText) {
  return targetText
    .split(/\s+or\s+/i)
    .map((part) => part.replace(/\s+Tiles?$/i, "").trim())
    .filter(Boolean);
}

function parseBurdenPaymentOptions(paymentText) {
  return paymentText
    .split(/\s+or\s+/i)
    .map((part) => {
      const match = /^(\d+) ([A-Za-z]+)$/.exec(part.trim());

      return match
        ? {
            amount: Number(match[1]),
            resource: match[2]
          }
        : null;
    })
    .filter(Boolean);
}

function parseResourceChoiceOptions(resourceText, state) {
  if (/any non-Goods resource/i.test(resourceText)) {
    return state.rules.resources.filter((resource) => resource !== "Goods");
  }

  return resourceText
    .replace(/\s*,?\s+or\s+/i, ", ")
    .split(",")
    .map((resource) => resource.trim())
    .filter(Boolean);
}

function getMostStockedWarehouseResources(state) {
  const entries = Object.entries(state.warehouse.resources);
  const maxAmount = entries.reduce((max, [, amount]) => Math.max(max, Number(amount ?? 0)), 0);

  return entries.filter(([, amount]) => Number(amount ?? 0) === maxAmount).map(([resource]) => resource);
}

function parseOptionalStrainReliefTargetCategories(targetText) {
  if (!targetText) {
    return null;
  }

  return targetText.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
}

function getAdjacentPlacedTiles(state, placedTile) {
  const mapIndex = createMapIndex(state.map.hexes);
  const ownFootprint = new Set(getPlacedTileCoordinates(placedTile));
  const placedByCoordinate = new Map(
    state.map.placedTiles.flatMap((tile) => getPlacedTileCoordinates(tile).map((coordinate) => [coordinate, tile]))
  );
  const adjacentTileIds = new Set();

  for (const coordinate of ownFootprint) {
    for (const neighborCoordinate of getNeighborCoordinates(coordinate, mapIndex)) {
      if (ownFootprint.has(neighborCoordinate)) {
        continue;
      }

      const adjacentTile = placedByCoordinate.get(neighborCoordinate);
      if (adjacentTile) {
        adjacentTileIds.add(adjacentTile.id);
      }
    }
  }

  return sortPlacedTilesById(state.map.placedTiles.filter((tile) => adjacentTileIds.has(tile.id)));
}

function hasAdjacentPlacedTile(state, placedTile, predicate) {
  return getAdjacentPlacedTiles(state, placedTile).some(predicate);
}

function createStrainReliefApplication(context, placedTile, amount, reason) {
  const before = placedTile.strain ?? 0;
  const strainRemoved = Math.min(amount, before);

  return {
    placedTileId: placedTile.id,
    tileId: placedTile.tileId,
    tileName: getTileName(context, placedTile),
    before,
    after: Math.max(0, before - strainRemoved),
    strainRemoved,
    reason
  };
}

function createStrainPlacementApplication(context, placedTile, amount, result, support, reason) {
  return {
    placedTileId: placedTile.id,
    tileId: placedTile.tileId,
    tileName: getTileName(context, placedTile),
    before: placedTile.strain ?? 0,
    after: result.placedTile.strain,
    requestedStrain: amount,
    strainAdded: result.strainAdded,
    strainPrevented: result.strainPrevented,
    blockedByMax: result.blockedByMax,
    becameOverstrained: result.becameOverstrained,
    supportProviders: support.providers,
    reason
  };
}

function applyStrainPlacementToTile(state, placedTile, amount, context, reason) {
  const support = getEffectiveSupportDetails(state, placedTile.id, context);
  const result = applyStrainToPlacedTile(placedTile, amount, {
    supported: support.supported
  });

  if (!result.valid) {
    return {
      state,
      application: null
    };
  }

  return {
    state: {
      ...state,
      map: {
        ...state.map,
        placedTiles: state.map.placedTiles.map((tile) => (tile.id === placedTile.id ? result.placedTile : tile))
      }
    },
    application: createStrainPlacementApplication(context, placedTile, amount, result, support, reason)
  };
}

function getEligibleBurdenStrainTargets(state, context, predicate) {
  return sortPlacedTilesById(
    state.map.placedTiles.filter((placedTile) => (placedTile.strain ?? 0) < 3 && predicate(placedTile))
  );
}

function getStewardOccupiedPlacedTiles(state) {
  const placedTilesById = new Map(state.map.placedTiles.map((placedTile) => [placedTile.id, placedTile]));
  const targetIds = new Set();

  for (const player of state.players) {
    const placedTileId = player.lastInteraction?.placedTileId;

    if (placedTileId && placedTilesById.has(placedTileId)) {
      targetIds.add(placedTileId);
    }
  }

  return sortPlacedTilesById([...targetIds].map((placedTileId) => placedTilesById.get(placedTileId)));
}

function applyStrainPlacementToTargets(state, targets, context, reason) {
  let workingState = state;
  const applications = [];

  for (const target of targets) {
    const currentTarget = workingState.map.placedTiles.find((placedTile) => placedTile.id === target.id);

    if (!currentTarget || (currentTarget.strain ?? 0) >= 3) {
      continue;
    }

    const result = applyStrainPlacementToTile(workingState, currentTarget, 1, context, reason);
    workingState = result.state;

    if (result.application) {
      applications.push(result.application);
    }
  }

  return {
    state: workingState,
    applications
  };
}

function loseWarehouseResourceIfAble(state, resource, amount = 1) {
  const before = state.warehouse.resources[resource] ?? 0;
  const amountLost = Math.min(before, amount);

  return {
    state:
      amountLost > 0
        ? {
            ...state,
            warehouse: {
              ...state.warehouse,
              resources: {
                ...state.warehouse.resources,
                [resource]: before - amountLost
              }
            }
          }
        : state,
    loss: {
      resource,
      before,
      after: before - amountLost,
      amountLost,
      requestedAmount: amount
    }
  };
}

function createBurdenStrainPlacementEffect(state, card, reason, effectText, details, applications, workingState) {
  return {
    source: "burden",
    type: "strain_placement",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    reason,
    effectText,
    ...details,
    applications,
    strainAdded: applications.reduce((total, application) => total + application.strainAdded, 0),
    strainPrevented: applications.reduce((total, application) => total + application.strainPrevented, 0),
    blockedByMax: applications.reduce((total, application) => total + application.blockedByMax, 0),
    state: workingState
  };
}

function getBoonSupportedStrainReliefEffect(state, card, context) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const match = REMOVE_STRAIN_FROM_SUPPORTED_TILE.exec(effectText);

  if (!match) {
    return null;
  }

  const amount = Number(match[1] ?? match[2]);
  const candidates = sortPlacedTilesById(
    state.map.placedTiles.filter(
      (placedTile) =>
        (placedTile.strain ?? 0) > 0 &&
        getEffectiveSupportDetails(state, placedTile.id, context).supported
    )
  ).slice(0, amount);

  const applications = candidates.map((placedTile) => createStrainReliefApplication(context, placedTile, 1, "supported"));

  return {
    source: "boon",
    type: "supported_strain_relief",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    maxTargets: amount,
    applications,
    strainRemoved: applications.reduce((total, application) => total + application.strainRemoved, 0)
  };
}

function getBoonFromTheBrinkStrainReliefEffect(state, card, context) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const match = FROM_THE_BRINK_STRAIN_RELIEF.exec(effectText);

  if (!match) {
    return null;
  }

  const overstrainedMaxTargets = Number(match[1] ?? match[2]);
  const fallbackMaxTargets = Number(match[3] ?? match[4]);
  const overstrainedApplications = sortPlacedTilesById(state.map.placedTiles.filter(isOverstrainedPlacedTile))
    .slice(0, overstrainedMaxTargets)
    .map((placedTile) => createStrainReliefApplication(context, placedTile, 2, "overstrained"));
  const overstrainedStrainRemoved = overstrainedApplications.reduce(
    (total, application) => total + application.strainRemoved,
    0
  );
  const usedFallback = overstrainedStrainRemoved === 0;
  const fallbackApplications = usedFallback
    ? sortPlacedTilesById(state.map.placedTiles.filter((placedTile) => (placedTile.strain ?? 0) > 0))
        .slice(0, fallbackMaxTargets)
        .map((placedTile) => createStrainReliefApplication(context, placedTile, 1, "fallback"))
    : [];
  const applications = usedFallback ? fallbackApplications : overstrainedApplications;

  return {
    source: "boon",
    type: "from_the_brink_strain_relief",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    mode: usedFallback ? "fallback" : "overstrained",
    usedFallback,
    overstrainedMaxTargets,
    fallbackMaxTargets,
    applications,
    strainRemoved: applications.reduce((total, application) => total + application.strainRemoved, 0)
  };
}

function getBoonOptionalResourceStrainReliefEffect(state, card) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const match = OPTIONAL_RESOURCE_STRAIN_RELIEF.exec(effectText);

  if (!match) {
    return null;
  }

  const splitAcrossTargets = Boolean(match[5]);
  const maxStrainRemoved = Number(match[3] ?? match[5] ?? 1);
  const maxTargets = splitAcrossTargets ? Number(match[6]) : 1;
  const targetCategories = parseOptionalStrainReliefTargetCategories(match[4] ?? match[7]);

  return {
    source: "boon",
    type: "optional_resource_strain_relief",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    cost: [{ amount: Number(match[1]), resource: match[2] }],
    maxStrainRemoved,
    maxTargets,
    targetCategories,
    splitAcrossTargets,
    discardOnReveal: false
  };
}

function getBoonOptionalResourceExchangeEffect(state, card) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const match = OPTIONAL_RESOURCE_EXCHANGE.exec(effectText);

  if (!match) {
    return null;
  }

  return {
    source: "boon",
    type: "optional_resource_exchange",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    maxAmount: Number(match[1]),
    discardOnReveal: false
  };
}

function getBoonStewardHelpEffect(state, card, context) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BOON) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const match = STEWARD_TOKEN_BOON_HELP.exec(effectText);

  if (!match) {
    return null;
  }

  const amountPerCalmTile = Number(match[1]);
  const maxResourceGain = Number(match[2]);
  const stewardTargets = getStewardOccupiedPlacedTiles(state);
  const strainedTargets = stewardTargets.filter((placedTile) => (placedTile.strain ?? 0) > 0);
  const calmTargets = stewardTargets.filter((placedTile) => (placedTile.strain ?? 0) <= 0);
  const applications = strainedTargets.map((placedTile) =>
    createStrainReliefApplication(context, placedTile, 1, "steward_help")
  );
  const resourceGainAmount = Math.min(calmTargets.length * amountPerCalmTile, maxResourceGain);

  return {
    source: "boon",
    type: "steward_help",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    effectText,
    amountPerCalmTile,
    maxResourceGain,
    resourceGainAmount,
    stewardOccupiedPlacedTileIds: stewardTargets.map((placedTile) => placedTile.id),
    calmPlacedTileIds: calmTargets.map((placedTile) => placedTile.id),
    applications,
    strainRemoved: applications.reduce((total, application) => total + application.strainRemoved, 0),
    discardOnReveal: resourceGainAmount === 0
  };
}

export function getOptionalBoonStrainReliefApplications(state, effect, targetPlacedTileIds, context = {}) {
  if (effect?.type !== "optional_resource_strain_relief") {
    return {
      valid: false,
      errors: ["This Boon does not support optional Strain relief."],
      applications: [],
      strainRemoved: 0
    };
  }

  const selectedIds = [...new Set((targetPlacedTileIds ?? []).filter(Boolean))];
  const errors = [];

  if (selectedIds.length === 0) {
    errors.push(`Choose at least 1 tile for ${effect.cardName}.`);
  }

  if (selectedIds.length > effect.maxTargets) {
    errors.push(`${effect.cardName} can target up to ${effect.maxTargets} tile${effect.maxTargets === 1 ? "" : "s"}.`);
  }

  const selectedTiles = selectedIds.map((placedTileId) => state.map.placedTiles.find((tile) => tile.id === placedTileId));

  selectedTiles.forEach((placedTile, index) => {
    if (!placedTile) {
      errors.push(`Unknown placed tile: ${selectedIds[index]}`);
      return;
    }

    if ((placedTile.strain ?? 0) <= 0) {
      errors.push(`${getTileName(context, placedTile)} has no Strain to remove.`);
    }

    if (!placedTileMatchesAnyCategory(context, placedTile, effect.targetCategories)) {
      errors.push(`${effect.cardName} can only target ${effect.targetCategories.join(" or ")} tiles.`);
    }
  });

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      applications: [],
      strainRemoved: 0
    };
  }

  let remaining = effect.maxStrainRemoved;
  const applications = [];

  for (const placedTile of selectedTiles) {
    if (remaining <= 0) {
      break;
    }

    const application = createStrainReliefApplication(context, placedTile, remaining, "optional_boon");
    remaining -= application.strainRemoved;

    if (application.strainRemoved > 0) {
      applications.push(application);
    }
  }

  const strainRemoved = applications.reduce((total, application) => total + application.strainRemoved, 0);

  if (strainRemoved === 0) {
    return {
      valid: false,
      errors: [`${effect.cardName} did not remove any Strain.`],
      applications: [],
      strainRemoved: 0
    };
  }

  return {
    valid: true,
    errors: [],
    applications,
    strainRemoved
  };
}

function resolveBurdenStrainPlacementEffect(state, card, reason, context) {
  if (card?.encounter_type !== ENCOUNTER_TYPES.BURDEN) {
    return null;
  }

  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const match = RESOURCE_BURDEN_STRAIN_PLACEMENT.exec(effectText);

  if (!match) {
    return (
      resolveCategoryBurdenStrainPlacementEffect(state, card, reason, context, effectText) ??
      resolveOtherCategoryBurdenStrainPlacementEffect(state, card, reason, context, effectText) ??
      resolveDirectCategoryChoiceBurdenStrainPlacementEffect(state, card, reason, context, effectText) ??
      resolveUpgradedCoreBurdenStrainPlacementEffect(state, card, reason, context, effectText) ??
      resolveRenownBurdenStrainPlacementEffect(state, card, reason, context, effectText) ??
      resolveStewardTokenBurdenStrainPlacementEffect(state, card, reason, context, effectText) ??
      resolveQuietFracturesBurdenStrainPlacementEffect(state, card, reason, context, effectText)
    );
  }

  const familyName = match[1];
  const primaryAmount = Number(match[2]);
  const hasAdjacentTarget = Boolean(match[3]);
  const adjacentCategories = match[3] ? parseAdjacentTargetCategories(match[3]) : null;
  let workingState = state;
  const applications = [];
  const primaryTarget = getEligibleBurdenStrainTargets(workingState, context, (placedTile) =>
    placedTileMatchesFamilyName(context, placedTile, familyName)
  )[0];

  if (primaryTarget) {
    const primary = applyStrainPlacementToTile(workingState, primaryTarget, primaryAmount, context, "primary");
    workingState = primary.state;

    if (primary.application) {
      applications.push(primary.application);
    }

    if (hasAdjacentTarget) {
      const updatedPrimaryTarget = workingState.map.placedTiles.find((tile) => tile.id === primaryTarget.id);
      const adjacentTarget = getAdjacentPlacedTiles(workingState, updatedPrimaryTarget).find(
        (placedTile) =>
          (placedTile.strain ?? 0) < 3 && placedTileMatchesAnyCategory(context, placedTile, adjacentCategories)
      );

      if (adjacentTarget) {
        const adjacent = applyStrainPlacementToTile(workingState, adjacentTarget, 1, context, "adjacent");
        workingState = adjacent.state;

        if (adjacent.application) {
          applications.push(adjacent.application);
        }
      }
    }
  }

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "resource_family",
      primaryFamilyName: familyName,
      primaryAmount,
      hasAdjacentTarget,
      adjacentCategories
    },
    applications,
    workingState
  );
}

function resolveCategoryBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const adjacentStrainedMatch = ADJACENT_STRAINED_CATEGORY_BURDEN_STRAIN_PLACEMENT.exec(effectText);
  const adjacentMatch = ADJACENT_CATEGORY_BURDEN_STRAIN_PLACEMENT.exec(effectText);
  const notAdjacentMatch = NOT_ADJACENT_CATEGORY_BURDEN_STRAIN_PLACEMENT.exec(effectText);
  const match = adjacentStrainedMatch ?? adjacentMatch ?? notAdjacentMatch;

  if (!match) {
    return null;
  }

  const mode = adjacentStrainedMatch ? "adjacent_strained_category" : adjacentMatch ? "adjacent_category" : "not_adjacent_category";
  const maxTargets = Number(match[1]);
  const targetCategory = match[2];
  const relatedCategory = match[3];
  const targets = getEligibleBurdenStrainTargets(state, context, (placedTile) => {
    if (!placedTileMatchesCategory(context, placedTile, targetCategory)) {
      return false;
    }

    const relatedPredicate = (adjacentTile) =>
      placedTileMatchesCategory(context, adjacentTile, relatedCategory) &&
      (!adjacentStrainedMatch || (adjacentTile.strain ?? 0) > 0);
    const hasRelatedNeighbor = hasAdjacentPlacedTile(state, placedTile, relatedPredicate);

    return notAdjacentMatch ? !hasRelatedNeighbor : hasRelatedNeighbor;
  }).slice(0, maxTargets);
  const placement = applyStrainPlacementToTargets(state, targets, context, mode);

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode,
      maxTargets,
      targetCategory,
      relatedCategory
    },
    placement.applications,
    placement.state
  );
}

function resolveOtherCategoryBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const match = OTHER_CATEGORY_BURDEN_STRAIN_PLACEMENT.exec(effectText);

  if (!match) {
    return null;
  }

  const sharedMaxTargets = match[1] ? Number(match[1]) : null;
  const merchantMaxTargets = match[2] ? Number(match[2]) : sharedMaxTargets;
  const craftingMaxTargets = match[3] ? Number(match[3]) : sharedMaxTargets;
  const merchantTargets = getEligibleBurdenStrainTargets(
    state,
    context,
    (placedTile) =>
      placedTileMatchesCategory(context, placedTile, "Merchant") &&
      hasAdjacentPlacedTile(state, placedTile, (adjacentTile) => placedTileMatchesCategory(context, adjacentTile, "Crafting"))
  ).slice(0, merchantMaxTargets);
  const craftingTargets = getEligibleBurdenStrainTargets(
    state,
    context,
    (placedTile) =>
      placedTileMatchesCategory(context, placedTile, "Crafting") &&
      hasAdjacentPlacedTile(state, placedTile, (adjacentTile) => placedTileMatchesCategory(context, adjacentTile, "Merchant"))
  ).slice(0, craftingMaxTargets);
  const targets = sharedMaxTargets
    ? sortPlacedTilesById([...merchantTargets, ...craftingTargets]).slice(0, sharedMaxTargets)
    : sortPlacedTilesById([...merchantTargets, ...craftingTargets]);
  const placement = applyStrainPlacementToTargets(state, targets, context, "other_category");

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "other_category",
      targetCategories: ["Merchant", "Crafting"],
      merchantMaxTargets,
      craftingMaxTargets,
      sharedMaxTargets
    },
    placement.applications,
    placement.state
  );
}

function resolveDirectCategoryChoiceBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const match = DIRECT_CATEGORY_CHOICE_BURDEN_STRAIN_PLACEMENT.exec(effectText);

  if (!match) {
    return null;
  }

  const maxTargets = Number(match[1]);
  const targetCategories = [match[2], match[3]];
  const lossResource = match[4] ?? null;
  const targets = getEligibleBurdenStrainTargets(state, context, (placedTile) =>
    placedTileMatchesAnyCategory(context, placedTile, targetCategories)
  ).slice(0, maxTargets);
  const placement = applyStrainPlacementToTargets(state, targets, context, "category_choice");
  const resourceLoss = lossResource ? loseWarehouseResourceIfAble(placement.state, lossResource, 1) : null;

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "category_choice",
      maxTargets,
      targetCategories,
      resourceLosses: resourceLoss ? [resourceLoss.loss] : []
    },
    placement.applications,
    resourceLoss?.state ?? placement.state
  );
}

function createBurdenPayOrStrainChoiceEffect(state, card, reason, context, effectText) {
  const match = CATEGORY_PAY_OR_STRAIN_BURDEN_CHOICE.exec(effectText);

  if (!match) {
    return null;
  }

  const maxTargets = Number(match[1]);
  const targetCategories = parsePayOrStrainTargetCategories(match[2]);
  const decisionMode = match[3] ? "per_target" : "all_or_strain_all";
  const paymentOptions = parseBurdenPaymentOptions(match[4]);
  const strainTargetText = match[5];

  if (paymentOptions.length === 0) {
    return null;
  }

  const targets = getEligibleBurdenStrainTargets(state, context, (placedTile) =>
    placedTileMatchesAnyCategory(context, placedTile, targetCategories)
  ).slice(0, maxTargets);

  return {
    state,
    source: "burden",
    type: "pay_or_strain_choice",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    reason,
    effectText,
    mode: "pay_or_strain_choice",
    maxTargets,
    targetCategories,
    decisionMode,
    paymentOptions,
    strainTargetText,
    targets: targets.map((placedTile) => ({
      placedTileId: placedTile.id,
      tileId: placedTile.tileId,
      tileName: getTileName(context, placedTile),
      before: placedTile.strain ?? 0
    })),
    applications: [],
    strainAdded: 0,
    strainPrevented: 0,
    blockedByMax: 0
  };
}

function createBurdenArrivalTimerChoiceEffect(state, card, reason, context, effectText) {
  const match = ARRIVAL_PAY_OR_TIMER_BURDEN_CHOICE.exec(effectText);

  if (!match) {
    return null;
  }

  const maxTargets = Number(match[1]);
  const decisionMode = match[2] ? "per_target" : "all_or_timer_all";
  const paymentOptions = [
    {
      amount: Number(match[3]),
      resource: match[4]
    }
  ];
  const encounterIndex = createEncounterIndex(context.encounterCards ?? []);
  const targets = state.encounter.active
    .filter(
      (activeState) =>
        activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL &&
        !activeState.completed &&
        Number(activeState.timerTokens ?? state.rules.arrivalStartTimerTokens ?? 0) > 0
    )
    .slice(0, maxTargets);

  return {
    state,
    source: "burden",
    type: "arrival_pay_or_timer_choice",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    reason,
    effectText,
    mode: "arrival_pay_or_timer_choice",
    maxTargets,
    decisionMode,
    paymentOptions,
    targets: targets.map((activeState) => {
      const arrivalCard = encounterIndex.get(activeState.cardId);

      return {
        activeEncounterId: activeState.id,
        cardId: activeState.cardId,
        cardName: arrivalCard?.card_name ?? activeState.cardId,
        before: Number(activeState.timerTokens ?? state.rules.arrivalStartTimerTokens ?? 0)
      };
    }),
    applications: [],
    timerTokensRemoved: 0
  };
}

function createBurdenResourceLossChoiceEffect(state, card, reason, context, effectText) {
  const chosenResourceMatch = CHOSEN_RESOURCE_LOSS_OR_STRAIN_BURDEN_CHOICE.exec(effectText);
  const mostResourceMatch = MOST_RESOURCE_LOSS_OR_STRAIN_BURDEN_CHOICE.exec(effectText);

  if (!chosenResourceMatch && !mostResourceMatch) {
    return null;
  }

  const resourceOptions = chosenResourceMatch
    ? parseResourceChoiceOptions(chosenResourceMatch[1], state)
    : getMostStockedWarehouseResources(state);
  const lossAmount = Number(chosenResourceMatch?.[2] ?? mostResourceMatch?.[1]);
  const maxTargets = Number(chosenResourceMatch?.[3] ?? mostResourceMatch?.[2]);
  const targetText = chosenResourceMatch?.[4] ?? "placed tiles";
  const targetCategories = /Resource Tiles?/i.test(targetText) ? ["Resource"] : null;
  const targets = getEligibleBurdenStrainTargets(state, context, (placedTile) =>
    placedTileMatchesAnyCategory(context, placedTile, targetCategories)
  ).slice(0, maxTargets);

  return {
    state,
    source: "burden",
    type: "resource_loss_or_strain_choice",
    cardId: card.card_id,
    cardName: card.card_name,
    round: state.round,
    season: state.season,
    reason,
    effectText,
    mode: "resource_loss_or_strain_choice",
    maxTargets,
    targetCategories,
    decisionMode: "resource_loss_or_strain",
    paymentOptions: resourceOptions.map((resource) => ({
      amount: lossAmount,
      resource
    })),
    targets: targets.map((placedTile) => ({
      placedTileId: placedTile.id,
      tileId: placedTile.tileId,
      tileName: getTileName(context, placedTile),
      before: placedTile.strain ?? 0
    })),
    applications: [],
    strainAdded: 0,
    strainPrevented: 0,
    blockedByMax: 0,
    resourceSelection: chosenResourceMatch ? "chosen" : "most_stocked"
  };
}

function resolveUpgradedCoreBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const match = UPGRADED_CORE_BURDEN_STRAIN_PLACEMENT.exec(effectText);

  if (!match) {
    return null;
  }

  const primaryAmount = Number(match[1]);
  const hasAdjacentTarget = /Then choose 1 adjacent placed tile/.test(effectText);
  let workingState = state;
  const applications = [];
  const primaryTarget = getEligibleBurdenStrainTargets(workingState, context, (placedTile) => {
    const definition = getTileDefinition(context, placedTile);
    return definition?.tile_source_type === "Core" && definition?.side === "Upgraded";
  })[0];

  if (primaryTarget) {
    const primary = applyStrainPlacementToTile(workingState, primaryTarget, primaryAmount, context, "upgraded_core");
    workingState = primary.state;

    if (primary.application) {
      applications.push(primary.application);
    }

    if (hasAdjacentTarget) {
      const updatedPrimaryTarget = workingState.map.placedTiles.find((tile) => tile.id === primaryTarget.id);
      const adjacentTarget = getAdjacentPlacedTiles(workingState, updatedPrimaryTarget).find(
        (placedTile) => (placedTile.strain ?? 0) < 3
      );

      if (adjacentTarget) {
        const adjacent = applyStrainPlacementToTile(workingState, adjacentTarget, 1, context, "adjacent");
        workingState = adjacent.state;

        if (adjacent.application) {
          applications.push(adjacent.application);
        }
      }
    }
  }

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "upgraded_core",
      primaryAmount,
      hasAdjacentTarget
    },
    applications,
    workingState
  );
}

function resolveRenownBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const match = RENOWN_BURDEN_STRAIN_PLACEMENT.exec(effectText);

  if (!match) {
    return null;
  }

  const maxTargets = Number(match[1]);
  const targets = getEligibleBurdenStrainTargets(state, context, (placedTile) => {
    const definition = getTileDefinition(context, placedTile);
    return Number(definition?.renown ?? 0) > 0;
  }).slice(0, maxTargets);
  const placement = applyStrainPlacementToTargets(state, targets, context, "renown");

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "renown",
      maxTargets
    },
    placement.applications,
    placement.state
  );
}

function resolveQuietFracturesBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const strainedTileMatch = QUIET_FRACTURES_STRAINED_TILE.exec(effectText);
  const overstrainedSpreadMatch = QUIET_FRACTURES_OVERSTRAINED_SPREAD.exec(effectText);

  if (!strainedTileMatch && !overstrainedSpreadMatch) {
    return null;
  }

  if (overstrainedSpreadMatch) {
    const sourceTile = sortPlacedTilesById(state.map.placedTiles.filter(isOverstrainedPlacedTile))[0];

    if (!sourceTile) {
      const seasonTwoEffect = getEncounterSeasonEffect(card, "II");
      const fallback = resolveQuietFracturesBurdenStrainPlacementEffect(state, card, reason, context, seasonTwoEffect);

      return fallback
        ? {
            ...fallback,
            mode: "quiet_fractures_fallback",
            effectText,
            fallbackEffectText: seasonTwoEffect
          }
        : null;
    }

    const targets = getAdjacentPlacedTiles(state, sourceTile)
      .filter((placedTile) => (placedTile.strain ?? 0) === 0)
      .slice(0, 2);
    const placement = applyStrainPlacementToTargets(state, targets, context, "quiet_fractures_adjacent_zero");

    return createBurdenStrainPlacementEffect(
      state,
      card,
      reason,
      effectText,
      {
        mode: "quiet_fractures_overstrained_spread",
        sourcePlacedTileId: sourceTile.id,
        maxTargets: 2
      },
      placement.applications,
      placement.state
    );
  }

  const hasAdjacentTarget = /Then choose 1 adjacent placed tile/.test(effectText);
  let workingState = state;
  const applications = [];
  const primaryTarget = getEligibleBurdenStrainTargets(
    workingState,
    context,
    (placedTile) => (placedTile.strain ?? 0) > 0
  )[0];

  if (primaryTarget) {
    const primary = applyStrainPlacementToTile(workingState, primaryTarget, 1, context, "quiet_fractures_strained");
    workingState = primary.state;

    if (primary.application) {
      applications.push(primary.application);
    }

    if (hasAdjacentTarget) {
      const updatedPrimaryTarget = workingState.map.placedTiles.find((tile) => tile.id === primaryTarget.id);
      const adjacentTarget = getAdjacentPlacedTiles(workingState, updatedPrimaryTarget).find(
        (placedTile) => (placedTile.strain ?? 0) === 0
      );

      if (adjacentTarget) {
        const adjacent = applyStrainPlacementToTile(
          workingState,
          adjacentTarget,
          1,
          context,
          "quiet_fractures_adjacent_zero"
        );
        workingState = adjacent.state;

        if (adjacent.application) {
          applications.push(adjacent.application);
        }
      }
    }
  }

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "quiet_fractures_strained_tile",
      hasAdjacentTarget
    },
    applications,
    workingState
  );
}

function resolveStewardTokenBurdenStrainPlacementEffect(state, card, reason, context, effectText) {
  const match = STEWARD_TOKEN_BURDEN_STRAIN_PLACEMENT.exec(effectText);

  if (!match) {
    return null;
  }

  const hasStewardHouseTarget = /Then choose 1 Steward House/.test(effectText);
  const stewardTargets = getStewardOccupiedPlacedTiles(state).filter((placedTile) => (placedTile.strain ?? 0) < 3);
  const stewardPlacement = applyStrainPlacementToTargets(state, stewardTargets, context, "steward_token");
  let workingState = stewardPlacement.state;
  const applications = [...stewardPlacement.applications];
  let stewardHouseTarget = null;

  if (hasStewardHouseTarget) {
    stewardHouseTarget = getEligibleBurdenStrainTargets(workingState, context, (placedTile) =>
      placedTileIsStewardHouse(context, placedTile)
    )[0];

    if (stewardHouseTarget) {
      const stewardHousePlacement = applyStrainPlacementToTile(
        workingState,
        stewardHouseTarget,
        1,
        context,
        "steward_house"
      );
      workingState = stewardHousePlacement.state;

      if (stewardHousePlacement.application) {
        applications.push(stewardHousePlacement.application);
      }
    }
  }

  return createBurdenStrainPlacementEffect(
    state,
    card,
    reason,
    effectText,
    {
      mode: "steward_token",
      stewardOccupiedPlacedTileIds: stewardTargets.map((placedTile) => placedTile.id),
      hasStewardHouseTarget,
      stewardHouseTargetPlacedTileId: stewardHouseTarget?.id ?? null
    },
    applications,
    workingState
  );
}

export function applyStrainReliefEffect(state, effect) {
  if (!effect?.applications?.length) {
    return state;
  }

  const applicationsByTileId = new Map(effect.applications.map((application) => [application.placedTileId, application]));

  return {
    ...state,
    map: {
      ...state.map,
      placedTiles: state.map.placedTiles.map((placedTile) => {
        const application = applicationsByTileId.get(placedTile.id);

        return application
          ? {
              ...placedTile,
              strain: application.after
            }
          : placedTile;
      })
    }
  };
}

function resolveBoonImmediateEffect(state, card, activeStates, deck, context = {}) {
  const deckPeekEffect = getBoonEncounterDeckPeekEffect(state, card, deck);
  if (deckPeekEffect) {
    return {
      state,
      active: activeStates,
      deck: [...deckPeekEffect.orderedCardIds, ...deck.slice(deckPeekEffect.peekedCardIds.length)],
      effect: deckPeekEffect
    };
  }

  const supportedStrainReliefEffect = getBoonSupportedStrainReliefEffect(state, card, context);
  if (supportedStrainReliefEffect) {
    return {
      state: applyStrainReliefEffect(state, supportedStrainReliefEffect),
      active: activeStates,
      deck,
      effect: supportedStrainReliefEffect
    };
  }

  const fromTheBrinkStrainReliefEffect = getBoonFromTheBrinkStrainReliefEffect(state, card, context);
  if (fromTheBrinkStrainReliefEffect) {
    return {
      state: applyStrainReliefEffect(state, fromTheBrinkStrainReliefEffect),
      active: activeStates,
      deck,
      effect: fromTheBrinkStrainReliefEffect
    };
  }

  const stewardHelpEffect = getBoonStewardHelpEffect(state, card, context);
  if (stewardHelpEffect) {
    if (stewardHelpEffect.resourceGainAmount > 0) {
      const activeState = createActiveEncounterState(
        { ...state, encounter: { ...state.encounter, active: activeStates } },
        card,
        stewardHelpEffect
      );

      return {
        state,
        active: [...activeStates, activeState],
        deck,
        effect: stewardHelpEffect,
        discardOnReveal: false
      };
    }

    return {
      state: applyStrainReliefEffect(state, stewardHelpEffect),
      active: activeStates,
      deck,
      effect: stewardHelpEffect
    };
  }

  const optionalStrainReliefEffect = getBoonOptionalResourceStrainReliefEffect(state, card);
  if (optionalStrainReliefEffect) {
    const activeState = createActiveEncounterState(
      { ...state, encounter: { ...state.encounter, active: activeStates } },
      card,
      optionalStrainReliefEffect
    );

    return {
      state,
      active: [...activeStates, activeState],
      deck,
      effect: optionalStrainReliefEffect,
      discardOnReveal: false
    };
  }

  const optionalResourceExchangeEffect = getBoonOptionalResourceExchangeEffect(state, card);
  if (optionalResourceExchangeEffect) {
    const activeState = createActiveEncounterState(
      { ...state, encounter: { ...state.encounter, active: activeStates } },
      card,
      optionalResourceExchangeEffect
    );

    return {
      state,
      active: [...activeStates, activeState],
      deck,
      effect: optionalResourceExchangeEffect,
      discardOnReveal: false
    };
  }

  const timerEffect = getBoonArrivalTimerEffect(state, card);

  if (!timerEffect) {
    return {
      state,
      active: activeStates,
      deck,
      effect: null
    };
  }

  let remaining = timerEffect.amount;
  const applications = [];
  const active = activeStates.map((activeState) => ({ ...activeState }));

  while (remaining > 0) {
    let addedThisPass = 0;

    for (const activeState of active) {
      if (remaining <= 0) {
        break;
      }

      if (activeState.encounterType !== ENCOUNTER_TYPES.ARRIVAL || activeState.completed) {
        continue;
      }

      const before = Number(activeState.timerTokens ?? state.rules.arrivalStartTimerTokens ?? timerEffect.timerMax);
      if (before >= timerEffect.timerMax) {
        continue;
      }

      activeState.timerTokens = before + 1;
      remaining -= 1;
      addedThisPass += 1;
      applications.push({
        activeEncounterId: activeState.id,
        cardId: activeState.cardId,
        before,
        after: activeState.timerTokens,
        tokensAdded: 1
      });
    }

    if (addedThisPass === 0) {
      break;
    }
  }

  return {
    state,
    active,
    deck,
    effect: {
      ...timerEffect,
      tokensAdded: timerEffect.amount - remaining,
      applications
    }
  };
}

export function getBurdenResolutionCost(card, season) {
  const lifecycle = String(card?.lifecycle_or_resolution ?? "");
  const resolveText = lifecycle.split("To resolve:")[1]?.trim();

  if (!resolveText) {
    return {
      supported: false,
      errors: [`${card?.card_name ?? "This Burden"} has no source-defined resolution cost.`],
      cost: [],
      mode: "none"
    };
  }

  const fixedMatch = /^Spend 1 Action and pay ([A-Za-z]+) based on the current Season: Season I (\d+) \1; Season II (\d+) \1; Season III (\d+) \1\./.exec(
    resolveText
  );

  const choiceAnyMatch = /^Spend 1 Action and pay resources of your choice based on the current Season: Season I (\d+) resources; Season II (\d+) resources; Season III (\d+) resources\./.exec(
    resolveText
  );
  const choiceSetMatch = /^Spend 1 Action and pay resources based on the current Season: Season I (\d+) ([A-Za-z]+(?: or [A-Za-z]+)+) in any combination; Season II (\d+) \2 in any combination; Season III (\d+) \2 in any combination\./.exec(
    resolveText
  );
  const match = fixedMatch ?? choiceAnyMatch ?? choiceSetMatch;

  if (!match) {
    return {
      supported: false,
      errors: [`${card?.card_name ?? "This Burden"} has an unsupported resolution cost.`],
      cost: [],
      mode: "unsupported"
    };
  }

  const seasonAmounts = fixedMatch
    ? {
        I: Number(fixedMatch[2]),
        II: Number(fixedMatch[3]),
        III: Number(fixedMatch[4])
      }
    : choiceAnyMatch
      ? {
          I: Number(choiceAnyMatch[1]),
          II: Number(choiceAnyMatch[2]),
          III: Number(choiceAnyMatch[3])
        }
      : {
          I: Number(choiceSetMatch[1]),
          II: Number(choiceSetMatch[3]),
          III: Number(choiceSetMatch[4])
        };
  const amountBySeason = {
    I: seasonAmounts.I,
    II: seasonAmounts.II,
    III: seasonAmounts.III
  };
  const amount = amountBySeason[season];

  if (!amount) {
    return {
      supported: false,
      errors: [`Unknown Season for Burden resolution: ${season}`],
      cost: [],
      mode: "unsupported"
    };
  }

  if (fixedMatch) {
    const resource = fixedMatch[1];
    return {
      supported: true,
      errors: [],
      cost: [{ amount, resource }],
      actionCost: 1,
      resolveText,
      mode: "fixed",
      amount,
      allowedResources: [resource],
      requiresPaymentChoice: false
    };
  }

  const allowedResources = choiceSetMatch ? choiceSetMatch[2].split(/\s+or\s+/) : null;

  return {
    supported: true,
    errors: [],
    cost: [],
    actionCost: 1,
    resolveText,
    mode: choiceAnyMatch ? "choice_any" : "choice_set",
    amount,
    allowedResources,
    requiresPaymentChoice: true
  };
}

export function createBurdenApplication(state, card, reason) {
  return {
    round: state.round,
    season: state.season,
    reason,
    effectText: getEncounterSeasonEffect(card, state.season)
  };
}

export function resolveBurdenSeasonEffect(state, card, reason, context = {}) {
  const effectText = String(getEncounterSeasonEffect(card, state.season) ?? "").trim();
  const strainPlacementEffect =
    resolveBurdenStrainPlacementEffect(state, card, reason, context) ??
    createBurdenPayOrStrainChoiceEffect(state, card, reason, context, effectText) ??
    createBurdenArrivalTimerChoiceEffect(state, card, reason, context, effectText) ??
    createBurdenResourceLossChoiceEffect(state, card, reason, context, effectText);

  if (!strainPlacementEffect) {
    return {
      state,
      application: createBurdenApplication(state, card, reason),
      effect: null
    };
  }

  const { state: nextState, ...effect } = strainPlacementEffect;

  return {
    state: nextState,
    application: {
      ...createBurdenApplication(state, card, reason),
      effect
    },
    effect
  };
}

export function getRevealCountForPlayerCount(playerCount) {
  return playerCount;
}

export const SEED_PACKET_POSITIONS = Object.freeze({
  TOP: "top",
  UPPER_THIRD: "upper_third",
  MIDDLE: "middle",
  LOWER_THIRD: "lower_third",
  BOTTOM: "bottom"
});

function getSeedPacketIndex(deckLength, seedPosition) {
  if (seedPosition === SEED_PACKET_POSITIONS.TOP) {
    return 0;
  }

  if (seedPosition === SEED_PACKET_POSITIONS.UPPER_THIRD) {
    return Math.floor(deckLength / 3);
  }

  if (seedPosition === SEED_PACKET_POSITIONS.MIDDLE) {
    return Math.floor(deckLength / 2);
  }

  if (seedPosition === SEED_PACKET_POSITIONS.LOWER_THIRD) {
    return Math.floor((deckLength * 2) / 3);
  }

  if (seedPosition === SEED_PACKET_POSITIONS.BOTTOM) {
    return deckLength;
  }

  return null;
}

export function seedEncounterCards(state, options = {}) {
  if (state.encounter.seededRounds.includes(state.round)) {
    return {
      valid: false,
      errors: [`Round ${state.round} has already seeded Encounter Cards.`]
    };
  }

  const seedPosition = options.seedPosition ?? SEED_PACKET_POSITIONS.TOP;
  const insertIndex = getSeedPacketIndex(state.encounter.deck.length, seedPosition);

  if (insertIndex === null) {
    return {
      valid: false,
      errors: [`Unknown seed packet position: ${seedPosition}`]
    };
  }

  const seedSelections = options.seedSelections ?? {};
  const seeded = [];
  const errors = [];
  const players = state.players.map((player) => {
    if (player.hand.length === 0) {
      return player;
    }

    const requestedCardId = seedSelections[player.id];
    const cardId = requestedCardId || player.hand[0];
    const selectedIndex = player.hand.indexOf(cardId);

    if (selectedIndex === -1) {
      errors.push(`${player.name} cannot seed ${cardId}; it is not in their hand.`);
      return player;
    }

    const hand = player.hand.filter((candidate, index) => index !== selectedIndex);
    seeded.push({ playerId: player.id, cardId });
    return {
      ...player,
      hand
    };
  });

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  const packet = seeded.map((entry) => entry.cardId).reverse();
  const deck = [
    ...state.encounter.deck.slice(0, insertIndex),
    ...packet,
    ...state.encounter.deck.slice(insertIndex)
  ];

  return {
    valid: true,
    players,
    seeded,
    seedPosition,
    insertIndex,
    encounter: {
      ...state.encounter,
      deck,
      seededRounds: [...state.encounter.seededRounds, state.round]
    }
  };
}

function createActiveEncounterState(state, card, application = null) {
  const base = {
    id: createEncounterStateId(state),
    cardId: card.card_id,
    encounterType: card.encounter_type,
    revealedRound: state.round,
    revealedSeason: state.season,
    resolved: false
  };

  if (card.encounter_type === ENCOUNTER_TYPES.ARRIVAL) {
    return {
      ...base,
      timerTokens: state.rules.arrivalStartTimerTokens ?? 3,
      completed: false
    };
  }

  if (card.encounter_type === ENCOUNTER_TYPES.BURDEN) {
    const choiceType = application?.effect?.type;
    const pendingChoice =
      ["pay_or_strain_choice", "arrival_pay_or_timer_choice", "resource_loss_or_strain_choice"].includes(choiceType) &&
      (application.effect.targets.length > 0 ||
        (choiceType === "resource_loss_or_strain_choice" && application.effect.paymentOptions.length > 0))
        ? application.effect
        : null;

    return {
      ...base,
      appliedSeasons: [state.season],
      applications: [application ?? createBurdenApplication(state, card, "reveal")],
      pendingChoice
    };
  }

  if (
    card.encounter_type === ENCOUNTER_TYPES.BOON &&
    (application?.type === "optional_resource_strain_relief" ||
      application?.type === "optional_resource_exchange" ||
      application?.type === "steward_help")
  ) {
    return {
      ...base,
      pending: true,
      effect: application
    };
  }

  return base;
}

export function revealEncounters(state, encounterCards, context = {}) {
  if (state.encounter.revealedRounds.includes(state.round)) {
    return {
      valid: false,
      errors: [`Round ${state.round} has already revealed Encounter Cards.`]
    };
  }

  const encounterIndex = createEncounterIndex(encounterCards);
  const deck = [...state.encounter.deck];
  const discard = [...state.encounter.discard];
  let active = [...state.encounter.active];
  const roundEffects = [...(state.encounter.roundEffects ?? [])];
  const revealed = [];
  const requiredStandard = getRevealCountForPlayerCount(state.playerCount);
  let standardRevealed = 0;
  let goldenRevealed = 0;

  while (deck.length > 0 && standardRevealed < requiredStandard) {
    const cardId = deck.shift();
    const card = encounterIndex.get(cardId);

    if (!card) {
      return {
        valid: false,
        errors: [`Unknown Encounter card id: ${cardId}`]
      };
    }

    const entry = {
      cardId,
      encounterType: card.encounter_type,
      cardName: card.card_name,
      countsAsStandardReveal: card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON
    };
    revealed.push(entry);

    if (card.encounter_type === ENCOUNTER_TYPES.GOLDEN_BOON) {
      goldenRevealed += 1;
      discard.push(cardId);
      continue;
    }

    standardRevealed += 1;

    if (card.encounter_type === ENCOUNTER_TYPES.BURDEN) {
      const burdenEffect = resolveBurdenSeasonEffect(state, card, "reveal", context);
      state = burdenEffect.state;
      if (burdenEffect.effect) {
        entry.burdenEffect = burdenEffect.effect;
      }

      active.push(createActiveEncounterState({ ...state, encounter: { ...state.encounter, active } }, card, burdenEffect.application));
    } else if (card.encounter_type === ENCOUNTER_TYPES.ARRIVAL) {
      active.push(createActiveEncounterState({ ...state, encounter: { ...state.encounter, active } }, card));
    } else {
      const immediateEffect = resolveBoonImmediateEffect(state, card, active, deck, context);
      state = immediateEffect.state;
      active = immediateEffect.active;
      deck.splice(0, deck.length, ...immediateEffect.deck);
      if (immediateEffect.effect) {
        entry.immediateEffect = immediateEffect.effect;
      }

      const roundEffect = createBoonRoundEffect(state, card, roundEffects.length);
      if (roundEffect) {
        roundEffects.push(roundEffect);
        entry.roundEffect = roundEffect;
      }

      const discardOnReveal = roundEffect ? roundEffect.discardOnReveal !== false : immediateEffect.discardOnReveal !== false;

      if (discardOnReveal) {
        discard.push(cardId);
      }
    }
  }

  if (standardRevealed < requiredStandard) {
    return {
      valid: false,
      errors: [
        `Encounter Deck has only ${standardRevealed} standard card${standardRevealed === 1 ? "" : "s"} available, but ${requiredStandard} required.`
      ]
    };
  }

  return {
    valid: true,
    revealed,
    standardRevealed,
    goldenRevealed,
    encounter: {
      ...state.encounter,
      deck,
      discard,
      active,
      roundEffects,
      revealedRounds: [...state.encounter.revealedRounds, state.round]
    },
    warehouse: state.warehouse,
    map: state.map
  };
}
