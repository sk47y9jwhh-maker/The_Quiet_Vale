import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { GAME_PHASES, createInitialGameState } from "../src/game/setup.js";
import { TILE_ACTION_TYPES } from "../src/game/tiles.js";

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
    seed: "upgrade",
    encounterCards,
    tiles,
    mapHexes
  });

  return {
    ...state,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  };
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles });
}

function coreUpgradeDiscount({ id = "discount-1", amount = 2, season = "II" } = {}) {
  return {
    id,
    source: "boon",
    type: "core_upgrade_discount",
    cardId: "boon_raised_in_good_season",
    cardName: "Raised in Good Season",
    round: season === "I" ? 1 : season === "II" ? 6 : 11,
    season,
    effectText: `Keep this card face-up. The next time players upgrade a Core Tile, reduce that upgrade's resource cost by ${amount} resource${amount === 1 ? "" : "s"} of your choice. Then discard this card.`,
    amount,
    maxUses: 1,
    uses: 0,
    expiresAtEndOfRound: false,
    discardOnReveal: false,
    discardAfterUse: true
  };
}

function feudsHousingDiscount({ amount = 2, freeResourceCost = false } = {}) {
  return {
    id: "round-effect-boon-feuds",
    source: "boon",
    type: "tile_resource_discount",
    cardId: "boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found",
    cardName: "Feuds soften as warm hearths, green heaths and safe havens are found",
    round: 6,
    season: "II",
    effectText: "The next Housing Tile placed or upgraded this round costs 2 fewer Resources total.",
    amount: freeResourceCost ? null : amount,
    freeResourceCost,
    targetCategories: ["Housing"],
    allowedResources: null,
    appliesTo: ["placement", "upgrade"],
    maxUses: 1,
    uses: 0,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function manyHandsPlacedOrUpgradedDiscount({ amount = 2, uses = 0 } = {}) {
  return {
    id: "round-effect-boon-many-hands",
    source: "boon",
    type: "tile_resource_discount",
    cardId: "boon_many_hands_make_light_work",
    cardName: "Many hands make light work",
    round: 11,
    season: "III",
    effectText: "The next two tiles placed or upgraded this round each cost 2 fewer resources total.",
    amount,
    freeResourceCost: false,
    targetCategories: null,
    allowedResources: null,
    appliesTo: ["placement", "upgrade"],
    maxUses: 2,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

function roadsPlacedOrUpgradedActionDiscount({ uses = 0 } = {}) {
  return {
    id: "round-effect-boon-roads",
    source: "boon",
    type: "tile_action_discount",
    cardId: "boon_when_the_roads_filled_once_more",
    cardName: "When the roads filled once more",
    round: 6,
    season: "II",
    effectText: "The next Travel Tile placed or upgraded this round costs 0 Actions.",
    targetCategories: ["Travel"],
    appliesTo: ["placement", "upgrade"],
    maxUses: 1,
    uses,
    expiresAtEndOfRound: true,
    discardOnReveal: true
  };
}

test("upgrades a placed Core tile, spending 1 Action and listed resources", () => {
  const filled = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const afterPlacement = dispatch(filled, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A3",
    orientation: "rotation-0"
  }).state;
  const { state: nextState, result } = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, TILE_ACTION_TYPES.UPGRADE_TILE);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_paved_path_upgraded");
  assert.deepEqual(nextState.map.placedTiles[0].coordinates, ["A3", "A4"]);
  assert.equal(nextState.map.placedTiles[0].orientation, "rotation-0");
  assert.equal(nextState.map.placedTiles[0].strain, 0);
  assert.equal(nextState.players[0].actionsRemaining, 2);
  assert.deepEqual(nextState.players[0].lastInteraction, {
    type: "upgrade",
    placedTileId: "tile-001",
    coordinate: "A3",
    round: 1,
    season: "I"
  });
  assert.equal(nextState.warehouse.resources.Stone, 11);
  assert.equal(nextState.score.renown, 5);
  assert.equal(nextState.score.total, 5);
  assert.equal(nextState.log.at(-1).type, "upgrade_tile");
});

test("Raised in Good Season reduces the next Core upgrade cost and then discards", () => {
  const base = newState();
  const state = {
    ...base,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Stone: 2
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_gravel_path_basic",
          coordinate: "A3",
          coordinates: ["A3", "A4"],
          orientation: "rotation-0",
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: [],
      roundEffects: [coreUpgradeDiscount()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001",
    upgradeCostReductionResources: ["Stone", "Stone"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [{ amount: 4, resource: "Stone" }]);
  assert.deepEqual(result.cost, [{ amount: 2, resource: "Stone" }]);
  assert.equal(result.upgradeCostReduction.amountReduced, 2);
  assert.deepEqual(result.upgradeCostReduction.reduction, [{ amount: 2, resource: "Stone" }]);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_paved_path_upgraded");
  assert.equal(nextState.warehouse.resources.Stone, 0);
  assert.deepEqual(nextState.encounter.roundEffects, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_raised_in_good_season"]);
  assert.equal(nextState.log.at(-1).data.upgradeCostReduction.cardId, "boon_raised_in_good_season");
});

test("Core upgrade discount requires chosen reduction resources", () => {
  const base = newState();
  const state = {
    ...base,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Stone: 4
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_gravel_path_basic",
          coordinate: "A3",
          coordinates: ["A3", "A4"],
          orientation: "rotation-0",
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      roundEffects: [coreUpgradeDiscount({ amount: 1, season: "I" })]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Choose exactly 1 resource/);
});

test("Core upgrade discount is consumed by a zero-resource Core upgrade", () => {
  const base = newState();
  const state = {
    ...base,
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_forest_basic",
          coordinate: "A13",
          coordinates: ["A13"],
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: [],
      roundEffects: [coreUpgradeDiscount({ amount: 1, season: "I" })]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, []);
  assert.deepEqual(result.cost, []);
  assert.equal(result.upgradeCostReduction.amountReduced, 0);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_managed_woodlands_upgraded");
  assert.deepEqual(nextState.encounter.roundEffects, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_raised_in_good_season"]);
});

test("Feuds soften reduces the next Housing upgrade cost without discarding again", () => {
  const base = newState();
  const state = {
    ...base,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 5
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_cottage_basic",
          coordinate: "A3",
          coordinates: ["A3"],
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: ["boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found"],
      roundEffects: [feudsHousingDiscount()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001",
    upgradeCostReductionResources: ["Stone", "Stone"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Stone" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, [{ amount: 5, resource: "Food" }]);
  assert.equal(result.upgradeCostReduction.cardId, "boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found");
  assert.equal(result.upgradeCostReduction.amountReduced, 2);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_home_upgraded");
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.deepEqual(nextState.encounter.discard, ["boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found"]);
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("Feuds soften requires chosen resources for a Housing upgrade discount", () => {
  const base = newState();
  const state = {
    ...base,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Stone: 2,
        Food: 5
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_cottage_basic",
          coordinate: "A3",
          coordinates: ["A3"],
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: ["boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found"],
      roundEffects: [feudsHousingDiscount({ amount: 1 })]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Choose exactly 1 resource/);
});

test("Feuds soften Season III can make a Housing upgrade cost 0 Resources", () => {
  const base = newState();
  const state = {
    ...base,
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_cottage_basic",
          coordinate: "A3",
          coordinates: ["A3"],
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: ["boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found"],
      roundEffects: [feudsHousingDiscount({ freeResourceCost: true })]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { amount: 2, resource: "Stone" },
    { amount: 5, resource: "Food" }
  ]);
  assert.deepEqual(result.cost, []);
  assert.equal(result.upgradeCostReduction.amountReduced, 7);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_home_upgraded");
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("Many hands make light work can discount a non-Housing upgrade", () => {
  const base = newState();
  const state = {
    ...base,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Stone: 2
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_gravel_path_basic",
          coordinate: "A3",
          coordinates: ["A3", "A4"],
          orientation: "rotation-0",
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: ["boon_many_hands_make_light_work"],
      roundEffects: [manyHandsPlacedOrUpgradedDiscount()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001",
    upgradeCostReductionResources: ["Stone", "Stone"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [{ amount: 4, resource: "Stone" }]);
  assert.deepEqual(result.cost, [{ amount: 2, resource: "Stone" }]);
  assert.equal(result.upgradeCostReduction.cardId, "boon_many_hands_make_light_work");
  assert.equal(result.upgradeCostReduction.amountReduced, 2);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_paved_path_upgraded");
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("When the roads filled once more upgrades the next Travel tile for 0 Actions", () => {
  const base = newState();
  const state = {
    ...base,
    players: base.players.map((player) => ({ ...player, actionsRemaining: 0 })),
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Stone: 4
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_gravel_path_basic",
          coordinate: "A3",
          coordinates: ["A3", "A4"],
          orientation: "rotation-0",
          strain: 0
        }
      ]
    },
    encounter: {
      ...base.encounter,
      discard: ["boon_when_the_roads_filled_once_more"],
      roundEffects: [roadsPlacedOrUpgradedActionDiscount()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.actionCost.originalTotal, 1);
  assert.equal(result.actionCostDiscount.cardId, "boon_when_the_roads_filled_once_more");
  assert.deepEqual(result.cost, [{ amount: 4, resource: "Stone" }]);
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.equal(nextState.warehouse.resources.Stone, 0);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_paved_path_upgraded");
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
});

test("resource tile upgrades cost only the Upgrade action when source cost is zero", () => {
  const afterPlacement = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const { state: nextState, result } = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_managed_woodlands_upgraded");
  assert.equal(nextState.players[0].actionsRemaining, 2);
  assert.deepEqual(nextState.warehouse.resources, newState().warehouse.resources);
});

test("upgrading a disconnected tile spends one Travel action plus one Upgrade action", () => {
  const base = newState();
  const state = {
    ...base,
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
        },
        {
          id: "tile-002",
          tileId: "core_forest_basic",
          coordinate: "A13",
          coordinates: ["A13"],
          orientation: "rotation-0",
          strain: 0
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 2);
  assert.equal(result.actionCost.upgradeActionCost, 1);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(nextState.players[0].actionsRemaining, 2);
  assert.equal(nextState.map.placedTiles[1].tileId, "core_managed_woodlands_upgraded");
});

test("Overstrained placed tiles cannot be upgraded", () => {
  const filled = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const afterPlacement = dispatch(filled, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A3",
    orientation: "rotation-0"
  }).state;
  const overstrained = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 3
  }).state;
  const { state: nextState, result } = dispatch(overstrained, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, overstrained);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_gravel_path_basic");
  assert.match(result.errors.join(" "), /Overstrained/);
});
