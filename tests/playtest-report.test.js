import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDebugScenario } from "../src/game/debugScenarios.js";
import { calculatePlaytestMetrics, getPlaytestPacingSignals } from "../src/game/playtestMetrics.js";
import {
  PLAYTEST_RATING_FIELDS,
  PLAYTEST_TEXT_FIELDS,
  createDefaultPlaytestNotes,
  createPlaytestReportMarkdown
} from "../src/game/playtestReport.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");

function createReport(notes = createDefaultPlaytestNotes()) {
  const { game } = createDebugScenario("travel-steward-marker", { encounterCards, tiles, mapHexes });
  const metrics = calculatePlaytestMetrics(game, { tiles });
  const pacingSignals = getPlaytestPacingSignals(metrics);

  return createPlaytestReportMarkdown({
    state: game,
    metrics,
    pacingSignals,
    notes
  });
}

test("playtest report includes subjective ratings and pulse metrics", () => {
  const report = createReport({
    ...createDefaultPlaytestNotes(),
    sessionLabel: "First solo feel test",
    fun: "Fun",
    pace: "A little slow",
    tension: "Good tension",
    choices: "Interesting",
    friction: "Minor",
    bestMoment: "The disconnected Forest created a useful decision.",
    dragMoment: "Setup still felt fiddly.",
    balanceNotes: "Travel cost felt meaningful.",
    ruleQuestions: "Check whether upgrades should appear earlier."
  });

  assert.match(report, /^# The Quiet Vale Playtest Note: First solo feel test/);
  assert.match(report, /- Fun: Fun/);
  assert.match(report, /- Pace: A little slow/);
  assert.match(report, /- Logged actions spent: 3/);
  assert.match(report, /- Disconnected Travel: 1 paid, 0 waived/);
  assert.match(report, /The disconnected Forest created a useful decision/);
  assert.match(report, /Travel cost felt meaningful/);
});

test("playtest report has stable fields even before notes are filled", () => {
  const report = createReport();

  for (const field of PLAYTEST_RATING_FIELDS) {
    assert.match(report, new RegExp(`- ${field.label}: Unrated`));
  }

  for (const field of PLAYTEST_TEXT_FIELDS) {
    assert.match(report, new RegExp(`### ${field.label}\\nNo note\\.`));
  }
});
