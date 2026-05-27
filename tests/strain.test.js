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
    seed: "strain",
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

function placePath(state = newState()) {
  return dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
}

function getFirstPlacedTile(state) {
  return state.map.placedTiles[0];
}

test("Supported prevents the first Strain placed on a tile each round", () => {
  let state = placePath();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
    placedTileId: "tile-001",
    supported: true
  }).state;
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });
  const placedTile = getFirstPlacedTile(nextState);

  assert.equal(result.ok, true);
  assert.equal(result.strainPrevented, 1);
  assert.equal(result.strainAdded, 0);
  assert.equal(placedTile.strain, 0);
  assert.equal(placedTile.supportedUsedThisRound, true);
});

test("Supported only prevents one Strain in the same round", () => {
  let state = placePath();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
    placedTileId: "tile-001",
    supported: true
  }).state;
  const first = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001",
    amount: 2
  });
  const second = dispatch(first.state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });

  assert.equal(first.result.strainPrevented, 1);
  assert.equal(first.result.strainAdded, 1);
  assert.equal(getFirstPlacedTile(first.state).strain, 1);
  assert.equal(second.result.strainPrevented, 0);
  assert.equal(second.result.strainAdded, 1);
  assert.equal(getFirstPlacedTile(second.state).strain, 2);
});

test("Overstrained tiles cannot receive more Strain", () => {
  let state = placePath();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001",
    amount: 3
  }).state;
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  });

  assert.equal(getFirstPlacedTile(state).strain, 3);
  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Overstrained/);
});

test("end of round resets the Supported use flag", () => {
  let state = placePath();
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
    placedTileId: "tile-001",
    supported: true
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: "tile-001"
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.END_ROUND,
    activePlayerId: null
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });
  const placedTile = getFirstPlacedTile(nextState);

  assert.equal(result.ok, true);
  assert.equal(placedTile.supported, true);
  assert.equal(placedTile.supportedUsedThisRound, false);
  assert.equal(nextState.phase, GAME_PHASES.SEED_ENCOUNTERS);
});
