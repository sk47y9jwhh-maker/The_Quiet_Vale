import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COORDINATE_CONVENTIONS,
  MAP_COLUMN_LETTERS,
  MAP_ROW_NUMBERS,
  getBridgeCandidateHexes,
  getMapAxes,
  getNeighborCoordinates,
  getRiverAdjacentLandSites,
  getRiverHexes,
  normalizeMapSource,
  parseCoordinate,
  validateApprovedMap,
  validateMapOption,
  validateSourceCounts
} from "../src/game/map.js";
import { createInitialGameState } from "../src/game/setup.js";
import { validatePlaceTile } from "../src/game/tiles.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");
const redesignedMapSource = await readJson("redesigned_basic_map_v0_1.json");
const redesignedMapHexes = normalizeMapSource(redesignedMapSource);
const riverRules = await readJson("river_rules.json");

const redesignedRiverCoordinates = [
  "D1",
  "D2",
  "E3",
  "F3",
  "E4",
  "G4",
  "H4",
  "E5",
  "I5",
  "J5",
  "E6",
  "K6",
  "E7",
  "K7",
  "L7",
  "E8",
  "F8",
  "M8",
  "N8",
  "G9",
  "H9"
];

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

test("redesigned basic map v0.1 validates its coordinate axes, terrain counts, and rivers", () => {
  const validation = validateMapOption(redesignedMapHexes, {
    label: "Redesigned Basic Map v0.1",
    expectedRows: MAP_ROW_NUMBERS,
    expectedColumns: MAP_COLUMN_LETTERS,
    expectedCoordinateConvention: COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER,
    expectedHexes: 126,
    expectedTerrain: redesignedMapSource.expected_terrain_counts,
    expectedRiverCoordinates: redesignedRiverCoordinates,
    requireWaterFeatureRiver: true
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.rowCount, 126);
  assert.deepEqual(validation.axes.rows, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(validation.axes.columns, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"]);
  assert.deepEqual(validation.terrainCounts, redesignedMapSource.expected_terrain_counts);
  assert.deepEqual(validation.waterCoordinates, redesignedRiverCoordinates);
  assert.equal(validation.allWaterHexesAreRiver, true);
  assert.equal(validation.allWaterHexesAreRiverFeature, true);
  assert.equal(validation.allRiverHexesAreBridgePlacementSites, true);
  assert.equal(validation.bridgeCandidateHexes.length, 0);
});

test("redesigned basic map v0.1 uses A-N horizontally and 1-9 vertically", () => {
  const axes = getMapAxes(redesignedMapHexes);
  const topLeft = parseCoordinate("A1", redesignedMapHexes);
  const bottomRight = parseCoordinate("N9", redesignedMapHexes);

  assert.equal(axes.coordinateConvention, COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER);
  assert.deepEqual(topLeft, {
    row: 1,
    rowIndex: 0,
    column: "A",
    columnIndex: 0,
    coordinateConvention: COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER
  });
  assert.deepEqual(bottomRight, {
    row: 9,
    rowIndex: 8,
    column: "N",
    columnIndex: 13,
    coordinateConvention: COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER
  });
});

test("redesigned basic map v0.1 treats every River hex as a legal Bridge site", () => {
  const state = createInitialGameState({
    playerCount: 1,
    seed: "redesigned-map",
    encounterCards,
    tiles,
    mapHexes: redesignedMapHexes
  });

  for (const coordinate of redesignedRiverCoordinates) {
    const validation = validatePlaceTile(
      state,
      {
        tileId: "core_bridge_basic",
        coordinate
      },
      { tiles }
    );

    assert.equal(validation.valid, true, `${coordinate}: ${validation.errors.join(", ")}`);
  }
});
