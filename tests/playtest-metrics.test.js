import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDebugScenario } from "../src/game/debugScenarios.js";
import { calculatePlaytestMetrics, getPlaytestPacingSignals } from "../src/game/playtestMetrics.js";
import { dispatchGameAction } from "../src/game/reducer.js";
import { TILE_ACTION_TYPES } from "../src/game/tiles.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");
const scenarioOptions = { encounterCards, tiles, mapHexes };

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

test("playtest metrics summarize action mix, board pressure, encounters, and economy", () => {
  const preset = createDebugScenario("travel-steward-marker", scenarioOptions);
  const metrics = calculatePlaytestMetrics(preset.game, { tiles });

  assert.equal(metrics.actionMix.placements, 2);
  assert.equal(metrics.actionMix.upgrades, 0);
  assert.equal(metrics.actionMix.activations, 0);
  assert.equal(metrics.actionMix.mapActions, 2);
  assert.equal(metrics.disconnectedTravel.paid, 1);
  assert.equal(metrics.board.placedTiles, 2);
  assert.equal(metrics.board.categories.Resource, 1);
  assert.equal(metrics.board.categories.Travel, 1);
  assert.equal(metrics.economy.cappedResources.length, 6);
});

test("playtest metrics include Arrival completion action cost and unlock progress", () => {
  const preset = createDebugScenario("arrival-completion", scenarioOptions);
  const activeArrival = preset.game.encounter.active[0];
  const { state } = dispatch(preset.game, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: activeArrival.id
  });
  const metrics = calculatePlaytestMetrics(state, { tiles });

  assert.equal(metrics.totalLoggedActionsSpent, 1);
  assert.equal(metrics.encounters.active.arrivals, 0);
  assert.equal(metrics.encounters.completed.arrivals, 1);
  assert.equal(metrics.economy.totalResources, 86);
});

test("playtest pacing signals flag high Strain pressure", () => {
  const preset = createDebugScenario("support-strain", scenarioOptions);
  const farm = preset.game.map.placedTiles[0];
  const strained = dispatch(preset.game, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: farm.id,
    strain: 2
  }).state;
  const metrics = calculatePlaytestMetrics(strained, { tiles });
  const signals = getPlaytestPacingSignals(metrics);

  assert.ok(signals.some((signal) => signal.includes("Strain is matching or exceeding tile count")));
});

test("playtest pacing signals notice delayed upgrades and activations", () => {
  let game = createDebugScenario("golden-vial-travel", scenarioOptions).game;
  game = dispatch(game, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  game = dispatch(game, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_gravel_path_basic",
    coordinate: "A10",
    orientation: "rotation-0"
  }).state;
  game = dispatch(game, {
    type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS
  }).state;
  game = dispatch(game, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  const signals = getPlaytestPacingSignals(calculatePlaytestMetrics(game, { tiles }));

  assert.ok(signals.some((signal) => signal.includes("no upgrades yet")));
  assert.ok(signals.some((signal) => signal.includes("No tile activations yet")));
});
