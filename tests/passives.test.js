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

test("Theatre gives Supported to one adjacent tile when activated", () => {
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

  const passiveSupport = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const { state: supportedState, result: activationResult } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });
  const support = getEffectiveSupportDetails(supportedState, "tile-001", { tiles });
  const { state: nextState, result } = dispatch(supportedState, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });

  assert.equal(passiveSupport.supported, false);
  assert.equal(activationResult.ok, true);
  assert.equal(support.supported, true);
  assert.equal(support.providers[0].providerTileName, "Debug Support");
  assert.equal(result.strainPrevented, 1);
  assert.equal(result.strainAdded, 0);
  assert.equal(nextState.map.placedTiles[0].strain, 0);
});

test("Overstrained support providers cannot activate", () => {
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
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(support.supported, false);
  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Overstrained tiles cannot be activated/);
});

test("Common Land activates to give Supported to one adjacent Housing tile", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_common_land_basic",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A5"
  }).state;

  const { state: supportedState, result: activationResult } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });
  const firstSupport = getEffectiveSupportDetails(supportedState, "tile-001", { tiles });
  const secondSupport = getEffectiveSupportDetails(supportedState, "tile-003", { tiles });
  const firstStrain = dispatch(supportedState, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });
  const secondStrain = dispatch(supportedState, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-003"
  });

  assert.equal(activationResult.ok, true);
  assert.equal(firstSupport.supported, true);
  assert.equal(firstSupport.providers[0].providerTileName, "Debug Support");
  assert.equal(secondSupport.supported, false);
  assert.equal(firstStrain.result.strainPrevented, 1);
  assert.equal(firstStrain.result.strainAdded, 0);
  assert.equal(secondStrain.result.strainPrevented, 0);
  assert.equal(secondStrain.result.strainAdded, 1);
});

test("The Pleasence activates to give Supported to two adjacent Housing tiles", () => {
  let state = dispatch(newState(), { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_common_land_basic",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileIds: ["tile-001", "tile-003"]
  }).state;

  const firstSupport = getEffectiveSupportDetails(state, "tile-001", { tiles });
  const secondSupport = getEffectiveSupportDetails(state, "tile-003", { tiles });

  assert.equal(firstSupport.supported, true);
  assert.equal(secondSupport.supported, true);
  assert.equal(firstSupport.providers[0].providerTileName, "Debug Support");
  assert.equal(secondSupport.providers[0].providerTileName, "Debug Support");
});

test("Common Land cannot give Supported to adjacent Resource tiles", () => {
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
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002",
    targetPlacedTileId: "tile-001"
  });

  assert.equal(support.supported, false);
  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /not a Housing Tile/);
});
