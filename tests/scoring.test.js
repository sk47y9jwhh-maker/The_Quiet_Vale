import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateScore } from "../src/game/scoring.js";
import { ENCOUNTER_TYPES, createInitialGameState } from "../src/game/setup.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");

function newState() {
  return createInitialGameState({
    playerCount: 1,
    seed: "scoring",
    encounterCards,
    tiles,
    mapHexes
  });
}

test("score totals Population and Renown from non-Overstrained placed tiles", () => {
  const state = {
    ...newState(),
    map: {
      ...newState().map,
      placedTiles: [
        { id: "tile-001", tileId: "core_bridge_basic", coordinate: "C7", coordinates: ["C7"], strain: 0 },
        { id: "tile-002", tileId: "core_tavern_basic", coordinate: "C3", coordinates: ["C3"], strain: 0 },
        {
          id: "tile-003",
          tileId: "core_vanguard_house_basic",
          coordinate: "A1",
          coordinates: ["A1"],
          strain: 0
        }
      ]
    }
  };
  const score = calculateScore(state, { tiles });

  assert.equal(score.population, 5);
  assert.equal(score.renown, 10);
  assert.equal(score.total, 15);
  assert.equal(score.scoringTileCount, 3);
});

test("Overstrained tiles do not contribute Population or Renown to score", () => {
  const state = {
    ...newState(),
    map: {
      ...newState().map,
      placedTiles: [
        { id: "tile-001", tileId: "core_bridge_basic", coordinate: "C7", coordinates: ["C7"], strain: 0 },
        {
          id: "tile-002",
          tileId: "core_vanguard_house_basic",
          coordinate: "A1",
          coordinates: ["A1"],
          strain: 3
        }
      ]
    }
  };
  const score = calculateScore(state, { tiles });

  assert.equal(score.population, 0);
  assert.equal(score.renown, 5);
  assert.deepEqual(score.overstrainedExcludedTileIds, ["tile-002"]);
  assert.equal(score.scoringTileCount, 1);
});

test("final scoring subtracts active Burden and Strain penalties", () => {
  const state = {
    ...newState(),
    map: {
      ...newState().map,
      placedTiles: [
        { id: "tile-001", tileId: "core_bridge_basic", coordinate: "C7", coordinates: ["C7"], strain: 0 },
        { id: "tile-002", tileId: "core_tavern_basic", coordinate: "C3", coordinates: ["C3"], strain: 2 },
        {
          id: "tile-003",
          tileId: "core_vanguard_house_basic",
          coordinate: "A1",
          coordinates: ["A1"],
          strain: 3
        }
      ]
    },
    encounter: {
      ...newState().encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden-1",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          resolved: false
        },
        {
          id: "burden-resolved",
          cardId: "burden-2",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          resolved: true
        },
        {
          id: "arrival-active",
          cardId: "arrival-1",
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          resolved: false
        }
      ]
    }
  };
  const score = calculateScore(state, { tiles });

  assert.equal(score.population, 0);
  assert.equal(score.renown, 10);
  assert.equal(score.activeBurdenCount, 1);
  assert.equal(score.strainTokens, 5);
  assert.equal(score.activeBurdenPenalty, 6);
  assert.equal(score.strainPenalty, 10);
  assert.equal(score.total, -6);
});
