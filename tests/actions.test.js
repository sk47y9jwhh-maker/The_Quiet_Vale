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

  return withWarehouseResources({
    ...state,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  }, {});
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles });
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

function actionsRemaining(state) {
  return state.players.find((player) => player.id === state.activePlayerId).actionsRemaining;
}

function withStewardMarker(state, placedTileId) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === state.activePlayerId
        ? {
            ...player,
            lastInteraction: { type: "debug", placedTileId, coordinate: "C1", round: state.round, season: state.season }
          }
        : player
    )
  };
}

function goldenVialEffect({ uses = 0 } = {}) {
  return {
    id: "golden-vial",
    source: "golden_boon",
    type: "golden_vial_disconnected_travel",
    cardId: "golden_boon_the_golden_vial",
    cardName: "The Golden Vial",
    round: 1,
    season: "I",
    effectText: "Once per round, disconnected Travel costs 0 Actions.",
    maxUses: 1,
    uses,
    expiresAtEndOfRound: false,
    resetUsesEachRound: true
  };
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

test("placement adjacent to an existing settlement network spends only the Place action", () => {
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

test("multihex placement spends 1 Action when any footprint hex touches the settlement network", () => {
  let state = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_track_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_track_basic",
    coordinate: "A3",
    orientation: "rotation-4"
  });

  assert.equal(result.result.ok, true);
  assert.deepEqual(result.result.placedTile.coordinates, ["A3", "A2", "B1"]);
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

test("The Golden Vial waives one disconnected placement Travel action each round", () => {
  const base = newState();
  const state = withStewardMarker({
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
        }
      ]
    },
    encounter: {
      ...base.encounter,
      roundEffects: [goldenVialEffect()]
    }
  }, "tile-001");
  const first = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  });
  const second = dispatch(first.state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A10",
    orientation: "rotation-0"
  });

  assert.equal(first.result.ok, true);
  assert.equal(first.result.actionCost.total, 1);
  assert.equal(first.result.actionCost.originalTotal, 2);
  assert.equal(first.result.actionCost.disconnectedTravelActionCost, 0);
  assert.equal(first.result.disconnectedTravelActionDiscount.cardId, "golden_boon_the_golden_vial");
  assert.equal(first.state.encounter.roundEffects[0].uses, 1);

  assert.equal(second.result.ok, true);
  assert.equal(second.result.actionCost.total, 2);
  assert.equal(second.result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(second.result.disconnectedTravelActionDiscount, null);
  assert.equal(second.state.encounter.roundEffects[0].uses, 1);
});

test("activating a disconnected tile spends one Travel action plus one Activate action", () => {
  const base = newState();
  const state = withStewardMarker({
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
  }, "tile-001");
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 2);
  assert.equal(result.result.actionCost.activationActionCost, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 1);
  assert.equal(actionsRemaining(result.state), 2);
  assert.equal(result.state.warehouse.resources.Wood, 2);
});

test("activating the tile under the steward marker does not spend disconnected Travel", () => {
  let state = dispatch(newState(), {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "C1",
    orientation: "rotation-0"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 1);
  assert.equal(result.result.actionCost.activationActionCost, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 0);
  assert.equal(actionsRemaining(result.state), 0);
  assert.deepEqual(result.state.players[0].lastInteraction, {
    type: "activate",
    placedTileId: "tile-002",
    coordinate: "A13",
    round: 1,
    season: "I"
  });
});

test("The Golden Vial waives disconnected activation Travel", () => {
  const base = newState();
  const state = withStewardMarker({
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
    },
    encounter: {
      ...base.encounter,
      roundEffects: [goldenVialEffect()]
    }
  }, "tile-001");
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: "tile-002"
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.result.actionCost.total, 1);
  assert.equal(result.result.actionCost.originalTotal, 2);
  assert.equal(result.result.actionCost.activationActionCost, 1);
  assert.equal(result.result.actionCost.disconnectedTravelActionCost, 0);
  assert.equal(result.state.encounter.roundEffects[0].uses, 1);
  assert.equal(actionsRemaining(result.state), 3);
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
