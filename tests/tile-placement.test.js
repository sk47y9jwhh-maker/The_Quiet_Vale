import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { GAME_PHASES, createInitialGameState } from "../src/game/setup.js";
import {
  TILE_ACTION_TYPES,
  getResourceCostChoiceGroups,
  resolveResourceCost,
  validatePlaceTile
} from "../src/game/tiles.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");

function newState() {
  const state = createInitialGameState({
    playerCount: 1,
    seed: "tile-placement",
    encounterCards,
    tiles,
    mapHexes
  });

  return withWarehouseResources({
    ...state,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  }, {});
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles });
}

function unlockSpecial(state, tileId) {
  return {
    ...state,
    tileSupply: {
      ...state.tileSupply,
      special: state.tileSupply.special.map((entry) =>
        entry.tileId === tileId
          ? {
              ...entry,
              locked: false,
              available: entry.stock
            }
          : entry
      )
    }
  };
}

function withWarehouseResources(state, resources) {
  return {
    ...state,
    warehouse: {
      ...state.warehouse,
      resources: Object.fromEntries(state.rules.resources.map((resource) => [resource, resources[resource] ?? 0]))
    }
  };
}

function createBreweryPlacementState() {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_brewery_of_legends");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_tavern_basic",
    coordinate: "C3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_brewery_of_legends",
    coordinate: "D3"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;

  return withWarehouseResources(state, {});
}

function createLabourersYardPlacementState() {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_labourers_yard");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_labourers_yard",
    coordinate: "C3"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;

  return state;
}

test("Merchant and Crafting tiles require adjacent Travel placement", () => {
  const travelAdjacentTileIds = [
    "core_market_stalls_basic",
    "core_the_seldes_upgraded",
    "core_workshops_basic",
    "core_the_makers_conclave_upgraded"
  ];
  const placementRules = Object.fromEntries(
    tiles.filter((tile) => travelAdjacentTileIds.includes(tile.tile_id)).map((tile) => [tile.tile_id, tile.placement_rules])
  );

  assert.deepEqual(placementRules, {
    core_market_stalls_basic: "Place adjacent to Travel Tile",
    core_the_seldes_upgraded: "Place adjacent to Travel Tile",
    core_workshops_basic: "Place adjacent to Travel Tile",
    core_the_makers_conclave_upgraded: "Place adjacent to Travel Tile"
  });

  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const marketWithoutTravel = validatePlaceTile(
    state,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_market_stalls_basic",
      coordinate: "C3"
    },
    { tiles }
  );

  assert.equal(marketWithoutTravel.valid, false);
  assert.match(marketWithoutTravel.errors.join(" "), /adjacent to Travel/);

  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;

  const marketWithTravel = validatePlaceTile(
    state,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_market_stalls_basic",
      coordinate: "C3"
    },
    { tiles }
  );
  const workshopsWithTravel = validatePlaceTile(
    state,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_workshops_basic",
      coordinate: "C3"
    },
    { tiles }
  );

  assert.equal(marketWithTravel.valid, true);
  assert.equal(workshopsWithTravel.valid, true);
});

function apprenticeStewardPlacementActionEffect({ targetCategories = ["Resource", "Housing"], uses = 0 } = {}) {
  return {
    id: "round-effect-boon-the-apprentice-steward",
    source: "boon",
    type: "tile_action_discount",
    cardId: "boon_the_apprentice_steward",
    cardName: "The Apprentice Steward",
    round: 6,
    season: "II",
    effectText: "The next Resource or Housing Tile placed this round costs 0 Actions.",
    targetCategories,
    appliesTo: ["placement"],
    maxUses: 1,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function oldFoundationsPlacementDiscountEffect({ amount = 2, uses = 0 } = {}) {
  return {
    id: "round-effect-boon-old-foundations",
    source: "boon",
    type: "placement_resource_discount",
    cardId: "boon_old_foundations_still_remain",
    cardName: "Old foundations still remain",
    round: 1,
    season: "I",
    effectText: "The next Housing Tile placed this round costs 2 fewer Wood or Stone.",
    amount,
    targetCategories: ["Housing"],
    allowedResources: ["Wood", "Stone"],
    maxUses: 1,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function feudsHousingDiscountEffect({ amount = 1, uses = 0, freeResourceCost = false } = {}) {
  return {
    id: "round-effect-boon-feuds",
    source: "boon",
    type: "tile_resource_discount",
    cardId: "boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found",
    cardName: "Feuds soften as warm hearths, green heaths and safe havens are found",
    round: 1,
    season: "I",
    effectText: "The next Housing Tile placed or upgraded this round costs 1 fewer resource of your choice.",
    amount: freeResourceCost ? null : amount,
    freeResourceCost,
    targetCategories: ["Housing"],
    allowedResources: null,
    appliesTo: ["placement", "upgrade"],
    maxUses: 1,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function manyHandsPlacementDiscountEffect({ amount = 1, maxUses = 2, uses = 0 } = {}) {
  return {
    id: "round-effect-boon-many-hands",
    source: "boon",
    type: "tile_resource_discount",
    cardId: "boon_many_hands_make_light_work",
    cardName: "Many hands make light work",
    round: 6,
    season: "II",
    effectText: "The next two tiles placed this round each cost 1 fewer resource of your choice.",
    amount,
    freeResourceCost: false,
    targetCategories: null,
    allowedResources: null,
    appliesTo: ["placement"],
    maxUses,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function roadsActionDiscountEffect({ appliesTo = ["placement"], maxUses = 1, uses = 0 } = {}) {
  return {
    id: "round-effect-boon-roads",
    source: "boon",
    type: "tile_action_discount",
    cardId: "boon_when_the_roads_filled_once_more",
    cardName: "When the roads filled once more",
    round: 1,
    season: "I",
    effectText: "The next Travel Tile placed this round costs 0 Actions.",
    targetCategories: ["Travel"],
    appliesTo,
    maxUses,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

test("places a free terrain-matched core tile and decrements stock", () => {
  const state = newState();
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles.length, 1);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_forest_basic");
  assert.equal(nextState.map.placedTiles[0].coordinate, "A13");
  assert.deepEqual(nextState.map.placedTiles[0].coordinates, ["A13"]);
  assert.deepEqual(nextState.players[0].lastInteraction, {
    type: "place",
    placedTileId: "tile-001",
    coordinate: "A13",
    round: 1,
    season: "I"
  });
  assert.equal(nextState.tileSupply.core.find((entry) => entry.tileId === "core_forest_basic").available, 1);
  assert.equal(nextState.log.at(-1).type, "place_tile");
});

test("Market Stalls can spend 1 Goods as 1 missing resource in a tile cost", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_market_stalls_basic",
    coordinate: "C3"
  }).state;
  state = withWarehouseResources(state, {
    Wood: 2,
    Food: 4,
    Goods: 1
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "C4"
  });

  assert.equal(result.ok, true);
  assert.equal(result.resourceCostSubstitution.providerTileName, "Market Stalls");
  assert.deepEqual(result.cost, [
    { amount: 2, resource: "Wood" },
    { amount: 4, resource: "Food" },
    { amount: 1, resource: "Goods" }
  ]);
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.equal(nextState.warehouse.resources.Goods, 0);
});

test("The Apprentice Steward makes the next eligible placement cost 0 Actions", () => {
  const base = withWarehouseResources(newState(), { Wood: 2, Food: 5 });
  const state = {
    ...base,
    round: 6,
    season: "II",
    encounter: {
      ...base.encounter,
      discard: ["boon_the_apprentice_steward"],
      roundEffects: [apprenticeStewardPlacementActionEffect()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, [
    { amount: 2, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.actionCostDiscount.cardId, "boon_the_apprentice_steward");
  assert.equal(result.actionCostDiscount.amountReduced, 1);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
  assert.deepEqual(nextState.encounter.discard, ["boon_the_apprentice_steward"]);
});

test("The Apprentice Steward is consumed by the next eligible free-action placement", () => {
  const base = newState();
  const state = {
    ...base,
    round: 1,
    season: "I",
    encounter: {
      ...base.encounter,
      discard: ["boon_the_apprentice_steward"],
      roundEffects: [
        apprenticeStewardPlacementActionEffect({
          targetCategories: ["Resource"]
        })
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, []);
  assert.deepEqual(result.cost, []);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.actionCostDiscount.cardId, "boon_the_apprentice_steward");
  assert.equal(result.actionCostDiscount.amountReduced, 1);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("Old foundations still remain reduces the next Housing placement cost", () => {
  const base = withWarehouseResources(newState(), { Food: 5 });
  const state = {
    ...base,
    encounter: {
      ...base.encounter,
      discard: ["boon_old_foundations_still_remain"],
      roundEffects: [oldFoundationsPlacementDiscountEffect()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3",
    placementCostReductionResources: ["Wood", "Wood"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, [{ amount: 5, resource: "Food" }]);
  assert.equal(result.placementCostReduction.cardId, "boon_old_foundations_still_remain");
  assert.equal(result.placementCostReduction.amountReduced, 2);
  assert.deepEqual(result.placementCostReduction.reduction, [{ resource: "Wood", amount: 2 }]);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("Old foundations still remain requires selected Wood or Stone reductions", () => {
  const base = withWarehouseResources(newState(), { Wood: 2, Food: 5 });
  const state = {
    ...base,
    encounter: {
      ...base.encounter,
      discard: ["boon_old_foundations_still_remain"],
      roundEffects: [oldFoundationsPlacementDiscountEffect()]
    }
  };
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Choose exactly 2 resources/);
});

test("Feuds soften reduces the next Housing placement cost", () => {
  const base = withWarehouseResources(newState(), { Wood: 1, Food: 5 });
  const state = {
    ...base,
    encounter: {
      ...base.encounter,
      discard: ["boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found"],
      roundEffects: [feudsHousingDiscountEffect()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3",
    placementCostReductionResources: ["Wood"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, [
    { amount: 1, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.equal(result.placementCostReduction.cardId, "boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found");
  assert.equal(result.placementCostReduction.amountReduced, 1);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("Many hands make light work discounts the next two placed tiles", () => {
  const base = withWarehouseResources(newState(), { Wood: 2, Food: 10 });
  const state = {
    ...base,
    encounter: {
      ...base.encounter,
      discard: ["boon_many_hands_make_light_work"],
      roundEffects: [manyHandsPlacementDiscountEffect()]
    }
  };
  const first = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3",
    placementCostReductionResources: ["Wood"]
  });
  const reset = dispatch(first.state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS });
  const second = dispatch(reset.state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "B3",
    placementCostReductionResources: ["Wood"]
  });

  assert.equal(first.result.ok, true);
  assert.equal(second.result.ok, true);
  assert.equal(first.result.placementCostReduction.cardId, "boon_many_hands_make_light_work");
  assert.equal(second.result.placementCostReduction.cardId, "boon_many_hands_make_light_work");
  assert.equal(second.state.encounter.roundEffects[0].uses, 2);
  assert.equal(second.state.warehouse.resources.Wood, 0);
  assert.equal(second.state.warehouse.resources.Food, 0);
});

test("When the roads filled once more places the next Travel tile for 0 Actions", () => {
  const base = newState();
  const state = {
    ...base,
    players: base.players.map((player) => ({ ...player, actionsRemaining: 0 })),
    encounter: {
      ...base.encounter,
      discard: ["boon_when_the_roads_filled_once_more"],
      roundEffects: [roadsActionDiscountEffect()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.actionCost.originalTotal, 1);
  assert.equal(result.actionCostDiscount.cardId, "boon_when_the_roads_filled_once_more");
  assert.equal(result.actionCostDiscount.amountReduced, 1);
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("When the roads filled once more does not waive disconnected Travel for placement", () => {
  const base = newState();
  const state = {
    ...base,
    players: base.players.map((player) => ({ ...player, actionsRemaining: 1 })),
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_gravel_path_basic",
          coordinate: "C1",
          coordinates: ["C1", "C2"],
          orientation: "rotation-0",
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: ["boon_when_the_roads_filled_once_more"],
      roundEffects: [roadsActionDiscountEffect()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A10",
    orientation: "rotation-0"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(result.actionCost.placeActionCost, 0);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(result.actionCostDiscount.amountReduced, 1);
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("rejects terrain mismatch without mutating state", () => {
  const state = newState();
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "C1"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Woodland/);
  assert.equal(nextState.map.placedTiles.length, 0);
});

test("river placement rules distinguish Bridge from normal tiles", () => {
  const state = newState();
  const farmValidation = validatePlaceTile(
    state,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "core_farm_basic", coordinate: "C7" },
    { tiles }
  );
  const bridgeValidation = validatePlaceTile(
    state,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "core_bridge_basic", coordinate: "C6" },
    { tiles }
  );

  assert.equal(farmValidation.valid, false);
  assert.match(farmValidation.errors.join(" "), /cannot cover a River hex/);
  assert.equal(bridgeValidation.valid, false);
  assert.match(bridgeValidation.errors.join(" "), /must be placed on Water terrain/);
});

test("Bridge spends Wood and can be placed on a river hex after warehouse debug fill", () => {
  const state = newState();
  const filled = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const { state: nextState, result } = dispatch(filled, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_bridge_basic",
    coordinate: "C7"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Wood, 13);
  assert.equal(nextState.tileSupply.core.find((entry) => entry.tileId === "core_bridge_basic").available, 2);
  assert.equal(nextState.map.placedTiles[0].coordinate, "C7");
});

test("rejects placement on occupied hexes", () => {
  const state = newState();
  const afterForest = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const { result } = dispatch(afterForest, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_mine_basic",
    coordinate: "A13"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /already has a placed tile/);
});

test("validates river-adjacent land placement", () => {
  const filled = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const valid = validatePlaceTile(
    filled,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "core_washhouse_basic", coordinate: "C8" },
    { tiles }
  );
  const invalid = validatePlaceTile(
    filled,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "core_washhouse_basic", coordinate: "C12" },
    { tiles }
  );

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /adjacent to Water terrain/);
});

test("upgraded and special tiles are locked from direct placement", () => {
  const filled = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const upgraded = validatePlaceTile(
    filled,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "core_stone_bridge_upgraded", coordinate: "C7" },
    { tiles }
  );
  const special = validatePlaceTile(
    filled,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "special_docks", coordinate: "C8" },
    { tiles }
  );

  assert.equal(upgraded.valid, false);
  assert.match(upgraded.errors.join(" "), /not available for direct placement yet/);
  assert.equal(special.valid, false);
  assert.match(special.errors.join(" "), /not available for direct placement yet/);
});

test("places an unlocked Special tile and decrements Special stock", () => {
  const state = {
    ...newState(),
    tileSupply: {
      ...newState().tileSupply,
      special: newState().tileSupply.special.map((entry) =>
        entry.tileId === "special_docks"
          ? {
              ...entry,
              locked: false,
              available: entry.stock
            }
          : entry
      )
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_docks",
    coordinate: "C7"
  });
  const docks = nextState.tileSupply.special.find((entry) => entry.tileId === "special_docks");

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles.length, 1);
  assert.equal(nextState.map.placedTiles[0].tileId, "special_docks");
  assert.equal(nextState.map.placedTiles[0].coordinate, "C7");
  assert.equal(docks.available, 0);
});

test("places a two-hex Street footprint across empty legal land hexes", () => {
  const state = withWarehouseResources(newState(), { Stone: 2 });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A3",
    orientation: "rotation-0"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.map.placedTiles[0].coordinates, ["A3", "A4"]);
  assert.equal(nextState.map.placedTiles[0].orientation, "rotation-0");
  assert.equal(nextState.tileSupply.core.find((entry) => entry.tileId === "core_gravel_path_basic").available, 5);
});

test("Street placement cost can be paid with Stone or Wood", () => {
  const groups = getResourceCostChoiceGroups("2 Stone or 2 Wood");
  const woodCost = resolveResourceCost("2 Stone or 2 Wood", ["Wood"]);
  const stoneCost = resolveResourceCost("2 Stone or 2 Wood", ["Stone"]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options, [
    { amount: 2, resource: "Stone" },
    { amount: 2, resource: "Wood" }
  ]);
  assert.deepEqual(woodCost.cost, [{ resource: "Wood", amount: 2 }]);
  assert.deepEqual(stoneCost.cost, [{ resource: "Stone", amount: 2 }]);
});

test("Track placement cost can be paid with Stone or Wood", () => {
  const groups = getResourceCostChoiceGroups("3 Stone or 3 Wood");
  const woodCost = resolveResourceCost("3 Stone or 3 Wood", ["Wood"]);
  const stoneCost = resolveResourceCost("3 Stone or 3 Wood", ["Stone"]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options, [
    { amount: 3, resource: "Stone" },
    { amount: 3, resource: "Wood" }
  ]);
  assert.deepEqual(woodCost.cost, [{ resource: "Wood", amount: 3 }]);
  assert.deepEqual(stoneCost.cost, [{ resource: "Stone", amount: 3 }]);
});

test("placement validation uses the selected alternative resource cost", () => {
  const state = withWarehouseResources(newState(), { Wood: 2 });
  const validation = validatePlaceTile(
    state,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_gravel_path_basic",
      coordinate: "A3",
      orientation: "rotation-0",
      placementCostChoiceResources: ["Wood"]
    },
    { tiles }
  );

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.baseCost, [{ resource: "Wood", amount: 2 }]);
  assert.deepEqual(validation.cost, [{ resource: "Wood", amount: 2 }]);
});

test("places a three-hex Track footprint across empty legal land hexes", () => {
  const state = withWarehouseResources(newState(), { Stone: 3 });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_track_basic",
    coordinate: "A3",
    orientation: "rotation-0"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.map.placedTiles[0].coordinates, ["A3", "A4", "B5"]);
  assert.equal(nextState.tileSupply.core.find((entry) => entry.tileId === "core_gravel_track_basic").available, 3);
});

test("rejects multihex footprints that leave the map", () => {
  const state = newState();
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_track_basic",
    coordinate: "A1",
    orientation: "rotation-1"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /footprint leaves the approved map/);
});

test("rejects multihex footprints covering River hexes", () => {
  const state = newState();
  const { result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C6",
    orientation: "rotation-0"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /cannot cover a River hex/);
});

test("rejects multihex footprints covering occupied hexes", () => {
  const afterForest = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const { result } = dispatch(afterForest, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A12",
    orientation: "rotation-1"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /A13 already has a placed tile/);
});

test("Brewery of Legends makes one adjacent paid placement cost 0 resources each season", () => {
  const state = createBreweryPlacementState();
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D4"
  });
  const brewery = nextState.map.placedTiles.find((tile) => tile.id === "tile-003");

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, []);
  assert.equal(result.placementCostReduction.providerPlacedTileId, "tile-003");
  assert.equal(result.placementCostReduction.providerTileName, "Brewery of Legends");
  assert.deepEqual(brewery.placementDiscountSeasons, ["I"]);
  assert.deepEqual(nextState.warehouse.resources, state.warehouse.resources);
});

test("Brewery of Legends cannot discount two adjacent placements in the same season", () => {
  let state = createBreweryPlacementState();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D4"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_terrace_basic",
    coordinate: "C4"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Terrace costs 2 Wood, 2 Metal, 8 Food/);
});

test("Brewery of Legends cannot discount again in a later round of the same season", () => {
  let state = createBreweryPlacementState();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D4"
  }).state;
  state = {
    ...state,
    round: 2,
    players: state.players.map((player) => ({ ...player, actionsRemaining: 4 }))
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_terrace_basic",
    coordinate: "C4"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Terrace costs 2 Wood, 2 Metal, 8 Food/);
});

test("Brewery of Legends discounts again in a later season", () => {
  let state = createBreweryPlacementState();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D4"
  }).state;
  state = {
    ...state,
    round: 5,
    season: "II",
    players: state.players.map((player) => ({ ...player, actionsRemaining: 4 }))
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_terrace_basic",
    coordinate: "C4"
  });
  const brewery = nextState.map.placedTiles.find((tile) => tile.id === "tile-003");

  assert.equal(result.ok, true);
  assert.deepEqual(result.cost, []);
  assert.deepEqual(brewery.placementDiscountSeasons, ["I", "II"]);
});

test("Overstrained Brewery of Legends does not discount adjacent placement", () => {
  let state = createBreweryPlacementState();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 3
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D4"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Cottage costs 2 Wood, 5 Food/);
});

test("Labourers' Yard reduces one chosen adjacent placement cost resource each season", () => {
  const state = withWarehouseResources(createLabourersYardPlacementState(), {
    Food: 5
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D3",
    placementCostReductionResource: "Wood"
  });
  const labourersYard = nextState.map.placedTiles.find((tile) => tile.id === "tile-002");

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Wood" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, [{ amount: 5, resource: "Food" }]);
  assert.equal(result.placementCostReduction.providerPlacedTileId, "tile-002");
  assert.equal(result.placementCostReduction.providerTileName, "Labourers’ Yard");
  assert.equal(result.placementCostReduction.resource, "Wood");
  assert.equal(result.placementCostReduction.amountReduced, 2);
  assert.deepEqual(labourersYard.placementDiscountSeasons, ["I"]);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Food, 0);
});

test("Labourers' Yard rejects a reduction resource outside the placement cost", () => {
  const state = withWarehouseResources(createLabourersYardPlacementState(), {
    Food: 5,
    Metal: 1,
    Wood: 2
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D3",
    placementCostReductionResource: "Metal"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /can only reduce a resource in Cottage's placement cost/);
});

test("Labourers' Yard cannot reduce two adjacent placements in the same season", () => {
  let state = withWarehouseResources(createLabourersYardPlacementState(), {
    Food: 5,
    Wood: 0
  });
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D3",
    placementCostReductionResource: "Wood"
  }).state;
  state = withWarehouseResources(state, {
    Food: 8,
    Metal: 2,
    Wood: 0
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_terrace_basic",
    coordinate: "C4",
    placementCostReductionResource: "Wood"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Terrace costs 2 Wood, 2 Metal, 8 Food/);
});

test("Labourers' Yard cannot reduce adjacent placement again in a later round of the same season", () => {
  let state = withWarehouseResources(createLabourersYardPlacementState(), {
    Food: 5,
    Wood: 0
  });
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D3",
    placementCostReductionResource: "Wood"
  }).state;
  state = withWarehouseResources(
    {
      ...state,
      round: 2,
      players: state.players.map((player) => ({ ...player, actionsRemaining: 4 }))
    },
    {
      Food: 8,
      Metal: 2,
      Wood: 0
    }
  );
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_terrace_basic",
    coordinate: "C4",
    placementCostReductionResource: "Wood"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Terrace costs 2 Wood, 2 Metal, 8 Food/);
});

test("Labourers' Yard reduces adjacent placement again in a later season", () => {
  let state = withWarehouseResources(createLabourersYardPlacementState(), {
    Food: 5,
    Wood: 0
  });
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D3",
    placementCostReductionResource: "Wood"
  }).state;
  state = withWarehouseResources(
    {
      ...state,
      round: 5,
      season: "II",
      players: state.players.map((player) => ({ ...player, actionsRemaining: 4 }))
    },
    {
      Food: 8,
      Metal: 2,
      Wood: 0
    }
  );
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_terrace_basic",
    coordinate: "C4",
    placementCostReductionResource: "Wood"
  });
  const labourersYard = nextState.map.placedTiles.find((tile) => tile.id === "tile-002");

  assert.equal(result.ok, true);
  assert.deepEqual(result.cost, [
    { amount: 2, resource: "Metal" },
    { amount: 8, resource: "Food" }
  ]);
  assert.deepEqual(labourersYard.placementDiscountSeasons, ["I", "II"]);
});

test("Overstrained Labourers' Yard does not reduce adjacent placement costs", () => {
  let state = withWarehouseResources(createLabourersYardPlacementState(), {
    Food: 5,
    Wood: 1
  });
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "D3",
    placementCostReductionResource: "Wood"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Cottage costs 2 Wood, 5 Food/);
});

test("special tiles that require a base Resource tile can be placed next to its upgraded side", () => {
  let state = unlockSpecial(newState(), "special_the_iron_roots_respite");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_mine_basic",
    coordinate: "A2"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;

  const validation = validatePlaceTile(
    state,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "special_the_iron_roots_respite",
      coordinate: "B3"
    },
    { tiles }
  );
  const { result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_the_iron_roots_respite",
    coordinate: "B3"
  });

  assert.equal(validation.valid, true);
  assert.equal(result.ok, true);
});
