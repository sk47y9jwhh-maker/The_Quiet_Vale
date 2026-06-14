import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEBUG_SCENARIO_DEFINITIONS, createDebugScenario } from "../src/game/debugScenarios.js";
import { normalizeMapSource } from "../src/game/map.js";
import { dispatchGameAction } from "../src/game/reducer.js";
import { GAME_PHASES } from "../src/game/setup.js";
import { TILE_ACTION_TYPES } from "../src/game/tiles.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapData = await readJson("redesigned_basic_map_v0_2.json");
const mapHexes = normalizeMapSource(mapData);
const scenarioOptions = { encounterCards, tiles, mapHexes };

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

function scenario(id) {
  return createDebugScenario(id, scenarioOptions);
}

test("all debug scenario presets build playable 1-player states", () => {
  for (const definition of DEBUG_SCENARIO_DEFINITIONS) {
    const preset = scenario(definition.id);

    assert.equal(preset.id, definition.id);
    assert.equal(preset.game.playerCount, 1);
    assert.equal(preset.game.phase, GAME_PHASES.PLAYER_TURNS);
    assert.equal(preset.game.activePlayerId, "P1");
    assert.ok(preset.selectedCoordinate);
    assert.ok(preset.expected.length > 0);
  }
});

test("arrival completion preset can complete The Quiet Quest and unlock its Special tile", () => {
  const preset = scenario("arrival-completion");
  const activeArrival = preset.game.encounter.active[0];

  assert.equal(activeArrival.cardId, "arrival_the_quiet_quest");

  const { state, result } = dispatch(preset.game, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: activeArrival.id
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.requirementCost, [{ resource: "Goods", amount: 4 }]);
  assert.ok(result.unlockedTileIds.includes("special_adventurers_guild"));
  assert.equal(state.tileSupply.special.find((entry) => entry.tileId === "special_adventurers_guild").locked, false);
});

test("burden resolution preset can resolve Blighted Lands", () => {
  const preset = scenario("burden-resolution");
  const activeBurden = preset.game.encounter.active[0];

  assert.equal(activeBurden.cardId, "burden_blighted_lands");

  const { state, result } = dispatch(preset.game, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: activeBurden.id
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.cost, [{ amount: 2, resource: "Food" }]);
  assert.equal(state.encounter.active.length, 0);
  assert.ok(state.encounter.discard.includes("burden_blighted_lands"));
});

test("boon upgrade preset applies Raised in Season to the next Core upgrade", () => {
  const preset = scenario("boon-upgrade-discount");
  const street = preset.game.map.placedTiles.find((placedTile) => placedTile.tileId === "core_gravel_path_basic");

  assert.ok(street);
  assert.equal(preset.game.encounter.roundEffects[0].type, "core_upgrade_discount");

  const { state, result } = dispatch(preset.game, {
    type: TILE_ACTION_TYPES.UPGRADE_TILE,
    placedTileId: street.id,
    upgradeCostReductionResources: ["Stone"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [{ amount: 3, resource: "Stone" }]);
  assert.deepEqual(result.cost, [{ amount: 2, resource: "Stone" }]);
  assert.deepEqual(state.encounter.roundEffects, []);
  assert.ok(state.encounter.discard.includes("boon_raised_in_good_season"));
});

test("support strain preset consumes Support to prevent the first Strain and allows the second", () => {
  const preset = scenario("support-strain");
  const farm = preset.game.map.placedTiles[0];

  assert.equal(farm.tileId, "core_farm_basic");
  assert.equal(farm.supported, true);
  assert.equal(farm.supportedUsedThisRound, false);

  const first = dispatch(preset.game, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: farm.id,
    amount: 1
  });
  const second = dispatch(first.state, {
    type: TILE_ACTION_TYPES.APPLY_STRAIN,
    placedTileId: farm.id,
    amount: 1
  });

  assert.equal(first.result.ok, true);
  assert.equal(first.result.strainPrevented, 1);
  assert.equal(first.state.map.placedTiles[0].strain, 0);
  assert.equal(first.state.map.placedTiles[0].supported, false);
  assert.equal(first.state.map.placedTiles[0].supportedUsedThisRound, false);
  assert.equal(second.result.ok, true);
  assert.equal(second.result.strainAdded, 1);
  assert.equal(second.state.map.placedTiles[0].strain, 1);
});
