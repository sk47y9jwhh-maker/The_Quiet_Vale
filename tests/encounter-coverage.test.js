import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEncounterCoverageAudit } from "../src/game/encounterCoverage.js";
import { ENCOUNTER_TYPES } from "../src/game/setup.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");

function audit() {
  return createEncounterCoverageAudit(encounterCards, { tiles });
}

function findAuditedCard(auditedCards, cardId) {
  const card = auditedCards.find((candidate) => candidate.cardId === cardId);
  assert.ok(card, `${cardId} should be present in the coverage audit`);
  return card;
}

test("encounter coverage audit includes every source encounter card", () => {
  const coverage = audit();

  assert.equal(coverage.total, encounterCards.length);
  assert.deepEqual(
    coverage.cards.map((card) => card.cardId).sort(),
    encounterCards.map((card) => card.card_id).sort()
  );
});

test("encounter coverage audit summarizes the current prototype support boundary", () => {
  const coverage = audit();

  assert.deepEqual(coverage.statusCounts, {
    supported: 80,
    partial: 0,
    unsupported: 0
  });
  assert.deepEqual(coverage.typeCounts[ENCOUNTER_TYPES.BOON].statuses, {
    supported: 25,
    partial: 0,
    unsupported: 0
  });
  assert.deepEqual(coverage.typeCounts[ENCOUNTER_TYPES.BURDEN].statuses, {
    supported: 25,
    partial: 0,
    unsupported: 0
  });
  assert.deepEqual(coverage.typeCounts[ENCOUNTER_TYPES.ARRIVAL].statuses, {
    supported: 25,
    partial: 0,
    unsupported: 0
  });
  assert.deepEqual(coverage.typeCounts[ENCOUNTER_TYPES.GOLDEN_BOON].statuses, {
    supported: 5,
    partial: 0,
    unsupported: 0
  });
});

test("coverage audit reports representative implemented templates", () => {
  const coverage = audit();
  const sharedHands = findAuditedCard(coverage.cards, "boon_shared_hands_lighter_loads");
  const burdenBearers = findAuditedCard(coverage.cards, "arrival_the_burden_bearers");
  const burdenOfCommand = findAuditedCard(coverage.cards, "burden_the_burden_of_command");
  const smokeOverHearths = findAuditedCard(coverage.cards, "burden_smoke_over_hearths");

  assert.equal(sharedHands.status, "supported");
  assert.deepEqual(sharedHands.implementationAreas, ["burden_resolution_discount"]);

  assert.equal(burdenBearers.status, "supported");
  assert.deepEqual(burdenBearers.implementationAreas, [
    "arrival_timer_lifecycle",
    "housing_plus_resource_requirement",
    "special_tile_unlock"
  ]);
  assert.deepEqual(burdenBearers.unlockedSpecialTileIds, ["special_the_resting_hall"]);

  assert.equal(burdenOfCommand.status, "supported");
  assert.ok(burdenOfCommand.implementationAreas.includes("steward_token_strain_placement"));
  assert.ok(burdenOfCommand.implementationAreas.includes("resolution_fixed"));

  assert.equal(smokeOverHearths.status, "supported");
  assert.equal(smokeOverHearths.lifecycle.hasResolutionCost, false);
  assert.ok(smokeOverHearths.implementationAreas.includes("persistent_active_burden_no_resolution"));
});

test("coverage audit tracks implemented and pending Golden Boon effects", () => {
  const coverage = audit();
  const goldenBell = findAuditedCard(coverage.cards, "golden_boon_the_golden_bell");
  const goldenEyedTraveler = findAuditedCard(coverage.cards, "golden_boon_the_golden_eyed_traveler");
  const goldenScroll = findAuditedCard(coverage.cards, "golden_boon_the_golden_scroll");
  const goldenSignetRing = findAuditedCard(coverage.cards, "golden_boon_the_golden_signet_ring");
  const goldenVial = findAuditedCard(coverage.cards, "golden_boon_the_golden_vial");

  assert.equal(goldenBell.status, "supported");
  assert.deepEqual(goldenBell.implementationAreas, [
    "golden_boon_extra_reveal",
    "golden_bell_active_arrival_from_box"
  ]);
  assert.equal(goldenEyedTraveler.status, "supported");
  assert.deepEqual(goldenEyedTraveler.implementationAreas, [
    "golden_boon_extra_reveal",
    "golden_eyed_traveler_extra_turns"
  ]);
  assert.equal(goldenScroll.status, "supported");
  assert.deepEqual(goldenScroll.implementationAreas, [
    "golden_boon_extra_reveal",
    "golden_scroll_hand_refresh"
  ]);
  assert.equal(goldenSignetRing.status, "supported");
  assert.deepEqual(goldenSignetRing.implementationAreas, [
    "golden_boon_extra_reveal",
    "golden_signet_ring_relocate_tiles"
  ]);
  assert.equal(goldenVial.status, "supported");
  assert.deepEqual(goldenVial.implementationAreas, [
    "golden_boon_extra_reveal",
    "golden_vial_disconnected_travel"
  ]);
});
