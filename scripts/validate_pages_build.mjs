import { existsSync } from "node:fs";
import { createEncounterCoverageAudit, ENCOUNTER_COVERAGE_STATUSES } from "../src/game/encounterCoverage.js";
import { normalizeMapSource, validateApprovedMap, validateSourceCounts } from "../src/game/map.js";
import { dispatchGameAction } from "../src/game/reducer.js";
import { ENCOUNTER_TYPES, GAME_PHASES, createInitialGameState } from "../src/game/setup.js";
import { STEWARD_POWER_TYPES } from "../src/game/stewards.js";
import { TILE_ACTION_TYPES } from "../src/game/tiles.js";
import encounterCards from "../src/data/encounter_cards.json" with { type: "json" };
import riverRules from "../src/data/river_rules.json" with { type: "json" };
import mapSource from "../src/data/redesigned_basic_map_v0_2.json" with { type: "json" };
import tiles from "../src/data/tiles.json" with { type: "json" };

const REQUIRED_STATIC_FILES = Object.freeze(["index.html", "robots.txt", "CNAME", "rulebook.pdf"]);
const STARTING_WAREHOUSE_BY_PLAYER_COUNT = Object.freeze({
  1: 15,
  2: 10,
  3: 5,
  4: 0
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoErrors(label, validation) {
  assert(validation.valid, `${label}: ${validation.errors.join("; ")}`);
}

function createGame(playerCount, stewardRoles = []) {
  return createInitialGameState({
    playerCount,
    seed: `pages-check-${playerCount}`,
    encounterCards,
    tiles,
    mapHexes,
    stewardRoles,
    setupStewardHousePlacement: false
  });
}

function assertSetupStillBuilds() {
  for (const [playerCountText, startingCount] of Object.entries(STARTING_WAREHOUSE_BY_PLAYER_COUNT)) {
    const playerCount = Number(playerCountText);
    const game = createGame(playerCount);
    const warehouseCounts = Object.values(game.warehouse.resources);

    assert(game.rules.totalRounds === 12, "Standard game should be 12 rounds.");
    assert(game.players.length === playerCount, `${playerCount}-player setup created the wrong player count.`);
    assert(
      warehouseCounts.every((count) => count === startingCount),
      `${playerCount}-player setup should start with ${startingCount} of each Warehouse resource.`
    );
    assert(
      game.players.every((player) => player.hand.length === game.rules.hiddenCardsPerPlayer),
      `${playerCount}-player setup did not deal the expected hidden hand size.`
    );
    assert(
      game.encounter.deck.length === game.rules.standardDeckCardsPerPlayer * playerCount,
      `${playerCount}-player setup did not create the expected Encounter Deck size.`
    );
  }
}

function assertWardenPowerWorks() {
  const burdenCard = encounterCards.find((card) => card.encounter_type === ENCOUNTER_TYPES.BURDEN);
  assert(burdenCard, "No Burden card found for Warden smoke check.");

  const baseGame = createGame(1, ["warden"]);
  const game = {
    ...baseGame,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...baseGame.encounter,
      active: [
        {
          id: "active-pages-check-burden",
          cardId: burdenCard.card_id,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          pendingChoice: { type: "pay_or_strain_choice" }
        }
      ]
    }
  };
  const outcome = dispatchGameAction(
    game,
    {
      type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
      stewardPowerType: STEWARD_POWER_TYPES.SUPPRESS_BURDEN,
      activeEncounterId: "active-pages-check-burden",
      placedTileId: "steward-power-P1-warden"
    },
    { tiles, encounterCards }
  );

  assert(outcome.result.ok, `Warden power smoke check failed: ${(outcome.result.errors ?? []).join("; ")}`);
  assert(!outcome.state.encounter.active[0].pendingChoice, "Warden power should clear pending Burden choices.");
  assert(outcome.state.encounter.active[0].suppressedByStewardPower, "Warden power should mark the Burden ignored this round.");
  assert(
    outcome.state.players[0].stewardPowerSeasons?.[STEWARD_POWER_TYPES.SUPPRESS_BURDEN]?.includes("I"),
    "Warden power should be marked used for the current Season."
  );
}

function assertQuartermasterSubstitutionWorks() {
  const baseGame = createGame(1, ["quartermaster"]);
  const game = {
    ...baseGame,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...baseGame.warehouse,
      resources: {
        ...baseGame.warehouse.resources,
        Wood: 0,
        Food: 15
      }
    }
  };
  const outcome = dispatchGameAction(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_bridge_basic",
      coordinate: "D1",
      stewardResourceSubstitutionPowerId: "steward-power-P1-quartermaster",
      stewardResourceSubstitutionResources: ["Wood", "Wood"],
      stewardResourceSubstitutionPayment: [{ resource: "Food", amount: 2 }]
    },
    { tiles, encounterCards }
  );

  assert(outcome.result.ok, `Quartermaster substitution smoke check failed: ${(outcome.result.errors ?? []).join("; ")}`);
  assert(
    outcome.result.stewardResourceSubstitution?.amountSubstituted === 2,
    "Quartermaster substitution should replace the chosen resources in the cost."
  );
  assert(outcome.state.warehouse.resources.Food === 13, "Quartermaster substitution should spend the replacement resources.");
  assert(
    outcome.state.players[0].stewardPowerSeasons?.[STEWARD_POWER_TYPES.RESOURCE_EXCHANGE]?.includes("I"),
    "Quartermaster substitution should be marked used for the current Season."
  );
}

for (const filePath of REQUIRED_STATIC_FILES) {
  assert(existsSync(filePath), `Missing static file for GitHub Pages package: ${filePath}`);
}

const mapHexes = normalizeMapSource(mapSource);
assertNoErrors("Source counts", validateSourceCounts({ encounterCards, tiles, mapHexes, riverRules }));
assertNoErrors("Promoted map", validateApprovedMap(mapHexes));

const coverage = createEncounterCoverageAudit(encounterCards, {
  tiles,
  resources: ["Wood", "Stone", "Metal", "Food", "Herbs", "Goods"]
});
assert(coverage.total === encounterCards.length, "Encounter coverage audit did not include every card.");
assert(
  coverage.statusCounts[ENCOUNTER_COVERAGE_STATUSES.UNSUPPORTED] === 0,
  "Encounter coverage has unsupported cards."
);

assertSetupStillBuilds();
assertWardenPowerWorks();
assertQuartermasterSubstitutionWorks();

console.log("Pages validation passed.");
