import {
  HEX_DIRECTIONS,
  compareCoordinates,
  getBridgeCandidateHexes,
  getFootprintCoordinates,
  getMapAxes,
  getNeighborCoordinates,
  getRiverAdjacentLandSites,
  getRiverHexes,
  normalizeMapSource,
  parseCoordinate,
  summarizeTerrain,
  validateApprovedMap,
  validateMapOption,
  validateSourceCounts
} from "../game/map.js";
import { dispatchGameAction } from "../game/reducer.js";
import {
  ENCOUNTER_TYPES,
  GAME_PHASES,
  STANDARD_RULES,
  createEncounterIndex,
  createInitialGameState,
  countEncounterTypes,
  getStartingWarehouseResourceCount,
  resolveEncounterCards
} from "../game/setup.js";
import {
  TILE_ACTION_TYPES,
  canAffordCost,
  createTileIndex,
  findUpgradeTile,
  getDirectlyPlaceableTiles,
  getDefaultResourceCostChoiceResources,
  getPlacedTileAt,
  getResourceCostChoiceGroups,
  hasResourceCostChoices,
  isOverstrainedPlacedTile,
  parseResourceCost,
  parseResourceCostOptions,
  resolveResourceCost,
  validatePlaceTile,
  validateUpgradeTile
} from "../game/tiles.js";
import { isSupportedPlacedTile } from "../game/strain.js";
import {
  buildTravelNetworks,
  calculatePlacedTileActionCost,
  calculatePlacementActionCost,
  getDiscountedDisconnectedTravelActionCost,
  getDiscountedTileActionCost,
  getNetworkForPlacedTile,
  getRiverCrossingActionCost
} from "../game/travel.js";
import { getActivationDetails, getAdjacentPlacedTiles, validateActivateTile } from "../game/activation.js";
import { getEffectiveSupportDetails } from "../game/passives.js";
import { SEED_PACKET_POSITIONS, getBurdenResolutionCost } from "../game/encounters.js";
import { createEncounterCoverageAudit } from "../game/encounterCoverage.js";
import {
  STEWARD_ROLES,
  STEWARD_POWER_TYPES,
  getAvailableStewardPowerProviders,
  getPendingOpeningResourcePlacement,
  getPendingStewardHousePlacement,
  getStewardHouseRole,
  getStewardRole,
  getStewardPowerDetails,
  getStewardPowerDetailsForRole,
  isStewardHousePlacementTerrainForRole,
  isOpeningResourceTileForPlayer,
  isStewardHouseTileForPlayer,
  isStewardPowerUsedThisSeason,
  normalizeStewardRoleIds
} from "../game/stewards.js";
import {
  getEncounterFlavorText,
  getEncounterRuleLines
} from "../game/encounterPresentation.js";
import {
  SIMULATION_BOT_PROFILES,
  runSimulationBatch,
  simulationRoundsToCsv,
  simulationSummaryToCsv
} from "../game/simulation.js";

const DATA_PATHS = {
  encounterCards: "./src/data/encounter_cards.json",
  tiles: "./src/data/tiles.json",
  tileColourVariations: "./src/data/tile_colour_variations.json",
  mapTerrainColours: "./src/data/map_terrain_colours.json",
  riverRules: "./src/data/river_rules.json",
  rulesConfig: "./src/data/rules_config.json"
};

const DEFAULT_MAP_ID = "redesigned-basic-map-v0-2";

const MAP_OPTIONS = Object.freeze([
  Object.freeze({
    id: DEFAULT_MAP_ID,
    name: "Redesigned Basic Map v0.2",
    status: "Default locked map",
    path: "./src/data/redesigned_basic_map_v0_2.json",
    locked: true
  })
]);

const TERRAIN_LEGEND_ITEMS = Object.freeze([
  Object.freeze({ terrain: "Grasslands", label: "Grasslands" }),
  Object.freeze({ terrain: "Water", label: "River" }),
  Object.freeze({ terrain: "Woodland", label: "Woodland" }),
  Object.freeze({ terrain: "Mountains", label: "Mountains" }),
  Object.freeze({ terrain: "Heaths", label: "Heaths" }),
  Object.freeze({ terrain: "Arable Land", label: "Arable" }),
  Object.freeze({ terrain: "Ruins", label: "Ruins" })
]);

const MAP_TERRAIN_SOLID_COLOURS = Object.freeze([
  Object.freeze({ terrain: "Grasslands", hex: "#D8CFAE" }),
  Object.freeze({ terrain: "Woodland", hex: "#8F9B6A" }),
  Object.freeze({ terrain: "Heaths", hex: "#A99AB2" }),
  Object.freeze({ terrain: "Water / River", hex: "#7894A0" }),
  Object.freeze({ terrain: "Mountains", hex: "#8B969B" }),
  Object.freeze({ terrain: "Arable Land", hex: "#C6A96D" }),
  Object.freeze({ terrain: "Ruins", hex: "#9A8875" })
]);

const TERRAIN_RESOURCE_TILE_IDS = Object.freeze({
  Woodland: "core_forest_basic",
  Mountains: "core_mine_basic",
  Heaths: "core_wildlands_basic",
  "Arable Land": "core_farm_basic",
  Ruins: "core_dig_site_basic"
});

const QUARTERMASTER_STARTING_EXCHANGE_DETAILS = Object.freeze({
  type: STEWARD_POWER_TYPES.STARTING_RESOURCE_EXCHANGE,
  maxAmount: 2,
  label: "Before first seeding: exchange up to 2 Warehouse resources"
});

const TILE_CATEGORY_ACCENTS = Object.freeze({
  Resource: "#61724C",
  Housing: "#8A6B4D",
  Crafting: "#6C7377",
  Merchant: "#967540",
  Social: "#7C5A52",
  Wellbeing: "#6D8378",
  Travel: "#5E7482",
  Special: "#8F6B35"
});

const TILE_COLOUR_VARIATIONS = Object.freeze([
  Object.freeze({ baseTile: "Dig Site", upgradedTile: "The Excavation", variantHex: "#746A4F" }),
  Object.freeze({ baseTile: "Farm", upgradedTile: "Artisanal Farm", variantHex: "#7B7448" }),
  Object.freeze({ baseTile: "Forest", upgradedTile: "Managed Woodlands", variantHex: "#667A4E" }),
  Object.freeze({ baseTile: "Mine", upgradedTile: "Deep Mines", variantHex: "#687276" }),
  Object.freeze({ baseTile: "Wildlands", upgradedTile: "Nurtured Wildlands", variantHex: "#6A6E50" }),
  Object.freeze({ baseTile: "Cottage", upgradedTile: "Home", variantHex: "#8A6B4D" }),
  Object.freeze({ baseTile: "Inn", upgradedTile: "Dawn Break Lodge", variantHex: "#8A6B4D" }),
  Object.freeze({ baseTile: "Knight House", upgradedTile: "Knight Home", variantHex: "#8C744B" }),
  Object.freeze({ baseTile: "Neighborhood", upgradedTile: "Housing Quarter", variantHex: "#8A6B4D" }),
  Object.freeze({ baseTile: "Quartermaster House", upgradedTile: "Quartermaster Home", variantHex: "#8C7352" }),
  Object.freeze({ baseTile: "Ranger House", upgradedTile: "Ranger Home", variantHex: "#80615B" }),
  Object.freeze({ baseTile: "Sentinel House", upgradedTile: "Sentinel Home", variantHex: "#77706A" }),
  Object.freeze({ baseTile: "Terrace", upgradedTile: "District Row", variantHex: "#8A6B4D" }),
  Object.freeze({ baseTile: "Vanguard House", upgradedTile: "Vanguard Home", variantHex: "#7D704E" }),
  Object.freeze({ baseTile: "Warden House", upgradedTile: "Warden Home", variantHex: "#746457" }),
  Object.freeze({ baseTile: "Workshops", upgradedTile: "The Makers Conclave", variantHex: "#6C7377" }),
  Object.freeze({ baseTile: "Market Stalls", upgradedTile: "The Seldes", variantHex: "#967540" }),
  Object.freeze({ baseTile: "Eatery", upgradedTile: "The Crock and Ladle", variantHex: "#7C5A52" }),
  Object.freeze({ baseTile: "Tavern", upgradedTile: "The Steward’s Arms", variantHex: "#9A6946" }),
  Object.freeze({ baseTile: "Apothecary", upgradedTile: "Amaryllis Bloom", variantHex: "#6D8378" }),
  Object.freeze({ baseTile: "The Vaults", upgradedTile: "Archaeologists’ Archives", variantHex: "#6D8378" }),
  Object.freeze({ baseTile: "Washhouse", upgradedTile: "Sweet Flag Bathhouse", variantHex: "#6D8378" }),
  Object.freeze({ baseTile: "Bridge", upgradedTile: "Stone Bridge", variantHex: "#5B7786" }),
  Object.freeze({ baseTile: "Common Land", upgradedTile: "The Pleasence", variantHex: "#5E7482" }),
  Object.freeze({ baseTile: "Gravel Path", upgradedTile: "Paved Path", variantHex: "#5E7482" }),
  Object.freeze({ baseTile: "Gravel Track", upgradedTile: "Paved Road", variantHex: "#5E7482" })
]);

const MAP_WAREHOUSE_RAILS = Object.freeze([
  Object.freeze(["Wood", "Stone", "Metal"]),
  Object.freeze(["Food", "Herbs", "Goods"])
]);

const BURDEN_REVEAL_CHOICE_TYPES = Object.freeze([
  "pay_or_strain_choice",
  "arrival_pay_or_timer_choice",
  "resource_loss_or_strain_choice"
]);

const PLAY_SESSION_STATES = Object.freeze({
  SETUP: "setup",
  PLAYING: "playing",
  ENDED: "ended"
});

const PLAY_SESSION_LABELS = Object.freeze({
  [PLAY_SESSION_STATES.SETUP]: "Setup",
  [PLAY_SESSION_STATES.PLAYING]: "Playing",
  [PLAY_SESSION_STATES.ENDED]: "Ended"
});

const TABLE_WORKSPACES = Object.freeze({
  ENCOUNTERS: "encounters",
  TILES: "tiles",
  STEWARDS: "stewards"
});

const TABLE_WORKSPACE_LABELS = Object.freeze({
  [TABLE_WORKSPACES.ENCOUNTERS]: "Encounters",
  [TABLE_WORKSPACES.TILES]: "Tiles",
  [TABLE_WORKSPACES.STEWARDS]: "Stewards"
});

const HEADER_MENUS = Object.freeze({
  SETUP: "setup",
  STEWARDS: "stewards"
});

const LOCAL_SAVE_KEY = "the-quiet-vale-playtest-state-v1";
const LOCAL_SAVE_VERSION = 4;

const root = document.querySelector("#app");
const state = {
  data: null,
  error: null,
  game: null,
  playSessionState: PLAY_SESSION_STATES.SETUP,
  selectedCoordinate: "C7",
  selectedMapId: DEFAULT_MAP_ID,
  selectedTileId: null,
  selectedOrientation: HEX_DIRECTIONS[0].id,
  playerCount: 1,
  setupSeed: "quiet-vale-m2",
  showDebugLabels: false,
  revealHiddenSetup: false,
  blindTestMode: true,
  activeWorkspace: TABLE_WORKSPACES.ENCOUNTERS,
  openHeaderMenu: "",
  stewardRoleIds: normalizeStewardRoleIds(1),
  debugSeedSelections: {},
  debugSeedPosition: SEED_PACKET_POSITIONS.TOP,
  burdenPayments: {},
  burdenChoiceDecisions: {},
  boonStrainReliefTargets: {},
  boonExchangePayments: {},
  boonExchangeGains: {},
  boonExchangeAmounts: {},
  boonStewardHelpGains: {},
  goldenScrollDiscards: {},
  goldenSignetMoves: {},
  placementCostChoices: {},
  placementCostDiscounts: {},
  burdenResolutionDiscounts: {},
  arrivalRequirementDiscounts: {},
  upgradeCostChoices: {},
  upgradeCostDiscounts: {},
  activationTargets: {},
  activationPayments: {},
  activationGains: {},
  activationExchangeAmounts: {},
  stewardPlacementPowerId: "",
  stewardActivationPowerId: "",
  stewardUpgradePowerId: "",
  stewardBurdenPowerIds: {},
  stewardExchangePayments: {},
  stewardExchangeGains: {},
  stewardExchangeAmounts: {},
  tileFacePreviewSides: {},
  tileTrayScrollTop: 0,
  pendingPlacementPreview: null,
  pendingPairedPlacement: null,
  simulation: {
    botProfile: "balanced",
    playerCount: "current",
    result: null,
    message: ""
  },
  contextMenu: null,
  seedContextMenu: null,
  lastActionResult: null,
  gameHistory: []
};

const MAX_UNDO_HISTORY = 30;

function cloneForLocalSave(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clearGameHistory() {
  state.gameHistory = [];
}

function rememberGameStateForUndo(action = "table action") {
  if (!state.game) {
    return;
  }

  state.gameHistory = [
    ...state.gameHistory.slice(-(MAX_UNDO_HISTORY - 1)),
    {
      action,
      game: cloneForLocalSave(state.game),
      playSessionState: state.playSessionState,
      selectedCoordinate: state.selectedCoordinate,
      selectedTileId: state.selectedTileId,
      selectedOrientation: state.selectedOrientation,
      activeWorkspace: state.activeWorkspace
    }
  ];
}

function getRecommendedWorkspace(game = state.game) {
  if (!game) {
    return TABLE_WORKSPACES.ENCOUNTERS;
  }

  if (isPlaySessionSetup() || game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
    return TABLE_WORKSPACES.STEWARDS;
  }

  if (game.phase === GAME_PHASES.SEED_ENCOUNTERS || game.phase === GAME_PHASES.REVEAL_ENCOUNTERS) {
    return TABLE_WORKSPACES.ENCOUNTERS;
  }

  if (game.phase === GAME_PHASES.END_ROUND || game.phase === GAME_PHASES.COMPLETE || isPlaySessionEnded()) {
    return TABLE_WORKSPACES.ENCOUNTERS;
  }

  if (getPendingBurdenRevealChoices(game).length > 0) {
    return TABLE_WORKSPACES.ENCOUNTERS;
  }

  return TABLE_WORKSPACES.TILES;
}

function isValidTableWorkspace(workspace) {
  return Object.values(TABLE_WORKSPACES).includes(workspace);
}

function getActiveWorkspace(game = state.game) {
  return isValidTableWorkspace(state.activeWorkspace) ? state.activeWorkspace : getRecommendedWorkspace(game);
}

function getWorkspaceAfterAction(nextGame, result) {
  if (!result?.ok) {
    return getActiveWorkspace(nextGame);
  }

  const action = result.action ?? "";

  if (action === TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE) {
    return getRecommendedWorkspace(nextGame);
  }

  if (
    action === TILE_ACTION_TYPES.SEED_ENCOUNTERS ||
    action === TILE_ACTION_TYPES.REVEAL_ENCOUNTERS ||
    action === TILE_ACTION_TYPES.END_ROUND ||
    action.includes("ENCOUNTER") ||
    action.includes("BURDEN") ||
    action.includes("ARRIVAL") ||
    action.includes("BOON")
  ) {
    return TABLE_WORKSPACES.ENCOUNTERS;
  }

  if (
    action === TILE_ACTION_TYPES.PLACE_TILE ||
    action === TILE_ACTION_TYPES.UPGRADE_TILE ||
    action === TILE_ACTION_TYPES.ACTIVATE_TILE ||
    action === TILE_ACTION_TYPES.END_TURN
  ) {
    return TABLE_WORKSPACES.TILES;
  }

  return getActiveWorkspace(nextGame);
}

function applyGameOutcome(nextGame, result, action = result?.action ?? "table action") {
  if (result?.ok) {
    rememberGameStateForUndo(action);
  }

  state.game = nextGame;
  state.lastActionResult = result;
  state.activeWorkspace = getWorkspaceAfterAction(nextGame, result);
}

function canUndoLastAction() {
  return !isPlaySessionSetup() && state.gameHistory.length > 0;
}

function undoLastAction() {
  const previous = state.gameHistory.at(-1);

  if (!previous) {
    state.lastActionResult = {
      ok: false,
      action: "UNDO_LAST_ACTION",
      errors: ["No previous table action to undo."]
    };
    renderApp();
    return;
  }

  state.gameHistory = state.gameHistory.slice(0, -1);
  state.game = cloneForLocalSave(previous.game);
  state.playSessionState = previous.playSessionState ?? state.playSessionState;
  state.selectedCoordinate = previous.selectedCoordinate ?? state.selectedCoordinate;
  state.selectedTileId = previous.selectedTileId ?? state.selectedTileId;
  state.selectedOrientation = previous.selectedOrientation ?? state.selectedOrientation;
  state.activeWorkspace = previous.activeWorkspace ?? getRecommendedWorkspace(state.game);
  resetLocalTestingControls();
  syncSelectedCoordinate();
  syncSelectedTile();
  state.lastActionResult = {
    ok: true,
    action: "UNDO_LAST_ACTION",
    message: "Undid the last table action."
  };
  renderApp();
}

function getLocalSaveStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function getLocalDataSignature() {
  if (!state.data) {
    return null;
  }

  return {
    encounterCardCount: state.data.encounterCards?.length ?? 0,
    mapOptionIds: (state.data.mapOptions ?? []).map((option) => `${option.id}:${option.hexes?.length ?? 0}`),
    tileCount: state.data.tiles?.length ?? 0
  };
}

function getLocalSaveSnapshot() {
  return {
    activationExchangeAmounts: state.activationExchangeAmounts,
    activationGains: state.activationGains,
    activationPayments: state.activationPayments,
    activationTargets: state.activationTargets,
    activeWorkspace: state.activeWorkspace,
    arrivalRequirementDiscounts: state.arrivalRequirementDiscounts,
    boonExchangeAmounts: state.boonExchangeAmounts,
    boonExchangeGains: state.boonExchangeGains,
    boonExchangePayments: state.boonExchangePayments,
    boonStewardHelpGains: state.boonStewardHelpGains,
    boonStrainReliefTargets: state.boonStrainReliefTargets,
    blindTestMode: state.blindTestMode,
    burdenChoiceDecisions: state.burdenChoiceDecisions,
    burdenPayments: state.burdenPayments,
    burdenResolutionDiscounts: state.burdenResolutionDiscounts,
    debugSeedPosition: state.debugSeedPosition,
    debugSeedSelections: state.debugSeedSelections,
    game: state.game,
    goldenScrollDiscards: state.goldenScrollDiscards,
    goldenSignetMoves: state.goldenSignetMoves,
    lastActionResult: state.lastActionResult,
    pendingPlacementPreview: state.pendingPlacementPreview,
    placementCostChoices: state.placementCostChoices,
    placementCostDiscounts: state.placementCostDiscounts,
    playerCount: state.playerCount,
    playSessionState: state.playSessionState,
    revealHiddenSetup: state.revealHiddenSetup,
    selectedCoordinate: state.selectedCoordinate,
    selectedMapId: state.selectedMapId,
    selectedOrientation: state.selectedOrientation,
    selectedTileId: state.selectedTileId,
    setupSeed: state.setupSeed,
    showDebugLabels: state.showDebugLabels,
    simulation: {
      botProfile: state.simulation.botProfile,
      message: state.simulation.message,
      playerCount: state.simulation.playerCount,
      result: null
    },
    stewardBurdenPowerIds: state.stewardBurdenPowerIds,
    stewardExchangeAmounts: state.stewardExchangeAmounts,
    stewardExchangeGains: state.stewardExchangeGains,
    stewardExchangePayments: state.stewardExchangePayments,
    stewardPlacementPowerId: state.stewardPlacementPowerId,
    stewardActivationPowerId: state.stewardActivationPowerId,
    stewardRoleIds: state.stewardRoleIds,
    stewardUpgradePowerId: state.stewardUpgradePowerId,
    tileFacePreviewSides: state.tileFacePreviewSides,
    upgradeCostChoices: state.upgradeCostChoices,
    upgradeCostDiscounts: state.upgradeCostDiscounts
  };
}

function saveLocalPlaytestState() {
  if (!state.data || !state.game) {
    return;
  }

  const storage = getLocalSaveStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      LOCAL_SAVE_KEY,
      JSON.stringify({
        version: LOCAL_SAVE_VERSION,
        savedAt: new Date().toISOString(),
        dataSignature: getLocalDataSignature(),
        state: getLocalSaveSnapshot()
      })
    );
  } catch (error) {
    console.warn("The Quiet Vale local save could not be written.", error);
  }
}

function clearLocalPlaytestState() {
  const storage = getLocalSaveStorage();

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(LOCAL_SAVE_KEY);
  } catch (error) {
    console.warn("The Quiet Vale local save could not be cleared.", error);
  }
}

function isValidSavedPlaytestState(savedState) {
  return Boolean(
    savedState &&
      savedState.game?.map &&
      savedState.game?.encounter &&
      Array.isArray(savedState.game?.players) &&
      Object.values(PLAY_SESSION_STATES).includes(savedState.playSessionState)
  );
}

function restoreCurrentScoringRules(savedState) {
  const restoredState = cloneForLocalSave(savedState);

  if (restoredState.game?.rules) {
    restoredState.game.rules = {
      ...restoredState.game.rules,
      activeBurdenPenaltyRenown: STANDARD_RULES.activeBurdenPenaltyRenown
    };
  }

  return restoredState;
}

function restoreLocalPlaytestState() {
  const storage = getLocalSaveStorage();

  if (!storage) {
    return false;
  }

  try {
    const raw = storage.getItem(LOCAL_SAVE_KEY);

    if (!raw) {
      return false;
    }

    const saved = JSON.parse(raw);
    const currentDataSignature = getLocalDataSignature();

    if (
      saved?.version !== LOCAL_SAVE_VERSION ||
      JSON.stringify(saved.dataSignature) !== JSON.stringify(currentDataSignature) ||
      !isValidSavedPlaytestState(saved.state)
    ) {
      clearLocalPlaytestState();
      return false;
    }

    Object.assign(state, restoreCurrentScoringRules(saved.state), {
      contextMenu: null,
      data: state.data,
      error: null,
      gameHistory: [],
      seedContextMenu: null,
      simulation: {
        ...state.simulation,
        ...(saved.state.simulation ?? {}),
        result: null
      }
    });

    state.selectedMapId = DEFAULT_MAP_ID;

    refreshActiveMapData();
    syncSelectedCoordinate();
    syncStewardRoleIds();
    syncSelectedTile();

    state.lastActionResult = {
      ok: true,
      action: "RESTORE_GAME",
      message: "Restored the saved table on this device."
    };

    return true;
  } catch (error) {
    clearLocalPlaytestState();
    console.warn("The Quiet Vale local save could not be restored.", error);
    return false;
  }
}

async function loadJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }

  return response.json();
}

async function loadData() {
  const entries = await Promise.all(
    Object.entries(DATA_PATHS).map(async ([key, path]) => [key, await loadJson(path)])
  );

  const mapOptions = await Promise.all(
    MAP_OPTIONS.map(async (option) => {
      const source = await loadJson(option.path);

      return {
        ...option,
        source,
        hexes: normalizeMapSource(source)
      };
    })
  );
  const selectedMap = mapOptions.find((option) => option.id === state.selectedMapId) ?? mapOptions[0];

  return {
    ...Object.fromEntries(entries),
    mapOptions,
    mapHexes: selectedMap.hexes
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeTerrainColourName(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  if (normalized === "water / river" || normalized === "river") {
    return "water";
  }

  return normalized;
}

function getMapTerrainColourRows() {
  return Array.isArray(state.data?.mapTerrainColours) && state.data.mapTerrainColours.length
    ? state.data.mapTerrainColours
    : MAP_TERRAIN_SOLID_COLOURS;
}

function getTerrainColourHex(terrain) {
  const normalizedTerrain = normalizeTerrainColourName(terrain);
  const row = getMapTerrainColourRows().find(
    (candidate) => normalizeTerrainColourName(candidate?.terrain) === normalizedTerrain
  );

  return row?.hex ?? "";
}

function getTerrainFillStyle(terrain) {
  const terrainHex = getTerrainColourHex(terrain);

  return terrainHex ? `--terrain-fill: ${terrainHex};` : "";
}

function normalizeTileColourName(value) {
  return String(value ?? "").replaceAll("’", "'").toLowerCase().trim();
}

function getTileColourVariationRows() {
  return Array.isArray(state.data?.tileColourVariations) && state.data.tileColourVariations.length
    ? state.data.tileColourVariations
    : TILE_COLOUR_VARIATIONS;
}

function getTileVariationBaseName(row) {
  return row?.base_tile ?? row?.baseTile ?? "";
}

function getTileVariationUpgradedName(row) {
  return row?.upgraded_tile ?? row?.upgradedTile ?? "";
}

function getTileVariationType(row) {
  return row?.tile_type ?? row?.tileType ?? "";
}

function getTileVariationTypeBaseHex(row) {
  return row?.type_base_hex ?? row?.typeBaseHex ?? "";
}

function getTileVariationVariantHex(row) {
  return row?.tile_variant_hex ?? row?.variantHex ?? "";
}

function getTileVariationHexForName(tileName) {
  const normalizedName = normalizeTileColourName(tileName);

  if (!normalizedName) {
    return null;
  }

  for (const row of getTileColourVariationRows()) {
    if (
      normalizeTileColourName(getTileVariationBaseName(row)) === normalizedName ||
      normalizeTileColourName(getTileVariationUpgradedName(row)) === normalizedName
    ) {
      return getTileVariationVariantHex(row) || null;
    }
  }

  return null;
}

function parseHexColour(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));

  if (!match) {
    return { r: 143, g: 107, b: 53 };
  }

  const value = Number.parseInt(match[1], 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function toHexChannel(value) {
  return clampNumber(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function mixHexColour(sourceHex, targetHex, targetWeight = 0.5) {
  const source = parseHexColour(sourceHex);
  const target = parseHexColour(targetHex);
  const weight = clampNumber(targetWeight, 0, 1);
  const sourceWeight = 1 - weight;

  return `#${toHexChannel(source.r * sourceWeight + target.r * weight)}${toHexChannel(source.g * sourceWeight + target.g * weight)}${toHexChannel(source.b * sourceWeight + target.b * weight)}`;
}

function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = parseHexColour(hex);

  return `rgba(${r}, ${g}, ${b}, ${clampNumber(alpha, 0, 1)})`;
}

function getTileCategoryAccent(tile) {
  const category = tile?.tile_category;
  const sourceRow = getTileColourVariationRows().find((row) => getTileVariationType(row) === category);

  return getTileVariationTypeBaseHex(sourceRow) || TILE_CATEGORY_ACCENTS[category] || TILE_CATEGORY_ACCENTS.Special;
}

function getTileVariantAccent(tile) {
  return (
    getTileVariationHexForName(tile?.tile_name) ??
    getTileVariationHexForName(tile?.base_tile) ??
    getTileCategoryAccent(tile)
  );
}

function getTileAccentTokens(tile) {
  const categoryAccent = getTileCategoryAccent(tile);
  const variantAccent = getTileVariantAccent(tile);

  return {
    categoryAccent,
    variantAccent,
    cardBackground: mixHexColour(categoryAccent, "#f0e4cc", 0.8),
    cardWash: hexToRgba(variantAccent, 0.18),
    faceFill: mixHexColour(categoryAccent, "#f8f2e6", 0.88),
    mapFill: mixHexColour(variantAccent, "#efe1c7", 0.56)
  };
}

function getTileFaceAccentStyle(tile) {
  const { categoryAccent, variantAccent, faceFill } = getTileAccentTokens(tile);

  return `--tile-accent: ${categoryAccent}; --tile-variant-accent: ${variantAccent}; --tile-face-fill: ${faceFill};`;
}

function getTileCardAccentStyle(tile) {
  const { categoryAccent, variantAccent, cardBackground, cardWash } = getTileAccentTokens(tile);

  return `--tile-accent: ${categoryAccent}; --tile-variant-accent: ${variantAccent}; --tile-card-bg: ${cardBackground}; --tile-card-wash: ${cardWash}; border-left-color: ${variantAccent};`;
}

function getMapPlacedTileStyle(tile) {
  const { variantAccent, mapFill } = getTileAccentTokens(tile);

  return `--map-tile-accent: ${variantAccent}; --map-tile-fill: ${mapFill};`;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function formatPhase(phase) {
  const labels = {
    [GAME_PHASES.PLACE_STEWARD_HOUSES]: "Place Steward Tokens",
    [GAME_PHASES.SEED_ENCOUNTERS]: "Seed Encounters",
    [GAME_PHASES.REVEAL_ENCOUNTERS]: "Reveal Encounters",
    [GAME_PHASES.PLAYER_TURNS]: "Player Turns",
    [GAME_PHASES.END_ROUND]: "End of Round",
    [GAME_PHASES.COMPLETE]: "Complete"
  };

  return labels[phase] ?? phase;
}

function formatPlayerName(player) {
  return player?.stewardRoleName ? `${player.name} - ${player.stewardRoleName}` : (player?.name ?? "Player");
}

function formatPendingOpeningPlacement(game, player = game.players.find((candidate) => candidate.id === game.activePlayerId)) {
  const pending = player ? getPendingOpeningResourcePlacement(game, player.id) : null;

  return pending ? `${pending.role.name}: ${pending.summary}` : "";
}

function formatPendingStewardHousePlacement(game, player = game.players.find((candidate) => candidate.id === game.activePlayerId)) {
  const pending = player ? getPendingStewardHousePlacement(game, player.id) : null;

  return pending ? `${pending.role.name}: ${pending.summary}` : "";
}

function createRedealSeed() {
  const bytes = new Uint32Array(2);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff);
    bytes[1] = Math.floor(Math.random() * 0xffffffff);
  }

  const timePart = Date.now().toString(36);
  const randomPart = [...bytes].map((value) => value.toString(36)).join("-");

  return `playtest-${timePart}-${randomPart}`;
}

function resetLocalTestingControls() {
  state.debugSeedSelections = {};
  state.debugSeedPosition = SEED_PACKET_POSITIONS.TOP;
  state.burdenPayments = {};
  state.burdenChoiceDecisions = {};
  state.boonStrainReliefTargets = {};
  state.boonExchangePayments = {};
  state.boonExchangeGains = {};
  state.boonExchangeAmounts = {};
  state.boonStewardHelpGains = {};
  state.goldenScrollDiscards = {};
  state.goldenSignetMoves = {};
  state.placementCostChoices = {};
  state.placementCostDiscounts = {};
  state.burdenResolutionDiscounts = {};
  state.arrivalRequirementDiscounts = {};
  state.upgradeCostChoices = {};
  state.upgradeCostDiscounts = {};
  state.activationTargets = {};
  state.activationPayments = {};
  state.activationGains = {};
  state.activationExchangeAmounts = {};
  state.stewardPlacementPowerId = "";
  state.stewardActivationPowerId = "";
  state.stewardUpgradePowerId = "";
  state.stewardBurdenPowerIds = {};
  state.stewardExchangePayments = {};
  state.stewardExchangeGains = {};
  state.stewardExchangeAmounts = {};
  state.pendingPlacementPreview = null;
  state.pendingPairedPlacement = null;
  state.contextMenu = null;
  state.seedContextMenu = null;
}

function getSelectedMapOption() {
  return state.data?.mapOptions.find((option) => option.id === state.selectedMapId) ?? state.data?.mapOptions[0] ?? null;
}

function getSelectedMapHexes() {
  return getSelectedMapOption()?.hexes ?? state.data?.mapHexes ?? [];
}

function refreshActiveMapData() {
  if (!state.data) {
    return;
  }

  state.data = {
    ...state.data,
    mapHexes: getSelectedMapHexes()
  };
}

function syncSelectedCoordinate() {
  const mapHexes = getSelectedMapHexes();

  if (!mapHexes.some((hex) => hex.Coordinate === state.selectedCoordinate)) {
    state.selectedCoordinate = mapHexes[0]?.Coordinate ?? "";
  }
}

function syncStewardRoleIds() {
  state.stewardRoleIds = normalizeStewardRoleIds(state.playerCount, state.stewardRoleIds);
}

function createGame(options = {}) {
  if (!state.data) {
    return;
  }

  refreshActiveMapData();
  syncSelectedCoordinate();
  syncStewardRoleIds();

  state.game = createInitialGameState({
    playerCount: state.playerCount,
    seed: state.setupSeed,
    encounterCards: state.data.encounterCards,
    tiles: state.data.tiles,
    mapHexes: getSelectedMapHexes(),
    stewardRoles: state.stewardRoleIds,
    setupStewardHousePlacement: options.setupStewardHousePlacement === true,
    enforceOpeningResourcePlacement: false
  });
  clearGameHistory();
  state.lastActionResult = null;
  resetLocalTestingControls();
  syncSelectedTile();
}

function isPlaySessionSetup() {
  return state.playSessionState === PLAY_SESSION_STATES.SETUP;
}

function isPlaySessionPlaying() {
  return state.playSessionState === PLAY_SESSION_STATES.PLAYING;
}

function isPlaySessionEnded() {
  return state.playSessionState === PLAY_SESSION_STATES.ENDED;
}

function getPlaySessionLabel() {
  return PLAY_SESSION_LABELS[state.playSessionState] ?? PLAY_SESSION_LABELS[PLAY_SESSION_STATES.SETUP];
}

function getPlaySessionBlockReason() {
  return isPlaySessionEnded() ? "Playthrough ended. Reset Game to start again." : "Start Game before taking play actions.";
}

function confirmPlaySessionChange(message) {
  return typeof globalThis.confirm !== "function" || globalThis.confirm(message);
}

function setBlockedPlaySessionResult(action = "PLAY_SESSION_LOCKED") {
  state.lastActionResult = {
    ok: false,
    action,
    errors: [getPlaySessionBlockReason()]
  };
}

function startPlaySession() {
  if (!state.data) {
    return;
  }

  if (!isPlaySessionSetup()) {
    setBlockedPlaySessionResult("START_GAME");
    renderApp();
    return;
  }

  if (!confirmPlaySessionChange("Start this playthrough with the current setup?")) {
    return;
  }

  createGame({ setupStewardHousePlacement: true });
  state.playSessionState = PLAY_SESSION_STATES.PLAYING;
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.pendingPlacementPreview = null;
  state.pendingPairedPlacement = null;
  state.activeWorkspace = TABLE_WORKSPACES.STEWARDS;
  state.lastActionResult = {
    ok: true,
    action: "START_GAME",
    message: "Playthrough started. Place each Steward token for free, then seed Encounter Cards."
  };
  renderApp();
}

function endPlaySession() {
  if (!state.game || isPlaySessionEnded()) {
    return;
  }

  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("END_GAME");
    renderApp();
    return;
  }

  if (!confirmPlaySessionChange("End this playthrough now? The board will stay visible for review.")) {
    return;
  }

  rememberGameStateForUndo("END_GAME");
  state.playSessionState = PLAY_SESSION_STATES.ENDED;
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.pendingPlacementPreview = null;
  state.pendingPairedPlacement = null;
  state.activeWorkspace = TABLE_WORKSPACES.ENCOUNTERS;
  state.lastActionResult = {
    ok: true,
    action: "END_GAME",
    message: "Playthrough ended. Review the table, then Reset Game for a fresh setup."
  };
  renderApp();
}

function resetPlaySession() {
  if (!state.data) {
    return;
  }

  const needsConfirm = !isPlaySessionSetup();

  if (needsConfirm && !confirmPlaySessionChange("Reset this playthrough and return to setup?")) {
    return;
  }

  clearLocalPlaytestState();
  state.playSessionState = PLAY_SESSION_STATES.SETUP;
  createGame();
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.pendingPlacementPreview = null;
  state.pendingPairedPlacement = null;
  state.activeWorkspace = TABLE_WORKSPACES.STEWARDS;
  state.lastActionResult = {
    ok: true,
    action: "RESET_GAME",
    message: "Reset to setup. Choose players and Stewards, deal cards if needed, then start when ready."
  };
  renderApp();
}

function getPlacementOptions() {
  if (!state.data || !state.game) {
    return [];
  }

  const supplyByTileId = new Map(
    [...state.game.tileSupply.core, ...state.game.tileSupply.special].map((entry) => [entry.tileId, entry])
  );
  const directCoreTileIds = new Set(getDirectlyPlaceableTiles(state.data.tiles).map((tile) => tile.tile_id));
  const unlockedCoreTiles = state.data.tiles.filter((tile) => {
    const supply = supplyByTileId.get(tile.tile_id);

    return (
      tile.tile_source_type === "Core" &&
      tile.side === "Basic" &&
      supply &&
      !supply.locked &&
      (directCoreTileIds.has(tile.tile_id) || supply.unlockedBySteward)
    );
  });
  const unlockedSpecialTiles = state.data.tiles.filter((tile) => {
    const supply = supplyByTileId.get(tile.tile_id);
    return tile.tile_source_type === "Special" && supply && !supply.locked;
  });

  return [...unlockedCoreTiles, ...unlockedSpecialTiles].map((tile) => ({
    tile,
    supply: supplyByTileId.get(tile.tile_id)
  }));
}

function syncSelectedTile() {
  const openingRequirement = state.game ? getOpeningPlacementRequirementForActivePlayer(state.game) : null;
  const stewardHouseRequirement = state.game ? getStewardHousePlacementRequirementForActivePlayer(state.game) : null;
  const options = getPlacementOptions().filter(
    ({ tile }) =>
      (!stewardHouseRequirement || tile.tile_id === stewardHouseRequirement.tileId) &&
      (!openingRequirement || isOpeningResourceTileForPlayer(openingRequirement.player, tile.tile_id))
  );
  const current = options.find((option) => option.tile.tile_id === state.selectedTileId && option.supply?.available > 0);
  const next = options.find((option) => option.supply?.available > 0) ?? options[0];

  if (!current) {
    state.selectedTileId = next?.tile.tile_id ?? null;
  }
}

function hexCenter(hex, size, mapHexes) {
  const { columnIndex, rowIndex } = parseCoordinate(hex.Coordinate, mapHexes);
  const hexHeight = Math.sqrt(3) * size;
  const margin = 40;

  return {
    x: margin + size + columnIndex * size * 1.5,
    y: margin + hexHeight / 2 + rowIndex * hexHeight + (columnIndex % 2 === 1 ? hexHeight / 2 : 0)
  };
}

function hexPoints(center, size) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index);
    return `${(center.x + size * Math.cos(angle)).toFixed(2)},${(center.y + size * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

function terrainShortName(terrain) {
  const names = {
    "Arable Land": "Arable",
    Grasslands: "Grass",
    Mountains: "Mount",
    Woodland: "Wood",
    Heaths: "Heath",
    Ruins: "Ruins",
    Water: "Water"
  };

  return names[terrain] ?? terrain;
}

function featureLabel(hex) {
  if (!hex.Feature || hex.Feature === "None") {
    return "";
  }

  if (hex.Terrain === "Water") {
    return "";
  }

  if (hex.Feature === "Bridge Candidate") {
    return "Bridge note";
  }

  if (hex.Feature === "River Fork") {
    return "Fork";
  }

  return hex.Feature;
}

function normalizeMapTileName(tileName) {
  return String(tileName ?? "").replace(/^The\s+/i, "").trim();
}

function wrapMapLabel(label, maxLineLength = 12, maxLines = 3) {
  const words = normalizeMapTileName(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length <= maxLineLength) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(word);
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  const consumedText = lines.join(" ");
  const fullText = words.join(" ");

  if (lines.length > 0 && consumedText.length < fullText.length) {
    const lastLine = lines.at(-1) ?? "";
    lines[lines.length - 1] =
      lastLine.length > maxLineLength - 3
        ? `${lastLine.slice(0, Math.max(1, maxLineLength - 3))}...`
        : `${lastLine}...`;
  }

  return lines;
}

function renderWrappedMapLabel(label, className, x, y, maxLineLength = 12, maxLines = 3) {
  const lines = wrapMapLabel(label, maxLineLength, maxLines);

  if (lines.length === 0) {
    return "";
  }

  const lineHeight = 8;
  const startY = y - ((lines.length - 1) * lineHeight) / 2;

  return `
    <text class="${escapeHtml(className)}" x="${x}" y="${startY.toFixed(2)}">
      ${lines
        .map(
          (line, index) =>
            `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`
        )
        .join("")}
    </text>
  `;
}

const PLAYER_MARKER_FILLS = ["#24362e", "#9d2f2f", "#5e72b7", "#7d3f12"];

function getPlacedTileAnchorCoordinate(placedTile) {
  return placedTile?.coordinate ?? placedTile?.coordinates?.[0] ?? null;
}

function getPlayerMapMarkerCoordinate(game, player) {
  const interaction = player?.lastInteraction;

  if (interaction?.placedTileId) {
    const placedTile = game.map.placedTiles.find((tile) => tile.id === interaction.placedTileId);
    const anchorCoordinate = getPlacedTileAnchorCoordinate(placedTile);

    if (anchorCoordinate) {
      return anchorCoordinate;
    }
  }

  return (
    interaction?.coordinate ??
    player?.stewardHousePlacement?.tokenCoordinate ??
    player?.stewardHousePlacement?.coordinate ??
    null
  );
}

function getPlayersByMapCoordinate(game) {
  return (game.players ?? []).reduce((playersByCoordinate, player) => {
    const coordinate = getPlayerMapMarkerCoordinate(game, player);

    if (!coordinate) {
      return playersByCoordinate;
    }

    const players = playersByCoordinate.get(coordinate) ?? [];
    players.push(player);
    playersByCoordinate.set(coordinate, players);
    return playersByCoordinate;
  }, new Map());
}

function getPlayerMarkerFill(playerId) {
  const playerNumber = Number(String(playerId).replace(/\D/g, ""));
  const index = Number.isInteger(playerNumber) && playerNumber > 0 ? playerNumber - 1 : 0;
  return PLAYER_MARKER_FILLS[index % PLAYER_MARKER_FILLS.length];
}

function formatPlayerMarkerLabel(player) {
  const playerLabel = player?.id ?? "P?";
  const roleName = player?.stewardRoleName ?? getStewardRole(player?.stewardRoleId)?.name ?? "Steward";

  return `${playerLabel} ${roleName}`;
}

function renderPlayerMapMarkers(players, center, game) {
  if (players.length === 0) {
    return "";
  }

  const spacing = 22;
  const startX = -((players.length - 1) * spacing) / 2;

  return `
    <g class="player-map-markers" aria-label="Steward token markers">
      ${players
        .map(
          (player, index) => {
            const isInactive =
              game.phase === GAME_PHASES.PLAYER_TURNS &&
              game.activePlayerId &&
              player.id !== game.activePlayerId;

            return `
            <g
              class="player-map-marker ${isInactive ? "is-inactive" : "is-active"}"
              transform="translate(${(center.x + startX + index * spacing).toFixed(2)} ${(center.y - 18).toFixed(2)})"
              aria-label="${escapeHtml(`${formatPlayerMarkerLabel(player)} token`)}"
              style="--marker-fill: ${escapeHtml(getPlayerMarkerFill(player.id))}"
            >
              <circle r="7"></circle>
              <text class="player-map-marker-id" y="3">${escapeHtml(player.id)}</text>
              <text class="player-map-marker-name" y="14">${escapeHtml(player.stewardRoleName ?? "Steward")}</text>
            </g>
          `;
          }
        )
        .join("")}
    </g>
  `;
}

function renderStrainMapMarker(placedTile, center) {
  const strain = Number(placedTile?.strain ?? 0);

  if (strain <= 0) {
    return "";
  }

  const overstrained = isOverstrainedPlacedTile(placedTile);
  const label = overstrained ? "!" : String(strain);

  return `
    <g
      class="strain-map-marker ${overstrained ? "is-overstrained" : ""}"
      transform="translate(${(center.x + 18).toFixed(2)} ${(center.y - 17).toFixed(2)})"
      aria-label="${escapeHtml(overstrained ? "Overstrained tile" : `${strain} Strain`)}"
    >
      <circle r="8"></circle>
      <text y="3">${escapeHtml(label)}</text>
    </g>
  `;
}

function renderSupportMapMarker(center) {
  return `
    <g
      class="support-map-marker"
      transform="translate(${(center.x - 18).toFixed(2)} ${(center.y - 17).toFixed(2)})"
      aria-label="Supported tile"
    >
      <circle r="7"></circle>
      <text y="3">S</text>
    </g>
  `;
}

function renderOpeningSiteMarker(center, option) {
  const tileName = option?.tile?.tile_name ?? "Tile";
  const tileLabel = normalizeMapTileName(tileName).split(/\s+/)[0] ?? tileName;

  return `
    <g
      class="opening-site-marker"
      transform="translate(${center.x.toFixed(2)} ${(center.y + 12).toFixed(2)})"
      aria-label="${escapeHtml(`Opening site for ${tileName}`)}"
    >
      <rect x="-22" y="-12" width="44" height="24" rx="8"></rect>
      <text class="opening-site-main" y="-2">Start</text>
      <text class="opening-site-tile" y="8">${escapeHtml(tileLabel)}</text>
    </g>
  `;
}

function renderStewardHouseSiteMarker(center, option) {
  const roleName = option?.role?.name ?? option?.pending?.role?.name ?? "Steward";

  return `
    <g
      class="steward-house-site-marker"
      transform="translate(${center.x.toFixed(2)} ${(center.y + 12).toFixed(2)})"
      aria-label="${escapeHtml(`Setup site for ${roleName} token`)}"
    >
      <rect x="-24" y="-12" width="48" height="24" rx="8"></rect>
      <text class="opening-site-main" y="-2">Token</text>
      <text class="opening-site-tile" y="8">${escapeHtml(roleName)}</text>
    </g>
  `;
}

function getInteractionActionLabel(type) {
  return (
    {
      place: "Placed",
      activate: "Activated",
      upgrade: "Upgraded",
      setup_token: "Token"
    }[type] ?? "Touched"
  );
}

function formatPlayerLastInteraction(game, tileIndex, player) {
  const interaction = player.lastInteraction;

  if (!interaction) {
    return "No map action yet";
  }

  if (!interaction.placedTileId) {
    return interaction.coordinate
      ? `${getInteractionActionLabel(interaction.type)} at ${interaction.coordinate}`
      : "No map action yet";
  }

  const placedTile = game.map.placedTiles.find((tile) => tile.id === interaction.placedTileId);
  const tile = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const tileName = tile?.tile_name ?? placedTile?.tileId ?? "Unknown tile";
  const coordinate = getPlacedTileAnchorCoordinate(placedTile) ?? interaction.coordinate ?? "unknown hex";

  return `${getInteractionActionLabel(interaction.type)} ${tileName} at ${coordinate}`;
}

function renderHexMap(mapHexes, game, tileIndex) {
  const size = 30;
  const hexHeight = Math.sqrt(3) * size;
  const axes = getMapAxes(mapHexes);
  const width = 40 * 2 + size * 2 + (axes.columns.length - 1) * size * 1.5;
  const height = 40 * 2 + hexHeight * (axes.rows.length + 0.5);
  const selectedCoordinate = state.selectedCoordinate;
  const placedByCoordinate = new Map(
    game.map.placedTiles.flatMap((placedTile) =>
      (placedTile.coordinates ?? [placedTile.coordinate]).map((coordinate) => [coordinate, placedTile])
    )
  );
  const playersByMapCoordinate = getPlayersByMapCoordinate(game);
  const selectedTile = tileIndex.get(state.selectedTileId);
  const previewFootprint = selectedTile
    ? getFootprintCoordinates(selectedCoordinate, selectedTile.size_hexes, state.selectedOrientation, mapHexes)
    : null;
  const previewSet = new Set(previewFootprint ?? []);
  const stewardHouseRequirement = isPlaySessionPlaying()
    ? getStewardHousePlacementRequirementForActivePlayer(game)
    : null;
  const stewardHouseOptionsByCoordinate = stewardHouseRequirement
    ? new Map(
        mapHexes
          .map((hex) => [
            hex.Coordinate,
            getStewardHousePlacementOptionsForCoordinate(game, tileIndex, hex.Coordinate).find(
              (option) => !option.blockedReason
            )
          ])
          .filter(([, option]) => Boolean(option))
      )
    : new Map();
  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);
  const openingOptionsByCoordinate = openingRequirement
    ? new Map(
        mapHexes
          .map((hex) => [
            hex.Coordinate,
            getOpeningPlacementOptionsForCoordinate(game, tileIndex, hex.Coordinate).find(
              (option) => !option.blockedReason
            )
          ])
          .filter(([, option]) => Boolean(option))
      )
    : new Map();

  const hexMarkup = [...mapHexes]
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, mapHexes))
    .map((hex) => {
      const center = hexCenter(hex, size, mapHexes);
      const label = featureLabel(hex);
      const placedTile = placedByCoordinate.get(hex.Coordinate);
      const stewardHouseOption = stewardHouseOptionsByCoordinate.get(hex.Coordinate);
      const openingOption = openingOptionsByCoordinate.get(hex.Coordinate);
      const placedTileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
      const isPlacedTileAnchor = placedTile && hex.Coordinate === getPlacedTileAnchorCoordinate(placedTile);
      const supportDetails = placedTile
        ? getEffectiveSupportDetails(game, placedTile.id, { tileIndex })
        : null;
      const markerPlayers = playersByMapCoordinate.get(hex.Coordinate) ?? [];
      const strain = Number(placedTile?.strain ?? 0);
      const hexStyle = [
        getTerrainFillStyle(hex.Terrain),
        placedTileDefinition ? getMapPlacedTileStyle(placedTileDefinition) : ""
      ]
        .filter(Boolean)
        .join(" ");
      const hexStyleAttribute = hexStyle ? ` style="${escapeHtml(hexStyle)}"` : "";
      const classes = [
        "hex",
        `terrain-${slug(hex.Terrain)}`,
        hex.River_Adjacent_Land ? "river-adjacent-land" : "",
        hex.Bridge_Candidate ? "bridge-candidate" : "",
        previewSet.has(hex.Coordinate) ? "is-footprint-preview" : "",
        placedTile ? "has-placed-tile" : "",
        placedTileDefinition ? `placed-type-${slug(placedTileDefinition.tile_category)}` : "",
        supportDetails?.supported ? "is-supported-tile" : "",
        stewardHouseOption ? "is-steward-house-site" : "",
        openingOption ? "is-opening-site" : "",
        strain > 0 ? "has-strain-tile" : "",
        markerPlayers.length ? "has-player-marker" : "",
        placedTile && isOverstrainedPlacedTile(placedTile) ? "is-overstrained-tile" : "",
        selectedCoordinate === hex.Coordinate ? "is-selected" : ""
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <g class="${classes}"${hexStyleAttribute} data-coordinate="${escapeHtml(hex.Coordinate)}" tabindex="0" role="button" aria-label="${escapeHtml(`${hex.Coordinate} ${hex.Terrain} ${hex.Feature}`)}">
          <polygon points="${hexPoints(center, size)}"></polygon>
          ${
            state.showDebugLabels
              ? `<text class="hex-terrain" x="${center.x}" y="${center.y - 11}">${escapeHtml(terrainShortName(hex.Terrain))}</text>`
              : ""
          }
          ${
            placedTileDefinition
              ? isPlacedTileAnchor
                ? renderWrappedMapLabel(placedTileDefinition.tile_name, "hex-tile", center.x, center.y + 9)
                : ""
              : label
                ? renderWrappedMapLabel(label, "hex-feature", center.x, center.y + 10, 10, 2)
                : ""
          }
          ${isPlacedTileAnchor && supportDetails?.supported ? renderSupportMapMarker(center) : ""}
          ${isPlacedTileAnchor ? renderStrainMapMarker(placedTile, center) : ""}
          ${stewardHouseOption && !placedTile ? renderStewardHouseSiteMarker(center, stewardHouseOption) : ""}
          ${openingOption && !placedTile ? renderOpeningSiteMarker(center, openingOption) : ""}
          ${renderPlayerMapMarkers(markerPlayers, center, game)}
        </g>
      `;
    })
    .join("");

  return `
    <svg class="map-svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" role="img" aria-label="Approved flat-top hex map">
      ${hexMarkup}
    </svg>
  `;
}

function renderMapKey() {
  return `
    <div class="map-key" aria-label="Map colour key">
      ${TERRAIN_LEGEND_ITEMS.map(
        ({ terrain, label }) => `
          <span class="map-key-item">
            <span class="map-key-swatch terrain-${slug(terrain)}" style="${escapeHtml(getTerrainFillStyle(terrain))}" aria-hidden="true"></span>
            <span>${escapeHtml(label)}</span>
          </span>
        `
      ).join("")}
      <span class="map-key-item">
        <span class="map-key-marker strain" aria-hidden="true">1</span>
        <span>Strain</span>
      </span>
      <span class="map-key-item">
        <span class="map-key-marker supported" aria-hidden="true">S</span>
        <span>Supported</span>
      </span>
      <span class="map-key-item">
        <span class="map-key-marker overstrained" aria-hidden="true">!</span>
        <span>Overstrained</span>
      </span>
      <span class="map-key-item">
        <span class="map-key-marker steward" aria-hidden="true">P</span>
        <span>Steward</span>
      </span>
    </div>
  `;
}

function getOrientationLabel(orientationId) {
  return HEX_DIRECTIONS.find((direction) => direction.id === orientationId)?.label ?? orientationId;
}

function getNextOrientation(orientationId) {
  const currentIndex = HEX_DIRECTIONS.findIndex((direction) => direction.id === orientationId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % HEX_DIRECTIONS.length : 0;
  return HEX_DIRECTIONS[nextIndex].id;
}

function getSelectedPlacementTile(tileIndex) {
  return state.selectedTileId ? tileIndex.get(state.selectedTileId) : null;
}

function isStablesTile(tile) {
  return tile?.tile_name === "Stables";
}

function createStablesPairActionCostForUi() {
  return {
    connected: true,
    disconnectedTravelIgnored: true,
    disconnectedTravelIgnoreReason: "stables_pair_placement",
    placeActionCost: 1,
    disconnectedTravelActionCost: 0,
    total: 1
  };
}

function selectedPlacementTileCanRotate(tileIndex) {
  const selectedTile = getSelectedPlacementTile(tileIndex);
  return Boolean(selectedTile && Number(selectedTile.size_hexes ?? 1) > 1);
}

function getPlacementOrientations(tile) {
  return Number(tile?.size_hexes ?? 1) > 1 ? HEX_DIRECTIONS.map((direction) => direction.id) : [HEX_DIRECTIONS[0].id];
}

function getAutomaticResourceDiscountResources(game, cost, discountEffect, savedResources = []) {
  if (!discountEffect || discountEffect.freeResourceCost) {
    return [];
  }

  const choiceCount = getCostReductionChoiceCount(cost, discountEffect);
  if (choiceCount <= 0) {
    return [];
  }

  const remainingByResource = summarizeResourceCostEntries(cost).reduce((remaining, entry) => {
    remaining.set(entry.resource, entry.amount);
    return remaining;
  }, new Map());
  const choices = [];

  const addChoice = (resource) => {
    const remaining = remainingByResource.get(resource) ?? 0;
    if (choices.length >= choiceCount || remaining <= 0) {
      return false;
    }

    choices.push(resource);
    remainingByResource.set(resource, remaining - 1);
    return true;
  };

  for (const resource of savedResources.filter(Boolean)) {
    addChoice(resource);
  }

  const warehouseResources = game?.warehouse?.resources ?? {};
  for (const entry of cost) {
    const deficit = Math.max(0, Number(entry.amount ?? 0) - Number(warehouseResources[entry.resource] ?? 0));
    for (let index = 0; index < deficit; index += 1) {
      addChoice(entry.resource);
    }
  }

  for (const entry of cost) {
    while (addChoice(entry.resource)) {
      // Keep filling from the printed cost order once affordability deficits are covered.
    }
  }

  return choices;
}

function getAutomaticPlacementCostDiscountResources(game, tile, cost) {
  const discountEffect = getPendingPlacementResourceDiscount(game, tile);
  const eligibleCost = getPlacementDiscountEligibleCost(cost, discountEffect);
  return getAutomaticResourceDiscountResources(game, eligibleCost, discountEffect);
}

function shouldIgnoreDisconnectedTravelForOpeningPlacement(game, tile) {
  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);

  return Boolean(openingRequirement && isOpeningResourceTileForPlayer(openingRequirement.player, tile?.tile_id));
}

function calculateBasePlacementActionCostForUi(game, tile, footprintCoordinates, tileIndex) {
  if (isStablesTile(tile)) {
    return createStablesPairActionCostForUi();
  }

  return calculatePlacementActionCost(game, footprintCoordinates, {
    tileIndex,
    playerId: game.activePlayerId,
    ignoreDisconnectedTravel: shouldIgnoreDisconnectedTravelForOpeningPlacement(game, tile),
    ignoreDisconnectedTravelReason: "opening_placement"
  });
}

function calculatePlacementActionCostForUi(game, tile, footprintCoordinates, tileIndex) {
  const baseActionCost = calculateBasePlacementActionCostForUi(game, tile, footprintCoordinates, tileIndex);
  const tileActionDiscount = getDiscountedTileActionCost(game, tile, "placement", baseActionCost);
  const travelActionDiscount = getDiscountedDisconnectedTravelActionCost(
    game,
    "placement",
    tileActionDiscount.actionCost
  );

  return travelActionDiscount.actionCost;
}

function getPlacementActionCostForMenu(game, tile, footprintCoordinates, tileIndex) {
  return calculatePlacementActionCostForUi(game, tile, footprintCoordinates, tileIndex);
}

function getTerrainMatchedResourceTileId(game, coordinate) {
  const terrain = game.map.hexes.find((hex) => hex.Coordinate === coordinate)?.Terrain;

  return TERRAIN_RESOURCE_TILE_IDS[terrain] ?? null;
}

function getOpeningPlacementRequirementForActivePlayer(game) {
  return getPendingOpeningResourcePlacement(game, game.activePlayerId);
}

function getStewardHousePlacementRequirementForActivePlayer(game) {
  return getPendingStewardHousePlacement(game, game.activePlayerId);
}

function tileMatchesActiveOpeningRequirement(game, tile) {
  const pending = getOpeningPlacementRequirementForActivePlayer(game);

  return !pending || isOpeningResourceTileForPlayer(pending.player, tile?.tile_id);
}

function getContextPlacementOptionRank(option, terrainMatchedResourceTileId) {
  if (option.tile.tile_id === terrainMatchedResourceTileId) {
    return 0;
  }

  if (terrainMatchedResourceTileId && option.tile.tile_category === "Resource") {
    return 1;
  }

  return option.blockedReason ? 3 : 2;
}

function sortContextPlacementOptions(options, terrainMatchedResourceTileId) {
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => {
      const rankDifference =
        getContextPlacementOptionRank(left.option, terrainMatchedResourceTileId) -
        getContextPlacementOptionRank(right.option, terrainMatchedResourceTileId);

      return rankDifference || left.index - right.index;
    })
    .map(({ option }) => option);
}

function getLegalPlacementOptionsForCoordinate(game, tileIndex, coordinate) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);

  if (!isPlaySessionPlaying() || !activePlayer || game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return [];
  }

  const terrainMatchedResourceTileId = getTerrainMatchedResourceTileId(game, coordinate);
  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);

  return sortContextPlacementOptions(
    getPlacementOptions()
      .filter(({ tile }) => !openingRequirement || isOpeningResourceTileForPlayer(openingRequirement.player, tile.tile_id))
      .flatMap(({ tile, supply }) => {
        const placementCostChoiceResources = getDefaultResourceCostChoiceResources(tile.place_cost, game.warehouse);
        const baseCost = resolveResourceCost(tile.place_cost, placementCostChoiceResources, {
          warehouse: game.warehouse
        }).cost;
        const placementCostReductionResources = getAutomaticPlacementCostDiscountResources(game, tile, baseCost);

        return getPlacementOrientations(tile).map((orientation) => {
          const action = {
            type: TILE_ACTION_TYPES.PLACE_TILE,
            tileId: tile.tile_id,
            coordinate,
            orientation,
            placementCostChoiceResources,
            placementCostReductionResources
          };
          const validation = validatePlaceTile(game, action, { tiles: state.data.tiles });

          if (!validation.valid || !validation.footprintCoordinates) {
            return null;
          }

          const actionCost = getPlacementActionCostForMenu(game, tile, validation.footprintCoordinates, tileIndex);
          const pairedStockBlocked = isStablesTile(tile) && (supply?.available ?? 0) < 2;
          const blockedReason = pairedStockBlocked
            ? "Needs both Stables copies available"
            : activePlayer.actionsRemaining < actionCost.total
              ? `Needs ${actionCost.total} Actions; ${activePlayer.name} has ${activePlayer.actionsRemaining}`
              : "";

          return {
            tile,
            supply,
            coordinate,
            orientation,
            actionCost,
            cost: validation.cost,
            footprintCoordinates: validation.footprintCoordinates,
            placementCostChoiceResources,
            placementCostReductionResources,
            resourceCostSubstitution: validation.resourceCostSubstitution,
            blockedReason,
            isTerrainMatchedResource: tile.tile_id === terrainMatchedResourceTileId
          };
        });
      })
      .filter(Boolean),
    terrainMatchedResourceTileId
  );
}

function getOpeningPlacementOptionsForCoordinate(game, tileIndex, coordinate) {
  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);

  if (!openingRequirement) {
    return [];
  }

  return getLegalPlacementOptionsForCoordinate(game, tileIndex, coordinate).filter(
    (option) => isOpeningResourceTileForPlayer(openingRequirement.player, option.tile.tile_id)
  );
}

function getStewardHousePlacementOptionsForCoordinate(game, tileIndex, coordinate) {
  const pending = getStewardHousePlacementRequirementForActivePlayer(game);

  if (!pending) {
    return [];
  }

  const hex = game.map.hexes.find((candidate) => candidate.Coordinate === coordinate);

  if (
    !hex ||
    getPlacedTileAt(game, coordinate) ||
    hex.Terrain === "Water" ||
    !isStewardHousePlacementTerrainForRole(pending.role, hex.Terrain)
  ) {
    return [];
  }

  return [
    {
      role: pending.role,
      coordinate,
      pending,
      blockedReason: ""
    }
  ];
}

function groupPlacementOptionsByCategory(options) {
  const groups = new Map();

  for (const option of options) {
    const category = option.tile.tile_category ?? "Tiles";

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(option);
  }

  return [...groups.entries()];
}

function getPreferredContextPlacementOption(options) {
  return options.find((option) => option.orientation === state.selectedOrientation) ?? options[0];
}

function renderContextPlacementOptionDetails(option, { travelPreview = false } = {}) {
  const isMultihex = Number(option.tile.size_hexes ?? 1) > 1;
  const pairedStables = isStablesTile(option.tile);
  const useTravelPreview = travelPreview && !pairedStables;
  const optionTileIndex = state.data?.tiles ? createTileIndex(state.data.tiles) : null;
  const upgradeTile = optionTileIndex ? findUpgradeTile(option.tile, optionTileIndex) : null;
  const orientationText = isMultihex ? ` · ${getOrientationLabel(option.orientation)}` : "";
  const footprintText = isMultihex ? ` · ${renderFootprint(option.footprintCoordinates)}` : "";
  const choiceText = option.placementCostChoiceResources?.length
    ? ` · pay ${option.placementCostChoiceResources.join(" or ")}`
    : "";
  const discountText = option.placementCostReductionResources.length > 0 ? " · discount applied" : "";
  const substitutionText = option.resourceCostSubstitution
    ? ` · ${option.resourceCostSubstitution.providerTileName ?? "Tile effect"} uses Goods`
    : "";
  const blockedText = option.blockedReason ? ` · ${option.blockedReason}` : "";
  const terrainMatchText = option.isTerrainMatchedResource ? "Terrain match · " : "";
  const actionCostText = pairedStables ? "1 Action" : `${renderActionCost(option.actionCost)} Action`;
  const resourceCostText = renderCost(option.cost);
  const summaryText = useTravelPreview
    ? `${terrainMatchText}Select preview, rotate if needed, then left-click to place${blockedText}`
    : pairedStables
      ? `${terrainMatchText}${option.supply?.available ?? 0}/${option.supply?.stock ?? 0} left · choose 2 sites · 1 Action${blockedText}`
    : `${terrainMatchText}${option.supply?.available ?? 0}/${option.supply?.stock ?? 0} left · ${renderActionCost(option.actionCost)} Action · ${renderCost(option.cost)}${choiceText}${orientationText}${footprintText}${discountText}${substitutionText}${blockedText}`;
  const disabledAttribute = option.blockedReason ? "disabled" : "";
  const titleAttribute = option.blockedReason ? `title="${escapeHtml(option.blockedReason)}"` : "";
  const actionButton = useTravelPreview
    ? `<button
        class="map-context-action${option.blockedReason ? " is-blocked" : ""}"
        data-context-select-tile-id="${escapeHtml(option.tile.tile_id)}"
        data-context-select-coordinate="${escapeHtml(option.coordinate)}"
        data-context-select-orientation="${escapeHtml(option.orientation)}"
        data-context-select-cost-choices="${escapeHtml((option.placementCostChoiceResources ?? []).join("|"))}"
        data-context-select-discounts="${escapeHtml(option.placementCostReductionResources.join("|"))}"
        type="button"
        role="menuitem"
        ${disabledAttribute}
        ${titleAttribute}
      >
        ${option.blockedReason ? "Needs More Actions" : `Preview ${escapeHtml(option.tile.tile_name)}`}
      </button>`
    : `<button
        class="map-context-action${option.blockedReason ? " is-blocked" : ""}"
        data-context-place-tile-id="${escapeHtml(option.tile.tile_id)}"
        data-context-place-coordinate="${escapeHtml(option.coordinate)}"
        data-context-place-orientation="${escapeHtml(option.orientation)}"
        data-context-place-cost-choices="${escapeHtml((option.placementCostChoiceResources ?? []).join("|"))}"
        data-context-place-discounts="${escapeHtml(option.placementCostReductionResources.join("|"))}"
        type="button"
        role="menuitem"
        ${disabledAttribute}
        ${titleAttribute}
      >
        ${option.blockedReason ? "Needs More Actions" : pairedStables ? "Choose First Stables Site" : `Place ${escapeHtml(option.tile.tile_name)}`}
      </button>`;

  return `
    <details class="context-placement-tile type-${slug(option.tile.tile_category)}" style="${escapeHtml(getTileCardAccentStyle(option.tile))}">
      <summary>
        <strong>${escapeHtml(option.tile.tile_name)}</strong>
        <small>${escapeHtml(summaryText)}</small>
      </summary>
      <div class="context-placement-face">
        ${actionButton}
        ${renderTileEffectPreview(option.tile, {
          label: "Cost & Effect",
          className: "context-placement-effect",
          costSummary: [
            { label: "Actions", value: actionCostText },
            { label: "Resources", value: resourceCostText }
          ]
        })}
        ${renderResourceCostSubstitutionNotice(option.resourceCostSubstitution)}
        ${renderStewardHouseUpgradePreview(option.tile, optionTileIndex, { compact: true })}
        ${renderTileFaceSvg(option.tile, { upgradeTile })}
      </div>
    </details>
  `;
}

function renderContextTravelPlacementOptions(options) {
  const byTileId = new Map();

  for (const option of options) {
    const currentOptions = byTileId.get(option.tile.tile_id) ?? [];
    currentOptions.push(option);
    byTileId.set(option.tile.tile_id, currentOptions);
  }

  return [...byTileId.values()]
    .map((tileOptions) => {
      const option = getPreferredContextPlacementOption(tileOptions);
      const needsPreview = Number(option.tile.size_hexes ?? 1) > 1 && !isStablesTile(option.tile);

      return renderContextPlacementOptionDetails(option, { travelPreview: needsPreview });
    })
    .join("");
}

function renderStewardHousePlacementMenu(game, tileIndex, coordinate) {
  const option = getStewardHousePlacementOptionsForCoordinate(game, tileIndex, coordinate)[0] ?? null;
  const pending = getStewardHousePlacementRequirementForActivePlayer(game);

  if (!pending) {
    return `<p class="context-empty-note">No Steward token setup placement is currently pending.</p>`;
  }

  if (!option) {
    return `<p class="context-empty-note">${escapeHtml(`${pending.summary}. Choose a highlighted token hex.`)}</p>`;
  }

  return `
    <div class="context-placement-groups" aria-label="Steward token setup placement">
      <p class="context-empty-note opening-context-note">${escapeHtml(`${pending.summary}. This placement is free.`)}</p>
      <details class="context-placement-group" open>
        <summary>Steward Token <span>1</span></summary>
        <div class="context-placement-options">
          <details class="context-placement-tile type-steward" open>
            <summary>
              <strong>${escapeHtml(`${pending.role.name} token`)}</strong>
              <small>0 Actions · 0 Resources · ${escapeHtml(option.coordinate)}</small>
            </summary>
            <div class="context-placement-face">
              <p class="context-empty-note">This sets ${escapeHtml(pending.player.name)}'s starting Steward location and unlocks their once-per-Season Steward Power immediately.</p>
              <button
                class="map-context-action"
                data-context-place-steward-house-coordinate="${escapeHtml(option.coordinate)}"
                type="button"
                role="menuitem"
              >
                Place ${escapeHtml(pending.role.name)} token
              </button>
            </div>
          </details>
        </div>
      </details>
    </div>
  `;
}

function renderLegalPlacementMenu(game, tileIndex, coordinate) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);

  if (!isPlaySessionPlaying()) {
    return `<p class="context-empty-note">${escapeHtml(getPlaySessionBlockReason())}</p>`;
  }

  if (game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
    return renderStewardHousePlacementMenu(game, tileIndex, coordinate);
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return `<p class="context-empty-note">Tile placement opens during Player Turns.</p>`;
  }

  if (!activePlayer) {
    return `<p class="context-empty-note">No active Steward is ready to place tiles.</p>`;
  }

  const options = getLegalPlacementOptionsForCoordinate(game, tileIndex, coordinate);
  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);

  if (options.length === 0) {
    return `<p class="context-empty-note">${escapeHtml(
      openingRequirement
        ? `Opening move required: ${openingRequirement.summary}. Click a highlighted Start hex.`
        : "No legal tile placements on this hex with the current warehouse, stock, and Actions."
    )}</p>`;
  }

  return `
    <div class="context-placement-groups" aria-label="Legal tile placements">
      ${openingRequirement ? `<p class="context-empty-note opening-context-note">${escapeHtml(`Opening move: ${openingRequirement.summary}.`)}</p>` : ""}
      ${groupPlacementOptionsByCategory(options)
        .map(
          ([category, categoryOptions]) => {
            const isTravelCategory = category === "Travel";
            const visibleCount = isTravelCategory
              ? new Set(categoryOptions.map((option) => option.tile.tile_id)).size
              : categoryOptions.length;

            return `
              <details class="context-placement-group" open>
                <summary>${escapeHtml(category)} <span>${visibleCount}</span></summary>
                <div class="context-placement-options">
                  ${
                    isTravelCategory
                      ? renderContextTravelPlacementOptions(categoryOptions)
                      : categoryOptions
                          .map((option) => renderContextPlacementOptionDetails(option))
                          .join("")
                  }
                </div>
              </details>
            `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderMapUpgradePreview(upgradeTile) {
  if (!upgradeTile) {
    return "";
  }

  const upgradeCost = renderPrintedCostText(upgradeTile.upgrade_cost);

  return `
    <section class="map-upgrade-preview type-${slug(upgradeTile.tile_category)}" style="${escapeHtml(getTileCardAccentStyle(upgradeTile))}" aria-label="Upgrade side preview">
      <header>
        <span>Upgrade Preview</span>
        <strong>${escapeHtml(upgradeTile.tile_name)}</strong>
        <small>${escapeHtml(`Upgrade cost: ${upgradeCost}`)}</small>
      </header>
      ${renderStewardPowerUnlockPanel(upgradeTile, { compact: true })}
      ${renderTileFaceSvg(upgradeTile)}
    </section>
  `;
}

function renderMapUpgradeSection(upgradeTile, upgradeActionStatus) {
  if (!upgradeTile) {
    return `
      <button class="map-context-action is-blocked" data-context-action="upgrade" type="button" role="menuitem" disabled>
        No Upgrade Available
      </button>
    `;
  }

  const blocked = Boolean(upgradeActionStatus?.blockedReason);
  const upgradeLabel = getBlockedActionLabel(`Upgrade to ${upgradeTile.tile_name}`, upgradeActionStatus ?? {});

  return `
    <details class="map-upgrade-details">
      <summary>
        <span>Upgrade</span>
        <strong>${escapeHtml(upgradeTile.tile_name)}</strong>
      </summary>
      <button class="map-context-action${getBlockedActionClass(upgradeActionStatus ?? {})}" data-context-action="upgrade" type="button" role="menuitem" ${blocked ? "disabled" : ""}>
        ${escapeHtml(upgradeLabel)}
      </button>
      ${renderMapUpgradePreview(upgradeTile)}
    </details>
  `;
}

function renderMapCurrentTileSection(tileDefinition, upgradeTile = null) {
  if (!tileDefinition) {
    return "";
  }

  return `
    <details class="map-tile-face-details">
      <summary>
        <span>View Tile Face</span>
        <strong>${escapeHtml(tileDefinition.tile_name)}</strong>
      </summary>
      <section class="map-tile-face-preview type-${slug(tileDefinition.tile_category)}" style="${escapeHtml(getTileCardAccentStyle(tileDefinition))}" aria-label="Current tile face preview">
        ${renderTileFaceSvg(tileDefinition, { upgradeTile })}
      </section>
    </details>
  `;
}

function getMapContextMenuPosition({ x, y, placedTile, upgradeTile }) {
  const viewportWidth = Number(globalThis.innerWidth ?? 1280);
  const viewportHeight = Number(globalThis.innerHeight ?? 720);
  const margin = 8;
  const menuWidth = Math.min(360, viewportWidth - margin * 2);
  const estimatedHeight = placedTile
    ? upgradeTile
      ? Math.min(620, viewportHeight - margin * 2)
      : 190
    : 470;
  const left = clampNumber(Math.round(Number(x ?? margin)), margin, viewportWidth - menuWidth - margin);
  const top = clampNumber(Math.round(Number(y ?? margin)), margin, viewportHeight - estimatedHeight - margin);
  const maxHeight = Math.max(220, viewportHeight - top - margin);

  return {
    left,
    top,
    maxHeight
  };
}

function isPendingTravelPlacementPreview(tile, coordinate) {
  return (
    Boolean(tile) &&
    tile.tile_category === "Travel" &&
    state.pendingPlacementPreview?.tileId === tile.tile_id &&
    state.pendingPlacementPreview?.coordinate === coordinate
  );
}

function renderPendingTravelPlacementMenu(tile) {
  return `
    <p class="context-empty-note">
      ${escapeHtml(`${tile.tile_name} is selected for preview. Rotate if needed, then place it here or cancel.`)}
    </p>
  `;
}

function renderPendingTravelPlacementActions(tile, { canPlace = false, canRotate = false } = {}) {
  return `
    <div class="map-context-preview-actions" aria-label="${escapeHtml(`${tile?.tile_name ?? "Tile"} preview actions`)}">
      <button class="map-context-action" data-context-action="place" type="button" role="menuitem" ${canPlace ? "" : "disabled"}>
        Place Preview
      </button>
      <button class="map-context-action" data-context-action="rotate" type="button" role="menuitem" ${canRotate ? "" : "disabled"}>
        Rotate Preview
      </button>
      <button class="map-context-action" data-context-action="cancel-preview" type="button" role="menuitem">
        Cancel Preview
      </button>
    </div>
  `;
}

function renderPendingPairedPlacementMenu(game, tile, coordinate) {
  const pending = state.pendingPairedPlacement;
  const validation = validatePlaceTile(
    game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: pending.tileId,
      coordinate,
      orientation: HEX_DIRECTIONS[0].id
    },
    { tiles: state.data.tiles }
  );
  const blockedReason = coordinate === pending.coordinate
    ? "Choose a different hex for the second Stables."
    : validation.valid
      ? ""
      : validation.errors[0];

  return `
    <p class="context-empty-note">
      ${escapeHtml(`${tile?.tile_name ?? "Stables"} first site is ${pending.coordinate}. Choose the second site to place both for one action.`)}
    </p>
    <button class="map-context-action${blockedReason ? " is-blocked" : ""}" data-context-action="place-paired-stables" type="button" role="menuitem" ${blockedReason ? "disabled" : ""}>
      ${escapeHtml(blockedReason || `Place both Stables: ${pending.coordinate} + ${coordinate}`)}
    </button>
    <button class="map-context-action" data-context-action="cancel-preview" type="button" role="menuitem">
      Cancel Stables
    </button>
  `;
}

function renderMapContextLayer(game, tileIndex) {
  if (!state.contextMenu) {
    return "";
  }

  const placedTile = state.contextMenu.placedTileId
    ? game.map.placedTiles.find((tile) => tile.id === state.contextMenu.placedTileId)
    : null;
  const tileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const upgradeTile = tileDefinition ? findUpgradeTile(tileDefinition, tileIndex) : null;
  const activation = tileDefinition ? getActivationForDisplay(tileDefinition) : null;
  const selectedPlacementTile = getSelectedPlacementTile(tileIndex);
  const coordinate = state.contextMenu.coordinate ?? getPlacedTileAnchorCoordinate(placedTile);
  const menuPosition = getMapContextMenuPosition({
    x: state.contextMenu.x,
    y: state.contextMenu.y,
    placedTile,
    upgradeTile
  });
  const selectedPlacementCostChoices = selectedPlacementTile
    ? getPlacementCostChoiceAction(selectedPlacementTile.tile_id, selectedPlacementTile.place_cost)
    : [];
  const placementCost = selectedPlacementTile
    ? parseResourceCostForDisplay(selectedPlacementTile.place_cost, selectedPlacementCostChoices).cost
    : [];
  const placementResourceDiscount = getPendingPlacementResourceDiscount(game, selectedPlacementTile);
  const placementCostDiscountChoices = selectedPlacementTile
    ? getPlacementCostDiscountChoices(selectedPlacementTile.tile_id, placementCost, placementResourceDiscount)
    : [];
  const placementCostDiscountReady = placementCostDiscountChoices.every((resource) => Boolean(resource));
  const canAttemptPlacement =
    isPlaySessionPlaying() &&
    Boolean(!placedTile && selectedPlacementTile && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    tileMatchesActiveOpeningRequirement(game, selectedPlacementTile) &&
    placementCostDiscountReady;
  const canRotatePreview = isPlaySessionPlaying() && !placedTile && selectedPlacementTileCanRotate(tileIndex);
  const pendingTravelPreview = !placedTile && isPendingTravelPlacementPreview(selectedPlacementTile, coordinate);
  const pendingPairedPlacement = !placedTile && state.pendingPairedPlacement;
  const activationActionStatus = placedTile
    ? getMapActivationActionStatus(game, placedTile, tileDefinition, tileIndex, activation)
    : { blockedReason: "" };
  const upgradeActionStatus = placedTile
    ? getMapUpgradeActionStatus(game, placedTile, tileDefinition, upgradeTile, tileIndex)
    : { blockedReason: "" };
  const activationLabel = getBlockedActionLabel(
    formatMapActivationActionLabel(activation),
    activationActionStatus
  );

  return `
    <button class="map-context-backdrop" type="button" aria-label="Close map actions"></button>
    <aside class="map-context-menu" style="left: ${menuPosition.left}px; top: ${menuPosition.top}px; max-height: ${menuPosition.maxHeight}px;" role="menu" aria-label="Map actions">
      <header>
        <strong>${escapeHtml(tileDefinition?.tile_name ?? selectedPlacementTile?.tile_name ?? "Empty hex")}</strong>
        <small>${escapeHtml(coordinate)}</small>
      </header>
      ${
        placedTile
          ? `
            <button class="map-context-action${getBlockedActionClass(activationActionStatus)}" data-context-action="activate" type="button" role="menuitem" ${activationActionStatus.blockedReason ? "disabled" : ""}>
              ${escapeHtml(activationLabel)}
            </button>
            ${renderMapCurrentTileSection(tileDefinition, upgradeTile)}
            ${renderMapUpgradeSection(upgradeTile, upgradeActionStatus)}
          `
          : `
            ${
              pendingPairedPlacement
                ? renderPendingPairedPlacementMenu(game, selectedPlacementTile, coordinate)
                : pendingTravelPreview
                  ? `
                    ${renderPendingTravelPlacementMenu(selectedPlacementTile)}
                    ${renderPendingTravelPlacementActions(selectedPlacementTile, {
                      canPlace: canAttemptPlacement,
                      canRotate: canRotatePreview
                    })}
                  `
                  : renderLegalPlacementMenu(game, tileIndex, coordinate)
            }
            ${
              pendingTravelPreview || pendingPairedPlacement
                ? ""
                : `<button class="map-context-action" data-context-action="place" type="button" role="menuitem" ${canAttemptPlacement ? "" : "disabled"}>
                    Place Selected Tile
                  </button>`
            }
            ${
              !pendingTravelPreview && canRotatePreview
                ? `<button class="map-context-action" data-context-action="rotate" type="button" role="menuitem">
                    Rotate Multihex Preview
                  </button>`
                : ""
            }
          `
      }
    </aside>
  `;
}

function renderSeedCardContextLayer(encounterIndex) {
  if (!state.seedContextMenu) {
    return "";
  }

  const { playerId, cardId } = state.seedContextMenu;
  const player = state.game?.players.find((candidate) => candidate.id === playerId);
  const card = encounterIndex.get(cardId);

  if (!player || !card || !player.hand.includes(cardId)) {
    return "";
  }

  const { left, top } = getSeedContextMenuPosition(state.seedContextMenu);

  return `
    <button class="seed-context-backdrop" type="button" aria-label="Close seed menu"></button>
    <aside class="seed-context-menu" style="left: ${left}px; top: ${top}px;" role="menu" aria-label="Seed card position">
      <header>
        <strong>${escapeHtml(card.card_name ?? cardId)}</strong>
        <small>${escapeHtml(formatPlayerName(player))}</small>
      </header>
      ${getRequiredSeasonalSeedPositions(state.game, player)
        .map(
          (position) => `
            <button
              class="seed-context-action"
              data-seed-player-id="${escapeHtml(playerId)}"
              data-seed-card-id="${escapeHtml(cardId)}"
              data-seed-position="${escapeHtml(position)}"
              type="button"
              role="menuitem"
            >
              ${escapeHtml(SEED_PACKET_POSITION_LABELS[position] ?? position)}
            </button>
          `
        )
        .join("")}
    </aside>
  `;
}

function getSeedContextMenuPosition(menuState) {
  const viewportWidth = Number(globalThis.innerWidth ?? 1280);
  const viewportHeight = Number(globalThis.innerHeight ?? 720);
  const margin = 8;
  const menuWidth = Math.min(260, viewportWidth - margin * 2);
  const estimatedHeight = Math.min(290, viewportHeight - margin * 2);

  return {
    left: clampNumber(Math.round(Number(menuState?.x ?? margin)), margin, viewportWidth - menuWidth - margin),
    top: clampNumber(Math.round(Number(menuState?.y ?? margin)), margin, viewportHeight - estimatedHeight - margin)
  };
}

function renderBadgeList(items, className = "") {
  return `
    <div class="badge-list ${className}">
      ${items.map((item) => `<button class="coordinate-badge" data-coordinate="${escapeHtml(item.Coordinate)}">${escapeHtml(item.Coordinate)}</button>`).join("")}
    </div>
  `;
}

function renderCounts(countValidation) {
  return Object.entries(countValidation.actual)
    .map(([key, count]) => {
      const expected = countValidation.expected[key];
      const ok = count === expected;
      return `<li><span>${escapeHtml(key)}</span><strong class="${ok ? "ok" : "bad"}">${count}/${expected}</strong></li>`;
    })
    .join("");
}

function renderTerrainSummary(mapHexes) {
  return Object.entries(summarizeTerrain(mapHexes))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([terrain, count]) => `<li><span>${escapeHtml(terrain)}</span><strong>${count}</strong></li>`)
    .join("");
}

function renderCoordinateTable(mapHexes, selectedHex) {
  return [...mapHexes]
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, mapHexes))
    .map((hex) => {
      const selected = selectedHex?.Coordinate === hex.Coordinate ? "is-active" : "";
      return `
        <tr class="${selected}" data-coordinate="${escapeHtml(hex.Coordinate)}">
          <td><button class="table-coordinate" data-coordinate="${escapeHtml(hex.Coordinate)}">${escapeHtml(hex.Coordinate)}</button></td>
          <td>${escapeHtml(hex.Terrain)}</td>
          <td>${escapeHtml(hex.Feature)}</td>
        </tr>
      `;
    })
    .join("");
}

function orderedEncounterCounts(counts) {
  return [ENCOUNTER_TYPES.BOON, ENCOUNTER_TYPES.BURDEN, ENCOUNTER_TYPES.ARRIVAL, ENCOUNTER_TYPES.GOLDEN_BOON]
    .filter((type) => counts[type])
    .map((type) => [type, counts[type]]);
}

function renderTypeChips(counts) {
  const entries = orderedEncounterCounts(counts);

  if (entries.length === 0) {
    return `<span class="empty-note">None</span>`;
  }

  return `
    <div class="type-chips">
      ${entries
        .map(([type, count]) => `<span class="type-chip type-${slug(type)}">${escapeHtml(type)} <strong>${count}</strong></span>`)
        .join("")}
    </div>
  `;
}

const COVERAGE_STATUS_LABELS = Object.freeze({
  supported: "Supported",
  partial: "Partial",
  unsupported: "Unsupported"
});

function renderEncounterCoverageSummary(audit) {
  const counts = audit.statusCounts;

  return `
    <ul class="metric-list compact-metrics">
      <li><span>Total Cards</span><strong>${audit.total}</strong></li>
      <li><span>Supported</span><strong class="ok">${counts.supported}</strong></li>
      <li><span>Partial</span><strong class="warn">${counts.partial}</strong></li>
      <li><span>Unsupported</span><strong class="bad">${counts.unsupported}</strong></li>
    </ul>
  `;
}

function renderEncounterCoverageByType(audit) {
  return `
    <div class="coverage-type-grid">
      ${Object.entries(audit.typeCounts)
        .map(
          ([type, summary]) => `
            <div class="coverage-type-row type-${slug(type)}">
              <strong>${escapeHtml(type)}</strong>
              <span>${summary.statuses.supported}/${summary.total} supported</span>
              ${
                summary.statuses.partial || summary.statuses.unsupported
                  ? `<small>${summary.statuses.partial} partial, ${summary.statuses.unsupported} unsupported</small>`
                  : `<small>Complete</small>`
              }
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderEncounterCoverageRows(cards) {
  return cards
    .map((card) => {
      const statusLabel = COVERAGE_STATUS_LABELS[card.status] ?? card.status;
      const templates = card.implementationAreas?.length ? card.implementationAreas.join(", ") : "None";

      return `
        <tr>
          <td><span class="coverage-status coverage-${escapeHtml(card.status)}">${escapeHtml(statusLabel)}</span></td>
          <td>${escapeHtml(card.encounterType)}</td>
          <td>
            <strong>${escapeHtml(card.cardName)}</strong>
            <small>${escapeHtml(card.reason)}</small>
          </td>
          <td>${escapeHtml(templates)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderEncounterCoveragePanel(data, game) {
  const audit = createEncounterCoverageAudit(data.encounterCards, {
    tiles: data.tiles,
    resources: game.rules.resources
  });

  return `
    <details class="panel-section debug-details">
      <summary>Encounter Coverage</summary>
      ${renderEncounterCoverageSummary(audit)}
      ${renderEncounterCoverageByType(audit)}
      <div class="coverage-table-wrap">
        <table class="coverage-table">
          <thead><tr><th>Status</th><th>Type</th><th>Card</th><th>Template</th></tr></thead>
          <tbody>${renderEncounterCoverageRows(audit.cards)}</tbody>
        </table>
      </div>
    </details>
  `;
}

function getCards(cardIds, encounterIndex) {
  return resolveEncounterCards(cardIds, encounterIndex);
}

function renderSourceLines(title, lines) {
  const visibleLines = lines.filter(({ value }) => value !== null && value !== undefined && value !== "");

  if (visibleLines.length === 0) {
    return "";
  }

  return `
    <div class="source-text">
      <strong>${escapeHtml(title)}</strong>
      ${visibleLines
        .map(({ label, value }) => `<span><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`)
        .join("")}
    </div>
  `;
}

function renderEncounterSourceText(card, season, prototypeText = "") {
  if (!card) {
    return "";
  }

  return renderSourceLines("Card Says", getEncounterRuleLines(card, season, prototypeText));
}

function renderEncounterFlavorText(card, { compact = false } = {}) {
  const flavorText = getEncounterFlavorText(card);

  if (!flavorText) {
    return "";
  }

  return `<p class="encounter-flavor${compact ? " compact" : ""}">${escapeHtml(flavorText)}</p>`;
}

const ENCOUNTER_SEASON_ROWS = Object.freeze([
  Object.freeze({ season: "I", field: "season_i" }),
  Object.freeze({ season: "II", field: "season_ii" }),
  Object.freeze({ season: "III", field: "season_iii" })
]);

const ENCOUNTER_TYPE_MARKS = Object.freeze({
  [ENCOUNTER_TYPES.BOON]: "B",
  [ENCOUNTER_TYPES.BURDEN]: "!",
  [ENCOUNTER_TYPES.ARRIVAL]: "A",
  [ENCOUNTER_TYPES.GOLDEN_BOON]: "G"
});

function normalizeDisplayText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function renderCardTextBlock(value) {
  const text = normalizeDisplayText(value);

  if (!text) {
    return "";
  }

  return text
    .split(/\n+/)
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");
}

function getEncounterTypeMark(encounterType) {
  return ENCOUNTER_TYPE_MARKS[encounterType] ?? "?";
}

function isPendingBurdenRevealChoice(effect) {
  return BURDEN_REVEAL_CHOICE_TYPES.includes(effect?.type);
}

function getPendingBurdenRevealChoices(game) {
  return game.encounter.active.filter(
    (activeState) =>
      activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
      !activeState.resolved &&
      isPendingBurdenRevealChoice(activeState.pendingChoice)
  );
}

function getActiveEncounterStatusText(activeState, burdenResolution) {
  if (!activeState) {
    return "";
  }

  if (Number.isInteger(activeState.timerTokens)) {
    return `${activeState.timerTokens} timers`;
  }

  if (activeState.pendingChoice) {
    return "Choice pending";
  }

  if (activeState.encounterType === ENCOUNTER_TYPES.BURDEN) {
    const applications = activeState.applications?.length ?? 0;
    return burdenResolution?.supported
      ? `${applications} applications - ${formatBurdenResolutionLabel(burdenResolution)}`
      : `${applications} applications`;
  }

  if (activeState.effect) {
    return activeState.encounterType === ENCOUNTER_TYPES.GOLDEN_BOON ? "Golden choice pending" : "Boon choice pending";
  }

  return activeState.encounterType ?? "";
}

function isDefaultBoonLifecycle(lifecycleText) {
  return /^Resolve the current Season effect, then discard this card\.?$/i.test(normalizeDisplayText(lifecycleText));
}

function renderEncounterSeasonRows(card, game, { burden = false } = {}) {
  const resolveRows = burden ? getBurdenSeasonResolveRows(card) : {};

  return `
    <div class="encounter-season-rows ${burden ? "burden-season-rows" : "boon-season-rows"}">
      ${ENCOUNTER_SEASON_ROWS.map(({ season, field }) => {
        const effectText = normalizeDisplayText(card?.[field]);
        const resolveText = resolveRows[season] ?? "";

        if (!effectText && !resolveText) {
          return "";
        }

        return `
          <section class="encounter-season-row ${game.season === season ? "is-current" : ""}">
            <span class="season-marker">${season}</span>
            <div class="season-copy">
              ${effectText ? `<p>${escapeHtml(effectText)}</p>` : ""}
              ${resolveText ? `<p class="season-resolve-text"><b>To resolve:</b> ${escapeHtml(resolveText)}</p>` : ""}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function extractBurdenResolveText(card) {
  const lifecycle = normalizeDisplayText(card?.lifecycle_or_resolution);
  const match = lifecycle.match(/To resolve:\s*([\s\S]*)/i);

  return normalizeDisplayText(match?.[1]);
}

function applyChoiceLanguageToSeasonCost(basePaymentText, seasonCostText) {
  if (/resources of your choice/i.test(basePaymentText) && /resources/i.test(seasonCostText)) {
    return seasonCostText.replace(/resources/i, "resources of your choice");
  }

  return seasonCostText;
}

function getBurdenSeasonResolveRows(card) {
  const resolveText = extractBurdenResolveText(card);

  if (!resolveText) {
    return {};
  }

  const seasonalMatch = resolveText.match(
    /^Spend 1 Action and pay (.*?) based on the current Season:\s*Season I\s+([^;]+);\s*Season II\s+([^;]+);\s*Season III\s+([^.;]+)\.?\s*(.*)$/i
  );

  if (!seasonalMatch) {
    return Object.fromEntries(ENCOUNTER_SEASON_ROWS.map(({ season }) => [season, resolveText]));
  }

  const [, basePaymentText, seasonOneCost, seasonTwoCost, seasonThreeCost, trailingText] = seasonalMatch;
  const trailing = normalizeDisplayText(trailingText);
  const format = (seasonCostText) => {
    const cost = applyChoiceLanguageToSeasonCost(basePaymentText, normalizeDisplayText(seasonCostText));
    return normalizeDisplayText(`Spend 1 Action and pay ${cost}. ${trailing}`);
  };

  return {
    I: format(seasonOneCost),
    II: format(seasonTwoCost),
    III: format(seasonThreeCost)
  };
}

function renderBoonMechanics(card, game) {
  const footer = isDefaultBoonLifecycle(card?.lifecycle_or_resolution)
    ? ""
    : normalizeDisplayText(card?.lifecycle_or_resolution);

  return `
    <div class="encounter-mechanics-panel">
      ${renderEncounterSeasonRows(card, game)}
      ${footer ? `<p class="encounter-exception-footer">${escapeHtml(footer)}</p>` : ""}
    </div>
  `;
}

function renderBurdenMechanics(card, game) {
  const resolveText = extractBurdenResolveText(card);

  return `
    <div class="encounter-mechanics-panel">
      ${renderEncounterSeasonRows(card, game, { burden: true })}
      ${resolveText ? "" : `<p class="encounter-manageable-note">No listed resolution.</p>`}
    </div>
  `;
}

function renderArrivalMechanics(card) {
  return `
    <div class="encounter-mechanics-panel arrival-mechanics-panel">
      <section class="arrival-requirement-block">
        <span>Requirement</span>
        <p>${renderCardTextBlock(card?.requirement)}</p>
      </section>
      ${
        normalizeDisplayText(card?.reward)
          ? `<section class="arrival-reward-strip">
              <span>Reward</span>
              <strong>${escapeHtml(card.reward)}</strong>
            </section>`
          : ""
      }
      ${renderArrivalUnlockedTileNote(card)}
    </div>
  `;
}

function renderGoldenBoonMechanics(card) {
  return `
    <div class="encounter-mechanics-panel golden-mechanics-panel">
      <section class="golden-effect-block">
        <span>Effect</span>
        <p>${renderCardTextBlock(card?.effect)}</p>
      </section>
    </div>
  `;
}

function renderEncounterMechanics(card, activeState, game) {
  const encounterType = activeState?.encounterType ?? card?.encounter_type;

  if (encounterType === ENCOUNTER_TYPES.BOON) {
    return renderBoonMechanics(card, game);
  }

  if (encounterType === ENCOUNTER_TYPES.BURDEN) {
    return renderBurdenMechanics(card, game);
  }

  if (encounterType === ENCOUNTER_TYPES.ARRIVAL) {
    return renderArrivalMechanics(card);
  }

  if (encounterType === ENCOUNTER_TYPES.GOLDEN_BOON) {
    return renderGoldenBoonMechanics(card);
  }

  return renderEncounterSourceText(card, game.season, getActiveEncounterPrototypeText(activeState));
}

function renderEncounterFace(card, activeState, game, burdenResolution, { extraClass = "" } = {}) {
  const encounterType = activeState?.encounterType ?? card?.encounter_type ?? "Encounter";
  const statusText = getActiveEncounterStatusText(activeState, burdenResolution);

  return `
    <article class="encounter-face ${escapeHtml(extraClass)} type-${slug(encounterType)}">
      <div class="encounter-type-bar">
        <span class="encounter-type-mark" aria-hidden="true">${escapeHtml(getEncounterTypeMark(encounterType))}</span>
        <span>${escapeHtml(encounterType)}</span>
        ${statusText ? `<strong>${escapeHtml(statusText)}</strong>` : ""}
      </div>
      <h4 class="encounter-title-band">${escapeHtml(card?.card_name ?? activeState?.cardId ?? "Unknown Encounter")}</h4>
      ${renderEncounterFlavorText(card)}
      ${renderEncounterMechanics(card, activeState, game)}
    </article>
  `;
}

function getActiveEncounterPrototypeText(activeState) {
  if (activeState.effect?.type === "optional_resource_strain_relief") {
    return "Pending optional Boon choice.";
  }

  if (activeState.effect?.type === "optional_resource_exchange") {
    return "Pending optional Boon exchange.";
  }

  if (activeState.effect?.type === "steward_help") {
    return "Pending Steward-marker Boon choice.";
  }

  if (isPendingBurdenRevealChoice(activeState.pendingChoice)) {
    return "Pending Burden reveal choice.";
  }

  if (activeState.effect?.type === "golden_scroll_hand_refresh") {
    return "Pending Golden Scroll hand choices.";
  }

  if (activeState.effect?.type === "golden_signet_ring_relocate_tiles") {
    return "Pending Golden Signet Ring relocation choices.";
  }

  if (activeState.encounterType === ENCOUNTER_TYPES.BURDEN) {
    const latestApplication = activeState.applications?.at(-1)?.effect;
    return latestApplication
      ? `Active Burden; applied ${latestApplication.type}.`
      : "Active Burden; waiting for resolution.";
  }

  if (activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL) {
    return `Active Arrival with ${activeState.timerTokens ?? 0} timer tokens.`;
  }

  return "";
}

function getRevealPrototypeText(data) {
  if (!data) {
    return "";
  }

  if (data.roundEffect) {
    return `Created round effect: ${data.roundEffect.type}.`;
  }

  if (data.immediateEffect) {
    if (data.immediateEffect.type === "golden_scroll_hand_refresh") {
      return "Created pending Golden Scroll hand choices.";
    }

    if (data.immediateEffect.type === "golden_signet_ring_relocate_tiles") {
      return "Created pending Golden Signet Ring relocation choices.";
    }

    return `Applied immediate effect: ${data.immediateEffect.type}.`;
  }

  if (data.burdenEffect) {
    if (isPendingBurdenRevealChoice(data.burdenEffect)) {
      return "Created pending Burden reveal choice.";
    }

    return `Applied Burden effect: ${data.burdenEffect.type}.`;
  }

  if (data.encounterType === ENCOUNTER_TYPES.ARRIVAL) {
    return "Added active Arrival.";
  }

  if (data.countsAsStandardReveal === false) {
    return "Resolved as an extra Golden Boon reveal.";
  }

  return "";
}

function renderSourceResourceCost(costText) {
  if (costText === null || costText === undefined || costText === "") {
    return "";
  }

  return formatResourceCostOptionsForDisplay(costText) ?? formatRawCostText(costText);
}

function formatRawCostText(costText) {
  return String(costText)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
}

function formatResourceCostOption(option) {
  return `${option.amount} ${option.resource}`;
}

function formatResourceCostOptionsForDisplay(costText, { separator = ", ", choiceSeparator = " or " } = {}) {
  if (costText === null || costText === undefined || costText === "") {
    return "";
  }

  if (costText === 0 || costText === "0") {
    return "0";
  }

  try {
    const groups = parseResourceCostOptions(costText);
    return groups.length
      ? groups.map((group) => group.options.map(formatResourceCostOption).join(choiceSeparator)).join(separator)
      : "0";
  } catch {
    return null;
  }
}

function renderPrintedCostText(costText) {
  if (costText === null || costText === undefined || costText === "") {
    return "0";
  }

  return formatResourceCostOptionsForDisplay(costText) ?? formatRawCostText(costText);
}

const TILE_FACE_RESOURCE_ORDER = Object.freeze(["Wood", "Stone", "Metal", "Food", "Herbs", "Goods"]);
const TILE_FACE_CATEGORY_MARKS = Object.freeze({
  Resource: "R",
  Housing: "H",
  Crafting: "C",
  Merchant: "M",
  Social: "S",
  Wellbeing: "W",
  Travel: "T",
  Community: "C",
  Special: "Sp"
});

const TILE_FACE_ICON_BASE_PATH = "./src/assets/icons/";
const TILE_FACE_ICON_FILES = Object.freeze({
  arable_land: "arable_land.svg",
  bridge: "bridge.svg",
  encounter_arrival: "encounter_arrival.svg",
  encounter_boon: "encounter_boon.svg",
  encounter_burden: "encounter_burden.svg",
  encounter_golden_boon: "encounter_golden_boon.svg",
  grasslands: "grasslands.svg",
  heaths_wildlands: "heaths_wildlands.svg",
  mountains: "mountains.svg",
  resource_food: "resource_food.svg",
  resource_goods: "resource_goods.svg",
  resource_herbs: "resource_herbs.svg",
  resource_metal: "resource_metal.svg",
  resource_wood: "resource_wood.svg",
  ruins: "ruins.svg",
  rule_adjacent: "rule_adjacent.svg",
  rule_reachable: "rule_reachable.svg",
  score_population: "score_population.svg",
  score_renown: "score_renown.svg",
  status_strain: "status_strain.svg",
  tile_crafting: "tile_crafting.svg",
  tile_housing: "tile_housing.svg",
  tile_merchant: "tile_merchant.svg",
  tile_resource: "tile_resource.svg",
  tile_social: "tile_social.svg",
  tile_travel: "tile_travel.svg",
  tile_wellbeing: "tile_wellbeing.svg",
  water_river: "water_river.svg",
  woodland: "woodland.svg"
});

const TILE_FACE_CATEGORY_ICON_KEYS = Object.freeze({
  Resource: "tile_resource",
  Housing: "tile_housing",
  Crafting: "tile_crafting",
  Merchant: "tile_merchant",
  Social: "tile_social",
  Wellbeing: "tile_wellbeing",
  Travel: "tile_travel"
});

function getTileCategoryIconKey(category) {
  return TILE_FACE_CATEGORY_ICON_KEYS[category] ?? null;
}

function renderTileFaceBadgeIcon(iconKey, cx, cy, size, fallbackText, textClass = "tile-face-icon-text") {
  const iconFile = iconKey ? TILE_FACE_ICON_FILES[iconKey] : null;

  if (iconFile) {
    const offset = size / 2;

    return `<image class="tile-face-badge-image" href="${TILE_FACE_ICON_BASE_PATH}${iconFile}" x="${cx - offset}" y="${cy - offset}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"></image>`;
  }

  return `<text class="${escapeHtml(textClass)}" x="${cx}" y="${cy + 8}" text-anchor="middle">${escapeHtml(fallbackText)}</text>`;
}

function renderSvgTextLines(lines, x, y, lineHeight, className = "") {
  return lines
    .map(
      (line, index) =>
        `<text class="${escapeHtml(className)}" x="${x}" y="${y + index * lineHeight}" text-anchor="middle">${escapeHtml(line)}</text>`
    )
    .join("");
}

function renderSvgCenteredBadgeText(lines, x, centerY, lineHeight, className = "tile-face-corner-text") {
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2 + 5;

  return renderSvgTextLines(lines, x, startY, lineHeight, className);
}

function wrapTileFaceText(text, maxLineLength, maxLines) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length <= maxLineLength) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(word.slice(0, maxLineLength));
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  const consumed = lines.join(" ");
  const full = words.join(" ");

  if (lines.length > 0 && consumed.length < full.length) {
    const lastLine = lines.at(-1) ?? "";
    lines[lines.length - 1] =
      lastLine.length > maxLineLength - 3
        ? `${lastLine.slice(0, Math.max(1, maxLineLength - 3))}...`
        : `${lastLine}...`;
  }

  return lines;
}

function renderTileScoreLine(tile) {
  const scoring = [
    tile?.population ? `Pop ${tile.population}` : "",
    tile?.renown ? `Renown ${tile.renown}` : ""
  ].filter(Boolean);

  return scoring.length ? scoring.join(" · ") : "No score";
}

function formatTileFaceCostEntries(costText) {
  if (costText === null || costText === undefined || costText === "") {
    return [];
  }

  if (costText === 0 || costText === "0") {
    return ["0"];
  }

  let groups;
  try {
    groups = parseResourceCostOptions(costText);
  } catch {
    return ["Cost?"];
  }

  if (groups.length === 0) {
    return ["0"];
  }

  return groups
    .map((group) =>
      [...group.options]
        .sort((left, right) => TILE_FACE_RESOURCE_ORDER.indexOf(left.resource) - TILE_FACE_RESOURCE_ORDER.indexOf(right.resource))
        .map(formatResourceCostOption)
        .join(" / ")
    );
}

function renderTileFaceCostEntries(entries, y) {
  if (!entries.length) {
    return "";
  }

  const positionsByCount = {
    1: [500],
    2: [415, 625],
    3: [325, 550, 775],
    4: [290, 430, 570, 710]
  };
  const positions = positionsByCount[Math.min(entries.length, 4)] ?? positionsByCount[4];
  const visibleEntries = entries.length > 4 ? [...entries.slice(0, 3), `+${entries.length - 3} more`] : entries;

  return visibleEntries
    .map(
      (entry, index) =>
        `<text class="tile-face-cost" x="${positions[index]}" y="${y}" text-anchor="middle">${escapeHtml(entry)}</text>`
    )
    .join("");
}

function getTilePlacementRequirementMark(tile) {
  if (!tile || tile.side === "Upgraded") {
    return null;
  }

  const rules = tile.placement_rules ?? "";

  if (/any placed,\s*non-Overstrained tile/i.test(rules)) {
    return null;
  }

  const requirements = [
    [/Lumber Yard/i, { mark: "Wood", label: "Lumber Yard", icon: "resource_wood" }],
    [/Mine Shaft/i, { mark: "Mine", label: "Mine Shaft", icon: "resource_metal" }],
    [/Farmstead/i, { mark: "Farm", label: "Farmstead", icon: "resource_food" }],
    [/Gatherers Lodge/i, { mark: "Herbs", label: "Gatherers Lodge", icon: "resource_herbs" }],
    [/Dig Site/i, { mark: "Ruin", label: "Dig Site", icon: "ruins" }],
    [/Woodland/i, { mark: "Wood", label: "Woodland", icon: "woodland" }],
    [/Mountains/i, { mark: "Mtn", label: "Mountains", icon: "mountains" }],
    [/Heaths/i, { mark: "Heath", label: "Heaths", icon: "heaths_wildlands" }],
    [/Arable Land/i, { mark: "Arab", label: "Arable Land", icon: "arable_land" }],
    [/Grasslands/i, { mark: "Grass", label: "Grasslands", icon: "grasslands" }],
    [/Ruins/i, { mark: "Ruin", label: "Ruins", icon: "ruins" }],
    [/(Water|River)/i, { mark: "River", label: "River", icon: "water_river" }],
    [/Housing/i, { mark: "H", label: "Housing", icon: "tile_housing" }],
    [/Travel/i, { mark: "T", label: "Travel", icon: "tile_travel" }],
    [/Wellbeing/i, { mark: "W", label: "Wellbeing", icon: "tile_wellbeing" }],
    [/Resource/i, { mark: "R", label: "Resource", icon: "tile_resource" }],
    [/Crafting/i, { mark: "C", label: "Crafting", icon: "tile_crafting" }],
    [/Merchant/i, { mark: "M", label: "Merchant", icon: "tile_merchant" }],
    [/Social/i, { mark: "S", label: "Social", icon: "tile_social" }],
    [/Community/i, { mark: "C", label: "Community", icon: "rule_adjacent" }]
  ];
  const match = requirements.find(([pattern]) => pattern.test(rules));

  return match?.[1] ?? null;
}

function getSpecialTileRoleBadgeLines(tile) {
  const role = tile?.internal_role_tag || tile?.subtype || "Role";

  return wrapTileFaceText(role, 10, 2);
}

function getSpecialTileRoleIconKey(tile) {
  return getTileCategoryIconKey(tile?.internal_role_tag || tile?.subtype);
}

function getSpecialTileRequirementBadgeLines(tile) {
  const rules = String(tile?.placement_rules ?? "");

  if (/Housing/i.test(rules) && /Wellbeing/i.test(rules)) {
    return ["Housing", "Wellbeing"];
  }

  const requirement = getTilePlacementRequirementMark(tile);

  if (!requirement) {
    return ["Open"];
  }

  return wrapTileFaceText(requirement.label, 10, 2);
}

function getTileEffectDetails(tile) {
  const benefit = tile?.benefit ?? "";

  if (/Production/i.test(benefit)) {
    return { mark: "P", label: "Production" };
  }

  if (/Steward Power/i.test(benefit)) {
    return { mark: "SP", label: "Steward Power" };
  }

  if (/Passive/i.test(benefit)) {
    return { mark: "Pa", label: "Passive" };
  }

  if (/Activate|Activated Effect|When Activated/i.test(benefit)) {
    return { mark: "A", label: "Activated Effect" };
  }

  return { mark: TILE_FACE_CATEGORY_MARKS[tile?.tile_category] ?? "E", label: "Effect" };
}

function shorthandTileEffect(benefit) {
  let text = String(benefit ?? "No printed effect.")
    .replace(/^Production:\s*/i, "")
    .replace(/^Activated Effect:\s*/i, "")
    .replace(/^Activate:\s*/i, "")
    .replace(/^Passive:\s*/i, "")
    .replace(/^Steward Power:\s*/i, "")
    .replace(/\.$/, "")
    .trim();

  text = text.replace(/^Gain\s+/i, "+");
  text = text.replace(/\band\s+(\d+\s+(Wood|Stone|Metal|Food|Herbs|Goods))/gi, "+$1");
  text = text.replace(/^Remove\s+/i, "-");
  text = text.replace(/^Reduce\s+/i, "Reduce ");

  return text || "No printed effect";
}

function getTileFaceEffectCopy(tile) {
  return String(tile?.benefit ?? "").replace(/\s+/g, " ").trim();
}

function getTileFaceSideLine(tile) {
  if (tile?.side !== "One-sided") {
    return tile?.side === "Upgraded" ? "Upgraded" : "Basic";
  }

  const role = tile.internal_role_tag || tile.subtype || tile.tile_category || "Special";
  const size = Number(tile.size_hexes ?? 1);
  const sizeLabel = size > 1 ? `1 x ${size}` : "1";

  return `${role} - ${sizeLabel}`;
}

function renderTileFaceScoreBadge(kind, value) {
  const numericValue = Number(value ?? 0);

  if (numericValue <= 0) {
    return "";
  }

  const config =
    kind === "population"
      ? {
          groupClass: "tile-face-population",
          label: "Population",
          icon: "score_population",
          cx: 99,
          valueX: 147
        }
      : {
          groupClass: "tile-face-renown",
          label: "Renown",
          icon: "score_renown",
          cx: 901,
          valueX: 853
        };

  return `
    <g class="tile-face-score ${config.groupClass}" aria-label="${config.label} ${numericValue}">
      <circle cx="${config.cx}" cy="374" r="30"></circle>
      ${renderTileFaceBadgeIcon(config.icon, config.cx, 374, 38, config.label, "tile-face-score-label")}
      <text class="tile-face-score-value" x="${config.valueX}" y="384" text-anchor="middle">${numericValue}</text>
    </g>
  `;
}

function renderSpecialTileFaceSvg(tile) {
  const roleLines = getSpecialTileRoleBadgeLines(tile);
  const roleIcon = getSpecialTileRoleIconKey(tile);
  const requirementLines = getSpecialTileRequirementBadgeLines(tile);
  const requirement = getTilePlacementRequirementMark(tile);
  const titleLines = wrapTileFaceText(String(tile.tile_name ?? ""), 16, 2);
  const titleStartY = titleLines.length > 1 ? 70 : 76;
  const titleSideY = 111;
  const unlockedBy = tile.unlocked_by_arrival ? `Arrival = ${tile.unlocked_by_arrival}` : "Arrival =";
  const unlockedLines = wrapTileFaceText(unlockedBy, 42, 1);
  const effectLines = wrapTileFaceText(getTileFaceEffectCopy(tile), 38, 6);
  const effectCopyStartY = 664 - Math.max(0, effectLines.length - 1) * 19;
  const population = Number(tile.population ?? 0);
  const renown = Number(tile.renown ?? 0);

  return `
    <svg class="tile-face-svg tile-face-special-svg" style="${escapeHtml(getTileFaceAccentStyle(tile))}" viewBox="0 0 1000 866.0254" role="img" aria-label="${escapeHtml(tile.tile_name)} special tile face">
      <path class="tile-face-accent-edge" d="M250 0H750L1000 433.0127L750 866.0254H250L0 433.0127Z"></path>
      <path class="tile-face-outer" d="M250 0H750L1000 433.0127L750 866.0254H250L0 433.0127Z"></path>
      <line class="tile-face-major-divider" x1="1.739" y1="430" x2="998.261" y2="430"></line>
      <line class="tile-face-major-divider" x1="21.363" y1="500" x2="978.637" y2="500"></line>
      <line class="tile-face-guide" x1="250" y1="0" x2="500" y2="300"></line>
      <line class="tile-face-guide" x1="750" y1="0" x2="500" y2="300"></line>
      <line class="tile-face-guide" x1="114" y1="430" x2="500" y2="300"></line>
      <line class="tile-face-guide" x1="886" y1="430" x2="500" y2="300"></line>
      <rect class="tile-face-title-veil" x="320" y="40" width="360" height="86" rx="18"></rect>
      <circle class="tile-face-icon" cx="280" cy="58" r="34"></circle>
      ${
        roleIcon
          ? renderTileFaceBadgeIcon(roleIcon, 280, 58, 45, roleLines.join(" "), "tile-face-corner-text")
          : renderSvgCenteredBadgeText(roleLines, 280, 58, 15)
      }
      <circle class="tile-face-icon tile-face-requirement-icon" cx="720" cy="58" r="34"></circle>
      ${
        requirement?.icon
          ? renderTileFaceBadgeIcon(requirement.icon, 720, 58, 45, requirement.mark, "tile-face-corner-text tile-face-special-req-text")
          : renderSvgCenteredBadgeText(requirementLines, 720, 58, 15, "tile-face-corner-text tile-face-special-req-text")
      }
      ${renderSvgTextLines(titleLines, 500, titleStartY, 36, "tile-face-title")}
      <text class="tile-face-side-text" x="500" y="${titleSideY}" text-anchor="middle">${escapeHtml(getTileFaceSideLine(tile))}</text>
      <text class="tile-face-art-text" x="500" y="312" text-anchor="middle">Artwork Area</text>
      <text class="tile-face-art-sub" x="500" y="336" text-anchor="middle">Special tile preview</text>
      ${renderTileFaceScoreBadge("population", population)}
      ${renderTileFaceScoreBadge("renown", renown)}
      ${renderSvgTextLines(unlockedLines, 500, 476, 24, "tile-face-special-info")}
      ${renderSvgTextLines(effectLines, 500, effectCopyStartY, 38, "tile-face-special-effect-text")}
      <text class="tile-face-micro" x="500" y="830" text-anchor="middle">special tile wireframe v0.2</text>
    </svg>
  `;
}

function renderTileFaceSvg(tile, options = {}) {
  const category = tile.tile_category ?? "Tile";
  const categoryMark = TILE_FACE_CATEGORY_MARKS[category] ?? category.slice(0, 2).toUpperCase();
  const categoryIcon = getTileCategoryIconKey(category);
  const isUpgraded = tile.side === "Upgraded";
  const isOneSided = tile.side === "One-sided";

  if (isOneSided) {
    return renderSpecialTileFaceSvg(tile);
  }

  const upgradeTile = options.upgradeTile ?? null;
  const hasUpgradeRow = !isUpgraded && Boolean(tile.upgrade_to || upgradeTile || (tile.upgrade_cost !== null && tile.upgrade_cost !== undefined));
  const requirement = getTilePlacementRequirementMark(tile);
  const titleLines = wrapTileFaceText(String(tile.tile_name ?? ""), 16, 2);
  const titleStartY = titleLines.length > 1 ? 62 : 82;
  const titleSideY = titleLines.length > 1 ? 160 : 112;
  const titleVeilY = titleLines.length > 1 ? 40 : 48;
  const titleVeilHeight = titleLines.length > 1 ? 112 : 80;
  const placeCostEntries = formatTileFaceCostEntries(tile.place_cost);
  const upgradeCostEntries = formatTileFaceCostEntries(upgradeTile?.upgrade_cost ?? tile.upgrade_cost);
  const lineage = tile.base_tile ? `Upgraded ${tile.base_tile}` : "Upgraded side";
  const effectLines = wrapTileFaceText(getTileFaceEffectCopy(tile), 34, 5).filter((line) => line.trim());
  const effectCopyStartY = 710 - Math.max(0, effectLines.length - 1) * 22;
  const population = Number(tile.population ?? 0);
  const renown = Number(tile.renown ?? 0);

  return `
    <svg class="tile-face-svg tile-face-core-svg" style="${escapeHtml(getTileFaceAccentStyle(tile))}" viewBox="0 0 1000 866.0254" role="img" aria-label="${escapeHtml(tile.tile_name)} tile face">
      <path class="tile-face-accent-edge" d="M250 0H750L1000 433.0127L750 866.0254H250L0 433.0127Z"></path>
      <path class="tile-face-outer" d="M250 0H750L1000 433.0127L750 866.0254H250L0 433.0127Z"></path>
      <line class="tile-face-major-divider" x1="1.739" y1="430" x2="998.261" y2="430"></line>
      ${
        isUpgraded
          ? `<line class="tile-face-major-divider" x1="90.637" y1="590" x2="909.363" y2="590"></line>`
          : `
            <line class="tile-face-major-divider" x1="44.449" y1="510" x2="955.551" y2="510"></line>
            <line class="tile-face-major-divider" x1="90.637" y1="590" x2="909.363" y2="590"></line>
          `
      }
      <line class="tile-face-guide" x1="250" y1="0" x2="500" y2="300"></line>
      <line class="tile-face-guide" x1="750" y1="0" x2="500" y2="300"></line>
      <line class="tile-face-guide" x1="114" y1="430" x2="500" y2="300"></line>
      <line class="tile-face-guide" x1="886" y1="430" x2="500" y2="300"></line>
      <rect class="tile-face-title-veil" x="325" y="${titleVeilY}" width="350" height="${titleVeilHeight}" rx="18"></rect>
      <circle class="tile-face-icon" cx="280" cy="58" r="34"></circle>
      ${renderTileFaceBadgeIcon(categoryIcon, 280, 58, 45, categoryMark)}
      ${renderSvgTextLines(titleLines, 500, titleStartY, 36, "tile-face-title")}
      <text class="tile-face-side-text" x="500" y="${titleSideY}" text-anchor="middle">${isUpgraded ? "Upgraded" : "Basic"}</text>
      ${
        !isUpgraded && requirement
          ? `
            <circle class="tile-face-icon tile-face-requirement-icon" cx="720" cy="58" r="34"></circle>
            ${renderTileFaceBadgeIcon(requirement.icon, 720, 58, 45, requirement.mark, "tile-face-req-text")}
          `
          : ""
      }
      <text class="tile-face-art-text" x="500" y="312" text-anchor="middle">Artwork Area</text>
      ${renderTileFaceScoreBadge("population", population)}
      ${renderTileFaceScoreBadge("renown", renown)}
      ${
        isUpgraded
          ? `
            ${renderSvgTextLines(wrapTileFaceText(lineage, 30, 1), 500, 510, 30, "tile-face-lineage-row")}
          `
          : `
            <text class="tile-face-row-label" x="86" y="486">Place</text>
            ${renderTileFaceCostEntries(placeCostEntries, 485)}
            ${
              hasUpgradeRow
                ? `
                  <text class="tile-face-row-label" x="98" y="566">Upgrade</text>
                  ${renderTileFaceCostEntries(upgradeCostEntries, 565)}
                `
                : ""
            }
          `
      }
      ${renderSvgTextLines(effectLines, 500, effectCopyStartY, 44, "tile-face-core-effect-text")}
    </svg>
  `;
}

function getTileFacePreviewSide(tileId) {
  return state.tileFacePreviewSides[tileId] ?? "front";
}

function rememberTileTrayScroll() {
  const tray = root.querySelector(".tile-tray");

  if (tray) {
    state.tileTrayScrollTop = tray.scrollTop;
  }
}

function restoreTileTrayScroll() {
  const tray = root.querySelector(".tile-tray");

  if (tray) {
    tray.scrollTop = state.tileTrayScrollTop;
  }
}

function getTileFacePreviewTile(tile, upgradeTile, previewSide = "front") {
  return previewSide === "upgrade" && upgradeTile ? upgradeTile : tile;
}

function renderTileFlipButton(tile, upgradeTile, previewSide) {
  if (!upgradeTile) {
    return "";
  }

  const label = previewSide === "upgrade" ? "Show place side" : "Show upgrade";

  return `
    <button class="tile-flip-button" data-tile-flip-id="${escapeHtml(tile.tile_id)}" type="button">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderMultihexTileNote(tile) {
  const size = Number(tile?.size_hexes ?? 1);

  if (size <= 1) {
    return "";
  }

  return `
    <div class="tile-piece-footprint" aria-label="${size} hex footprint">
      ${Array.from({ length: size }, (_, index) => `<i class="${index === 0 ? "is-anchor" : ""}" aria-hidden="true"></i>`).join("")}
      <span>${size}-hex tile</span>
    </div>
  `;
}

function renderTileWireframeCard(tile, options = {}) {
  if (!tile) {
    return "";
  }

  const {
    supply = null,
    selected = false,
    disabled = false,
    placementControls = "",
    upgradeTile = null,
    previewSide = "front",
    title = "Tile"
  } = options;
  const category = tile.tile_category ?? "Tile";
  const previewTile = getTileFacePreviewTile(tile, upgradeTile, previewSide);
  const stockText = supply ? `${supply.available}/${supply.stock} left` : `${tile.stock ?? 0} stock`;
  const unavailableText = disabled ? `<span class="tile-wire-unavailable">Unavailable</span>` : "";

  return `
    <article class="tile-wire-card type-${slug(category)} ${selected ? "is-selected" : ""} ${disabled ? "is-unavailable" : ""}" style="${escapeHtml(getTileCardAccentStyle(previewTile))}">
      <div class="tile-wire-topline">
        <span>${escapeHtml(title)}</span>
        <div class="tile-wire-tools">
          <strong>${escapeHtml(stockText)}</strong>
          ${renderTileFlipButton(tile, upgradeTile, previewSide)}
        </div>
        ${unavailableText}
      </div>
      <div class="tile-frame-name">
        <span>Tile Name</span>
        <strong>${escapeHtml(previewTile.tile_name)}</strong>
        <small>${escapeHtml(previewTile.side ?? tile.side ?? "Tile")}</small>
      </div>
      <button
        class="tile-wire-select"
        data-tile-choice-id="${escapeHtml(tile.tile_id)}"
        type="button"
        ${disabled ? "disabled" : ""}
        aria-pressed="${selected ? "true" : "false"}"
        aria-label="${escapeHtml(`Select ${tile.tile_name}`)}"
      >
        ${renderTileFaceSvg(previewTile, { upgradeTile: previewSide === "front" ? upgradeTile : null })}
      </button>
      ${renderMultihexTileNote(tile)}
      ${placementControls}
    </article>
  `;
}

function renderTileFaceKey() {
  return `
    <p class="tile-face-key" aria-label="Tile icon key">
      <strong>Tile key</strong>
      <span>Top left: tile type</span>
      <span>Top right: placement requirement</span>
      <span>Lower left: Population</span>
      <span>Lower right: Renown</span>
    </p>
  `;
}

function renderTileSourceText(tile, title = "Tile Says") {
  if (!tile) {
    return "";
  }

  const effectDetails = getTileEffectDetails(tile);
  const meta = [
    tile.tile_category,
    tile.subtype,
    tile.side,
    `${tile.size_hexes} hex${tile.size_hexes === 1 ? "" : "es"}`
  ].filter(Boolean);
  const scoring = [
    tile.population ? `Population ${tile.population}` : "",
    tile.renown ? `Renown ${tile.renown}` : ""
  ].filter(Boolean);

  return `
    <article class="tile-reference-card type-${slug(tile.tile_category)}" style="${escapeHtml(getTileCardAccentStyle(tile))}">
      <header>
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(tile.tile_name)}</strong>
        <small>${escapeHtml(meta.join(" · "))}</small>
      </header>
      <dl class="tile-reference-costs">
        <div><dt>Place</dt><dd>${escapeHtml(renderSourceResourceCost(tile.place_cost) || "0")}</dd></div>
        <div><dt>Upgrade</dt><dd>${escapeHtml(renderSourceResourceCost(tile.upgrade_cost) || "0")}</dd></div>
      </dl>
      <div class="tile-reference-effect-type">
        <span>Effect Type</span>
        <strong>${escapeHtml(effectDetails.label)}</strong>
      </div>
      <p class="tile-reference-benefit">${escapeHtml(tile.benefit || "No printed benefit")}</p>
      <dl class="tile-reference-notes">
        <div><dt>Placement</dt><dd>${escapeHtml(tile.placement_rules ?? "No special placement rule")}</dd></div>
        ${scoring.length ? `<div><dt>Score</dt><dd>${escapeHtml(scoring.join(" · "))}</dd></div>` : ""}
        ${tile.upgrade_to ? `<div><dt>Upgrades to</dt><dd>${escapeHtml(tile.upgrade_to)}</dd></div>` : ""}
      </dl>
    </article>
  `;
}

function renderTileEffectPreview(
  tile,
  {
    label = "Tile Effect",
    className = "tile-preplace-effect",
    costSummary = [],
    includeTileFace = false,
    detailsLabel = "View tile"
  } = {}
) {
  if (!tile) {
    return "";
  }

  const effectDetails = getTileEffectDetails(tile);
  const benefit = tile.benefit || "No printed benefit.";

  return `
    <section class="tile-effect-preview ${className}" style="${escapeHtml(getTileCardAccentStyle(tile))}" aria-label="${escapeHtml(`${tile.tile_name} tile effect preview`)}">
      <header>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(tile.tile_name)}</strong>
        <small>${escapeHtml(effectDetails.label)}</small>
      </header>
      ${
        costSummary.length
          ? `<dl class="tile-effect-costs">
              ${costSummary
                .map(
                  (entry) => `
                    <div>
                      <dt>${escapeHtml(entry.label)}</dt>
                      <dd>${escapeHtml(entry.value)}</dd>
                    </div>
                  `
                )
                .join("")}
            </dl>`
          : ""
      }
      <p>${escapeHtml(benefit)}</p>
      ${
        includeTileFace
          ? `<details>
              <summary>${escapeHtml(detailsLabel)}</summary>
              ${renderTileFaceSvg(tile)}
            </details>`
          : ""
      }
    </section>
  `;
}

function isBasicStewardHouse(tile) {
  return tile?.subtype === "Steward House" && tile.side === "Basic";
}

function getStewardHouseUpgrade(tile, tileIndex) {
  return isBasicStewardHouse(tile) && tileIndex ? findUpgradeTile(tile, tileIndex) : null;
}

function getStewardPowerCopy(tile) {
  return String(tile?.benefit ?? "")
    .replace(/^Steward Power:\s*/i, "")
    .trim();
}

function renderStewardPowerUnlockPanel(upgradeTile, { baseTile = null, compact = false } = {}) {
  if (upgradeTile?.subtype !== "Steward House" || upgradeTile.side !== "Upgraded") {
    return "";
  }

  const powerDetails = getStewardPowerDetails(upgradeTile);
  const upgradeCost = renderPrintedCostText(upgradeTile.upgrade_cost);
  const powerCopy = getStewardPowerCopy(upgradeTile);
  const scoreCopy = [
    Number(upgradeTile.population ?? 0) > 0 ? `${upgradeTile.population} Population` : "",
    Number(upgradeTile.renown ?? 0) > 0 ? `${upgradeTile.renown} Renown` : ""
  ].filter(Boolean).join(" + ");
  const titleCopy = baseTile
    ? `${baseTile.tile_name} upgrades to ${upgradeTile.tile_name}`
    : `${upgradeTile.tile_name} unlocks this power`;
  const labelCopy = baseTile ? "Foundation -> Steward Power" : "Steward Power";

  return `
    <section class="steward-house-preview ${compact ? "compact" : ""}" style="${escapeHtml(getTileCardAccentStyle(upgradeTile))}" aria-label="${escapeHtml(`${upgradeTile.tile_name} Steward Power preview`)}">
      <header>
        <span>${escapeHtml(labelCopy)}</span>
        <strong>${escapeHtml(titleCopy)}</strong>
        <small>${escapeHtml(powerDetails?.label ?? "Steward Power")}</small>
      </header>
      <dl class="tile-effect-costs">
        <div><dt>Upgrade</dt><dd>${escapeHtml(upgradeCost)}</dd></div>
        <div><dt>Scores</dt><dd>${escapeHtml(scoreCopy || "No score")}</dd></div>
      </dl>
      <p>${escapeHtml(powerCopy || "No printed Steward Power.")}</p>
    </section>
  `;
}

function renderStewardHouseUpgradePreview(baseTile, tileIndex, { compact = false } = {}) {
  const upgradeTile = getStewardHouseUpgrade(baseTile, tileIndex);

  return renderStewardPowerUnlockPanel(upgradeTile, { baseTile, compact });
}

function getArrivalUnlockedTiles(card, { game = null, tileIndex = null } = {}) {
  if (!card?.card_name) {
    return [];
  }

  if (game?.tileSupply?.special && tileIndex) {
    return game.tileSupply.special
      .filter((entry) => entry.unlockedByArrival === card.card_name)
      .map((entry) => tileIndex.get(entry.tileId))
      .filter(Boolean);
  }

  return (state.data?.tiles ?? []).filter((tile) => tile.unlocked_by_arrival === card.card_name);
}

function renderArrivalUnlockedTileNote(card) {
  const unlockedTiles = getArrivalUnlockedTiles(card);

  if (!unlockedTiles.length) {
    return "";
  }

  return unlockedTiles
    .map((tile) => {
      const effectDetails = getTileEffectDetails(tile);

      return `
        <section class="arrival-unlocked-tile-note" style="${escapeHtml(getTileCardAccentStyle(tile))}">
          <span>Unlocked tile</span>
          <strong>${escapeHtml(tile.tile_name)}</strong>
          <small>${escapeHtml(effectDetails.label)}: ${escapeHtml(tile.benefit || "No printed benefit.")}</small>
        </section>
      `;
    })
    .join("");
}

function renderArrivalUnlockPreview(activeState, card, game, tileIndex) {
  if (activeState?.encounterType !== ENCOUNTER_TYPES.ARRIVAL) {
    return "";
  }

  const unlockedTiles = getArrivalUnlockedTiles(card, { game, tileIndex });

  if (!unlockedTiles.length) {
    return "";
  }

  return `
    <div class="arrival-unlock-preview-list" aria-label="Arrival unlock preview">
      ${unlockedTiles
        .map((tile) =>
          renderTileEffectPreview(tile, {
            label: "Completing unlocks",
            className: "arrival-unlock-preview",
            includeTileFace: true,
            detailsLabel: "View unlocked tile"
          })
        )
        .join("")}
    </div>
  `;
}

function renderCardList(cardIds, encounterIndex, options = {}) {
  const { hidden = false, ordered = false, showSource = false, season = state.game?.season ?? "I" } = options;

  if (hidden) {
    return `<p class="hidden-stack">${cardIds.length} hidden cards</p>`;
  }

  if (cardIds.length === 0) {
    return `<p class="empty-note">None</p>`;
  }

  const cards = getCards(cardIds, encounterIndex);

  return `
    <ol class="card-list encounter-pile-card-list">
      ${cards
        .map((card, index) => {
          return `
            <li class="encounter-pile-card type-${slug(card.encounter_type)}">
              ${ordered ? `<span class="encounter-pile-order">${index + 1}</span>` : ""}
              <div class="encounter-card-main">
                ${renderEncounterFace(card, null, state.game, null, { extraClass: "pile-encounter-face" })}
              </div>
              ${showSource ? renderEncounterSourceText(card, season) : ""}
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function formatBurdenResolutionLabel(resolution) {
  if (!resolution?.supported) {
    return "";
  }

  if (!resolution.requiresPaymentChoice) {
    return renderCost(resolution.cost);
  }

  const resourceText = resolution.allowedResources?.join("/") ?? "resources";
  return `choose ${resolution.amount} ${resourceText}`;
}

function getBurdenPaymentChoices(activeEncounterId, resolution) {
  const saved = state.burdenPayments[activeEncounterId] ?? [];
  return Array.from({ length: resolution.amount }, (_, index) => saved[index] ?? "");
}

function renderBurdenPaymentChoices(activeState, resolution, game) {
  if (!resolution?.requiresPaymentChoice) {
    return "";
  }

  const allowedResources = resolution.allowedResources ?? game.rules.resources;
  const selectedResources = getBurdenPaymentChoices(activeState.id, resolution);

  return `
    <div class="burden-payment-grid" aria-label="Burden payment resources">
      ${selectedResources
        .map(
          (selectedResource, index) => `
            <select class="burden-payment-resource" data-active-encounter-id="${escapeHtml(activeState.id)}" data-payment-index="${index}" aria-label="Payment resource ${index + 1}">
              <option value="">Pay...</option>
              ${allowedResources
                .map(
                  (resource) =>
                    `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                )
                .join("")}
            </select>
          `
        )
        .join("")}
    </div>
  `;
}

function parseBurdenChoiceValue(value) {
  if (value?.startsWith("pay:")) {
    return {
      mode: "pay",
      resource: value.slice(4)
    };
  }

  return {
    mode: value === "timer" ? "timer" : "strain",
    resource: null
  };
}

function getBurdenChoiceFallbackMode(effect) {
  return effect?.type === "arrival_pay_or_timer_choice" ? "timer" : "strain";
}

function getBurdenChoiceTargetId(target) {
  return target.placedTileId ?? target.activeEncounterId;
}

function getBurdenChoiceTargetLabel(target) {
  const timerText = target.activeEncounterId ? ` - ${target.before} timers` : "";
  return `${target.tileName ?? target.cardName ?? getBurdenChoiceTargetId(target)}${timerText}`;
}

function getBurdenChoiceValue(activeEncounterId, key) {
  return state.burdenChoiceDecisions[activeEncounterId]?.[key] ?? "strain";
}

function getBurdenChoiceValueForEffect(activeEncounterId, key, effect) {
  const saved = state.burdenChoiceDecisions[activeEncounterId]?.[key];

  if (saved) {
    return saved;
  }

  if (effect?.type === "resource_loss_or_strain_choice" && effect.targets.length === 0 && effect.paymentOptions[0]) {
    return `pay:${effect.paymentOptions[0].resource}`;
  }

  return getBurdenChoiceFallbackMode(effect);
}

function getBurdenChoiceInstruction(effect) {
  if (effect?.type === "arrival_pay_or_timer_choice") {
    return "Choose whether to pay resources or remove timer tokens from the listed Arrival.";
  }

  if (effect?.type === "resource_loss_or_strain_choice") {
    return "Choose whether to lose the listed resource or place Strain on the listed tile.";
  }

  return "Choose whether to pay resources or place Strain on the listed tile.";
}

function getBurdenChoicePaymentCost(activeState) {
  const effect = activeState?.pendingChoice;
  if (!isPendingBurdenRevealChoice(effect)) {
    return [];
  }

  const decisionKeys =
    effect.decisionMode === "all_or_strain_all" ||
    effect.decisionMode === "all_or_timer_all" ||
    effect.type === "resource_loss_or_strain_choice"
      ? ["__all"]
      : effect.targets.map(getBurdenChoiceTargetId);
  const payments = decisionKeys
    .map((key) => parseBurdenChoiceValue(getBurdenChoiceValueForEffect(activeState.id, key, effect)))
    .filter((decision) => decision.mode === "pay")
    .map((decision) => effect.paymentOptions.find((option) => option.resource === decision.resource))
    .filter(Boolean);

  if (
    effect.decisionMode === "all_or_strain_all" ||
    effect.decisionMode === "all_or_timer_all" ||
    effect.type === "resource_loss_or_strain_choice"
  ) {
    return payments;
  }

  return getResourcePaymentAction(payments.flatMap((payment) => Array.from({ length: payment.amount }, () => payment.resource)));
}

function getBurdenChoiceAction(activeState) {
  const effect = activeState?.pendingChoice;
  if (!isPendingBurdenRevealChoice(effect)) {
    return {};
  }

  if (
    effect.decisionMode === "all_or_strain_all" ||
    effect.decisionMode === "all_or_timer_all" ||
    effect.type === "resource_loss_or_strain_choice"
  ) {
    return {
      choice: parseBurdenChoiceValue(getBurdenChoiceValueForEffect(activeState.id, "__all", effect))
    };
  }

  return {
    decisions: effect.targets.map((target) => ({
      ...(target.placedTileId ? { placedTileId: target.placedTileId } : { activeEncounterId: target.activeEncounterId }),
      ...parseBurdenChoiceValue(
        getBurdenChoiceValue(activeState.id, getBurdenChoiceTargetId(target)) === "strain" &&
          getBurdenChoiceFallbackMode(effect) === "timer"
          ? "timer"
          : getBurdenChoiceValue(activeState.id, getBurdenChoiceTargetId(target))
      )
    }))
  };
}

function renderBurdenChoiceSelect(activeEncounterId, key, effect, label) {
  const fallbackMode = getBurdenChoiceFallbackMode(effect);
  const selectedValue = getBurdenChoiceValueForEffect(activeEncounterId, key, effect);
  const fallbackLabel = fallbackMode === "timer" ? "Remove Timer" : "Place Strain";
  const showFallback = effect.targets.length > 0;
  const payOptions = effect.paymentOptions
    .map((option) => {
      const value = `pay:${option.resource}`;
      return `<option value="${escapeHtml(value)}" ${selectedValue === value ? "selected" : ""}>Pay ${escapeHtml(renderCost([option]))}</option>`;
    })
    .join("");

  return `
    <label class="burden-choice-row">
      <span>Target</span>
      <strong>${escapeHtml(label)}</strong>
      <select class="burden-choice-decision" data-active-encounter-id="${escapeHtml(activeEncounterId)}" data-choice-key="${escapeHtml(key)}" aria-label="${escapeHtml(label)} Burden choice">
        ${showFallback ? `<option value="${escapeHtml(fallbackMode)}" ${selectedValue === fallbackMode ? "selected" : ""}>${fallbackLabel}</option>` : ""}
        ${payOptions}
      </select>
    </label>
  `;
}

function renderBurdenChoiceControls(activeState) {
  const effect = activeState.pendingChoice;
  if (!isPendingBurdenRevealChoice(effect)) {
    return "";
  }

  if (effect.targets.length === 0 && effect.paymentOptions.length === 0) {
    return `
      <div class="burden-choice-panel is-required" aria-label="Required Burden reveal choice">
        <header>
          <span>Required Burden Choice</span>
          <strong>No valid targets</strong>
        </header>
        <p>No Strain, timer, or payment target is currently valid for this reveal choice.</p>
      </div>
    `;
  }

  const renderChoiceShell = (body) => `
    <div class="burden-choice-panel is-required" aria-label="Required Burden reveal choice">
      <header>
        <span>Required Burden Choice</span>
        <strong>Apply before continuing</strong>
      </header>
      <p>${escapeHtml(getBurdenChoiceInstruction(effect))}</p>
      <div class="burden-choice-target-list">
        ${body}
      </div>
    </div>
  `;

  if (
    effect.decisionMode === "all_or_strain_all" ||
    effect.decisionMode === "all_or_timer_all" ||
    effect.type === "resource_loss_or_strain_choice"
  ) {
    const targetNames = effect.targets.length
      ? effect.targets.map(getBurdenChoiceTargetLabel).join(", ")
      : "No valid Strain targets";
    return renderChoiceShell(renderBurdenChoiceSelect(activeState.id, "__all", effect, targetNames));
  }

  return renderChoiceShell(
    effect.targets
      .map((target) =>
        renderBurdenChoiceSelect(activeState.id, getBurdenChoiceTargetId(target), effect, getBurdenChoiceTargetLabel(target))
      )
      .join("")
  );
}

function getBurdenPaymentAction(activeEncounterId) {
  const selectedResources = state.burdenPayments[activeEncounterId] ?? [];
  const counts = selectedResources
    .filter(Boolean)
    .reduce((summary, resource) => {
      summary[resource] = (summary[resource] ?? 0) + 1;
      return summary;
    }, {});

  return Object.entries(counts).map(([resource, amount]) => ({ resource, amount }));
}

function getPendingBurdenResolutionDiscount(game) {
  return (
    (game.encounter.roundEffects ?? []).find(
      (effect) => effect.type === "burden_resolution_discount" && (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function getBurdenResolutionSelectedCost(activeEncounterId, resolution) {
  if (!resolution?.supported) {
    return [];
  }

  return resolution.requiresPaymentChoice ? getBurdenPaymentAction(activeEncounterId) : (resolution.cost ?? []);
}

function getBurdenResolutionDiscountChoices(activeEncounterId, cost, discountEffect) {
  const saved = state.burdenResolutionDiscounts[activeEncounterId] ?? [];
  return getAutomaticResourceDiscountResources(state.game, cost, discountEffect, saved);
}

function renderBurdenResolutionDiscountChoices(activeState, cost, discountEffect) {
  if (!discountEffect || activeState.encounterType !== ENCOUNTER_TYPES.BURDEN) {
    return "";
  }

  const selectedResources = getBurdenResolutionDiscountChoices(activeState.id, cost, discountEffect);
  if (selectedResources.length === 0) {
    return "";
  }

  const allowedResources = [...new Set(cost.map((entry) => entry.resource))];
  const discountedCost = getCostAfterSelectedResourceDiscount(cost, discountEffect, selectedResources);

  return `
    <div class="placement-choice-panel is-ready" aria-label="Burden resolution reduction resources">
      <header>
        <span>Discount applied</span>
        <strong>${escapeHtml(discountEffect.cardName ?? "Boon discount")}</strong>
      </header>
      <p>${escapeHtml(`Burden cost: ${renderCost(cost)} -> ${renderCost(discountedCost)}. Change the reduced resource below if needed.`)}</p>
      <div class="burden-payment-grid">
        ${selectedResources
          .map(
            (selectedResource, index) => `
              <select class="burden-resolution-discount-resource" data-active-encounter-id="${escapeHtml(activeState.id)}" data-discount-index="${index}" aria-label="Burden reduction resource ${index + 1}">
                <option value="">Reduce...</option>
                ${allowedResources
                  .map(
                    (resource) =>
                      `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                  )
                  .join("")}
              </select>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function getBurdenResolutionDiscountAction(activeEncounterId, cost, discountEffect) {
  return getBurdenResolutionDiscountChoices(activeEncounterId, cost, discountEffect).filter(Boolean);
}

function getPendingArrivalRequirementDiscount(game) {
  return (
    (game.encounter.roundEffects ?? []).find(
      (effect) =>
        effect.type === "arrival_requirement_discount" &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function getArrivalRequirementDiscountChoices(activeEncounterId, discountEffect, cost = []) {
  const saved = state.arrivalRequirementDiscounts[activeEncounterId] ?? [];
  if (cost.length > 0) {
    return getAutomaticResourceDiscountResources(state.game, cost, discountEffect, saved);
  }

  return Array.from({ length: discountEffect?.amount ?? 0 }, (_, index) => saved[index] ?? "");
}

function renderArrivalRequirementDiscountChoices(activeState, card, discountEffect, game) {
  if (!discountEffect || activeState.encounterType !== ENCOUNTER_TYPES.ARRIVAL) {
    return "";
  }

  const baseCost = getArrivalBaseCompletionCost(card, game);
  const allowedResources = [...new Set(baseCost.map((entry) => entry.resource))];
  const selectedResources = getArrivalRequirementDiscountChoices(activeState.id, discountEffect, baseCost);
  const discountedCost = getCostAfterSelectedResourceDiscount(baseCost, discountEffect, selectedResources);

  return `
    <div class="placement-choice-panel is-ready" aria-label="Arrival requirement reduction resources">
      <header>
        <span>Discount applied</span>
        <strong>${escapeHtml(discountEffect.cardName ?? "Boon discount")}</strong>
      </header>
      <p>${escapeHtml(`Arrival cost: ${renderCost(baseCost)} -> ${renderCost(discountedCost)}. Change the reduced resource below if needed.`)}</p>
      <div class="burden-payment-grid">
        ${selectedResources
          .map(
            (selectedResource, index) => `
              <select class="arrival-requirement-discount-resource" data-active-encounter-id="${escapeHtml(activeState.id)}" data-discount-index="${index}" aria-label="Arrival reduction resource ${index + 1}">
                <option value="">Reduce...</option>
                ${allowedResources
                  .map(
                    (resource) =>
                      `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                  )
                  .join("")}
              </select>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function getArrivalRequirementDiscountAction(activeEncounterId) {
  const discountEffect = getPendingArrivalRequirementDiscount(state.game);
  const activeState = state.game.encounter.active.find((candidate) => candidate.id === activeEncounterId);
  const card = state.data.encounterCards.find((candidate) => candidate.card_id === activeState?.cardId);
  const cost = card ? getArrivalBaseCompletionCost(card, state.game) : [];

  return getArrivalRequirementDiscountChoices(activeEncounterId, discountEffect, cost).filter(Boolean);
}

function summarizeResourceCostEntries(cost, resourceOrder = []) {
  const totals = new Map();

  for (const entry of cost) {
    if (!entry?.resource || !Number.isFinite(Number(entry.amount))) {
      continue;
    }

    totals.set(entry.resource, (totals.get(entry.resource) ?? 0) + Number(entry.amount));
  }

  const orderedResources = [
    ...resourceOrder.filter((resource) => totals.has(resource)),
    ...[...totals.keys()].filter((resource) => !resourceOrder.includes(resource))
  ];

  return orderedResources
    .map((resource) => ({
      resource,
      amount: totals.get(resource)
    }))
    .filter((entry) => entry.amount > 0);
}

function getArrivalBaseCompletionCost(card, game) {
  const requirement = String(card?.requirement ?? "").split(/\bwithin\b/i)[0];
  const resourcePattern = new RegExp(`\\b(\\d+)\\s+(${game.rules.resources.join("|")})\\b`, "gi");
  const cost = [...requirement.matchAll(resourcePattern)].map((match) => {
    const resource = game.rules.resources.find(
      (candidate) => candidate.toLowerCase() === String(match[2]).toLowerCase()
    );

    return {
      amount: Number(match[1]),
      resource: resource ?? match[2]
    };
  });

  return summarizeResourceCostEntries(cost, game.rules.resources);
}

function getArrivalCompletionCost(activeState, card, arrivalRequirementDiscount, game) {
  const baseCost = getArrivalBaseCompletionCost(card, game);
  const selectedResources = arrivalRequirementDiscount
    ? getArrivalRequirementDiscountChoices(activeState.id, arrivalRequirementDiscount, baseCost).filter(Boolean)
    : [];
  const reductions = selectedResources.reduce((summary, resource) => {
    summary[resource] = (summary[resource] ?? 0) + 1;
    return summary;
  }, {});
  const cost = baseCost.map((entry) => ({
    ...entry,
    amount: Math.max(0, entry.amount - (reductions[entry.resource] ?? 0))
  }));

  return {
    baseCost,
    cost: summarizeResourceCostEntries(cost, game.rules.resources),
    discountApplied: selectedResources.length > 0
  };
}

function renderArrivalCompleteButton(activeState, card, arrivalRequirementDiscount, game) {
  const completionCost = getArrivalCompletionCost(activeState, card, arrivalRequirementDiscount, game);
  const resourceSpend = completionCost.cost.length ? renderCost(completionCost.cost) : "0 resources";
  const discountText = completionCost.discountApplied ? " after reduction" : "";
  const spendText = `Spend 1 Action + ${resourceSpend}${discountText}`;

  return `
    <button
      class="mini-action-button complete-arrival with-cost"
      data-active-encounter-id="${escapeHtml(activeState.id)}"
      type="button"
      aria-label="${escapeHtml(`Complete Arrival. ${spendText}.`)}"
      title="${escapeHtml(spendText)}"
    >
      <span>Complete Arrival</span>
      <small>${escapeHtml(spendText)}</small>
    </button>
  `;
}

function getPendingCoreUpgradeDiscount(game) {
  return (
    (game.encounter.roundEffects ?? []).find(
      (effect) => effect.type === "core_upgrade_discount" && (effect.uses ?? 0) < (effect.maxUses ?? 1)
    ) ?? null
  );
}

function getPendingUpgradeResourceDiscount(game, tile) {
  const coreUpgradeDiscount = getPendingCoreUpgradeDiscount(game);

  if (coreUpgradeDiscount && tile?.tile_source_type === "Core") {
    return coreUpgradeDiscount;
  }

  return (
    (game.encounter.roundEffects ?? []).find(
      (effect) =>
        effect.type === "tile_resource_discount" &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1) &&
        (effect.appliesTo ?? []).includes("upgrade") &&
        (!effect.targetCategories || effect.targetCategories.includes(tile?.tile_category))
    ) ?? null
  );
}

function getCostReductionChoiceCount(cost, discountEffect) {
  const totalCost = cost.reduce((sum, entry) => sum + entry.amount, 0);
  return Math.min(discountEffect?.amount ?? 0, totalCost);
}

function getUpgradeCostDiscountChoices(placedTileId, cost, discountEffect) {
  const saved = state.upgradeCostDiscounts[placedTileId] ?? [];
  return getAutomaticResourceDiscountResources(state.game, cost, discountEffect, saved);
}

function renderUpgradeCostDiscountChoices(selectedPlacedTile, selectedTileDefinition, upgradeCost, discountEffect) {
  if (
    !selectedPlacedTile ||
    !discountEffect ||
    !selectedTileDefinition ||
    !upgradeCost ||
    upgradeCost.error
  ) {
    return "";
  }

  if (discountEffect.freeResourceCost) {
    return `
      <div class="placement-choice-panel is-ready">
        <header>
          <span>Discount applied</span>
          <strong>${escapeHtml(discountEffect.cardName ?? "Boon discount")}</strong>
        </header>
        <p>${escapeHtml(`${selectedTileDefinition.tile_name}'s upgrade resource cost is reduced from ${renderCost(upgradeCost.cost)} to 0.`)}</p>
      </div>
    `;
  }

  const selectedResources = getUpgradeCostDiscountChoices(selectedPlacedTile.id, upgradeCost.cost, discountEffect);
  if (selectedResources.length === 0) {
    return "";
  }

  const allowedResources = [...new Set(upgradeCost.cost.map((entry) => entry.resource))];
  const discountedCost = getCostAfterSelectedResourceDiscount(upgradeCost.cost, discountEffect, selectedResources);

  return `
    <div class="placement-choice-panel is-ready" aria-label="Core upgrade cost reduction resources">
      <header>
        <span>Discount applied</span>
        <strong>${escapeHtml(discountEffect.cardName ?? "Boon discount")}</strong>
      </header>
      <p>${escapeHtml(`Upgrade cost: ${renderCost(upgradeCost.cost)} -> ${renderCost(discountedCost)}. Change the reduced resource below if needed.`)}</p>
      <div class="burden-payment-grid">
        ${selectedResources
          .map(
            (selectedResource, index) => `
              <select class="upgrade-cost-discount-resource" data-placed-tile-id="${escapeHtml(selectedPlacedTile.id)}" data-discount-index="${index}" aria-label="Upgrade reduction resource ${index + 1}">
                <option value="">Reduce...</option>
                ${allowedResources
                  .map(
                    (resource) =>
                      `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                  )
                  .join("")}
              </select>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function getUpgradeCostDiscountAction(placedTileId, cost, discountEffect) {
  return getUpgradeCostDiscountChoices(placedTileId, cost, discountEffect).filter(Boolean);
}

function getPendingPlacementResourceDiscount(game, tile) {
  if (!tile) {
    return null;
  }

  return (
    (game.encounter.roundEffects ?? []).find(
      (effect) =>
        (effect.type === "placement_resource_discount" ||
          (effect.type === "tile_resource_discount" && (effect.appliesTo ?? []).includes("placement"))) &&
        (effect.uses ?? 0) < (effect.maxUses ?? 1) &&
        (!effect.targetCategories || effect.targetCategories.includes(tile.tile_category))
    ) ?? null
  );
}

function getPlacementDiscountEligibleCost(cost, discountEffect) {
  const allowedResources = discountEffect?.allowedResources ?? [];
  return allowedResources.length ? cost.filter((entry) => allowedResources.includes(entry.resource)) : cost;
}

function getPlacementCostDiscountChoices(tileId, cost, discountEffect) {
  const saved = state.placementCostDiscounts[tileId] ?? [];
  const eligibleCost = getPlacementDiscountEligibleCost(cost, discountEffect);
  return getAutomaticResourceDiscountResources(state.game, eligibleCost, discountEffect, saved);
}

function getCostAfterSelectedResourceDiscount(cost, discountEffect, selectedResources) {
  if (!discountEffect) {
    return cost;
  }

  if (discountEffect.freeResourceCost) {
    return [];
  }

  if (selectedResources.some((resource) => !resource)) {
    return cost;
  }

  const reductions = summarizeResourceCostEntries(
    selectedResources.map((resource) => ({
      resource,
      amount: 1
    }))
  );

  return cost
    .map((entry) => {
      const reduction = reductions.find((candidate) => candidate.resource === entry.resource);

      return reduction
        ? {
            ...entry,
            amount: Math.max(0, entry.amount - reduction.amount)
          }
        : entry;
    })
    .filter((entry) => entry.amount > 0);
}

function renderPlacementCostDiscountChoices(tile, cost, discountEffect) {
  if (!tile || !discountEffect) {
    return "";
  }

  if (discountEffect.freeResourceCost) {
    return `
      <div class="placement-choice-panel is-ready">
        <header>
          <span>Available discount</span>
          <strong>${escapeHtml(discountEffect.cardName ?? "Boon")}</strong>
        </header>
        <p>${escapeHtml(`${tile.tile_name}'s resource cost will be reduced to 0.`)}</p>
      </div>
    `;
  }

  const selectedResources = getPlacementCostDiscountChoices(tile.tile_id, cost, discountEffect);
  if (selectedResources.length === 0) {
    return "";
  }

  const eligibleCost = getPlacementDiscountEligibleCost(cost, discountEffect);
  const allowedResources = [...new Set(eligibleCost.map((entry) => entry.resource))];
  const discountedCost = getCostAfterSelectedResourceDiscount(cost, discountEffect, selectedResources);

  return `
    <div class="placement-choice-panel is-ready" aria-label="Placement cost reduction resources">
      <header>
        <span>Discount applied</span>
        <strong>${escapeHtml(discountEffect.cardName ?? "Boon discount")}</strong>
      </header>
      <p>${escapeHtml(`Placement cost: ${renderCost(cost)} -> ${renderCost(discountedCost)}. Change the reduced resource below if needed.`)}</p>
      <div class="burden-payment-grid">
        ${selectedResources
          .map(
            (selectedResource, index) => `
              <select class="placement-cost-discount-resource" data-tile-id="${escapeHtml(tile.tile_id)}" data-discount-index="${index}" aria-label="Placement reduction resource ${index + 1}">
                <option value="">Choose resource...</option>
                ${allowedResources
                  .map(
                    (resource) =>
                      `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                  )
                  .join("")}
              </select>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function getPlacementCostDiscountAction(tileId, cost, discountEffect) {
  return getPlacementCostDiscountChoices(tileId, cost, discountEffect).filter(Boolean);
}

function getResourcePaymentAction(selectedResources = []) {
  const counts = selectedResources
    .filter(Boolean)
    .reduce((summary, resource) => {
      summary[resource] = (summary[resource] ?? 0) + 1;
      return summary;
    }, {});

  return Object.entries(counts).map(([resource, amount]) => ({ resource, amount }));
}

function uniqueStewardPowerProviders(providers) {
  return [...new Map(providers.map((provider) => [provider.placedTile.id, provider])).values()];
}

function getSelectedStewardPowerId(savedId, providers) {
  return providers.some((provider) => provider.placedTile.id === savedId) ? savedId : "";
}

function getStewardPowerProviderLabel(provider) {
  const coordinate = getPlacedTileAnchorCoordinate(provider.placedTile);
  return `${provider.tile?.tile_name ?? provider.placedTile.tileId}${coordinate ? ` at ${coordinate}` : ""} - ${provider.details.label}`;
}

function renderStewardPowerSelect({ id, className = "", label = "Steward Power", providers, selectedId, attributes = "" }) {
  if (!providers.length) {
    return "";
  }

  const selectAttributes = [
    id ? `id="${escapeHtml(id)}"` : "",
    className ? `class="${escapeHtml(className)}"` : "",
    attributes
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <label class="stacked-field steward-power-field">
      <span>${escapeHtml(label)}</span>
      <select ${selectAttributes} aria-label="${escapeHtml(label)}">
        <option value="">Do not use</option>
        ${providers
          .map(
            (provider) => `
              <option value="${escapeHtml(provider.placedTile.id)}" ${provider.placedTile.id === selectedId ? "selected" : ""}>
                ${escapeHtml(getStewardPowerProviderLabel(provider))}
              </option>
            `
          )
          .join("")}
      </select>
    </label>
  `;
}

function getPlacementStewardPowerProviders(game, tile, baseActionCost, tileIndex) {
  if (!tile || !baseActionCost) {
    return [];
  }

  const placementProviders = getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION,
    (provider) => provider.details.categories.includes(tile.tile_category)
  );
  const disconnectedProviders =
    baseActionCost.blockedByReachability
      ? getAvailableStewardPowerProviders(
          game,
          { tileIndex },
          STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION
        )
      : [];

  return uniqueStewardPowerProviders([...placementProviders, ...disconnectedProviders]);
}

function getPlacementStewardActionPreview(actionCost, provider) {
  if (!actionCost || !provider) {
    return actionCost;
  }

  if (provider.details.type === STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION) {
    return {
      ...actionCost,
      originalTotal: actionCost.originalTotal ?? actionCost.total,
      connected: true,
      blockedByReachability: false,
      disconnectedTravelIgnored: true,
      disconnectedTravelIgnoreReason: "ranger_steward_power",
      placeActionCost: 0,
      total: 0
    };
  }

  return {
    ...actionCost,
    originalTotal: actionCost.originalTotal ?? actionCost.total,
    placeActionCost: 0,
    total: Math.max(0, actionCost.total - (actionCost.placeActionCost ?? actionCost.total))
  };
}

function getUpgradeStewardPowerProviders(game, tile, tileIndex, baseActionCost = null) {
  const providers = [];

  if (tile?.tile_source_type === "Core") {
    providers.push(
      ...getAvailableStewardPowerProviders(
        game,
        { tileIndex },
        STEWARD_POWER_TYPES.FREE_CORE_UPGRADE_ACTION
      )
    );
  }

  if (baseActionCost?.blockedByReachability) {
    providers.push(
      ...getAvailableStewardPowerProviders(
        game,
        { tileIndex },
        STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION
      )
    );
  }

  return uniqueStewardPowerProviders(providers);
}

function getUpgradeStewardActionPreview(actionCost, provider) {
  if (!actionCost || !provider) {
    return actionCost;
  }

  if (provider.details.type === STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION) {
    return {
      ...actionCost,
      originalTotal: actionCost.originalTotal ?? actionCost.total,
      connected: true,
      blockedByReachability: false,
      disconnectedTravelIgnored: true,
      disconnectedTravelIgnoreReason: "ranger_steward_power",
      upgradeActionCost: 0,
      total: 0
    };
  }

  return {
    ...actionCost,
    originalTotal: actionCost.originalTotal ?? actionCost.total,
    upgradeActionCost: 0,
    total: Math.max(0, actionCost.total - (actionCost.upgradeActionCost ?? actionCost.total))
  };
}

function getActivationStewardPowerProviders(game, tileIndex, baseActionCost = null) {
  if (!baseActionCost?.blockedByReachability) {
    return [];
  }

  return getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION
  );
}

function getActivationStewardActionPreview(actionCost, provider) {
  if (!actionCost || !provider) {
    return actionCost;
  }

  return {
    ...actionCost,
    originalTotal: actionCost.originalTotal ?? actionCost.total,
    connected: true,
    blockedByReachability: false,
    disconnectedTravelIgnored: true,
    disconnectedTravelIgnoreReason: "ranger_steward_power",
    activationActionCost: 0,
    total: 0
  };
}

function getBurdenStewardPowerProviders(game, tileIndex) {
  return getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.FREE_BURDEN_RESOLUTION_ACTION
  );
}

function getWardenBurdenSuppressionProviders(game, tileIndex) {
  return getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.SUPPRESS_BURDEN
  );
}

function getActiveStewardExchangeProvider(game, tileIndex) {
  return (
    getAvailableStewardPowerProviders(
      game,
      { tileIndex },
      STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
    )[0] ?? null
  );
}

function formatStewardPowerStatus(placedTile, tileDefinition, game) {
  const details = getStewardPowerDetails(tileDefinition);

  if (!details) {
    return "None";
  }

  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const stewardRole = getStewardHouseRole(tileDefinition);

  if (!isStewardHouseTileForPlayer(tileDefinition, activePlayer)) {
    return `${details.label} (${stewardRole?.name ?? "matching Steward"} only)`;
  }

  if (isOverstrainedPlacedTile(placedTile)) {
    return `${details.label} (overstrained)`;
  }

  if (isStewardPowerUsedThisSeason(placedTile, game.season)) {
    return `${details.label} (used this Season)`;
  }

  return details.label;
}

function getStewardExchangeAmount(placedTileId, details) {
  const savedAmount = Number(state.stewardExchangeAmounts[placedTileId] ?? 1);

  if (!Number.isInteger(savedAmount)) {
    return 1;
  }

  return Math.max(1, Math.min(details.maxAmount, savedAmount));
}

function getStewardExchangePaymentChoices(placedTileId, details) {
  const saved = state.stewardExchangePayments[placedTileId] ?? [];
  const count = getStewardExchangeAmount(placedTileId, details);

  return Array.from({ length: count }, (_, index) => saved[index] ?? "");
}

function getStewardExchangeGainChoices(placedTileId, details) {
  const saved = state.stewardExchangeGains[placedTileId] ?? [];
  const count = getStewardExchangeAmount(placedTileId, details);

  return Array.from({ length: count }, (_, index) => saved[index] ?? "");
}

function renderStewardExchangeControls(game, placedTile, details, canUseStewardExchange) {
  if (!placedTile || details?.type !== STEWARD_POWER_TYPES.RESOURCE_EXCHANGE) {
    return "";
  }

  const amount = getStewardExchangeAmount(placedTile.id, details);
  const paymentChoices = getStewardExchangePaymentChoices(placedTile.id, details);
  const gainChoices = getStewardExchangeGainChoices(placedTile.id, details);
  const ready = paymentChoices.every(Boolean) && gainChoices.every(Boolean);
  const disabledReason = !ready
    ? "Choose resources to pay and gain."
    : canUseStewardExchange
      ? ""
      : "This exchange is not available right now.";

  return `
    <div class="steward-menu-exchange steward-power-exchange" aria-label="Quartermaster Warehouse exchange">
      <header>
        <strong>Warehouse Exchange</strong>
        <span>Once per Season</span>
      </header>
      <label class="steward-menu-count">
        <span>Count</span>
        <select class="steward-exchange-count" data-placed-tile-id="${escapeHtml(placedTile.id)}" aria-label="Quartermaster exchange count">
          ${Array.from({ length: details.maxAmount }, (_, index) => index + 1)
            .map((option) => `<option value="${option}" ${option === amount ? "selected" : ""}>${option}</option>`)
            .join("")}
        </select>
      </label>
      <div class="steward-menu-exchange-grid">
        ${Array.from({ length: amount }, (_, index) => {
          const selectedPayment = paymentChoices[index] ?? "";
          const selectedGain = gainChoices[index] ?? "";

          return `
            <select class="steward-exchange-payment-resource" data-placed-tile-id="${escapeHtml(placedTile.id)}" data-payment-index="${index}" aria-label="Quartermaster pay resource ${index + 1}">
              <option value="">Pay...</option>
              ${renderResourceSelectOptions(game.rules.resources, selectedPayment)}
            </select>
            <select class="steward-exchange-gain-resource" data-placed-tile-id="${escapeHtml(placedTile.id)}" data-gain-index="${index}" aria-label="Quartermaster gain resource ${index + 1}">
              <option value="">Gain...</option>
              ${renderResourceSelectOptions(game.rules.resources, selectedGain)}
            </select>
          `;
        }).join("")}
      </div>
      ${disabledReason ? `<p class="steward-menu-note">${escapeHtml(disabledReason)}</p>` : ""}
      <button
        class="steward-menu-button steward-menu-exchange-button use-steward-exchange"
        type="button"
        data-placed-tile-id="${escapeHtml(placedTile.id)}"
        ${canUseStewardExchange ? "" : "disabled"}
      >
        Exchange Resources
      </button>
    </div>
  `;
}

function getActivationPaymentAction(placedTileId) {
  return getResourcePaymentAction(state.activationPayments[placedTileId] ?? []);
}

function placedTileMatchesBoonReliefCategories(tileIndex, placedTile, effect) {
  if (!effect?.targetCategories?.length) {
    return true;
  }

  const definition = tileIndex.get(placedTile.tileId);
  return effect.targetCategories.includes(definition?.tile_category);
}

function getBoonStrainReliefCandidates(game, tileIndex, effect) {
  return game.map.placedTiles.filter(
    (placedTile) =>
      (placedTile.strain ?? 0) > 0 &&
      placedTileMatchesBoonReliefCategories(tileIndex, placedTile, effect)
  );
}

function getBoonStrainReliefTargetIds(activeEncounterId, candidates, maxTargets) {
  const candidateIds = new Set(candidates.map((placedTile) => placedTile.id));
  const saved = (state.boonStrainReliefTargets[activeEncounterId] ?? []).filter((tileId) => candidateIds.has(tileId));
  const selected = saved.length ? saved : candidates.slice(0, maxTargets).map((placedTile) => placedTile.id);

  return selected.slice(0, maxTargets);
}

function renderBoonStrainReliefTargets(game, tileIndex, activeState, candidates, selectedTargetIds) {
  const effect = activeState.effect;

  if (effect.maxTargets <= 1) {
    return `
      <label class="stacked-field activation-target">
        <span>Target</span>
        <select class="boon-strain-relief-target" data-active-encounter-id="${escapeHtml(activeState.id)}" aria-label="Boon Strain relief target" ${candidates.length ? "" : "disabled"}>
          ${
            candidates.length
              ? candidates
                  .map(
                    (placedTile) => `
                      <option value="${escapeHtml(placedTile.id)}" ${placedTile.id === selectedTargetIds[0] ? "selected" : ""}>
                        ${escapeHtml(getTileNameByPlacedId(game, tileIndex, placedTile.id))} - ${placedTile.strain ?? 0} Strain
                      </option>
                    `
                  )
                  .join("")
              : `<option>No strained eligible tiles</option>`
          }
        </select>
      </label>
    `;
  }

  return `
    <fieldset class="stacked-field activation-target">
      <legend>Targets</legend>
      ${
        candidates.length
          ? `<div class="activation-target-list">
              ${candidates
                .map((placedTile) => {
                  const checked = selectedTargetIds.includes(placedTile.id);
                  const disabled = !checked && selectedTargetIds.length >= effect.maxTargets;

                  return `
                    <label class="activation-target-option">
                      <input
                        class="boon-strain-relief-target-choice"
                        type="checkbox"
                        value="${escapeHtml(placedTile.id)}"
                        data-active-encounter-id="${escapeHtml(activeState.id)}"
                        data-max-targets="${effect.maxTargets}"
                        ${checked ? "checked" : ""}
                        ${disabled ? "disabled" : ""}
                      >
                      <span>${escapeHtml(getTileNameByPlacedId(game, tileIndex, placedTile.id))} - ${placedTile.strain ?? 0} Strain</span>
                    </label>
                  `;
                })
                .join("")}
            </div>`
          : `<p class="empty-note">No strained eligible tiles</p>`
      }
    </fieldset>
  `;
}

function renderBoonStrainReliefControls(game, tileIndex, activeState, candidates, selectedTargetIds) {
  const effect = activeState.effect;
  const categories = effect.targetCategories?.length ? ` · ${effect.targetCategories.join(" or ")} only` : "";

  return `
    <div class="burden-payment-grid" aria-label="Boon Strain relief">
      <span>${escapeHtml(renderCost(effect.cost))} for up to ${effect.maxStrainRemoved} Strain${escapeHtml(categories)}</span>
    </div>
    ${renderBoonStrainReliefTargets(game, tileIndex, activeState, candidates, selectedTargetIds)}
  `;
}

function getBoonExchangeAmount(activeEncounterId, effect) {
  const savedAmount = Number(state.boonExchangeAmounts[activeEncounterId] ?? 1);

  if (!Number.isInteger(savedAmount)) {
    return 1;
  }

  return Math.max(1, Math.min(effect.maxAmount, savedAmount));
}

function getBoonExchangePaymentChoices(activeEncounterId, effect) {
  const saved = state.boonExchangePayments[activeEncounterId] ?? [];
  const count = getBoonExchangeAmount(activeEncounterId, effect);

  return Array.from({ length: count }, (_, index) => saved[index] ?? "");
}

function getBoonExchangeGainChoices(activeEncounterId, effect) {
  const saved = state.boonExchangeGains[activeEncounterId] ?? [];
  const count = getBoonExchangeAmount(activeEncounterId, effect);

  return Array.from({ length: count }, (_, index) => saved[index] ?? "");
}

function renderBoonExchangeControls(game, activeState) {
  const effect = activeState.effect;
  const selectedPayments = getBoonExchangePaymentChoices(activeState.id, effect);
  const selectedGains = getBoonExchangeGainChoices(activeState.id, effect);

  return `
    <label class="stacked-field activation-exchange-count">
      <span>Exchange Count</span>
      <select class="boon-exchange-count" data-active-encounter-id="${escapeHtml(activeState.id)}" aria-label="Boon exchange count">
        ${Array.from({ length: effect.maxAmount }, (_, index) => index + 1)
          .map(
            (amount) =>
              `<option value="${amount}" ${amount === selectedPayments.length ? "selected" : ""}>${amount}</option>`
          )
          .join("")}
      </select>
    </label>
    <div class="burden-payment-grid activation-payment-grid" aria-label="Boon exchange payment resources">
      ${selectedPayments
        .map(
          (selectedResource, index) => `
            <select class="boon-exchange-payment-resource" data-active-encounter-id="${escapeHtml(activeState.id)}" data-payment-index="${index}" aria-label="Boon exchange payment resource ${index + 1}">
              <option value="">Pay...</option>
              ${game.rules.resources
                .map(
                  (resource) =>
                    `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                )
                .join("")}
            </select>
          `
        )
        .join("")}
    </div>
    <div class="burden-payment-grid activation-gain-grid" aria-label="Boon exchange gain resources">
      ${selectedGains
        .map(
          (selectedResource, index) => `
            <select class="boon-exchange-gain-resource" data-active-encounter-id="${escapeHtml(activeState.id)}" data-gain-index="${index}" aria-label="Boon exchange gain resource ${index + 1}">
              <option value="">Gain...</option>
              ${game.rules.resources
                .map(
                  (resource) =>
                    `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                )
                .join("")}
            </select>
          `
        )
        .join("")}
    </div>
  `;
}

function getBoonStewardHelpGainChoices(activeEncounterId, effect) {
  const saved = state.boonStewardHelpGains[activeEncounterId] ?? [];
  return Array.from({ length: effect.resourceGainAmount ?? 0 }, (_, index) => saved[index] ?? "");
}

function renderBoonStewardHelpControls(game, activeState) {
  const effect = activeState.effect;
  const selectedGains = getBoonStewardHelpGainChoices(activeState.id, effect);

  return `
    <div class="burden-payment-grid" aria-label="Steward Boon resource gains">
      <span>${effect.strainRemoved} Strain removed · ${effect.resourceGainAmount} resources</span>
    </div>
    ${
      selectedGains.length
        ? `<div class="burden-payment-grid activation-gain-grid" aria-label="Where Help Stands resource gains">
            ${selectedGains
              .map(
                (selectedResource, index) => `
                  <select class="boon-steward-help-gain-resource" data-active-encounter-id="${escapeHtml(activeState.id)}" data-gain-index="${index}" aria-label="Where Help Stands gain resource ${index + 1}">
                    <option value="">Gain...</option>
                    ${game.rules.resources
                      .map(
                        (resource) =>
                          `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                      )
                      .join("")}
                  </select>
                `
              )
              .join("")}
          </div>`
        : ""
    }
  `;
}

function getGoldenScrollDiscardChoices(activeEncounterId, playerId) {
  return state.goldenScrollDiscards[activeEncounterId]?.[playerId] ?? [];
}

function renderGoldenScrollControls(game, encounterIndex, activeState) {
  return `
    <div class="golden-scroll-grid" aria-label="Golden Scroll hand discards">
      ${game.players
        .map((player) => {
          const selectedCardIds = getGoldenScrollDiscardChoices(activeState.id, player.id);

          return `
            <div class="golden-scroll-player">
              <span>${escapeHtml(formatPlayerName(player))}</span>
              ${
                player.hand.length
                  ? player.hand
                      .map((cardId) => {
                        const card = encounterIndex.get(cardId);

                        return `
                          <label class="checkbox-chip">
                            <input
                              class="golden-scroll-discard-choice"
                              data-active-encounter-id="${escapeHtml(activeState.id)}"
                              data-player-id="${escapeHtml(player.id)}"
                              type="checkbox"
                              value="${escapeHtml(cardId)}"
                              ${selectedCardIds.includes(cardId) ? "checked" : ""}
                            />
                            <span>${escapeHtml(card?.card_name ?? cardId)}</span>
                          </label>
                        `;
                      })
                      .join("")
                  : `<small>No cards in hand</small>`
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getGoldenSignetMoveChoices(activeEncounterId) {
  return state.goldenSignetMoves[activeEncounterId] ?? {};
}

function getGoldenSignetRelocations(activeEncounterId) {
  const choices = getGoldenSignetMoveChoices(activeEncounterId);

  return Object.entries(choices)
    .filter(([, choice]) => choice?.selected)
    .map(([placedTileId, choice]) => ({
      placedTileId,
      coordinate: choice.coordinate,
      orientation: choice.orientation
    }));
}

function renderCoordinateOptions(mapHexes, selectedCoordinate) {
  return mapHexes
    .map(
      (hex) =>
        `<option value="${escapeHtml(hex.Coordinate)}" ${hex.Coordinate === selectedCoordinate ? "selected" : ""}>${escapeHtml(hex.Coordinate)}</option>`
    )
    .join("");
}

function validateSelectedMapOption(mapOption) {
  if (!mapOption) {
    return validateApprovedMap(state.data.mapHexes);
  }

  if (mapOption.locked && !mapOption.source) {
    return validateApprovedMap(mapOption.hexes);
  }

  return validateMapOption(mapOption.hexes, {
    label: mapOption.name,
    expectedRows: mapOption.source?.rows,
    expectedColumns: mapOption.source?.columns,
    expectedCoordinateConvention: mapOption.source?.coordinate_convention,
    expectedHexes: 126,
    expectedTerrain: mapOption.source?.expected_terrain_counts,
    expectedRiverCoordinates: mapOption.source?.river_coordinates,
    requireWaterFeatureRiver: true
  });
}

function renderStartingWarehouseReference() {
  const values = [
    ["1p", getStartingWarehouseResourceCount(1)],
    ["2p", getStartingWarehouseResourceCount(2)],
    ["3p", getStartingWarehouseResourceCount(3)],
    ["4p", getStartingWarehouseResourceCount(4)],
    ["5+ Council", STANDARD_RULES.councilVariantStartingWarehouseResources]
  ];

  return `
    <div class="setup-resource-reference" aria-label="Starting Warehouse reference">
      <span>Starting Warehouse</span>
      <strong>${getStartingWarehouseResourceCount(state.playerCount)} each</strong>
      <small>${values.map(([label, amount]) => `${label} ${amount}`).join(" · ")}</small>
    </div>
  `;
}

function renderStewardSetupControls() {
  const roleIds = normalizeStewardRoleIds(state.playerCount, state.stewardRoleIds);
  const disabledAttribute = isPlaySessionSetup() ? "" : "disabled";

  return `
    <div class="steward-setup-grid" aria-label="Steward role selection">
      ${Array.from({ length: state.playerCount }, (_, index) => {
        const selectedRoleId = roleIds[index];
        const selectedRole = getStewardRole(selectedRoleId);

        return `
          <label class="setup-steward-card">
            <span class="setup-player-badge">P${index + 1}</span>
            <span class="setup-steward-label">${escapeHtml(selectedRole?.name ?? "Steward")}</span>
            <select class="setup-steward-role" data-player-index="${index}" aria-label="${escapeHtml(`Player ${index + 1} Steward`) }" ${disabledAttribute}>
              ${STEWARD_ROLES.map((role) => {
                const usedByOtherPlayer = roleIds.some((roleId, roleIndex) => roleIndex !== index && roleId === role.id);

                return `
                  <option value="${escapeHtml(role.id)}" ${role.id === selectedRoleId ? "selected" : ""} ${usedByOtherPlayer ? "disabled" : ""}>
                    ${escapeHtml(role.name)}
                  </option>
                `;
              }).join("")}
            </select>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderGoldenSignetControls(game, tileIndex, activeState) {
  const choices = getGoldenSignetMoveChoices(activeState.id);

  return `
    <div class="golden-signet-grid" aria-label="Golden Signet Ring tile relocations">
      ${
        game.map.placedTiles.length
          ? game.map.placedTiles
              .map((placedTile) => {
                const tile = tileIndex.get(placedTile.tileId);
                const choice = choices[placedTile.id] ?? {};
                const selected = Boolean(choice.selected);
                const selectedCoordinate = choice.coordinate ?? placedTile.coordinate ?? getPlacedTileAnchorCoordinate(placedTile);
                const selectedOrientation = choice.orientation ?? placedTile.orientation ?? HEX_DIRECTIONS[0].id;

                return `
                  <div class="golden-signet-row">
                    <label class="checkbox-chip">
                      <input
                        class="golden-signet-move-choice"
                        data-active-encounter-id="${escapeHtml(activeState.id)}"
                        data-placed-tile-id="${escapeHtml(placedTile.id)}"
                        type="checkbox"
                        ${selected ? "checked" : ""}
                      />
                      <span>${escapeHtml(tile?.tile_name ?? placedTile.tileId)}</span>
                    </label>
                    <select
                      class="golden-signet-coordinate"
                      data-active-encounter-id="${escapeHtml(activeState.id)}"
                      data-placed-tile-id="${escapeHtml(placedTile.id)}"
                      aria-label="${escapeHtml(`${tile?.tile_name ?? placedTile.tileId} new coordinate`)}"
                      ${selected ? "" : "disabled"}
                    >
                      ${renderCoordinateOptions(game.map.hexes, selectedCoordinate)}
                    </select>
                    ${
                      tile?.size_hexes > 1
                        ? `<select
                            class="golden-signet-orientation"
                            data-active-encounter-id="${escapeHtml(activeState.id)}"
                            data-placed-tile-id="${escapeHtml(placedTile.id)}"
                            aria-label="${escapeHtml(`${tile.tile_name} new rotation`)}"
                            ${selected ? "" : "disabled"}
                          >
                            ${HEX_DIRECTIONS.map(
                              (direction) =>
                                `<option value="${escapeHtml(direction.id)}" ${direction.id === selectedOrientation ? "selected" : ""}>${escapeHtml(direction.label)}</option>`
                            ).join("")}
                          </select>`
                        : ""
                    }
                  </div>
                `;
              })
              .join("")
          : `<small>No placed tiles</small>`
      }
    </div>
  `;
}

function renderActiveEncounterList(activeStates, encounterIndex, game) {
  if (activeStates.length === 0) {
    return `<p class="empty-note">None</p>`;
  }

  const arrivalRequirementDiscount = getPendingArrivalRequirementDiscount(game);
  const burdenResolutionDiscount = getPendingBurdenResolutionDiscount(game);
  const tileIndex = state.data ? createTileIndex(state.data.tiles) : new Map();
  const playOpen = isPlaySessionPlaying();

  return `
    <ol class="card-list encounter-active-list">
      ${activeStates
        .map((activeState) => {
          const card = encounterIndex.get(activeState.cardId);
          const boonStrainRelief =
            activeState.encounterType === ENCOUNTER_TYPES.BOON &&
            activeState.effect?.type === "optional_resource_strain_relief"
              ? activeState.effect
              : null;
          const boonExchange =
            activeState.encounterType === ENCOUNTER_TYPES.BOON &&
            activeState.effect?.type === "optional_resource_exchange"
              ? activeState.effect
              : null;
          const boonStewardHelp =
            activeState.encounterType === ENCOUNTER_TYPES.BOON &&
            activeState.effect?.type === "steward_help"
              ? activeState.effect
              : null;
          const goldenScroll =
            activeState.encounterType === ENCOUNTER_TYPES.GOLDEN_BOON &&
            activeState.effect?.type === "golden_scroll_hand_refresh"
              ? activeState.effect
              : null;
          const goldenSignet =
            activeState.encounterType === ENCOUNTER_TYPES.GOLDEN_BOON &&
            activeState.effect?.type === "golden_signet_ring_relocate_tiles"
              ? activeState.effect
              : null;
          const burdenRevealChoice =
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
            isPendingBurdenRevealChoice(activeState.pendingChoice)
              ? activeState.pendingChoice
              : null;
          const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);
          const normalTurnActionsOpen = !openingRequirement;
          const boonStrainReliefCandidates = boonStrainRelief
            ? getBoonStrainReliefCandidates(game, tileIndex, boonStrainRelief)
            : [];
          const boonStrainReliefTargetIds = boonStrainRelief
            ? getBoonStrainReliefTargetIds(activeState.id, boonStrainReliefCandidates, boonStrainRelief.maxTargets)
            : [];
          const burdenResolution =
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN && card
              ? getBurdenResolutionCost(card, game.season)
              : null;
          const burdenStewardPowerProviders = burdenResolution?.supported
            ? getBurdenStewardPowerProviders(game, tileIndex)
            : [];
          const wardenSuppressionProviders =
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved
              ? getWardenBurdenSuppressionProviders(game, tileIndex)
              : [];
          const selectedWardenSuppressionProvider = wardenSuppressionProviders[0] ?? null;
          const selectedBurdenStewardPowerId = getSelectedStewardPowerId(
            state.stewardBurdenPowerIds[activeState.id] ?? "",
            burdenStewardPowerProviders
          );
          const burdenChoices = burdenResolution?.requiresPaymentChoice
            ? getBurdenPaymentChoices(activeState.id, burdenResolution)
            : [];
          const burdenPaymentReady =
            !burdenResolution?.requiresPaymentChoice || burdenChoices.every((resource) => Boolean(resource));
          const burdenResolutionDiscountCost =
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN && burdenResolution?.supported && burdenPaymentReady
              ? getBurdenResolutionSelectedCost(activeState.id, burdenResolution)
              : [];
          const burdenResolutionDiscountChoices = getBurdenResolutionDiscountChoices(
            activeState.id,
            burdenResolutionDiscountCost,
            burdenResolutionDiscount
          );
          const burdenResolutionDiscountReady =
            !burdenResolutionDiscount ||
            activeState.encounterType !== ENCOUNTER_TYPES.BURDEN ||
            burdenResolutionDiscountChoices.every((resource) => Boolean(resource));
          const arrivalRequirementBaseCost =
            activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL && card
              ? getArrivalBaseCompletionCost(card, game)
              : [];
          const arrivalRequirementDiscountChoices = getArrivalRequirementDiscountChoices(
            activeState.id,
            arrivalRequirementDiscount,
            arrivalRequirementBaseCost
          );
          const arrivalRequirementDiscountReady =
            !arrivalRequirementDiscount ||
            activeState.encounterType !== ENCOUNTER_TYPES.ARRIVAL ||
            arrivalRequirementDiscountChoices.every((resource) => Boolean(resource));
          const canCompleteArrival =
            playOpen &&
            activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            Boolean(game.activePlayerId) &&
            normalTurnActionsOpen &&
            arrivalRequirementDiscountReady;
          const canResolveBurden =
            playOpen &&
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            Boolean(game.activePlayerId) &&
            normalTurnActionsOpen &&
            !burdenRevealChoice &&
            Boolean(burdenResolution?.supported) &&
            burdenPaymentReady &&
            burdenResolutionDiscountReady;
          const canResolveBurdenChoice =
            playOpen &&
            Boolean(burdenRevealChoice) &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            canAffordCost(game.warehouse, getBurdenChoicePaymentCost(activeState));
          const canSuppressBurden =
            playOpen &&
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            normalTurnActionsOpen &&
            Boolean(selectedWardenSuppressionProvider) &&
            !activeState.suppressedByStewardPower;
          const canResolveBoon =
            playOpen &&
            Boolean(boonStrainRelief || boonExchange || boonStewardHelp || goldenScroll || goldenSignet) &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            normalTurnActionsOpen &&
            (goldenScroll
              ? true
              : goldenSignet
              ? getGoldenSignetRelocations(activeState.id).length <= (goldenSignet.maxTiles ?? 5)
              : boonStewardHelp
              ? getBoonStewardHelpGainChoices(activeState.id, boonStewardHelp).every(Boolean)
              : boonStrainRelief
              ? boonStrainReliefTargetIds.length > 0 && canAffordCost(game.warehouse, boonStrainRelief.cost)
              : getBoonExchangePaymentChoices(activeState.id, boonExchange).every(Boolean) &&
                getBoonExchangeGainChoices(activeState.id, boonExchange).every(Boolean) &&
                canAffordCost(
                  game.warehouse,
                  getResourcePaymentAction(getBoonExchangePaymentChoices(activeState.id, boonExchange))
                ));
          return `
            <li class="card-row encounter-story-card type-${slug(activeState.encounterType)} ${burdenRevealChoice ? "has-required-choice" : ""}">
              <div class="encounter-card-main">
                ${renderEncounterFace(card, activeState, game, burdenResolution)}
              </div>
              <div class="card-actions encounter-card-actions">
                ${renderBurdenPaymentChoices(activeState, burdenResolution, game)}
                ${renderBurdenChoiceControls(activeState)}
                ${renderBurdenResolutionDiscountChoices(activeState, burdenResolutionDiscountCost, burdenResolutionDiscount)}
                ${renderArrivalRequirementDiscountChoices(activeState, card, arrivalRequirementDiscount, game)}
                ${renderArrivalUnlockPreview(activeState, card, game, tileIndex)}
                ${
                  burdenResolution?.supported
                    ? renderStewardPowerSelect({
                        className: "steward-burden-power",
                        label: "Steward Power",
                        providers: burdenStewardPowerProviders,
                        selectedId: selectedBurdenStewardPowerId,
                        attributes: `data-active-encounter-id="${escapeHtml(activeState.id)}"`
                      })
                    : ""
                }
                ${
                  boonStrainRelief
                    ? renderBoonStrainReliefControls(
                        game,
                        tileIndex,
                        activeState,
                        boonStrainReliefCandidates,
                        boonStrainReliefTargetIds
                      )
                    : ""
                }
                ${boonExchange ? renderBoonExchangeControls(game, activeState) : ""}
                ${boonStewardHelp ? renderBoonStewardHelpControls(game, activeState) : ""}
                ${goldenScroll ? renderGoldenScrollControls(game, encounterIndex, activeState) : ""}
                ${goldenSignet ? renderGoldenSignetControls(game, tileIndex, activeState) : ""}
                ${
                  canCompleteArrival
                    ? renderArrivalCompleteButton(activeState, card, arrivalRequirementDiscount, game)
                    : ""
                }
                ${
                  burdenResolution?.supported
                    ? `<button class="mini-action-button resolve-burden" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button" ${canResolveBurden ? "" : "disabled"}>Resolve</button>`
                    : ""
                }
                ${
                  selectedWardenSuppressionProvider
                    ? `<button class="mini-action-button suppress-burden" data-active-encounter-id="${escapeHtml(activeState.id)}" data-steward-power-provider-id="${escapeHtml(selectedWardenSuppressionProvider.placedTile.id)}" type="button" ${canSuppressBurden ? "" : "disabled"}>${activeState.suppressedByStewardPower ? "Ignored this round" : "Ignore this round"}</button>`
                    : ""
                }
                ${
                  burdenRevealChoice
                    ? `<button class="mini-action-button resolve-burden-choice required-choice-button" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button" ${canResolveBurdenChoice ? "" : "disabled"}>Apply Required Choice</button>`
                    : ""
                }
                ${
                  boonStrainRelief || boonExchange || boonStewardHelp || goldenScroll || goldenSignet
                    ? `<button class="mini-action-button resolve-boon" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button" ${canResolveBoon ? "" : "disabled"}>Resolve</button>
                       ${boonStewardHelp ? "" : `<button class="mini-action-button skip-boon" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button" ${playOpen ? "" : "disabled"}>Skip</button>`}`
                    : ""
                }
              </div>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderSetupControls() {
  const setupOpen = isPlaySessionSetup();
  const playing = isPlaySessionPlaying();
  const ended = isPlaySessionEnded();
  const inputDisabled = setupOpen ? "" : "disabled";
  const setupNote = setupOpen
    ? "Choose players and Stewards, deal fresh cards if needed, then start."
    : playing
      ? "Setup is locked while this playthrough is active."
      : "Playthrough ended. Reset Game to prepare a new table.";

  return `
    <section id="setup-panel" class="state-panel setup-panel player-setup-panel">
      <header class="setup-menu-hero">
        <span>Table Setup</span>
        <h2>Prepare the table</h2>
        <p class="setup-session-note session-${escapeHtml(state.playSessionState)}">${escapeHtml(setupNote)}</p>
      </header>

      <div class="setup-flow-grid">
        <article class="setup-step-card setup-player-card">
          <header class="setup-step-heading">
            <span>1</span>
            <strong>Players</strong>
          </header>
          <label class="setup-inline-field">
            <span>Player count</span>
            <select id="player-count" aria-label="Players" ${inputDisabled}>
              ${[1, 2, 3, 4]
                .map((count) => `<option value="${count}" ${count === state.playerCount ? "selected" : ""}>${count}</option>`)
                .join("")}
            </select>
          </label>
          <p class="setup-warehouse-note">Warehouse starts with ${getStartingWarehouseResourceCount(state.playerCount)} of each resource.</p>
        </article>

        <article class="setup-step-card setup-stewards-card">
          <header class="setup-step-heading">
            <span>2</span>
            <strong>Stewards</strong>
          </header>
          ${renderStewardSetupControls()}
        </article>

        <article class="setup-step-card setup-ready-card">
          <header class="setup-step-heading">
            <span>3</span>
            <strong>Cards and start</strong>
          </header>
          <div class="button-row setup-action-row">
            ${
              setupOpen
                ? `<button id="redeal-cards" class="secondary-button setup-deal-button" type="button">Deal Cards</button>
                   <button id="start-game" class="primary-button" type="button">Start Game</button>`
                : playing
                  ? `<button id="end-game" class="secondary-button danger-button" type="button">End Game</button>
                     <button id="reset-game" class="secondary-button" type="button">Reset Game</button>`
                  : `<button id="reset-game" class="primary-button" type="button">Reset Game</button>`
            }
          </div>
          ${ended ? `<p class="setup-session-note session-ended">The board is frozen for review until you reset.</p>` : ""}
        </article>
      </div>
    </section>
  `;
}

function renderHeaderTableAction() {
  if (isPlaySessionSetup()) {
    return `
      <details class="header-setup-menu" data-header-menu="${HEADER_MENUS.SETUP}" ${state.openHeaderMenu === HEADER_MENUS.SETUP ? "open" : ""}>
        <summary class="header-rulebook-link header-table-action header-setup-summary">Setup</summary>
        <div class="header-setup-popover">
          ${renderSetupControls()}
        </div>
      </details>
    `;
  }

  if (isPlaySessionEnded()) {
    return `<button id="reset-game" class="header-rulebook-link header-table-action" type="button">Reset</button>`;
  }

  return `<button id="end-game" class="header-rulebook-link header-table-action is-danger" type="button">End Game</button>`;
}

function getHeaderStewardMenuPlayers() {
  const gamePlayers = state.game?.players ?? [];
  const roleIds = isPlaySessionSetup()
    ? normalizeStewardRoleIds(state.playerCount, state.stewardRoleIds)
    : gamePlayers.map((player) => player.stewardRoleId);

  return roleIds.map((roleId, index) => {
    const player = gamePlayers[index] ?? null;
    const role = getStewardRole(player?.stewardRoleId ?? roleId);
    const power = getStewardPowerDetailsForRole(role?.id);
    const tokenCoordinate =
      player?.stewardHousePlacement?.tokenCoordinate ??
      player?.stewardHousePlacement?.coordinate ??
      "";
    const powerUsed = Boolean(
      power?.type &&
      state.game?.season &&
      player?.stewardPowerSeasons?.[power.type]?.includes(state.game.season)
    );

    return {
      id: player?.id ?? `P${index + 1}`,
      name: player?.name ?? `Player ${index + 1}`,
      role,
      power,
      tokenCoordinate,
      powerUsed,
      startingBenefitUsed: Boolean(player?.stewardStartingBenefitUsed),
      active: Boolean(player && state.game?.activePlayerId === player.id && isPlaySessionPlaying())
    };
  });
}

function getStewardMenuProviderForSelectedPlacement(game, tileIndex, playerEntry) {
  const selectedTile = getSelectedPlacementTile(tileIndex);

  if (!selectedTile || !tileMatchesActiveOpeningRequirement(game, selectedTile)) {
    return null;
  }

  const footprint = getFootprintCoordinates(
    state.selectedCoordinate,
    selectedTile.size_hexes,
    state.selectedOrientation,
    game.map.hexes
  );
  const actionCost = footprint ? calculatePlacementActionCostForUi(game, selectedTile, footprint, tileIndex) : null;

  return (
    getPlacementStewardPowerProviders(game, selectedTile, actionCost, tileIndex).find(
      (provider) => provider.player.id === playerEntry.id
    ) ?? null
  );
}

function getStewardMenuProviderForSelectedUpgrade(game, tileIndex, playerEntry) {
  const placedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const tileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const upgradeTile = tileDefinition ? findUpgradeTile(tileDefinition, tileIndex) : null;

  if (!placedTile || !tileDefinition || !upgradeTile) {
    return null;
  }

  const actionCost = calculatePlacedTileActionCost(
    game,
    placedTile,
    { tileIndex, playerId: playerEntry.id },
    "upgradeActionCost"
  );

  return (
    getUpgradeStewardPowerProviders(game, tileDefinition, tileIndex, actionCost).find(
      (provider) => provider.player.id === playerEntry.id
    ) ?? null
  );
}

function getStewardMenuProviderForSelectedActivation(game, tileIndex, playerEntry) {
  const placedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const tileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;

  if (!placedTile || !tileDefinition) {
    return null;
  }

  const actionCost = calculatePlacedTileActionCost(
    game,
    placedTile,
    { tileIndex, playerId: playerEntry.id },
    "activationActionCost"
  );

  return (
    getActivationStewardPowerProviders(game, tileIndex, actionCost).find(
      (provider) => provider.player.id === playerEntry.id
    ) ?? null
  );
}

function getQuartermasterStartingExchangeKey(playerId) {
  return `quartermaster-starting-exchange-${playerId}`;
}

function isQuartermasterStartingExchangeWindow(game) {
  return Boolean(
    isPlaySessionPlaying() &&
    game?.phase === GAME_PHASES.SEED_ENCOUNTERS &&
    game.round === 1 &&
    game.season === "I" &&
    !game.encounter.seededRounds.includes(1)
  );
}

function canUseQuartermasterStartingExchange(game, playerEntry) {
  return Boolean(
    playerEntry.role?.id === "quartermaster" &&
    !playerEntry.startingBenefitUsed &&
    isQuartermasterStartingExchangeWindow(game)
  );
}

function renderResourceSelectOptions(resources, selectedResource) {
  return resources
    .map(
      (resource) =>
        `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
    )
    .join("");
}

function renderQuartermasterStartingExchangeControls(game, playerEntry) {
  if (playerEntry.role?.id !== "quartermaster") {
    return "";
  }

  if (playerEntry.startingBenefitUsed) {
    return `<p class="steward-menu-note is-used">Setup exchange used.</p>`;
  }

  if (!isPlaySessionPlaying()) {
    return `<p class="steward-menu-note">Setup exchange becomes available after Start Game, before first seeding.</p>`;
  }

  if (game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
    return `<p class="steward-menu-note">Place Steward tokens first, then Quartermaster may exchange before seeding.</p>`;
  }

  if (!isQuartermasterStartingExchangeWindow(game)) {
    return "";
  }

  const exchangeKey = getQuartermasterStartingExchangeKey(playerEntry.id);
  const amount = getStewardExchangeAmount(exchangeKey, QUARTERMASTER_STARTING_EXCHANGE_DETAILS);
  const paymentChoices = getStewardExchangePaymentChoices(exchangeKey, QUARTERMASTER_STARTING_EXCHANGE_DETAILS);
  const gainChoices = getStewardExchangeGainChoices(exchangeKey, QUARTERMASTER_STARTING_EXCHANGE_DETAILS);
  const ready =
    paymentChoices.every(Boolean) &&
    gainChoices.every(Boolean) &&
    canAffordCost(game.warehouse, getResourcePaymentAction(paymentChoices));

  return `
    <div class="steward-menu-exchange" aria-label="Quartermaster setup Warehouse exchange">
      <header>
        <strong>Setup Exchange</strong>
        <span>Before first seeding</span>
      </header>
      <label class="steward-menu-count">
        <span>Count</span>
        <select class="steward-starting-exchange-count" data-exchange-key="${escapeHtml(exchangeKey)}" aria-label="Quartermaster exchange count">
          ${Array.from({ length: QUARTERMASTER_STARTING_EXCHANGE_DETAILS.maxAmount }, (_, index) => index + 1)
            .map((option) => `<option value="${option}" ${option === amount ? "selected" : ""}>${option}</option>`)
            .join("")}
        </select>
      </label>
      <div class="steward-menu-exchange-grid">
        ${Array.from({ length: amount }, (_, index) => {
          const selectedPayment = paymentChoices[index] ?? "";
          const selectedGain = gainChoices[index] ?? "";

          return `
            <select class="steward-exchange-payment-resource" data-placed-tile-id="${escapeHtml(exchangeKey)}" data-payment-index="${index}" aria-label="Quartermaster pay resource ${index + 1}">
              <option value="">Pay...</option>
              ${renderResourceSelectOptions(game.rules.resources, selectedPayment)}
            </select>
            <select class="steward-exchange-gain-resource" data-placed-tile-id="${escapeHtml(exchangeKey)}" data-gain-index="${index}" aria-label="Quartermaster gain resource ${index + 1}">
              <option value="">Gain...</option>
              ${renderResourceSelectOptions(game.rules.resources, selectedGain)}
            </select>
          `;
        }).join("")}
      </div>
      <button
        class="steward-menu-button steward-menu-exchange-button"
        type="button"
        data-steward-menu-action="use-quartermaster-starting-exchange"
        data-steward-menu-player-id="${escapeHtml(playerEntry.id)}"
        ${ready ? "" : "disabled"}
      >
        Exchange Resources
      </button>
      ${ready ? "" : `<small>Choose matching pay and gain resources that are available in the Warehouse.</small>`}
    </div>
  `;
}

function renderWardenSuppressionControls(game, tileIndex, encounterIndex, playerEntry) {
  if (
    playerEntry.role?.id !== "warden" ||
    !isPlaySessionPlaying() ||
    !playerEntry.active ||
    playerEntry.powerUsed ||
    game.phase !== GAME_PHASES.PLAYER_TURNS
  ) {
    return "";
  }

  const provider = getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.SUPPRESS_BURDEN
  ).find((candidate) => candidate.player.id === playerEntry.id);
  const burdens = game.encounter.active.filter(
    (activeState) =>
      activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
      !activeState.resolved &&
      !activeState.suppressedByStewardPower
  );

  if (!provider || burdens.length === 0) {
    return "";
  }

  return `
    <div class="steward-menu-power-actions" aria-label="Warden Burden suppression">
      <strong>Ignore a Burden</strong>
      ${burdens
        .map((activeState) => {
          const card = encounterIndex.get(activeState.cardId);

          return `
            <button
              class="steward-menu-button"
              type="button"
              data-steward-menu-action="suppress-burden"
              data-steward-menu-provider-id="${escapeHtml(provider.placedTile.id)}"
              data-steward-menu-active-encounter-id="${escapeHtml(activeState.id)}"
            >
              ${escapeHtml(card?.card_name ?? "Burden")}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function getStewardMenuPowerUseState(playerEntry, tileIndex) {
  const game = state.game;
  const power = playerEntry.power;

  if (!game || !power || !playerEntry.role) {
    return {
      tone: "waiting",
      detail: "Choose a Steward role in Setup.",
      action: null
    };
  }

  if (isPlaySessionSetup()) {
    return {
      tone: "waiting",
      detail: "Start the game, then place this Steward token for free.",
      action: { label: "Open Setup", command: "open-setup", target: "" }
    };
  }

  if (game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
    return playerEntry.active
      ? {
          tone: "ready",
          detail: "Click a highlighted setup hex to place this Steward token.",
          action: { label: "Show Map", command: "focus-map", target: "#map-panel" }
        }
      : {
          tone: "waiting",
          detail: playerEntry.tokenCoordinate
            ? `Token placed at ${playerEntry.tokenCoordinate}.`
            : "Waiting for this Steward's setup token placement.",
          action: null
        };
  }

  if (playerEntry.powerUsed) {
    return {
      tone: "used",
      detail: "This once-per-season power has been used. It refreshes next Season.",
      action: null
    };
  }

  if (!playerEntry.active) {
    return {
      tone: "waiting",
      detail: "Ready when this Steward is the active player.",
      action: null
    };
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return {
      tone: "waiting",
      detail: "Ready once player actions are open.",
      action: null
    };
  }

  if (power.type === STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION) {
    const provider = getStewardMenuProviderForSelectedPlacement(game, tileIndex, playerEntry);
    const selectedTile = getSelectedPlacementTile(tileIndex);

    return provider
      ? {
          tone: "ready",
          detail: `Can be applied to the selected ${selectedTile.tile_name} placement.`,
          action: {
            label: "Use On Placement",
            command: "select-placement-power",
            target: "#placement-panel",
            providerId: provider.placedTile.id
          }
        }
      : {
          tone: "ready",
          detail: `Choose a ${power.categories?.join(" or ") ?? "matching"} tile, then use this on its placement.`,
          action: { label: "Open Tiles", command: "focus-tiles", target: "#placement-panel" }
        };
  }

  if (power.type === STEWARD_POWER_TYPES.FREE_CORE_UPGRADE_ACTION) {
    const provider = getStewardMenuProviderForSelectedUpgrade(game, tileIndex, playerEntry);

    return provider
      ? {
          tone: "ready",
          detail: "Can be applied to the selected Core tile upgrade.",
          action: {
            label: "Use On Upgrade",
            command: "select-upgrade-power",
            target: "#selected-tile-panel",
            providerId: provider.placedTile.id
          }
        }
      : {
          tone: "ready",
          detail: "Select a placed Core tile with an upgrade side, then apply this to the upgrade.",
          action: { label: "Open Map Tile", command: "focus-selected-tile", target: "#selected-tile-panel" }
        };
  }

  if (power.type === STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION) {
    const placementProvider = getStewardMenuProviderForSelectedPlacement(game, tileIndex, playerEntry);
    const upgradeProvider = getStewardMenuProviderForSelectedUpgrade(game, tileIndex, playerEntry);
    const activationProvider = getStewardMenuProviderForSelectedActivation(game, tileIndex, playerEntry);

    if (placementProvider) {
      return {
        tone: "ready",
        detail: "Can be applied to the selected out-of-network placement.",
        action: {
          label: "Use On Placement",
          command: "select-placement-power",
          target: "#placement-panel",
          providerId: placementProvider.placedTile.id
        }
      };
    }

    if (upgradeProvider) {
      return {
        tone: "ready",
        detail: "Can be applied to the selected out-of-network upgrade.",
        action: {
          label: "Use On Upgrade",
          command: "select-upgrade-power",
          target: "#selected-tile-panel",
          providerId: upgradeProvider.placedTile.id
        }
      };
    }

    if (activationProvider) {
      return {
        tone: "ready",
        detail: "Can be applied to the selected out-of-network tile activation.",
        action: {
          label: "Use On Activation",
          command: "select-activation-power",
          target: "#selected-tile-panel",
          providerId: activationProvider.placedTile.id
        }
      };
    }

    return {
      tone: "ready",
      detail: "Select a tile or map action outside this Steward's network to make this power available.",
      action: { label: "Show Map", command: "focus-map", target: "#map-panel" }
    };
  }

  if (power.type === STEWARD_POWER_TYPES.SUPPRESS_BURDEN) {
    const burdens = game.encounter.active.filter(
      (activeState) => activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved
    );

    return burdens.length
      ? {
          tone: "ready",
          detail: "Use this on an active Burden from the Stewards Board.",
          action: { label: "Open Burdens", command: "focus-encounters", target: "#encounter-panel" }
        }
      : {
          tone: "ready",
          detail: "No active Burden needs this power right now.",
          action: { label: "Open Encounters", command: "focus-encounters", target: "#encounter-panel" }
        };
  }

  if (power.type === STEWARD_POWER_TYPES.FREE_BURDEN_RESOLUTION_ACTION) {
    return {
      tone: "ready",
      detail: "Use this from a Burden's resolve controls on the Stewards Board.",
      action: { label: "Open Burdens", command: "focus-encounters", target: "#encounter-panel" }
    };
  }

  if (power.type === STEWARD_POWER_TYPES.RESOURCE_EXCHANGE) {
    if (canUseQuartermasterStartingExchange(game, playerEntry)) {
      return {
        tone: "ready",
        detail: "Use the setup exchange below before seeding Season I.",
        action: null
      };
    }

    return {
      tone: "ready",
      detail: "Use the Warehouse Exchange controls below while Quartermaster is the active Steward.",
      action: null
    };
  }

  return {
    tone: "ready",
    detail: "Ready this Season.",
    action: null
  };
}

function renderStewardMenuFocus(players) {
  if (!isPlaySessionPlaying()) {
    return "";
  }

  const activePlayer = players.find((player) => player.active);

  if (!activePlayer) {
    return "";
  }

  return `
    <aside class="steward-menu-focus">
      <span>Active Steward</span>
      <strong>${escapeHtml(`${activePlayer.id} - ${activePlayer.role?.name ?? "Steward"}`)}</strong>
      <small>${escapeHtml(activePlayer.tokenCoordinate ? `Token at ${activePlayer.tokenCoordinate}` : "Token not placed")}</small>
    </aside>
  `;
}

function renderStewardMenuCard(player, tileIndex, encounterIndex) {
  const role = player.role;
  const powerUse = getStewardMenuPowerUseState(player, tileIndex);
  const exchangeProvider =
    getAvailableStewardPowerProviders(
      state.game,
      { tileIndex, playerId: player.id },
      STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
    )[0] ?? null;
  const exchangeDetails = exchangeProvider?.details ?? null;
  const exchangePayments =
    exchangeProvider && exchangeDetails
      ? getStewardExchangePaymentChoices(exchangeProvider.placedTile.id, exchangeDetails)
      : [];
  const exchangeGains =
    exchangeProvider && exchangeDetails
      ? getStewardExchangeGainChoices(exchangeProvider.placedTile.id, exchangeDetails)
      : [];
  const canUseStewardExchange =
    Boolean(
      isPlaySessionPlaying() &&
      state.game?.phase === GAME_PHASES.PLAYER_TURNS &&
      state.game?.activePlayerId === player.id &&
      exchangeProvider &&
      exchangePayments.every(Boolean) &&
      exchangeGains.every(Boolean) &&
      canAffordCost(state.game.warehouse, getResourcePaymentAction(exchangePayments))
    );
  const powerStatus = isPlaySessionSetup()
    ? "Ready after setup"
    : player.powerUsed
      ? `Used in Season ${state.game?.season ?? ""}`.trim()
      : "Ready this Season";
  const statusClass = player.powerUsed ? "is-used" : "is-ready";

  return `
    <article class="steward-menu-card ${player.active ? "is-active" : ""}">
      <header>
        <span>${escapeHtml(player.id)}</span>
        <strong>${escapeHtml(role?.name ?? "Steward")}</strong>
        <small>${escapeHtml(player.name)}</small>
      </header>
      <dl class="steward-menu-list">
        <div>
          <dt>Token</dt>
          <dd>${escapeHtml(player.tokenCoordinate || role?.tokenPlacementSummary || "Place during setup")}</dd>
        </div>
        <div>
          <dt>First use</dt>
          <dd>${escapeHtml(role?.startingBenefit ?? "No starting benefit listed")}</dd>
        </div>
        <div>
          <dt>Power</dt>
          <dd>${escapeHtml(player.power?.label ?? "No once-per-season power listed")}</dd>
        </div>
        <div>
          <dt>Use now</dt>
          <dd>${escapeHtml(powerUse.detail)}</dd>
        </div>
        <div>
          <dt>Bonus</dt>
          <dd>${escapeHtml(role?.objectiveSummary ?? "No scoring bonus listed")}</dd>
        </div>
      </dl>
      ${renderQuartermasterStartingExchangeControls(state.game, player)}
      ${renderStewardExchangeControls(
        state.game,
        exchangeProvider?.placedTile ?? null,
        exchangeDetails,
        canUseStewardExchange
      )}
      ${renderWardenSuppressionControls(state.game, tileIndex, encounterIndex, player)}
      <div class="steward-menu-footer">
        <p class="steward-menu-status ${statusClass}">${escapeHtml(powerStatus)}</p>
        ${
          powerUse.action
            ? `<button class="steward-menu-button" type="button"
                data-steward-menu-action="${escapeHtml(powerUse.action.command)}"
                data-steward-menu-target="${escapeHtml(powerUse.action.target ?? "")}"
                data-steward-menu-provider-id="${escapeHtml(powerUse.action.providerId ?? "")}">
                ${escapeHtml(powerUse.action.label)}
              </button>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderHeaderStewardMenu(tileIndex, encounterIndex) {
  const players = getHeaderStewardMenuPlayers();

  return `
    <details class="header-setup-menu header-steward-menu" data-header-menu="${HEADER_MENUS.STEWARDS}" ${state.openHeaderMenu === HEADER_MENUS.STEWARDS ? "open" : ""}>
      <summary class="header-rulebook-link header-table-action header-setup-summary">Stewards</summary>
      <div class="header-setup-popover header-steward-popover">
        <section class="steward-menu-panel" aria-label="Player and Steward abilities">
          <header>
            <p class="eyebrow">Player Stewards</p>
            <h2>Tokens, Powers, Bonuses</h2>
          </header>
          ${renderStewardMenuFocus(players)}
          <div class="steward-menu-grid">
            ${players.map((player) => renderStewardMenuCard(player, tileIndex, encounterIndex)).join("")}
          </div>
        </section>
      </div>
    </details>
  `;
}

function renderHeaderActions(tileIndex, encounterIndex) {
  return `
    <div class="header-actions">
      <a class="header-rulebook-link" href="./rulebook.pdf" target="_blank" rel="noopener">View Rulebook</a>
      ${renderHeaderStewardMenu(tileIndex, encounterIndex)}
      ${renderHeaderTableAction()}
    </div>
  `;
}

function renderStewardMarkerDebugControls(game, tileIndex) {
  return `
    <div class="panel-section">
      <h2>Steward Markers</h2>
      ${
        game.players
          .map((player) => {
            const selectedPlacedTileId = player.lastInteraction?.placedTileId ?? "";

            return `
              <label class="stacked-field">
                <span>${escapeHtml(player.name)}</span>
                <select class="debug-player-marker" data-player-id="${escapeHtml(player.id)}" aria-label="${escapeHtml(`${player.name} Steward marker`)}" ${game.map.placedTiles.length ? "" : "disabled"}>
                  <option value="">No marker</option>
                  ${game.map.placedTiles
                    .map((placedTile) => {
                      const tile = tileIndex.get(placedTile.tileId);
                      const coordinate = getPlacedTileAnchorCoordinate(placedTile);

                      return `
                        <option value="${escapeHtml(placedTile.id)}" ${placedTile.id === selectedPlacedTileId ? "selected" : ""}>
                          ${escapeHtml(`${tile?.tile_name ?? placedTile.tileId} at ${coordinate}`)}
                        </option>
                      `;
                    })
                    .join("")}
                </select>
              </label>
            `;
          })
          .join("")
      }
    </div>
  `;
}

function renderDebugDetails(title, body, { open = false, className = "" } = {}) {
  const classes = ["panel-section", "debug-details", className].filter(Boolean).join(" ");

  return `
    <details class="${classes}" ${open ? "open" : ""}>
      <summary>${escapeHtml(title)}</summary>
      ${body}
    </details>
  `;
}

function renderMapDebugPanel(data, countValidation, mapValidation, game, tileIndex) {
  const mapHexes = data.mapHexes;
  const selectedHex = mapHexes.find((hex) => hex.Coordinate === state.selectedCoordinate) ?? mapHexes[0];
  const placedTile = getPlacedTileAt(game, selectedHex.Coordinate);
  const placedTileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const selectedLastInteractionPlayers = getPlayersByMapCoordinate(game).get(selectedHex.Coordinate) ?? [];
  const supportDetails = placedTile ? getEffectiveSupportDetails(game, placedTile.id, { tileIndex }) : null;
  const travelNetworks = buildTravelNetworks(game, { tileIndex });
  const selectedNetwork = placedTile ? getNetworkForPlacedTile(travelNetworks, placedTile.id) : null;
  const riverHexes = getRiverHexes(mapHexes);
  const bridgeCandidates = getBridgeCandidateHexes(mapHexes);
  const riverAdjacentLand = getRiverAdjacentLandSites(mapHexes);
  const neighborCoordinates = getNeighborCoordinates(selectedHex.Coordinate, mapHexes);
  const selectedNeighbors = neighborCoordinates
    .map((coordinate) => mapHexes.find((hex) => hex.Coordinate === coordinate))
    .filter(Boolean);

  return `
    <aside id="debug-panel" class="debug-panel">
      ${renderSetupControls()}
      ${renderStewardMarkerDebugControls(game, tileIndex)}

      ${renderDebugDetails("Source Counts", `<ul class="metric-list">${renderCounts(countValidation)}</ul>`)}

      ${renderEncounterCoveragePanel(data, game)}

      <div class="panel-section">
        <h2>Selected Hex</h2>
        <dl class="detail-list">
          <div><dt>Coordinate</dt><dd>${escapeHtml(selectedHex.Coordinate)}</dd></div>
          <div><dt>Terrain</dt><dd>${escapeHtml(selectedHex.Terrain)}</dd></div>
          <div><dt>Feature</dt><dd>${escapeHtml(selectedHex.Feature)}</dd></div>
          <div><dt>River Adjacent</dt><dd>${selectedHex.River_Adjacent_Land ? "Yes" : "No"}</dd></div>
          <div><dt>Bridge Review Note</dt><dd>${selectedHex.Bridge_Candidate ? "Yes" : "No"}</dd></div>
          <div><dt>Potential Bridge Site</dt><dd>${selectedHex.Potential_Bridge_Site || selectedHex.Terrain === "Water" ? "Yes" : "No"}</dd></div>
          <div><dt>Placed Tile</dt><dd>${escapeHtml(placedTileDefinition?.tile_name ?? "None")}</dd></div>
          <div><dt>Last Interaction</dt><dd>${escapeHtml(selectedLastInteractionPlayers.map((player) => player.name).join(", ") || "None")}</dd></div>
          <div><dt>Strain</dt><dd>${placedTile?.strain ?? 0}</dd></div>
          <div><dt>Supported</dt><dd>${escapeHtml(formatSupportDetails(supportDetails))}</dd></div>
          <div><dt>Supported Used</dt><dd>${placedTile?.supportedUsedThisRound ? "Yes" : "No"}</dd></div>
          <div><dt>Settlement Network</dt><dd>${escapeHtml(selectedNetwork?.id ?? "None")}</dd></div>
        </dl>
        <h3>Neighbors</h3>
        ${renderBadgeList(selectedNeighbors)}
      </div>

      ${renderDebugDetails(
        "Map Validation",
        `
        <ul class="metric-list">
          <li><span>Hexes</span><strong>${mapValidation.rowCount}</strong></li>
          <li><span>River Hexes</span><strong>${mapValidation.waterHexes.length}</strong></li>
          <li><span>River Components</span><strong class="${mapValidation.riverComponents.length === 1 ? "ok" : "bad"}">${mapValidation.riverComponents.length}</strong></li>
          <li><span>Bridge Notes Are Water</span><strong class="${mapValidation.bridgeCandidatesAreWater ? "ok" : "bad"}">${mapValidation.bridgeCandidatesAreWater ? "Yes" : "No"}</strong></li>
          <li><span>All Water Is River</span><strong class="${mapValidation.allWaterHexesAreRiver ? "ok" : "bad"}">${mapValidation.allWaterHexesAreRiver ? "Yes" : "No"}</strong></li>
          <li><span>River Bridge Sites</span><strong>${mapValidation.waterHexes.length}</strong></li>
          <li><span>River Adjacent Flags</span><strong class="${mapValidation.riverAdjacentLandMatchesSource ? "ok" : "bad"}">${mapValidation.riverAdjacentLandMatchesSource ? "Match" : "Mismatch"}</strong></li>
        </ul>
        ${
          mapValidation.errors.length
            ? `<ul class="error-list">${mapValidation.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`
            : `<p class="status-ok">Map validation passed.</p>`
        }
      `,
        { open: mapValidation.errors.length > 0 }
      )}

      ${renderDebugDetails("Terrain", `<ul class="metric-list">${renderTerrainSummary(mapHexes)}</ul>`)}

      ${renderDebugDetails("River Hexes", renderBadgeList(riverHexes, "river-list"))}

      ${renderDebugDetails("Bridge Review Notes", renderBadgeList(bridgeCandidates, "bridge-list"))}

      ${renderDebugDetails("Potential Bridge Sites", renderBadgeList(riverHexes, "bridge-list"))}

      ${renderDebugDetails("River Adjacent Land", renderBadgeList(riverAdjacentLand))}

      ${renderDebugDetails(
        "Map Coordinates",
        `
        <table class="coordinate-table">
          <thead><tr><th>Hex</th><th>Terrain</th><th>Feature</th></tr></thead>
          <tbody>${renderCoordinateTable(mapHexes, selectedHex)}</tbody>
        </table>
      `,
        { className: "coordinates-section" }
      )}
    </aside>
  `;
}

function renderGameStatus(game, encounterIndex) {
  const deckCards = getCards(game.encounter.deck, encounterIndex);
  const deckCounts = countEncounterTypes(deckCards);
  const hiddenCount = game.players.reduce((sum, player) => sum + player.hand.length, 0);
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);

  return `
    <section class="state-panel status-panel">
      <h2>Game State</h2>
      <ul class="metric-list">
        <li><span>Phase</span><strong>${escapeHtml(formatPhase(game.phase))}</strong></li>
        <li><span>Season</span><strong>${escapeHtml(game.season)}</strong></li>
        <li><span>Round</span><strong>${game.round}/${game.rules.totalRounds}</strong></li>
        <li><span>Players</span><strong>${game.playerCount}</strong></li>
        <li><span>Active Player</span><strong>${escapeHtml(activePlayer ? formatPlayerName(activePlayer) : "None")}</strong></li>
        <li><span>Actions Left</span><strong>${activePlayer ? `${activePlayer.actionsRemaining}/${game.rules.actionsPerPlayer}` : "0/0"}</strong></li>
        <li><span>Actions Each</span><strong>${game.rules.actionsPerPlayer}</strong></li>
        <li><span>Hidden Hands</span><strong>${hiddenCount}</strong></li>
      </ul>
      <h3>Deck Composition</h3>
      ${renderTypeChips(deckCounts)}
    </section>
  `;
}

function getActivePendingBurdenChoice(game, encounterIndex) {
  return (
    game.encounter.active.find(
      (activeState) =>
        activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
        BURDEN_REVEAL_CHOICE_TYPES.includes(activeState.pendingChoice?.type)
    ) ?? null
  );
}

function getAffordableBurdenNames(game, encounterIndex) {
  return game.encounter.active
    .filter((activeState) => activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved)
    .map((activeState) => {
      const card = encounterIndex.get(activeState.cardId);
      const resolution = card ? getBurdenResolutionCost(card, game.season) : null;

      return resolution?.supported && !resolution.requiresPaymentChoice && canAffordCost(game.warehouse, resolution.cost)
        ? card?.card_name
        : null;
    })
    .filter(Boolean);
}

function getArrivalGuideHint(game, encounterIndex) {
  const arrivals = game.encounter.active.filter(
    (activeState) => activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL && !activeState.completed
  );

  if (arrivals.length === 0) {
    return "";
  }

  const urgentArrival = arrivals.find(
    (activeState) => Number(activeState.timerTokens ?? game.rules.arrivalStartTimerTokens ?? 3) <= 1
  );

  if (urgentArrival) {
    const card = encounterIndex.get(urgentArrival.cardId);
    return `${card?.card_name ?? "An Arrival"} is nearly out of time. Check its cost before you spend the turn elsewhere.`;
  }

  const affordableArrival = arrivals.find((activeState) => {
    const card = encounterIndex.get(activeState.cardId);
    return card && canAffordCost(game.warehouse, getArrivalBaseCompletionCost(card, game));
  });

  if (affordableArrival) {
    const card = encounterIndex.get(affordableArrival.cardId);
    return `${card?.card_name ?? "An Arrival"} may be ready to complete. The Complete button will show exactly what it spends.`;
  }

  return `There ${arrivals.length === 1 ? "is" : "are"} ${arrivals.length} Arrival${arrivals.length === 1 ? "" : "s"} in play. Keep an eye on timer tokens while you build.`;
}

function getGuideSelectedTileHint(game, tileIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const selectedPlacedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const tileDefinition = selectedPlacedTile ? tileIndex.get(selectedPlacedTile.tileId) : null;

  if (!activePlayer || !selectedPlacedTile || !tileDefinition || activePlayer.actionsRemaining <= 0) {
    return "";
  }

  const activation = getActivationForDisplay(tileDefinition);
  const activationStatus = getMapActivationActionStatus(game, selectedPlacedTile, tileDefinition, tileIndex, activation);

  if (activation?.details && !activationStatus.blockedReason) {
    return `The selected ${tileDefinition.tile_name} can be used now. Right-click it for ${formatMapActivationActionLabel(activation.details).toLowerCase()}.`;
  }

  const upgradeTile = findUpgradeTile(tileDefinition, tileIndex);
  const upgradeStatus = getMapUpgradeActionStatus(game, selectedPlacedTile, tileDefinition, upgradeTile, tileIndex);

  if (upgradeTile && !upgradeStatus.blockedReason) {
    return `${tileDefinition.tile_name} can upgrade to ${upgradeTile.tile_name}. Right-click it to preview the upgraded side before spending.`;
  }

  return "";
}

function getWarehouseGuideHint(game) {
  const lowResources = game.rules.resources.filter((resource) => Number(game.warehouse.resources[resource] ?? 0) <= 1);

  if (lowResources.length >= 3) {
    return `The Warehouse is thin on ${lowResources.slice(0, 3).join(", ")}. Producing from Resource tiles is a steady next step.`;
  }

  return "";
}

function getStewardHouseProgress(game, tileIndex, player) {
  const role = getStewardRole(player?.stewardRoleId);
  const baseTile = role ? tileIndex.get(role.houseTileId) : null;
  const upgradeTile = baseTile ? findUpgradeTile(baseTile, tileIndex) : null;
  const placedBase = baseTile
    ? game.map.placedTiles.find((placedTile) => placedTile.tileId === baseTile.tile_id) ?? null
    : null;
  const placedUpgrade = upgradeTile
    ? game.map.placedTiles.find((placedTile) => placedTile.tileId === upgradeTile.tile_id) ?? null
    : null;

  return {
    role,
    baseTile,
    upgradeTile,
    placedBase,
    placedUpgrade
  };
}

function summarizeStewardPowerForGuide(upgradeTile) {
  const powerCopy = getStewardPowerCopy(upgradeTile);
  const sentence = powerCopy.split(".")[0]?.trim();

  return sentence || "its Steward Power";
}

function getStewardHouseGuideHint(game, tileIndex, activePlayer) {
  if (!activePlayer || activePlayer.actionsRemaining <= 0) {
    return "";
  }

  const { role, baseTile, upgradeTile, placedBase, placedUpgrade } = getStewardHouseProgress(game, tileIndex, activePlayer);

  if (!role || !baseTile || !upgradeTile || placedUpgrade) {
    return "";
  }

  const powerSummary = summarizeStewardPowerForGuide(upgradeTile);

  if (!placedBase) {
    return `${role.name}'s House is available. Its upgraded side unlocks: ${powerSummary}.`;
  }

  return `${baseTile.tile_name} is placed. Upgrading to ${upgradeTile.tile_name} unlocks: ${powerSummary}.`;
}

function getSeedablePlayers(game) {
  return game.players.filter((player) => (player.hand ?? []).length > 0);
}

function getSeedablePlayerCount(game) {
  return getSeedablePlayers(game).length;
}

function getSeasonalSeedPositions(game = state.game) {
  const positions = game?.rules?.seasonalSeedPositions ?? [
    SEED_PACKET_POSITIONS.TOP,
    SEED_PACKET_POSITIONS.MIDDLE,
    SEED_PACKET_POSITIONS.BOTTOM
  ];
  const validPositions = new Set(Object.values(SEED_PACKET_POSITIONS));
  return positions.filter((position) => validPositions.has(position));
}

function getSeasonalSeedCardsPerPlayer(game = state.game) {
  const count = Number(game?.rules?.seasonalSeedCardsPerPlayer ?? getSeasonalSeedPositions(game).length);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function getRequiredSeasonalSeedPositions(game, player) {
  const positions = getSeasonalSeedPositions(game);
  const requiredCount = Math.min(getSeasonalSeedCardsPerPlayer(game), positions.length, player.hand.length);
  return positions.slice(0, requiredCount);
}

function getRawSeedSelectionMap(player) {
  const selection = state.debugSeedSelections[player.id];

  if (selection && typeof selection === "object" && !Array.isArray(selection)) {
    return selection;
  }

  if (typeof selection === "string" && player.hand.includes(selection)) {
    return {
      [state.debugSeedPosition]: selection
    };
  }

  return {};
}

function getValidSeedSelectionMap(game, player) {
  const rawSelection = getRawSeedSelectionMap(player);
  const requiredPositions = new Set(getRequiredSeasonalSeedPositions(game, player));
  const usedCardIds = new Set();

  return Object.fromEntries(
    Object.entries(rawSelection).filter(([position, cardId]) => {
      if (!requiredPositions.has(position) || !player.hand.includes(cardId) || usedCardIds.has(cardId)) {
        return false;
      }

      usedCardIds.add(cardId);
      return true;
    })
  );
}

function getSelectedSeedSelectionCount(game) {
  return game.players.reduce(
    (total, player) => total + Object.keys(getValidSeedSelectionMap(game, player)).length,
    0
  );
}

function getRequiredSeedSelectionCount(game) {
  return game.players.reduce(
    (total, player) => total + getRequiredSeasonalSeedPositions(game, player).length,
    0
  );
}

function getNextSeasonalSeedPosition(game, player) {
  const requiredPositions = getRequiredSeasonalSeedPositions(game, player);
  const selectionMap = getValidSeedSelectionMap(game, player);
  return requiredPositions.find((position) => !selectionMap[position]) ?? requiredPositions[0] ?? SEED_PACKET_POSITIONS.TOP;
}

function getGuideInstruction(game, tileIndex, encounterIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const seeded = game.encounter.seededRounds.includes(game.round);
  const selectedSeedCount = getSelectedSeedSelectionCount(game);
  const requiredSeedCount = getRequiredSeedSelectionCount(game);
  const seedablePlayerCount = getSeedablePlayerCount(game);

  if (isPlaySessionSetup()) {
    return "Choose player count and Stewards in Setup, deal cards if needed, then press Start Game.";
  }

  if (isPlaySessionEnded()) {
    return "Playthrough ended. Review the board, score, Warehouse, and Encounter cards, then Reset Game for the next table.";
  }

  if (state.lastActionResult && !state.lastActionResult.ok) {
    return `That action was blocked: ${state.lastActionResult.errors?.[0] ?? "check the highlighted requirement"}`;
  }

  if (game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
    const houseText = activePlayer ? formatPendingStewardHousePlacement(game, activePlayer) : "";
    return houseText
      ? `${formatPlayerName(activePlayer)} places their Steward token for free: ${houseText}. Click a highlighted token hex.`
      : "Place each Steward token for free, then seed Encounter cards.";
  }

  if (game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded) {
    if (seedablePlayerCount === 0) {
      return "No players have Encounter Cards left to seed. The round is moving straight to Reveal Encounters.";
    }

    if (selectedSeedCount > 0 && selectedSeedCount < requiredSeedCount) {
      return `Choose the remaining seasonal seed cards. ${selectedSeedCount}/${requiredSeedCount} card slots are selected.`;
    }

    if (selectedSeedCount === requiredSeedCount) {
      return "All seasonal seed slots are chosen. Press Seed, then Reveal the round.";
    }

    return "Next, each player chooses three cards from their hand: one Top, one Middle, and one Bottom.";
  }

  if (game.phase === GAME_PHASES.REVEAL_ENCOUNTERS) {
    return "Press Reveal, then read the Stewards Board before planning the turn.";
  }

  if (game.phase === GAME_PHASES.END_ROUND) {
    return "Round business is done. Resolve end of round when everyone is ready.";
  }

  if (game.phase === GAME_PHASES.COMPLETE) {
    return "The settlement has reached the end of the prototype run. Review score, strain, unresolved Burdens, and the final board shape.";
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS || !activePlayer) {
    return "I’ll keep an eye on the table state once Player Turns are open.";
  }

  const openingText = formatPendingOpeningPlacement(game, activePlayer);
  if (openingText) {
    return `${formatPlayerName(activePlayer)} should make the opening move now: ${openingText}. Click a highlighted Start hex to place it.`;
  }

  const pendingChoice = getActivePendingBurdenChoice(game, encounterIndex);
  if (pendingChoice) {
    const card = encounterIndex.get(pendingChoice.cardId);
    return `${card?.card_name ?? "A Burden"} needs a required choice on the Stewards Board before normal actions.`;
  }

  if (activePlayer.actionsRemaining <= 0) {
    return `${formatPlayerName(activePlayer)} is out of Actions. End the turn so the next Steward can act.`;
  }

  if (game.map.placedTiles.length === 0) {
    return "The Vale is ready. Place the first tile from the active Steward's token network.";
  }

  return `${formatPlayerName(activePlayer)} has ${activePlayer.actionsRemaining} Action${activePlayer.actionsRemaining === 1 ? "" : "s"}. Place a tile, use a tile, upgrade, or handle an Encounter card.`;
}

function getPlayerAidPrompt(game, tileIndex, encounterIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const seeded = game.encounter.seededRounds.includes(game.round);
  const selectedSeedCount = getSelectedSeedSelectionCount(game);
  const requiredSeedCount = getRequiredSeedSelectionCount(game);
  const seedablePlayerCount = getSeedablePlayerCount(game);

  if (!isPlaySessionPlaying()) {
    return "";
  }

  if (game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded) {
    if (seedablePlayerCount === 0) {
      return "No hands have Encounter Cards left, so the Seed phase is skipped.";
    }

    if (selectedSeedCount === requiredSeedCount) {
      return "Seed places each player's chosen cards into three packets: Top, Middle, and Bottom.";
    }

    return "Click cards in each player's hand to fill Top, Middle, and Bottom. Selected cards show their deck slot.";
  }

  if (game.phase === GAME_PHASES.REVEAL_ENCOUNTERS) {
    return "If a revealed Burden asks for a choice, apply that choice before spending normal player Actions.";
  }

  if (game.phase === GAME_PHASES.END_ROUND) {
    return "End of round advances Arrival timers, clears round effects, and moves the table toward the next seed step.";
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS || !activePlayer) {
    if (game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
      return "Highlighted token hexes are legal free setup sites for the active Steward.";
    }

    return "";
  }

  const openingText = formatPendingOpeningPlacement(game, activePlayer);
  if (openingText) {
    return "Highlighted Start hexes are legal opening sites. Click one to place the required Resource tile automatically.";
  }

  const pendingChoice = getActivePendingBurdenChoice(game, encounterIndex);
  if (pendingChoice) {
    return "Required Burden choices are shown on the Stewards Board and may involve payment, timer tokens, or Strain placement.";
  }

  const affordableBurdenNames = getAffordableBurdenNames(game, encounterIndex);
  if (affordableBurdenNames.length > 0) {
    return `${affordableBurdenNames[0]} looks affordable. Resolving Burdens early keeps Strain from becoming background noise.`;
  }

  const arrivalHint = getArrivalGuideHint(game, encounterIndex);
  if (arrivalHint) {
    return arrivalHint;
  }

  const selectedTileHint = getGuideSelectedTileHint(game, tileIndex);
  if (selectedTileHint) {
    return selectedTileHint;
  }

  const warehouseHint = getWarehouseGuideHint(game);
  if (warehouseHint) {
    return warehouseHint;
  }

  if (game.map.placedTiles.length === 0) {
    return "The first placed tile starts from the active Steward's token location.";
  }

  return "";
}

function getCurrentActionState(game, tileIndex, encounterIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const seeded = game.encounter.seededRounds.includes(game.round);
  const revealed = game.encounter.revealedRounds.includes(game.round);
  const selectedSeedCount = getSelectedSeedSelectionCount(game);
  const requiredSeedCount = getRequiredSeedSelectionCount(game);
  const seedablePlayerCount = getSeedablePlayerCount(game);
  const pendingChoice = getActivePendingBurdenChoice(game, encounterIndex);
  const selectedPlacementTile = getSelectedPlacementTile(tileIndex);

  if (isPlaySessionSetup()) {
    return {
      tone: "setup",
      label: "Setup",
      title: "Prepare the table",
      detail: "Choose players, Stewards, and cards, then start the playthrough."
    };
  }

  if (isPlaySessionEnded()) {
    return {
      tone: "review",
      label: "Review",
      title: "Playthrough ended",
      detail: "Review the final score, Warehouse, Encounter cards, and settlement shape. Use Reset when the next group is ready."
    };
  }

  if (state.pendingPairedPlacement && selectedPlacementTile) {
    return {
      tone: "active",
      label: "Placement",
      title: `${selectedPlacementTile.tile_name}: choose second site`,
      detail: `First site is ${state.pendingPairedPlacement.coordinate}. Click or right-click the second land hex to place both Stables for one action.`,
      actions: [
        { action: "cancel-placement-preview", label: "Cancel Stables", style: "secondary" }
      ]
    };
  }

  if (state.pendingPlacementPreview && selectedPlacementTile) {
    const canRotate = selectedPlacementTileCanRotate(tileIndex);

    return {
      tone: "active",
      label: "Placement",
      title: `${selectedPlacementTile.tile_name} preview active`,
      detail: canRotate
        ? "Use Rotate if needed, then press Place Tile or click the preview hex. Cancel clears the preview."
        : "Left-click the preview hex to place it, or cancel if the player changes their mind.",
      actions: [
        { action: "place-placement-preview", label: "Place Tile", style: "primary" },
        canRotate
          ? { action: "rotate-placement-preview", label: "Rotate", style: "secondary" }
          : null,
        { action: "cancel-placement-preview", label: "Cancel Preview", style: "secondary" }
      ].filter(Boolean)
    };
  }

  if (game.phase === GAME_PHASES.PLACE_STEWARD_HOUSES) {
    const houseText = activePlayer ? formatPendingStewardHousePlacement(game, activePlayer) : "";

    return {
      tone: "setup",
      label: "Steward Token",
      title: activePlayer ? `${formatPlayerName(activePlayer)} places their token` : "Place Steward Tokens",
      detail: houseText
        ? `${houseText}. Click a highlighted token hex to place it for 0 Actions and 0 Resources.`
        : "Place each Steward token for free before seeding Encounter cards."
    };
  }

  if (game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded) {
    const ready = seedablePlayerCount > 0 && selectedSeedCount === requiredSeedCount;

    return {
      tone: seedablePlayerCount === 0 ? "ready" : ready ? "ready" : "normal",
      label: "Season Seed",
      title: seedablePlayerCount === 0 ? "No cards left to seed" : ready ? "Seed cards are selected" : "Choose cards to seed",
      detail: seedablePlayerCount === 0
        ? "The table will skip directly to Reveal Encounters."
        : ready
          ? "Press Seed to place the Top, Middle, and Bottom packets into the Encounter Deck."
          : `${selectedSeedCount}/${requiredSeedCount} seasonal seed slots are selected.`,
      quickAction: ready ? "seed" : "",
      quickLabel: "Seed Season"
    };
  }

  if (game.phase === GAME_PHASES.REVEAL_ENCOUNTERS && !revealed) {
    return {
      tone: "ready",
      label: "Reveal",
      title: "Reveal Encounter cards",
      detail: "Reveal the round, then read the Stewards Board before taking player actions.",
      quickAction: "reveal",
      quickLabel: "Reveal"
    };
  }

  if (game.phase === GAME_PHASES.END_ROUND) {
    return {
      tone: "ready",
      label: "Round End",
      title: "Resolve end of round",
      detail: "Advance timers, clear round effects, and prepare the next round.",
      quickAction: "end-round",
      quickLabel: "End Round"
    };
  }

  if (game.phase === GAME_PHASES.COMPLETE) {
    return {
      tone: "review",
      label: "Complete",
      title: "Game complete",
      detail: "Review score, unresolved Burdens, Strain, and the final settlement shape."
    };
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS || !activePlayer) {
    return {
      tone: "normal",
      label: "Waiting",
      title: "Waiting for player turns",
      detail: "The guide will update when a Steward is ready to act."
    };
  }

  const openingText = formatPendingOpeningPlacement(game, activePlayer);
  if (openingText) {
    return {
      tone: "urgent",
      label: "Opening",
      title: `${formatPlayerName(activePlayer)} must place their required opening tile`,
      detail: `${openingText}. Click a highlighted Start hex to place it automatically.`
    };
  }

  if (pendingChoice) {
    const card = encounterIndex.get(pendingChoice.cardId);

    return {
      tone: "urgent",
      label: "Required",
      title: `${card?.card_name ?? "A Burden"} needs a choice`,
      detail: "Use the highlighted Required Burden Choice on the Stewards Board before taking normal actions."
    };
  }

  if (activePlayer.actionsRemaining <= 0) {
    return {
      tone: "ready",
      label: "Turn",
      title: `${formatPlayerName(activePlayer)} is out of Actions`,
      detail: "End the turn so the next Steward can act.",
      quickAction: "end-turn",
      quickLabel: "End Turn"
    };
  }

  const affordableBurdenNames = getAffordableBurdenNames(game, encounterIndex);
  if (affordableBurdenNames.length > 0) {
    return {
      tone: "warning",
      label: "Burden",
      title: "A Burden looks affordable",
      detail: `${affordableBurdenNames[0]} may be worth resolving before building further. Use its Resolve button on the Stewards Board.`
    };
  }

  return {
    tone: "normal",
    label: "Player Turn",
    title: `${formatPlayerName(activePlayer)} has ${activePlayer.actionsRemaining} Action${activePlayer.actionsRemaining === 1 ? "" : "s"}`,
    detail: "Place a tile from the tray, right-click a placed tile to use or upgrade it, or interact with an Encounter card."
  };
}

function renderCurrentActionButtons(actionState) {
  const actions = actionState.actions ?? (
    actionState.quickAction
      ? [{ action: actionState.quickAction, label: actionState.quickLabel, style: "primary" }]
      : []
  );

  if (actions.length === 0) {
    return "";
  }

  return `
    <div class="current-action-buttons">
      ${actions
        .map(
          (action) => `
            <button class="testing-action ${escapeHtml(action.style ?? "primary")}" data-current-action="${escapeHtml(action.action)}" type="button">
              ${escapeHtml(action.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderCurrentActionMeta(game, tileIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const selectedPlacedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const selectedTileLabel = selectedPlacedTile
    ? getTileNameByPlacedId(game, tileIndex, selectedPlacedTile.id)
    : "Empty hex";
  const lastAction = state.lastActionResult
    ? state.lastActionResult.ok
      ? state.lastActionResult.message
      : state.lastActionResult.errors?.[0]
    : "None yet";

  return `
    <dl class="current-action-meta">
      <div><dt>Round</dt><dd>${game.round}/${game.rules.totalRounds}</dd></div>
      <div><dt>Season</dt><dd>${escapeHtml(game.season)}</dd></div>
      <div><dt>Steward</dt><dd>${escapeHtml(activePlayer ? formatPlayerName(activePlayer) : getPlaySessionLabel())}</dd></div>
      <div><dt>Selected</dt><dd>${escapeHtml(`${selectedTileLabel} at ${state.selectedCoordinate}`)}</dd></div>
      <div class="last-action"><dt>Last action</dt><dd>${escapeHtml(lastAction || "None yet")}</dd></div>
    </dl>
  `;
}

function renderCurrentActionScoreboard(game) {
  if (!isPlaySessionEnded() && game.phase !== GAME_PHASES.COMPLETE) {
    return "";
  }

  const score = game.score;

  return `
    <dl class="current-scoreboard" aria-label="Final score">
      <div class="score-total"><dt>Final Score</dt><dd>${score.total}</dd></div>
      <div><dt>Population</dt><dd>${score.population}</dd></div>
      <div><dt>Renown</dt><dd>${score.renown}</dd></div>
      <div><dt>Burdens</dt><dd>-${score.activeBurdenPenalty}</dd></div>
      <div><dt>Strain</dt><dd>-${score.strainPenalty}</dd></div>
    </dl>
  `;
}

function renderCurrentActionPanel(game, tileIndex, encounterIndex) {
  const actionState = getCurrentActionState(game, tileIndex, encounterIndex);

  return `
    <section class="current-action-panel is-${escapeHtml(actionState.tone)}" aria-label="Current action">
      <div class="current-action-copy">
        <span>${escapeHtml(actionState.label)}</span>
        <strong>${escapeHtml(actionState.title)}</strong>
        <p>${escapeHtml(actionState.detail)}</p>
        ${renderCurrentActionMeta(game, tileIndex)}
        ${renderCurrentActionScoreboard(game)}
      </div>
      ${renderCurrentActionButtons(actionState)}
    </section>
  `;
}

function renderTurnPanel(game, tileIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const playing = isPlaySessionPlaying();
  const canEndTurn = playing && game.phase === GAME_PHASES.PLAYER_TURNS && activePlayer;
  const canEndRound = playing && game.phase === GAME_PHASES.END_ROUND;
  const endTurnLabel = activePlayer
    ? playing
      ? `End ${escapeHtml(formatPlayerName(activePlayer))} Turn`
      : getPlaySessionLabel()
    : game.phase === GAME_PHASES.COMPLETE
      ? "Game Complete"
      : "Player Turns Locked";
  const phaseNote = {
    [GAME_PHASES.PLACE_STEWARD_HOUSES]: "Place each Steward token for free before seeding Encounter Cards.",
    [GAME_PHASES.SEED_ENCOUNTERS]: "Choose one Top, one Middle, and one Bottom seed card for each player.",
    [GAME_PHASES.REVEAL_ENCOUNTERS]: "Reveal Encounters before turns open.",
    [GAME_PHASES.END_ROUND]: "Resolve end-of-round effects to advance.",
    [GAME_PHASES.COMPLETE]: "The standard game is complete."
  }[game.phase];
  const openingText = activePlayer ? formatPendingOpeningPlacement(game, activePlayer) : "";

  return `
    <section id="turn-panel" class="state-panel turn-panel">
      <h2>Turn</h2>
      <ul class="turn-list">
        ${game.players
          .map(
            (player) => `
              <li class="${player.id === game.activePlayerId ? "is-active" : ""}">
                <span class="turn-player">
                  <b>${escapeHtml(formatPlayerName(player))}</b>
                  <small>${escapeHtml(formatPlayerLastInteraction(game, tileIndex, player))}</small>
                </span>
                <strong>${player.actionsRemaining}/${game.rules.actionsPerPlayer}</strong>
              </li>
            `
          )
          .join("")}
      </ul>
      ${phaseNote ? `<p class="phase-note">${escapeHtml(phaseNote)}</p>` : ""}
      ${openingText ? `<p class="phase-note opening-note">${escapeHtml(`Opening move required: ${openingText}.`)}</p>` : ""}
      <button id="end-turn" class="primary-button" type="button" ${canEndTurn ? "" : "disabled"}>
        ${endTurnLabel}
      </button>
      <button id="end-round" class="secondary-button" type="button" ${canEndRound ? "" : "disabled"}>
        Resolve End of Round
      </button>
    </section>
  `;
}

const SEED_PACKET_POSITION_LABELS = Object.freeze({
  [SEED_PACKET_POSITIONS.TOP]: "Top of deck",
  [SEED_PACKET_POSITIONS.UPPER_THIRD]: "Upper third",
  [SEED_PACKET_POSITIONS.MIDDLE]: "Middle",
  [SEED_PACKET_POSITIONS.LOWER_THIRD]: "Lower third",
  [SEED_PACKET_POSITIONS.BOTTOM]: "Bottom of deck"
});

function getShortSeedPositionLabel(seedPosition) {
  return (SEED_PACKET_POSITION_LABELS[seedPosition] ?? seedPosition).replace(" of deck", "");
}

function getSeedPositionsForCard(game, player, cardId) {
  return Object.entries(getValidSeedSelectionMap(game, player))
    .filter(([, selectedCardId]) => selectedCardId === cardId)
    .map(([position]) => position);
}

function getDebugSeedSelectionsForAction(game) {
  return Object.fromEntries(
    game.players
      .map((player) => [player.id, getValidSeedSelectionMap(game, player)])
      .filter(([, selections]) => Object.keys(selections).length > 0)
  );
}

function autoSkipEmptySeedPhase() {
  if (
    !state.data ||
    !state.game ||
    !isPlaySessionPlaying() ||
    state.game.phase !== GAME_PHASES.SEED_ENCOUNTERS ||
    state.game.encounter.seededRounds.includes(state.game.round) ||
    getSeedablePlayerCount(state.game) > 0
  ) {
    return false;
  }

  const { state: nextGame, result } = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.SEED_ENCOUNTERS
    },
    { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
  );

  if (!result.ok) {
    return false;
  }

  state.game = nextGame;
  state.lastActionResult = result;
  state.debugSeedSelections = {};
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.activeWorkspace = TABLE_WORKSPACES.ENCOUNTERS;
  return true;
}

function renderSeedHandCard(card, player, game) {
  const selectedPositions = getSeedPositionsForCard(game, player, card.card_id);
  const selected = selectedPositions.length > 0;
  const playerSelections = getValidSeedSelectionMap(game, player);
  const seedPositions = getRequiredSeasonalSeedPositions(game, player);

  return `
    <div
      class="seed-hand-card type-${slug(card.encounter_type)} ${selected ? "is-selected" : ""}"
      data-seed-hand-card="true"
      data-player-id="${escapeHtml(player.id)}"
      data-card-id="${escapeHtml(card.card_id)}"
      tabindex="0"
      role="button"
      aria-label="${escapeHtml(`${formatPlayerName(player)} ${card.card_name}`)}"
    >
      ${selected ? `<span class="seed-selected-badge">${escapeHtml(selectedPositions.map(getShortSeedPositionLabel).join(" + "))}</span>` : ""}
      ${renderEncounterFace(card, null, game, null, { extraClass: "seed-encounter-face" })}
      ${
        selected
          ? `<div class="seed-position-toolbar" aria-label="Seed packet position">
              <span>Deck slot</span>
              ${seedPositions
                .map(
                  (position) => `
                    <button
                      class="seed-position-action ${playerSelections[position] === card.card_id ? "is-active" : ""}"
                      data-seed-player-id="${escapeHtml(player.id)}"
                      data-seed-card-id="${escapeHtml(card.card_id)}"
                      data-seed-position="${escapeHtml(position)}"
                      type="button"
                    >
                      ${escapeHtml(getShortSeedPositionLabel(position))}
                    </button>
                  `
                )
                .join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

function renderSeedHandStrips(game, encounterIndex) {
  const seeded = game.encounter.seededRounds.includes(game.round);
  const canChoose = isPlaySessionPlaying() && game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded;

  if (!canChoose) {
    return "";
  }

  return `
    <section class="stewards-seed-area" aria-label="Encounter card seeding">
      <header class="stewards-subheader">
        <h3>Seasonal Seed</h3>
        <strong>${escapeHtml(getSeasonalSeedPositions(game).map(getShortSeedPositionLabel).join(" / "))}</strong>
      </header>
      <div class="seed-player-grid">
        ${game.players
          .map((player) => {
            const cards = getCards(player.hand, encounterIndex);
            const requiredPositions = getRequiredSeasonalSeedPositions(game, player);
            const playerSelections = getValidSeedSelectionMap(game, player);
            const selectedCount = Object.keys(playerSelections).length;
            const selectedNames = requiredPositions
              .map((position) => {
                const card = encounterIndex.get(playerSelections[position]);
                return card ? `${getShortSeedPositionLabel(position)}: ${card.card_name}` : "";
              })
              .filter(Boolean);

            return `
              <article class="seed-player-strip">
                <header>
                  <span>${escapeHtml(formatPlayerName(player))}</span>
                  <strong>${selectedCount}/${requiredPositions.length} selected</strong>
                </header>
                ${
                  selectedNames.length
                    ? `<p class="seed-selection-summary">${escapeHtml(selectedNames.join(" | "))}</p>`
                    : `<p class="seed-selection-summary">Choose Top, Middle, and Bottom.</p>`
                }
                <div class="seed-card-scroll">
                  ${cards.map((card) => renderSeedHandCard(card, player, game)).join("")}
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function getRecentEncounterRevealEntries(game, limit = 4) {
  return game.log
    .filter((entry) => entry.type === "encounter" && entry.data?.cardId && entry.message.startsWith("Revealed "))
    .slice(-limit)
    .reverse();
}

function getCurrentRoundRevealEntries(game) {
  return game.log.filter(
    (entry) =>
      entry.type === "encounter" &&
      entry.round === game.round &&
      entry.data?.cardId &&
      entry.message.startsWith("Revealed ")
  );
}

function getCurrentRoundResolvedRevealEntries(game) {
  const activeCardIds = new Set(game.encounter.active.map((activeState) => activeState.cardId));

  return getCurrentRoundRevealEntries(game).filter((entry) => !activeCardIds.has(entry.data.cardId));
}

function getCurrentRoundRevealStatusText(entry) {
  return getRevealPrototypeText(entry.data) || "Resolved on reveal.";
}

function renderCurrentRoundResolvedReveals(game, encounterIndex) {
  const revealedEntries = getCurrentRoundResolvedRevealEntries(game);

  if (revealedEntries.length === 0) {
    return "";
  }

  return `
    <section class="stewards-revealed-area" aria-label="Resolved Encounter cards revealed this round">
      <header class="stewards-subheader">
        <h3>Resolved This Round</h3>
        <strong>${revealedEntries.length}</strong>
      </header>
      <ol class="current-reveal-list">
        ${revealedEntries
          .map((entry) => {
            const card = encounterIndex.get(entry.data.cardId);
            const encounterType = card?.encounter_type ?? entry.data.encounterType;

            return `
              <li class="current-reveal-card type-${slug(encounterType)}">
                ${renderEncounterFace(card, null, game, null, { extraClass: "revealed-encounter-face" })}
                <p class="current-reveal-result">
                  <span>Resolved this round</span>
                  <strong>${escapeHtml(getCurrentRoundRevealStatusText(entry))}</strong>
                </p>
              </li>
            `;
          })
          .join("")}
      </ol>
    </section>
  `;
}

function renderPendingBurdenChoiceAlert(game, encounterIndex) {
  const pendingChoices = getPendingBurdenRevealChoices(game);

  if (pendingChoices.length === 0) {
    return "";
  }

  return `
    <section class="burden-choice-alert" aria-label="Required Burden choices">
      <header>
        <span>Required Burden Choice</span>
        <strong>${pendingChoices.length}</strong>
      </header>
      <p>Choose the listed payment, timer, or Strain option on each highlighted Burden card, then press Apply Required Choice.</p>
      <ol>
        ${pendingChoices
          .map((activeState) => {
            const card = encounterIndex.get(activeState.cardId);
            const targetCount = activeState.pendingChoice?.targets?.length ?? 0;

            return `
              <li>
                <strong>${escapeHtml(card?.card_name ?? activeState.cardId)}</strong>
                <span>${targetCount ? `${targetCount} target${targetCount === 1 ? "" : "s"}` : "No valid Strain targets"}</span>
              </li>
            `;
          })
          .join("")}
      </ol>
    </section>
  `;
}

function renderRecentEncounterStories(game, encounterIndex) {
  const recentReveals = getRecentEncounterRevealEntries(game);

  if (recentReveals.length === 0) {
    return `<p class="empty-note">No revealed Encounter cards yet</p>`;
  }

  return `
    <ol class="encounter-chronicle-list encounter-pile-card-list">
      ${recentReveals
        .map((entry) => {
          const card = encounterIndex.get(entry.data.cardId);
          const encounterType = card?.encounter_type ?? entry.data.encounterType;

          return `
            <li class="encounter-pile-card encounter-chronicle-item type-${slug(encounterType)}">
              <div class="encounter-card-main">
                ${renderEncounterFace(card, null, game, null, { extraClass: "pile-encounter-face" })}
              </div>
              <p class="current-reveal-result">
                <span>Round ${entry.round} - Season ${escapeHtml(entry.season)}</span>
                <strong>${escapeHtml(getRevealPrototypeText(entry.data) || "Revealed.")}</strong>
              </p>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderRoundEffectsList(roundEffects, encounterIndex, game) {
  if (roundEffects.length === 0) {
    return `<p class="empty-note">No round effects</p>`;
  }

  return `
    <div class="round-effect-list">
      ${roundEffects
        .map((effect) => {
          const uses = effect.maxUses === null ? `${effect.uses ?? 0}` : `${effect.uses ?? 0}/${effect.maxUses}`;
          const card = encounterIndex.get(effect.cardId);

          return `
            <article class="round-effect-row type-${slug(card?.encounter_type ?? effect.type)}">
              <header>
                <span>${escapeHtml(effect.cardName)}</span>
                <small>${escapeHtml(effect.effectText)}</small>
                <strong>${escapeHtml(uses)}</strong>
              </header>
              ${renderEncounterFlavorText(card, { compact: true })}
              ${renderEncounterSourceText(card, effect.season ?? game.season, `Round effect: ${effect.type}. Uses ${uses}.`)}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEncounterPanel(game, encounterIndex) {
  const seeded = game.encounter.seededRounds.includes(game.round);
  const revealed = game.encounter.revealedRounds.includes(game.round);
  const playing = isPlaySessionPlaying();
  const requiredSeedCount = getRequiredSeedSelectionCount(game);
  const selectedSeedCount = getSelectedSeedSelectionCount(game);
  const canSeed =
    playing &&
    game.phase === GAME_PHASES.SEED_ENCOUNTERS &&
    !seeded &&
    requiredSeedCount > 0 &&
    selectedSeedCount === requiredSeedCount;
  const canReveal = playing && game.phase === GAME_PHASES.REVEAL_ENCOUNTERS && !revealed;
  const completedArrivals = game.encounter.completed ?? [];
  const roundEffects = game.encounter.roundEffects ?? [];
  const activeCount = game.encounter.active.length;
  const currentRevealCount = getCurrentRoundRevealEntries(game).length;
  const pendingBurdenChoices = getPendingBurdenRevealChoices(game);

  return `
    <section id="encounter-panel" class="state-panel encounter-panel stewards-board-panel">
      <div class="stewards-board-header">
        <div>
          <p class="eyebrow">Stewards Board</p>
          <h2>Encounter Cards</h2>
        </div>
        <ul class="stewards-board-status">
          <li><span>Step</span><strong>${escapeHtml(formatPhase(game.phase))}</strong></li>
          <li><span>Active</span><strong>${activeCount}</strong></li>
          <li><span>Revealed</span><strong>${currentRevealCount}</strong></li>
          <li><span>Choices</span><strong>${pendingBurdenChoices.length}</strong></li>
          <li><span>Round Effects</span><strong>${roundEffects.length}</strong></li>
        </ul>
      </div>

      <div class="encounter-actions stewards-actions">
        <button id="seed-encounters" class="secondary-button" type="button" ${canSeed ? "" : "disabled"}>Seed Season</button>
        <button id="reveal-encounters" class="primary-button" type="button" ${canReveal ? "" : "disabled"}>Reveal Encounters</button>
      </div>

      ${playing ? "" : `<p class="phase-note">${escapeHtml(getPlaySessionBlockReason())}</p>`}

      ${renderPendingBurdenChoiceAlert(game, encounterIndex)}

      ${renderSeedHandStrips(game, encounterIndex)}

      ${renderCurrentRoundResolvedReveals(game, encounterIndex)}

      <section class="stewards-active-area" aria-label="Active Encounter cards">
        <header class="stewards-subheader">
          <h3>In Play</h3>
          <strong>${activeCount}</strong>
        </header>
        ${renderActiveEncounterList(game.encounter.active, encounterIndex, game)}
      </section>

      ${
        roundEffects.length
          ? `<section class="stewards-round-effects" aria-label="Round effects">
              <header class="stewards-subheader">
                <h3>Round Effects</h3>
                <strong>${roundEffects.length}</strong>
              </header>
              ${renderRoundEffectsList(roundEffects, encounterIndex, game)}
            </section>`
          : ""
      }

      <details class="encounter-piles-details">
        <summary>Encounter piles and reveal history</summary>
        <div class="encounter-grid encounter-support-grid">
          <article class="mini-card encounter-chronicle-card">
            <header>
              <h3>Recent Reveals</h3>
              <strong>${getRecentEncounterRevealEntries(game).length}</strong>
            </header>
            ${renderRecentEncounterStories(game, encounterIndex)}
          </article>
          <article class="mini-card">
            <header>
              <h3>Deck</h3>
              <strong>${game.encounter.deck.length}</strong>
            </header>
            ${renderCardList(game.encounter.deck, encounterIndex, {
              hidden: !state.revealHiddenSetup,
              ordered: true
            })}
          </article>
          <article class="mini-card">
            <header>
              <h3>Completed</h3>
              <strong>${completedArrivals.length}</strong>
            </header>
            ${renderCardList(
              completedArrivals
                .filter((activeState) => activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL)
                .map((activeState) => activeState.cardId),
              encounterIndex
            )}
          </article>
          <article class="mini-card">
            <header>
              <h3>Discard</h3>
              <strong>${game.encounter.discard.length}</strong>
            </header>
            ${renderCardList(game.encounter.discard, encounterIndex)}
          </article>
        </div>
      </details>
    </section>
  `;
}

function getTableWorkspaceBadge(workspace, game, tileIndex) {
  if (workspace === TABLE_WORKSPACES.ENCOUNTERS) {
    const activeCount = game.encounter.active.length;
    const pendingChoices = getPendingBurdenRevealChoices(game).length;

    if (pendingChoices > 0) {
      return `${pendingChoices} choice${pendingChoices === 1 ? "" : "s"}`;
    }

    return activeCount > 0 ? `${activeCount} in play` : formatPhase(game.phase);
  }

  if (workspace === TABLE_WORKSPACES.TILES) {
    const selectedTile = tileIndex.get(state.selectedTileId);

    return selectedTile ? selectedTile.tile_name : state.selectedCoordinate;
  }

  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);

  return activePlayer ? formatPlayerName(activePlayer) : `${game.players.length} steward${game.players.length === 1 ? "" : "s"}`;
}

function renderTableWorkspaceTabs(game, tileIndex) {
  const activeWorkspace = getActiveWorkspace(game);

  return `
    <nav class="table-workspace-tabs" aria-label="Table workspace">
      ${Object.values(TABLE_WORKSPACES)
        .map((workspace) => {
          const selected = workspace === activeWorkspace;

          return `
            <button
              class="table-workspace-tab ${selected ? "is-active" : ""}"
              type="button"
              data-workspace-tab="${escapeHtml(workspace)}"
              aria-pressed="${selected ? "true" : "false"}"
            >
              <span>${escapeHtml(TABLE_WORKSPACE_LABELS[workspace])}</span>
              <strong>${escapeHtml(getTableWorkspaceBadge(workspace, game, tileIndex))}</strong>
            </button>
          `;
        })
        .join("")}
    </nav>
  `;
}

function renderStewardWorkspacePanel(game, tileIndex, encounterIndex) {
  const players = getHeaderStewardMenuPlayers();

  return `
    <section id="steward-workspace-panel" class="state-panel steward-workspace-panel" aria-label="Player and Steward abilities">
      <div class="stewards-board-header">
        <div>
          <p class="eyebrow">Player Stewards</p>
          <h2>Tokens, Powers, Bonuses</h2>
        </div>
        <ul class="stewards-board-status">
          <li><span>Round</span><strong>${game.round}/${game.rules.roundsPerSeason * 3}</strong></li>
          <li><span>Season</span><strong>${escapeHtml(game.season)}</strong></li>
          <li><span>Players</span><strong>${game.players.length}</strong></li>
        </ul>
      </div>
      ${renderStewardMenuFocus(players)}
      <div class="steward-menu-grid steward-workspace-grid">
        ${players.map((player) => renderStewardMenuCard(player, tileIndex, encounterIndex)).join("")}
      </div>
    </section>
  `;
}

function renderTableWorkspace(game, tileIndex, encounterIndex) {
  const activeWorkspace = getActiveWorkspace(game);
  const panel =
    activeWorkspace === TABLE_WORKSPACES.TILES
      ? renderTilePlacementPanel(game, tileIndex, encounterIndex)
      : activeWorkspace === TABLE_WORKSPACES.STEWARDS
        ? renderStewardWorkspacePanel(game, tileIndex, encounterIndex)
        : renderEncounterPanel(game, encounterIndex);

  return `
    <section id="table-workspace" class="table-workspace is-${escapeHtml(activeWorkspace)}" aria-label="Main table workspace">
      <header class="table-workspace-header">
        <div>
          <p class="eyebrow">Table Workspace</p>
          <h2>${escapeHtml(TABLE_WORKSPACE_LABELS[activeWorkspace])}</h2>
        </div>
        ${renderTableWorkspaceTabs(game, tileIndex)}
      </header>
      <div class="table-workspace-body is-${escapeHtml(activeWorkspace)}">
        ${panel}
      </div>
    </section>
  `;
}

function renderWarehousePanel(game, options = {}) {
  const compact = options.compact === true;
  const wrapperTag = compact ? "aside" : "section";
  const wrapperId = options.id ?? "warehouse-panel";
  const wrapperIdAttribute = wrapperId ? ` id="${escapeHtml(wrapperId)}"` : "";
  const wrapperClass = [
    compact ? "warehouse-panel warehouse-strip-panel" : "state-panel warehouse-panel",
    options.className ?? ""
  ]
    .filter(Boolean)
    .join(" ");
  const ariaLabel = options.ariaLabel ?? "Warehouse resources";
  const resourceFilter = new Set(options.resources ?? Object.keys(game.warehouse.resources));
  const resourceEntries = Object.entries(game.warehouse.resources).filter(([resource]) => resourceFilter.has(resource));
  const title = options.title ?? "Warehouse";

  return `
    <${wrapperTag}${wrapperIdAttribute} class="${escapeHtml(wrapperClass)}" aria-label="${escapeHtml(ariaLabel)}">
      <h2>${escapeHtml(title)}</h2>
      <ul class="warehouse-grid">
        ${resourceEntries
          .map(([resource, amount]) => {
            const percentage = game.warehouse.cap > 0
              ? Math.max(0, Math.min(100, Math.round((amount / game.warehouse.cap) * 100)))
              : 0;

            return `
              <li class="warehouse-resource resource-${slug(resource)}" style="--stock-level: ${percentage}%;" aria-label="${escapeHtml(`${resource}: ${amount} of ${game.warehouse.cap}`)}">
                <div class="warehouse-resource-head">
                  <span><i aria-hidden="true"></i>${escapeHtml(resource)}</span>
                  <strong class="warehouse-count">
                    <span class="warehouse-count-current">${amount}</span>
                    <span class="warehouse-count-cap">/${game.warehouse.cap}</span>
                  </strong>
                </div>
                <div class="warehouse-fill" aria-hidden="true"><b></b></div>
              </li>
            `;
          })
          .join("")}
      </ul>
    </${wrapperTag}>
  `;
}

function renderCost(cost) {
  return cost.length === 0 ? "0" : cost.map(({ amount, resource }) => `${amount} ${resource}`).join(", ");
}

function renderResourceCostSubstitutionNotice(resourceCostSubstitution) {
  if (!resourceCostSubstitution) {
    return "";
  }

  const coveredText = `${resourceCostSubstitution.amountCovered} ${resourceCostSubstitution.resource}`;
  const goodsText = `${resourceCostSubstitution.goodsSpent} Goods`;

  return `
    <div class="placement-choice-panel goods-substitution-note is-ready">
      <header>
        <span>Goods substitution</span>
        <strong>${escapeHtml(resourceCostSubstitution.providerTileName ?? "Tile effect")}</strong>
      </header>
      <p>${escapeHtml(`${goodsText} covers ${coveredText}. Cost becomes ${renderCost(resourceCostSubstitution.cost)}.`)}</p>
    </div>
  `;
}

function renderActionCost(actionCost) {
  if (!actionCost) {
    return "N/A";
  }

  if (actionCost.originalTotal !== undefined && actionCost.originalTotal !== actionCost.total) {
    return `${actionCost.total} (was ${actionCost.originalTotal})`;
  }

  return String(actionCost.total);
}

function renderActionCountLabel(actionCost) {
  if (!actionCost) {
    return "N/A";
  }

  const total = Number(actionCost.total ?? 0);
  return `${renderActionCost(actionCost)} Action${total === 1 ? "" : "s"}`;
}

function renderPlacementConnectionLabel(actionCost) {
  if (!actionCost) {
    return "N/A";
  }

  if (actionCost.disconnectedTravelIgnored) {
    return actionCost.disconnectedTravelIgnoreReason === "ranger_steward_power"
      ? "Ranger reach"
      : "Setup reach";
  }

  if (actionCost.connected) {
    return "Connected";
  }

  return actionCost.blockedByReachability ? "Out of network" : "Reach waived";
}

function parseResourceCostForDisplay(costText, resourceCostChoiceResources = []) {
  try {
    const resolution = resolveResourceCost(costText, resourceCostChoiceResources, {
      warehouse: state.game?.warehouse ?? null
    });

    return {
      cost: resolution.cost,
      choiceGroups: resolution.choiceGroups,
      errors: resolution.errors,
      error: resolution.errors.length > 0 ? new Error(resolution.errors[0]) : null
    };
  } catch (error) {
    return {
      cost: [],
      choiceGroups: [],
      errors: [error.message],
      error
    };
  }
}

function getResourceCostChoiceSelection(costText, savedChoices = []) {
  const groups = getResourceCostChoiceGroups(costText);

  if (groups.length === 0) {
    return [];
  }

  const defaults = getDefaultResourceCostChoiceResources(costText, state.game?.warehouse ?? null);

  return groups.map((group, index) => {
    const saved = savedChoices[index];
    return group.options.some((option) => option.resource === saved) ? saved : (defaults[index] ?? "");
  });
}

function getPlacementCostChoiceAction(tileId, costText) {
  return getResourceCostChoiceSelection(costText, state.placementCostChoices[tileId] ?? []);
}

function getUpgradeCostChoiceAction(placedTileId, costText) {
  return getResourceCostChoiceSelection(costText, state.upgradeCostChoices[placedTileId] ?? []);
}

function renderResourceCostChoiceControls({ mode, targetId, costText, selectedChoices }) {
  const groups = getResourceCostChoiceGroups(costText);

  if (groups.length === 0) {
    return "";
  }

  const className = mode === "upgrade" ? "upgrade-cost-choice-resource" : "placement-cost-choice-resource";
  const dataAttribute =
    mode === "upgrade"
      ? `data-placed-tile-id="${escapeHtml(targetId)}"`
      : `data-tile-id="${escapeHtml(targetId)}"`;
  const title = mode === "upgrade" ? "Choose upgrade cost" : "Choose placement cost";

  return `
    <div class="placement-choice-panel is-ready" aria-label="${escapeHtml(title)}">
      <header>
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(formatResourceCostOptionsForDisplay(costText) ?? formatRawCostText(costText))}</strong>
      </header>
      <p>Select which resource the Warehouse will spend. Discounts apply after this choice.</p>
      <div class="burden-payment-grid cost-choice-grid">
        ${groups
          .map(
            (group, index) => `
              <select class="${className}" ${dataAttribute} data-choice-index="${index}" aria-label="${escapeHtml(`${title} ${index + 1}`)}">
                ${group.options
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option.resource)}" ${option.resource === selectedChoices[index] ? "selected" : ""}>${escapeHtml(formatResourceCostOption(option))}</option>`
                  )
                  .join("")}
              </select>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function getActivationForDisplay(tile) {
  try {
    return {
      details: getActivationDetails(tile),
      error: null
    };
  } catch (error) {
    return {
      details: null,
      error
    };
  }
}

function formatActivationDetails(details) {
  if (!details) {
    return "None";
  }

  const cadence = details.oncePerSeason ? "Once per Season: " : "";

  if (details.type === "production") {
    return `${cadence}${renderCost(details.gains)}`;
  }

  if (details.type === "remove_strain_adjacent") {
    const maxTargets = details.maxTargets ?? 1;
    const categoryTarget = details.targetCategories?.length ? ` from ${details.targetCategories.join(", ")}` : "";

    if (maxTargets > 1) {
      return `${cadence}Remove ${details.amount} Strain from up to ${maxTargets} tiles`;
    }

    return details.amount > 1
      ? `${cadence}Remove up to ${details.amount} Strain${categoryTarget}`
      : `${cadence}Remove ${details.amount} Strain${categoryTarget}`;
  }

  if (details.type === "give_supported_adjacent") {
    const maxTargets = details.maxTargets ?? 1;
    const categoryTarget = details.targetCategories?.length ? ` ${details.targetCategories.join(", ")}` : "";

    return maxTargets > 1
      ? `${cadence}Give Supported to up to ${maxTargets} adjacent${categoryTarget} tiles`
      : `${cadence}Give Supported to 1 adjacent${categoryTarget} tile`;
  }

  if (details.type === "add_arrival_timer") {
    return `${cadence}${details.amount > 1
      ? `Add up to ${details.amount} timer tokens`
      : `Add ${details.amount} timer token`}`;
  }

  if (details.type === "resource_exchange") {
    return `${cadence}Exchange ${details.paymentAmount} resources for ${details.gain.amount} ${details.gain.resource}`;
  }

  if (details.type === "flexible_resource_exchange") {
    return `${cadence}Exchange up to ${details.maxAmount} resources`;
  }

  if (details.type === "resolve_active_burden") {
    return `${cadence}Resolve 1 active Burden`;
  }

  if (details.type === "encounter_deck_peek") {
    return `${cadence}Look at top ${details.count} Encounter cards`;
  }

  return "Unsupported";
}

function formatMapActivationActionLabel(activation) {
  if (activation?.error) {
    return "Produce / Interact: Unsupported effect";
  }

  if (!activation?.details) {
    return "Produce / Interact: No effect";
  }

  const actionName = activation.details.type === "production" ? "Produce" : "Interact";

  return `${actionName}: ${formatActivationDetails(activation.details)}`;
}

function getFirstActionBlockReason(errors = []) {
  return errors.find(Boolean) ?? "";
}

function getBlockedActionLabel(label, status) {
  return status.blockedReason ? `${label} - ${status.blockedReason}` : label;
}

function getBlockedActionClass(status) {
  return status.blockedReason ? " is-blocked" : "";
}

function getActiveMapActionPlayer(game) {
  return game.players.find((player) => player.id === game.activePlayerId) ?? null;
}

function getActivationActionExtras(game, placedTile, tileIndex, activationDetails) {
  const extras = {};

  if (!placedTile || !activationDetails) {
    return extras;
  }

  if (activationDetails.type === "remove_strain_adjacent") {
    const maxTargets = activationDetails.maxTargets ?? 1;
    const targetCandidates = getStrainActivationTargetCandidates(game, tileIndex, placedTile, activationDetails);
    const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
    const validSavedTargetIds = savedTargetIds.filter((targetId) =>
      targetCandidates.some((candidate) => candidate.id === targetId)
    );
    const selectedTargetIds = (
      validSavedTargetIds.length ? validSavedTargetIds : targetCandidates.slice(0, 1).map((candidate) => candidate.id)
    ).slice(0, maxTargets);

    extras.targetPlacedTileIds = selectedTargetIds;
    extras.targetPlacedTileId = selectedTargetIds[0];
  }

  if (activationDetails.type === "give_supported_adjacent") {
    const maxTargets = activationDetails.maxTargets ?? 1;
    const targetCandidates = getSupportActivationTargetCandidates(game, tileIndex, placedTile, activationDetails);
    const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
    const validSavedTargetIds = savedTargetIds.filter((targetId) =>
      targetCandidates.some((candidate) => candidate.id === targetId)
    );
    const selectedTargetIds = (
      validSavedTargetIds.length ? validSavedTargetIds : targetCandidates.slice(0, 1).map((candidate) => candidate.id)
    ).slice(0, maxTargets);

    extras.targetPlacedTileIds = selectedTargetIds;
    extras.targetPlacedTileId = selectedTargetIds[0];
  }

  if (activationDetails.type === "add_arrival_timer") {
    const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
    const targetCandidates = game.encounter.active.filter((activeEncounter) => {
      const timerMax = game.rules.arrivalTimerMax ?? 3;
      const currentTimerTokens = Number(
        activeEncounter.timerTokens ?? game.rules.arrivalStartTimerTokens ?? 3
      );

      return (
        activeEncounter.encounterType === ENCOUNTER_TYPES.ARRIVAL &&
        !activeEncounter.completed &&
        currentTimerTokens < timerMax
      );
    });

    extras.targetActiveEncounterId = targetCandidates.some((candidate) => candidate.id === savedTargetIds[0])
      ? savedTargetIds[0]
      : targetCandidates[0]?.id;
  }

  if (activationDetails.type === "resolve_active_burden") {
    const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
    const targetCandidates = game.encounter.active.filter(
      (activeEncounter) => activeEncounter.encounterType === ENCOUNTER_TYPES.BURDEN && !activeEncounter.resolved
    );

    extras.targetActiveEncounterId = targetCandidates.some((candidate) => candidate.id === savedTargetIds[0])
      ? savedTargetIds[0]
      : targetCandidates[0]?.id;
  }

  if (activationDetails.type === "resource_exchange") {
    extras.payment = getActivationPaymentAction(placedTile.id);
  }

  if (activationDetails.type === "flexible_resource_exchange") {
    extras.payment = getActivationPaymentAction(placedTile.id);
    extras.gains = getResourcePaymentAction(state.activationGains[placedTile.id] ?? []);
  }

  return extras;
}

function getMapActivationActionStatus(game, placedTile, tileDefinition, tileIndex, activation) {
  const activePlayer = getActiveMapActionPlayer(game);

  if (!isPlaySessionPlaying()) {
    return { blockedReason: getPlaySessionBlockReason() };
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return { blockedReason: "Player Turns only" };
  }

  if (!activePlayer) {
    return { blockedReason: "No active Steward" };
  }

  const openingRequirement = getPendingOpeningResourcePlacement(game, activePlayer.id);
  if (openingRequirement) {
    return { blockedReason: `Opening move: ${openingRequirement.summary}` };
  }

  if (!placedTile || !tileDefinition) {
    return { blockedReason: "No placed tile" };
  }

  if (activation?.error) {
    return { blockedReason: "Unsupported effect" };
  }

  if (!activation?.details) {
    return { blockedReason: "No effect" };
  }

  const action = {
    type: TILE_ACTION_TYPES.ACTIVATE_TILE,
    placedTileId: placedTile.id,
    ...getActivationActionExtras(game, placedTile, tileIndex, activation.details)
  };
  const validation = validateActivateTile(game, action, { tiles: state.data.tiles, tileIndex });

  if (!validation.valid) {
    return { blockedReason: getFirstActionBlockReason(validation.errors) };
  }

  const baseActionCost = calculatePlacedTileActionCost(
    game,
    validation.placedTile,
    {
      tiles: state.data.tiles,
      tileIndex,
      playerId: activePlayer.id
    },
    "activationActionCost"
  );
  const discountedActionCost = getDiscountedDisconnectedTravelActionCost(game, "activation", baseActionCost).actionCost;
  const activationProviders = getActivationStewardPowerProviders(game, tileIndex, discountedActionCost);
  const selectedActivationProvider =
    activationProviders.find((provider) => provider.placedTile.id === state.stewardActivationPowerId) ?? null;
  const actionCost = getActivationStewardActionPreview(discountedActionCost, selectedActivationProvider);

  if (actionCost.blockedByReachability) {
    return { blockedReason: "Out of connected network" };
  }

  if (activePlayer.actionsRemaining < actionCost.total) {
    return {
      blockedReason: `Needs ${actionCost.total} Action${actionCost.total === 1 ? "" : "s"}; ${activePlayer.name} has ${activePlayer.actionsRemaining}`
    };
  }

  return { blockedReason: "" };
}

function getMapUpgradeActionStatus(game, placedTile, tileDefinition, upgradeTile, tileIndex) {
  const activePlayer = getActiveMapActionPlayer(game);

  if (!upgradeTile) {
    return { blockedReason: "No upgrade available" };
  }

  if (!isPlaySessionPlaying()) {
    return { blockedReason: getPlaySessionBlockReason() };
  }

  if (game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return { blockedReason: "Player Turns only" };
  }

  if (!activePlayer) {
    return { blockedReason: "No active Steward" };
  }

  const openingRequirement = getPendingOpeningResourcePlacement(game, activePlayer.id);
  if (openingRequirement) {
    return { blockedReason: `Opening move: ${openingRequirement.summary}` };
  }

  if (!placedTile || !tileDefinition) {
    return { blockedReason: "No placed tile" };
  }

  const upgradeCostChoiceResources = getUpgradeCostChoiceAction(placedTile.id, upgradeTile.upgrade_cost);
  const upgradeCost = parseResourceCostForDisplay(upgradeTile.upgrade_cost, upgradeCostChoiceResources);
  const upgradeResourceDiscount = getPendingUpgradeResourceDiscount(game, tileDefinition);
  const validation = validateUpgradeTile(
    game,
    {
      type: TILE_ACTION_TYPES.UPGRADE_TILE,
      placedTileId: placedTile.id,
      upgradeCostChoiceResources,
      upgradeCostReductionResources: upgradeCost.error
        ? []
        : getUpgradeCostDiscountAction(placedTile.id, upgradeCost.cost, upgradeResourceDiscount)
    },
    { tiles: state.data.tiles, tileIndex }
  );

  if (!validation.valid) {
    return { blockedReason: getFirstActionBlockReason(validation.errors) };
  }

  const baseActionCost = calculatePlacedTileActionCost(
    game,
    validation.placedTile,
    {
      tiles: state.data.tiles,
      tileIndex,
      playerId: activePlayer.id
    },
    "upgradeActionCost"
  );
  const tileActionDiscount = getDiscountedTileActionCost(game, validation.tile, "upgrade", baseActionCost);
  const travelDiscount = getDiscountedDisconnectedTravelActionCost(
    game,
    "upgrade",
    tileActionDiscount.actionCost
  );
  const stewardPowerProviders = getUpgradeStewardPowerProviders(game, validation.tile, tileIndex, travelDiscount.actionCost);
  const selectedStewardPowerId = getSelectedStewardPowerId(
    state.stewardUpgradePowerId,
    stewardPowerProviders
  );
  const selectedStewardPowerProvider =
    stewardPowerProviders.find((provider) => provider.placedTile.id === selectedStewardPowerId) ?? null;
  const actionCost = getUpgradeStewardActionPreview(
    travelDiscount.actionCost,
    selectedStewardPowerProvider
  );

  if (actionCost.blockedByReachability) {
    return { blockedReason: "Out of connected network" };
  }

  if (activePlayer.actionsRemaining < actionCost.total) {
    return {
      blockedReason: `Needs ${actionCost.total} Action${actionCost.total === 1 ? "" : "s"}; ${activePlayer.name} has ${activePlayer.actionsRemaining}`
    };
  }

  return { blockedReason: "" };
}

function formatSupportDetails(supportDetails) {
  if (!supportDetails?.supported) {
    return "No";
  }

  const providerNames = supportDetails.providers.map((provider) => provider.providerTileName);
  return providerNames.length ? `Yes (${providerNames.join(", ")})` : "Yes";
}

function renderFootprint(footprint) {
  return footprint ? footprint.join(", ") : "Off map";
}

function renderPlacementResult(result) {
  if (!result) {
    return `<p class="empty-note">No action attempted yet.</p>`;
  }

  if (result.ok) {
    return `<p class="result-message ok">${escapeHtml(result.message)}</p>`;
  }

  return `
    <div class="result-message bad">
      <strong>Action blocked</strong>
      <ul>${result.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
    </div>
  `;
}

function getTileNameByPlacedId(game, tileIndex, placedTileId) {
  const placedTile = game.map.placedTiles.find((tile) => tile.id === placedTileId);
  const definition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  return definition ? `${definition.tile_name} (${placedTile.id})` : placedTileId;
}

function normalizeActivationTargetIds(value) {
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function matchesActivationTargetCategories(tileIndex, placedTile, activationDetails) {
  const targetCategories = activationDetails?.targetCategories ?? [];
  if (targetCategories.length === 0) {
    return true;
  }

  const definition = tileIndex.get(placedTile.tileId);
  return targetCategories.includes(definition?.tile_category);
}

function getStrainActivationTargetCandidates(game, tileIndex, placedTile, activationDetails) {
  if (!placedTile) {
    return [];
  }

  const candidatePool = activationDetails?.adjacent === false
    ? game.map.placedTiles.filter((candidate) => candidate.id !== placedTile.id)
    : getAdjacentPlacedTiles(game, placedTile);

  return candidatePool.filter(
    (candidate) =>
      (candidate.strain ?? 0) > 0 &&
      matchesActivationTargetCategories(tileIndex, candidate, activationDetails)
  );
}

function getSupportActivationTargetCandidates(game, tileIndex, placedTile, activationDetails) {
  if (!placedTile) {
    return [];
  }

  return getAdjacentPlacedTiles(game, placedTile).filter(
    (candidate) =>
      !isOverstrainedPlacedTile(candidate) &&
      !isSupportedPlacedTile(candidate) &&
      matchesActivationTargetCategories(tileIndex, candidate, activationDetails)
  );
}

function formatActivationTargetOption(game, tileIndex, placedTile, mode) {
  const name = getTileNameByPlacedId(game, tileIndex, placedTile.id);

  if (mode === "support") {
    return `${name} - Not Supported`;
  }

  return `${name} - ${placedTile.strain ?? 0} Strain`;
}

function renderActivationTargetControl(
  game,
  tileIndex,
  candidates,
  selectedTargetIds,
  maxTargets,
  { label = "Target", emptyText = "No strained adjacent tiles", mode = "strain" } = {}
) {
  if (maxTargets <= 1) {
    return `
      <label class="stacked-field activation-target">
        <span>${escapeHtml(label)}</span>
        <select id="activation-target" aria-label="Activation target" ${candidates.length ? "" : "disabled"}>
          ${
            candidates.length
              ? candidates
                  .map(
                    (placedTile) => `
                      <option value="${escapeHtml(placedTile.id)}" ${placedTile.id === selectedTargetIds[0] ? "selected" : ""}>
                        ${escapeHtml(formatActivationTargetOption(game, tileIndex, placedTile, mode))}
                      </option>
                    `
                  )
                  .join("")
              : `<option>${escapeHtml(emptyText)}</option>`
          }
        </select>
      </label>
    `;
  }

  return `
    <fieldset class="stacked-field activation-target">
      <legend>Targets</legend>
      ${
        candidates.length
          ? `<div class="activation-target-list">
              ${candidates
                .map((placedTile) => {
                  const checked = selectedTargetIds.includes(placedTile.id);
                  const disabled = !checked && selectedTargetIds.length >= maxTargets;

                  return `
                    <label class="activation-target-option">
                      <input
                        class="activation-target-choice"
                        type="checkbox"
                        value="${escapeHtml(placedTile.id)}"
                        data-max-targets="${maxTargets}"
                        ${checked ? "checked" : ""}
                        ${disabled ? "disabled" : ""}
                      >
                      <span>${escapeHtml(formatActivationTargetOption(game, tileIndex, placedTile, mode))}</span>
                    </label>
                  `;
                })
                .join("")}
            </div>`
          : `<p class="empty-note">${escapeHtml(emptyText)}</p>`
      }
    </fieldset>
  `;
}

function getArrivalTargetName(activeEncounter, encounterIndex) {
  const card = encounterIndex.get(activeEncounter.cardId);
  return card?.card_name ?? activeEncounter.cardId;
}

function renderArrivalTimerTargetControl(game, encounterIndex, candidates, selectedTargetId) {
  const timerMax = game.rules.arrivalTimerMax ?? 3;

  return `
    <label class="stacked-field activation-target">
      <span>Arrival</span>
      <select id="arrival-timer-target" aria-label="Arrival timer target" ${candidates.length ? "" : "disabled"}>
        ${
          candidates.length
            ? candidates
                .map(
                  (activeEncounter) => `
                    <option value="${escapeHtml(activeEncounter.id)}" ${activeEncounter.id === selectedTargetId ? "selected" : ""}>
                      ${escapeHtml(getArrivalTargetName(activeEncounter, encounterIndex))} - ${activeEncounter.timerTokens ?? 0}/${timerMax} timers
                    </option>
                  `
                )
                .join("")
            : `<option>No active Arrivals below timer cap</option>`
        }
      </select>
    </label>
  `;
}

function renderBurdenTargetControl(encounterIndex, candidates, selectedTargetId) {
  return `
    <label class="stacked-field activation-target">
      <span>Burden</span>
      <select id="burden-activation-target" aria-label="Burden activation target" ${candidates.length ? "" : "disabled"}>
        ${
          candidates.length
            ? candidates
                .map((activeEncounter) => {
                  const card = encounterIndex.get(activeEncounter.cardId);
                  const name = card?.card_name ?? activeEncounter.cardId;

                  return `
                    <option value="${escapeHtml(activeEncounter.id)}" ${activeEncounter.id === selectedTargetId ? "selected" : ""}>
                      ${escapeHtml(name)}
                    </option>
                  `;
                })
                .join("")
            : `<option>No unresolved active Burdens</option>`
        }
      </select>
    </label>
  `;
}

function getActivationPaymentChoices(placedTileId, activationDetails) {
  const saved = state.activationPayments[placedTileId] ?? [];
  const count =
    activationDetails.type === "flexible_resource_exchange"
      ? getActivationExchangeAmount(placedTileId, activationDetails)
      : activationDetails.paymentAmount;

  return Array.from({ length: count }, (_, index) => saved[index] ?? "");
}

function getActivationGainChoices(placedTileId, activationDetails) {
  const saved = state.activationGains[placedTileId] ?? [];
  const count = getActivationExchangeAmount(placedTileId, activationDetails);

  return Array.from({ length: count }, (_, index) => saved[index] ?? "");
}

function getActivationExchangeAmount(placedTileId, activationDetails) {
  if (activationDetails.type !== "flexible_resource_exchange") {
    return activationDetails.paymentAmount;
  }

  const savedAmount = Number(state.activationExchangeAmounts[placedTileId] ?? 1);

  if (!Number.isInteger(savedAmount)) {
    return 1;
  }

  return Math.max(1, Math.min(activationDetails.maxAmount, savedAmount));
}

function renderResourceExchangePaymentControl(game, placedTileId, activationDetails) {
  const selectedResources = getActivationPaymentChoices(placedTileId, activationDetails);
  const selectedGains =
    activationDetails.type === "flexible_resource_exchange" ? getActivationGainChoices(placedTileId, activationDetails) : [];
  const allowedGainResources = game.rules.resources.filter(
    (resource) => !activationDetails.excludedGainResources?.includes(resource)
  );

  return `
    ${
      activationDetails.type === "flexible_resource_exchange"
        ? `<label class="stacked-field activation-exchange-count">
            <span>Count</span>
            <select id="activation-exchange-count" aria-label="Exchange count">
              ${Array.from({ length: activationDetails.maxAmount }, (_, index) => index + 1)
                .map(
                  (amount) =>
                    `<option value="${amount}" ${amount === selectedResources.length ? "selected" : ""}>${amount}</option>`
                )
                .join("")}
            </select>
          </label>`
        : ""
    }
    <div class="burden-payment-grid activation-payment-grid" aria-label="Exchange payment resources">
      ${selectedResources
        .map(
          (selectedResource, index) => `
            <select class="activation-payment-resource" data-placed-tile-id="${escapeHtml(placedTileId)}" data-payment-index="${index}" aria-label="Exchange payment resource ${index + 1}">
              <option value="">Pay...</option>
              ${game.rules.resources
                .map(
                  (resource) =>
                    `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                )
                .join("")}
            </select>
          `
        )
        .join("")}
    </div>
    ${
      activationDetails.type === "flexible_resource_exchange"
        ? `<div class="burden-payment-grid activation-gain-grid" aria-label="Exchange gain resources">
            ${selectedGains
              .map(
                (selectedResource, index) => `
                  <select class="activation-gain-resource" data-placed-tile-id="${escapeHtml(placedTileId)}" data-gain-index="${index}" aria-label="Exchange gain resource ${index + 1}">
                    <option value="">Gain...</option>
                    ${allowedGainResources
                      .map(
                        (resource) =>
                          `<option value="${escapeHtml(resource)}" ${resource === selectedResource ? "selected" : ""}>${escapeHtml(resource)}</option>`
                      )
                      .join("")}
                  </select>
                `
              )
              .join("")}
          </div>`
        : ""
    }
  `;
}

function renderTravelNetworksPanel(game, tileIndex, encounterIndex, { embedded = false } = {}) {
  const networks = buildTravelNetworks(game, { tileIndex });
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const selectedPlacedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const selectedNetwork = selectedPlacedTile ? getNetworkForPlacedTile(networks, selectedPlacedTile.id) : null;
  const crossing = getRiverCrossingActionCost(game, state.selectedCoordinate, { tileIndex });
  const selectedTileSupported = isSupportedPlacedTile(selectedPlacedTile);
  const selectedSupportDetails = selectedPlacedTile
    ? getEffectiveSupportDetails(game, selectedPlacedTile.id, { tileIndex })
    : null;
  const selectedTileDefinition = selectedPlacedTile ? tileIndex.get(selectedPlacedTile.tileId) : null;
  const upgradeTile = selectedTileDefinition ? findUpgradeTile(selectedTileDefinition, tileIndex) : null;
  const upgradeCostChoiceResources =
    selectedPlacedTile && upgradeTile ? getUpgradeCostChoiceAction(selectedPlacedTile.id, upgradeTile.upgrade_cost) : [];
  const upgradeCost = upgradeTile ? parseResourceCostForDisplay(upgradeTile.upgrade_cost, upgradeCostChoiceResources) : null;
  const activationActionCost = selectedPlacedTile
    ? calculatePlacedTileActionCost(
        game,
        selectedPlacedTile,
        { tileIndex, playerId: activePlayer?.id ?? game.activePlayerId },
        "activationActionCost"
      )
    : null;
  const discountedActivationActionCost = activationActionCost
    ? getDiscountedDisconnectedTravelActionCost(game, "activation", activationActionCost).actionCost
    : null;
  const activationStewardPowerProviders = getActivationStewardPowerProviders(
    game,
    tileIndex,
    discountedActivationActionCost
  );
  const selectedActivationStewardPowerId = getSelectedStewardPowerId(
    state.stewardActivationPowerId,
    activationStewardPowerProviders
  );
  const selectedActivationStewardPowerProvider =
    activationStewardPowerProviders.find((provider) => provider.placedTile.id === selectedActivationStewardPowerId) ??
    null;
  const displayedActivationActionCost = getActivationStewardActionPreview(
    discountedActivationActionCost,
    selectedActivationStewardPowerProvider
  );
  const baseUpgradeActionCost = upgradeTile
    ? calculatePlacedTileActionCost(
        game,
        selectedPlacedTile,
        { tileIndex, playerId: activePlayer?.id ?? game.activePlayerId },
        "upgradeActionCost"
      )
    : null;
  const upgradeActionCost = upgradeTile
    ? getDiscountedDisconnectedTravelActionCost(
        game,
        "upgrade",
        getDiscountedTileActionCost(game, selectedTileDefinition, "upgrade", baseUpgradeActionCost).actionCost
      ).actionCost
    : null;
  const upgradeStewardPowerProviders = upgradeTile
    ? getUpgradeStewardPowerProviders(game, selectedTileDefinition, tileIndex, upgradeActionCost)
    : [];
  const selectedUpgradeStewardPowerId = getSelectedStewardPowerId(
    state.stewardUpgradePowerId,
    upgradeStewardPowerProviders
  );
  const selectedUpgradeStewardPowerProvider =
    upgradeStewardPowerProviders.find((provider) => provider.placedTile.id === selectedUpgradeStewardPowerId) ?? null;
  const displayedUpgradeActionCost = getUpgradeStewardActionPreview(
    upgradeActionCost,
    selectedUpgradeStewardPowerProvider
  );
  const upgradeResourceDiscount = getPendingUpgradeResourceDiscount(game, selectedTileDefinition);
  const selectedStewardExchangeProvider = getActiveStewardExchangeProvider(game, tileIndex);
  const selectedStewardPowerDetails = selectedStewardExchangeProvider?.details ?? null;
  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);
  const normalTurnActionsOpen = !openingRequirement;
  const activation = selectedTileDefinition ? getActivationForDisplay(selectedTileDefinition) : null;
  const activationDetails = activation?.details ?? null;
  const activationLabel = activation?.error ? "Unsupported" : formatActivationDetails(activationDetails);
  const needsStrainActivationTarget = activationDetails?.type === "remove_strain_adjacent";
  const needsSupportActivationTarget = activationDetails?.type === "give_supported_adjacent";
  const needsArrivalTimerTarget = activationDetails?.type === "add_arrival_timer";
  const needsBurdenTarget = activationDetails?.type === "resolve_active_burden";
  const needsExchangePayment =
    activationDetails?.type === "resource_exchange" || activationDetails?.type === "flexible_resource_exchange";
  const needsExchangeGain = activationDetails?.type === "flexible_resource_exchange";
  const activationMaxTargets = activationDetails?.maxTargets ?? 1;
  const activationTargetCandidates =
    needsStrainActivationTarget && selectedPlacedTile
      ? getStrainActivationTargetCandidates(game, tileIndex, selectedPlacedTile, activationDetails)
      : needsSupportActivationTarget && selectedPlacedTile
        ? getSupportActivationTargetCandidates(game, tileIndex, selectedPlacedTile, activationDetails)
      : [];
  const arrivalTimerTargetCandidates = needsArrivalTimerTarget
    ? game.encounter.active.filter((activeEncounter) => {
        const timerMax = game.rules.arrivalTimerMax ?? 3;
        const currentTimerTokens = Number(activeEncounter.timerTokens ?? game.rules.arrivalStartTimerTokens ?? 3);

        return (
          activeEncounter.encounterType === ENCOUNTER_TYPES.ARRIVAL &&
          !activeEncounter.completed &&
          currentTimerTokens < timerMax
        );
      })
    : [];
  const burdenTargetCandidates = needsBurdenTarget
    ? game.encounter.active.filter(
        (activeEncounter) => activeEncounter.encounterType === ENCOUNTER_TYPES.BURDEN && !activeEncounter.resolved
      )
    : [];
  const savedActivationTargetIds = selectedPlacedTile
    ? normalizeActivationTargetIds(state.activationTargets[selectedPlacedTile.id])
    : [];
  const validSavedActivationTargetIds = savedActivationTargetIds.filter((targetId) =>
    activationTargetCandidates.some((placedTile) => placedTile.id === targetId)
  );
  const selectedActivationTargetIds = (
    validSavedActivationTargetIds.length
      ? validSavedActivationTargetIds
      : activationTargetCandidates.slice(0, 1).map((placedTile) => placedTile.id)
  ).slice(0, activationMaxTargets);
  const selectedArrivalTimerTargetId = arrivalTimerTargetCandidates.some(
    (activeEncounter) => activeEncounter.id === savedActivationTargetIds[0]
  )
    ? savedActivationTargetIds[0]
    : (arrivalTimerTargetCandidates[0]?.id ?? "");
  const selectedBurdenTargetId = burdenTargetCandidates.some(
    (activeEncounter) => activeEncounter.id === savedActivationTargetIds[0]
  )
    ? savedActivationTargetIds[0]
    : (burdenTargetCandidates[0]?.id ?? "");
  const selectedExchangePayments =
    needsExchangePayment && selectedPlacedTile ? getActivationPaymentChoices(selectedPlacedTile.id, activationDetails) : [];
  const selectedExchangeGains =
    needsExchangeGain && selectedPlacedTile ? getActivationGainChoices(selectedPlacedTile.id, activationDetails) : [];
  const exchangePaymentReady = !needsExchangePayment || selectedExchangePayments.every((resource) => Boolean(resource));
  const exchangeGainReady = !needsExchangeGain || selectedExchangeGains.every((resource) => Boolean(resource));
  const upgradeCostDiscountChoices =
    selectedPlacedTile && upgradeCost && !upgradeCost.error
      ? getUpgradeCostDiscountChoices(selectedPlacedTile.id, upgradeCost.cost, upgradeResourceDiscount)
      : [];
  const upgradeCostDiscountReady = upgradeCostDiscountChoices.every((resource) => Boolean(resource));
  const upgradePreviewValidation =
    selectedPlacedTile && upgradeTile && upgradeCost && !upgradeCost.error && upgradeCostDiscountReady
      ? validateUpgradeTile(
          game,
          {
            type: TILE_ACTION_TYPES.UPGRADE_TILE,
            placedTileId: selectedPlacedTile.id,
            upgradeCostChoiceResources,
            upgradeCostReductionResources: getUpgradeCostDiscountAction(
              selectedPlacedTile.id,
              upgradeCost.cost,
              upgradeResourceDiscount
            )
          },
          { tiles: state.data.tiles, tileIndex }
        )
      : null;
  const upgradeResourceCostSubstitution = upgradePreviewValidation?.resourceCostSubstitution ?? null;
  const upgradeDisplayCost = upgradePreviewValidation?.cost ?? upgradeCost?.cost ?? [];
  const upgradeLabel = upgradeTile
    ? `${upgradeTile.tile_name} (${upgradeCost?.error ? "unsupported cost" : renderCost(upgradeDisplayCost)})`
    : "None";
  const selectedStewardExchangePayments =
    selectedStewardExchangeProvider && selectedStewardPowerDetails?.type === STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
      ? getStewardExchangePaymentChoices(selectedStewardExchangeProvider.placedTile.id, selectedStewardPowerDetails)
      : [];
  const selectedStewardExchangeGains =
    selectedStewardExchangeProvider && selectedStewardPowerDetails?.type === STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
      ? getStewardExchangeGainChoices(selectedStewardExchangeProvider.placedTile.id, selectedStewardPowerDetails)
      : [];
  const stewardExchangeReady =
    selectedStewardPowerDetails?.type !== STEWARD_POWER_TYPES.RESOURCE_EXCHANGE ||
    (selectedStewardExchangePayments.every(Boolean) && selectedStewardExchangeGains.every(Boolean));
  const playOpen = isPlaySessionPlaying();
  const activationReachable = !displayedActivationActionCost?.blockedByReachability;
  const upgradeReachable = !displayedUpgradeActionCost?.blockedByReachability;
  const activationActionsReady = Boolean(
    activePlayer &&
    displayedActivationActionCost &&
    activePlayer.actionsRemaining >= displayedActivationActionCost.total
  );
  const upgradeActionsReady = Boolean(
    activePlayer &&
    displayedUpgradeActionCost &&
    activePlayer.actionsRemaining >= displayedUpgradeActionCost.total
  );
  const canUseStewardExchange =
    playOpen &&
    Boolean(game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    normalTurnActionsOpen &&
    Boolean(selectedStewardExchangeProvider) &&
    stewardExchangeReady &&
    canAffordCost(game.warehouse, getResourcePaymentAction(selectedStewardExchangePayments));
  const canActivate =
    playOpen &&
    Boolean(selectedPlacedTile && activationDetails && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    normalTurnActionsOpen &&
    !isOverstrainedPlacedTile(selectedPlacedTile) &&
    activationReachable &&
    activationActionsReady &&
    (!(needsStrainActivationTarget || needsSupportActivationTarget) || selectedActivationTargetIds.length > 0) &&
    (!needsArrivalTimerTarget || Boolean(selectedArrivalTimerTargetId)) &&
    (!needsBurdenTarget || Boolean(selectedBurdenTargetId)) &&
    exchangePaymentReady &&
    exchangeGainReady;
  const canUpgrade =
    playOpen &&
    Boolean(selectedPlacedTile && upgradeTile && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    normalTurnActionsOpen &&
    !isOverstrainedPlacedTile(selectedPlacedTile) &&
    upgradeReachable &&
    upgradeActionsReady &&
    upgradeCostDiscountReady;
  const selectedTileName = selectedPlacedTile
    ? getTileNameByPlacedId(game, tileIndex, selectedPlacedTile.id)
    : "No map tile selected";
  const selectedTileSummary = selectedPlacedTile
    ? `${selectedTileName} at ${getPlacedTileAnchorCoordinate(selectedPlacedTile) ?? state.selectedCoordinate}`
    : "Selected map tile";

  return `
    ${
      embedded
        ? `<details id="selected-tile-panel" class="tile-selected-details">
            <summary>
              <span>Selected Map Tile</span>
              <strong>${escapeHtml(selectedTileSummary)}</strong>
            </summary>`
        : `<section id="selected-tile-panel" class="state-panel wide-panel travel-panel">
            <h2>Selected Map Tile</h2>`
    }
      <ul class="metric-list">
        <li><span>Networks</span><strong>${networks.length}</strong></li>
        <li><span>Selected Tile</span><strong>${escapeHtml(selectedPlacedTile ? selectedTileName : "None")}</strong></li>
        <li><span>Supported</span><strong>${escapeHtml(formatSupportDetails(selectedSupportDetails))}</strong></li>
        <li><span>Activation</span><strong>${escapeHtml(activationLabel)}</strong></li>
        <li><span>Activation Action</span><strong>${escapeHtml(renderActionCost(displayedActivationActionCost))}</strong></li>
        <li><span>Upgrade</span><strong>${escapeHtml(upgradeLabel)}</strong></li>
        <li><span>Upgrade Action</span><strong>${escapeHtml(renderActionCost(displayedUpgradeActionCost))}</strong></li>
        <li><span>Steward Power</span><strong>${escapeHtml(formatStewardPowerStatus(selectedPlacedTile, selectedTileDefinition, game))}</strong></li>
        <li><span>Selected Network</span><strong>${escapeHtml(selectedNetwork?.id ?? "None")}</strong></li>
        <li><span>Selected Hex Crossing</span><strong>${crossing.valid ? `${crossing.cost} Action` : "N/A"}</strong></li>
      </ul>
      ${crossing.valid ? `<p class="network-note">${escapeHtml(crossing.reason)}</p>` : ""}
      ${openingRequirement ? `<p class="network-note opening-note">${escapeHtml(`Opening move required before other map actions: ${openingRequirement.summary}.`)}</p>` : ""}
      ${renderTileSourceText(selectedTileDefinition, "Selected Tile Says")}
      ${renderStewardHouseUpgradePreview(selectedTileDefinition, tileIndex)}
      ${renderTileSourceText(upgradeTile, "Upgrade Side Says")}
      ${
        needsStrainActivationTarget || needsSupportActivationTarget
          ? renderActivationTargetControl(
              game,
              tileIndex,
              activationTargetCandidates,
              selectedActivationTargetIds,
              activationMaxTargets,
              needsSupportActivationTarget
                ? {
                    label: "Support target",
                    emptyText: "No adjacent eligible tiles without Supported",
                    mode: "support"
                  }
                : {
                    emptyText: activationDetails?.adjacent === false
                      ? "No eligible strained tiles"
                      : "No strained adjacent tiles"
                  }
            )
          : ""
      }
      ${
        needsArrivalTimerTarget
          ? renderArrivalTimerTargetControl(
              game,
              encounterIndex,
              arrivalTimerTargetCandidates,
              selectedArrivalTimerTargetId
            )
          : ""
      }
      ${needsBurdenTarget ? renderBurdenTargetControl(encounterIndex, burdenTargetCandidates, selectedBurdenTargetId) : ""}
      ${
        needsExchangePayment && selectedPlacedTile
          ? renderResourceExchangePaymentControl(game, selectedPlacedTile.id, activationDetails)
          : ""
      }
      ${renderStewardExchangeControls(
        game,
        selectedStewardExchangeProvider?.placedTile ?? null,
        selectedStewardPowerDetails,
        canUseStewardExchange
      )}
      ${renderStewardPowerSelect({
        id: "steward-activation-power",
        label: "Activation Steward Power",
        providers: activationStewardPowerProviders,
        selectedId: selectedActivationStewardPowerId
      })}
      ${renderStewardPowerSelect({
        id: "steward-upgrade-power",
        label: "Upgrade Steward Power",
        providers: upgradeStewardPowerProviders,
        selectedId: selectedUpgradeStewardPowerId
      })}
      ${
        selectedPlacedTile && upgradeTile
          ? renderResourceCostChoiceControls({
              mode: "upgrade",
              targetId: selectedPlacedTile.id,
              costText: upgradeTile.upgrade_cost,
              selectedChoices: upgradeCostChoiceResources
            })
          : ""
      }
      ${renderUpgradeCostDiscountChoices(selectedPlacedTile, selectedTileDefinition, upgradeCost, upgradeResourceDiscount)}
      ${renderResourceCostSubstitutionNotice(upgradeResourceCostSubstitution)}
      ${
        selectedPlacedTile
          ? `<div class="button-row">
              <button id="activate-selected" class="primary-button" type="button" ${canActivate ? "" : "disabled"}>Activate</button>
              <button id="upgrade-selected" class="primary-button" type="button" ${canUpgrade ? "" : "disabled"}>Upgrade</button>
              <button id="apply-strain-selected" class="secondary-button" type="button" ${playOpen ? "" : "disabled"}>Apply Strain</button>
              <button id="support-selected" class="secondary-button" type="button" ${playOpen ? "" : "disabled"}>${selectedTileSupported ? "Remove Support" : "Give Support"}</button>
              <button id="overstrain-selected" class="secondary-button" type="button" ${playOpen ? "" : "disabled"}>Set 3 Strain</button>
              <button id="clear-strain-selected" class="secondary-button" type="button" ${playOpen ? "" : "disabled"}>Clear Strain</button>
            </div>`
          : ""
      }
      ${
        `<details class="tile-network-details">
          <summary>Connected Networks <span>${networks.length}</span></summary>
          ${
            networks.length === 0
              ? `<p class="empty-note">No connected settlement network yet.</p>`
              : `<ol class="network-list">
                  ${networks
                    .map(
                      (network) => `
                        <li>
                          <header>
                            <strong>${escapeHtml(network.id)}</strong>
                            <span>${network.tileIds.length} tile${network.tileIds.length === 1 ? "" : "s"}</span>
                          </header>
                          <p>${network.tileIds.map((tileId) => escapeHtml(getTileNameByPlacedId(game, tileIndex, tileId))).join(", ")}</p>
                          <small>Hexes: ${escapeHtml(network.coordinates.join(", "))}</small>
                          <small>Network hexes: ${network.coordinates.length}</small>
                        </li>
                      `
                    )
                    .join("")}
                </ol>`
          }
        </details>`
      }
    ${embedded ? "</details>" : "</section>"}
  `;
}

function renderStewardHouseSetupPlacementPanel(game, tileIndex, encounterIndex, pending) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const powerDetails = getStewardPowerDetailsForRole(pending.role.id);

  return `
    <section id="placement-panel" class="state-panel placement-panel tile-console-panel">
      <header class="tile-console-header">
        <h2>Tiles</h2>
        <span>Setup</span>
      </header>
      <p class="phase-note opening-note">${escapeHtml(`${formatPlayerName(activePlayer)} places their ${pending.role.name} token for free. Click a highlighted token hex.`)}</p>
      <div class="tile-effect-preview">
        <strong>${escapeHtml(`${pending.role.name} Steward Power`)}</strong>
        <p>${escapeHtml(powerDetails?.label ?? "Once per Season Steward Power")}. Available immediately once the token is placed.</p>
      </div>
      ${renderPlacementResult(state.lastActionResult)}
      ${renderTravelNetworksPanel(game, tileIndex, encounterIndex, { embedded: true })}
    </section>
  `;
}

function renderTilePlacementPanel(game, tileIndex, encounterIndex) {
  const stewardHouseRequirement = isPlaySessionPlaying()
    ? getStewardHousePlacementRequirementForActivePlayer(game)
    : null;
  if (stewardHouseRequirement) {
    return renderStewardHouseSetupPlacementPanel(game, tileIndex, encounterIndex, stewardHouseRequirement);
  }

  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(game);
  const options = getPlacementOptions().filter(
    ({ tile }) => !openingRequirement || isOpeningResourceTileForPlayer(openingRequirement.player, tile.tile_id)
  );
  const selectedTile = tileIndex.get(state.selectedTileId);
  const selectedSupply = options.find((option) => option.tile.tile_id === selectedTile?.tile_id)?.supply ?? null;
  const placementCostChoiceResources = selectedTile
    ? getPlacementCostChoiceAction(selectedTile.tile_id, selectedTile.place_cost)
    : [];
  const cost = selectedTile ? parseResourceCostForDisplay(selectedTile.place_cost, placementCostChoiceResources).cost : [];
  const footprint = selectedTile
    ? getFootprintCoordinates(state.selectedCoordinate, selectedTile.size_hexes, state.selectedOrientation, game.map.hexes)
    : null;
  const actionCost = footprint && selectedTile
    ? calculatePlacementActionCostForUi(game, selectedTile, footprint, tileIndex)
    : null;
  const placementStewardPowerProviders = getPlacementStewardPowerProviders(
    game,
    selectedTile,
    actionCost,
    tileIndex
  );
  const selectedPlacementStewardPowerId = getSelectedStewardPowerId(
    state.stewardPlacementPowerId,
    placementStewardPowerProviders
  );
  const selectedPlacementStewardPowerProvider =
    placementStewardPowerProviders.find((provider) => provider.placedTile.id === selectedPlacementStewardPowerId) ??
    null;
  const displayedActionCost = getPlacementStewardActionPreview(actionCost, selectedPlacementStewardPowerProvider);
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const placementResourceDiscount = getPendingPlacementResourceDiscount(game, selectedTile);
  const placementCostDiscountChoices = selectedTile
    ? getPlacementCostDiscountChoices(selectedTile.tile_id, cost, placementResourceDiscount)
    : [];
  const placementCostDiscountReady = placementCostDiscountChoices.every((resource) => Boolean(resource));
  const selectedPlacementPreviewValidation =
    selectedTile && placementCostDiscountReady
      ? validatePlaceTile(
          game,
          {
            type: TILE_ACTION_TYPES.PLACE_TILE,
            tileId: selectedTile.tile_id,
            coordinate: state.selectedCoordinate,
            orientation: state.selectedOrientation,
            placementCostChoiceResources,
            placementCostReductionResources: getPlacementCostDiscountAction(
              selectedTile.tile_id,
              cost,
              placementResourceDiscount
            )
          },
          { tiles: state.data.tiles }
        )
      : null;
  const placementResourceCostSubstitution = selectedPlacementPreviewValidation?.resourceCostSubstitution ?? null;
  const placementReachable = !displayedActionCost?.blockedByReachability;
  const hasEnoughActions = Boolean(activePlayer && displayedActionCost && activePlayer.actionsRemaining >= displayedActionCost.total);
  const hasEnoughStockForPlacement = !isStablesTile(selectedTile) || (selectedSupply?.available ?? 0) >= 2;
  const placementBlockedReason = !selectedTile
    ? "Choose a tile"
    : !tileMatchesActiveOpeningRequirement(game, selectedTile)
      ? "Opening tile required"
      : !hasEnoughStockForPlacement
        ? "Needs both Stables copies"
      : !placementCostDiscountReady
        ? "Choose discount resource"
        : !placementReachable
          ? "Out of connected network"
        : !hasEnoughActions
          ? `Needs ${displayedActionCost?.total ?? 0} Actions`
          : "";
  const canPlace =
    isPlaySessionPlaying() &&
    Boolean(selectedTile && activePlayer && actionCost && game.phase === GAME_PHASES.PLAYER_TURNS) &&
    hasEnoughStockForPlacement &&
    placementCostDiscountReady &&
    placementReachable &&
    hasEnoughActions &&
    tileMatchesActiveOpeningRequirement(game, selectedTile);
  const selectedPlacementControls = renderSelectedTilePlacementControls({
    selectedTile,
    footprint,
    actionCost,
    displayedActionCost,
    canPlace,
    blockedReason: placementBlockedReason,
    cost,
    displayCost: selectedPlacementPreviewValidation?.cost ?? cost,
    resourceCostSubstitution: placementResourceCostSubstitution,
    placementCostChoiceResources,
    placementResourceDiscount,
    placementCostDiscountChoices,
    placementStewardPowerProviders,
    selectedPlacementStewardPowerId
  });

  return `
    <section id="placement-panel" class="state-panel placement-panel tile-console-panel">
      <header class="tile-console-header">
        <h2>Tiles</h2>
        <span>${escapeHtml(activePlayer ? `${activePlayer.actionsRemaining}/${game.rules.actionsPerPlayer} Actions` : "No active Steward")}</span>
      </header>
      ${openingRequirement ? `<p class="phase-note opening-note">${escapeHtml(`Opening move required: ${openingRequirement.summary}.`)}</p>` : ""}
      ${selectedPlacementControls}
      ${renderTileChoiceButtons(options, tileIndex, {
        selectedTileId: state.selectedTileId
      })}
      ${renderPlacementResult(state.lastActionResult)}
    </section>
  `;
}

function renderSelectedTilePlacementControls({
  selectedTile,
  footprint,
  actionCost,
  displayedActionCost,
  canPlace,
  blockedReason,
  cost,
  displayCost,
  resourceCostSubstitution,
  placementCostChoiceResources,
  placementResourceDiscount,
  placementCostDiscountChoices,
  placementStewardPowerProviders,
  selectedPlacementStewardPowerId
}) {
  if (!selectedTile) {
    return "";
  }

  const selectedTileSize = Number(selectedTile.size_hexes ?? 1);
  const isMultihex = selectedTileSize > 1;
  const pendingPreview =
    state.pendingPlacementPreview?.tileId === selectedTile.tile_id &&
    state.pendingPlacementPreview?.coordinate === state.selectedCoordinate;
  const pendingPair =
    state.pendingPairedPlacement?.tileId === selectedTile.tile_id;
  const stablesTile = isStablesTile(selectedTile);
  const previewCost = getCostAfterSelectedResourceDiscount(
    cost,
    placementResourceDiscount,
    placementCostDiscountChoices
  );
  const visibleCost = resourceCostSubstitution?.cost ?? displayCost ?? previewCost;
  const discountReady = placementCostDiscountChoices.every(Boolean);
  const placeButtonLabel = !discountReady
    ? "Choose discount resource to continue"
    : blockedReason && !canPlace
      ? blockedReason
      : stablesTile
        ? pendingPair
          ? `Place both Stables for ${renderActionCountLabel(displayedActionCost)}`
          : "Choose first Stables site"
        : `Place for ${renderActionCountLabel(displayedActionCost)}, pay ${renderCost(visibleCost)}`;
  const stewardPowerControls = renderStewardPowerSelect({
    id: "steward-placement-power",
    label: "Optional Steward Power",
    providers: placementStewardPowerProviders,
    selectedId: selectedPlacementStewardPowerId
  });
  const costChoiceControls = renderResourceCostChoiceControls({
    mode: "placement",
    targetId: selectedTile.tile_id,
    costText: selectedTile.place_cost,
    selectedChoices: placementCostChoiceResources
  });
  const discountControls = renderPlacementCostDiscountChoices(selectedTile, cost, placementResourceDiscount);
  const selectedTileIndex = state.data?.tiles ? createTileIndex(state.data.tiles) : new Map();
  const selectedUpgradeTile = findUpgradeTile(selectedTile, selectedTileIndex);

  return `
    <div class="tile-wire-placement-panel">
      <header>
        <span>Current Action</span>
        <strong>${escapeHtml(`${selectedTile.tile_name} at ${state.selectedCoordinate}`)}</strong>
      </header>
      ${
        pendingPair
          ? `<p class="placement-guidance">First Stables site is ${escapeHtml(state.pendingPairedPlacement.coordinate)}. Select the second land hex, then place both for one action.</p>`
          : pendingPreview
          ? `<p class="placement-guidance">Preview armed on the map. Rotate here if needed, then press Place Tile or click the preview hex.</p>`
          : stablesTile
            ? `<p class="placement-guidance">Stables place as two single-hex tiles in one action. Choose the first site, then the second site.</p>`
            : isMultihex
              ? `<p class="placement-guidance">Use Rotate, then Place Tile. You can also right-click a legal hex to preview this tile there first.</p>`
              : `<p class="placement-guidance">Select a map hex, then Place Tile. Single-hex tiles do not need rotation.</p>`
      }
      ${
        isMultihex
          ? `<div class="placement-rotation-row">
              <label class="stacked-field compact-field">
                <span>Rotation</span>
                <select id="tile-orientation" aria-label="Tile rotation">
                  ${HEX_DIRECTIONS.map(
                    (direction) =>
                      `<option value="${escapeHtml(direction.id)}" ${direction.id === state.selectedOrientation ? "selected" : ""}>${escapeHtml(direction.label)}</option>`
                  ).join("")}
                </select>
              </label>
              <button id="rotate-placement-preview" class="secondary-button compact-action" type="button">Rotate</button>
              ${
                pendingPreview
                  ? `<button id="cancel-placement-preview" class="secondary-button compact-action" type="button">Cancel</button>`
                  : ""
              }
            </div>`
          : ""
      }
      <dl class="detail-list compact-details">
        <div><dt>Footprint</dt><dd>${escapeHtml(renderFootprint(footprint))}</dd></div>
        <div><dt>Connection</dt><dd>${escapeHtml(renderPlacementConnectionLabel(actionCost))}</dd></div>
        <div><dt>Actions</dt><dd>${escapeHtml(renderActionCountLabel(displayedActionCost))}</dd></div>
        <div><dt>Resources</dt><dd>${escapeHtml(renderCost(visibleCost))}</dd></div>
      </dl>
      <div class="selected-placement-face" aria-label="${escapeHtml(`${selectedTile.tile_name} tile face preview`)}">
        ${renderTileFaceSvg(selectedTile, { upgradeTile: selectedUpgradeTile })}
      </div>
      ${renderTileEffectPreview(selectedTile, {
        label: "Cost & Effect",
        costSummary: [
          { label: "Actions", value: renderActionCountLabel(displayedActionCost) },
          { label: "Resources", value: renderCost(visibleCost) }
        ]
      })}
      ${renderResourceCostSubstitutionNotice(resourceCostSubstitution)}
      ${renderStewardHouseUpgradePreview(selectedTile, selectedTileIndex)}
      ${costChoiceControls}
      ${stewardPowerControls}
      ${discountControls}
      <button id="place-tile" class="primary-button placement-submit-button" type="button" ${canPlace ? "" : "disabled"}>
        ${escapeHtml(placeButtonLabel)}
      </button>
    </div>
  `;
}

function renderTileChoiceButtons(options, tileIndex, selection = {}) {
  if (options.length === 0) {
    return `<p class="empty-note">No tiles available to place.</p>`;
  }

  const hasScrollCue = options.length > 6;

  return `
    <div class="tile-tray-shell ${hasScrollCue ? "has-scroll-cue" : ""}">
      <div class="tile-tray" aria-label="Tile tray">
        ${options
          .map(({ tile, supply }) => {
            const disabled = !supply || supply.available <= 0;
            const selected = tile.tile_id === selection.selectedTileId;
            const upgradeTile = findUpgradeTile(tile, tileIndex);
            const previewSide = getTileFacePreviewSide(tile.tile_id);
            const stewardHousePreview = renderStewardHouseUpgradePreview(tile, tileIndex, { compact: true });

            return renderTileWireframeCard(tile, {
              supply,
              disabled,
              selected,
              upgradeTile,
              previewSide,
              title: selected ? "Selected Tile" : "Available Tile",
              placementControls: stewardHousePreview
            });
          })
          .join("")}
      </div>
      ${hasScrollCue ? `<div class="tile-scroll-cue" aria-hidden="true"><i></i></div>` : ""}
      ${renderTileFaceKey()}
    </div>
  `;
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});
}

function renderTileSupplyPanel(game) {
  const coreByCategory = groupBy(game.tileSupply.core, (tile) => tile.category);
  const unlockedSpecialCount = game.tileSupply.special.filter((tile) => !tile.locked).length;

  return `
    <section class="state-panel wide-panel">
      <h2>Tile Supply</h2>
      <div class="tile-summary">
        ${Object.entries(coreByCategory)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(
            ([category, tiles]) => `
              <div class="summary-box">
                <span>${escapeHtml(category)}</span>
                <strong>${tiles.reduce((sum, tile) => sum + tile.available, 0)}</strong>
              </div>
            `
          )
          .join("")}
        <div class="summary-box">
          <span>Unlocked Special</span>
          <strong>${unlockedSpecialCount}/${game.tileSupply.special.length}</strong>
        </div>
      </div>
      <details>
        <summary>Core stock</summary>
        <div class="tile-list">
          ${game.tileSupply.core
            .map(
              (tile) => `
                <div class="tile-row">
                  <span>${escapeHtml(tile.name)}</span>
                  <small>${escapeHtml(tile.side)} · ${escapeHtml(tile.category)}</small>
                  <strong>${tile.available}/${tile.stock}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </details>
      <details>
        <summary>Special stock</summary>
        <div class="tile-list">
          ${game.tileSupply.special
            .map(
              (tile) => `
                <div class="tile-row ${tile.locked ? "" : "is-unlocked"}">
                  <span>${escapeHtml(tile.name)}</span>
                  <small>${tile.locked ? "Locked" : `Unlocked by ${escapeHtml(tile.unlockedByArrival)}`}</small>
                  <strong>${tile.available}/${tile.stock}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </details>
    </section>
  `;
}

function renderScorePanel(game) {
  const score = game.score;

  return `
    <section class="state-panel">
      <h2>Score</h2>
      <ul class="metric-list">
        <li><span>Population</span><strong>${score.population}</strong></li>
        <li><span>Renown</span><strong>${score.renown}</strong></li>
        <li><span>Active Burdens</span><strong>${score.activeBurdenCount}</strong></li>
        <li><span>Strain Tokens</span><strong>${score.strainTokens}</strong></li>
        <li><span>Burden Penalty</span><strong>-${score.activeBurdenPenalty}</strong></li>
        <li><span>Strain Penalty</span><strong>-${score.strainPenalty}</strong></li>
        <li><span>Scoring Tiles</span><strong>${score.scoringTileCount}</strong></li>
        <li><span>Overstrained Excluded</span><strong>${score.overstrainedExcludedTileIds.length}</strong></li>
        <li><span>Total</span><strong>${score.total}</strong></li>
      </ul>
    </section>
  `;
}

function renderCategoryChips(categories) {
  const entries = Object.entries(categories).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return `<span class="empty-note">No placed tiles yet.</span>`;
  }

  return `
    <div class="type-chips">
      ${entries
        .map(([category, count]) => `<span class="type-chip">${escapeHtml(category)} <strong>${count}</strong></span>`)
        .join("")}
    </div>
  `;
}

function getSimulationBotProfiles() {
  return ["balanced"];
}

function getSimulationPlayerCounts() {
  if (state.simulation.playerCount === "all") {
    return [1, 2, 3, 4];
  }

  if (state.simulation.playerCount === "current") {
    return [state.playerCount];
  }

  return [Number(state.simulation.playerCount)];
}

function getSimulationRunSize() {
  return getSimulationBotProfiles().length * getSimulationPlayerCounts().length * 10;
}

function getSimulationAverages(result) {
  const rows = result?.game_rows ?? [];

  if (rows.length === 0) {
    return {
      finalScore: 0,
      upgradedTiles: 0,
      upgradeActions: 0,
      warehouseTotal: 0,
      strainPlaced: 0,
      strainRemoved: 0,
      overstrainedRounds: 0
    };
  }

  const average = (key) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length;

  return {
    finalScore: average("final_score"),
    upgradedTiles: average("final_upgraded_tiles"),
    upgradeActions: average("total_upgrade_actions"),
    warehouseTotal: average("final_warehouse_total"),
    strainPlaced: average("total_strain_placed"),
    strainRemoved: average("total_strain_removed"),
    overstrainedRounds: average("rounds_with_at_least_one_overstrained_tile")
  };
}

function renderSimulationPanel() {
  const result = state.simulation.result;
  const averages = getSimulationAverages(result);
  const errorCount = result?.errors?.length ?? 0;
  const runSize = getSimulationRunSize();

  return `
    <details id="simulation-panel" class="state-panel wide-panel simulation-panel lower-tool-details">
      <summary>
        <span>Balance Tools</span>
        <strong>Automated simulations</strong>
      </summary>
      <div class="simulation-controls">
        <div class="setup-static-row">
          <span>Bot profile</span>
          <strong>${escapeHtml(SIMULATION_BOT_PROFILES.balanced.label)}</strong>
        </div>
        <label class="stacked-field">
          <span>Player count</span>
          <select id="simulation-player-count">
            <option value="current" ${state.simulation.playerCount === "current" ? "selected" : ""}>Current setup (${state.playerCount}p)</option>
            <option value="1" ${state.simulation.playerCount === "1" ? "selected" : ""}>1 player</option>
            <option value="2" ${state.simulation.playerCount === "2" ? "selected" : ""}>2 players</option>
            <option value="3" ${state.simulation.playerCount === "3" ? "selected" : ""}>3 players</option>
            <option value="4" ${state.simulation.playerCount === "4" ? "selected" : ""}>4 players</option>
            <option value="all" ${state.simulation.playerCount === "all" ? "selected" : ""}>All player counts</option>
          </select>
        </label>
      </div>
      <div class="button-row simulation-actions">
        <button id="run-simulations" class="primary-button" type="button">Run 10 simulations</button>
        <button id="export-simulation-csv" class="secondary-button" type="button" ${result ? "" : "disabled"}>Export CSV</button>
        <button id="export-simulation-json" class="secondary-button" type="button" ${result ? "" : "disabled"}>Export JSON</button>
      </div>
      <p class="mini-copy">Current settings will run ${runSize} complete game${runSize === 1 ? "" : "s"}.</p>
      ${
        state.simulation.message
          ? `<p class="result-message ${errorCount ? "warning" : "ok"}">${escapeHtml(state.simulation.message)}</p>`
          : ""
      }
      ${
        result
          ? `<ul class="metric-list simulation-summary">
              <li><span>Games</span><strong>${result.game_rows.length}</strong></li>
              <li><span>Avg Score</span><strong>${averages.finalScore.toFixed(1)}</strong></li>
              <li><span>Avg Upgraded Tiles</span><strong>${averages.upgradedTiles.toFixed(1)}</strong></li>
              <li><span>Avg Upgrade Actions</span><strong>${averages.upgradeActions.toFixed(1)}</strong></li>
              <li><span>Avg End Warehouse</span><strong>${averages.warehouseTotal.toFixed(1)}</strong></li>
              <li><span>Avg Strain Placed</span><strong>${averages.strainPlaced.toFixed(1)}</strong></li>
              <li><span>Avg Strain Removed</span><strong>${averages.strainRemoved.toFixed(1)}</strong></li>
              <li><span>Avg Overstrained Rounds</span><strong>${averages.overstrainedRounds.toFixed(1)}</strong></li>
              <li><span>Errors</span><strong>${errorCount}</strong></li>
            </ul>`
          : ""
      }
    </details>
  `;
}

function renderTableAssistPanel() {
  return `
    <details class="state-panel wide-panel lower-tool-details facilitator-assist-details">
      <summary>
        <span>Table Assist</span>
        <strong>Facilitator tools</strong>
      </summary>
      <p class="mini-copy">Use only if a facilitator needs to correct the table during a test.</p>
      <div class="button-row">
        <button id="undo-last-action" class="secondary-button" type="button" ${canUndoLastAction() ? "" : "disabled"}>Undo Last Action</button>
        <button id="fill-warehouse" class="secondary-button" type="button" ${isPlaySessionPlaying() ? "" : "disabled"}>Fill Warehouse</button>
        <button id="reset-actions" class="secondary-button" type="button" ${isPlaySessionPlaying() ? "" : "disabled"}>Reset Actions</button>
      </div>
    </details>
  `;
}

function downloadTextFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function runAutomatedSimulationsFromUi() {
  if (!state.data) {
    return;
  }

  const seedPrefix = `quiet-vale-simulation-${Date.now().toString(36)}`;

  state.simulation = {
    ...state.simulation,
    result: null,
    message: "Running simulations..."
  };
  renderApp();

  setTimeout(() => {
    try {
      const result = runSimulationBatch({
        gamesPerCombination: 10,
        playerCounts: getSimulationPlayerCounts(),
        botProfiles: getSimulationBotProfiles(),
        seedPrefix,
        encounterCards: state.data.encounterCards,
        tiles: state.data.tiles,
        mapHexes: getSelectedMapHexes()
      });
      const errorText = result.errors.length ? ` ${result.errors.length} run${result.errors.length === 1 ? "" : "s"} reported errors.` : "";

      state.simulation = {
        ...state.simulation,
        result,
        message: `Completed ${result.game_rows.length} simulated game${result.game_rows.length === 1 ? "" : "s"}.${errorText}`
      };
    } catch (error) {
      state.simulation = {
        ...state.simulation,
        result: null,
        message: `Simulation failed: ${error.message}`
      };
    }

    renderApp();
  }, 0);
}

function exportSimulationCsv() {
  const result = state.simulation.result;

  if (!result) {
    return;
  }

  downloadTextFile(
    "the-quiet-vale-simulation-games.csv",
    simulationSummaryToCsv(result.game_rows),
    "text/csv;charset=utf-8"
  );
  downloadTextFile(
    "the-quiet-vale-simulation-rounds.csv",
    simulationRoundsToCsv(result.round_rows),
    "text/csv;charset=utf-8"
  );
}

function exportSimulationJson() {
  const result = state.simulation.result;

  if (!result) {
    return;
  }

  downloadTextFile(
    "the-quiet-vale-simulation-results.json",
    JSON.stringify(result, null, 2),
    "application/json;charset=utf-8"
  );
}

function renderActionLog(game, encounterIndex, tileIndex, limit = 12) {
  const entries = game.log.slice(-limit);

  return `
    <section class="state-panel wide-panel">
      <h2>Recent Log</h2>
      <p class="mini-copy">Showing the latest ${entries.length}/${game.log.length} table events.</p>
      <ol class="log-list">
        ${entries
          .map((entry) => {
            const card = entry.data?.cardId ? encounterIndex.get(entry.data.cardId) : null;
            const tile =
              entry.data?.tileId || entry.data?.toTileId || entry.data?.fromTileId
                ? tileIndex.get(entry.data.tileId ?? entry.data.toTileId ?? entry.data.fromTileId)
                : null;

            return `
              <li>
                <span>${escapeHtml(entry.id)}</span>
                <strong>${escapeHtml(entry.message)}</strong>
                ${renderEncounterSourceText(card, entry.season, getRevealPrototypeText(entry.data))}
                ${renderTileSourceText(tile)}
              </li>
            `;
          })
          .join("")}
      </ol>
    </section>
  `;
}

function renderGameDashboard(game, encounterIndex) {
  const tileIndex = createTileIndex(state.data.tiles);
  const activeBurdenCount = game.encounter.active.filter(
    (activeState) => activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved
  ).length;
  const strainTokenCount = game.map.placedTiles.reduce((sum, placedTile) => sum + Number(placedTile.strain ?? 0), 0);

  return `
    <details id="table-review-panel" class="table-review-details">
      <summary>
        <span>Table Review</span>
        <strong>Score ${game.score.total}</strong>
        <small>Strain ${strainTokenCount} · Burdens ${activeBurdenCount} · Log ${game.log.length}</small>
      </summary>
      <section class="game-dashboard support-dashboard">
        ${renderGameStatus(game, encounterIndex)}
        ${renderTurnPanel(game, tileIndex)}
        ${renderScorePanel(game)}
        ${renderTileSupplyPanel(game)}
        ${renderTableAssistPanel()}
        ${renderTravelNetworksPanel(game, tileIndex, encounterIndex)}
        ${renderActionLog(game, encounterIndex, tileIndex)}
      </section>
    </details>
  `;
}

function renderSiteFooter() {
  return `
    <footer class="site-footer" aria-label="Prototype ownership and contact">
      <p>
        <span>The Quiet Vale&trade;: Seasons of Settlement</span>
        <span>Prototype and rulebook materials &copy; Robert Little. All rights reserved.</span>
      </p>
      <nav class="footer-links" aria-label="Playtest links">
        <a class="playtest-contact" href="./rulebook.pdf" target="_blank" rel="noopener">View Rulebook</a>
        <a class="playtest-contact" href="mailto:robert@thequietvalegame.com">robert@thequietvalegame.com</a>
      </nav>
    </footer>
  `;
}

function renderApp() {
  if (state.error) {
    root.innerHTML = `<main class="app-shell"><div class="error-card"><h1>Load Error</h1><p>${escapeHtml(state.error.message)}</p></div></main>`;
    return;
  }

  if (!state.data || !state.game) {
    root.innerHTML = `<main class="app-shell loading">Loading source JSON...</main>`;
    return;
  }

  refreshActiveMapData();
  autoSkipEmptySeedPhase();
  const encounterIndex = createEncounterIndex(state.data.encounterCards);
  const tileIndex = createTileIndex(state.data.tiles);
  state.activeWorkspace = getActiveWorkspace(state.game);

  root.innerHTML = `
    <main class="app-shell ${state.blindTestMode ? "is-blind-test" : "is-table-tools"}">
      <header class="app-header">
        <div class="app-title-lockup">
          <span class="title-signet" aria-hidden="true"></span>
          <h1>The Quiet Vale</h1>
          <p class="app-subtitle">Seasons of Settlement</p>
        </div>
        ${renderHeaderActions(tileIndex, encounterIndex)}
      </header>
      ${renderCurrentActionPanel(state.game, tileIndex, encounterIndex)}
      <section class="play-layout">
        <section class="play-top-grid">
          <div class="map-stack">
            <div id="warehouse-panel" class="map-table-row" aria-label="Map and Warehouse resources">
              ${renderWarehousePanel(state.game, {
                id: "",
                title: "Warehouse",
                className: "map-warehouse-panel map-warehouse-rail is-left",
                resources: MAP_WAREHOUSE_RAILS[0],
                ariaLabel: "Warehouse resources: Wood, Stone, Metal"
              })}
              <section id="map-panel" class="map-panel" aria-label="Map panel">
                <header class="map-panel-header">
                  <h2>Map</h2>
                  ${renderMapKey()}
                </header>
                ${renderHexMap(state.data.mapHexes, state.game, tileIndex)}
              </section>
              ${renderWarehousePanel(state.game, {
                id: "",
                title: "Warehouse",
                className: "map-warehouse-panel map-warehouse-rail is-right",
                resources: MAP_WAREHOUSE_RAILS[1],
                ariaLabel: "Warehouse resources: Food, Herbs, Goods"
              })}
            </div>
          </div>
        </section>
        ${renderTableWorkspace(state.game, tileIndex, encounterIndex)}
        ${renderGameDashboard(state.game, encounterIndex)}
        ${
          state.blindTestMode
            ? ""
            : `<section class="play-bottom-tools" aria-label="Automated analysis tools">
                ${renderSimulationPanel()}
              </section>`
        }
      </section>
      ${renderSiteFooter()}
      ${renderMapContextLayer(state.game, tileIndex)}
      ${renderSeedCardContextLayer(encounterIndex)}
    </main>
  `;

  bindEvents();
  restoreTileTrayScroll();
  saveLocalPlaytestState();
}

function placeOpeningTileAtCoordinate(coordinate) {
  if (!state.data || !state.game) {
    return false;
  }

  const openingRequirement = getOpeningPlacementRequirementForActivePlayer(state.game);

  if (!openingRequirement) {
    return false;
  }

  const tileIndex = createTileIndex(state.data.tiles);
  const openingOption = getOpeningPlacementOptionsForCoordinate(state.game, tileIndex, coordinate).find(
    (option) => !option.blockedReason
  );

  if (!openingOption) {
    return false;
  }

  placeTileFromContext(
    openingOption.tile.tile_id,
    coordinate,
    openingOption.orientation,
    openingOption.placementCostReductionResources
  );
  return true;
}

function placeStewardHouseAtCoordinate(coordinate) {
  if (!state.data || !state.game) {
    return false;
  }

  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult(TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE);
    renderApp();
    return false;
  }

  const pending = getStewardHousePlacementRequirementForActivePlayer(state.game);

  if (!pending) {
    return false;
  }

  const tileIndex = createTileIndex(state.data.tiles);
  const option = getStewardHousePlacementOptionsForCoordinate(state.game, tileIndex, coordinate)[0] ?? null;

  if (!option) {
    return false;
  }

  const outcome = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.PLACE_STEWARD_HOUSE,
      tileId: pending.tileId,
      coordinate
    },
    { tiles: state.data.tiles }
  );

  applyGameOutcome(outcome.state, outcome.result);
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.selectedCoordinate = coordinate;
  syncSelectedTile();
  renderApp();
  return outcome.result.ok;
}

function selectCoordinate(coordinate, options = {}) {
  if (options.placePending === true && state.pendingPairedPlacement) {
    completePendingPairedPlacement(coordinate);
    return;
  }

  const shouldPlacePendingPreview =
    options.placePending === true &&
    state.pendingPlacementPreview?.tileId === state.selectedTileId &&
    state.pendingPlacementPreview?.coordinate === coordinate;

  if (shouldPlacePendingPreview) {
    placeSelectedTile();
    return;
  }

  if (options.placePending === true && placeOpeningTileAtCoordinate(coordinate)) {
    return;
  }

  if (options.placePending === true && placeStewardHouseAtCoordinate(coordinate)) {
    return;
  }

  state.selectedCoordinate = coordinate;
  state.contextMenu = null;
  state.seedContextMenu = null;

  if (state.pendingPlacementPreview?.coordinate !== coordinate) {
    state.pendingPlacementPreview = null;
  }

  renderApp();
}

function rotateSelectedPlacementTileAt(coordinate) {
  const tileIndex = createTileIndex(state.data.tiles);
  const selectedTile = getSelectedPlacementTile(tileIndex);

  state.selectedCoordinate = coordinate;
  state.contextMenu = null;
  state.seedContextMenu = null;
  if (state.pendingPlacementPreview?.tileId === selectedTile?.tile_id) {
    state.pendingPlacementPreview = {
      ...state.pendingPlacementPreview,
      coordinate
    };
  }

  if (!selectedTile || Number(selectedTile.size_hexes ?? 1) <= 1) {
    renderApp();
    return;
  }

  state.selectedOrientation = getNextOrientation(state.selectedOrientation);
  state.lastActionResult = {
    ok: true,
    action: "ROTATE_TILE_PREVIEW",
    message: `${selectedTile.tile_name} preview rotated to ${getOrientationLabel(state.selectedOrientation)} at ${coordinate}.`
  };
  renderApp();
}

function openMapContextMenu(event, coordinate) {
  const placedTile = getPlacedTileAt(state.game, coordinate);
  const tileIndex = createTileIndex(state.data.tiles);
  const selectedTile = getSelectedPlacementTile(tileIndex);
  const shouldRotatePendingPreview =
    !placedTile &&
    state.pendingPlacementPreview?.coordinate === coordinate &&
    state.pendingPlacementPreview?.tileId === selectedTile?.tile_id &&
    selectedPlacementTileCanRotate(tileIndex);

  event.preventDefault();

  if (shouldRotatePendingPreview) {
    rotateSelectedPlacementTileAt(coordinate);
    return;
  }

  state.selectedCoordinate = coordinate;
  state.seedContextMenu = null;

  if (placedTile) {
    state.contextMenu = {
      x: event.clientX,
      y: event.clientY,
      coordinate,
      placedTileId: placedTile.id
    };
    renderApp();
    return;
  }

  state.contextMenu = {
    x: event.clientX,
    y: event.clientY,
    coordinate,
    placedTileId: null
  };
  renderApp();
}

function closeMapContextMenu() {
  state.contextMenu = null;
  state.seedContextMenu = null;
  renderApp();
}

function openSeedCardContextMenu(event, playerId, cardId) {
  event.preventDefault();
  state.contextMenu = null;
  state.seedContextMenu = {
    x: event.clientX,
    y: event.clientY,
    playerId,
    cardId
  };
  renderApp();
}

function closeSeedContextMenu() {
  state.seedContextMenu = null;
  renderApp();
}

function hasTransientActionState() {
  return Boolean(state.pendingPlacementPreview || state.pendingPairedPlacement || state.contextMenu || state.seedContextMenu);
}

function clearTransientActionState({ quiet = false, message = "Cancelled current action." } = {}) {
  if (!hasTransientActionState()) {
    return false;
  }

  state.pendingPlacementPreview = null;
  state.pendingPairedPlacement = null;
  state.contextMenu = null;
  state.seedContextMenu = null;

  if (!quiet) {
    state.lastActionResult = {
      ok: true,
      action: "CANCEL_CURRENT_ACTION",
      message
    };
  }

  return true;
}

function toggleTileFacePreview(tileId) {
  rememberTileTrayScroll();
  state.tileFacePreviewSides = {
    ...state.tileFacePreviewSides,
    [tileId]: getTileFacePreviewSide(tileId) === "upgrade" ? "front" : "upgrade"
  };
  renderApp();
}

function selectSeedCardPosition(playerId, cardId, seedPosition) {
  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("SELECT_SEED_CARD");
    state.seedContextMenu = null;
    renderApp();
    return;
  }

  const player = state.game?.players.find((candidate) => candidate.id === playerId);
  const currentSelections = player ? getRawSeedSelectionMap(player) : {};
  const nextPlayerSelections = Object.fromEntries(
    Object.entries(currentSelections).filter(([, selectedCardId]) => selectedCardId !== cardId)
  );
  nextPlayerSelections[seedPosition] = cardId;
  state.debugSeedSelections = {
    ...state.debugSeedSelections,
    [playerId]: nextPlayerSelections
  };
  state.debugSeedPosition = seedPosition;
  state.seedContextMenu = null;
  state.lastActionResult = {
    ok: true,
    action: "SELECT_SEED_CARD",
    message: `Selected ${getEncounterCardName(cardId)} for ${getPlayerName(playerId)}; ${getShortSeedPositionLabel(seedPosition)} seed slot.`
  };
  renderApp();
}

function getPlayerName(playerId) {
  const player = state.game?.players.find((candidate) => candidate.id === playerId);
  return player ? formatPlayerName(player) : playerId;
}

function getEncounterCardName(cardId) {
  return state.data?.encounterCards.find((card) => card.card_id === cardId)?.card_name ?? cardId;
}

function upgradePlacedTile(placedTileId) {
  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("UPGRADE_TILE");
    state.contextMenu = null;
    renderApp();
    return;
  }

  const placedTile = state.game.map.placedTiles.find((candidate) => candidate.id === placedTileId);
  const tileIndex = createTileIndex(state.data.tiles);
  const tileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const upgradeTile = tileDefinition ? findUpgradeTile(tileDefinition, tileIndex) : null;
  const upgradeCostChoiceResources =
    placedTile && upgradeTile ? getUpgradeCostChoiceAction(placedTile.id, upgradeTile.upgrade_cost) : [];
  const upgradeCost = upgradeTile ? parseResourceCostForDisplay(upgradeTile.upgrade_cost, upgradeCostChoiceResources) : null;
  const upgradeResourceDiscount = getPendingUpgradeResourceDiscount(state.game, tileDefinition);
  const activePlayer = state.game.players.find((player) => player.id === state.game.activePlayerId);
  const baseUpgradeActionCost = placedTile
    ? calculatePlacedTileActionCost(
        state.game,
        placedTile,
        { tileIndex, playerId: activePlayer?.id ?? state.game.activePlayerId },
        "upgradeActionCost"
      )
    : null;
  const upgradeStewardPowerProviders = upgradeTile
    ? getUpgradeStewardPowerProviders(state.game, tileDefinition, tileIndex, baseUpgradeActionCost)
    : [];
  const stewardPowerPlacedTileId = getSelectedStewardPowerId(
    state.stewardUpgradePowerId,
    upgradeStewardPowerProviders
  );
  const { state: nextGame, result } = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.UPGRADE_TILE,
      placedTileId: placedTile?.id,
      stewardPowerPlacedTileId,
      upgradeCostChoiceResources,
      upgradeCostReductionResources:
        placedTile && upgradeCost && !upgradeCost.error
          ? getUpgradeCostDiscountAction(placedTile.id, upgradeCost.cost, upgradeResourceDiscount)
          : []
    },
    { tiles: state.data.tiles }
  );

  applyGameOutcome(nextGame, result);
  state.contextMenu = null;

  if (result.ok && placedTile) {
    delete state.upgradeCostChoices[placedTile.id];
    delete state.upgradeCostDiscounts[placedTile.id];
    state.stewardUpgradePowerId = "";
  }

  renderApp();
}

function activatePlacedTile(placedTileId) {
  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("ACTIVATE_TILE");
    state.contextMenu = null;
    renderApp();
    return;
  }

  const placedTile = state.game.map.placedTiles.find((candidate) => candidate.id === placedTileId);
  const tileIndex = createTileIndex(state.data.tiles);
  const tileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  let targetPlacedTileId;
  let targetPlacedTileIds;
  let targetActiveEncounterId;
  let payment;
  let gains;

  try {
    const activationDetails = tileDefinition ? getActivationDetails(tileDefinition) : null;

    if (activationDetails?.type === "remove_strain_adjacent") {
      const maxTargets = activationDetails.maxTargets ?? 1;
      const targetCandidates = getStrainActivationTargetCandidates(state.game, tileIndex, placedTile, activationDetails);
      const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
      const validSavedTargetIds = savedTargetIds.filter((targetId) =>
        targetCandidates.some((candidate) => candidate.id === targetId)
      );
      targetPlacedTileIds = (
        validSavedTargetIds.length ? validSavedTargetIds : targetCandidates.slice(0, 1).map((candidate) => candidate.id)
      ).slice(0, maxTargets);
      targetPlacedTileId = targetPlacedTileIds[0];
    }

    if (activationDetails?.type === "give_supported_adjacent") {
      const maxTargets = activationDetails.maxTargets ?? 1;
      const targetCandidates = getSupportActivationTargetCandidates(
        state.game,
        tileIndex,
        placedTile,
        activationDetails
      );
      const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
      const validSavedTargetIds = savedTargetIds.filter((targetId) =>
        targetCandidates.some((candidate) => candidate.id === targetId)
      );
      targetPlacedTileIds = (
        validSavedTargetIds.length ? validSavedTargetIds : targetCandidates.slice(0, 1).map((candidate) => candidate.id)
      ).slice(0, maxTargets);
      targetPlacedTileId = targetPlacedTileIds[0];
    }

    if (activationDetails?.type === "add_arrival_timer") {
      const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
      const targetCandidates = state.game.encounter.active.filter((activeEncounter) => {
        const timerMax = state.game.rules.arrivalTimerMax ?? 3;
        const currentTimerTokens = Number(
          activeEncounter.timerTokens ?? state.game.rules.arrivalStartTimerTokens ?? 3
        );

        return (
          activeEncounter.encounterType === ENCOUNTER_TYPES.ARRIVAL &&
          !activeEncounter.completed &&
          currentTimerTokens < timerMax
        );
      });
      targetActiveEncounterId = targetCandidates.some((candidate) => candidate.id === savedTargetIds[0])
        ? savedTargetIds[0]
        : targetCandidates[0]?.id;
    }

    if (activationDetails?.type === "resolve_active_burden") {
      const savedTargetIds = normalizeActivationTargetIds(state.activationTargets[placedTile.id]);
      const targetCandidates = state.game.encounter.active.filter(
        (activeEncounter) => activeEncounter.encounterType === ENCOUNTER_TYPES.BURDEN && !activeEncounter.resolved
      );
      targetActiveEncounterId = targetCandidates.some((candidate) => candidate.id === savedTargetIds[0])
        ? savedTargetIds[0]
        : targetCandidates[0]?.id;
    }

    if (activationDetails?.type === "resource_exchange") {
      payment = getActivationPaymentAction(placedTile.id);
    }

    if (activationDetails?.type === "flexible_resource_exchange") {
      payment = getActivationPaymentAction(placedTile.id);
      gains = getResourcePaymentAction(state.activationGains[placedTile.id] ?? []);
    }
  } catch {
    targetPlacedTileId = undefined;
    targetPlacedTileIds = undefined;
    targetActiveEncounterId = undefined;
    payment = undefined;
    gains = undefined;
  }

  const { state: nextGame, result } = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.ACTIVATE_TILE,
      placedTileId: placedTile?.id,
      targetPlacedTileId,
      targetPlacedTileIds,
      targetActiveEncounterId,
      payment,
      gains,
      stewardPowerPlacedTileId: state.stewardActivationPowerId
    },
    { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
  );

  applyGameOutcome(nextGame, result);
  state.contextMenu = null;

  if (result.ok && placedTile) {
    const activationTargets = { ...state.activationTargets };
    delete activationTargets[placedTile.id];
    state.activationTargets = activationTargets;
    const activationPayments = { ...state.activationPayments };
    delete activationPayments[placedTile.id];
    state.activationPayments = activationPayments;
    const activationGains = { ...state.activationGains };
    delete activationGains[placedTile.id];
    state.activationGains = activationGains;
    const activationExchangeAmounts = { ...state.activationExchangeAmounts };
    delete activationExchangeAmounts[placedTile.id];
    state.activationExchangeAmounts = activationExchangeAmounts;
    state.stewardActivationPowerId = "";
  }

  renderApp();
}

function startPendingPairedPlacement(tileId, coordinate, orientation, placementCostReductionResources = []) {
  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("PLACE_TILE");
    state.contextMenu = null;
    renderApp();
    return;
  }

  const tile = state.data.tiles.find((candidate) => candidate.tile_id === tileId);
  const action = {
    type: TILE_ACTION_TYPES.PLACE_TILE,
    tileId,
    coordinate,
    orientation: orientation || HEX_DIRECTIONS[0].id,
    placementCostReductionResources
  };
  const validation = validatePlaceTile(state.game, action, { tiles: state.data.tiles });

  state.selectedTileId = tileId;
  state.selectedCoordinate = coordinate;
  state.selectedOrientation = orientation || HEX_DIRECTIONS[0].id;
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.pendingPlacementPreview = null;

  if (!validation.valid) {
    state.lastActionResult = {
      ok: false,
      action: TILE_ACTION_TYPES.PLACE_TILE,
      errors: validation.errors
    };
    renderApp();
    return;
  }

  state.pendingPairedPlacement = {
    tileId,
    coordinate,
    orientation: orientation || HEX_DIRECTIONS[0].id,
    placementCostReductionResources
  };
  state.lastActionResult = {
    ok: true,
    action: "SELECT_PAIRED_PLACEMENT",
    message: `${tile?.tile_name ?? "Stables"} first site selected at ${coordinate}. Choose the second site to place both for one action.`
  };
  renderApp();
}

function completePendingPairedPlacement(coordinate) {
  const pending = state.pendingPairedPlacement;

  if (!pending) {
    return false;
  }

  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("PLACE_TILE");
    state.contextMenu = null;
    renderApp();
    return false;
  }

  const { state: nextGame, result } = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: pending.tileId,
      coordinate: pending.coordinate,
      pairedCoordinate: coordinate,
      orientation: pending.orientation,
      pairedOrientation: HEX_DIRECTIONS[0].id,
      stewardPowerPlacedTileId: state.stewardPlacementPowerId,
      placementCostReductionResources: pending.placementCostReductionResources ?? []
    },
    { tiles: state.data.tiles }
  );

  applyGameOutcome(nextGame, result);
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.selectedTileId = pending.tileId;
  state.selectedCoordinate = coordinate;
  state.selectedOrientation = pending.orientation;

  if (result.ok) {
    delete state.placementCostDiscounts[pending.tileId];
    state.stewardPlacementPowerId = "";
    state.pendingPairedPlacement = null;
    state.pendingPlacementPreview = null;
  }

  syncSelectedTile();
  renderApp();
  return result.ok;
}

function placeSelectedTile() {
  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("PLACE_TILE");
    state.contextMenu = null;
    renderApp();
    return;
  }

  const tile = state.data.tiles.find((candidate) => candidate.tile_id === state.selectedTileId);
  const placementCostChoiceResources = tile
    ? getPlacementCostChoiceAction(tile.tile_id, tile.place_cost)
    : [];

  if (isStablesTile(tile)) {
    if (state.pendingPairedPlacement?.tileId === tile.tile_id) {
      completePendingPairedPlacement(state.selectedCoordinate);
    } else {
      startPendingPairedPlacement(
        tile.tile_id,
        state.selectedCoordinate,
        HEX_DIRECTIONS[0].id,
        getPlacementCostDiscountAction(
          tile.tile_id,
          parseResourceCostForDisplay(tile.place_cost, placementCostChoiceResources).cost,
          getPendingPlacementResourceDiscount(state.game, tile)
        )
      );
    }
    return;
  }

  const cost = tile ? parseResourceCostForDisplay(tile.place_cost, placementCostChoiceResources).cost : [];
  const placementResourceDiscount = getPendingPlacementResourceDiscount(state.game, tile);
  const tileIndex = createTileIndex(state.data.tiles);
  const footprint = tile
    ? getFootprintCoordinates(state.selectedCoordinate, tile.size_hexes, state.selectedOrientation, state.game.map.hexes)
    : null;
  const baseActionCost = footprint
    ? calculateBasePlacementActionCostForUi(state.game, tile, footprint, tileIndex)
    : null;
  const actionCost =
    baseActionCost && tile
      ? getDiscountedDisconnectedTravelActionCost(
          state.game,
          "placement",
          getDiscountedTileActionCost(state.game, tile, "placement", baseActionCost).actionCost
        ).actionCost
      : null;
  const placementStewardPowerProviders = getPlacementStewardPowerProviders(
    state.game,
    tile,
    actionCost,
    tileIndex
  );
  const stewardPowerPlacedTileId = getSelectedStewardPowerId(
    state.stewardPlacementPowerId,
    placementStewardPowerProviders
  );
  const { state: nextGame, result } = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.PLACE_TILE,
      tileId: state.selectedTileId,
      coordinate: state.selectedCoordinate,
      orientation: state.selectedOrientation,
      stewardPowerPlacedTileId,
      placementCostChoiceResources,
      placementCostReductionResources: getPlacementCostDiscountAction(
        state.selectedTileId,
        cost,
        placementResourceDiscount
      )
    },
    { tiles: state.data.tiles }
  );

  applyGameOutcome(nextGame, result);
  state.contextMenu = null;

  if (result.ok) {
    delete state.placementCostChoices[state.selectedTileId];
    delete state.placementCostDiscounts[state.selectedTileId];
    state.stewardPlacementPowerId = "";
    state.pendingPlacementPreview = null;
  }

  syncSelectedTile();
  renderApp();
}

function placeTileFromContext(
  tileId,
  coordinate,
  orientation,
  placementCostReductionResources = [],
  placementCostChoiceResources = []
) {
  const tile = state.data.tiles.find((candidate) => candidate.tile_id === tileId);
  const placementCostDiscounts = { ...state.placementCostDiscounts };
  const placementCostChoices = { ...state.placementCostChoices };

  state.selectedTileId = tileId;
  state.selectedCoordinate = coordinate;
  state.selectedOrientation = orientation || HEX_DIRECTIONS[0].id;
  state.stewardPlacementPowerId = "";

  if (placementCostReductionResources.length > 0) {
    placementCostDiscounts[tileId] = placementCostReductionResources;
  } else {
    delete placementCostDiscounts[tileId];
  }

  state.placementCostDiscounts = placementCostDiscounts;

  if (placementCostChoiceResources.length > 0) {
    placementCostChoices[tileId] = placementCostChoiceResources;
  } else {
    delete placementCostChoices[tileId];
  }

  state.placementCostChoices = placementCostChoices;

  if (isStablesTile(tile)) {
    startPendingPairedPlacement(tileId, coordinate, HEX_DIRECTIONS[0].id, placementCostReductionResources);
    return;
  }

  if (hasResourceCostChoices(tile?.place_cost)) {
    state.contextMenu = null;
    state.seedContextMenu = null;
    state.lastActionResult = {
      ok: true,
      action: "SELECT_TILE_COST_CHOICE",
      message: `${tile?.tile_name ?? "Tile"} selected at ${coordinate}. Choose which resource to spend, then press Place.`
    };
    renderApp();
    return;
  }

  placeSelectedTile();
}

function selectTilePreviewFromContext(
  tileId,
  coordinate,
  orientation,
  placementCostReductionResources = [],
  placementCostChoiceResources = []
) {
  const tile = state.data.tiles.find((candidate) => candidate.tile_id === tileId);
  const placementCostDiscounts = { ...state.placementCostDiscounts };
  const placementCostChoices = { ...state.placementCostChoices };

  state.selectedTileId = tileId;
  state.selectedCoordinate = coordinate;
  state.selectedOrientation = orientation || HEX_DIRECTIONS[0].id;
  state.stewardPlacementPowerId = "";
  state.contextMenu = null;
  state.seedContextMenu = null;
  state.pendingPlacementPreview = {
    tileId,
    coordinate
  };

  if (placementCostReductionResources.length > 0) {
    placementCostDiscounts[tileId] = placementCostReductionResources;
  } else {
    delete placementCostDiscounts[tileId];
  }

  state.placementCostDiscounts = placementCostDiscounts;

  if (placementCostChoiceResources.length > 0) {
    placementCostChoices[tileId] = placementCostChoiceResources;
  } else {
    delete placementCostChoices[tileId];
  }

  state.placementCostChoices = placementCostChoices;

  if (isStablesTile(tile)) {
    startPendingPairedPlacement(tileId, coordinate, HEX_DIRECTIONS[0].id, placementCostReductionResources);
    return;
  }

  state.lastActionResult = {
    ok: true,
    action: "SELECT_TILE_PREVIEW",
    message: `${tile?.tile_name ?? "Tile"} preview selected at ${coordinate}. Rotate or cancel in the Current Action panel, then left-click the preview hex or press Place.`
  };
  renderApp();
}

function cancelPendingPlacementPreview() {
  const message = state.pendingPairedPlacement ? "Stables placement cancelled." : "Tile placement preview cancelled.";

  if (clearTransientActionState({ message })) {
    renderApp();
  }
}

function handleGlobalEscape(event) {
  if (event.key !== "Escape" || !hasTransientActionState()) {
    return;
  }

  event.preventDefault();
  clearTransientActionState();
  renderApp();
}

function handleRootClickAwayFromPlacementPreview(event) {
  if (!state.pendingPlacementPreview) {
    return;
  }

  const target = event.target;

  if (
    !(target instanceof Element) ||
    target.closest("#map-panel, #placement-panel, .map-context-menu")
  ) {
    return;
  }

  if (clearTransientActionState({ quiet: true })) {
    renderApp();
  }
}

function runMapContextAction(actionName) {
  const placedTileId = state.contextMenu?.placedTileId;

  if (actionName === "place") {
    placeSelectedTile();
    return;
  }

  if (actionName === "rotate") {
    rotateSelectedPlacementTileAt(state.contextMenu?.coordinate ?? state.selectedCoordinate);
    return;
  }

  if (actionName === "cancel-preview") {
    cancelPendingPlacementPreview();
    return;
  }

  if (actionName === "place-paired-stables") {
    completePendingPairedPlacement(state.contextMenu?.coordinate ?? state.selectedCoordinate);
    return;
  }

  if (!placedTileId) {
    closeMapContextMenu();
    return;
  }

  if (actionName === "upgrade") {
    upgradePlacedTile(placedTileId);
    return;
  }

  if (actionName === "activate") {
    activatePlacedTile(placedTileId);
    return;
  }

  closeMapContextMenu();
}

function runQuickAction(actionName) {
  let outcome = null;

  if (actionName === "start-game") {
    startPlaySession();
    return;
  }

  if (actionName === "end-game") {
    endPlaySession();
    return;
  }

  if (actionName === "reset-game") {
    resetPlaySession();
    return;
  }

  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult(actionName);
    renderApp();
    return;
  }

  if (actionName === "seed") {
    outcome = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        seedSelectionsByPosition: getDebugSeedSelectionsForAction(state.game)
      },
      { tiles: state.data.tiles }
    );

    if (outcome.result.ok) {
      state.debugSeedSelections = {};
      state.seedContextMenu = null;
    }
  }

  if (actionName === "reveal") {
    outcome = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );
  }

  if (actionName === "end-turn") {
    outcome = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.END_TURN
      },
      { tiles: state.data.tiles }
    );
  }

  if (actionName === "end-round") {
    outcome = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.END_ROUND
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );
  }

  if (!outcome) {
    return;
  }

  applyGameOutcome(outcome.state, outcome.result);
  syncSelectedTile();
  renderApp();
}

function runCurrentAction(actionName) {
  if (actionName === "place-placement-preview") {
    placeSelectedTile();
    return;
  }

  if (actionName === "rotate-placement-preview") {
    rotateSelectedPlacementTileAt(state.selectedCoordinate);
    return;
  }

  if (actionName === "cancel-placement-preview") {
    cancelPendingPlacementPreview();
    return;
  }

  runQuickAction(actionName);
}

function focusPlayArea(selector) {
  if (!selector) {
    return;
  }

  const element = root.querySelector(selector);

  if (!element) {
    return;
  }

  if (element instanceof HTMLDetailsElement) {
    element.open = true;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function runQuartermasterStartingExchange(playerId) {
  if (!isPlaySessionPlaying()) {
    setBlockedPlaySessionResult("USE_STEWARD_POWER");
    renderApp();
    return;
  }

  const exchangeKey = getQuartermasterStartingExchangeKey(playerId);
  const { state: nextGame, result } = dispatchGameAction(
    state.game,
    {
      type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
      stewardPowerType: STEWARD_POWER_TYPES.STARTING_RESOURCE_EXCHANGE,
      playerId,
      payment: getResourcePaymentAction(state.stewardExchangePayments[exchangeKey] ?? []),
      gains: getResourcePaymentAction(state.stewardExchangeGains[exchangeKey] ?? [])
    },
    { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
  );

  applyGameOutcome(nextGame, result);

  if (result.ok) {
    const stewardExchangePayments = { ...state.stewardExchangePayments };
    delete stewardExchangePayments[exchangeKey];
    state.stewardExchangePayments = stewardExchangePayments;
    const stewardExchangeGains = { ...state.stewardExchangeGains };
    delete stewardExchangeGains[exchangeKey];
    state.stewardExchangeGains = stewardExchangeGains;
    const stewardExchangeAmounts = { ...state.stewardExchangeAmounts };
    delete stewardExchangeAmounts[exchangeKey];
    state.stewardExchangeAmounts = stewardExchangeAmounts;
  }

  renderApp();
}

function runStewardMenuAction(button) {
  const command = button.dataset.stewardMenuAction ?? "";
  const providerId = button.dataset.stewardMenuProviderId ?? "";
  const target = button.dataset.stewardMenuTarget ?? "";

  if (command === "use-quartermaster-starting-exchange") {
    runQuartermasterStartingExchange(button.dataset.stewardMenuPlayerId ?? "");
    return;
  }

  if (command === "suppress-burden") {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("USE_STEWARD_POWER");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        stewardPowerType: STEWARD_POWER_TYPES.SUPPRESS_BURDEN,
        activeEncounterId: button.dataset.stewardMenuActiveEncounterId,
        placedTileId: providerId
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );

    applyGameOutcome(nextGame, result);
    renderApp();
    return;
  }

  if (command === "open-setup") {
    state.openHeaderMenu = HEADER_MENUS.SETUP;
    renderApp();
    return;
  }

  if (command === "select-placement-power") {
    state.stewardPlacementPowerId = providerId;
  }

  if (command === "select-upgrade-power") {
    state.stewardUpgradePowerId = providerId;
  }

  if (command === "select-activation-power") {
    state.stewardActivationPowerId = providerId;
  }

  if (command.startsWith("select-")) {
    renderApp();
    requestAnimationFrame(() => focusPlayArea(target));
    return;
  }

  focusPlayArea(target);
}

function bindHeaderMenuEvents() {
  root.querySelectorAll("[data-header-menu]").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.isConnected) {
        return;
      }

      const menuId = menu.dataset.headerMenu ?? "";

      if (menu.open) {
        state.openHeaderMenu = menuId;
        root.querySelectorAll("[data-header-menu]").forEach((candidate) => {
          if (candidate !== menu && candidate.open) {
            candidate.open = false;
          }
        });
        return;
      }

      if (state.openHeaderMenu === menuId) {
        state.openHeaderMenu = "";
      }
    });
  });
}

function closeOpenHeaderMenu() {
  if (!state.openHeaderMenu) {
    return false;
  }

  state.openHeaderMenu = "";
  root.querySelectorAll("[data-header-menu][open]").forEach((menu) => {
    menu.open = false;
  });
  return true;
}

function handleHeaderMenuClickAway(event) {
  if (!state.openHeaderMenu) {
    return;
  }

  const target = event.target;

  if (target instanceof Element && target.closest("[data-header-menu]")) {
    return;
  }

  closeOpenHeaderMenu();
}

function bindEvents() {
  bindHeaderMenuEvents();

  root.querySelectorAll("[data-coordinate]").forEach((element) => {
    const placePending = element.classList.contains("hex");

    element.addEventListener("click", () => selectCoordinate(element.dataset.coordinate, { placePending }));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCoordinate(element.dataset.coordinate, { placePending });
      }
    });
  });

  root.querySelectorAll(".hex[data-coordinate]").forEach((element) => {
    element.addEventListener("contextmenu", (event) => openMapContextMenu(event, element.dataset.coordinate));
  });

  root.querySelector(".map-context-backdrop")?.addEventListener("click", closeMapContextMenu);
  root.querySelector(".seed-context-backdrop")?.addEventListener("click", closeSeedContextMenu);

  root.querySelectorAll("[data-context-action]").forEach((button) => {
    button.addEventListener("click", () => runMapContextAction(button.dataset.contextAction));
  });

  root.querySelectorAll("[data-context-place-tile-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const costChoiceResources = (button.dataset.contextPlaceCostChoices ?? "").split("|").filter(Boolean);
      const discountResources = (button.dataset.contextPlaceDiscounts ?? "").split("|").filter(Boolean);

      placeTileFromContext(
        button.dataset.contextPlaceTileId,
        button.dataset.contextPlaceCoordinate,
        button.dataset.contextPlaceOrientation,
        discountResources,
        costChoiceResources
      );
    });
  });

  root.querySelectorAll("[data-context-place-steward-house-coordinate]").forEach((button) => {
    button.addEventListener("click", () => {
      placeStewardHouseAtCoordinate(button.dataset.contextPlaceStewardHouseCoordinate);
    });
  });

  root.querySelectorAll("[data-context-select-tile-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const costChoiceResources = (button.dataset.contextSelectCostChoices ?? "").split("|").filter(Boolean);
      const discountResources = (button.dataset.contextSelectDiscounts ?? "").split("|").filter(Boolean);

      selectTilePreviewFromContext(
        button.dataset.contextSelectTileId,
        button.dataset.contextSelectCoordinate,
        button.dataset.contextSelectOrientation,
        discountResources,
        costChoiceResources
      );
    });
  });

  root.querySelectorAll("[data-seed-hand-card]").forEach((cardElement) => {
    cardElement.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-seed-position]")) {
        return;
      }

      const player = state.game?.players.find((candidate) => candidate.id === cardElement.dataset.playerId);
      selectSeedCardPosition(
        cardElement.dataset.playerId,
        cardElement.dataset.cardId,
        player ? getNextSeasonalSeedPosition(state.game, player) : SEED_PACKET_POSITIONS.TOP
      );
    });
    cardElement.addEventListener("contextmenu", (event) =>
      openSeedCardContextMenu(event, cardElement.dataset.playerId, cardElement.dataset.cardId)
    );
    cardElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const player = state.game?.players.find((candidate) => candidate.id === cardElement.dataset.playerId);
        selectSeedCardPosition(
          cardElement.dataset.playerId,
          cardElement.dataset.cardId,
          player ? getNextSeasonalSeedPosition(state.game, player) : SEED_PACKET_POSITIONS.TOP
        );
      }
    });
  });

  root.querySelectorAll("[data-seed-position]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectSeedCardPosition(button.dataset.seedPlayerId, button.dataset.seedCardId, button.dataset.seedPosition)
    });
  });

  root.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", () => runQuickAction(button.dataset.quickAction));
  });

  root.querySelectorAll("[data-current-action]").forEach((button) => {
    button.addEventListener("click", () => runCurrentAction(button.dataset.currentAction));
  });

  root.querySelectorAll("[data-workspace-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isValidTableWorkspace(button.dataset.workspaceTab)) {
        return;
      }

      rememberTileTrayScroll();
      state.activeWorkspace = button.dataset.workspaceTab;
      state.contextMenu = null;
      state.seedContextMenu = null;
      renderApp();
    });
  });

  root.querySelectorAll("[data-steward-menu-action]").forEach((button) => {
    button.addEventListener("click", () => runStewardMenuAction(button));
  });

  root.querySelector("#simulation-bot-profile")?.addEventListener("change", (event) => {
    state.simulation = {
      ...state.simulation,
      botProfile: event.target.value,
      message: ""
    };
    renderApp();
  });

  root.querySelector("#simulation-player-count")?.addEventListener("change", (event) => {
    state.simulation = {
      ...state.simulation,
      playerCount: event.target.value,
      message: ""
    };
    renderApp();
  });

  root.querySelector("#run-simulations")?.addEventListener("click", runAutomatedSimulationsFromUi);
  root.querySelector("#export-simulation-csv")?.addEventListener("click", exportSimulationCsv);
  root.querySelector("#export-simulation-json")?.addEventListener("click", exportSimulationJson);

  root.querySelector("#player-count")?.addEventListener("change", (event) => {
    if (!isPlaySessionSetup()) {
      return;
    }

    state.playerCount = Number(event.target.value);
    syncStewardRoleIds();
    createGame();
    renderApp();
  });

  root.querySelectorAll(".setup-steward-role").forEach((select) => {
    select.addEventListener("change", (event) => {
      if (!isPlaySessionSetup()) {
        return;
      }

      const playerIndex = Number(event.target.dataset.playerIndex);
      const roleIds = normalizeStewardRoleIds(state.playerCount, state.stewardRoleIds);

      roleIds[playerIndex] = event.target.value;
      state.stewardRoleIds = normalizeStewardRoleIds(state.playerCount, roleIds);
      createGame();
      renderApp();
    });
  });

  root.querySelector("#setup-seed")?.addEventListener("input", (event) => {
    if (!isPlaySessionSetup()) {
      return;
    }

    state.setupSeed = event.target.value;
  });

  root.querySelector("#start-game")?.addEventListener("click", startPlaySession);
  root.querySelector("#end-game")?.addEventListener("click", endPlaySession);
  root.querySelector("#reset-game")?.addEventListener("click", resetPlaySession);

  root.querySelector("#redeal-cards")?.addEventListener("click", () => {
    if (!isPlaySessionSetup()) {
      setBlockedPlaySessionResult("REDEAL_CARDS");
      renderApp();
      return;
    }

    state.setupSeed = createRedealSeed();
    createGame();
    state.lastActionResult = {
      ok: true,
      action: "REDEAL_CARDS",
      message: "Redealt Encounter hands and deck for a fresh playtest."
    };
    renderApp();
  });

  root.querySelector("#tile-orientation")?.addEventListener("change", (event) => {
    state.selectedOrientation = event.target.value;
    state.lastActionResult = null;
    renderApp();
  });

  root.querySelector("#rotate-placement-preview")?.addEventListener("click", () => {
    rotateSelectedPlacementTileAt(state.selectedCoordinate);
  });

  root.querySelector("#cancel-placement-preview")?.addEventListener("click", cancelPendingPlacementPreview);

  root.querySelector("#place-tile")?.addEventListener("click", placeSelectedTile);

  root.querySelectorAll(".tile-wire-select").forEach((button) => {
    button.addEventListener("click", () => {
      rememberTileTrayScroll();
      state.selectedTileId = button.dataset.tileChoiceId;
      state.pendingPlacementPreview = null;
      state.pendingPairedPlacement = null;
      state.lastActionResult = null;
      renderApp();
    });
  });

  root.querySelector(".tile-tray")?.addEventListener("scroll", (event) => {
    state.tileTrayScrollTop = event.currentTarget.scrollTop;
  });

  root.querySelectorAll("[data-tile-flip-id]").forEach((button) => {
    button.addEventListener("click", () => toggleTileFacePreview(button.dataset.tileFlipId));
  });

  root.querySelector("#steward-placement-power")?.addEventListener("change", (event) => {
    state.stewardPlacementPowerId = event.target.value;
    renderApp();
  });

  root.querySelector("#fill-warehouse")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("DEBUG_FILL_WAREHOUSE");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#undo-last-action")?.addEventListener("click", undoLastAction);

  root.querySelector("#end-turn")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("END_TURN");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.END_TURN
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#end-round")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("END_ROUND");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.END_ROUND
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#reset-actions")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("DEBUG_RESET_ACTIONS");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#seed-encounters")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("SEED_ENCOUNTERS");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        seedSelectionsByPosition: getDebugSeedSelectionsForAction(state.game)
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    if (result.ok) {
      state.debugSeedSelections = {};
      state.seedContextMenu = null;
    }
    renderApp();
  });

  root.querySelector("#reveal-encounters")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("REVEAL_ENCOUNTERS");
      renderApp();
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelectorAll(".complete-arrival").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("COMPLETE_ARRIVAL");
        renderApp();
        return;
      }

      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
          activeEncounterId: button.dataset.activeEncounterId,
          arrivalRequirementReductionResources: getArrivalRequirementDiscountAction(button.dataset.activeEncounterId)
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      applyGameOutcome(nextGame, result);
      if (result.ok) {
        delete state.arrivalRequirementDiscounts[button.dataset.activeEncounterId];
      }
      renderApp();
    });
  });

  root.querySelectorAll(".arrival-requirement-discount-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const index = Number(select.dataset.discountIndex);
      const choices = [...(state.arrivalRequirementDiscounts[activeEncounterId] ?? [])];
      choices[index] = select.value;
      state.arrivalRequirementDiscounts = {
        ...state.arrivalRequirementDiscounts,
        [activeEncounterId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".resolve-burden-choice").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("RESOLVE_BURDEN_CHOICE");
        renderApp();
        return;
      }

      const activeEncounterId = button.dataset.activeEncounterId;
      const activeState = state.game.encounter.active.find((candidate) => candidate.id === activeEncounterId);
      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.RESOLVE_BURDEN_CHOICE,
          activeEncounterId,
          ...getBurdenChoiceAction(activeState)
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      applyGameOutcome(nextGame, result);
      if (result.ok) {
        delete state.burdenChoiceDecisions[activeEncounterId];
      }
      renderApp();
    });
  });

  root.querySelectorAll(".burden-choice-decision").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const choiceKey = select.dataset.choiceKey;
      state.burdenChoiceDecisions = {
        ...state.burdenChoiceDecisions,
        [activeEncounterId]: {
          ...(state.burdenChoiceDecisions[activeEncounterId] ?? {}),
          [choiceKey]: select.value
        }
      };
      renderApp();
    });
  });

  root.querySelectorAll(".resolve-burden").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("RESOLVE_BURDEN");
        renderApp();
        return;
      }

      const activeEncounterId = button.dataset.activeEncounterId;
      const payment = getBurdenPaymentAction(activeEncounterId);
      const activeState = state.game.encounter.active.find((candidate) => candidate.id === activeEncounterId);
      const card = state.data.encounterCards.find((candidate) => candidate.card_id === activeState?.cardId);
      const burdenResolution = card ? getBurdenResolutionCost(card, state.game.season) : null;
      const burdenResolutionDiscount = getPendingBurdenResolutionDiscount(state.game);
      const discountCost = getBurdenResolutionSelectedCost(activeEncounterId, burdenResolution);
      const tileIndex = createTileIndex(state.data.tiles);
      const burdenStewardPowerProviders = getBurdenStewardPowerProviders(state.game, tileIndex);
      const stewardPowerPlacedTileId = getSelectedStewardPowerId(
        state.stewardBurdenPowerIds[activeEncounterId] ?? "",
        burdenStewardPowerProviders
      );
      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.RESOLVE_BURDEN,
          activeEncounterId,
          payment,
          stewardPowerPlacedTileId,
          burdenResolutionReductionResources: getBurdenResolutionDiscountAction(
            activeEncounterId,
            discountCost,
            burdenResolutionDiscount
          )
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      applyGameOutcome(nextGame, result);
      if (result.ok) {
        delete state.burdenPayments[activeEncounterId];
        delete state.burdenChoiceDecisions[activeEncounterId];
        delete state.burdenResolutionDiscounts[activeEncounterId];
        delete state.stewardBurdenPowerIds[activeEncounterId];
      }
      renderApp();
    });
  });

  root.querySelectorAll(".suppress-burden").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("USE_STEWARD_POWER");
        renderApp();
        return;
      }

      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
          stewardPowerType: STEWARD_POWER_TYPES.SUPPRESS_BURDEN,
          activeEncounterId: button.dataset.activeEncounterId,
          placedTileId: button.dataset.stewardPowerProviderId
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      applyGameOutcome(nextGame, result);
      renderApp();
    });
  });

  root.querySelectorAll(".steward-burden-power").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      state.stewardBurdenPowerIds = {
        ...state.stewardBurdenPowerIds,
        [activeEncounterId]: select.value
      };
      renderApp();
    });
  });

  root.querySelectorAll(".resolve-boon").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("RESOLVE_BOON");
        renderApp();
        return;
      }

      const activeEncounterId = button.dataset.activeEncounterId;
      const activeState = state.game.encounter.active.find((candidate) => candidate.id === activeEncounterId);
      const tileIndex = createTileIndex(state.data.tiles);
      const candidates = activeState?.effect
        ? getBoonStrainReliefCandidates(state.game, tileIndex, activeState.effect)
        : [];
      const targetPlacedTileIds = activeState?.effect
        ? getBoonStrainReliefTargetIds(activeEncounterId, candidates, activeState.effect.maxTargets)
        : [];
      const payment =
        activeState?.effect?.type === "optional_resource_exchange"
          ? getResourcePaymentAction(state.boonExchangePayments[activeEncounterId] ?? [])
          : undefined;
      const gains =
        activeState?.effect?.type === "optional_resource_exchange"
          ? getResourcePaymentAction(state.boonExchangeGains[activeEncounterId] ?? [])
          : activeState?.effect?.type === "steward_help"
            ? getResourcePaymentAction(state.boonStewardHelpGains[activeEncounterId] ?? [])
          : undefined;
      const discardSelections =
        activeState?.effect?.type === "golden_scroll_hand_refresh"
          ? state.goldenScrollDiscards[activeEncounterId] ?? {}
          : undefined;
      const relocations =
        activeState?.effect?.type === "golden_signet_ring_relocate_tiles"
          ? getGoldenSignetRelocations(activeEncounterId)
          : undefined;
      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.RESOLVE_BOON,
          activeEncounterId,
          targetPlacedTileIds,
          payment,
          gains,
          discardSelections,
          relocations
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      applyGameOutcome(nextGame, result);
      if (result.ok) {
        delete state.boonStrainReliefTargets[activeEncounterId];
        delete state.boonExchangePayments[activeEncounterId];
        delete state.boonExchangeGains[activeEncounterId];
        delete state.boonExchangeAmounts[activeEncounterId];
        delete state.boonStewardHelpGains[activeEncounterId];
        delete state.goldenScrollDiscards[activeEncounterId];
        delete state.goldenSignetMoves[activeEncounterId];
      }
      renderApp();
    });
  });

  root.querySelectorAll(".skip-boon").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("SKIP_BOON");
        renderApp();
        return;
      }

      const activeEncounterId = button.dataset.activeEncounterId;
      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.RESOLVE_BOON,
          activeEncounterId,
          skip: true
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      applyGameOutcome(nextGame, result);
      if (result.ok) {
        delete state.boonStrainReliefTargets[activeEncounterId];
        delete state.boonExchangePayments[activeEncounterId];
        delete state.boonExchangeGains[activeEncounterId];
        delete state.boonExchangeAmounts[activeEncounterId];
        delete state.boonStewardHelpGains[activeEncounterId];
        delete state.goldenScrollDiscards[activeEncounterId];
        delete state.goldenSignetMoves[activeEncounterId];
      }
      renderApp();
    });
  });

  root.querySelectorAll(".boon-strain-relief-target").forEach((select) => {
    select.addEventListener("change", () => {
      state.boonStrainReliefTargets = {
        ...state.boonStrainReliefTargets,
        [select.dataset.activeEncounterId]: select.value ? [select.value] : []
      };
      renderApp();
    });
  });

  root.querySelectorAll(".boon-strain-relief-target-choice").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const activeEncounterId = checkbox.dataset.activeEncounterId;
      const maxTargets = Number(checkbox.dataset.maxTargets);
      const checkedTargetIds = [
        ...root.querySelectorAll(
          `.boon-strain-relief-target-choice[data-active-encounter-id="${CSS.escape(activeEncounterId)}"]:checked`
        )
      ].map((input) => input.value);
      state.boonStrainReliefTargets = {
        ...state.boonStrainReliefTargets,
        [activeEncounterId]: checkedTargetIds.slice(0, maxTargets)
      };
      renderApp();
    });
  });

  root.querySelectorAll(".boon-exchange-count").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const amount = Number(select.value);
      state.boonExchangeAmounts = {
        ...state.boonExchangeAmounts,
        [activeEncounterId]: amount
      };
      state.boonExchangePayments = {
        ...state.boonExchangePayments,
        [activeEncounterId]: (state.boonExchangePayments[activeEncounterId] ?? []).slice(0, amount)
      };
      state.boonExchangeGains = {
        ...state.boonExchangeGains,
        [activeEncounterId]: (state.boonExchangeGains[activeEncounterId] ?? []).slice(0, amount)
      };
      renderApp();
    });
  });

  root.querySelectorAll(".boon-exchange-payment-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const index = Number(select.dataset.paymentIndex);
      const choices = [...(state.boonExchangePayments[activeEncounterId] ?? [])];
      choices[index] = select.value;
      state.boonExchangePayments = {
        ...state.boonExchangePayments,
        [activeEncounterId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".boon-exchange-gain-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const index = Number(select.dataset.gainIndex);
      const choices = [...(state.boonExchangeGains[activeEncounterId] ?? [])];
      choices[index] = select.value;
      state.boonExchangeGains = {
        ...state.boonExchangeGains,
        [activeEncounterId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".boon-steward-help-gain-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const index = Number(select.dataset.gainIndex);
      const choices = [...(state.boonStewardHelpGains[activeEncounterId] ?? [])];
      choices[index] = select.value;
      state.boonStewardHelpGains = {
        ...state.boonStewardHelpGains,
        [activeEncounterId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".golden-scroll-discard-choice").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const activeEncounterId = checkbox.dataset.activeEncounterId;
      const playerId = checkbox.dataset.playerId;
      const checkedCardIds = [
        ...root.querySelectorAll(
          `.golden-scroll-discard-choice[data-active-encounter-id="${CSS.escape(activeEncounterId)}"][data-player-id="${CSS.escape(playerId)}"]:checked`
        )
      ].map((input) => input.value);
      state.goldenScrollDiscards = {
        ...state.goldenScrollDiscards,
        [activeEncounterId]: {
          ...(state.goldenScrollDiscards[activeEncounterId] ?? {}),
          [playerId]: checkedCardIds
        }
      };
      renderApp();
    });
  });

  root.querySelectorAll(".golden-signet-move-choice").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const activeEncounterId = checkbox.dataset.activeEncounterId;
      const placedTileId = checkbox.dataset.placedTileId;
      const placedTile = state.game.map.placedTiles.find((candidate) => candidate.id === placedTileId);
      const currentChoices = { ...(state.goldenSignetMoves[activeEncounterId] ?? {}) };

      if (checkbox.checked) {
        currentChoices[placedTileId] = {
          ...(currentChoices[placedTileId] ?? {}),
          selected: true,
          coordinate: currentChoices[placedTileId]?.coordinate ?? placedTile?.coordinate ?? getPlacedTileAnchorCoordinate(placedTile),
          orientation: currentChoices[placedTileId]?.orientation ?? placedTile?.orientation ?? HEX_DIRECTIONS[0].id
        };
      } else {
        delete currentChoices[placedTileId];
      }

      state.goldenSignetMoves = {
        ...state.goldenSignetMoves,
        [activeEncounterId]: currentChoices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".golden-signet-coordinate").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const placedTileId = select.dataset.placedTileId;
      const placedTile = state.game.map.placedTiles.find((candidate) => candidate.id === placedTileId);
      state.goldenSignetMoves = {
        ...state.goldenSignetMoves,
        [activeEncounterId]: {
          ...(state.goldenSignetMoves[activeEncounterId] ?? {}),
          [placedTileId]: {
            ...(state.goldenSignetMoves[activeEncounterId]?.[placedTileId] ?? {}),
            selected: true,
            coordinate: select.value,
            orientation:
              state.goldenSignetMoves[activeEncounterId]?.[placedTileId]?.orientation ??
              placedTile?.orientation ??
              HEX_DIRECTIONS[0].id
          }
        }
      };
      renderApp();
    });
  });

  root.querySelectorAll(".golden-signet-orientation").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const placedTileId = select.dataset.placedTileId;
      const placedTile = state.game.map.placedTiles.find((candidate) => candidate.id === placedTileId);
      state.goldenSignetMoves = {
        ...state.goldenSignetMoves,
        [activeEncounterId]: {
          ...(state.goldenSignetMoves[activeEncounterId] ?? {}),
          [placedTileId]: {
            ...(state.goldenSignetMoves[activeEncounterId]?.[placedTileId] ?? {}),
            selected: true,
            coordinate:
              state.goldenSignetMoves[activeEncounterId]?.[placedTileId]?.coordinate ??
              placedTile?.coordinate ??
              getPlacedTileAnchorCoordinate(placedTile),
            orientation: select.value
          }
        }
      };
      renderApp();
    });
  });

  root.querySelectorAll(".burden-payment-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const index = Number(select.dataset.paymentIndex);
      const choices = [...(state.burdenPayments[activeEncounterId] ?? [])];
      choices[index] = select.value;
      state.burdenPayments = {
        ...state.burdenPayments,
        [activeEncounterId]: choices
      };
      delete state.burdenResolutionDiscounts[activeEncounterId];
      state.burdenResolutionDiscounts = { ...state.burdenResolutionDiscounts };
      renderApp();
    });
  });

  root.querySelectorAll(".burden-resolution-discount-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const activeEncounterId = select.dataset.activeEncounterId;
      const index = Number(select.dataset.discountIndex);
      const choices = [...(state.burdenResolutionDiscounts[activeEncounterId] ?? [])];
      choices[index] = select.value;
      state.burdenResolutionDiscounts = {
        ...state.burdenResolutionDiscounts,
        [activeEncounterId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".activation-payment-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const index = Number(select.dataset.paymentIndex);
      const choices = [...(state.activationPayments[placedTileId] ?? [])];
      choices[index] = select.value;
      state.activationPayments = {
        ...state.activationPayments,
        [placedTileId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".upgrade-cost-discount-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const index = Number(select.dataset.discountIndex);
      const choices = [...(state.upgradeCostDiscounts[placedTileId] ?? [])];
      choices[index] = select.value;
      state.upgradeCostDiscounts = {
        ...state.upgradeCostDiscounts,
        [placedTileId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".upgrade-cost-choice-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const index = Number(select.dataset.choiceIndex);
      const choices = [...(state.upgradeCostChoices[placedTileId] ?? [])];
      choices[index] = select.value;
      state.upgradeCostChoices = {
        ...state.upgradeCostChoices,
        [placedTileId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".placement-cost-choice-resource").forEach((select) => {
    select.addEventListener("change", () => {
      rememberTileTrayScroll();
      const tileId = select.dataset.tileId;
      const index = Number(select.dataset.choiceIndex);
      const choices = [...(state.placementCostChoices[tileId] ?? [])];
      choices[index] = select.value;
      state.placementCostChoices = {
        ...state.placementCostChoices,
        [tileId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".placement-cost-discount-resource").forEach((select) => {
    select.addEventListener("change", () => {
      rememberTileTrayScroll();
      const tileId = select.dataset.tileId;
      const index = Number(select.dataset.discountIndex);
      const choices = [...(state.placementCostDiscounts[tileId] ?? [])];
      choices[index] = select.value;
      state.placementCostDiscounts = {
        ...state.placementCostDiscounts,
        [tileId]: choices
      };
      renderApp();
    });
  });

  root.querySelector("#activation-exchange-count")?.addEventListener("change", (event) => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    const amount = Number(event.target.value);

    if (!placedTile) {
      return;
    }

    state.activationExchangeAmounts = {
      ...state.activationExchangeAmounts,
      [placedTile.id]: amount
    };
    state.activationPayments = {
      ...state.activationPayments,
      [placedTile.id]: (state.activationPayments[placedTile.id] ?? []).slice(0, amount)
    };
    state.activationGains = {
      ...state.activationGains,
      [placedTile.id]: (state.activationGains[placedTile.id] ?? []).slice(0, amount)
    };
    renderApp();
  });

  root.querySelectorAll(".steward-exchange-count").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const amount = Number(select.value);

      if (!placedTileId) {
        return;
      }

      state.stewardExchangeAmounts = {
        ...state.stewardExchangeAmounts,
        [placedTileId]: amount
      };
      state.stewardExchangePayments = {
        ...state.stewardExchangePayments,
        [placedTileId]: (state.stewardExchangePayments[placedTileId] ?? []).slice(0, amount)
      };
      state.stewardExchangeGains = {
        ...state.stewardExchangeGains,
        [placedTileId]: (state.stewardExchangeGains[placedTileId] ?? []).slice(0, amount)
      };
      renderApp();
    });
  });

  root.querySelectorAll(".steward-starting-exchange-count").forEach((select) => {
    select.addEventListener("change", () => {
      const exchangeKey = select.dataset.exchangeKey;
      const amount = Number(select.value);

      if (!exchangeKey) {
        return;
      }

      state.stewardExchangeAmounts = {
        ...state.stewardExchangeAmounts,
        [exchangeKey]: amount
      };
      state.stewardExchangePayments = {
        ...state.stewardExchangePayments,
        [exchangeKey]: (state.stewardExchangePayments[exchangeKey] ?? []).slice(0, amount)
      };
      state.stewardExchangeGains = {
        ...state.stewardExchangeGains,
        [exchangeKey]: (state.stewardExchangeGains[exchangeKey] ?? []).slice(0, amount)
      };
      renderApp();
    });
  });

  root.querySelectorAll(".steward-exchange-payment-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const index = Number(select.dataset.paymentIndex);
      const choices = [...(state.stewardExchangePayments[placedTileId] ?? [])];
      choices[index] = select.value;
      state.stewardExchangePayments = {
        ...state.stewardExchangePayments,
        [placedTileId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".steward-exchange-gain-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const index = Number(select.dataset.gainIndex);
      const choices = [...(state.stewardExchangeGains[placedTileId] ?? [])];
      choices[index] = select.value;
      state.stewardExchangeGains = {
        ...state.stewardExchangeGains,
        [placedTileId]: choices
      };
      renderApp();
    });
  });

  root.querySelectorAll(".use-steward-exchange").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("USE_STEWARD_POWER");
        renderApp();
        return;
      }

      const placedTileId = button.dataset.placedTileId;

      if (!placedTileId) {
        return;
      }

      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
          placedTileId,
          payment: getResourcePaymentAction(state.stewardExchangePayments[placedTileId] ?? []),
          gains: getResourcePaymentAction(state.stewardExchangeGains[placedTileId] ?? [])
        },
        { tiles: state.data.tiles }
      );
      applyGameOutcome(nextGame, result);
      if (result.ok) {
        const stewardExchangePayments = { ...state.stewardExchangePayments };
        delete stewardExchangePayments[placedTileId];
        state.stewardExchangePayments = stewardExchangePayments;
        const stewardExchangeGains = { ...state.stewardExchangeGains };
        delete stewardExchangeGains[placedTileId];
        state.stewardExchangeGains = stewardExchangeGains;
        const stewardExchangeAmounts = { ...state.stewardExchangeAmounts };
        delete stewardExchangeAmounts[placedTileId];
        state.stewardExchangeAmounts = stewardExchangeAmounts;
      }
      renderApp();
    });
  });

  root.querySelectorAll(".activation-gain-resource").forEach((select) => {
    select.addEventListener("change", () => {
      const placedTileId = select.dataset.placedTileId;
      const index = Number(select.dataset.gainIndex);
      const choices = [...(state.activationGains[placedTileId] ?? [])];
      choices[index] = select.value;
      state.activationGains = {
        ...state.activationGains,
        [placedTileId]: choices
      };
      renderApp();
    });
  });

  root.querySelector("#activation-target")?.addEventListener("change", (event) => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);

    if (!placedTile) {
      return;
    }

    state.activationTargets = {
      ...state.activationTargets,
      [placedTile.id]: event.target.value
    };
    renderApp();
  });

  root.querySelector("#arrival-timer-target")?.addEventListener("change", (event) => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);

    if (!placedTile) {
      return;
    }

    state.activationTargets = {
      ...state.activationTargets,
      [placedTile.id]: event.target.value
    };
    renderApp();
  });

  root.querySelector("#burden-activation-target")?.addEventListener("change", (event) => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);

    if (!placedTile) {
      return;
    }

    state.activationTargets = {
      ...state.activationTargets,
      [placedTile.id]: event.target.value
    };
    renderApp();
  });

  root.querySelectorAll(".activation-target-choice").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);

      if (!placedTile) {
        return;
      }

      const maxTargets = Number(event.target.dataset.maxTargets ?? 1);
      const checkedTargetIds = [...root.querySelectorAll(".activation-target-choice:checked")].map(
        (input) => input.value
      );
      const nextTargetIds =
        checkedTargetIds.length > maxTargets
          ? [...checkedTargetIds.filter((targetId) => targetId !== event.target.value), event.target.value].slice(
              -maxTargets
            )
          : checkedTargetIds;

      state.activationTargets = {
        ...state.activationTargets,
        [placedTile.id]: nextTargetIds
      };
      renderApp();
    });
  });

  root.querySelector("#upgrade-selected")?.addEventListener("click", () => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    upgradePlacedTile(placedTile?.id);
  });

  root.querySelector("#steward-upgrade-power")?.addEventListener("change", (event) => {
    state.stewardUpgradePowerId = event.target.value;
    renderApp();
  });

  root.querySelector("#steward-activation-power")?.addEventListener("change", (event) => {
    state.stewardActivationPowerId = event.target.value;
    renderApp();
  });

  root.querySelector("#activate-selected")?.addEventListener("click", () => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    activatePlacedTile(placedTile?.id);
  });

  root.querySelector("#apply-strain-selected")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("APPLY_STRAIN");
      renderApp();
      return;
    }

    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.APPLY_STRAIN,
        placedTileId: placedTile?.id,
        amount: 1
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#support-selected")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("DEBUG_SET_TILE_SUPPORTED");
      renderApp();
      return;
    }

    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_SET_TILE_SUPPORTED,
        placedTileId: placedTile?.id,
        supported: !isSupportedPlacedTile(placedTile)
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#overstrain-selected")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("DEBUG_SET_TILE_STRAIN");
      renderApp();
      return;
    }

    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
        placedTileId: placedTile?.id,
        strain: 3
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#clear-strain-selected")?.addEventListener("click", () => {
    if (!isPlaySessionPlaying()) {
      setBlockedPlaySessionResult("DEBUG_SET_TILE_STRAIN");
      renderApp();
      return;
    }

    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_SET_TILE_STRAIN,
        placedTileId: placedTile?.id,
        strain: 0
      },
      { tiles: state.data.tiles }
    );
    applyGameOutcome(nextGame, result);
    renderApp();
  });

  root.querySelector("#reveal-hidden-setup")?.addEventListener("change", (event) => {
    state.revealHiddenSetup = event.target.checked;
    renderApp();
  });

  root.querySelector("#blind-test-mode")?.addEventListener("change", (event) => {
    state.blindTestMode = event.target.checked;
    state.simulation = {
      ...state.simulation,
      message: event.target.checked ? "" : state.simulation.message
    };
    renderApp();
  });

  root.querySelector("#show-debug-labels")?.addEventListener("change", (event) => {
    state.showDebugLabels = event.target.checked;
    renderApp();
  });

  root.querySelectorAll(".debug-player-marker").forEach((select) => {
    select.addEventListener("change", () => {
      if (!isPlaySessionPlaying()) {
        setBlockedPlaySessionResult("DEBUG_SET_PLAYER_MARKER");
        renderApp();
        return;
      }

      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
          playerId: select.dataset.playerId,
          placedTileId: select.value
        },
        { tiles: state.data.tiles }
      );
      applyGameOutcome(nextGame, result);
      renderApp();
    });
  });
}

document.addEventListener("keydown", handleGlobalEscape);
root.addEventListener("click", handleRootClickAwayFromPlacementPreview);
root.addEventListener("click", handleHeaderMenuClickAway);

renderApp();

loadData()
  .then((data) => {
    state.data = data;
    if (!restoreLocalPlaytestState()) {
      createGame();
    }
    renderApp();
  })
  .catch((error) => {
    state.error = error;
    renderApp();
  });
