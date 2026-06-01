import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ENCOUNTER_TYPES,
  STANDARD_RULES,
  createEncounterIndex,
  createInitialGameState,
  countEncounterTypes,
  getStartingWarehouseResourceCount,
  hashSeed,
  resolveEncounterCards
} from "../src/game/setup.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");
const encounterIndex = createEncounterIndex(encounterCards);

for (const playerCount of [1, 2, 3, 4]) {
  test(`${playerCount}-player setup creates correct hands, deck, and Golden Boon count`, () => {
    const state = createInitialGameState({
      playerCount,
      seed: `setup-${playerCount}`,
      encounterCards,
      tiles,
      mapHexes
    });
    const handIds = state.players.flatMap((player) => player.hand);
    const handCards = resolveEncounterCards(handIds, encounterIndex);
    const deckCards = resolveEncounterCards(state.encounter.deck, encounterIndex);
    const standardCards = [...handCards, ...deckCards].filter(
      (card) => card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON
    );
    const standardCounts = countEncounterTypes(standardCards);

    assert.equal(state.players.length, playerCount);
    assert.equal(state.players.every((player) => player.hand.length === 10), true);
    assert.equal(state.players.every((player) => player.lastInteraction === null), true);
    assert.equal(handCards.every((card) => card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON), true);
    assert.equal(state.encounter.deck.length, 5 * playerCount + 1);
    assert.equal(deckCards.filter((card) => card.encounter_type === ENCOUNTER_TYPES.GOLDEN_BOON).length, 1);
    assert.equal(standardCounts[ENCOUNTER_TYPES.BOON], 5 * playerCount);
    assert.equal(standardCounts[ENCOUNTER_TYPES.BURDEN], 5 * playerCount);
    assert.equal(standardCounts[ENCOUNTER_TYPES.ARRIVAL], 5 * playerCount);
    assert.deepEqual(state.encounter.discard, []);
    assert.deepEqual(state.encounter.active, []);
    assert.equal(state.warehouse.cap, 15);
    assert.deepEqual(
      state.warehouse.resources,
      Object.fromEntries(
        STANDARD_RULES.resources.map((resource) => [
          resource,
          STANDARD_RULES.startingWarehouseResourcesByPlayerCount[playerCount]
        ])
      )
    );
  });
}

test("setup is deterministic for a given seed", () => {
  const first = createInitialGameState({ playerCount: 3, seed: "same-seed", encounterCards, tiles, mapHexes });
  const second = createInitialGameState({ playerCount: 3, seed: "same-seed", encounterCards, tiles, mapHexes });

  assert.deepEqual(first.players.map((player) => player.hand), second.players.map((player) => player.hand));
  assert.deepEqual(first.encounter.deck, second.encounter.deck);
});

test("different setup seeds redeal Encounter hands and deck", () => {
  const first = createInitialGameState({ playerCount: 2, seed: "playtest-deal-a", encounterCards, tiles, mapHexes });
  const second = createInitialGameState({ playerCount: 2, seed: "playtest-deal-b", encounterCards, tiles, mapHexes });

  assert.notDeepEqual(first.players.map((player) => player.hand), second.players.map((player) => player.hand));
  assert.notDeepEqual(first.encounter.deck, second.encounter.deck);
});

test("renamed default seeds keep the prototype setup baseline", () => {
  assert.equal(hashSeed("quiet-vale"), 0x7fd0d1c9);
  assert.equal(hashSeed("quiet-vale-m2"), 0x6abed5f3);
});

test("standard setup rejects Council Variant player counts", () => {
  assert.throws(
    () => createInitialGameState({ playerCount: 5, seed: "council", encounterCards, tiles, mapHexes }),
    /supports 1-4 players/
  );
});

test("starting Warehouse resources follow v2.0 player-count table including Council reference", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((playerCount) => [playerCount, getStartingWarehouseResourceCount(playerCount)]),
    [
      [1, 15],
      [2, 10],
      [3, 5],
      [4, 0],
      [5, 0],
      [6, 0]
    ]
  );
});
