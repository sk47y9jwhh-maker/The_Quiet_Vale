import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { getNeighborCoordinates } from "../src/game/map.js";
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

function newState(playerCount = 2) {
  return createInitialGameState({
    playerCount,
    seed: `turns-${playerCount}`,
    encounterCards,
    tiles,
    mapHexes
  });
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

function advanceToPlayerTurns(state) {
  state = dispatch(state, { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }).state;
  return state;
}

function playOneRound(state) {
  state = advanceToPlayerTurns(state);

  for (let index = 0; index < state.playerCount; index += 1) {
    state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  }

  return dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND }).state;
}

test("initial setup starts in the Seed Encounters phase", () => {
  const state = newState(3);

  assert.equal(state.phase, GAME_PHASES.SEED_ENCOUNTERS);
  assert.equal(state.activePlayerId, null);
  assert.equal(state.round, 1);
  assert.equal(state.season, "I");
  assert.equal(state.players.every((player) => player.actionsRemaining === 4), true);
});

test("seeding and revealing opens Player 1's turn", () => {
  const seeded = dispatch(newState(2), { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS }).state;
  const revealed = dispatch(seeded, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }).state;

  assert.equal(seeded.phase, GAME_PHASES.REVEAL_ENCOUNTERS);
  assert.equal(seeded.activePlayerId, null);
  assert.equal(revealed.phase, GAME_PHASES.PLAYER_TURNS);
  assert.equal(revealed.activePlayerId, "P1");
  assert.deepEqual(
    revealed.players.map((player) => player.actionsRemaining),
    [4, 4]
  );
});

test("ending a turn passes remaining actions and activates the next player", () => {
  const state = advanceToPlayerTurns(newState(2));
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });

  assert.equal(result.ok, true);
  assert.equal(result.advancedRound, false);
  assert.equal(nextState.phase, GAME_PHASES.PLAYER_TURNS);
  assert.equal(nextState.activePlayerId, "P2");
  assert.equal(nextState.players[0].actionsRemaining, 0);
  assert.equal(nextState.players[1].actionsRemaining, 4);
});

test("ending the last player turn moves to end-of-round effects", () => {
  let state = advanceToPlayerTurns(newState(2));
  state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });

  assert.equal(result.ok, true);
  assert.equal(result.readyForEndRound, true);
  assert.equal(nextState.phase, GAME_PHASES.END_ROUND);
  assert.equal(nextState.round, 1);
  assert.equal(nextState.season, "I");
  assert.equal(nextState.activePlayerId, null);
  assert.deepEqual(
    nextState.players.map((player) => player.actionsRemaining),
    [0, 0]
  );
});

test("end of Season I adds up to 10 assorted Warehouse resources", () => {
  const base = newState(1);
  const emptyResources = Object.fromEntries(base.rules.resources.map((resource) => [resource, 0]));
  const state = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    round: 5,
    season: "I",
    warehouse: {
      ...base.warehouse,
      resources: emptyResources
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });
  const totalResources = Object.values(nextState.warehouse.resources).reduce((sum, amount) => sum + amount, 0);

  assert.equal(result.ok, true);
  assert.equal(totalResources, 10);
  assert.equal(result.seasonEffects[0].type, "end_season_resource_gain");
});

test("end of Season II spreads Strain from Overstrained tiles", () => {
  const base = newState(1);
  const sourceCoordinate = "A1";
  const targetCoordinate = getNeighborCoordinates(sourceCoordinate, mapHexes)[0];
  const state = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    round: 10,
    season: "II",
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_gravel_path_basic",
          coordinate: sourceCoordinate,
          coordinates: [sourceCoordinate],
          strain: 3
        },
        {
          id: "tile-002",
          tileId: "core_forest_basic",
          coordinate: targetCoordinate,
          coordinates: [targetCoordinate],
          strain: 0
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(result.seasonEffects[0].type, "end_season_overstrained_spread");
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").strain, 1);
});

test("The Golden Eyed Traveler opens one additional Player Turns phase before end of round", () => {
  const base = advanceToPlayerTurns(newState(2));
  let state = {
    ...base,
    encounter: {
      ...base.encounter,
      roundEffects: [
        {
          id: "golden-eyed-traveler",
          source: "golden_boon",
          type: "golden_eyed_traveler_extra_turns",
          cardId: "golden_boon_the_golden_eyed_traveler",
          cardName: "The Golden Eyed Traveler",
          round: 1,
          season: "I",
          effectText: "Open one additional Player Turns phase.",
          maxUses: 1,
          uses: 0,
          expiresAtEndOfRound: true
        }
      ]
    }
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  const extraPhase = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });

  assert.equal(extraPhase.result.ok, true);
  assert.equal(extraPhase.result.extraPlayerTurns, true);
  assert.equal(extraPhase.state.phase, GAME_PHASES.PLAYER_TURNS);
  assert.equal(extraPhase.state.round, 1);
  assert.equal(extraPhase.state.activePlayerId, "P1");
  assert.deepEqual(
    extraPhase.state.players.map((player) => player.actionsRemaining),
    [4, 4]
  );
  assert.equal(extraPhase.state.encounter.roundEffects[0].uses, 1);

  state = dispatch(extraPhase.state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  const endRoundReady = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });

  assert.equal(endRoundReady.result.ok, true);
  assert.equal(endRoundReady.result.readyForEndRound, true);
  assert.equal(endRoundReady.state.phase, GAME_PHASES.END_ROUND);
  assert.equal(endRoundReady.state.activePlayerId, null);
  assert.deepEqual(
    endRoundReady.state.players.map((player) => player.actionsRemaining),
    [0, 0]
  );
});

test("resolving end-of-round effects advances the round and resets actions", () => {
  let state = advanceToPlayerTurns(newState(2));
  state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(result.advancedRound, true);
  assert.equal(nextState.phase, GAME_PHASES.SEED_ENCOUNTERS);
  assert.equal(nextState.round, 2);
  assert.equal(nextState.season, "I");
  assert.equal(nextState.activePlayerId, null);
  assert.deepEqual(
    nextState.players.map((player) => player.actionsRemaining),
    [4, 4]
  );
});

test("end of round skips seeding when all player hands are empty", () => {
  let state = advanceToPlayerTurns(newState(2));
  state = {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: []
    }))
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN }).state;
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(result.autoSkippedSeeding, true);
  assert.equal(nextState.phase, GAME_PHASES.REVEAL_ENCOUNTERS);
  assert.equal(nextState.round, 2);
  assert.deepEqual(nextState.encounter.seededRounds, [1, 2]);
  assert.match(result.message, /ready to reveal/);
});

test("round advancement updates seasons at rounds 6 and 11", () => {
  let state = newState(1);

  for (let index = 0; index < 5; index += 1) {
    state = playOneRound(state);
  }

  assert.equal(state.round, 6);
  assert.equal(state.season, "II");

  for (let index = 0; index < 5; index += 1) {
    state = playOneRound(state);
  }

  assert.equal(state.round, 11);
  assert.equal(state.season, "III");
});

test("ending the final round completes the standard game", () => {
  let state = newState(1);

  for (let index = 0; index < 15; index += 1) {
    state = playOneRound(state);
  }

  assert.equal(state.phase, GAME_PHASES.COMPLETE);
  assert.equal(state.round, 15);
  assert.equal(state.season, "III");
  assert.equal(state.activePlayerId, null);
  assert.equal(state.players[0].actionsRemaining, 0);
});

test("cannot end a turn after the game is complete", () => {
  let state = newState(1);

  for (let index = 0; index < 15; index += 1) {
    state = playOneRound(state);
  }

  const result = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /already complete/);
});

test("cannot end a turn before the Player Turns phase", () => {
  const state = newState(1);
  const result = dispatch(state, { type: TILE_ACTION_TYPES.END_TURN });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Player Turns phase/);
});
