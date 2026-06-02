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

function newState(options = {}) {
  return createInitialGameState({
    playerCount: 1,
    seed: "steward-openings",
    encounterCards,
    tiles,
    mapHexes,
    enforceOpeningResourcePlacement: true,
    ...options
  });
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

function advanceToOpeningTurn(state) {
  state = dispatch(state, { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }).state;
  assert.equal(state.phase, GAME_PHASES.PLAYER_TURNS);
  return state;
}

function firstTerrainCoordinate(state, terrain) {
  return state.map.hexes.find((hex) => hex.Terrain === terrain)?.Coordinate;
}

test("setup assigns Steward roles and unlocks the selected Steward House", () => {
  const state = newState({ stewardRoles: ["sentinel"] });
  const sentinelHouse = state.tileSupply.core.find((entry) => entry.tileId === "core_sentinel_house_basic");
  const vanguardHouse = state.tileSupply.core.find((entry) => entry.tileId === "core_vanguard_house_basic");

  assert.equal(state.players[0].stewardRoleId, "sentinel");
  assert.equal(state.players[0].stewardRoleName, "Sentinel");
  assert.equal(sentinelHouse.locked, false);
  assert.equal(sentinelHouse.available, 1);
  assert.equal(vanguardHouse.locked, true);
  assert.equal(vanguardHouse.available, 0);
});

test("Round 1 opening turn blocks non-opening actions until the Steward resource is placed", () => {
  let state = advanceToOpeningTurn(newState({ stewardRoles: ["vanguard"] }));
  const mountain = firstTerrainCoordinate(state, "Mountains");
  const woodland = firstTerrainCoordinate(state, "Woodland");

  const blockedTurn = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });
  assert.equal(blockedTurn.result.ok, false);
  assert.match(blockedTurn.result.errors.join(" "), /Vanguard opening move/);

  const blockedPlacement = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_mine_basic",
    coordinate: mountain
  });
  assert.equal(blockedPlacement.result.ok, false);
  assert.match(blockedPlacement.result.errors.join(" "), /Place Forest on Woodland/);

  const placed = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: woodland
  });
  assert.equal(placed.result.ok, true);
  assert.equal(placed.state.players[0].openingResourcePlacement.completed, true);
  assert.equal(placed.state.players[0].lastInteraction.placedTileId, placed.result.placedTile.id);

  const ended = dispatch(placed.state, { type: TILE_ACTION_TYPES.END_TURN });
  assert.equal(ended.result.ok, true);
});

test("Quartermaster opening can use any basic Resource tile on its matching terrain", () => {
  const state = advanceToOpeningTurn(newState({ stewardRoles: ["quartermaster"] }));
  const arable = firstTerrainCoordinate(state, "Arable Land");
  const placed = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: arable
  });

  assert.equal(placed.result.ok, true);
  assert.equal(placed.state.players[0].openingResourcePlacement.completed, true);
  assert.equal(placed.state.players[0].openingResourcePlacement.tileId, "core_farm_basic");
});
