import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { GAME_PHASES, createInitialGameState } from "../src/game/setup.js";
import { TILE_ACTION_TYPES, validatePlaceTile } from "../src/game/tiles.js";
import { buildTravelNetworks, getRiverCrossingActionCost } from "../src/game/travel.js";

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
    seed: "travel",
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

function place(state, tileId, coordinate, orientation = "rotation-0") {
  return dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId,
    coordinate,
    orientation
  }).state;
}

function fillWarehouse(state) {
  return dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
}

function unlockSpecial(state, tileId, stock = 1) {
  return {
    ...state,
    tileSupply: {
      ...state.tileSupply,
      special: state.tileSupply.special.map((entry) =>
        entry.tileId === tileId
          ? {
              ...entry,
              stock,
              available: stock,
              locked: false
            }
          : entry
      )
    }
  };
}

test("a multihex Travel tile forms one connected settlement network across its full footprint", () => {
  const state = place(newState(), "core_gravel_track_basic", "C1", "rotation-0");
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001"]);
  assert.deepEqual(networks[0].coordinates, ["C1", "C2", "D3"]);
});

test("a multihex tile connects placements from any hex in its footprint", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_gravel_track_basic", "C1", "rotation-0");
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_inn_basic",
    coordinate: "D4"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 0);
});

test("adjacent non-Travel tiles extend the connected settlement network", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_gravel_path_basic", "C1", "rotation-0");
  state = place(state, "core_cottage_basic", "C3");
  const networks = buildTravelNetworks(state, { tiles });
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "C4"
  });

  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001", "tile-002"]);
  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 0);
});

test("Overstrained non-Travel tiles break connected settlement reachability", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_gravel_path_basic", "C1", "rotation-0");
  state = place(state, "core_cottage_basic", "C3");
  state = place(state, "core_cottage_basic", "C4");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
    playerId: "P1",
    placedTileId: "tile-001"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  const networks = buildTravelNetworks(state, { tiles });
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: "tile-003"
  });

  assert.deepEqual(
    networks.map((network) => network.tileIds),
    [["tile-001"], ["tile-003"]]
  );
  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 2);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 1);
});

test("adjacent Travel tiles join the same connected settlement network", () => {
  let state = place(newState(), "core_gravel_path_basic", "C1", "rotation-0");
  state = place(state, "core_gravel_path_basic", "C3", "rotation-0");
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001", "tile-002"]);
});

test("Bridge connects settlement networks across the river", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_gravel_path_basic", "C5", "rotation-0");
  state = place(state, "core_gravel_path_basic", "C8", "rotation-0");

  assert.equal(buildTravelNetworks(state, { tiles }).length, 2);

  state = place(state, "core_bridge_basic", "C7");
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001", "tile-002", "tile-003"]);
});

test("Docks connect water-linked settlement networks to each other", () => {
  let state = unlockSpecial(newState(), "special_docks", 2);
  state = place(state, "special_docks", "C7");
  state = place(state, "special_docks", "F6");
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001", "tile-002"]);
  assert.deepEqual(networks[0].coordinates, ["C7", "F6"]);
});

test("Stables place as two single-hex tiles in one action and connect separated networks", () => {
  let state = unlockSpecial(fillWarehouse(newState()), "special_stables", 2);
  state = place(state, "core_common_land_basic", "C1");
  state = place(state, "core_common_land_basic", "I14");
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;

  assert.equal(buildTravelNetworks(state, { tiles }).length, 2);

  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_stables",
    coordinate: "C2",
    pairedCoordinate: "I13"
  });
  const networks = buildTravelNetworks(nextState, { tiles });
  const stablesSupply = nextState.tileSupply.special.find((entry) => entry.tileId === "special_stables");

  assert.equal(result.ok, true);
  assert.equal(result.actionCost.total, 1);
  assert.equal(nextState.players[0].actionsRemaining, 3);
  assert.deepEqual(
    nextState.map.placedTiles.map((tile) => tile.coordinate),
    ["C1", "I14", "C2", "I13"]
  );
  assert.equal(stablesSupply.available, 0);
  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001", "tile-002", "tile-003", "tile-004"]);
});

test("Stables cannot be placed as only one copy", () => {
  const state = unlockSpecial(fillWarehouse(newState()), "special_stables", 2);
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_stables",
    coordinate: "C2"
  });

  assert.equal(result.ok, false);
  assert.equal(nextState, state);
  assert.match(result.errors.join(" "), /Choose a second Stables site/);
});

test("Overstrained Stables stop connecting separated networks", () => {
  let state = unlockSpecial(fillWarehouse(newState()), "special_stables", 2);
  state = place(state, "core_common_land_basic", "C1");
  state = place(state, "core_common_land_basic", "I14");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_stables",
    coordinate: "C2",
    pairedCoordinate: "I13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-004",
    strain: 3
  }).state;
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 2);
  assert.deepEqual(
    networks.map((network) => network.tileIds),
    [["tile-001", "tile-003"], ["tile-002"]]
  );
});

test("Overstrained Docks do not connect to other Docks", () => {
  let state = unlockSpecial(newState(), "special_docks", 2);
  state = place(state, "special_docks", "C7");
  state = place(state, "special_docks", "F6");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 1);
  assert.deepEqual(networks[0].tileIds, ["tile-001"]);
});

test("Overstrained Bridge does not provide Travel connectivity", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_gravel_path_basic", "C5", "rotation-0");
  state = place(state, "core_gravel_path_basic", "C8", "rotation-0");
  state = place(state, "core_bridge_basic", "C7");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 3
  }).state;
  const networks = buildTravelNetworks(state, { tiles });

  assert.equal(networks.length, 2);
  assert.deepEqual(
    networks.map((network) => network.tileIds),
    [["tile-001"], ["tile-002"]]
  );
});

test("river crossing without an active Bridge costs 1 Action", () => {
  const state = newState();
  const crossing = getRiverCrossingActionCost(state, "C7", { tiles });

  assert.equal(crossing.valid, true);
  assert.equal(crossing.cost, 1);
  assert.equal(crossing.hasBridgeConnection, false);
});

test("active Bridge removes the river crossing action cost", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_bridge_basic", "C7");
  const crossing = getRiverCrossingActionCost(state, "C7", { tiles });

  assert.equal(crossing.valid, true);
  assert.equal(crossing.cost, 0);
  assert.equal(crossing.hasBridgeConnection, true);
});

test("Overstrained Bridge restores the river crossing action cost", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_bridge_basic", "C7");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 3
  }).state;
  const crossing = getRiverCrossingActionCost(state, "C7", { tiles });

  assert.equal(crossing.valid, true);
  assert.equal(crossing.cost, 1);
  assert.equal(crossing.hasBridgeConnection, false);
});

test("Overstrained tiles cannot satisfy placement adjacency requirements", () => {
  let state = fillWarehouse(newState());
  state = place(state, "core_gravel_path_basic", "C1", "rotation-0");
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 3
  }).state;
  const validation = validatePlaceTile(
    state,
    { type: TILE_ACTION_TYPES.PLACE_TILE, tileId: "core_tavern_basic", coordinate: "C3" },
    { tiles }
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /placed, non-Overstrained tile/);
});
