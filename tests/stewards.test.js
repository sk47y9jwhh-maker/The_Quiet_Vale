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

function newState(playerCount = 1) {
  const state = createInitialGameState({
    playerCount,
    seed: "stewards",
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

function withWarehouseResources(state, resources) {
  return {
    ...state,
    warehouse: {
      ...state.warehouse,
      resources: Object.fromEntries(state.rules.resources.map((resource) => [resource, resources[resource] ?? 0]))
    }
  };
}

function withPlayerActions(state, actionsRemaining) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === state.activePlayerId
        ? {
            ...player,
            actionsRemaining
          }
        : player
    )
  };
}

function withPlacedTiles(state, placedTiles) {
  return {
    ...state,
    map: {
      ...state.map,
      placedTiles
    }
  };
}

function withStewardMarker(state, placedTileId, coordinate = "C1") {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === state.activePlayerId
        ? {
            ...player,
            lastInteraction: { type: "debug", placedTileId, coordinate, round: state.round, season: state.season }
          }
        : player
    )
  };
}

test("debug marker control can set and clear the player's Steward marker", () => {
  const state = withPlacedTiles(newState(2), [
    {
      id: "tile-001",
      tileId: "core_forest_basic",
      coordinate: "A13",
      coordinates: ["A13"],
      orientation: "rotation-0",
      strain: 0
    }
  ]);

  const marked = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
    playerId: "P2",
    placedTileId: "tile-001"
  });

  assert.equal(marked.result.ok, true);
  assert.deepEqual(marked.state.players[1].lastInteraction, {
    type: "debug",
    placedTileId: "tile-001",
    coordinate: "A13",
    round: 1,
    season: "I"
  });

  const cleared = dispatch(marked.state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
    playerId: "P2",
    placedTileId: ""
  });

  assert.equal(cleared.result.ok, true);
  assert.equal(cleared.state.players[1].lastInteraction, null);
});

test("Vanguard Home can make an eligible placement cost 0 Actions once per Season", () => {
  const state = withPlayerActions(
    withPlacedTiles(newState(), [
      {
        id: "tile-001",
        tileId: "core_vanguard_home_upgraded",
        coordinate: "B1",
        coordinates: ["B1"],
        orientation: "rotation-0",
        strain: 0
      }
    ]),
    0
  );

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0",
    stewardPowerPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.stewardPower.type, "free_placement_action");
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.equal(nextState.map.placedTiles.at(-1).tileId, "core_gravel_path_basic");
});

test("Vanguard Home does not waive the disconnected Travel action", () => {
  const state = withPlayerActions(
    withPlacedTiles(newState(), [
      {
        id: "tile-001",
        tileId: "core_vanguard_home_upgraded",
        coordinate: "B1",
        coordinates: ["B1"],
        orientation: "rotation-0",
        strain: 0
      },
      {
        id: "tile-002",
        tileId: "core_gravel_path_basic",
        coordinate: "C1",
        coordinates: ["C1", "C2"],
        orientation: "rotation-0",
        strain: 0
      }
    ]),
    1
  );

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13",
    stewardPowerPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(result.actionCost.placeActionCost, 0);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);
});

test("Ranger Home ignores the disconnected Travel action for a placement", () => {
  const state = withPlayerActions(
    withPlacedTiles(newState(), [
      {
        id: "tile-001",
        tileId: "core_ranger_home_upgraded",
        coordinate: "B1",
        coordinates: ["B1"],
        orientation: "rotation-0",
        strain: 0
      },
      {
        id: "tile-002",
        tileId: "core_gravel_path_basic",
        coordinate: "C1",
        coordinates: ["C1", "C2"],
        orientation: "rotation-0",
        strain: 0
      }
    ]),
    1
  );

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13",
    stewardPowerPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 0);
  assert.equal(result.stewardPower.type, "ignore_disconnected_travel_action");
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);
});

test("Sentinel Home can make a Core upgrade cost 0 Actions once per Season", () => {
  const state = withPlayerActions(
    withWarehouseResources(
      withPlacedTiles(newState(), [
        {
          id: "tile-001",
          tileId: "core_sentinel_home_upgraded",
          coordinate: "B1",
          coordinates: ["B1"],
          orientation: "rotation-0",
          strain: 0
        },
        {
          id: "tile-002",
          tileId: "core_gravel_path_basic",
          coordinate: "A3",
          coordinates: ["A3", "A4"],
          orientation: "rotation-0",
          strain: 0
        }
      ]),
      { Stone: 4 }
    ),
    0
  );

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-002",
    stewardPowerPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.stewardPower.type, "free_core_upgrade_action");
  assert.equal(nextState.map.placedTiles[1].tileId, "core_paved_path_upgraded");
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);
  assert.equal(nextState.players[0].actionsRemaining, 0);
});

test("Sentinel Home does not waive the disconnected Travel action for an upgrade", () => {
  const state = withPlayerActions(
    withStewardMarker(
      withPlacedTiles(newState(), [
        {
          id: "tile-001",
          tileId: "core_sentinel_home_upgraded",
          coordinate: "B1",
          coordinates: ["B1"],
          orientation: "rotation-0",
          strain: 0
        },
        {
          id: "tile-002",
          tileId: "core_gravel_path_basic",
          coordinate: "C1",
          coordinates: ["C1", "C2"],
          orientation: "rotation-0",
          strain: 0
        },
        {
          id: "tile-003",
          tileId: "core_forest_basic",
          coordinate: "A13",
          coordinates: ["A13"],
          orientation: "rotation-0",
          strain: 0
        }
      ]),
      "tile-002"
    ),
    1
  );

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-003",
    stewardPowerPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(result.actionCost.upgradeActionCost, 0);
  assert.equal(result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.equal(nextState.map.placedTiles[2].tileId, "core_managed_woodlands_upgraded");
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);
});

test("Warden Home can resolve an active Burden without spending an Action", () => {
  const base = withPlayerActions(
    withWarehouseResources(
      withPlacedTiles(newState(), [
        {
          id: "tile-001",
          tileId: "core_warden_home_upgraded",
          coordinate: "B1",
          coordinates: ["B1"],
          orientation: "rotation-0",
          strain: 0
        }
      ]),
      { Goods: 2 }
    ),
    0
  );
  const state = {
    ...base,
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "active-001",
          cardId: "burden_the_burden_of_command",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          round: 1,
          season: "I",
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "active-001",
    stewardPowerPlacedTileId: "tile-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 0);
  assert.equal(result.stewardPower.type, "free_burden_resolution_action");
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);
  assert.deepEqual(nextState.encounter.discard, ["burden_the_burden_of_command"]);
});

test("Quartermaster Home exchanges Warehouse resources once per Season", () => {
  const state = withWarehouseResources(
    withPlacedTiles(newState(), [
      {
        id: "tile-001",
        tileId: "core_quartermaster_home_upgraded",
        coordinate: "B1",
        coordinates: ["B1"],
        orientation: "rotation-0",
        strain: 0
      }
    ]),
    { Food: 2 }
  );

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
    placedTileId: "tile-001",
    payment: [{ resource: "Food", amount: 1 }],
    gains: [{ resource: "Metal", amount: 1 }]
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Food, 1);
  assert.equal(nextState.warehouse.resources.Metal, 1);
  assert.deepEqual(nextState.map.placedTiles[0].stewardPowerSeasons, ["I"]);

  const repeat = dispatch(nextState, {
    type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
    placedTileId: "tile-001",
    payment: [{ resource: "Food", amount: 1 }],
    gains: [{ resource: "Metal", amount: 1 }]
  });

  assert.equal(repeat.result.ok, false);
  assert.match(repeat.result.errors.join(" "), /Steward Power is not available/);
});
