import { isDirectlyPlaceableTile } from "./tiles.js";

export const ENCOUNTER_TYPES = Object.freeze({
  BOON: "Boon",
  BURDEN: "Burden",
  ARRIVAL: "Arrival",
  GOLDEN_BOON: "Golden Boon"
});

export const GAME_PHASES = Object.freeze({
  SEED_ENCOUNTERS: "seed_encounters",
  REVEAL_ENCOUNTERS: "reveal_encounters",
  PLAYER_TURNS: "player_turns",
  END_ROUND: "end_round",
  COMPLETE: "complete"
});

export const STANDARD_RULES = Object.freeze({
  minPlayers: 1,
  maxPlayers: 4,
  seasonCount: 3,
  roundsPerSeason: 5,
  totalRounds: 15,
  actionsPerPlayer: 4,
  hiddenCardsPerPlayer: 10,
  standardDeckCardsPerPlayer: 5,
  goldenBoonsPerGame: 1,
  councilVariantStartingWarehouseResources: 0,
  arrivalStartTimerTokens: 3,
  arrivalTimerMax: 3,
  activeBurdenPenaltyRenown: 10,
  strainPenaltyRenown: 2,
  standardPoolPerPlayer: Object.freeze({
    [ENCOUNTER_TYPES.BOON]: 5,
    [ENCOUNTER_TYPES.BURDEN]: 5,
    [ENCOUNTER_TYPES.ARRIVAL]: 5
  }),
  warehouseCapPerResource: 15,
  startingWarehouseResourcesByPlayerCount: Object.freeze({
    1: 15,
    2: 10,
    3: 5,
    4: 0
  }),
  resources: Object.freeze(["Wood", "Stone", "Metal", "Food", "Herbs", "Goods"])
});

export function getSeasonForRound(round) {
  if (round >= 11) {
    return "III";
  }

  if (round >= 6) {
    return "II";
  }

  return "I";
}

export function createEncounterIndex(encounterCards) {
  return new Map(encounterCards.map((card) => [card.card_id, card]));
}

const RENAMED_DEFAULT_SEED_HASHES = Object.freeze({
  "quiet-vale": 0x7fd0d1c9,
  "quiet-vale-m2": 0x6abed5f3
});

export function hashSeed(seed) {
  const text = String(seed ?? "quiet-vale");
  const renamedDefaultHash = RENAMED_DEFAULT_SEED_HASHES[text];

  if (renamedDefaultHash !== undefined) {
    return renamedDefaultHash;
  }

  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function countEncounterTypes(cards) {
  return cards.reduce((counts, card) => {
    counts[card.encounter_type] = (counts[card.encounter_type] ?? 0) + 1;
    return counts;
  }, {});
}

export function resolveEncounterCards(cardIds, encounterIndex) {
  return cardIds.map((cardId) => {
    const card = encounterIndex.get(cardId);

    if (!card) {
      throw new Error(`Unknown Encounter card id: ${cardId}`);
    }

    return card;
  });
}

function requirePlayerCount(playerCount) {
  if (
    !Number.isInteger(playerCount) ||
    playerCount < STANDARD_RULES.minPlayers ||
    playerCount > STANDARD_RULES.maxPlayers
  ) {
    throw new Error(`Standard setup supports ${STANDARD_RULES.minPlayers}-${STANDARD_RULES.maxPlayers} players.`);
  }
}

function selectStandardPool(encounterCards, playerCount, random) {
  return Object.entries(STANDARD_RULES.standardPoolPerPlayer).flatMap(([encounterType, countPerPlayer]) => {
    const needed = countPerPlayer * playerCount;
    const cards = encounterCards.filter((card) => card.encounter_type === encounterType);

    if (cards.length < needed) {
      throw new Error(`Not enough ${encounterType} cards for ${playerCount} players.`);
    }

    return shuffle(cards, random).slice(0, needed);
  });
}

function createPlayers(playerCount, standardPool) {
  const handSize = STANDARD_RULES.hiddenCardsPerPlayer;

  return Array.from({ length: playerCount }, (_, index) => {
    const handStart = index * handSize;
    const hand = standardPool.slice(handStart, handStart + handSize);

    return {
      id: `P${index + 1}`,
      name: `Player ${index + 1}`,
      actionsRemaining: STANDARD_RULES.actionsPerPlayer,
      hand: hand.map((card) => card.card_id),
      lastInteraction: null
    };
  });
}

export function getStartingWarehouseResourceCount(playerCount) {
  return STANDARD_RULES.startingWarehouseResourcesByPlayerCount[playerCount] ??
    STANDARD_RULES.councilVariantStartingWarehouseResources;
}

function createWarehouse(playerCount) {
  const startingResourceCount = getStartingWarehouseResourceCount(playerCount);

  return {
    cap: STANDARD_RULES.warehouseCapPerResource,
    resources: Object.fromEntries(STANDARD_RULES.resources.map((resource) => [resource, startingResourceCount]))
  };
}

function createTileSupply(tiles) {
  const core = tiles.filter((tile) => tile.tile_source_type === "Core");
  const special = tiles.filter((tile) => tile.tile_source_type === "Special");

  return {
    core: core.map((tile) => ({
      tileId: tile.tile_id,
      name: tile.tile_name,
      side: tile.side,
      category: tile.tile_category,
      stock: Number(tile.stock ?? 0),
      available: isDirectlyPlaceableTile(tile) ? Number(tile.stock ?? 0) : 0,
      locked: !isDirectlyPlaceableTile(tile)
    })),
    special: special.map((tile) => ({
      tileId: tile.tile_id,
      name: tile.tile_name,
      side: tile.side,
      category: tile.tile_category,
      stock: Number(tile.stock ?? 0),
      available: 0,
      locked: true,
      unlockedByArrival: tile.unlocked_by_arrival
    }))
  };
}

function createLogEntry(index, message, data = {}) {
  return {
    id: `log-${String(index).padStart(3, "0")}`,
    round: 1,
    season: "I",
    type: "setup",
    message,
    data
  };
}

export function createInitialGameState({ playerCount, seed = "quiet-vale", encounterCards, tiles, mapHexes }) {
  requirePlayerCount(playerCount);

  const random = createSeededRandom(seed);
  const standardPool = shuffle(selectStandardPool(encounterCards, playerCount, random), random);
  const players = createPlayers(playerCount, standardPool);
  const standardDeckStart = STANDARD_RULES.hiddenCardsPerPlayer * playerCount;
  const standardDeckSize = STANDARD_RULES.standardDeckCardsPerPlayer * playerCount;
  const standardDeckCards = standardPool.slice(standardDeckStart, standardDeckStart + standardDeckSize);
  const goldenBoons = encounterCards.filter((card) => card.encounter_type === ENCOUNTER_TYPES.GOLDEN_BOON);

  if (goldenBoons.length < STANDARD_RULES.goldenBoonsPerGame) {
    throw new Error("Not enough Golden Boons for setup.");
  }

  const selectedGoldenBoons = shuffle(goldenBoons, random).slice(0, STANDARD_RULES.goldenBoonsPerGame);
  const encounterDeckCards = shuffle([...standardDeckCards, ...selectedGoldenBoons], random);
  const selectedStandardPoolIds = standardPool.map((card) => card.card_id);
  const selectedGoldenBoonIds = selectedGoldenBoons.map((card) => card.card_id);

  return {
    id: `game-${playerCount}p-${hashSeed(seed).toString(16)}`,
    phase: GAME_PHASES.SEED_ENCOUNTERS,
    round: 1,
    season: getSeasonForRound(1),
    playerCount,
    activePlayerId: null,
    seed,
    rules: STANDARD_RULES,
    players,
    map: {
      hexes: mapHexes,
      placedTiles: []
    },
    encounter: {
      deck: encounterDeckCards.map((card) => card.card_id),
      discard: [],
      active: [],
      completed: [],
      roundEffects: [],
      seededRounds: [],
      revealedRounds: [],
      setup: {
        selectedStandardPoolIds,
        selectedGoldenBoonIds,
        standardDeckCardIds: standardDeckCards.map((card) => card.card_id)
      }
    },
    warehouse: createWarehouse(playerCount),
    tileSupply: createTileSupply(tiles),
    score: {
      population: 0,
      renown: 0,
      activeBurdenPenalty: 0,
      strainPenalty: 0,
      total: 0,
      activeBurdenCount: 0,
      strainTokens: 0,
      scoringTileCount: 0,
      overstrainedExcludedTileIds: [],
      placedTileScores: []
    },
    log: [
      createLogEntry(1, `Created a ${playerCount}-player standard setup.`, { playerCount, seed }),
      createLogEntry(2, "Built a balanced standard Encounter pool.", {
        [ENCOUNTER_TYPES.BOON]: STANDARD_RULES.standardPoolPerPlayer[ENCOUNTER_TYPES.BOON] * playerCount,
        [ENCOUNTER_TYPES.BURDEN]: STANDARD_RULES.standardPoolPerPlayer[ENCOUNTER_TYPES.BURDEN] * playerCount,
        [ENCOUNTER_TYPES.ARRIVAL]: STANDARD_RULES.standardPoolPerPlayer[ENCOUNTER_TYPES.ARRIVAL] * playerCount
      }),
      createLogEntry(3, "Dealt hidden player hands and the starting Encounter Deck.", {
        hiddenCardsPerPlayer: STANDARD_RULES.hiddenCardsPerPlayer,
        standardDeckCards: standardDeckSize,
        goldenBoons: selectedGoldenBoonIds.length
      }),
      createLogEntry(4, "Stocked the starting Warehouse for the player count.", {
        resourcesPerType: getStartingWarehouseResourceCount(playerCount),
        cap: STANDARD_RULES.warehouseCapPerResource
      })
    ]
  };
}
