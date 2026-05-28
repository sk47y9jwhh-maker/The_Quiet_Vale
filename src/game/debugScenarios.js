import { dispatchGameAction } from "./reducer.js";
import { ENCOUNTER_TYPES, GAME_PHASES, createInitialGameState } from "./setup.js";
import { TILE_ACTION_TYPES } from "./tiles.js";

export const DEBUG_SCENARIO_DEFINITIONS = Object.freeze([
  {
    id: "travel-steward-marker",
    title: "Travel + Steward Marker",
    focus: "Disconnected travel",
    summary: "A connected settlement network exists, and Player 1's marker is on a disconnected Forest.",
    expected: [
      "Upgrade or activate the Forest at A13.",
      "Expected: it costs only the main tile action because the marker tile is a local travel anchor.",
      "Placing another tile away from both the connected settlement network and marker should still cost the extra Travel action."
    ]
  },
  {
    id: "arrival-completion",
    title: "Arrival Completion",
    focus: "Arrival reward",
    summary: "The Quiet Quest is active with enough Goods in the Warehouse.",
    expected: [
      "Complete The Quiet Quest from the Encounter panel.",
      "Expected: spend 1 Action and 4 Goods.",
      "Adventurers' Guild should unlock in the Special tile supply."
    ]
  },
  {
    id: "burden-resolution",
    title: "Burden Resolution",
    focus: "Active Burden",
    summary: "Blighted Lands is active, with a strained Farm and enough Herbs to resolve it.",
    expected: [
      "Resolve Blighted Lands from the Encounter panel.",
      "Expected: spend 1 Action and 2 Herbs.",
      "The Burden should leave the active area and move to completed/discard tracking."
    ]
  },
  {
    id: "boon-upgrade-discount",
    title: "Boon Upgrade Discount",
    focus: "Pending Boon",
    summary: "Raised in Good Season is face-up and a Gravel Path is ready to upgrade.",
    expected: [
      "Choose Stone in the upgrade discount control, then upgrade the Gravel Path at C1.",
      "Expected: the upgrade costs 1 fewer Stone and spends 1 Action.",
      "Raised in Good Season should then be discarded."
    ]
  },
  {
    id: "support-strain",
    title: "Supported Strain",
    focus: "Support timing",
    summary: "A Farm is manually Supported and has not used that Support this round.",
    expected: [
      "Apply Strain to the Farm at A5 once.",
      "Expected: Supported prevents the first Strain and marks Support as used.",
      "Apply Strain again in the same round; expected: the Farm takes 1 Strain."
    ]
  },
  {
    id: "golden-vial-travel",
    title: "Golden Vial Travel",
    focus: "Golden Boon",
    summary: "The Golden Vial is active and a disconnected Forest placement is selected.",
    expected: [
      "Place the Forest on A13.",
      "Expected: the first disconnected Travel action this round is waived, so placement costs 1 Action instead of 2.",
      "A second disconnected travel action in the same round should cost the extra Action again."
    ]
  }
]);

const SCENARIO_DEFINITIONS_BY_ID = new Map(DEBUG_SCENARIO_DEFINITIONS.map((scenario) => [scenario.id, scenario]));

function getScenarioDefinition(scenarioId) {
  const definition = SCENARIO_DEFINITIONS_BY_ID.get(scenarioId);

  if (!definition) {
    throw new Error(`Unknown debug scenario: ${scenarioId}`);
  }

  return definition;
}

function createContext(options) {
  return {
    tiles: options.tiles,
    encounterCards: options.encounterCards
  };
}

function createPlayerTurnsGame(options, seedSuffix) {
  const game = createInitialGameState({
    playerCount: 1,
    seed: `debug-${seedSuffix}`,
    encounterCards: options.encounterCards,
    tiles: options.tiles,
    mapHexes: options.mapHexes
  });

  return {
    ...game,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: game.players[0]?.id ?? null,
    players: game.players.map((player) => ({
      ...player,
      actionsRemaining: game.rules.actionsPerPlayer
    })),
    encounter: {
      ...game.encounter,
      active: [],
      discard: [],
      completed: [],
      roundEffects: [],
      seededRounds: [],
      revealedRounds: []
    }
  };
}

function dispatchOrThrow(game, action, context) {
  const outcome = dispatchGameAction(game, action, context);

  if (!outcome.result.ok) {
    throw new Error(outcome.result.errors?.join(" ") ?? outcome.result.message ?? `Scenario action failed: ${action.type}`);
  }

  return outcome.state;
}

function fillWarehouse(game, context) {
  return dispatchOrThrow(game, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }, context);
}

function resetActions(game, context) {
  return dispatchOrThrow(game, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }, context);
}

function appendScenarioLog(game, message, data = {}) {
  return {
    ...game,
    log: [
      ...game.log,
      {
        id: `log-${String(game.log.length + 1).padStart(3, "0")}`,
        round: game.round,
        season: game.season,
        type: "debug",
        message,
        data
      }
    ]
  };
}

function revealScenarioCards(game, cardIds, context) {
  const revealReadyGame = {
    ...game,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    activePlayerId: null,
    encounter: {
      ...game.encounter,
      deck: cardIds,
      discard: [],
      active: [],
      completed: [],
      roundEffects: [],
      revealedRounds: []
    }
  };

  return dispatchOrThrow(revealReadyGame, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }, context);
}

function withActiveArrival(game, cardId) {
  return appendScenarioLog(
    {
      ...game,
      encounter: {
        ...game.encounter,
        active: [
          {
            id: "scenario-arrival",
            cardId,
            encounterType: ENCOUNTER_TYPES.ARRIVAL,
            revealedRound: game.round,
            revealedSeason: game.season,
            resolved: false,
            completed: false,
            timerTokens: game.rules.arrivalStartTimerTokens
          }
        ]
      }
    },
    "Loaded debug Arrival scenario.",
    { cardId }
  );
}

function withActiveBurden(game, cardId) {
  return appendScenarioLog(
    {
      ...game,
      encounter: {
        ...game.encounter,
        active: [
          {
            id: "scenario-burden",
            cardId,
            encounterType: ENCOUNTER_TYPES.BURDEN,
            revealedRound: game.round,
            revealedSeason: game.season,
            resolved: false,
            appliedSeasons: [game.season],
            applications: []
          }
        ]
      }
    },
    "Loaded debug Burden scenario.",
    { cardId }
  );
}

function createScenarioResult(definition, game, overrides = {}) {
  return {
    id: definition.id,
    title: definition.title,
    focus: definition.focus,
    summary: definition.summary,
    expected: definition.expected,
    game,
    selectedCoordinate: overrides.selectedCoordinate ?? "C1",
    selectedTileId: overrides.selectedTileId ?? "core_gravel_path_basic",
    selectedOrientation: overrides.selectedOrientation ?? "rotation-0"
  };
}

function createTravelStewardScenario(options) {
  const definition = getScenarioDefinition("travel-steward-marker");
  const context = createContext(options);
  let game = createPlayerTurnsGame(options, definition.id);

  game = fillWarehouse(game, context);
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_gravel_path_basic",
      coordinate: "C1",
      orientation: "rotation-0"
    },
    context
  );
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_forest_basic",
      coordinate: "A13"
    },
    context
  );
  game = resetActions(game, context);

  return createScenarioResult(definition, game, {
    selectedCoordinate: "A13",
    selectedTileId: "core_forest_basic"
  });
}

function createArrivalCompletionScenario(options) {
  const definition = getScenarioDefinition("arrival-completion");
  const context = createContext(options);
  let game = createPlayerTurnsGame(options, definition.id);

  game = fillWarehouse(game, context);
  game = withActiveArrival(game, "arrival_the_quiet_quest");
  game = resetActions(game, context);

  return createScenarioResult(definition, game, {
    selectedCoordinate: "C1",
    selectedTileId: "core_gravel_path_basic"
  });
}

function createBurdenResolutionScenario(options) {
  const definition = getScenarioDefinition("burden-resolution");
  const context = createContext(options);
  let game = createPlayerTurnsGame(options, definition.id);

  game = fillWarehouse(game, context);
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_farm_basic",
      coordinate: "A5"
    },
    context
  );
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
      placedTileId: "tile-001",
      strain: 1
    },
    context
  );
  game = withActiveBurden(game, "burden_blighted_lands");
  game = resetActions(game, context);

  return createScenarioResult(definition, game, {
    selectedCoordinate: "A5",
    selectedTileId: "core_gravel_path_basic"
  });
}

function createBoonUpgradeDiscountScenario(options) {
  const definition = getScenarioDefinition("boon-upgrade-discount");
  const context = createContext(options);
  let game = createPlayerTurnsGame(options, definition.id);

  game = revealScenarioCards(game, ["boon_raised_in_good_season"], context);
  game = fillWarehouse(game, context);
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_gravel_path_basic",
      coordinate: "C1",
      orientation: "rotation-0"
    },
    context
  );
  game = resetActions(game, context);

  return createScenarioResult(definition, game, {
    selectedCoordinate: "C1",
    selectedTileId: "core_gravel_path_basic"
  });
}

function createSupportStrainScenario(options) {
  const definition = getScenarioDefinition("support-strain");
  const context = createContext(options);
  let game = createPlayerTurnsGame(options, definition.id);

  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_farm_basic",
      coordinate: "A5"
    },
    context
  );
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
      placedTileId: "tile-001",
      supported: true
    },
    context
  );
  game = resetActions(game, context);

  return createScenarioResult(definition, game, {
    selectedCoordinate: "A5",
    selectedTileId: "core_gravel_path_basic"
  });
}

function createGoldenVialTravelScenario(options) {
  const definition = getScenarioDefinition("golden-vial-travel");
  const context = createContext(options);
  let game = createPlayerTurnsGame(options, definition.id);

  game = revealScenarioCards(
    game,
    ["golden_boon_the_golden_vial", "boon_bounty_of_the_first_harvest"],
    context
  );
  game = fillWarehouse(game, context);
  game = dispatchOrThrow(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: "core_gravel_path_basic",
      coordinate: "C1",
      orientation: "rotation-0"
    },
    context
  );
  game = resetActions(game, context);

  return createScenarioResult(definition, game, {
    selectedCoordinate: "A13",
    selectedTileId: "core_forest_basic"
  });
}

const SCENARIO_BUILDERS = Object.freeze({
  "travel-steward-marker": createTravelStewardScenario,
  "arrival-completion": createArrivalCompletionScenario,
  "burden-resolution": createBurdenResolutionScenario,
  "boon-upgrade-discount": createBoonUpgradeDiscountScenario,
  "support-strain": createSupportStrainScenario,
  "golden-vial-travel": createGoldenVialTravelScenario
});

export function createDebugScenario(scenarioId, options) {
  const builder = SCENARIO_BUILDERS[scenarioId];

  if (!builder) {
    throw new Error(`Unknown debug scenario: ${scenarioId}`);
  }

  return builder(options);
}
