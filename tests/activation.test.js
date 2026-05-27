import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { ENCOUNTER_TYPES, GAME_PHASES, createInitialGameState } from "../src/game/setup.js";
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
    seed: "activation",
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
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

function withActiveArrival(state, { id = "arrival-active", timerTokens = 1 } = {}) {
  const arrivalCard = encounterCards.find((card) => card.encounter_type === ENCOUNTER_TYPES.ARRIVAL);

  return {
    ...state,
    encounter: {
      ...state.encounter,
      active: [
        {
          id,
          cardId: arrivalCard.card_id,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: state.round,
          revealedSeason: state.season,
          resolved: false,
          completed: false,
          timerTokens
        }
      ]
    }
  };
}

function withActiveBurden(state, { id = "burden-active", cardId } = {}) {
  const burdenCard = cardId
    ? encounterCards.find((card) => card.card_id === cardId)
    : encounterCards.find((card) => card.encounter_type === ENCOUNTER_TYPES.BURDEN);

  return {
    ...state,
    encounter: {
      ...state.encounter,
      active: [
        {
          id,
          cardId: burdenCard.card_id,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: state.round,
          revealedSeason: state.season,
          resolved: false,
          appliedSeasons: [state.season],
          applications: []
        }
      ]
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

test("activates a basic Resource tile for its Production benefit", () => {
  const afterPlacement = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const { state: nextState, result } = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, TILE_ACTION_TYPES.ACTIVATE_TILE);
  assert.equal(nextState.warehouse.resources.Wood, 1);
  assert.equal(nextState.players[0].actionsRemaining, 2);
  assert.deepEqual(nextState.players[0].lastInteraction, {
    type: "activate",
    placedTileId: "tile-001",
    coordinate: "A13",
    round: 1,
    season: "I"
  });
  assert.deepEqual(result.gains, [{ amount: 1, resource: "Wood" }]);
  assert.equal(nextState.log.at(-1).type, "activate_tile");
});

test("activates an upgraded Resource tile for its upgraded Production benefit", () => {
  const afterPlacement = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  const afterUpgrade = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  }).state;
  const { state: nextState, result } = dispatch(afterUpgrade, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles[0].tileId, "core_artisanal_farm_upgraded");
  assert.equal(nextState.warehouse.resources.Food, 2);
  assert.equal(nextState.warehouse.resources.Goods, 1);
  assert.equal(nextState.players[0].actionsRemaining, 1);
});

test("Production activation respects the Warehouse cap", () => {
  const filled = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  const afterPlacement = dispatch(filled, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const { state: nextState, result } = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Wood, 15);
  assert.deepEqual(result.applied, [
    {
      amount: 1,
      resource: "Wood",
      gained: 0,
      capped: true
    }
  ]);
});

test("adjacent Shrine of Bounty adds its passive Food production bonus", () => {
  let state = unlockSpecial(newState(), "special_shrine_of_bounty");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_shrine_of_bounty",
    coordinate: "A4"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.gains, [{ amount: 1, resource: "Food" }]);
  assert.deepEqual(result.bonusGains, [{ resource: "Food", amount: 2 }]);
  assert.deepEqual(result.totalGains, [{ resource: "Food", amount: 3 }]);
  assert.equal(result.productionBonuses[0].providerTileName, "Shrine of Bounty");
  assert.equal(nextState.warehouse.resources.Food, 3);
});

test("Boon round production effects add bonuses on matching Resource activation", () => {
  const base = newState();
  let state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["boon_bounty_of_the_first_harvest"],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.gains, [{ amount: 1, resource: "Food" }]);
  assert.deepEqual(result.bonusGains, [{ resource: "Food", amount: 1 }]);
  assert.deepEqual(result.totalGains, [{ resource: "Food", amount: 2 }]);
  assert.equal(result.productionBonuses[0].source, "boon");
  assert.equal(result.productionBonuses[0].cardName, "Bounty of the first harvest");
  assert.equal(nextState.encounter.roundEffects[0].uses, 1);
  assert.equal(nextState.warehouse.resources.Food, 2);
});

test("limited Boon production effects stop after their source-defined use count", () => {
  const base = newState();
  let state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["boon_bounty_of_the_first_harvest"],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.bonusGains, []);
  assert.equal(nextState.encounter.roundEffects[0].uses, 2);
  assert.equal(nextState.warehouse.resources.Food, 5);
  assert.equal(nextState.warehouse.resources.Goods, 2);
});

test("overstrained shrine providers do not add passive production bonuses", () => {
  let state = unlockSpecial(newState(), "special_shrine_of_bounty");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_shrine_of_bounty",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.bonusGains, []);
  assert.deepEqual(result.totalGains, [{ resource: "Food", amount: 1 }]);
  assert.equal(nextState.warehouse.resources.Food, 1);
});

test("matching-type shrine bonuses use the activated tile's first production resource", () => {
  let state = unlockSpecial(newState(), "special_shrine_of_renewal");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_shrine_of_renewal",
    coordinate: "A12"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.bonusGains, [{ resource: "Wood", amount: 2 }]);
  assert.deepEqual(result.totalGains, [{ resource: "Wood", amount: 3 }]);
  assert.equal(result.productionBonuses[0].reason, "matching_first_production_resource");
  assert.equal(nextState.warehouse.resources.Wood, 3);
});

test("matching-type shrine bonuses apply to upgraded resource tiles through base tile names", () => {
  let state = unlockSpecial(newState(), "special_shrine_of_renewal");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_shrine_of_renewal",
    coordinate: "A12"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.gains, [
    { amount: 2, resource: "Wood" },
    { amount: 1, resource: "Food" }
  ]);
  assert.deepEqual(result.bonusGains, [{ resource: "Wood", amount: 2 }]);
  assert.deepEqual(result.totalGains, [
    { resource: "Wood", amount: 4 },
    { resource: "Food", amount: 1 }
  ]);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").tileId, "core_managed_woodlands_upgraded");
  assert.equal(nextState.warehouse.resources.Wood, 4);
  assert.equal(nextState.warehouse.resources.Food, 1);
});

test("Overstrained placed tiles cannot be activated", () => {
  const afterPlacement = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const overstrained = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 3
  }).state;
  const { state: nextState, result } = dispatch(overstrained, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, overstrained);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.match(result.errors.join(" "), /Overstrained/);
});

test("tiles without a supported activation cannot activate", () => {
  const afterPlacement = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A3",
    orientation: "rotation-0"
  }).state;
  const { state: nextState, result } = dispatch(afterPlacement, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, afterPlacement);
  assert.match(result.errors.join(" "), /supported activation/);
});

test("activates a Strain-removal tile against one strained adjacent tile", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
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
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 2
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.strainRemoved, 1);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 1);
  assert.equal(nextState.players[0].actionsRemaining, 1);
  assert.equal(nextState.log.at(-1).type, "activate_tile");
  assert.match(result.message, /remove 1 Strain from Gravel Path/);
});

test("upgraded single-target Strain removal removes up to its listed amount", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_apothecary_basic",
    coordinate: "C3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 3
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.strainRemoved, 2);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 1);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").tileId, "core_amaryllis_bloom_upgraded");
  assert.equal(nextState.players[0].actionsRemaining, 0);
});

test("Strain-removal activation rejects non-adjacent targets", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
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
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 1
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-003"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /not adjacent/);
});

test("upgraded multi-target Strain removal can remove 1 Strain from two adjacent tiles", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
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
    tileId: "core_gravel_path_basic",
    coordinate: "C4",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 2
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 1
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileIds: ["tile-001", "tile-003"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.strainRemoved, 2);
  assert.equal(result.targetPlacedTiles.length, 2);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 1);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-003").strain, 0);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").tileId, "core_the_steward_s_arms_upgraded");
  assert.match(result.message, /remove 2 Strain from Gravel Path and Gravel Path/);
});

test("multi-target Strain removal rejects more targets than the tile allows", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
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
    tileId: "core_gravel_path_basic",
    coordinate: "C4",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_common_land_basic",
    coordinate: "B3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-004",
    strain: 1
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileIds: ["tile-001", "tile-003", "tile-004"]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /at most 2 adjacent tiles/);
});

test("once-per-Season restricted Strain removal can target matching adjacent tile categories", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_hearth_garden");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_hearth_garden",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.strainRemoved, 1);
  assert.deepEqual(result.placedTile.activatedEffectSeasons, ["I"]);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 0);
  assert.deepEqual(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").activatedEffectSeasons, ["I"]);
  assert.match(result.message, /remove 1 Strain from Cottage/);
});

test("once-per-Season activations cannot be reused in the same Season", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_hearth_garden");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_hearth_garden",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  const actionsBeforeRetry = state.players[0].actionsRemaining;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.equal(nextState.players[0].actionsRemaining, actionsBeforeRetry);
  assert.match(result.errors.join(" "), /already used its activated effect in Season I/);
});

test("once-per-Season activations can be used again in a later Season", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_hearth_garden");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_hearth_garden",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  }).state;
  state = {
    ...state,
    round: 6,
    season: "II",
    players: state.players.map((player) => ({ ...player, actionsRemaining: 4 }))
  };
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.placedTile.activatedEffectSeasons, ["I", "II"]);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 0);
});

test("restricted Strain removal rejects adjacent tiles outside its listed categories", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_hearth_garden");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_hearth_garden",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 1
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-003"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /not a Housing, Social or Wellbeing Tile/);
});

test("activates a basic Arrival timer tile to add one timer token", () => {
  let state = withActiveArrival(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, {
    timerTokens: 1
  });
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_inn_basic",
    coordinate: "C3"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetActiveEncounterId: "arrival-active"
  });

  assert.equal(result.ok, true);
  assert.equal(result.timerTokensAdded, 1);
  assert.equal(nextState.encounter.active[0].timerTokens, 2);
  assert.equal(nextState.players[0].actionsRemaining, 1);
  assert.match(result.message, /add 1 timer token/);
});

test("upgraded Arrival timer activation adds up to the timer cap", () => {
  let state = withActiveArrival(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, {
    timerTokens: 2
  });
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
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetActiveEncounterId: "arrival-active"
  });

  assert.equal(result.ok, true);
  assert.equal(result.timerTokensAdded, 1);
  assert.equal(nextState.encounter.active[0].timerTokens, 3);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").tileId, "core_the_seldes_upgraded");
  assert.equal(nextState.players[0].actionsRemaining, 0);
});

test("Arrival timer activation rejects Arrivals already at the timer cap", () => {
  let state = withActiveArrival(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, {
    timerTokens: 3
  });
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_inn_basic",
    coordinate: "C3"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetActiveEncounterId: "arrival-active"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /maximum timer tokens/);
});

test("activates a basic fixed resource exchange into Goods", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_workshops_basic",
    coordinate: "C3"
  }).state;
  state = withWarehouseResources(state, {
    Food: 2,
    Wood: 2,
    Goods: 0
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    payment: [
      { resource: "Food", amount: 2 },
      { resource: "Wood", amount: 2 }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.exchangeCost, [
    { resource: "Food", amount: 2 },
    { resource: "Wood", amount: 2 }
  ]);
  assert.deepEqual(result.exchangeGain, { amount: 1, resource: "Goods" });
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Goods, 1);
  assert.equal(nextState.players[0].actionsRemaining, 1);
});

test("upgraded fixed resource exchange needs only three resources", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_workshops_basic",
    coordinate: "C3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }).state;
  state = withWarehouseResources(state, {
    Food: 1,
    Wood: 1,
    Stone: 1,
    Goods: 0
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Wood", amount: 1 },
      { resource: "Stone", amount: 1 }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.exchangeGain, { amount: 1, resource: "Goods" });
  assert.equal(nextState.warehouse.resources.Goods, 1);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").tileId, "core_the_makers_conclave_upgraded");
  assert.equal(nextState.players[0].actionsRemaining, 0);
});

test("fixed resource exchange requires the exact listed payment amount", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_workshops_basic",
    coordinate: "C3"
  }).state;
  state = withWarehouseResources(state, {
    Food: 3,
    Goods: 0
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    payment: [{ resource: "Food", amount: 3 }]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /exactly 4 resources/);
});

test("fixed resource exchange rejects a full target resource after payment", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_workshops_basic",
    coordinate: "C3"
  }).state;
  state = withWarehouseResources(state, {
    Food: 4,
    Goods: 15
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    payment: [{ resource: "Food", amount: 4 }]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Goods is at the Warehouse cap/);
});

test("activates a flexible resource exchange into non-Goods resources", () => {
  let state = unlockSpecial(newState(), "special_alchemist_s_workshop");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_alchemist_s_workshop",
    coordinate: "F4"
  }).state;
  state = withWarehouseResources(state, {
    Food: 2,
    Goods: 1,
    Stone: 1
  });
  const actionsBeforeActivate = state.players[0].actionsRemaining;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Goods", amount: 1 },
      { resource: "Stone", amount: 1 }
    ],
    gains: [
      { resource: "Wood", amount: 2 },
      { resource: "Herbs", amount: 1 }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.exchangeCost, [
    { resource: "Food", amount: 1 },
    { resource: "Goods", amount: 1 },
    { resource: "Stone", amount: 1 }
  ]);
  assert.deepEqual(result.exchangeGains, [
    { resource: "Wood", amount: 2 },
    { resource: "Herbs", amount: 1 }
  ]);
  assert.equal(nextState.warehouse.resources.Food, 1);
  assert.equal(nextState.warehouse.resources.Goods, 0);
  assert.equal(nextState.warehouse.resources.Stone, 0);
  assert.equal(nextState.warehouse.resources.Wood, 2);
  assert.equal(nextState.warehouse.resources.Herbs, 1);
  assert.equal(nextState.players[0].actionsRemaining, actionsBeforeActivate - 1);
});

test("flexible resource exchange rejects Goods as a gain resource", () => {
  let state = unlockSpecial(newState(), "special_alchemist_s_workshop");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_alchemist_s_workshop",
    coordinate: "F4"
  }).state;
  state = withWarehouseResources(state, {
    Food: 1
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001",
    payment: [{ resource: "Food", amount: 1 }],
    gains: [{ resource: "Goods", amount: 1 }]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Goods is not a valid exchange gain resource/);
});

test("flexible resource exchange rejects exchanges above its maximum", () => {
  let state = unlockSpecial(newState(), "special_alchemist_s_workshop");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_alchemist_s_workshop",
    coordinate: "F4"
  }).state;
  state = withWarehouseResources(state, {
    Food: 6
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001",
    payment: [{ resource: "Food", amount: 6 }],
    gains: [{ resource: "Wood", amount: 6 }]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Choose 1-5 resources/);
});

test("flexible resource exchange requires matching payment and gain counts", () => {
  let state = unlockSpecial(newState(), "special_alchemist_s_workshop");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_alchemist_s_workshop",
    coordinate: "F4"
  }).state;
  state = withWarehouseResources(state, {
    Food: 2
  });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-001",
    payment: [{ resource: "Food", amount: 2 }],
    gains: [{ resource: "Wood", amount: 1 }]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /same number of resources/);
});

test("activates a once-per-Season Special tile to resolve an active Burden", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_adventurers_guild");
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
    tileId: "special_adventurers_guild",
    coordinate: "D3"
  }).state;
  state = withWarehouseResources(withActiveBurden(state), {});
  const burdenCardId = state.encounter.active[0].cardId;
  const actionsBeforeActivate = state.players[0].actionsRemaining;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-003",
    targetActiveEncounterId: "burden-active"
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedBurden.id, "burden-active");
  assert.equal(result.resolvedBurden.resolved, true);
  assert.equal(result.resolvedBurden.resolvedByTileId, "tile-003");
  assert.deepEqual(result.placedTile.activatedEffectSeasons, ["I"]);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, [burdenCardId]);
  assert.equal(nextState.encounter.completed[0].id, "burden-active");
  assert.equal(nextState.players[0].actionsRemaining, actionsBeforeActivate - 1);
  assert.deepEqual(nextState.warehouse.resources, Object.fromEntries(nextState.rules.resources.map((resource) => [resource, 0])));
  assert.match(result.message, /resolve/);
});

test("Burden resolution activation also triggers Resting Hall Strain removal", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = unlockSpecial(unlockSpecial(state, "special_the_resting_hall"), "special_adventurers_guild");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_the_resting_hall",
    coordinate: "A4"
  }).state;
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
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_adventurers_guild",
    coordinate: "D3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 2
  }).state;
  state = withActiveBurden(state);
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-005",
    targetActiveEncounterId: "burden-active"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 1);
  assert.equal(result.burdenResolutionStrainRelief.providerPlacedTileId, "tile-002");
  assert.equal(result.burdenResolutionStrainRelief.targetPlacedTileId, "tile-001");
});

test("once-per-Season Burden resolution activations cannot be reused in the same Season", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_adventurers_guild");
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
    tileId: "special_adventurers_guild",
    coordinate: "D3"
  }).state;
  state = withActiveBurden(state);
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-003",
    targetActiveEncounterId: "burden-active"
  }).state;
  state = withActiveBurden(state, { id: "second-burden" });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-003",
    targetActiveEncounterId: "second-burden"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /already used its activated effect in Season I/);
});

test("once-per-Season Burden resolution activations can be used again in a later Season", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_adventurers_guild");
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
    tileId: "special_adventurers_guild",
    coordinate: "D3"
  }).state;
  state = withActiveBurden(state);
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-003",
    targetActiveEncounterId: "burden-active"
  }).state;
  state = {
    ...state,
    round: 6,
    season: "II",
    players: state.players.map((player) => ({ ...player, actionsRemaining: 4 }))
  };
  state = withActiveBurden(state, { id: "season-two-burden" });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-003",
    targetActiveEncounterId: "season-two-burden"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.placedTile.activatedEffectSeasons, ["I", "II"]);
  assert.deepEqual(nextState.encounter.active, []);
  assert.equal(nextState.encounter.completed.at(-1).id, "season-two-burden");
});

test("Burden resolution activation requires an unresolved active Burden target", () => {
  let state = unlockSpecial(dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state, "special_adventurers_guild");
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
    tileId: "special_adventurers_guild",
    coordinate: "D3"
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-003"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Choose an active Burden/);
});

test("activates The Waystation to inspect and reorder the top Encounter Deck cards", () => {
  let state = unlockSpecial(newState(), "special_the_waystation");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_the_waystation",
    coordinate: "C3"
  }).state;
  const beforeDeck = [...state.encounter.deck];
  const peekedCardIds = beforeDeck.slice(0, 3);
  const orderedEncounterCardIds = [peekedCardIds[2], peekedCardIds[0], peekedCardIds[1]];
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    orderedEncounterCardIds
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.peekedCardIds, peekedCardIds);
  assert.deepEqual(result.orderedCardIds, orderedEncounterCardIds);
  assert.deepEqual(nextState.encounter.deck.slice(0, 3), orderedEncounterCardIds);
  assert.deepEqual(nextState.encounter.deck.slice(3), beforeDeck.slice(3));
  assert.equal(nextState.players[0].actionsRemaining, 1);
  assert.equal(nextState.log.at(-1).data.peekedCardIds.length, 3);
});

test("The Waystation rejects a return order that does not match the peeked cards", () => {
  let state = unlockSpecial(newState(), "special_the_waystation");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_the_waystation",
    coordinate: "C3"
  }).state;
  const beforeDeck = [...state.encounter.deck];
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    orderedEncounterCardIds: [beforeDeck[0], beforeDeck[1], beforeDeck[3]]
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /same Encounter cards/);
});
