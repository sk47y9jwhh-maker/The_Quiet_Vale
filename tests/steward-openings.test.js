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
    setupStewardHousePlacement: true,
    enforceOpeningResourcePlacement: false,
    ...options
  });
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

function advanceToPlayerTurns(state) {
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
  assert.equal(state.phase, GAME_PHASES.PLACE_STEWARD_HOUSES);
  assert.equal(state.activePlayerId, "P1");
});

test("setup places the active Steward House for free on the associated terrain", () => {
  const state = newState({ stewardRoles: ["vanguard"] });
  const mountain = firstTerrainCoordinate(state, "Mountains");
  const woodland = firstTerrainCoordinate(state, "Woodland");
  const beforeWood = state.warehouse.resources.Wood;

  const wrongTerrain = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_vanguard_house_basic",
    coordinate: mountain
  });
  assert.equal(wrongTerrain.result.ok, false);
  assert.match(wrongTerrain.result.errors.join(" "), /Woodland/);

  const placed = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_vanguard_house_basic",
    coordinate: woodland
  });
  assert.equal(placed.result.ok, true);
  assert.equal(placed.result.actionCost.total, 0);
  assert.deepEqual(placed.result.cost, []);
  assert.equal(placed.state.players[0].actionsRemaining, 4);
  assert.equal(placed.state.warehouse.resources.Wood, beforeWood);
  assert.equal(placed.state.players[0].stewardHousePlacement.completed, true);
  assert.equal(placed.state.players[0].lastInteraction.placedTileId, placed.result.placedTile.id);
  assert.equal(placed.state.phase, GAME_PHASES.SEED_ENCOUNTERS);
  assert.equal(placed.state.activePlayerId, null);
  assert.equal(
    placed.state.tileSupply.core.find((entry) => entry.tileId === "core_vanguard_house_basic").available,
    0
  );
});

test("Quartermaster setup House can use any Steward terrain but not Grasslands", () => {
  const state = newState({ stewardRoles: ["quartermaster"] });
  const grasslands = firstTerrainCoordinate(state, "Grasslands");
  const ruins = firstTerrainCoordinate(state, "Ruins");
  const rejected = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_quartermaster_house_basic",
    coordinate: grasslands
  });
  assert.equal(rejected.result.ok, false);
  assert.match(rejected.result.errors.join(" "), /Woodland or Mountains or Heaths or Arable Land or Ruins/);

  const placed = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_quartermaster_house_basic",
    coordinate: ruins
  });

  assert.equal(placed.result.ok, true);
  assert.equal(placed.state.players[0].stewardHousePlacement.completed, true);
  assert.equal(placed.state.players[0].stewardHousePlacement.tileId, "core_quartermaster_house_basic");
});

test("multiple players place Steward Houses before Encounter seeding", () => {
  let state = newState({
    playerCount: 2,
    stewardRoles: ["vanguard", "sentinel"]
  });
  const woodland = firstTerrainCoordinate(state, "Woodland");
  const mountains = firstTerrainCoordinate(state, "Mountains");

  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_vanguard_house_basic",
    coordinate: woodland
  }).state;
  assert.equal(state.activePlayerId, "P2");
  assert.equal(state.phase, GAME_PHASES.PLACE_STEWARD_HOUSES);

  const placed = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_sentinel_house_basic",
    coordinate: mountains
  });

  assert.equal(placed.result.ok, true);
  assert.equal(placed.result.actionCost.total, 0);
  assert.equal(placed.state.players[1].actionsRemaining, 4);
  assert.equal(placed.state.players[1].stewardHousePlacement.completed, true);
  assert.equal(placed.state.phase, GAME_PHASES.SEED_ENCOUNTERS);
  assert.equal(placed.state.map.placedTiles.length, 2);
});

test("Round 1 no longer forces a Resource opening move after Steward Houses are placed", () => {
  let state = newState({ stewardRoles: ["vanguard"] });
  const woodland = firstTerrainCoordinate(state, "Woodland");

  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
    tileId: "core_vanguard_house_basic",
    coordinate: woodland
  }).state;
  state = advanceToPlayerTurns(state);

  const ended = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });
  assert.equal(ended.result.ok, true);
});
