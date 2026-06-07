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

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

test("prototype smoke flow seeds, reveals, places disconnected, upgrades at steward marker, and ends the round", () => {
  let state = createInitialGameState({
    playerCount: 1,
    seed: "prototype-smoke",
    encounterCards,
    tiles,
    mapHexes
  });

  let result;
  ({ state, result } = dispatch(state, { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS }));
  assert.equal(result.ok, true);
  assert.equal(state.phase, GAME_PHASES.REVEAL_ENCOUNTERS);

  ({ state, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }));
  assert.equal(result.ok, true);
  assert.equal(state.phase, GAME_PHASES.PLAYER_TURNS);
  assert.equal(state.activePlayerId, "P1");

  ({ state, result } = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }));
  assert.equal(result.ok, true);

  ({ state, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }));
  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(state.players[0].actionsRemaining, 3);

  ({ state, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }));
  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 2);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(state.players[0].lastInteraction.placedTileId, "tile-002");
  assert.equal(state.players[0].actionsRemaining, 1);

  ({ state, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002"
  }));
  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 0);
  assert.equal(state.map.placedTiles.find((tile) => tile.id === "tile-002").tileId, "core_managed_woodlands_upgraded");
  assert.equal(state.players[0].actionsRemaining, 0);

  ({ state, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }));
  assert.equal(result.ok, true);
  assert.equal(state.phase, GAME_PHASES.END_ROUND);

  ({ state, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND }));
  assert.equal(result.ok, true);
  assert.equal(state.phase, GAME_PHASES.REVEAL_ENCOUNTERS);
  assert.equal(state.round, 2);
});
