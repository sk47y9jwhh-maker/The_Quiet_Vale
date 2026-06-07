import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeMapSource } from "../src/game/map.js";
import {
  SIMULATION_BOT_PROFILES,
  SIMULATION_ROUND_FIELDS,
  SIMULATION_SUMMARY_FIELDS,
  runAutomatedGame,
  runSimulationBatch,
  simulationRoundsToCsv,
  simulationSummaryToCsv
} from "../src/game/simulation.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapSource = await readJson("redesigned_basic_map_v0_2.json");
const mapHexes = normalizeMapSource(mapSource);

test("automated simulation batch completes one game for each bot and player count", () => {
  const botProfiles = Object.keys(SIMULATION_BOT_PROFILES);
  const result = runSimulationBatch({
    gamesPerCombination: 1,
    playerCounts: [1, 2, 3, 4],
    botProfiles,
    seedPrefix: "simulation-test",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.game_rows.length, botProfiles.length * 4);
  assert.equal(result.round_rows.length, botProfiles.length * 4 * 12);
  assert.equal(result.game_rows.every((row) => SIMULATION_SUMMARY_FIELDS.every((field) => field in row)), true);
  assert.equal(result.round_rows.every((row) => SIMULATION_ROUND_FIELDS.every((field) => field in row)), true);
  assert.deepEqual(new Set(result.game_rows.map((row) => row.bot_profile)), new Set(botProfiles));
  assert.deepEqual(new Set(result.game_rows.map((row) => row.player_count)), new Set([1, 2, 3, 4]));
});

test("balanced bot is the only exposed simulation profile", () => {
  const result = runSimulationBatch({
    gamesPerCombination: 1,
    playerCounts: [1],
    botProfiles: Object.keys(SIMULATION_BOT_PROFILES),
    seedPrefix: "simulation-balanced-only-test",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.deepEqual(Object.keys(SIMULATION_BOT_PROFILES), ["balanced"]);
  assert.equal(SIMULATION_BOT_PROFILES.balanced.label, "Balanced Bot");
  assert.equal(result.errors.length, 0);
  assert.equal(result.game_rows.length, 1);
  assert.equal(result.game_rows[0].bot_profile, "balanced");
  assert.equal(Number.isFinite(result.game_rows[0].final_score), true);
});

test("automated games shuffle their setup deck from the random seed", () => {
  const first = runAutomatedGame({
    gameIndex: 1,
    playerCount: 2,
    botProfile: "balanced",
    seed: "simulation-shuffle-a",
    encounterCards,
    tiles,
    mapHexes
  });
  const second = runAutomatedGame({
    gameIndex: 2,
    playerCount: 2,
    botProfile: "balanced",
    seed: "simulation-shuffle-b",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.notEqual(first.game.random_seed, second.game.random_seed);
  assert.notDeepEqual(
    first.finalState.encounter.setup.standardDeckCardIds,
    second.finalState.encounter.setup.standardDeckCardIds
  );
});

test("balanced bot resolves Burdens during a pressure-heavy 4-player game", () => {
  const result = runAutomatedGame({
    gameIndex: 1,
    playerCount: 4,
    botProfile: "balanced",
    seed: "balanced-burden-check-4p-1",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.equal(result.game.bot_profile, "balanced");
  assert.ok(result.game.actions_spent_resolving_burdens > 0);
  assert.ok(result.game.final_active_burdens < result.game.total_burdens_revealed);
  assert.ok(result.game.final_population > 0);
});

test("balanced bot can complete Arrivals and place unlocked Special tiles", () => {
  const result = runAutomatedGame({
    gameIndex: 3,
    playerCount: 4,
    botProfile: "balanced",
    seed: "balanced-sample-4p-3",
    encounterCards,
    tiles,
    mapHexes
  });
  const tileIndex = new Map(tiles.map((tile) => [tile.tile_id, tile]));
  const specialTileCount = result.finalState.map.placedTiles.filter(
    (placedTile) => tileIndex.get(placedTile.tileId)?.tile_source_type === "Special"
  ).length;

  assert.equal(result.game.bot_profile, "balanced");
  assert.ok(result.game.arrivals_completed > 0);
  assert.ok(specialTileCount > 0);
});

test("balanced bot converts placed tiles into upgraded scoring tiles", () => {
  const result = runAutomatedGame({
    gameIndex: 1,
    playerCount: 2,
    botProfile: "balanced",
    seed: "upgrade-pressure",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.equal(result.game.bot_profile, "balanced");
  assert.ok(result.game.total_upgrade_actions >= 10);
  assert.ok(result.game.final_upgraded_tiles >= 10);
  assert.equal(result.game.final_placed_tiles, result.finalState.map.placedTiles.length);
  assert.equal(
    result.game.final_population,
    result.game.final_basic_population + result.game.final_upgraded_population
  );
  assert.equal(result.game.final_warehouse_total >= 0, true);
});

test("simulation CSV exports include requested game and round headers", () => {
  const result = runSimulationBatch({
    gamesPerCombination: 1,
    playerCounts: [1],
    botProfiles: ["balanced"],
    seedPrefix: "simulation-csv-test",
    encounterCards,
    tiles,
    mapHexes
  });
  const gameCsv = simulationSummaryToCsv(result.game_rows);
  const roundCsv = simulationRoundsToCsv(result.round_rows);

  assert.equal(gameCsv.split("\n")[0], SIMULATION_SUMMARY_FIELDS.join(","));
  assert.equal(roundCsv.split("\n")[0], SIMULATION_ROUND_FIELDS.join(","));
});
