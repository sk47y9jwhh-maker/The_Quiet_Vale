import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getBridgeCandidateHexes,
  getNeighborCoordinates,
  getRiverAdjacentLandSites,
  getRiverHexes,
  validateApprovedMap,
  validateSourceCounts
} from "../src/game/map.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");
const riverRules = await readJson("river_rules.json");

test("source JSON row counts match the implementation prompt", () => {
  const validation = validateSourceCounts({
    encounterCards,
    tiles,
    mapHexes,
    riverRules
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.actual, {
    encounterCards: 80,
    tiles: 77,
    mapHexes: 126,
    riverRules: 11
  });
});

test("approved map has one connected river system under flat-top even-q adjacency", () => {
  const validation = validateApprovedMap(mapHexes);

  assert.equal(validation.valid, true);
  assert.equal(validation.rowCount, 126);
  assert.equal(validation.waterHexes.length, 15);
  assert.equal(validation.riverComponents.length, 1);
});

test("bridge candidates are on Water hexes", () => {
  const candidates = getBridgeCandidateHexes(mapHexes);

  assert.deepEqual(
    candidates.map((hex) => hex.Coordinate),
    ["C7", "H5", "H9"]
  );
  assert.equal(candidates.every((hex) => hex.Terrain === "Water"), true);
});

test("river-adjacent land sites are computed from flat-top adjacency", () => {
  const computed = getRiverAdjacentLandSites(mapHexes).map((hex) => hex.Coordinate);
  const source = mapHexes
    .filter((hex) => hex.River_Adjacent_Land === true)
    .map((hex) => hex.Coordinate);

  assert.deepEqual(computed, source);
  assert.equal(computed.length, 27);
});

test("flat-top adjacency connects the fork and lower branches", () => {
  const river = new Set(getRiverHexes(mapHexes).map((hex) => hex.Coordinate));
  const forkNeighbors = getNeighborCoordinates("F7", mapHexes).filter((coordinate) => river.has(coordinate));

  assert.deepEqual(forkNeighbors.sort(), ["E7", "F6", "F8"]);
});
