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
const mapSource = await readJson("redesigned_basic_map_v0_1.json");
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
  assert.equal(result.round_rows.length, botProfiles.length * 4 * 15);
  assert.equal(result.game_rows.every((row) => SIMULATION_SUMMARY_FIELDS.every((field) => field in row)), true);
  assert.equal(result.round_rows.every((row) => SIMULATION_ROUND_FIELDS.every((field) => field in row)), true);
  assert.deepEqual(new Set(result.game_rows.map((row) => row.bot_profile)), new Set(botProfiles));
  assert.deepEqual(new Set(result.game_rows.map((row) => row.player_count)), new Set([1, 2, 3, 4]));
});

test("score bot is available as a high-score simulation profile", () => {
  const result = runSimulationBatch({
    gamesPerCombination: 1,
    playerCounts: [1],
    botProfiles: ["score"],
    seedPrefix: "simulation-score-test",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.equal(SIMULATION_BOT_PROFILES.score.label, "Score Bot");
  assert.equal(result.errors.length, 0);
  assert.equal(result.game_rows.length, 1);
  assert.equal(result.game_rows[0].bot_profile, "score");
  assert.equal(Number.isFinite(result.game_rows[0].final_score), true);
});

test("score bot resolves Burdens during a pressure-heavy 4-player game", () => {
  const result = runAutomatedGame({
    gameIndex: 1,
    playerCount: 4,
    botProfile: "score",
    seed: "score-retuned-check-score-4p-1",
    encounterCards,
    tiles,
    mapHexes
  });

  assert.equal(result.game.bot_profile, "score");
  assert.ok(result.game.actions_spent_resolving_burdens > 0);
  assert.ok(result.game.final_active_burdens < result.game.total_burdens_revealed);
  assert.ok(result.game.final_population > 0);
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
