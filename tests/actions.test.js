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
    seed: "actions",
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

function actionsRemaining(state) {
  return state.players.find((player) => player.id === state.activePlayerId).actionsRemaining;
}

test("connected tile placement spends 1 player Action", () => {
  const { state, result } = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(actionsRemaining(state), 3);
});

test("placement adjacent to an existing Travel Network spends only the Place action", () => {
  let state = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C3",
    orientation: "rotation-0"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 0);
  assert.equal(actionsRemaining(result.state), 2);
});

test("disconnected placement spends one Travel action plus one Place action", () => {
  let state = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A10",
    orientation: "rotation-0"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 2);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(actionsRemaining(result.state), 1);
});

test("activating a disconnected tile spends one Travel action plus one Activate action", () => {
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
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 2);
  assert.equal(result.result.actionCost.activationActionCost, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(actionsRemaining(result.state), 2);
  assert.equal(result.state.warehouse.resources.Wood, 1);
});

test("placement fails without enough remaining Actions and does not mutate state", () => {
  let state = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A10",
    orientation: "rotation-0"
  }).state;
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "D10",
    orientation: "rotation-0"
  });

  assert.equal(actionsRemaining(state), 1);
  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /needs 2 Actions/);
});

test("debug reset restores player Actions for local testing", () => {
  const afterPlacement = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  const { state, result } = dispatch(afterPlacement, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS });

  assert.equal(result.ok, true);
  assert.equal(actionsRemaining(state), 4);
});
