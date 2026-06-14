import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createEncounterStorySummary,
  getEncounterFlavorText,
  getEncounterRuleLines,
  getEncounterSeasonResolutionText,
  getEncounterSeasonText
} from "../src/game/encounterPresentation.js";

const dataUrl = new URL("../src/data/", import.meta.url);
const encounterCards = JSON.parse(await readFile(new URL("encounter_cards.json", dataUrl), "utf8"));

test("encounter presentation extracts source flavor and current season text", () => {
  const card = encounterCards.find((candidate) => candidate.card_id === "boon_bounty_of_the_first_harvest");
  const summary = createEncounterStorySummary(card, {
    season: "I",
    prototypeText: "Applied Boon reward."
  });

  assert.equal(summary.cardName, card.card_name);
  assert.equal(summary.encounterType, card.encounter_type);
  assert.equal(summary.flavorText, card.flavour_text);
  assert.equal(summary.seasonText, card.season_i);
  assert.deepEqual(
    summary.ruleLines.map((line) => line.label),
    ["This season", "Resolution", "Prototype did"]
  );
});

test("encounter presentation handles fallback spelling and hides empty lines", () => {
  const card = {
    card_id: "test_encounter",
    card_name: "Test Encounter",
    encounter_type: "Boon",
    flavor_text: "  A short test story.  ",
    season_ii: "  Gain 1 Wood.  ",
    requirement: "",
    reward: null,
    lifecycle_or_resolution: undefined,
    effect: ""
  };

  assert.equal(getEncounterFlavorText(card), "A short test story.");
  assert.equal(getEncounterSeasonText(card, "II"), "Gain 1 Wood.");
  assert.deepEqual(getEncounterRuleLines(card, "II"), [{ label: "This season", value: "Gain 1 Wood." }]);
});

test("encounter presentation shows Burden season resolution costs from dedicated fields", () => {
  const card = encounterCards.find((candidate) => candidate.card_id === "burden_awoken_in_the_deep");

  assert.equal(getEncounterSeasonResolutionText(card, "III"), "Spend 1 Action and pay 6 Stone. Then discard.");
  assert.deepEqual(
    getEncounterRuleLines(card, "III").map((line) => [line.label, line.value]),
    [
      ["This season", card.season_iii],
      ["To resolve", card.season_iii_resolution]
    ]
  );
});
