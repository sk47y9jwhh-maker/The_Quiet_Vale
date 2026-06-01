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
  getPlacedTileAt,
  isOverstrainedPlacedTile,
  parseResourceCost,
  validatePlaceTile
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
import { getActivationDetails, getAdjacentPlacedTiles } from "../game/activation.js";
import { getEffectiveSupportDetails } from "../game/passives.js";
import { SEED_PACKET_POSITIONS, getBurdenResolutionCost } from "../game/encounters.js";
import { createEncounterCoverageAudit } from "../game/encounterCoverage.js";
import {
  STEWARD_POWER_TYPES,
  getAvailableStewardPowerProviders,
  getStewardPowerDetails,
  isStewardPowerUsedThisSeason
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
  riverRules: "./src/data/river_rules.json",
  rulesConfig: "./src/data/rules_config.json"
};

const MAP_OPTIONS = Object.freeze([
  Object.freeze({
    id: "redesigned-basic-map-v0-1",
    name: "Redesigned Basic Map v0.1",
    status: "Default locked map",
    path: "./src/data/redesigned_basic_map_v0_1.json",
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

const BURDEN_REVEAL_CHOICE_TYPES = Object.freeze([
  "pay_or_strain_choice",
  "arrival_pay_or_timer_choice",
  "resource_loss_or_strain_choice"
]);

const root = document.querySelector("#app");
const state = {
  data: null,
  error: null,
  game: null,
  selectedCoordinate: "C7",
  selectedMapId: "redesigned-basic-map-v0-1",
  selectedTileId: null,
  selectedOrientation: HEX_DIRECTIONS[0].id,
  playerCount: 1,
  setupSeed: "quiet-vale-m2",
  showDebugLabels: false,
  revealHiddenSetup: false,
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
  placementCostDiscounts: {},
  burdenResolutionDiscounts: {},
  arrivalRequirementDiscounts: {},
  upgradeCostDiscounts: {},
  activationTargets: {},
  activationPayments: {},
  activationGains: {},
  activationExchangeAmounts: {},
  stewardPlacementPowerId: "",
  stewardUpgradePowerId: "",
  stewardBurdenPowerIds: {},
  stewardExchangePayments: {},
  stewardExchangeGains: {},
  stewardExchangeAmounts: {},
  simulation: {
    botProfile: "balanced",
    playerCount: "current",
    result: null,
    message: ""
  },
  contextMenu: null,
  seedContextMenu: null,
  lastActionResult: null
};

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

function formatPhase(phase) {
  const labels = {
    [GAME_PHASES.SEED_ENCOUNTERS]: "Seed Encounters",
    [GAME_PHASES.REVEAL_ENCOUNTERS]: "Reveal Encounters",
    [GAME_PHASES.PLAYER_TURNS]: "Player Turns",
    [GAME_PHASES.END_ROUND]: "End of Round",
    [GAME_PHASES.COMPLETE]: "Complete"
  };

  return labels[phase] ?? phase;
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
  state.placementCostDiscounts = {};
  state.burdenResolutionDiscounts = {};
  state.arrivalRequirementDiscounts = {};
  state.upgradeCostDiscounts = {};
  state.activationTargets = {};
  state.activationPayments = {};
  state.activationGains = {};
  state.activationExchangeAmounts = {};
  state.stewardPlacementPowerId = "";
  state.stewardUpgradePowerId = "";
  state.stewardBurdenPowerIds = {};
  state.stewardExchangePayments = {};
  state.stewardExchangeGains = {};
  state.stewardExchangeAmounts = {};
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

function createGame() {
  if (!state.data) {
    return;
  }

  refreshActiveMapData();
  syncSelectedCoordinate();

  state.game = createInitialGameState({
    playerCount: state.playerCount,
    seed: state.setupSeed,
    encounterCards: state.data.encounterCards,
    tiles: state.data.tiles,
    mapHexes: getSelectedMapHexes()
  });
  state.lastActionResult = null;
  resetLocalTestingControls();
  syncSelectedTile();
}

function getPlacementOptions() {
  if (!state.data || !state.game) {
    return [];
  }

  const supplyByTileId = new Map(
    [...state.game.tileSupply.core, ...state.game.tileSupply.special].map((entry) => [entry.tileId, entry])
  );
  const directCoreTiles = getDirectlyPlaceableTiles(state.data.tiles);
  const unlockedSpecialTiles = state.data.tiles.filter((tile) => {
    const supply = supplyByTileId.get(tile.tile_id);
    return tile.tile_source_type === "Special" && supply && !supply.locked;
  });

  return [...directCoreTiles, ...unlockedSpecialTiles].map((tile) => ({
    tile,
    supply: supplyByTileId.get(tile.tile_id)
  }));
}

function syncSelectedTile() {
  const options = getPlacementOptions();
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

function getPlayersByLastInteraction(game) {
  return game.players.reduce((playersByPlacedTileId, player) => {
    const placedTileId = player.lastInteraction?.placedTileId;

    if (!placedTileId) {
      return playersByPlacedTileId;
    }

    const players = playersByPlacedTileId.get(placedTileId) ?? [];
    players.push(player);
    playersByPlacedTileId.set(placedTileId, players);
    return playersByPlacedTileId;
  }, new Map());
}

function getPlayerMarkerFill(playerId) {
  const playerNumber = Number(String(playerId).replace(/\D/g, ""));
  const index = Number.isInteger(playerNumber) && playerNumber > 0 ? playerNumber - 1 : 0;
  return PLAYER_MARKER_FILLS[index % PLAYER_MARKER_FILLS.length];
}

function renderPlayerMapMarkers(players, center) {
  if (players.length === 0) {
    return "";
  }

  const spacing = 13;
  const startX = -((players.length - 1) * spacing) / 2;

  return `
    <g class="player-map-markers" aria-label="Last interaction markers">
      ${players
        .map(
          (player, index) => `
            <g
              class="player-map-marker"
              transform="translate(${(center.x + startX + index * spacing).toFixed(2)} ${(center.y - 18).toFixed(2)})"
              style="--marker-fill: ${escapeHtml(getPlayerMarkerFill(player.id))}"
            >
              <circle r="7"></circle>
              <text y="3">${escapeHtml(player.id)}</text>
            </g>
          `
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

function getInteractionActionLabel(type) {
  return (
    {
      place: "Placed",
      activate: "Activated",
      upgrade: "Upgraded"
    }[type] ?? "Touched"
  );
}

function formatPlayerLastInteraction(game, tileIndex, player) {
  const interaction = player.lastInteraction;

  if (!interaction?.placedTileId) {
    return "No map action yet";
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
  const playersByLastInteraction = getPlayersByLastInteraction(game);
  const selectedTile = tileIndex.get(state.selectedTileId);
  const previewFootprint = selectedTile
    ? getFootprintCoordinates(selectedCoordinate, selectedTile.size_hexes, state.selectedOrientation, mapHexes)
    : null;
  const previewSet = new Set(previewFootprint ?? []);

  const hexMarkup = [...mapHexes]
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, mapHexes))
    .map((hex) => {
      const center = hexCenter(hex, size, mapHexes);
      const label = featureLabel(hex);
      const placedTile = placedByCoordinate.get(hex.Coordinate);
      const placedTileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
      const isPlacedTileAnchor = placedTile && hex.Coordinate === getPlacedTileAnchorCoordinate(placedTile);
      const markerPlayers =
        isPlacedTileAnchor
          ? (playersByLastInteraction.get(placedTile.id) ?? [])
          : [];
      const strain = Number(placedTile?.strain ?? 0);
      const classes = [
        "hex",
        `terrain-${slug(hex.Terrain)}`,
        hex.River_Adjacent_Land ? "river-adjacent-land" : "",
        hex.Bridge_Candidate ? "bridge-candidate" : "",
        previewSet.has(hex.Coordinate) ? "is-footprint-preview" : "",
        placedTile ? "has-placed-tile" : "",
        strain > 0 ? "has-strain-tile" : "",
        markerPlayers.length ? "has-player-marker" : "",
        placedTile && isOverstrainedPlacedTile(placedTile) ? "is-overstrained-tile" : "",
        selectedCoordinate === hex.Coordinate ? "is-selected" : ""
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <g class="${classes}" data-coordinate="${escapeHtml(hex.Coordinate)}" tabindex="0" role="button" aria-label="${escapeHtml(`${hex.Coordinate} ${hex.Terrain} ${hex.Feature}`)}">
          <polygon points="${hexPoints(center, size)}"></polygon>
          ${
            state.showDebugLabels
              ? `<text class="hex-terrain" x="${center.x}" y="${center.y - 11}">${escapeHtml(terrainShortName(hex.Terrain))}</text>`
              : ""
          }
          ${
            placedTileDefinition
              ? renderWrappedMapLabel(placedTileDefinition.tile_name, "hex-tile", center.x, center.y + 9)
              : label
                ? renderWrappedMapLabel(label, "hex-feature", center.x, center.y + 10, 10, 2)
                : ""
          }
          ${isPlacedTileAnchor ? renderStrainMapMarker(placedTile, center) : ""}
          ${renderPlayerMapMarkers(markerPlayers, center)}
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
            <span class="map-key-swatch terrain-${slug(terrain)}" aria-hidden="true"></span>
            <span>${escapeHtml(label)}</span>
          </span>
        `
      ).join("")}
      <span class="map-key-item">
        <span class="map-key-marker strain" aria-hidden="true">1</span>
        <span>Strain</span>
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

function selectedPlacementTileCanRotate(tileIndex) {
  const selectedTile = getSelectedPlacementTile(tileIndex);
  return Boolean(selectedTile && Number(selectedTile.size_hexes ?? 1) > 1);
}

function getPlacementOrientations(tile) {
  return Number(tile?.size_hexes ?? 1) > 1 ? HEX_DIRECTIONS.map((direction) => direction.id) : [HEX_DIRECTIONS[0].id];
}

function getAutomaticPlacementCostDiscountResources(game, tile, cost) {
  const discountEffect = getPendingPlacementResourceDiscount(game, tile);

  if (!discountEffect || discountEffect.freeResourceCost) {
    return [];
  }

  const eligibleCost = getPlacementDiscountEligibleCost(cost, discountEffect);
  const choiceCount = getCostReductionChoiceCount(eligibleCost, discountEffect);
  const choices = [];

  for (const entry of eligibleCost) {
    for (let index = 0; index < entry.amount && choices.length < choiceCount; index += 1) {
      choices.push(entry.resource);
    }
  }

  return choices;
}

function getPlacementActionCostForMenu(game, tile, footprintCoordinates, tileIndex) {
  const baseActionCost = calculatePlacementActionCost(game, footprintCoordinates, { tileIndex });
  const tileActionDiscount = getDiscountedTileActionCost(game, tile, "placement", baseActionCost);
  const travelActionDiscount = getDiscountedDisconnectedTravelActionCost(
    game,
    "placement",
    tileActionDiscount.actionCost
  );

  return travelActionDiscount.actionCost;
}

function getLegalPlacementOptionsForCoordinate(game, tileIndex, coordinate) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);

  if (!activePlayer || game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return [];
  }

  return getPlacementOptions()
    .flatMap(({ tile, supply }) => {
      const baseCost = parseResourceCost(tile.place_cost);
      const placementCostReductionResources = getAutomaticPlacementCostDiscountResources(game, tile, baseCost);

      return getPlacementOrientations(tile).map((orientation) => {
        const action = {
          type: TILE_ACTION_TYPES.PLACE_TILE,
          tileId: tile.tile_id,
          coordinate,
          orientation,
          placementCostReductionResources
        };
        const validation = validatePlaceTile(game, action, { tiles: state.data.tiles });

        if (!validation.valid || !validation.footprintCoordinates) {
          return null;
        }

        const actionCost = getPlacementActionCostForMenu(game, tile, validation.footprintCoordinates, tileIndex);

        if (activePlayer.actionsRemaining < actionCost.total) {
          return null;
        }

        return {
          tile,
          supply,
          coordinate,
          orientation,
          actionCost,
          cost: validation.cost,
          footprintCoordinates: validation.footprintCoordinates,
          placementCostReductionResources
        };
      });
    })
    .filter(Boolean);
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

function renderLegalPlacementMenu(game, tileIndex, coordinate) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);

  if (game.phase !== GAME_PHASES.PLAYER_TURNS) {
    return `<p class="context-empty-note">Tile placement opens during Player Turns.</p>`;
  }

  if (!activePlayer) {
    return `<p class="context-empty-note">No active Steward is ready to place tiles.</p>`;
  }

  const options = getLegalPlacementOptionsForCoordinate(game, tileIndex, coordinate);

  if (options.length === 0) {
    return `<p class="context-empty-note">No legal tile placements on this hex with the current warehouse, stock, and Actions.</p>`;
  }

  return `
    <div class="context-placement-groups" aria-label="Legal tile placements">
      ${groupPlacementOptionsByCategory(options)
        .map(
          ([category, categoryOptions]) => `
            <details class="context-placement-group" open>
              <summary>${escapeHtml(category)} <span>${categoryOptions.length}</span></summary>
              <div class="context-placement-options">
                ${categoryOptions
                  .map((option) => {
                    const isMultihex = Number(option.tile.size_hexes ?? 1) > 1;
                    const orientationText = isMultihex ? ` · ${getOrientationLabel(option.orientation)}` : "";
                    const footprintText = isMultihex ? ` · ${renderFootprint(option.footprintCoordinates)}` : "";
                    const discountText = option.placementCostReductionResources.length > 0 ? " · discount applied" : "";

                    return `
                      <button
                        class="context-placement-option type-${slug(option.tile.tile_category)}"
                        data-context-place-tile-id="${escapeHtml(option.tile.tile_id)}"
                        data-context-place-coordinate="${escapeHtml(option.coordinate)}"
                        data-context-place-orientation="${escapeHtml(option.orientation)}"
                        data-context-place-discounts="${escapeHtml(option.placementCostReductionResources.join("|"))}"
                        type="button"
                        role="menuitem"
                      >
                        <strong>${escapeHtml(option.tile.tile_name)}</strong>
                        <small>${escapeHtml(
                          `${option.supply?.available ?? 0}/${option.supply?.stock ?? 0} left · ${renderActionCost(option.actionCost)} Action · ${renderCost(option.cost)}${orientationText}${footprintText}${discountText}`
                        )}</small>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            </details>
          `
        )
        .join("")}
    </div>
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
  const left = Math.max(8, Math.round(Number(state.contextMenu.x ?? 8)));
  const top = Math.max(8, Math.round(Number(state.contextMenu.y ?? 8)));
  const placementCost = selectedPlacementTile ? parseResourceCost(selectedPlacementTile.place_cost) : [];
  const placementResourceDiscount = getPendingPlacementResourceDiscount(game, selectedPlacementTile);
  const placementCostDiscountChoices = selectedPlacementTile
    ? getPlacementCostDiscountChoices(selectedPlacementTile.tile_id, placementCost, placementResourceDiscount)
    : [];
  const placementCostDiscountReady = placementCostDiscountChoices.every((resource) => Boolean(resource));
  const canAttemptPlacement =
    Boolean(!placedTile && selectedPlacementTile && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    placementCostDiscountReady;
  const canRotatePreview = !placedTile && selectedPlacementTileCanRotate(tileIndex);
  const canAttemptUpgrade =
    Boolean(upgradeTile && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    !isOverstrainedPlacedTile(placedTile);
  const canAttemptActivation =
    Boolean(activation?.details && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    !isOverstrainedPlacedTile(placedTile);

  return `
    <button class="map-context-backdrop" type="button" aria-label="Close map actions"></button>
    <aside class="map-context-menu" style="left: ${left}px; top: ${top}px;" role="menu" aria-label="Map actions">
      <header>
        <strong>${escapeHtml(tileDefinition?.tile_name ?? selectedPlacementTile?.tile_name ?? "Empty hex")}</strong>
        <small>${escapeHtml(coordinate)}</small>
      </header>
      ${
        placedTile
          ? `
            <button class="map-context-action" data-context-action="activate" type="button" role="menuitem" ${canAttemptActivation ? "" : "disabled"}>
              Produce / Interact
            </button>
            <button class="map-context-action" data-context-action="upgrade" type="button" role="menuitem" ${canAttemptUpgrade ? "" : "disabled"}>
              Upgrade
            </button>
          `
          : `
            ${renderLegalPlacementMenu(game, tileIndex, coordinate)}
            <button class="map-context-action" data-context-action="place" type="button" role="menuitem" ${canAttemptPlacement ? "" : "disabled"}>
              Place Selected Tile
            </button>
            <button class="map-context-action" data-context-action="rotate" type="button" role="menuitem" ${canRotatePreview ? "" : "disabled"}>
              Rotate Multihex Preview
            </button>
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

  const left = Math.max(8, Math.round(Number(state.seedContextMenu.x ?? 8)));
  const top = Math.max(8, Math.round(Number(state.seedContextMenu.y ?? 8)));

  return `
    <button class="seed-context-backdrop" type="button" aria-label="Close seed menu"></button>
    <aside class="seed-context-menu" style="left: ${left}px; top: ${top}px;" role="menu" aria-label="Seed card position">
      <header>
        <strong>${escapeHtml(card.card_name ?? cardId)}</strong>
        <small>${escapeHtml(player.name)}</small>
      </header>
      ${Object.entries(SEED_PACKET_POSITION_LABELS)
        .map(
          ([position, label]) => `
            <button
              class="seed-context-action"
              data-seed-player-id="${escapeHtml(playerId)}"
              data-seed-card-id="${escapeHtml(cardId)}"
              data-seed-position="${escapeHtml(position)}"
              type="button"
              role="menuitem"
            >
              ${escapeHtml(label)}
            </button>
          `
        )
        .join("")}
    </aside>
  `;
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

  const parsed = parseResourceCostForDisplay(costText);
  return parsed.error ? parsed.error : renderCost(parsed.cost);
}

function renderTileSourceText(tile, title = "Tile Says") {
  if (!tile) {
    return "";
  }

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
    <article class="tile-reference-card type-${slug(tile.tile_category)}">
      <header>
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(tile.tile_name)}</strong>
        <small>${escapeHtml(meta.join(" · "))}</small>
      </header>
      <dl class="tile-reference-costs">
        <div><dt>Place</dt><dd>${escapeHtml(renderSourceResourceCost(tile.place_cost) || "0")}</dd></div>
        <div><dt>Upgrade</dt><dd>${escapeHtml(renderSourceResourceCost(tile.upgrade_cost) || "0")}</dd></div>
      </dl>
      <p class="tile-reference-benefit">${escapeHtml(tile.benefit || "No printed benefit")}</p>
      <dl class="tile-reference-notes">
        <div><dt>Placement</dt><dd>${escapeHtml(tile.placement_rules ?? "No special placement rule")}</dd></div>
        ${scoring.length ? `<div><dt>Score</dt><dd>${escapeHtml(scoring.join(" · "))}</dd></div>` : ""}
        ${tile.upgrade_to ? `<div><dt>Upgrades to</dt><dd>${escapeHtml(tile.upgrade_to)}</dd></div>` : ""}
      </dl>
    </article>
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
    <ol class="card-list">
      ${cards
        .map((card, index) => {
          const order = `<span class="card-order">${ordered ? index + 1 : ""}</span>`;
          return `
            <li class="card-row type-${slug(card.encounter_type)}">
              ${order}
              <span class="card-name">${escapeHtml(card.card_name)}</span>
              <span class="card-type">${escapeHtml(card.encounter_type)}</span>
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
  const allowedResources = new Set(cost.map((entry) => entry.resource));

  return Array.from({ length: getCostReductionChoiceCount(cost, discountEffect) }, (_, index) => {
    const selectedResource = saved[index] ?? "";
    return selectedResource && allowedResources.has(selectedResource) ? selectedResource : "";
  });
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

  return `
    <div class="burden-payment-grid" aria-label="Burden resolution reduction resources">
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

function getArrivalRequirementResources(card, game) {
  const requirement = String(card?.requirement ?? "").split(/\bwithin\b/i)[0];
  const resources = [
    ...new Set(
      [...requirement.matchAll(/\b\d+\s+([A-Za-z]+)\b/g)]
        .map((match) => match[1])
        .filter((resource) => game.rules.resources.includes(resource))
    )
  ];

  return resources.length ? resources : game.rules.resources;
}

function getArrivalRequirementDiscountChoices(activeEncounterId, discountEffect) {
  const saved = state.arrivalRequirementDiscounts[activeEncounterId] ?? [];
  return Array.from({ length: discountEffect?.amount ?? 0 }, (_, index) => saved[index] ?? "");
}

function renderArrivalRequirementDiscountChoices(activeState, card, discountEffect, game) {
  if (!discountEffect || activeState.encounterType !== ENCOUNTER_TYPES.ARRIVAL) {
    return "";
  }

  const allowedResources = getArrivalRequirementResources(card, game);
  const selectedResources = getArrivalRequirementDiscountChoices(activeState.id, discountEffect);

  return `
    <div class="burden-payment-grid" aria-label="Arrival requirement reduction resources">
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
  `;
}

function getArrivalRequirementDiscountAction(activeEncounterId) {
  return (state.arrivalRequirementDiscounts[activeEncounterId] ?? []).filter(Boolean);
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
  return Array.from({ length: getCostReductionChoiceCount(cost, discountEffect) }, (_, index) => saved[index] ?? "");
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

  const selectedResources = getUpgradeCostDiscountChoices(selectedPlacedTile.id, upgradeCost.cost, discountEffect);
  if (selectedResources.length === 0) {
    return "";
  }

  const allowedResources = [...new Set(upgradeCost.cost.map((entry) => entry.resource))];

  return `
    <div class="burden-payment-grid" aria-label="Core upgrade cost reduction resources">
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
  const allowedResources = new Set(eligibleCost.map((entry) => entry.resource));

  return Array.from({ length: getCostReductionChoiceCount(eligibleCost, discountEffect) }, (_, index) => {
    const selectedResource = saved[index] ?? "";
    return selectedResource && allowedResources.has(selectedResource) ? selectedResource : "";
  });
}

function renderPlacementCostDiscountChoices(tile, cost, discountEffect) {
  if (!tile || !discountEffect) {
    return "";
  }

  const selectedResources = getPlacementCostDiscountChoices(tile.tile_id, cost, discountEffect);
  if (selectedResources.length === 0) {
    return "";
  }

  const eligibleCost = getPlacementDiscountEligibleCost(cost, discountEffect);
  const allowedResources = [...new Set(eligibleCost.map((entry) => entry.resource))];

  return `
    <div class="burden-payment-grid" aria-label="Placement cost reduction resources">
      ${selectedResources
        .map(
          (selectedResource, index) => `
            <select class="placement-cost-discount-resource" data-tile-id="${escapeHtml(tile.tile_id)}" data-discount-index="${index}" aria-label="Placement reduction resource ${index + 1}">
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
    baseActionCost.disconnectedTravelActionCost > 0
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
      disconnectedTravelActionCost: 0,
      total: Math.max(0, actionCost.total - (actionCost.disconnectedTravelActionCost ?? 0))
    };
  }

  return {
    ...actionCost,
    originalTotal: actionCost.originalTotal ?? actionCost.total,
    placeActionCost: 0,
    total: Math.max(0, actionCost.total - (actionCost.placeActionCost ?? actionCost.total))
  };
}

function getUpgradeStewardPowerProviders(game, tile, tileIndex) {
  if (tile?.tile_source_type !== "Core") {
    return [];
  }

  return getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.FREE_CORE_UPGRADE_ACTION
  );
}

function getUpgradeStewardActionPreview(actionCost, provider) {
  if (!actionCost || !provider) {
    return actionCost;
  }

  return {
    ...actionCost,
    originalTotal: actionCost.originalTotal ?? actionCost.total,
    upgradeActionCost: 0,
    total: Math.max(0, actionCost.total - (actionCost.upgradeActionCost ?? actionCost.total))
  };
}

function getBurdenStewardPowerProviders(game, tileIndex) {
  return getAvailableStewardPowerProviders(
    game,
    { tileIndex },
    STEWARD_POWER_TYPES.FREE_BURDEN_RESOLUTION_ACTION
  );
}

function formatStewardPowerStatus(placedTile, tileDefinition, game) {
  const details = getStewardPowerDetails(tileDefinition);

  if (!details) {
    return "None";
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

  const selectedPayments = getStewardExchangePaymentChoices(placedTile.id, details);
  const selectedGains = getStewardExchangeGainChoices(placedTile.id, details);

  return `
    <div class="steward-exchange-controls">
      <label class="stacked-field activation-exchange-count">
        <span>Steward Exchange Count</span>
        <select id="steward-exchange-count" aria-label="Steward exchange count">
          ${Array.from({ length: details.maxAmount }, (_, index) => index + 1)
            .map(
              (amount) =>
                `<option value="${amount}" ${amount === selectedPayments.length ? "selected" : ""}>${amount}</option>`
            )
            .join("")}
        </select>
      </label>
      <div class="burden-payment-grid activation-payment-grid" aria-label="Steward exchange payment resources">
        ${selectedPayments
          .map(
            (selectedResource, index) => `
              <select class="steward-exchange-payment-resource" data-placed-tile-id="${escapeHtml(placedTile.id)}" data-payment-index="${index}" aria-label="Steward exchange payment resource ${index + 1}">
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
      <div class="burden-payment-grid activation-gain-grid" aria-label="Steward exchange gain resources">
        ${selectedGains
          .map(
            (selectedResource, index) => `
              <select class="steward-exchange-gain-resource" data-placed-tile-id="${escapeHtml(placedTile.id)}" data-gain-index="${index}" aria-label="Steward exchange gain resource ${index + 1}">
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
      <div class="button-row steward-power-buttons">
        <button id="use-steward-exchange" class="secondary-button" type="button" ${canUseStewardExchange ? "" : "disabled"}>Use Steward Power</button>
      </div>
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
              <span>${escapeHtml(player.name)}</span>
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
          const arrivalRequirementDiscountChoices = getArrivalRequirementDiscountChoices(
            activeState.id,
            arrivalRequirementDiscount
          );
          const arrivalRequirementDiscountReady =
            !arrivalRequirementDiscount ||
            activeState.encounterType !== ENCOUNTER_TYPES.ARRIVAL ||
            arrivalRequirementDiscountChoices.every((resource) => Boolean(resource));
          const canCompleteArrival =
            activeState.encounterType === ENCOUNTER_TYPES.ARRIVAL &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            Boolean(game.activePlayerId) &&
            arrivalRequirementDiscountReady;
          const canResolveBurden =
            activeState.encounterType === ENCOUNTER_TYPES.BURDEN &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            Boolean(game.activePlayerId) &&
            !burdenRevealChoice &&
            Boolean(burdenResolution?.supported) &&
            burdenPaymentReady &&
            burdenResolutionDiscountReady;
          const canResolveBurdenChoice =
            Boolean(burdenRevealChoice) &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
            canAffordCost(game.warehouse, getBurdenChoicePaymentCost(activeState));
          const canResolveBoon =
            Boolean(boonStrainRelief || boonExchange || boonStewardHelp || goldenScroll || goldenSignet) &&
            game.phase === GAME_PHASES.PLAYER_TURNS &&
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
                    ? `<button class="mini-action-button complete-arrival" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button">Complete</button>`
                    : ""
                }
                ${
                  burdenResolution?.supported
                    ? `<button class="mini-action-button resolve-burden" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button" ${canResolveBurden ? "" : "disabled"}>Resolve</button>`
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
                       ${boonStewardHelp ? "" : `<button class="mini-action-button skip-boon" data-active-encounter-id="${escapeHtml(activeState.id)}" type="button">Skip</button>`}`
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
  const mapOptions = state.data?.mapOptions ?? [];

  return `
    <section id="setup-panel" class="state-panel setup-panel">
      <h2>Setup</h2>
      ${
        mapOptions.length > 1
          ? `<label class="stacked-field">
              <span>Map</span>
              <select id="map-option" aria-label="Map option">
                ${mapOptions
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option.id)}" ${option.id === state.selectedMapId ? "selected" : ""}>${escapeHtml(option.name)}</option>`
                  )
                  .join("")}
              </select>
            </label>`
          : `<div class="setup-static-row">
              <span>Map</span>
              <strong>${escapeHtml(mapOptions[0]?.name ?? "Redesigned Basic Map v0.1")}</strong>
            </div>`
      }
      <label class="stacked-field">
        <span>Players</span>
        <select id="player-count" aria-label="Players">
          ${[1, 2, 3, 4]
            .map((count) => `<option value="${count}" ${count === state.playerCount ? "selected" : ""}>${count}</option>`)
            .join("")}
        </select>
      </label>
      ${renderStartingWarehouseReference()}
      <label class="stacked-field">
        <span>Seed</span>
        <input id="setup-seed" value="${escapeHtml(state.setupSeed)}" aria-label="Seed" />
      </label>
      <div class="button-row">
        <button id="new-game" class="primary-button" type="button">New Game</button>
        <button id="redeal-cards" class="secondary-button" type="button">Redeal Cards</button>
      </div>
      <details class="table-options">
        <summary>Table options</summary>
        <label class="toggle-row">
          <input id="reveal-hidden-setup" type="checkbox" ${state.revealHiddenSetup ? "checked" : ""} />
          <span>Reveal hidden Encounter cards</span>
        </label>
        <label class="toggle-row">
          <input id="show-debug-labels" type="checkbox" ${state.showDebugLabels ? "checked" : ""} />
          <span>Show terrain abbreviations</span>
        </label>
      </details>
    </section>
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
  const selectedLastInteractionPlayers = placedTile
    ? (getPlayersByLastInteraction(game).get(placedTile.id) ?? [])
    : [];
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
        <li><span>Active Player</span><strong>${escapeHtml(activePlayer?.name ?? "None")}</strong></li>
        <li><span>Actions Left</span><strong>${activePlayer ? `${activePlayer.actionsRemaining}/${game.rules.actionsPerPlayer}` : "0/0"}</strong></li>
        <li><span>Actions Each</span><strong>${game.rules.actionsPerPlayer}</strong></li>
        <li><span>Hidden Hands</span><strong>${hiddenCount}</strong></li>
      </ul>
      <h3>Deck Composition</h3>
      ${renderTypeChips(deckCounts)}
    </section>
  `;
}

function renderTestingBarAction(action, label, enabled, className = "secondary") {
  return `
    <button class="testing-action ${className}" data-quick-action="${escapeHtml(action)}" type="button" ${enabled ? "" : "disabled"}>
      ${escapeHtml(label)}
    </button>
  `;
}

function renderTestingBarResult(result) {
  if (!result) {
    return "";
  }

  const message = result.ok ? result.message : result.errors?.[0];

  if (!message) {
    return "";
  }

  return `
    <p class="testing-result ${result.ok ? "ok" : "bad"}">
      <b>${result.ok ? "Last action" : "Blocked"}</b>
      <span>${escapeHtml(message)}</span>
    </p>
  `;
}

function renderTestingBar(game, tileIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const selectedPlacedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const selectedTileName = selectedPlacedTile
    ? getTileNameByPlacedId(game, tileIndex, selectedPlacedTile.id)
    : "Empty hex";
  const seeded = game.encounter.seededRounds.includes(game.round);
  const revealed = game.encounter.revealedRounds.includes(game.round);
  const canSeed = game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded;
  const canReveal = game.phase === GAME_PHASES.REVEAL_ENCOUNTERS && !revealed;
  const canEndTurn = game.phase === GAME_PHASES.PLAYER_TURNS && Boolean(activePlayer);
  const canEndRound = game.phase === GAME_PHASES.END_ROUND;
  const stewardText = activePlayer ? formatPlayerLastInteraction(game, tileIndex, activePlayer) : "No active steward";

  return `
    <section class="testing-bar" aria-label="Play controls">
      <div class="testing-status">
        <span><b>${escapeHtml(formatPhase(game.phase))}</b></span>
        <span>Round <b>${game.round}/${game.rules.totalRounds}</b></span>
        <span>${escapeHtml(activePlayer?.name ?? "No active player")} <b>${activePlayer ? `${activePlayer.actionsRemaining}/${game.rules.actionsPerPlayer}` : "0/0"}</b></span>
        <span>Selected <b>${escapeHtml(`${selectedTileName} at ${state.selectedCoordinate}`)}</b></span>
        <span>Steward <b>${escapeHtml(stewardText)}</b></span>
      </div>
      <nav class="testing-jumps" aria-label="Prototype panel shortcuts">
        <a href="#map-panel">Map</a>
        <a href="#encounter-panel">Encounters</a>
        <a href="#placement-panel">Tiles</a>
        <a href="#selected-tile-panel">Map Tile</a>
        <a href="#warehouse-panel">Warehouse</a>
        <a href="#setup-panel">Setup</a>
      </nav>
      <div class="testing-actions">
        ${renderTestingBarAction("seed", "Seed", canSeed)}
        ${renderTestingBarAction("reveal", "Reveal", canReveal, "primary")}
        ${renderTestingBarAction("end-turn", "End Turn", canEndTurn, "primary")}
        ${renderTestingBarAction("end-round", "End Round", canEndRound)}
      </div>
      ${renderTestingBarResult(state.lastActionResult)}
    </section>
  `;
}

function renderTurnPanel(game, tileIndex) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const canEndTurn = game.phase === GAME_PHASES.PLAYER_TURNS && activePlayer;
  const canEndRound = game.phase === GAME_PHASES.END_ROUND;
  const endTurnLabel = activePlayer
    ? `End ${escapeHtml(activePlayer.name)} Turn`
    : game.phase === GAME_PHASES.COMPLETE
      ? "Game Complete"
      : "Player Turns Locked";
  const phaseNote = {
    [GAME_PHASES.SEED_ENCOUNTERS]: "Seed Encounter Cards before turns open.",
    [GAME_PHASES.REVEAL_ENCOUNTERS]: "Reveal Encounters before turns open.",
    [GAME_PHASES.END_ROUND]: "Resolve end-of-round effects to advance.",
    [GAME_PHASES.COMPLETE]: "The standard game is complete."
  }[game.phase];

  return `
    <section id="turn-panel" class="state-panel turn-panel">
      <h2>Turn</h2>
      <ul class="turn-list">
        ${game.players
          .map(
            (player) => `
              <li class="${player.id === game.activePlayerId ? "is-active" : ""}">
                <span class="turn-player">
                  <b>${escapeHtml(player.name)}</b>
                  <small>${escapeHtml(formatPlayerLastInteraction(game, tileIndex, player))}</small>
                </span>
                <strong>${player.actionsRemaining}/${game.rules.actionsPerPlayer}</strong>
              </li>
            `
          )
          .join("")}
      </ul>
      ${phaseNote ? `<p class="phase-note">${escapeHtml(phaseNote)}</p>` : ""}
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

function getDebugSeedSelection(player) {
  const selectedCardId = state.debugSeedSelections[player.id];
  return player.hand.includes(selectedCardId) ? selectedCardId : "";
}

function getDebugSeedSelectionsForAction(game) {
  return Object.fromEntries(
    game.players
      .map((player) => [player.id, getDebugSeedSelection(player)])
      .filter(([, cardId]) => Boolean(cardId))
  );
}

function renderSeedHandCard(card, player, game) {
  const selected = getDebugSeedSelection(player) === card.card_id;

  return `
    <div
      class="seed-hand-card type-${slug(card.encounter_type)} ${selected ? "is-selected" : ""}"
      data-seed-hand-card="true"
      data-player-id="${escapeHtml(player.id)}"
      data-card-id="${escapeHtml(card.card_id)}"
      tabindex="0"
      role="button"
      aria-label="${escapeHtml(`${player.name} ${card.card_name}`)}"
    >
      ${selected ? `<span class="seed-selected-badge">${escapeHtml(SEED_PACKET_POSITION_LABELS[state.debugSeedPosition] ?? "Selected")}</span>` : ""}
      ${renderEncounterFace(card, null, game, null, { extraClass: "seed-encounter-face" })}
    </div>
  `;
}

function renderSeedHandStrips(game, encounterIndex) {
  const seeded = game.encounter.seededRounds.includes(game.round);
  const canChoose = game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded;

  if (!canChoose) {
    return "";
  }

  return `
    <section class="stewards-seed-area" aria-label="Encounter card seeding">
      <header class="stewards-subheader">
        <h3>Seed Encounter Cards</h3>
        <strong>${escapeHtml(SEED_PACKET_POSITION_LABELS[state.debugSeedPosition])}</strong>
      </header>
      <div class="seed-player-grid">
        ${game.players
          .map((player) => {
            const cards = getCards(player.hand, encounterIndex);
            const selectedCard = encounterIndex.get(getDebugSeedSelection(player));

            return `
              <article class="seed-player-strip">
                <header>
                  <span>${escapeHtml(player.name)}</span>
                  <strong>${escapeHtml(selectedCard?.card_name ?? "Auto")}</strong>
                </header>
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
    <ol class="encounter-chronicle-list">
      ${recentReveals
        .map((entry) => {
          const card = encounterIndex.get(entry.data.cardId);

          return `
            <li class="encounter-chronicle-item type-${slug(card?.encounter_type ?? entry.data.encounterType)}">
              <header>
                <span>Round ${entry.round} - Season ${escapeHtml(entry.season)}</span>
                <strong>${escapeHtml(card?.card_name ?? entry.data.cardName ?? entry.data.cardId)}</strong>
              </header>
              ${renderEncounterFlavorText(card, { compact: true })}
              ${renderEncounterSourceText(card, entry.season, getRevealPrototypeText(entry.data))}
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
  const canSeed = game.phase === GAME_PHASES.SEED_ENCOUNTERS && !seeded;
  const canReveal = game.phase === GAME_PHASES.REVEAL_ENCOUNTERS && !revealed;
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
        <button id="seed-encounters" class="secondary-button" type="button" ${canSeed ? "" : "disabled"}>Seed Round</button>
        <button id="reveal-encounters" class="primary-button" type="button" ${canReveal ? "" : "disabled"}>Reveal Encounters</button>
      </div>

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

function renderWarehousePanel(game) {
  return `
    <section id="warehouse-panel" class="state-panel warehouse-panel">
      <h2>Warehouse</h2>
      <ul class="metric-list">
        ${Object.entries(game.warehouse.resources)
          .map(([resource, amount]) => `<li><span>${escapeHtml(resource)}</span><strong>${amount}/${game.warehouse.cap}</strong></li>`)
          .join("")}
      </ul>
    </section>
  `;
}

function renderCost(cost) {
  return cost.length === 0 ? "0" : cost.map(({ amount, resource }) => `${amount} ${resource}`).join(", ");
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

function parseResourceCostForDisplay(costText) {
  try {
    return {
      cost: parseResourceCost(costText),
      error: null
    };
  } catch (error) {
    return {
      cost: [],
      error
    };
  }
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

function renderActivationTargetControl(game, tileIndex, candidates, selectedTargetIds, maxTargets) {
  if (maxTargets <= 1) {
    return `
      <label class="stacked-field activation-target">
        <span>Target</span>
        <select id="activation-target" aria-label="Activation target" ${candidates.length ? "" : "disabled"}>
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
              : `<option>No strained adjacent tiles</option>`
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
                      <span>${escapeHtml(getTileNameByPlacedId(game, tileIndex, placedTile.id))} - ${placedTile.strain ?? 0} Strain</span>
                    </label>
                  `;
                })
                .join("")}
            </div>`
          : `<p class="empty-note">No strained adjacent tiles</p>`
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
  const selectedPlacedTile = getPlacedTileAt(game, state.selectedCoordinate);
  const selectedNetwork = selectedPlacedTile ? getNetworkForPlacedTile(networks, selectedPlacedTile.id) : null;
  const crossing = getRiverCrossingActionCost(game, state.selectedCoordinate, { tileIndex });
  const selectedTileSupported = isSupportedPlacedTile(selectedPlacedTile);
  const selectedSupportDetails = selectedPlacedTile
    ? getEffectiveSupportDetails(game, selectedPlacedTile.id, { tileIndex })
    : null;
  const selectedTileDefinition = selectedPlacedTile ? tileIndex.get(selectedPlacedTile.tileId) : null;
  const upgradeTile = selectedTileDefinition ? findUpgradeTile(selectedTileDefinition, tileIndex) : null;
  const upgradeCost = upgradeTile ? parseResourceCostForDisplay(upgradeTile.upgrade_cost) : null;
  const activationActionCost = selectedPlacedTile
    ? calculatePlacedTileActionCost(game, selectedPlacedTile, { tileIndex }, "activationActionCost")
    : null;
  const displayedActivationActionCost = activationActionCost
    ? getDiscountedDisconnectedTravelActionCost(game, "activation", activationActionCost).actionCost
    : null;
  const baseUpgradeActionCost = upgradeTile
    ? calculatePlacedTileActionCost(game, selectedPlacedTile, { tileIndex }, "upgradeActionCost")
    : null;
  const upgradeActionCost = upgradeTile
    ? getDiscountedDisconnectedTravelActionCost(
        game,
        "upgrade",
        getDiscountedTileActionCost(game, selectedTileDefinition, "upgrade", baseUpgradeActionCost).actionCost
      ).actionCost
    : null;
  const upgradeStewardPowerProviders = upgradeTile
    ? getUpgradeStewardPowerProviders(game, selectedTileDefinition, tileIndex)
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
  const upgradeLabel = upgradeTile
    ? `${upgradeTile.tile_name} (${upgradeCost?.error ? "unsupported cost" : renderCost(upgradeCost.cost)})`
    : "None";
  const selectedStewardPowerDetails = selectedTileDefinition ? getStewardPowerDetails(selectedTileDefinition) : null;
  const activation = selectedTileDefinition ? getActivationForDisplay(selectedTileDefinition) : null;
  const activationDetails = activation?.details ?? null;
  const activationLabel = activation?.error ? "Unsupported" : formatActivationDetails(activationDetails);
  const needsStrainActivationTarget = activationDetails?.type === "remove_strain_adjacent";
  const needsArrivalTimerTarget = activationDetails?.type === "add_arrival_timer";
  const needsBurdenTarget = activationDetails?.type === "resolve_active_burden";
  const needsExchangePayment =
    activationDetails?.type === "resource_exchange" || activationDetails?.type === "flexible_resource_exchange";
  const needsExchangeGain = activationDetails?.type === "flexible_resource_exchange";
  const activationMaxTargets = activationDetails?.maxTargets ?? 1;
  const activationTargetCandidates =
    needsStrainActivationTarget && selectedPlacedTile
      ? getAdjacentPlacedTiles(game, selectedPlacedTile).filter(
          (placedTile) =>
            (placedTile.strain ?? 0) > 0 &&
            matchesActivationTargetCategories(tileIndex, placedTile, activationDetails)
        )
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
  const selectedStewardExchangePayments =
    selectedPlacedTile && selectedStewardPowerDetails?.type === STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
      ? getStewardExchangePaymentChoices(selectedPlacedTile.id, selectedStewardPowerDetails)
      : [];
  const selectedStewardExchangeGains =
    selectedPlacedTile && selectedStewardPowerDetails?.type === STEWARD_POWER_TYPES.RESOURCE_EXCHANGE
      ? getStewardExchangeGainChoices(selectedPlacedTile.id, selectedStewardPowerDetails)
      : [];
  const stewardExchangeReady =
    selectedStewardPowerDetails?.type !== STEWARD_POWER_TYPES.RESOURCE_EXCHANGE ||
    (selectedStewardExchangePayments.every(Boolean) && selectedStewardExchangeGains.every(Boolean));
  const canUseStewardExchange =
    Boolean(selectedPlacedTile && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    selectedStewardPowerDetails?.type === STEWARD_POWER_TYPES.RESOURCE_EXCHANGE &&
    !isOverstrainedPlacedTile(selectedPlacedTile) &&
    !isStewardPowerUsedThisSeason(selectedPlacedTile, game.season) &&
    stewardExchangeReady &&
    canAffordCost(game.warehouse, getResourcePaymentAction(selectedStewardExchangePayments));
  const canActivate =
    Boolean(selectedPlacedTile && activationDetails && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    !isOverstrainedPlacedTile(selectedPlacedTile) &&
    (!needsStrainActivationTarget || selectedActivationTargetIds.length > 0) &&
    (!needsArrivalTimerTarget || Boolean(selectedArrivalTimerTargetId)) &&
    (!needsBurdenTarget || Boolean(selectedBurdenTargetId)) &&
    exchangePaymentReady &&
    exchangeGainReady;
  const canUpgrade =
    Boolean(selectedPlacedTile && upgradeTile && game.activePlayerId) &&
    game.phase === GAME_PHASES.PLAYER_TURNS &&
    !isOverstrainedPlacedTile(selectedPlacedTile) &&
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
        ? `<details id="selected-tile-panel" class="tile-selected-details" ${selectedPlacedTile ? "open" : ""}>
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
      ${renderTileSourceText(selectedTileDefinition, "Selected Tile Says")}
      ${renderTileSourceText(upgradeTile, "Upgrade Side Says")}
      ${
        needsStrainActivationTarget
          ? renderActivationTargetControl(
              game,
              tileIndex,
              activationTargetCandidates,
              selectedActivationTargetIds,
              activationMaxTargets
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
      ${renderStewardExchangeControls(game, selectedPlacedTile, selectedStewardPowerDetails, canUseStewardExchange)}
      ${renderStewardPowerSelect({
        id: "steward-upgrade-power",
        label: "Upgrade Steward Power",
        providers: upgradeStewardPowerProviders,
        selectedId: selectedUpgradeStewardPowerId
      })}
      ${renderUpgradeCostDiscountChoices(selectedPlacedTile, selectedTileDefinition, upgradeCost, upgradeResourceDiscount)}
      ${
        selectedPlacedTile
          ? `<div class="button-row">
              <button id="activate-selected" class="primary-button" type="button" ${canActivate ? "" : "disabled"}>Activate</button>
              <button id="upgrade-selected" class="primary-button" type="button" ${canUpgrade ? "" : "disabled"}>Upgrade</button>
              <button id="apply-strain-selected" class="secondary-button" type="button">Apply Strain</button>
              <button id="support-selected" class="secondary-button" type="button">${selectedTileSupported ? "Remove Support" : "Give Support"}</button>
              <button id="overstrain-selected" class="secondary-button" type="button">Set 3 Strain</button>
              <button id="clear-strain-selected" class="secondary-button" type="button">Clear Strain</button>
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

function renderTilePlacementPanel(game, tileIndex, encounterIndex) {
  const options = getPlacementOptions();
  const selectedTile = tileIndex.get(state.selectedTileId);
  const selectedSupply = [...game.tileSupply.core, ...game.tileSupply.special].find(
    (entry) => entry.tileId === state.selectedTileId
  );
  const cost = selectedTile ? parseResourceCost(selectedTile.place_cost) : [];
  const footprint = selectedTile
    ? getFootprintCoordinates(state.selectedCoordinate, selectedTile.size_hexes, state.selectedOrientation, game.map.hexes)
    : null;
  const baseActionCost = footprint ? calculatePlacementActionCost(game, footprint, { tileIndex }) : null;
  const actionCost =
    baseActionCost && selectedTile
      ? getDiscountedDisconnectedTravelActionCost(
          game,
          "placement",
          getDiscountedTileActionCost(game, selectedTile, "placement", baseActionCost).actionCost
        ).actionCost
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
  const canPlace =
    Boolean(selectedTile && activePlayer && game.phase === GAME_PHASES.PLAYER_TURNS) && placementCostDiscountReady;
  const selectedTileSize = Number(selectedTile?.size_hexes ?? 1);
  const selectedTileCost = selectedTile ? renderCost(cost) : "0";

  return `
    <section id="placement-panel" class="state-panel placement-panel tile-console-panel">
      <header class="tile-console-header">
        <h2>Tiles</h2>
        <span>${escapeHtml(activePlayer ? `${activePlayer.actionsRemaining}/${game.rules.actionsPerPlayer} Actions` : "No active Steward")}</span>
      </header>
      <div class="tile-console-grid">
        ${renderTileChoiceButtons(options)}
        <article class="tile-place-card type-${slug(selectedTile?.tile_category ?? "none")}">
          <header>
            <span>Tile to Place</span>
            <strong>${escapeHtml(selectedTile?.tile_name ?? "None")}</strong>
            <small>${escapeHtml(`${selectedSupply?.available ?? 0}/${selectedSupply?.stock ?? 0} left · ${selectedTileSize} hex${selectedTileSize === 1 ? "" : "es"} · ${selectedTileCost}`)}</small>
          </header>
          ${
            selectedTileSize > 1
              ? `<label class="stacked-field compact-field">
                  <span>Rotation</span>
                  <select id="tile-orientation" aria-label="Tile rotation">
                    ${HEX_DIRECTIONS.map(
                      (direction) =>
                        `<option value="${escapeHtml(direction.id)}" ${direction.id === state.selectedOrientation ? "selected" : ""}>${escapeHtml(direction.label)}</option>`
                    ).join("")}
                  </select>
                </label>`
              : ""
          }
          <dl class="detail-list compact-details">
            <div><dt>Target</dt><dd>${escapeHtml(state.selectedCoordinate)}</dd></div>
            <div><dt>Footprint</dt><dd>${escapeHtml(renderFootprint(footprint))}</dd></div>
            <div><dt>Connection</dt><dd>${actionCost ? (actionCost.connected ? "Connected" : "Disconnected") : "N/A"}</dd></div>
            <div><dt>Action Cost</dt><dd>${escapeHtml(renderActionCost(displayedActionCost))}</dd></div>
          </dl>
          ${renderTileSourceText(selectedTile)}
        </article>
      </div>
      ${renderStewardPowerSelect({
        id: "steward-placement-power",
        label: "Placement Steward Power",
        providers: placementStewardPowerProviders,
        selectedId: selectedPlacementStewardPowerId
      })}
      ${renderPlacementCostDiscountChoices(selectedTile, cost, placementResourceDiscount)}
      <div class="button-row">
        <button id="place-tile" class="primary-button" type="button" ${canPlace ? "" : "disabled"}>Place on Selected Hex</button>
        <button id="fill-warehouse" class="secondary-button" type="button">Fill Warehouse</button>
        <button id="reset-actions" class="secondary-button" type="button">Reset Actions</button>
      </div>
      ${renderPlacementResult(state.lastActionResult)}
      ${renderTravelNetworksPanel(game, tileIndex, encounterIndex, { embedded: true })}
    </section>
  `;
}

function renderTileChoiceButtons(options) {
  if (options.length === 0) {
    return `<p class="empty-note">No tiles available to place.</p>`;
  }

  return `
    <div class="tile-choice-list" aria-label="Tile choices">
      ${options
        .map(({ tile, supply }) => {
          const disabled = !supply || supply.available <= 0;
          const selected = tile.tile_id === state.selectedTileId;
          const cost = renderSourceResourceCost(tile.place_cost) || "0";
          const size = Number(tile.size_hexes ?? 1);

          return `
            <button
              class="tile-choice-button type-${slug(tile.tile_category)} ${selected ? "is-selected" : ""}"
              data-tile-choice-id="${escapeHtml(tile.tile_id)}"
              type="button"
              ${disabled ? "disabled" : ""}
            >
              <span>${escapeHtml(tile.tile_category)}</span>
              <strong>${escapeHtml(tile.tile_name)}</strong>
              <small>${escapeHtml(`${supply?.available ?? 0}/${supply?.stock ?? 0} left · ${size} hex${size === 1 ? "" : "es"} · ${cost}`)}</small>
            </button>
          `;
        })
        .join("")}
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
  return state.simulation.botProfile === "all"
    ? Object.keys(SIMULATION_BOT_PROFILES)
    : [state.simulation.botProfile];
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
  return getSimulationBotProfiles().length * getSimulationPlayerCounts().length * 100;
}

function getSimulationAverages(result) {
  const rows = result?.game_rows ?? [];

  if (rows.length === 0) {
    return {
      finalScore: 0,
      strainPlaced: 0,
      strainRemoved: 0,
      overstrainedRounds: 0
    };
  }

  const average = (key) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length;

  return {
    finalScore: average("final_score"),
    strainPlaced: average("total_strain_placed"),
    strainRemoved: average("total_strain_removed"),
    overstrainedRounds: average("rounds_with_at_least_one_overstrained_tile")
  };
}

function renderSimulationPanel() {
  const result = state.simulation.result;
  const averages = getSimulationAverages(result);
  const errorCount = result?.errors?.length ?? 0;

  return `
    <section id="simulation-panel" class="state-panel wide-panel simulation-panel">
      <h2>Automated Playtest Simulation</h2>
      <div class="simulation-controls">
        <label class="stacked-field">
          <span>Bot profile</span>
          <select id="simulation-bot-profile">
            <option value="balanced" ${state.simulation.botProfile === "balanced" ? "selected" : ""}>Balanced Bot</option>
            <option value="builder" ${state.simulation.botProfile === "builder" ? "selected" : ""}>Builder Bot</option>
            <option value="careful" ${state.simulation.botProfile === "careful" ? "selected" : ""}>Careful Bot</option>
            <option value="all" ${state.simulation.botProfile === "all" ? "selected" : ""}>All profiles</option>
          </select>
        </label>
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
        <button id="run-simulations" class="primary-button" type="button">Run 100 simulations</button>
        <button id="export-simulation-csv" class="secondary-button" type="button" ${result ? "" : "disabled"}>Export CSV</button>
        <button id="export-simulation-json" class="secondary-button" type="button" ${result ? "" : "disabled"}>Export JSON</button>
      </div>
      <p class="mini-copy">Current settings will run ${getSimulationRunSize()} complete game${getSimulationRunSize() === 1 ? "" : "s"}.</p>
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
              <li><span>Avg Strain Placed</span><strong>${averages.strainPlaced.toFixed(1)}</strong></li>
              <li><span>Avg Strain Removed</span><strong>${averages.strainRemoved.toFixed(1)}</strong></li>
              <li><span>Avg Overstrained Rounds</span><strong>${averages.overstrainedRounds.toFixed(1)}</strong></li>
              <li><span>Errors</span><strong>${errorCount}</strong></li>
            </ul>`
          : ""
      }
    </section>
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

  state.simulation = {
    ...state.simulation,
    result: null,
    message: "Running simulations..."
  };
  renderApp();

  setTimeout(() => {
    try {
      const result = runSimulationBatch({
        gamesPerCombination: 100,
        playerCounts: getSimulationPlayerCounts(),
        botProfiles: getSimulationBotProfiles(),
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

function renderActionLog(game, encounterIndex, tileIndex) {
  return `
    <section class="state-panel wide-panel">
      <h2>Action Log</h2>
      <ol class="log-list">
        ${game.log
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

  return `
    <section class="game-dashboard support-dashboard">
      ${renderGameStatus(game, encounterIndex)}
      ${renderTurnPanel(game, tileIndex)}
      ${renderScorePanel(game)}
      ${renderTileSupplyPanel(game)}
      ${renderActionLog(game, encounterIndex, tileIndex)}
    </section>
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
  const selectedMapOption = getSelectedMapOption();
  const encounterIndex = createEncounterIndex(state.data.encounterCards);
  const tileIndex = createTileIndex(state.data.tiles);

  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <div>
          <p class="eyebrow">Local Prototype</p>
          <h1>The Quiet Vale</h1>
        </div>
        <div class="approval-pill">
          <span>${escapeHtml(selectedMapOption?.status ?? "Default prototype map")}</span>
          <strong>${escapeHtml(selectedMapOption?.name ?? "Redesigned Basic Map v0.1")}</strong>
        </div>
      </header>
      ${renderTestingBar(state.game, tileIndex)}
      <section class="play-layout">
        <section class="play-top-grid">
          <section class="play-main-column" aria-label="Map and Encounter area">
            <section id="map-panel" class="map-panel" aria-label="Map panel">
              <header class="map-panel-header">
                <h2>Map</h2>
                ${renderMapKey()}
              </header>
              ${renderHexMap(state.data.mapHexes, state.game, tileIndex)}
            </section>
            ${renderEncounterPanel(state.game, encounterIndex)}
          </section>
          <aside class="play-side-rail" aria-label="Primary play controls">
            ${renderWarehousePanel(state.game)}
            ${renderTilePlacementPanel(state.game, tileIndex, encounterIndex)}
            ${renderSetupControls()}
          </aside>
        </section>
        ${renderGameDashboard(state.game, encounterIndex)}
        <section class="play-bottom-tools" aria-label="Automated analysis tools">
          ${renderSimulationPanel()}
        </section>
      </section>
      ${renderMapContextLayer(state.game, tileIndex)}
      ${renderSeedCardContextLayer(encounterIndex)}
    </main>
  `;

  bindEvents();
}

function selectCoordinate(coordinate) {
  state.selectedCoordinate = coordinate;
  state.contextMenu = null;
  state.seedContextMenu = null;
  renderApp();
}

function rotateSelectedPlacementTileAt(coordinate) {
  const tileIndex = createTileIndex(state.data.tiles);
  const selectedTile = getSelectedPlacementTile(tileIndex);

  state.selectedCoordinate = coordinate;
  state.contextMenu = null;
  state.seedContextMenu = null;

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

  event.preventDefault();
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

function selectSeedCardPosition(playerId, cardId, seedPosition) {
  state.debugSeedSelections = {
    ...state.debugSeedSelections,
    [playerId]: cardId
  };
  state.debugSeedPosition = seedPosition;
  state.seedContextMenu = null;
  state.lastActionResult = {
    ok: true,
    action: "SELECT_SEED_CARD",
    message: `Selected ${getEncounterCardName(cardId)} for ${getPlayerName(playerId)}; seed packet position ${SEED_PACKET_POSITION_LABELS[seedPosition] ?? seedPosition}.`
  };
  renderApp();
}

function getPlayerName(playerId) {
  return state.game?.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function getEncounterCardName(cardId) {
  return state.data?.encounterCards.find((card) => card.card_id === cardId)?.card_name ?? cardId;
}

function upgradePlacedTile(placedTileId) {
  const placedTile = state.game.map.placedTiles.find((candidate) => candidate.id === placedTileId);
  const tileIndex = createTileIndex(state.data.tiles);
  const tileDefinition = placedTile ? tileIndex.get(placedTile.tileId) : null;
  const upgradeTile = tileDefinition ? findUpgradeTile(tileDefinition, tileIndex) : null;
  const upgradeCost = upgradeTile ? parseResourceCostForDisplay(upgradeTile.upgrade_cost) : null;
  const upgradeResourceDiscount = getPendingUpgradeResourceDiscount(state.game, tileDefinition);
  const upgradeStewardPowerProviders = upgradeTile
    ? getUpgradeStewardPowerProviders(state.game, tileDefinition, tileIndex)
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
      upgradeCostReductionResources:
        placedTile && upgradeCost && !upgradeCost.error
          ? getUpgradeCostDiscountAction(placedTile.id, upgradeCost.cost, upgradeResourceDiscount)
          : []
    },
    { tiles: state.data.tiles }
  );

  state.game = nextGame;
  state.lastActionResult = result;
  state.contextMenu = null;

  if (result.ok && placedTile) {
    delete state.upgradeCostDiscounts[placedTile.id];
    state.stewardUpgradePowerId = "";
  }

  renderApp();
}

function activatePlacedTile(placedTileId) {
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
      const targetCandidates = getAdjacentPlacedTiles(state.game, placedTile).filter(
        (candidate) =>
          (candidate.strain ?? 0) > 0 &&
          matchesActivationTargetCategories(tileIndex, candidate, activationDetails)
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
      gains
    },
    { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
  );

  state.game = nextGame;
  state.lastActionResult = result;
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
  }

  renderApp();
}

function placeSelectedTile() {
  const tile = state.data.tiles.find((candidate) => candidate.tile_id === state.selectedTileId);
  const cost = tile ? parseResourceCost(tile.place_cost) : [];
  const placementResourceDiscount = getPendingPlacementResourceDiscount(state.game, tile);
  const tileIndex = createTileIndex(state.data.tiles);
  const footprint = tile
    ? getFootprintCoordinates(state.selectedCoordinate, tile.size_hexes, state.selectedOrientation, state.game.map.hexes)
    : null;
  const baseActionCost = footprint ? calculatePlacementActionCost(state.game, footprint, { tileIndex }) : null;
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
      placementCostReductionResources: getPlacementCostDiscountAction(
        state.selectedTileId,
        cost,
        placementResourceDiscount
      )
    },
    { tiles: state.data.tiles }
  );

  state.game = nextGame;
  state.lastActionResult = result;
  state.contextMenu = null;

  if (result.ok) {
    delete state.placementCostDiscounts[state.selectedTileId];
    state.stewardPlacementPowerId = "";
  }

  syncSelectedTile();
  renderApp();
}

function placeTileFromContext(tileId, coordinate, orientation, placementCostReductionResources = []) {
  const placementCostDiscounts = { ...state.placementCostDiscounts };

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
  placeSelectedTile();
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

  if (actionName === "seed") {
    outcome = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        seedSelections: getDebugSeedSelectionsForAction(state.game),
        seedPosition: state.debugSeedPosition
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

  state.game = outcome.state;
  state.lastActionResult = outcome.result;
  renderApp();
}

function bindEvents() {
  root.querySelectorAll("[data-coordinate]").forEach((element) => {
    element.addEventListener("click", () => selectCoordinate(element.dataset.coordinate));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCoordinate(element.dataset.coordinate);
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
      const discountResources = (button.dataset.contextPlaceDiscounts ?? "").split("|").filter(Boolean);

      placeTileFromContext(
        button.dataset.contextPlaceTileId,
        button.dataset.contextPlaceCoordinate,
        button.dataset.contextPlaceOrientation,
        discountResources
      );
    });
  });

  root.querySelectorAll("[data-seed-hand-card]").forEach((cardElement) => {
    cardElement.addEventListener("contextmenu", (event) =>
      openSeedCardContextMenu(event, cardElement.dataset.playerId, cardElement.dataset.cardId)
    );
    cardElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSeedCardContextMenu(event, cardElement.dataset.playerId, cardElement.dataset.cardId);
      }
    });
  });

  root.querySelectorAll("[data-seed-position]").forEach((button) => {
    button.addEventListener("click", () =>
      selectSeedCardPosition(button.dataset.seedPlayerId, button.dataset.seedCardId, button.dataset.seedPosition)
    );
  });

  root.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", () => runQuickAction(button.dataset.quickAction));
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
    state.playerCount = Number(event.target.value);
    createGame();
    renderApp();
  });

  root.querySelector("#map-option")?.addEventListener("change", (event) => {
    state.selectedMapId = event.target.value;
    refreshActiveMapData();
    syncSelectedCoordinate();
    createGame();
    renderApp();
  });

  root.querySelector("#setup-seed")?.addEventListener("input", (event) => {
    state.setupSeed = event.target.value;
  });

  root.querySelector("#new-game")?.addEventListener("click", () => {
    createGame();
    renderApp();
  });

  root.querySelector("#redeal-cards")?.addEventListener("click", () => {
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

  root.querySelector("#place-tile")?.addEventListener("click", placeSelectedTile);

  root.querySelectorAll(".tile-choice-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTileId = button.dataset.tileChoiceId;
      state.lastActionResult = null;
      renderApp();
    });
  });

  root.querySelector("#steward-placement-power")?.addEventListener("change", (event) => {
    state.stewardPlacementPowerId = event.target.value;
    renderApp();
  });

  root.querySelector("#fill-warehouse")?.addEventListener("click", () => {
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_FILL_WAREHOUSE
      },
      { tiles: state.data.tiles }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#end-turn")?.addEventListener("click", () => {
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.END_TURN
      },
      { tiles: state.data.tiles }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#end-round")?.addEventListener("click", () => {
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.END_ROUND
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#reset-actions")?.addEventListener("click", () => {
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.DEBUG_RESET_ACTIONS
      },
      { tiles: state.data.tiles }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#seed-encounters")?.addEventListener("click", () => {
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.SEED_ENCOUNTERS,
        seedSelections: getDebugSeedSelectionsForAction(state.game),
        seedPosition: state.debugSeedPosition
      },
      { tiles: state.data.tiles }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    if (result.ok) {
      state.debugSeedSelections = {};
      state.seedContextMenu = null;
    }
    renderApp();
  });

  root.querySelector("#reveal-encounters")?.addEventListener("click", () => {
    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.REVEAL_ENCOUNTERS
      },
      { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelectorAll(".complete-arrival").forEach((button) => {
    button.addEventListener("click", () => {
      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.COMPLETE_ARRIVAL,
          activeEncounterId: button.dataset.activeEncounterId,
          arrivalRequirementReductionResources: getArrivalRequirementDiscountAction(button.dataset.activeEncounterId)
        },
        { tiles: state.data.tiles, encounterCards: state.data.encounterCards }
      );
      state.game = nextGame;
      state.lastActionResult = result;
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
      state.game = nextGame;
      state.lastActionResult = result;
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
      state.game = nextGame;
      state.lastActionResult = result;
      if (result.ok) {
        delete state.burdenPayments[activeEncounterId];
        delete state.burdenChoiceDecisions[activeEncounterId];
        delete state.burdenResolutionDiscounts[activeEncounterId];
        delete state.stewardBurdenPowerIds[activeEncounterId];
      }
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
      state.game = nextGame;
      state.lastActionResult = result;
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
      state.game = nextGame;
      state.lastActionResult = result;
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

  root.querySelectorAll(".placement-cost-discount-resource").forEach((select) => {
    select.addEventListener("change", () => {
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

  root.querySelector("#steward-exchange-count")?.addEventListener("change", (event) => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    const amount = Number(event.target.value);

    if (!placedTile) {
      return;
    }

    state.stewardExchangeAmounts = {
      ...state.stewardExchangeAmounts,
      [placedTile.id]: amount
    };
    state.stewardExchangePayments = {
      ...state.stewardExchangePayments,
      [placedTile.id]: (state.stewardExchangePayments[placedTile.id] ?? []).slice(0, amount)
    };
    state.stewardExchangeGains = {
      ...state.stewardExchangeGains,
      [placedTile.id]: (state.stewardExchangeGains[placedTile.id] ?? []).slice(0, amount)
    };
    renderApp();
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

  root.querySelector("#use-steward-exchange")?.addEventListener("click", () => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);

    if (!placedTile) {
      return;
    }

    const { state: nextGame, result } = dispatchGameAction(
      state.game,
      {
        type: TILE_ACTION_TYPES.USE_STEWARD_POWER,
        placedTileId: placedTile.id,
        payment: getResourcePaymentAction(state.stewardExchangePayments[placedTile.id] ?? []),
        gains: getResourcePaymentAction(state.stewardExchangeGains[placedTile.id] ?? [])
      },
      { tiles: state.data.tiles }
    );
    state.game = nextGame;
    state.lastActionResult = result;
    if (result.ok) {
      const stewardExchangePayments = { ...state.stewardExchangePayments };
      delete stewardExchangePayments[placedTile.id];
      state.stewardExchangePayments = stewardExchangePayments;
      const stewardExchangeGains = { ...state.stewardExchangeGains };
      delete stewardExchangeGains[placedTile.id];
      state.stewardExchangeGains = stewardExchangeGains;
      const stewardExchangeAmounts = { ...state.stewardExchangeAmounts };
      delete stewardExchangeAmounts[placedTile.id];
      state.stewardExchangeAmounts = stewardExchangeAmounts;
    }
    renderApp();
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

  root.querySelector("#activate-selected")?.addEventListener("click", () => {
    const placedTile = getPlacedTileAt(state.game, state.selectedCoordinate);
    activatePlacedTile(placedTile?.id);
  });

  root.querySelector("#apply-strain-selected")?.addEventListener("click", () => {
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
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#support-selected")?.addEventListener("click", () => {
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
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#overstrain-selected")?.addEventListener("click", () => {
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
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#clear-strain-selected")?.addEventListener("click", () => {
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
    state.game = nextGame;
    state.lastActionResult = result;
    renderApp();
  });

  root.querySelector("#reveal-hidden-setup")?.addEventListener("change", (event) => {
    state.revealHiddenSetup = event.target.checked;
    renderApp();
  });

  root.querySelector("#show-debug-labels")?.addEventListener("change", (event) => {
    state.showDebugLabels = event.target.checked;
    renderApp();
  });

  root.querySelectorAll(".debug-player-marker").forEach((select) => {
    select.addEventListener("change", () => {
      const { state: nextGame, result } = dispatchGameAction(
        state.game,
        {
          type: TILE_ACTION_TYPES.DEBUG_SET_PLAYER_MARKER,
          playerId: select.dataset.playerId,
          placedTileId: select.value
        },
        { tiles: state.data.tiles }
      );
      state.game = nextGame;
      state.lastActionResult = result;
      renderApp();
    });
  });
}

renderApp();

loadData()
  .then((data) => {
    state.data = data;
    createGame();
    renderApp();
  })
  .catch((error) => {
    state.error = error;
    renderApp();
  });
