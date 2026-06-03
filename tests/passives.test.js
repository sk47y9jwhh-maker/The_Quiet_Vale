import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { getEffectiveSupportDetails } from "../src/game/passives.js";
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
    seed: "passives",
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

test("self-Supported passive prevents the first Strain on an upgraded Travel tile", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A3",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-001"
  }).state;

  const support = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });

  assert.equal(support.supported, true);
  assert.equal(support.providers[0].providerTileName, "Paved Path");
  assert.equal(result.ok, true);
  assert.equal(result.strainPrevented, 1);
  assert.equal(result.strainAdded, 0);
  assert.equal(nextState.map.placedTiles[0].strain, 0);
  assert.equal(nextState.map.placedTiles[0].supportedUsedThisRound, true);
});

test("adjacent passive Supported prevents Strain on neighboring tiles", () => {
  let state = unlockSpecial(newState(), "special_theater");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_theater",
    coordinate: "A12"
  }).state;

  const support = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });

  assert.equal(support.supported, true);
  assert.equal(support.providers[0].providerTileName, "Theatre");
  assert.equal(result.strainPrevented, 1);
  assert.equal(result.strainAdded, 0);
  assert.equal(nextState.map.placedTiles[0].strain, 0);
});

test("Overstrained passive providers stop granting Supported", () => {
  let state = unlockSpecial(newState(), "special_theater");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_theater",
    coordinate: "A12"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;

  const support = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });

  assert.equal(support.supported, false);
  assert.equal(result.strainPrevented, 0);
  assert.equal(result.strainAdded, 1);
  assert.equal(nextState.map.placedTiles[0].strain, 1);
});

test("Common Land grants Supported to only one adjacent Housing tile", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_common_land_basic",
    coordinate: "A4"
  }).state;

  const firstSupport = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const secondSupport = getEffectiveSupportDetails(state, "tile-002", { tiles });
  const firstStrain = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });
  const secondStrain = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-002"
  });

  assert.equal(firstSupport.supported, true);
  assert.equal(firstSupport.providers[0].providerTileName, "Common Land");
  assert.equal(firstSupport.providers[0].reason, "adjacent_category_limited");
  assert.equal(secondSupport.supported, false);
  assert.equal(firstStrain.result.strainPrevented, 1);
  assert.equal(firstStrain.result.strainAdded, 0);
  assert.equal(secondStrain.result.strainPrevented, 0);
  assert.equal(secondStrain.result.strainAdded, 1);
});

test("The Pleasence grants Supported to multiple adjacent Housing tiles", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_common_land_basic",
    coordinate: "A4"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-003"
  }).state;

  const firstSupport = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const secondSupport = getEffectiveSupportDetails(state, "tile-002", { tiles });

  assert.equal(firstSupport.supported, true);
  assert.equal(secondSupport.supported, true);
  assert.equal(firstSupport.providers[0].providerTileName, "The Pleasence");
  assert.equal(secondSupport.providers[0].providerTileName, "The Pleasence");
});

test("limited adjacent Housing support does not support adjacent Resource tiles", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_common_land_basic",
    coordinate: "A4"
  }).state;

  const support = getEffectiveSupportDetails(state, "tile-001", { tiles });

  assert.equal(support.supported, false);
});
