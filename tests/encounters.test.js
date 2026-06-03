import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchGameAction } from "../src/game/reducer.js";
import { ENCOUNTER_TYPES, GAME_PHASES, createInitialGameState } from "../src/game/setup.js";
import { TILE_ACTION_TYPES } from "../src/game/tiles.js";

const dataUrl = new URL("../src/data/", import.meta.url);

async function readJson(filename) {
  const contents = await readFile(new URL(filename, dataUrl), "utf8");
  return JSON.parse(contents);
}

const encounterCards = await readJson("encounter_cards.json");
const tiles = await readJson("tiles.json");
const mapHexes = await readJson("codex_default_map_v0_1.json");

function newState(playerCount = 2) {
  return createInitialGameState({
    playerCount,
    seed: `encounters-${playerCount}`,
    encounterCards,
    tiles,
    mapHexes
  });
}

function dispatch(state, action) {
  return dispatchGameAction(state, action, { tiles, encounterCards });
}

function withWarehouseResources(state, resources) {
  return {
    ...state,
    warehouse: {
      ...state.warehouse,
      resources: Object.fromEntries(state.rules.resources.map((resource) => [resource, resources[resource] ?? 0]))
    }
  };
}

function unlockSpecial(state, tileId) {
  return {
    ...state,
    tileSupply: {
      ...state.tileSupply,
      special: state.tileSupply.special.map((entry) =>
        entry.tileId === tileId
          ? {
              ...entry,
              locked: false,
              available: entry.stock
            }
          : entry
      )
    }
  };
}

function sharedHandsBurdenDiscount(overrides = {}) {
  return {
    id: "shared-hands-discount",
    source: "boon",
    type: "burden_resolution_discount",
    cardId: "boon_shared_hands_lighter_loads",
    cardName: "Shared Hands, Lighter Loads",
    round: 1,
    season: "I",
    effectText:
      "Keep this card face-up. The next time players resolve an active Burden, reduce its resource cost by 2 resources of your choice. Then discard this card.",
    amount: 2,
    maxUses: 1,
    uses: 0,
    expiresAtEndOfRound: false,
    discardOnReveal: false,
    discardAfterUse: true,
    ...overrides
  };
}

function optionalStrainReliefBoon({ effect: effectOverrides = {}, ...overrides } = {}) {
  return {
    id: "boon-active",
    cardId: "boon_the_settlement_of_plenty",
    encounterType: ENCOUNTER_TYPES.BOON,
    revealedRound: 6,
    revealedSeason: "II",
    resolved: false,
    pending: true,
    effect: {
      source: "boon",
      type: "optional_resource_strain_relief",
      cardId: "boon_the_settlement_of_plenty",
      cardName: "The settlement of plenty",
      round: 6,
      season: "II",
      effectText: "You may spend 4 Goods to remove up to 2 Strain from one tile",
      cost: [{ amount: 4, resource: "Goods" }],
      maxStrainRemoved: 2,
      maxTargets: 1,
      targetCategories: null,
      splitAcrossTargets: false,
      discardOnReveal: false,
      ...effectOverrides
    },
    ...overrides
  };
}

function optionalResourceExchangeBoon({ effect: effectOverrides = {}, ...overrides } = {}) {
  return {
    id: "boon-active",
    cardId: "boon_stores_made_ready",
    encounterType: ENCOUNTER_TYPES.BOON,
    revealedRound: 1,
    revealedSeason: "I",
    resolved: false,
    pending: true,
    effect: {
      source: "boon",
      type: "optional_resource_exchange",
      cardId: "boon_stores_made_ready",
      cardName: "Stores Made Ready",
      round: 1,
      season: "I",
      effectText: "Exchange up to 2 resources in the Warehouse for the same number of resources of any type.",
      maxAmount: 2,
      discardOnReveal: false,
      ...effectOverrides
    },
    ...overrides
  };
}

function firstCardIdOfType(encounterType) {
  return encounterCards.find((card) => card.encounter_type === encounterType).card_id;
}

test("seeding removes one hidden card per player and places seeded cards on top of the deck", () => {
  const state = newState(2);
  const firstPlayerCard = state.players[0].hand[0];
  const secondPlayerCard = state.players[1].hand[0];
  const originalDeckLength = state.encounter.deck.length;
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.seededCount, 2);
  assert.deepEqual(nextState.encounter.seededRounds, [1]);
  assert.equal(nextState.players[0].hand.length, 9);
  assert.equal(nextState.players[1].hand.length, 9);
  assert.equal(nextState.encounter.deck.length, originalDeckLength + 2);
  assert.deepEqual(nextState.encounter.deck.slice(0, 2), [secondPlayerCard, firstPlayerCard]);
  assert.equal(nextState.phase, GAME_PHASES.REVEAL_ENCOUNTERS);
});

test("debug seeding can choose a hand card and insert the packet in the middle of the deck", () => {
  const state = newState(1);
  const selectedCard = state.players[0].hand[3];
  const originalDeck = state.encounter.deck;
  const expectedIndex = Math.floor(originalDeck.length / 2);
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
    seedSelections: {
      P1: selectedCard
    },
    seedPosition: "middle"
  });

  assert.equal(result.ok, true);
  assert.equal(result.seedPosition, "middle");
  assert.equal(result.insertIndex, expectedIndex);
  assert.equal(nextState.encounter.deck[expectedIndex], selectedCard);
  assert.equal(nextState.players[0].hand.includes(selectedCard), false);
  assert.deepEqual(
    nextState.encounter.deck.filter((cardId) => cardId !== selectedCard),
    originalDeck
  );
});

test("debug seeding rejects a selected card outside the player's hand", () => {
  const state = newState(1);
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
    seedSelections: {
      P1: state.encounter.deck[0]
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /not in their hand/);
  assert.equal(nextState, state);
});

test("seeding can only happen once per round", () => {
  const state = dispatch(newState(1), { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS }).state;
  const result = dispatch(state, { type: TILE_ACTION_TYPES.SEED_ENCOUNTERS });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /already seeded/);
});

test("revealing draws standard cards equal to player count", () => {
  const boonId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const burdenId = firstCardIdOfType(ENCOUNTER_TYPES.BURDEN);
  const burdenCard = encounterCards.find((card) => card.card_id === burdenId);
  const state = {
    ...newState(2),
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...newState(2).encounter,
      deck: [boonId, burdenId],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.standardRevealed, 2);
  assert.equal(result.goldenRevealed, 0);
  assert.deepEqual(nextState.encounter.deck, []);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.active.length, 1);
  assert.equal(nextState.encounter.active[0].cardId, burdenId);
  assert.equal(nextState.encounter.active[0].encounterType, ENCOUNTER_TYPES.BURDEN);
  assert.deepEqual(nextState.encounter.active[0].appliedSeasons, ["I"]);
  assert.equal(nextState.encounter.active[0].applications[0].reason, "reveal");
  assert.equal(nextState.encounter.active[0].applications[0].effectText, burdenCard.season_i);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].cardId, boonId);
  assert.equal(nextState.encounter.roundEffects[0].type, "resource_production_bonus");
  assert.equal(nextState.encounter.roundEffects[0].sourceTileName, "Farm");
  assert.deepEqual(nextState.encounter.roundEffects[0].gains, [{ amount: 1, resource: "Food" }]);
  assert.equal(nextState.phase, GAME_PHASES.PLAYER_TURNS);
  assert.equal(nextState.activePlayerId, "P1");
});

test("Golden Boon reveal does not consume a standard reveal slot", () => {
  const goldenId = "golden_boon_the_golden_vial";
  const boonId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const arrivalId = firstCardIdOfType(ENCOUNTER_TYPES.ARRIVAL);
  const base = newState(2);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [goldenId, boonId, arrivalId],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.standardRevealed, 2);
  assert.equal(result.goldenRevealed, 1);
  assert.deepEqual(nextState.encounter.deck, []);
  assert.deepEqual(nextState.encounter.discard, [goldenId, boonId]);
  assert.equal(nextState.encounter.active.length, 1);
  assert.equal(nextState.encounter.active[0].cardId, arrivalId);
  assert.equal(nextState.encounter.active[0].timerTokens, 3);
});

test("The Golden Bell reveals an Arrival from the game box as an active Arrival", () => {
  const boonId = "golden_boon_the_golden_bell";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId, standardId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const effect = result.revealed[0].immediateEffect;
  const activeArrival = nextState.encounter.active.find(
    (activeState) => activeState.cardId === effect.revealedArrivalCardId
  );

  assert.equal(result.ok, true);
  assert.equal(result.goldenRevealed, 1);
  assert.equal(result.standardRevealed, 1);
  assert.equal(effect.type, "golden_bell_active_arrival_from_box");
  assert.equal(effect.chosenArrivalCardIds.length, 3);
  assert.equal(effect.returnedArrivalCardIds.length, 2);
  assert.equal(effect.chosenArrivalCardIds.includes(effect.revealedArrivalCardId), true);
  assert.equal(base.encounter.setup.selectedStandardPoolIds.includes(effect.revealedArrivalCardId), false);
  assert.ok(activeArrival);
  assert.equal(activeArrival.encounterType, ENCOUNTER_TYPES.ARRIVAL);
  assert.equal(activeArrival.timerTokens, 3);
  assert.deepEqual(nextState.encounter.discard, [boonId, standardId]);
});

test("The Golden Bell requires three Arrival Cards in the game box", () => {
  const boonId = "golden_boon_the_golden_bell";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const allArrivalCardIds = encounterCards
    .filter((card) => card.encounter_type === ENCOUNTER_TYPES.ARRIVAL)
    .map((card) => card.card_id);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId, standardId],
      discard: [],
      active: [],
      revealedRounds: [],
      setup: {
        ...base.encounter.setup,
        selectedStandardPoolIds: [...new Set([...base.encounter.setup.selectedStandardPoolIds, ...allArrivalCardIds])]
      }
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /needs 3 Arrival Cards in the game box/);
  assert.equal(nextState, state);
});

test("The Golden Scroll stays active for hand refresh choices", () => {
  const boonId = "golden_boon_the_golden_scroll";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId, standardId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const activeScroll = nextState.encounter.active.find((activeState) => activeState.cardId === boonId);

  assert.equal(result.ok, true);
  assert.equal(result.goldenRevealed, 1);
  assert.equal(result.standardRevealed, 1);
  assert.equal(result.revealed[0].immediateEffect.type, "golden_scroll_hand_refresh");
  assert.ok(activeScroll);
  assert.equal(activeScroll.encounterType, ENCOUNTER_TYPES.GOLDEN_BOON);
  assert.equal(activeScroll.pending, true);
  assert.equal(activeScroll.effect.type, "golden_scroll_hand_refresh");
  assert.deepEqual(nextState.encounter.discard, [standardId]);
});

test("resolving The Golden Scroll discards chosen hand cards and draws standards from the box", () => {
  const boonId = "golden_boon_the_golden_scroll";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const revealedState = dispatch(
    {
      ...base,
      phase: GAME_PHASES.REVEAL_ENCOUNTERS,
      encounter: {
        ...base.encounter,
        deck: [boonId, standardId],
        discard: [],
        active: [],
        roundEffects: [],
        revealedRounds: []
      }
    },
    { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }
  ).state;
  const activeScroll = revealedState.encounter.active.find((activeState) => activeState.cardId === boonId);
  const discardedCardIds = revealedState.players[0].hand.slice(0, 2);
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeScroll.id,
    discardSelections: {
      P1: discardedCardIds
    }
  });
  const drawnCards = result.drawnCardIds.map((cardId) => encounterCards.find((card) => card.card_id === cardId));

  assert.equal(result.ok, true);
  assert.equal(result.discardedCardIds.length, 2);
  assert.equal(result.drawnCardIds.length, 2);
  assert.equal(nextState.players[0].hand.length, revealedState.players[0].hand.length);
  assert.equal(nextState.players[0].hand.some((cardId) => discardedCardIds.includes(cardId)), false);
  assert.ok(result.drawnCardIds.every((cardId) => nextState.players[0].hand.includes(cardId)));
  assert.ok(drawnCards.every((card) => card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON));
  assert.equal(nextState.encounter.active.some((activeState) => activeState.id === activeScroll.id), false);
  assert.deepEqual(nextState.encounter.discard.slice(-3), [...discardedCardIds, boonId]);
});

test("The Golden Scroll draws as many replacement cards as the box has available", () => {
  const boonId = "golden_boon_the_golden_scroll";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const allStandardCardIds = encounterCards
    .filter((card) => card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON)
    .map((card) => card.card_id);
  const availableBoxCardId = allStandardCardIds.find(
    (cardId) => !base.players[0].hand.includes(cardId) && cardId !== standardId
  );
  const revealedState = dispatch(
    {
      ...base,
      phase: GAME_PHASES.REVEAL_ENCOUNTERS,
      encounter: {
        ...base.encounter,
        deck: [boonId, standardId],
        discard: [],
        active: [],
        roundEffects: [],
        revealedRounds: [],
        setup: {
          ...base.encounter.setup,
          selectedStandardPoolIds: allStandardCardIds.filter((cardId) => cardId !== availableBoxCardId)
        }
      }
    },
    { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }
  ).state;
  const activeScroll = revealedState.encounter.active.find((activeState) => activeState.cardId === boonId);
  const discardedCardIds = revealedState.players[0].hand.slice(0, 2);
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeScroll.id,
    discardSelections: {
      P1: discardedCardIds
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.drawnCardIds, [availableBoxCardId]);
  assert.equal(nextState.players[0].hand.length, revealedState.players[0].hand.length - 1);
  assert.equal(nextState.players[0].hand.includes(availableBoxCardId), true);
});

test("The Golden Scroll rejects cards outside the player's hand", () => {
  const boonId = "golden_boon_the_golden_scroll";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const revealedState = dispatch(
    {
      ...base,
      phase: GAME_PHASES.REVEAL_ENCOUNTERS,
      encounter: {
        ...base.encounter,
        deck: [boonId, standardId],
        discard: [],
        active: [],
        roundEffects: [],
        revealedRounds: []
      }
    },
    { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }
  ).state;
  const activeScroll = revealedState.encounter.active.find((activeState) => activeState.cardId === boonId);
  const notInHandCardId = encounterCards
    .filter((card) => card.encounter_type !== ENCOUNTER_TYPES.GOLDEN_BOON)
    .find((card) => !revealedState.players[0].hand.includes(card.card_id)).card_id;
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeScroll.id,
    discardSelections: {
      P1: [notInHandCardId]
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /not in their hand/);
  assert.equal(nextState, revealedState);
});

function revealGoldenSignetWithPlacedTiles(placedTiles) {
  const boonId = "golden_boon_the_golden_signet_ring";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = {
    ...newState(1),
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...newState(1).map,
      placedTiles
    },
    players: newState(1).players.map((player) =>
      player.id === "P1" && placedTiles[0]
        ? {
            ...player,
            lastInteraction: {
              type: "place",
              placedTileId: placedTiles[0].id,
              coordinate: placedTiles[0].coordinate,
              round: 1,
              season: "I"
            }
          }
        : player
    )
  };

  return dispatch(
    {
      ...base,
      encounter: {
        ...base.encounter,
        deck: [boonId, standardId],
        discard: [],
        active: [],
        roundEffects: [],
        revealedRounds: []
      }
    },
    { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }
  ).state;
}

test("The Golden Signet Ring stays active for tile relocation choices", () => {
  const boonId = "golden_boon_the_golden_signet_ring";
  const standardId = firstCardIdOfType(ENCOUNTER_TYPES.BOON);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId, standardId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const activeSignet = nextState.encounter.active.find((activeState) => activeState.cardId === boonId);

  assert.equal(result.ok, true);
  assert.equal(result.goldenRevealed, 1);
  assert.equal(result.revealed[0].immediateEffect.type, "golden_signet_ring_relocate_tiles");
  assert.ok(activeSignet);
  assert.equal(activeSignet.pending, true);
  assert.equal(activeSignet.effect.maxTiles, 5);
  assert.deepEqual(nextState.encounter.discard, [standardId]);
});

test("The Golden Signet Ring relocates a tile and keeps its state", () => {
  const revealedState = revealGoldenSignetWithPlacedTiles([
    {
      id: "tile-001",
      tileId: "core_forest_basic",
      coordinate: "A13",
      coordinates: ["A13"],
      orientation: "rotation-0",
      strain: 2,
      supported: true,
      supportedUsedThisRound: true,
      activatedEffectSeasons: ["I"]
    }
  ]);
  const activeSignet = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "golden_boon_the_golden_signet_ring"
  );
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeSignet.id,
    relocations: [
      {
        placedTileId: "tile-001",
        coordinate: "A14"
      }
    ]
  });
  const movedTile = nextState.map.placedTiles.find((placedTile) => placedTile.id === "tile-001");

  assert.equal(result.ok, true);
  assert.equal(result.moves.length, 1);
  assert.equal(movedTile.coordinate, "A14");
  assert.deepEqual(movedTile.coordinates, ["A14"]);
  assert.equal(movedTile.strain, 2);
  assert.equal(movedTile.supported, true);
  assert.equal(movedTile.supportedUsedThisRound, true);
  assert.deepEqual(movedTile.activatedEffectSeasons, ["I"]);
  assert.equal(nextState.players[0].lastInteraction.placedTileId, "tile-001");
  assert.equal(nextState.players[0].lastInteraction.coordinate, "A14");
  assert.equal(nextState.encounter.active.some((activeState) => activeState.id === activeSignet.id), false);
  assert.equal(nextState.encounter.discard.at(-1), "golden_boon_the_golden_signet_ring");
});

test("The Golden Signet Ring can swap chosen tiles through vacated spaces", () => {
  const revealedState = revealGoldenSignetWithPlacedTiles([
    {
      id: "tile-001",
      tileId: "core_cottage_basic",
      coordinate: "A3",
      coordinates: ["A3"],
      orientation: "rotation-0",
      strain: 0
    },
    {
      id: "tile-002",
      tileId: "core_cottage_basic",
      coordinate: "A4",
      coordinates: ["A4"],
      orientation: "rotation-0",
      strain: 1
    }
  ]);
  const activeSignet = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "golden_boon_the_golden_signet_ring"
  );
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeSignet.id,
    relocations: [
      { placedTileId: "tile-001", coordinate: "A4" },
      { placedTileId: "tile-002", coordinate: "A3" }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").coordinate, "A4");
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").coordinate, "A3");
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-002").strain, 1);
});

test("The Golden Signet Ring relocates multihex tiles with a legal new footprint", () => {
  const revealedState = revealGoldenSignetWithPlacedTiles([
    {
      id: "tile-001",
      tileId: "core_gravel_path_basic",
      coordinate: "A3",
      coordinates: ["A3", "A4"],
      orientation: "rotation-0",
      strain: 0
    }
  ]);
  const activeSignet = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "golden_boon_the_golden_signet_ring"
  );
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeSignet.id,
    relocations: [
      {
        placedTileId: "tile-001",
        coordinate: "C1",
        orientation: "rotation-0"
      }
    ]
  });
  const movedTile = nextState.map.placedTiles.find((placedTile) => placedTile.id === "tile-001");

  assert.equal(result.ok, true);
  assert.deepEqual(movedTile.coordinates, ["C1", "C2"]);
  assert.equal(movedTile.orientation, "rotation-0");
});

test("The Golden Signet Ring rejects moves onto unchosen occupied hexes", () => {
  const revealedState = revealGoldenSignetWithPlacedTiles([
    {
      id: "tile-001",
      tileId: "core_cottage_basic",
      coordinate: "A3",
      coordinates: ["A3"],
      orientation: "rotation-0",
      strain: 0
    },
    {
      id: "tile-002",
      tileId: "core_cottage_basic",
      coordinate: "A4",
      coordinates: ["A4"],
      orientation: "rotation-0",
      strain: 0
    }
  ]);
  const activeSignet = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "golden_boon_the_golden_signet_ring"
  );
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeSignet.id,
    relocations: [{ placedTileId: "tile-001", coordinate: "A4" }]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /A4 already has a placed tile/);
  assert.equal(nextState, revealedState);
});

test("The Golden Signet Ring keeps terrain restrictions", () => {
  const revealedState = revealGoldenSignetWithPlacedTiles([
    {
      id: "tile-001",
      tileId: "core_forest_basic",
      coordinate: "A13",
      coordinates: ["A13"],
      orientation: "rotation-0",
      strain: 0
    }
  ]);
  const activeSignet = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "golden_boon_the_golden_signet_ring"
  );
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeSignet.id,
    relocations: [{ placedTileId: "tile-001", coordinate: "A5" }]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /must be placed on Woodland/);
  assert.equal(nextState, revealedState);
});

test("The Golden Vial creates a rest-of-game disconnected Travel discount", () => {
  const boonId = "golden_boon_the_golden_vial";
  const arrivalId = firstCardIdOfType(ENCOUNTER_TYPES.ARRIVAL);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId, arrivalId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.goldenRevealed, 1);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].source, "golden_boon");
  assert.equal(nextState.encounter.roundEffects[0].type, "golden_vial_disconnected_travel");
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 1);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, false);
  assert.equal(nextState.encounter.roundEffects[0].resetUsesEachRound, true);
  assert.equal(result.revealed[0].roundEffect.type, "golden_vial_disconnected_travel");
});

test("The Golden Eyed Traveler creates an additional Player Turns phase effect", () => {
  const boonId = "golden_boon_the_golden_eyed_traveler";
  const arrivalId = firstCardIdOfType(ENCOUNTER_TYPES.ARRIVAL);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId, arrivalId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.goldenRevealed, 1);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].source, "golden_boon");
  assert.equal(nextState.encounter.roundEffects[0].type, "golden_eyed_traveler_extra_turns");
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 1);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, true);
  assert.equal(result.revealed[0].roundEffect.type, "golden_eyed_traveler_extra_turns");
});

test("revealing a resource Burden places its current Season Strain effect", () => {
  let state = {
    ...newState(1),
    round: 11,
    season: "III",
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A4"
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...state.encounter,
      deck: ["burden_blighted_lands"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const farm = nextState.map.placedTiles.find((tile) => tile.id === "tile-001");
  const cottage = nextState.map.placedTiles.find((tile) => tile.id === "tile-002");
  const application = nextState.encounter.active[0].applications[0];

  assert.equal(result.ok, true);
  assert.equal(farm.strain, 2);
  assert.equal(cottage.strain, 1);
  assert.equal(result.revealed[0].burdenEffect.type, "strain_placement");
  assert.equal(result.revealed[0].burdenEffect.primaryFamilyName, "Farm");
  assert.equal(result.revealed[0].burdenEffect.strainAdded, 3);
  assert.equal(application.effect.applications.length, 2);
  assert.deepEqual(
    application.effect.applications.map((entry) => ({
      placedTileId: entry.placedTileId,
      requestedStrain: entry.requestedStrain,
      strainAdded: entry.strainAdded,
      reason: entry.reason
    })),
    [
      {
        placedTileId: "tile-001",
        requestedStrain: 2,
        strainAdded: 2,
        reason: "primary"
      },
      {
        placedTileId: "tile-002",
        requestedStrain: 1,
        strainAdded: 1,
        reason: "adjacent"
      }
    ]
  );
});

test("category-adjacent Burdens place Strain on matching adjacent targets", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_workshops_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "A5", coordinates: ["A5"], strain: 0 },
        { id: "tile-004", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_smoke_over_hearths"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.equal(strainedTiles["tile-004"], 0);
  assert.equal(effect.mode, "adjacent_category");
  assert.equal(effect.targetCategory, "Housing");
  assert.equal(effect.relatedCategory, "Crafting");
  assert.equal(effect.strainAdded, 2);
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-001", "tile-003"]
  );
});

test("strained-neighbor Burdens require the adjacent category to have Strain", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_gravel_path_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 1 },
        { id: "tile-003", tileId: "core_gravel_path_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 },
        { id: "tile-004", tileId: "core_cottage_basic", coordinate: "B11", coordinates: ["B11"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_ill_omen_of_discontent"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(effect.mode, "adjacent_strained_category");
  assert.equal(effect.targetCategory, "Travel");
  assert.equal(effect.relatedCategory, "Housing");
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-001"]
  );
});

test("not-adjacent Burdens ignore targets beside the excluded category", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_gravel_path_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_gravel_path_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_roads_too_far_from_home"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 0);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.equal(effect.mode, "not_adjacent_category");
  assert.equal(effect.targetCategory, "Travel");
  assert.equal(effect.relatedCategory, "Housing");
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-003"]
  );
});

test("Coin Before Craft targets Merchant and Crafting tiles adjacent to each other", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_market_stalls_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_workshops_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_market_stalls_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 },
        { id: "tile-004", tileId: "core_workshops_basic", coordinate: "B11", coordinates: ["B11"], strain: 0 },
        { id: "tile-005", tileId: "core_market_stalls_basic", coordinate: "D1", coordinates: ["D1"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_coin_before_craft"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.equal(strainedTiles["tile-004"], 1);
  assert.equal(strainedTiles["tile-005"], 0);
  assert.equal(effect.mode, "other_category");
  assert.equal(effect.merchantMaxTargets, 2);
  assert.equal(effect.craftingMaxTargets, 2);
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-001", "tile-002", "tile-003", "tile-004"]
  );
});

test("Tools Left to Rust strains Crafting or Merchant tiles and loses Metal if able", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Metal: 2
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_workshops_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_market_stalls_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_tools_left_to_rust"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(nextState.warehouse.resources.Metal, 1);
  assert.equal(effect.mode, "category_choice");
  assert.deepEqual(effect.targetCategories, ["Crafting", "Merchant"]);
  assert.deepEqual(effect.resourceLosses, [
    {
      resource: "Metal",
      before: 2,
      after: 1,
      amountLost: 1,
      requestedAmount: 1
    }
  ]);
});

test("Foundations Remember War targets upgraded Core tiles and then adjacent placed tiles", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_home_upgraded", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_foundations_remember_war"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 2);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(effect.mode, "upgraded_core");
  assert.equal(effect.primaryAmount, 2);
  assert.deepEqual(
    effect.applications.map((application) => application.reason),
    ["upgraded_core", "adjacent"]
  );
});

test("Old Names, Old Debts targets tiles with Renown", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_tavern_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_market_stalls_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_old_names_old_debts"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(effect.mode, "renown");
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-001", "tile-002"]
  );
});

test("The Quiet Fractures spreads from a strained tile to one adjacent calm tile in Season II", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 1 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_quiet_fractures"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 2);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(effect.mode, "quiet_fractures_strained_tile");
  assert.equal(effect.hasAdjacentTarget, true);
  assert.deepEqual(
    effect.applications.map((application) => application.reason),
    ["quiet_fractures_strained", "quiet_fractures_adjacent_zero"]
  );
});

test("The Quiet Fractures spreads from an Overstrained tile in Season III", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 3 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "A2", coordinates: ["A2"], strain: 0 },
        { id: "tile-004", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_quiet_fractures"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 3);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.equal(strainedTiles["tile-004"], 0);
  assert.equal(effect.mode, "quiet_fractures_overstrained_spread");
  assert.equal(effect.sourcePlacedTileId, "tile-001");
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-002", "tile-003"]
  );
});

test("The Quiet Fractures Season III falls back to the Season II effect without Overstrained tiles", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 1 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_quiet_fractures"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 2);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(effect.mode, "quiet_fractures_fallback");
  assert.match(effect.fallbackEffectText, /Then choose 1 adjacent placed tile/);
  assert.deepEqual(
    effect.applications.map((application) => application.reason),
    ["quiet_fractures_strained", "quiet_fractures_adjacent_zero"]
  );
});

test("The Burden of Command strains each unique last-interacted tile", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    players: [
      {
        ...base.players[0],
        lastInteraction: { type: "place", placedTileId: "tile-001", coordinate: "A3", round: 1, season: "I" }
      },
      {
        id: "P2",
        name: "Player 2",
        actionsRemaining: base.rules.actionsPerPlayer,
        hand: [],
        lastInteraction: { type: "activate", placedTileId: "tile-001", coordinate: "A3", round: 1, season: "I" }
      },
      {
        id: "P3",
        name: "Player 3",
        actionsRemaining: base.rules.actionsPerPlayer,
        hand: [],
        lastInteraction: { type: "upgrade", placedTileId: "tile-002", coordinate: "A4", round: 1, season: "I" }
      }
    ],
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_forest_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 1 },
        { id: "tile-003", tileId: "core_mine_basic", coordinate: "A5", coordinates: ["A5"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_burden_of_command"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 2);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(effect.mode, "steward_token");
  assert.deepEqual(effect.stewardOccupiedPlacedTileIds, ["tile-001", "tile-002"]);
  assert.deepEqual(
    effect.applications.map((application) => application.reason),
    ["steward_token", "steward_token"]
  );
});

test("The Burden of Command Season III also strains one Steward House", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    players: [
      {
        ...base.players[0],
        lastInteraction: { type: "activate", placedTileId: "tile-003", coordinate: "A5", round: 11, season: "III" }
      }
    ],
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_vanguard_house_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_sentinel_house_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_forest_basic", coordinate: "A5", coordinates: ["A5"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_burden_of_command"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].burdenEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 0);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.equal(effect.hasStewardHouseTarget, true);
  assert.equal(effect.stewardHouseTargetPlacedTileId, "tile-001");
  assert.deepEqual(
    effect.applications.map((application) => [application.placedTileId, application.reason]),
    [
      ["tile-003", "steward_token"],
      ["tile-001", "steward_house"]
    ]
  );
});

test("Where Help Stands waits for resource choices when marked tiles are calm", () => {
  const base = withWarehouseResources(newState(2), {});
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    players: base.players.map((player, index) => ({
      ...player,
      lastInteraction: {
        type: "debug",
        placedTileId: index === 0 ? "tile-001" : "tile-002",
        coordinate: index === 0 ? "A3" : "A4",
        round: 1,
        season: "I"
      }
    })),
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_forest_basic", coordinate: "A3", coordinates: ["A3"], strain: 1 },
        { id: "tile-002", tileId: "core_cottage_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["boon_where_help_stands", "boon_shelter_holds"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const activeBoon = revealedState.encounter.active.find((activeState) => activeState.cardId === "boon_where_help_stands");

  assert.equal(result.ok, true);
  assert.equal(activeBoon.effect.type, "steward_help");
  assert.equal(activeBoon.effect.strainRemoved, 1);
  assert.equal(activeBoon.effect.resourceGainAmount, 1);
  assert.deepEqual(revealedState.encounter.discard, ["boon_shelter_holds"]);
  assert.equal(revealedState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 1);

  const { state: nextState, result: resolveResult } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: activeBoon.id,
    gains: [{ amount: 1, resource: "Herbs" }]
  });

  assert.equal(resolveResult.ok, true);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 0);
  assert.equal(nextState.warehouse.resources.Herbs, 1);
  assert.deepEqual(nextState.encounter.discard, ["boon_shelter_holds", "boon_where_help_stands"]);
  assert.equal(nextState.encounter.active.some((activeState) => activeState.id === activeBoon.id), false);
});

test("Where Help Stands resolves immediately when all marked tiles have Strain", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    players: [
      {
        ...base.players[0],
        lastInteraction: { type: "debug", placedTileId: "tile-001", coordinate: "A3", round: 1, season: "I" }
      }
    ],
    map: {
      ...base.map,
      placedTiles: [{ id: "tile-001", tileId: "core_forest_basic", coordinate: "A3", coordinates: ["A3"], strain: 1 }]
    },
    encounter: {
      ...base.encounter,
      deck: ["boon_where_help_stands"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.revealed[0].immediateEffect.type, "steward_help");
  assert.equal(nextState.map.placedTiles[0].strain, 0);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_where_help_stands"]);
});

test("Bare Walls stays active for a no-action pay-or-Strain reveal choice", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [{ id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 }]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_bare_walls"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState, result: revealResult } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(revealResult.ok, true);
  assert.equal(revealResult.revealed[0].burdenEffect.type, "pay_or_strain_choice");
  assert.equal(revealedState.map.placedTiles[0].strain, 0);
  assert.equal(revealedState.encounter.active[0].pendingChoice.type, "pay_or_strain_choice");
  assert.equal(revealedState.encounter.active[0].pendingChoice.decisionMode, "all_or_strain_all");
  assert.deepEqual(
    revealedState.encounter.active[0].pendingChoice.targets.map((target) => target.placedTileId),
    ["tile-001"]
  );

  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: revealedState.encounter.active[0].id,
    choice: { mode: "strain" }
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles[0].strain, 1);
  assert.equal(nextState.encounter.active[0].pendingChoice, null);
  assert.equal(nextState.players[0].actionsRemaining, 4);
  assert.equal(nextState.encounter.active[0].applications[0].effect.resolved, true);
  assert.equal(nextState.encounter.active[0].applications[0].effect.strainAdded, 1);
});

test("Too Many Houses, Too Little Homes supports mixed per-target pay-or-Strain choices", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 2,
        Goods: 2
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_terrace_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_neighborhood_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_too_many_houses_too_little_homes"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const activeEncounterId = revealedState.encounter.active[0].id;

  assert.equal(revealedState.encounter.active[0].pendingChoice.decisionMode, "per_target");

  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId,
    decisions: [
      { placedTileId: "tile-001", mode: "pay", resource: "Food" },
      { placedTileId: "tile-002", mode: "pay", resource: "Goods" },
      { placedTileId: "tile-003", mode: "strain" }
    ]
  });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Food, 1);
  assert.equal(nextState.warehouse.resources.Goods, 1);
  assert.equal(strainedTiles["tile-001"], 0);
  assert.equal(strainedTiles["tile-002"], 0);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.deepEqual(result.payment, [
    { resource: "Food", amount: 1 },
    { resource: "Goods", amount: 1 }
  ]);
});

test("Old Wounds Reopen bulk payment covers all chosen targets", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Herbs: 4
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_tavern_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_apothecary_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_old_wounds_reopen"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: revealedState.encounter.active[0].id,
    choice: { mode: "pay", resource: "Herbs" }
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Herbs, 0);
  assert.deepEqual(nextState.map.placedTiles.map((tile) => tile.strain), [0, 0]);
  assert.deepEqual(result.payment, [{ resource: "Herbs", amount: 4 }]);
});

test("Over Promising to Over Compensate supports mixed active Arrival pay-or-timer choices", () => {
  const base = newState(1);
  const [firstArrivalId, secondArrivalId] = encounterCards
    .filter((card) => card.encounter_type === ENCOUNTER_TYPES.ARRIVAL)
    .map((card) => card.card_id);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Goods: 1
      }
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_over_promising_to_over_compensate"],
      discard: [],
      active: [
        {
          id: "arrival-first",
          cardId: firstArrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 5,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 2
        },
        {
          id: "arrival-second",
          cardId: secondArrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 5,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 1
        }
      ],
      revealedRounds: []
    }
  };
  const { state: revealedState, result: revealResult } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const activeEncounterId = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "burden_over_promising_to_over_compensate"
  ).id;

  assert.equal(revealResult.ok, true);
  assert.equal(revealResult.revealed[0].burdenEffect.type, "arrival_pay_or_timer_choice");
  assert.equal(revealedState.encounter.active.find((arrival) => arrival.id === "arrival-first").timerTokens, 2);
  assert.equal(revealedState.encounter.active.find((arrival) => arrival.id === "arrival-second").timerTokens, 1);

  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId,
    decisions: [
      { activeEncounterId: "arrival-first", mode: "pay", resource: "Goods" },
      { activeEncounterId: "arrival-second", mode: "timer" }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Goods, 0);
  assert.equal(nextState.encounter.active.find((arrival) => arrival.id === "arrival-first").timerTokens, 2);
  assert.equal(nextState.encounter.active.find((arrival) => arrival.id === "arrival-second").timerTokens, 0);
  assert.equal(nextState.encounter.active.find((activeState) => activeState.id === activeEncounterId).pendingChoice, null);
  assert.equal(nextState.players[0].actionsRemaining, 4);
  assert.deepEqual(result.payment, [{ resource: "Goods", amount: 1 }]);
  assert.equal(result.effect.timerTokensRemoved, 1);
});

test("The Welcome Wears Thin has no reveal choice when there are no active Arrivals", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["burden_the_welcome_wears_thin"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(result.revealed[0].burdenEffect.type, "arrival_pay_or_timer_choice");
  assert.equal(result.revealed[0].burdenEffect.targets.length, 0);
  assert.equal(nextState.encounter.active[0].cardId, "burden_the_welcome_wears_thin");
  assert.equal(nextState.encounter.active[0].pendingChoice, null);
});

test("The Welcome Wears Thin rejects timer payment choices without enough Herbs", () => {
  const base = withWarehouseResources(newState(1), {});
  const arrivalId = firstCardIdOfType(ENCOUNTER_TYPES.ARRIVAL);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["burden_the_welcome_wears_thin"],
      discard: [],
      active: [
        {
          id: "arrival-active",
          cardId: arrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 2
        }
      ],
      revealedRounds: []
    }
  };
  const { state: revealedState } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const activeEncounterId = revealedState.encounter.active.find(
    (activeState) => activeState.cardId === "burden_the_welcome_wears_thin"
  ).id;
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId,
    choice: { mode: "pay", resource: "Herbs" }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /1 Herbs/);
  assert.equal(nextState.encounter.active.find((arrival) => arrival.id === "arrival-active").timerTokens, 2);
});

test("The Storehouses Disagree can lose a chosen non-Goods resource", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Metal: 5
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_farm_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_mine_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_storehouses_disagree"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState, result: revealResult } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(revealResult.ok, true);
  assert.equal(revealResult.revealed[0].burdenEffect.type, "resource_loss_or_strain_choice");
  assert.deepEqual(
    revealResult.revealed[0].burdenEffect.paymentOptions.map((option) => option.resource),
    ["Wood", "Stone", "Metal", "Food", "Herbs"]
  );

  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: revealedState.encounter.active[0].id,
    choice: { mode: "pay", resource: "Metal" }
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Metal, 0);
  assert.deepEqual(nextState.map.placedTiles.map((tile) => tile.strain), [0, 0]);
  assert.deepEqual(result.payment, [{ resource: "Metal", amount: 5 }]);
});

test("The Storehouses Disagree can strain Resource tiles instead of losing resources", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_farm_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_mine_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_cottage_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_the_storehouses_disagree"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: revealedState.encounter.active[0].id,
    choice: { mode: "strain" }
  });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 0);
  assert.equal(result.effect.strainAdded, 2);
});

test("Stores Run Thin loses the current most-stocked Warehouse resource", () => {
  const base = withWarehouseResources(newState(1), { Wood: 4, Food: 2 });
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [{ id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 }]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_stores_run_thin"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState, result: revealResult } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(revealResult.ok, true);
  assert.deepEqual(revealResult.revealed[0].burdenEffect.paymentOptions, [{ amount: 4, resource: "Wood" }]);

  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: revealedState.encounter.active[0].id,
    choice: { mode: "pay", resource: "Wood" }
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.map.placedTiles[0].strain, 0);
});

test("Stores Run Thin can strain placed tiles instead of losing a resource", () => {
  const base = newState(1);
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    map: {
      ...base.map,
      placedTiles: [
        { id: "tile-001", tileId: "core_cottage_basic", coordinate: "A3", coordinates: ["A3"], strain: 0 },
        { id: "tile-002", tileId: "core_tavern_basic", coordinate: "A4", coordinates: ["A4"], strain: 0 },
        { id: "tile-003", tileId: "core_farm_basic", coordinate: "B10", coordinates: ["B10"], strain: 0 }
      ]
    },
    encounter: {
      ...base.encounter,
      deck: ["burden_stores_run_thin"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: revealedState } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const { state: nextState, result } = dispatch(revealedState, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
    activeEncounterId: revealedState.encounter.active[0].id,
    choice: { mode: "strain" }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.map.placedTiles.map((tile) => tile.strain), [1, 1, 1]);
  assert.equal(result.effect.strainAdded, 3);
});

test("A Little More Time adds one timer token to an active Arrival in Season I", () => {
  const base = newState(1);
  const arrivalId = firstCardIdOfType(ENCOUNTER_TYPES.ARRIVAL);
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["boon_a_little_more_time"],
      discard: [],
      active: [
        {
          id: "arrival-active",
          cardId: arrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 2
        }
      ],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(nextState.encounter.active[0].timerTokens, 3);
  assert.deepEqual(nextState.encounter.discard, ["boon_a_little_more_time"]);
  assert.equal(result.revealed[0].immediateEffect.type, "arrival_timer_tokens");
  assert.equal(result.revealed[0].immediateEffect.tokensAdded, 1);
  assert.deepEqual(result.revealed[0].immediateEffect.applications, [
    {
      activeEncounterId: "arrival-active",
      cardId: arrivalId,
      before: 2,
      after: 3,
      tokensAdded: 1
    }
  ]);
});

test("A Little More Time divides Season II timer tokens across active Arrivals", () => {
  const base = newState(1);
  const [firstArrivalId, secondArrivalId] = encounterCards
    .filter((card) => card.encounter_type === ENCOUNTER_TYPES.ARRIVAL)
    .map((card) => card.card_id);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["boon_a_little_more_time"],
      discard: [],
      active: [
        {
          id: "arrival-first",
          cardId: firstArrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 5,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 1
        },
        {
          id: "arrival-second",
          cardId: secondArrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 5,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 2
        }
      ],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.equal(nextState.encounter.active.find((arrival) => arrival.id === "arrival-first").timerTokens, 2);
  assert.equal(nextState.encounter.active.find((arrival) => arrival.id === "arrival-second").timerTokens, 3);
  assert.equal(result.revealed[0].immediateEffect.amount, 2);
  assert.equal(result.revealed[0].immediateEffect.tokensAdded, 2);
  assert.equal(result.revealed[0].immediateEffect.applications.length, 2);
});

test("A Welcome Well Met stays visible as a pending Arrival requirement discount", () => {
  const base = newState(1);
  const boonId = "boon_a_welcome_well_met";
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, []);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "arrival_requirement_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 1);
  assert.equal(nextState.encounter.roundEffects[0].discardOnReveal, false);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, false);
});

test("Raised in Good Season stays visible as a pending Core upgrade discount", () => {
  const base = newState(1);
  const boonId = "boon_raised_in_good_season";
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, []);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "core_upgrade_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 1);
  assert.equal(nextState.encounter.roundEffects[0].discardOnReveal, false);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, false);
});

test("Shared Hands, Lighter Loads stays visible as a pending Burden resolution discount", () => {
  const base = newState(1);
  const boonId = "boon_shared_hands_lighter_loads";
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, []);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "burden_resolution_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 2);
  assert.equal(nextState.encounter.roundEffects[0].discardOnReveal, false);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, false);
});

test("Old foundations still remain creates a Housing placement Wood or Stone discount", () => {
  const base = newState(1);
  const boonId = "boon_old_foundations_still_remain";
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "placement_resource_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 4);
  assert.deepEqual(nextState.encounter.roundEffects[0].targetCategories, ["Housing"]);
  assert.deepEqual(nextState.encounter.roundEffects[0].allowedResources, ["Wood", "Stone"]);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, true);
});

test("Feuds soften creates a Housing placement-or-upgrade discount", () => {
  const base = newState(1);
  const boonId = "boon_feuds_soften_as_warm_hearths_green_heaths_and_safe_havens_are_found";
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "tile_resource_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 2);
  assert.deepEqual(nextState.encounter.roundEffects[0].targetCategories, ["Housing"]);
  assert.deepEqual(nextState.encounter.roundEffects[0].appliesTo, ["placement", "upgrade"]);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, true);
});

test("Many hands make light work creates a two-use any-placement discount in Season II", () => {
  const base = newState(1);
  const boonId = "boon_many_hands_make_light_work";
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "tile_resource_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 1);
  assert.equal(nextState.encounter.roundEffects[0].targetCategories, null);
  assert.deepEqual(nextState.encounter.roundEffects[0].appliesTo, ["placement"]);
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 2);
});

test("Many hands make light work creates a placed-or-upgraded discount in Season III", () => {
  const base = newState(1);
  const boonId = "boon_many_hands_make_light_work";
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects[0].type, "tile_resource_discount");
  assert.equal(nextState.encounter.roundEffects[0].amount, 2);
  assert.equal(nextState.encounter.roundEffects[0].targetCategories, null);
  assert.deepEqual(nextState.encounter.roundEffects[0].appliesTo, ["placement", "upgrade"]);
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 2);
});

test("When the roads filled once more creates a placement-only Travel action discount in Season I", () => {
  const base = newState(1);
  const boonId = "boon_when_the_roads_filled_once_more";
  const state = {
    ...base,
    round: 1,
    season: "I",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "tile_action_discount");
  assert.deepEqual(nextState.encounter.roundEffects[0].targetCategories, ["Travel"]);
  assert.deepEqual(nextState.encounter.roundEffects[0].appliesTo, ["placement"]);
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 1);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, true);
});

test("When the roads filled once more creates a two-use Travel place-or-upgrade action discount in Season III", () => {
  const base = newState(1);
  const boonId = "boon_when_the_roads_filled_once_more";
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects[0].type, "tile_action_discount");
  assert.deepEqual(nextState.encounter.roundEffects[0].targetCategories, ["Travel"]);
  assert.deepEqual(nextState.encounter.roundEffects[0].appliesTo, ["placement", "upgrade"]);
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 2);
});

test("The Apprentice Steward creates a one-use placement action discount round effect", () => {
  const base = newState(1);
  const boonId = "boon_the_apprentice_steward";
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, [boonId]);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].type, "tile_action_discount");
  assert.deepEqual(nextState.encounter.roundEffects[0].targetCategories, ["Resource", "Housing"]);
  assert.deepEqual(nextState.encounter.roundEffects[0].appliesTo, ["placement"]);
  assert.equal(nextState.encounter.roundEffects[0].maxUses, 1);
  assert.equal(nextState.encounter.roundEffects[0].expiresAtEndOfRound, true);
});

test("deck-peek Boons expose the top Encounter cards and preserve order for now", () => {
  const base = newState(1);
  const [firstBurdenId, secondBurdenId] = encounterCards
    .filter((card) => card.encounter_type === ENCOUNTER_TYPES.BURDEN)
    .map((card) => card.card_id);
  const arrivalId = firstCardIdOfType(ENCOUNTER_TYPES.ARRIVAL);
  const remainingDeck = [firstBurdenId, arrivalId, secondBurdenId];
  const state = {
    ...base,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["boon_what_is_written_in_the_stars_can_finally_be_heeded", ...remainingDeck],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.deck, remainingDeck);
  assert.equal(result.revealed[0].immediateEffect.type, "encounter_deck_peek");
  assert.deepEqual(result.revealed[0].immediateEffect.peekedCardIds, remainingDeck);
  assert.deepEqual(result.revealed[0].immediateEffect.orderedCardIds, remainingDeck);
  assert.equal(result.revealed[0].immediateEffect.canReorder, false);
  assert.equal(result.revealed[0].immediateEffect.deterministicOrder, "same_order");
});

test("any-order deck-peek Boons are preserved in same order until reorder UI exists", () => {
  const base = newState(1);
  const [firstBurdenId, secondBurdenId, thirdBurdenId] = encounterCards
    .filter((card) => card.encounter_type === ENCOUNTER_TYPES.BURDEN)
    .map((card) => card.card_id);
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: ["boon_clear_nights_make_for_clear_plans", firstBurdenId, secondBurdenId, thirdBurdenId],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.deck, [firstBurdenId, secondBurdenId, thirdBurdenId]);
  assert.equal(result.revealed[0].immediateEffect.type, "encounter_deck_peek");
  assert.equal(result.revealed[0].immediateEffect.count, 3);
  assert.equal(result.revealed[0].immediateEffect.canReorder, true);
  assert.equal(result.revealed[0].immediateEffect.bottomPlacedOnTop, false);
});

test("Shelter Holds removes 1 Strain from a manually Supported tile in Season I", () => {
  let state = {
    ...newState(1),
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
    placedTileId: "tile-001",
    supported: true
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 2
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...state.encounter,
      deck: ["boon_shelter_holds"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const tile = nextState.map.placedTiles.find((placedTile) => placedTile.id === "tile-001");
  const effect = result.revealed[0].immediateEffect;

  assert.equal(result.ok, true);
  assert.equal(tile.strain, 1);
  assert.equal(effect.type, "supported_strain_relief");
  assert.equal(effect.maxTargets, 1);
  assert.equal(effect.strainRemoved, 1);
  assert.deepEqual(effect.applications, [
    {
      placedTileId: "tile-001",
      tileId: "core_cottage_basic",
      tileName: "Cottage",
      before: 2,
      after: 1,
      strainRemoved: 1,
      reason: "supported"
    }
  ]);
});

test("Shelter Holds counts passive Supported providers and ignores unsupported strained tiles", () => {
  let state = unlockSpecial(
    {
      ...newState(1),
      round: 6,
      season: "II",
      phase: GAME_PHASES.PLAYER_TURNS,
      activePlayerId: "P1"
    },
    "special_theater"
  );
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_forest_basic",
    coordinate: "A13"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A11"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_theater",
    coordinate: "A12"
  }).state;
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "B10"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-004",
    strain: 1
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...state.encounter,
      deck: ["boon_shelter_holds"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].immediateEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 0);
  assert.equal(strainedTiles["tile-002"], 0);
  assert.equal(strainedTiles["tile-004"], 1);
  assert.equal(effect.type, "supported_strain_relief");
  assert.equal(effect.maxTargets, 2);
  assert.equal(effect.strainRemoved, 2);
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-001", "tile-002"]
  );
});

test("From the Brink removes up to 2 Strain from Overstrained tiles before using its fallback", () => {
  let state = {
    ...newState(1),
    round: 11,
    season: "III",
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "B10"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 3
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 2
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...state.encounter,
      deck: ["boon_from_the_brink"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].immediateEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 1);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 2);
  assert.equal(effect.type, "from_the_brink_strain_relief");
  assert.equal(effect.mode, "overstrained");
  assert.equal(effect.usedFallback, false);
  assert.equal(effect.overstrainedMaxTargets, 2);
  assert.equal(effect.strainRemoved, 4);
  assert.deepEqual(
    effect.applications.map((application) => ({
      placedTileId: application.placedTileId,
      before: application.before,
      after: application.after,
      strainRemoved: application.strainRemoved,
      reason: application.reason
    })),
    [
      {
        placedTileId: "tile-001",
        before: 3,
        after: 1,
        strainRemoved: 2,
        reason: "overstrained"
      },
      {
        placedTileId: "tile-002",
        before: 3,
        after: 1,
        strainRemoved: 2,
        reason: "overstrained"
      }
    ]
  );
});

test("From the Brink removes 1 Strain from placed tiles when no Overstrained tile can be repaired", () => {
  let state = {
    ...newState(1),
    round: 6,
    season: "II",
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  };
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "B10"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 1
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 2
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-003",
    strain: 1
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...state.encounter,
      deck: ["boon_from_the_brink"],
      discard: [],
      active: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });
  const strainedTiles = Object.fromEntries(nextState.map.placedTiles.map((tile) => [tile.id, tile.strain]));
  const effect = result.revealed[0].immediateEffect;

  assert.equal(result.ok, true);
  assert.equal(strainedTiles["tile-001"], 0);
  assert.equal(strainedTiles["tile-002"], 1);
  assert.equal(strainedTiles["tile-003"], 1);
  assert.equal(effect.type, "from_the_brink_strain_relief");
  assert.equal(effect.mode, "fallback");
  assert.equal(effect.usedFallback, true);
  assert.equal(effect.overstrainedMaxTargets, 1);
  assert.equal(effect.fallbackMaxTargets, 2);
  assert.equal(effect.strainRemoved, 2);
  assert.deepEqual(
    effect.applications.map((application) => application.placedTileId),
    ["tile-001", "tile-002"]
  );
  assert.deepEqual(
    effect.applications.map((application) => application.reason),
    ["fallback", "fallback"]
  );
});

test("optional resource Strain relief Boons stay active for player choice", () => {
  const base = newState(1);
  const boonId = "boon_the_settlement_of_plenty";
  const state = {
    ...base,
    round: 6,
    season: "II",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, []);
  assert.equal(nextState.encounter.active.length, 1);
  assert.equal(nextState.encounter.active[0].cardId, boonId);
  assert.equal(nextState.encounter.active[0].encounterType, ENCOUNTER_TYPES.BOON);
  assert.equal(nextState.encounter.active[0].effect.type, "optional_resource_strain_relief");
  assert.deepEqual(nextState.encounter.active[0].effect.cost, [{ amount: 4, resource: "Goods" }]);
  assert.equal(nextState.encounter.active[0].effect.maxStrainRemoved, 2);
  assert.equal(nextState.encounter.active[0].effect.maxTargets, 1);
});

test("resolving an optional resource Strain relief Boon spends resources and removes Strain", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Goods: 4
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_cottage_basic",
          coordinate: "A3",
          coordinates: ["A3"],
          strain: 2
        }
      ]
    },
    encounter: {
      ...base.encounter,
      active: [optionalStrainReliefBoon()],
      discard: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: "boon-active",
    targetPlacedTileIds: ["tile-001"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.strainRemoved, 2);
  assert.equal(nextState.map.placedTiles[0].strain, 0);
  assert.equal(nextState.warehouse.resources.Goods, 0);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_the_settlement_of_plenty"]);
  assert.equal(nextState.players[0].actionsRemaining, base.rules.actionsPerPlayer);
});

test("optional Metal Strain relief only targets Travel or Housing when listed", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Metal: 5
      }
    },
    map: {
      ...base.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_farm_basic",
          coordinate: "A3",
          coordinates: ["A3"],
          strain: 1
        }
      ]
    },
    encounter: {
      ...base.encounter,
      active: [
        optionalStrainReliefBoon({
          cardId: "boon_a_light_on_the_long_dark_lanterns_illuminated_the_way_to_a_safer_day",
          effect: {
            cardId: "boon_a_light_on_the_long_dark_lanterns_illuminated_the_way_to_a_safer_day",
            cardName: "A light on the long dark. Lanterns illuminated the way to a safer day",
            effectText: "You may spend 5 Metal to remove up to 2 Strain from one Travel or Housing tile",
            cost: [{ amount: 5, resource: "Metal" }],
            maxStrainRemoved: 2,
            targetCategories: ["Travel", "Housing"]
          }
        })
      ],
      discard: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: "boon-active",
    targetPlacedTileIds: ["tile-001"]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /Travel or Housing/);
  assert.equal(nextState, state);
});

test("optional resource Strain relief Boons can be skipped without spending resources", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Goods: 4
      }
    },
    encounter: {
      ...base.encounter,
      active: [optionalStrainReliefBoon()],
      discard: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: "boon-active",
    skip: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(nextState.warehouse.resources.Goods, 4);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_the_settlement_of_plenty"]);
});

test("Stores Made Ready stays active for player exchange choices", () => {
  const base = newState(1);
  const boonId = "boon_stores_made_ready";
  const state = {
    ...base,
    round: 11,
    season: "III",
    phase: GAME_PHASES.REVEAL_ENCOUNTERS,
    encounter: {
      ...base.encounter,
      deck: [boonId],
      discard: [],
      active: [],
      roundEffects: [],
      revealedRounds: []
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.ok, true);
  assert.deepEqual(nextState.encounter.discard, []);
  assert.equal(nextState.encounter.active.length, 1);
  assert.equal(nextState.encounter.active[0].cardId, boonId);
  assert.equal(nextState.encounter.active[0].encounterType, ENCOUNTER_TYPES.BOON);
  assert.equal(nextState.encounter.active[0].effect.type, "optional_resource_exchange");
  assert.equal(nextState.encounter.active[0].effect.maxAmount, 6);
});

test("resolving Stores Made Ready exchanges Warehouse resources without spending an Action", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 1,
        Wood: 1,
        Goods: 0,
        Stone: 0
      }
    },
    encounter: {
      ...base.encounter,
      active: [optionalResourceExchangeBoon()],
      discard: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: "boon-active",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Wood", amount: 1 }
    ],
    gains: [
      { resource: "Goods", amount: 1 },
      { resource: "Stone", amount: 1 }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.payment, [
    { resource: "Food", amount: 1 },
    { resource: "Wood", amount: 1 }
  ]);
  assert.deepEqual(result.gains, [
    { resource: "Goods", amount: 1 },
    { resource: "Stone", amount: 1 }
  ]);
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Goods, 1);
  assert.equal(nextState.warehouse.resources.Stone, 1);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_stores_made_ready"]);
  assert.equal(nextState.players[0].actionsRemaining, base.rules.actionsPerPlayer);
});

test("Stores Made Ready rejects exchanges above the Season maximum", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 3
      }
    },
    encounter: {
      ...base.encounter,
      active: [optionalResourceExchangeBoon()],
      discard: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BOON,
    activeEncounterId: "boon-active",
    payment: [{ resource: "Food", amount: 3 }],
    gains: [{ resource: "Goods", amount: 3 }]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /1-2 resources/);
  assert.equal(nextState, state);
});

test("end-of-round clears revealed Boon round effects", () => {
  const base = newState(1);
  const revealed = dispatch(
    {
      ...base,
      phase: GAME_PHASES.REVEAL_ENCOUNTERS,
      encounter: {
        ...base.encounter,
        deck: ["boon_bounty_of_the_first_harvest"],
        discard: [],
        active: [],
        roundEffects: [],
        revealedRounds: []
      }
    },
    { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }
  ).state;
  const state = {
    ...revealed,
    phase: GAME_PHASES.END_ROUND
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(state.encounter.roundEffects.length, 1);
  assert.deepEqual(nextState.encounter.roundEffects, []);
});

test("end-of-round keeps pending next-action Boon effects visible", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    encounter: {
      ...base.encounter,
      roundEffects: [
        {
          id: "discount-1",
          source: "boon",
          type: "arrival_requirement_discount",
          cardId: "boon_a_welcome_well_met",
          cardName: "A Welcome Well Met",
          round: 1,
          season: "I",
          effectText:
            "Keep this card face-up. The next time players complete an Arrival, reduce its resource Requirement by 1 resource of your choice. Then discard this card.",
          amount: 1,
          maxUses: 1,
          uses: 0,
          expiresAtEndOfRound: false,
          discardOnReveal: false,
          discardAfterUse: true
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(nextState.round, 2);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].id, "discount-1");
});

test("end-of-round resets The Golden Vial once-per-round use", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    encounter: {
      ...base.encounter,
      roundEffects: [
        {
          id: "golden-vial",
          source: "golden_boon",
          type: "golden_vial_disconnected_travel",
          cardId: "golden_boon_the_golden_vial",
          cardName: "The Golden Vial",
          round: 1,
          season: "I",
          effectText: "Once per round, disconnected Travel costs 0 Actions.",
          maxUses: 1,
          uses: 1,
          expiresAtEndOfRound: false,
          resetUsesEachRound: true
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(nextState.round, 2);
  assert.equal(nextState.encounter.roundEffects.length, 1);
  assert.equal(nextState.encounter.roundEffects[0].uses, 0);
});

test("revealing can only happen once per round", () => {
  const base = {
    ...newState(1),
    phase: GAME_PHASES.REVEAL_ENCOUNTERS
  };
  const state = dispatch(base, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS }).state;
  const result = dispatch(state, { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /already revealed/);
});

test("revealing is blocked before the Reveal Encounters phase", () => {
  const result = dispatch(newState(1), { type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS });

  assert.equal(result.result.ok, false);
  assert.match(result.result.errors.join(" "), /Reveal Encounters phase/);
});

test("end-of-round removes Arrival timers and expires failed Arrivals", () => {
  const [arrivalId, expiringArrivalId] = encounterCards
    .filter((card) => card.encounter_type === ENCOUNTER_TYPES.ARRIVAL)
    .map((card) => card.card_id);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    round: 3,
    encounter: {
      ...base.encounter,
      discard: [],
      active: [
        {
          id: "arrival-active",
          cardId: arrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 2,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 2
        },
        {
          id: "arrival-expiring",
          cardId: expiringArrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 2,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 1
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.ok, true);
  assert.equal(result.timersRemoved, 2);
  assert.equal(result.expiredArrivals.length, 1);
  assert.equal(nextState.phase, GAME_PHASES.SEED_ENCOUNTERS);
  assert.equal(nextState.round, 4);
  assert.deepEqual(nextState.encounter.discard, [expiringArrivalId]);
  assert.equal(nextState.encounter.active.length, 1);
  assert.equal(nextState.encounter.active[0].cardId, arrivalId);
  assert.equal(nextState.encounter.active[0].timerTokens, 1);
});

test("completing an Arrival spends 1 Action, moves it to completed, and unlocks its Special Tile", () => {
  const base = newState(1);
  const arrivalId = "arrival_remnants_of_the_fleet";
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Wood: 2,
        Herbs: 4,
        Goods: 2
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "arrival-active",
          cardId: arrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 3
        }
      ],
      completed: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: "arrival-active"
  });
  const docks = nextState.tileSupply.special.find((entry) => entry.tileId === "special_docks");

  assert.equal(result.ok, true);
  assert.equal(result.unlockedTileIds.includes("special_docks"), true);
  assert.deepEqual(result.requirementCost, [
    { amount: 2, resource: "Wood" },
    { amount: 4, resource: "Herbs" },
    { amount: 2, resource: "Goods" }
  ]);
  assert.equal(nextState.players[0].actionsRemaining, 3);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Herbs, 0);
  assert.equal(nextState.warehouse.resources.Goods, 0);
  assert.equal(nextState.encounter.active.length, 0);
  assert.equal(nextState.encounter.completed.length, 1);
  assert.equal(nextState.encounter.completed[0].cardId, arrivalId);
  assert.equal(nextState.encounter.completed[0].completed, true);
  assert.deepEqual(nextState.encounter.completed[0].requirementCost, result.requirementCost);
  assert.equal(docks.locked, false);
  assert.equal(docks.available, docks.stock);
});

test("Arrival completion requires the listed resource requirement", () => {
  const base = withWarehouseResources(newState(1), {});
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "arrival-active",
          cardId: "arrival_remnants_of_the_fleet",
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 3
        }
      ],
      completed: []
    }
  };
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: "arrival-active"
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Arrival requires 2 Wood, 4 Herbs, 2 Goods/);
});

test("Arrival completion can use A Welcome Well Met to reduce the resource requirement", () => {
  const base = newState(1);
  const arrivalId = "arrival_remnants_of_the_fleet";
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Wood: 2,
        Herbs: 2,
        Goods: 2
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "arrival-active",
          cardId: arrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 3
        }
      ],
      discard: [],
      completed: [],
      roundEffects: [
        {
          id: "discount-1",
          source: "boon",
          type: "arrival_requirement_discount",
          cardId: "boon_a_welcome_well_met",
          cardName: "A Welcome Well Met",
          round: 6,
          season: "II",
          effectText:
            "Keep this card face-up. The next time players complete an Arrival, reduce its resource Requirement by 2 resources of your choice. Then discard this card.",
          amount: 2,
          maxUses: 1,
          uses: 0,
          expiresAtEndOfRound: false,
          discardOnReveal: false,
          discardAfterUse: true
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: "arrival-active",
    arrivalRequirementReductionResources: ["Herbs", "Herbs"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseRequirementCost, [
    { amount: 2, resource: "Wood" },
    { amount: 4, resource: "Herbs" },
    { amount: 2, resource: "Goods" }
  ]);
  assert.deepEqual(result.requirementCost, [
    { amount: 2, resource: "Wood" },
    { amount: 2, resource: "Herbs" },
    { amount: 2, resource: "Goods" }
  ]);
  assert.equal(result.arrivalRequirementDiscount.amountReduced, 2);
  assert.deepEqual(result.arrivalRequirementDiscount.reduction, [{ amount: 2, resource: "Herbs" }]);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.equal(nextState.warehouse.resources.Herbs, 0);
  assert.equal(nextState.warehouse.resources.Goods, 0);
  assert.deepEqual(nextState.encounter.roundEffects, []);
  assert.deepEqual(nextState.encounter.discard, ["boon_a_welcome_well_met"]);
  assert.equal(nextState.encounter.completed[0].arrivalRequirementDiscount.cardId, "boon_a_welcome_well_met");
});

test("Arrival requirement discount requires chosen reduction resources", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Wood: 2,
        Herbs: 4,
        Goods: 2
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "arrival-active",
          cardId: "arrival_remnants_of_the_fleet",
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 3
        }
      ],
      completed: [],
      roundEffects: [
        {
          id: "discount-1",
          source: "boon",
          type: "arrival_requirement_discount",
          cardId: "boon_a_welcome_well_met",
          cardName: "A Welcome Well Met",
          round: 1,
          season: "I",
          effectText:
            "Keep this card face-up. The next time players complete an Arrival, reduce its resource Requirement by 1 resource of your choice. Then discard this card.",
          amount: 1,
          maxUses: 1,
          uses: 0,
          expiresAtEndOfRound: false,
          discardOnReveal: false,
          discardAfterUse: true
        }
      ]
    }
  };
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: "arrival-active"
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Choose exactly 1 resource/);
});

test("Arrival completion checks non-resource requirements from the card text", () => {
  const base = newState(1);
  const arrivalId = "arrival_the_burden_bearers";
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Herbs: 2,
        Stone: 2,
        Metal: 2
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "arrival-active",
          cardId: arrivalId,
          encounterType: ENCOUNTER_TYPES.ARRIVAL,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          completed: false,
          timerTokens: 3
        }
      ],
      completed: []
    }
  };
  const missingHousing = dispatch(state, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: "arrival-active"
  });

  assert.equal(missingHousing.result.ok, false);
  assert.equal(missingHousing.state, state);
  assert.match(missingHousing.result.errors.join(" "), /at least 1 Housing Tile/);

  const withHousing = {
    ...state,
    map: {
      ...state.map,
      placedTiles: [
        {
          id: "tile-001",
          tileId: "core_cottage_basic",
          coordinate: "A3",
          coordinates: ["A3"],
          rotation: 0,
          strain: 0
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(withHousing, {
    type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
    activeEncounterId: "arrival-active"
  });
  const restingHall = nextState.tileSupply.special.find((entry) => entry.tileId === "special_the_resting_hall");

  assert.equal(result.ok, true);
  assert.deepEqual(result.requirementCost, [
    { amount: 2, resource: "Herbs" },
    { amount: 2, resource: "Stone" },
    { amount: 2, resource: "Metal" }
  ]);
  assert.deepEqual(result.tileRequirements, [{ category: "Housing", amount: 1 }]);
  assert.equal(nextState.warehouse.resources.Herbs, 0);
  assert.equal(nextState.warehouse.resources.Stone, 0);
  assert.equal(nextState.warehouse.resources.Metal, 0);
  assert.equal(restingHall.locked, false);
  assert.equal(restingHall.available, restingHall.stock);
});

test("resolving a fixed-cost Burden spends 1 Action, pays resources, and discards it", () => {
  const base = newState(1);
  const burdenId = "burden_blighted_lands";
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 2
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenId,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.players[0].actionsRemaining, 3);
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, [burdenId]);
  assert.equal(nextState.encounter.completed[0].cardId, burdenId);
  assert.equal(nextState.encounter.completed[0].resolved, true);
  assert.equal(nextState.score.activeBurdenCount, 0);
  assert.equal(nextState.log.at(-1).type, "encounter");
});

test("source Burdens without To resolve text stay active and cannot be resolved", () => {
  const base = newState(1);
  const burdenCard = encounterCards.find((card) => card.card_id === "burden_smoke_over_hearths");
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenCard.card_id,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: [
            {
              round: 1,
              season: "I",
              reason: "reveal",
              effectText: burdenCard.season_i
            }
          ]
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /no source-defined resolution cost/);
  assert.equal(nextState, state);
});

test("Shared Hands, Lighter Loads discounts the next fixed-cost Burden resolution and is discarded", () => {
  const base = newState(1);
  const burdenId = "burden_blighted_lands";
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenId,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: [],
      roundEffects: [sharedHandsBurdenDiscount()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active",
    burdenResolutionReductionResources: ["Food", "Food"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [{ amount: 2, resource: "Food" }]);
  assert.deepEqual(result.cost, []);
  assert.equal(result.burdenResolutionDiscount.amountReduced, 2);
  assert.deepEqual(nextState.encounter.active, []);
  assert.deepEqual(nextState.encounter.discard, [burdenId, "boon_shared_hands_lighter_loads"]);
  assert.deepEqual(nextState.encounter.roundEffects, []);
  assert.equal(nextState.encounter.completed[0].burdenResolutionDiscount.cardId, "boon_shared_hands_lighter_loads");
  assert.equal(nextState.players[0].actionsRemaining, 3);
});

test("Shared Hands, Lighter Loads requires explicit Burden reduction resources", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 2
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden_blighted_lands",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      roundEffects: [sharedHandsBurdenDiscount()]
    }
  };
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Choose exactly 2 resources/);
});

test("The Resting Hall removes 1 Strain when players resolve an active Burden", () => {
  const burdenId = "burden_blighted_lands";
  let state = unlockSpecial(
    {
      ...newState(1),
      phase: GAME_PHASES.PLAYER_TURNS,
      activePlayerId: "P1"
    },
    "special_the_resting_hall"
  );
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_the_resting_hall",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 2
  }).state;
  state = {
    ...state,
    encounter: {
      ...state.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenId,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.ok, true);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 1);
  assert.equal(result.burdenResolutionStrainRelief.providerPlacedTileId, "tile-002");
  assert.equal(result.burdenResolutionStrainRelief.targetPlacedTileId, "tile-001");
  assert.equal(result.burdenResolutionStrainRelief.strainRemoved, 1);
  assert.equal(nextState.log.at(-1).data.burdenResolutionStrainRelief.targetTileName, "Cottage");
});

test("Overstrained Resting Hall does not remove Strain when players resolve a Burden", () => {
  const burdenId = "burden_blighted_lands";
  let state = unlockSpecial(
    {
      ...newState(1),
      phase: GAME_PHASES.PLAYER_TURNS,
      activePlayerId: "P1"
    },
    "special_the_resting_hall"
  );
  state = dispatch(state, { type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_cottage_basic",
    coordinate: "A3"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "special_the_resting_hall",
    coordinate: "A4"
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-001",
    strain: 2
  }).state;
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
    placedTileId: "tile-002",
    strain: 3
  }).state;
  state = {
    ...state,
    encounter: {
      ...state.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenId,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.ok, true);
  assert.equal(result.burdenResolutionStrainRelief, null);
  assert.equal(nextState.map.placedTiles.find((tile) => tile.id === "tile-001").strain, 2);
});

test("Burden resolution uses the current Season fixed cost", () => {
  const base = newState(1);
  const burdenId = "burden_foundations_remember_war";
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    season: "II",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Stone: 4
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenId,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.cost, [{ amount: 4, resource: "Stone" }]);
  assert.equal(nextState.warehouse.resources.Stone, 0);
});

test("Burden resolution is blocked without enough resources", () => {
  const base = withWarehouseResources(newState(1), {});
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden_blighted_lands",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ]
    }
  };
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /costs 2 Food/);
});

test("choice-cost Burdens require explicit payment choices", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden_forest_s_grudge",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ]
    }
  };
  const result = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active"
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.state, state);
  assert.match(result.result.errors.join(" "), /Choose exactly 2 resources/);
});

test("resolving a resources-of-your-choice Burden spends the chosen resources", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 1,
        Wood: 1
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden_forest_s_grudge",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Wood", amount: 1 }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.cost, [
    { resource: "Food", amount: 1 },
    { resource: "Wood", amount: 1 }
  ]);
  assert.equal(nextState.warehouse.resources.Food, 0);
  assert.equal(nextState.warehouse.resources.Wood, 0);
  assert.deepEqual(nextState.encounter.active, []);
});

test("Shared Hands, Lighter Loads discounts the chosen payment for a choice-cost Burden", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden_forest_s_grudge",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: [],
      roundEffects: [sharedHandsBurdenDiscount()]
    }
  };
  const { state: nextState, result } = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Wood", amount: 1 }
    ],
    burdenResolutionReductionResources: ["Food", "Wood"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.baseCost, [
    { resource: "Food", amount: 1 },
    { resource: "Wood", amount: 1 }
  ]);
  assert.deepEqual(result.cost, []);
  assert.deepEqual(nextState.encounter.roundEffects, []);
  assert.deepEqual(nextState.encounter.discard, ["burden_forest_s_grudge", "boon_shared_hands_lighter_loads"]);
});

test("in-any-combination Burden resolution only accepts its listed resources", () => {
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1",
    warehouse: {
      ...base.warehouse,
      resources: {
        ...base.warehouse.resources,
        Food: 1,
        Goods: 1,
        Wood: 1
      }
    },
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: "burden_too_many_houses_too_little_homes",
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: []
        }
      ],
      discard: [],
      completed: []
    }
  };
  const invalid = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Wood", amount: 1 }
    ]
  });
  const valid = dispatch(state, {
    type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
    activeEncounterId: "burden-active",
    payment: [
      { resource: "Food", amount: 1 },
      { resource: "Goods", amount: 1 }
    ]
  });

  assert.equal(invalid.result.ok, false);
  assert.equal(invalid.state, state);
  assert.match(invalid.result.errors.join(" "), /Wood is not valid/);
  assert.equal(valid.result.ok, true);
  assert.equal(valid.state.warehouse.resources.Food, 0);
  assert.equal(valid.state.warehouse.resources.Goods, 0);
});

test("active Burdens reapply at the start of Seasons II and III", () => {
  const burdenCard = encounterCards.find((card) => card.encounter_type === ENCOUNTER_TYPES.BURDEN);
  const base = newState(1);
  const seasonOneState = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    round: 5,
    season: "I",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenCard.card_id,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: [
            {
              round: 1,
              season: "I",
              reason: "reveal",
              effectText: burdenCard.season_i
            }
          ]
        }
      ]
    }
  };
  const seasonTwo = dispatch(seasonOneState, { type: TILE_ACTION_TYPES.END_ROUND });
  const burdenAfterSeasonTwo = seasonTwo.state.encounter.active[0];

  assert.equal(seasonTwo.result.ok, true);
  assert.equal(seasonTwo.state.round, 6);
  assert.equal(seasonTwo.state.season, "II");
  assert.equal(seasonTwo.result.reappliedBurdens.length, 1);
  assert.equal(seasonTwo.result.reappliedBurdens[0].effectText, burdenCard.season_ii);
  assert.deepEqual(burdenAfterSeasonTwo.appliedSeasons, ["I", "II"]);
  assert.equal(burdenAfterSeasonTwo.applications.at(-1).reason, "season_start");
  assert.equal(burdenAfterSeasonTwo.applications.at(-1).effectText, burdenCard.season_ii);

  const seasonTwoState = {
    ...seasonTwo.state,
    phase: GAME_PHASES.END_ROUND,
    round: 10,
    season: "II"
  };
  const seasonThree = dispatch(seasonTwoState, { type: TILE_ACTION_TYPES.END_ROUND });
  const burdenAfterSeasonThree = seasonThree.state.encounter.active[0];

  assert.equal(seasonThree.result.ok, true);
  assert.equal(seasonThree.state.round, 11);
  assert.equal(seasonThree.state.season, "III");
  assert.equal(seasonThree.result.reappliedBurdens.length, 1);
  assert.equal(seasonThree.result.reappliedBurdens[0].effectText, burdenCard.season_iii);
  assert.deepEqual(burdenAfterSeasonThree.appliedSeasons, ["I", "II", "III"]);
  assert.equal(burdenAfterSeasonThree.applications.at(-1).effectText, burdenCard.season_iii);
});

test("season-start resource Burden reapplication places Strain on the map", () => {
  const burdenCard = encounterCards.find((card) => card.card_id === "burden_blighted_lands");
  let state = {
    ...newState(1),
    phase: GAME_PHASES.PLAYER_TURNS,
    activePlayerId: "P1"
  };
  state = dispatch(state, {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId: "core_farm_basic",
    coordinate: "A5"
  }).state;
  state = {
    ...state,
    phase: GAME_PHASES.END_ROUND,
    round: 5,
    season: "I",
    encounter: {
      ...state.encounter,
      active: [
        {
          id: "burden-active",
          cardId: burdenCard.card_id,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: false,
          appliedSeasons: ["I"],
          applications: [
            {
              round: 1,
              season: "I",
              reason: "reveal",
              effectText: burdenCard.season_i
            }
          ]
        }
      ]
    }
  };
  const { state: nextState, result } = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });
  const farm = nextState.map.placedTiles.find((tile) => tile.id === "tile-001");
  const burden = nextState.encounter.active[0];
  const application = burden.applications.at(-1);

  assert.equal(result.ok, true);
  assert.equal(nextState.round, 6);
  assert.equal(nextState.season, "II");
  assert.equal(farm.strain, 2);
  assert.equal(result.reappliedBurdens[0].effect.type, "strain_placement");
  assert.equal(result.reappliedBurdens[0].effect.strainAdded, 2);
  assert.equal(application.reason, "season_start");
  assert.equal(application.effect.applications[0].placedTileId, "tile-001");
  assert.equal(application.effect.applications[0].strainAdded, 2);
});

test("resolved Burdens do not reapply at season boundaries", () => {
  const burdenCard = encounterCards.find((card) => card.encounter_type === ENCOUNTER_TYPES.BURDEN);
  const base = newState(1);
  const state = {
    ...base,
    phase: GAME_PHASES.END_ROUND,
    round: 5,
    season: "I",
    encounter: {
      ...base.encounter,
      active: [
        {
          id: "burden-resolved",
          cardId: burdenCard.card_id,
          encounterType: ENCOUNTER_TYPES.BURDEN,
          revealedRound: 1,
          revealedSeason: "I",
          resolved: true,
          appliedSeasons: ["I"],
          applications: []
        }
      ]
    }
  };
  const result = dispatch(state, { type: TILE_ACTION_TYPES.END_ROUND });

  assert.equal(result.result.ok, true);
  assert.deepEqual(result.result.reappliedBurdens, []);
  assert.deepEqual(result.state.encounter.active[0].appliedSeasons, ["I"]);
});
