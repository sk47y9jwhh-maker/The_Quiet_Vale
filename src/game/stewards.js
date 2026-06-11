import { createTileIndex, isOverstrainedPlacedTile } from "./tiles.js";

export const STEWARD_ROLES = Object.freeze([
  Object.freeze({
    id: "vanguard",
    name: "Vanguard",
    houseTileId: "core_vanguard_house_basic",
    houseTerrainOptions: Object.freeze(["Woodland"]),
    tokenPlacementSummary: "Place Vanguard token on Woodland",
    startingBenefit: "First Travel Tile or Resource Tile placement costs 1 fewer resource.",
    objectiveSummary: "+5 Renown if the settlement has non-Overstrained tiles on both sides of the river connected by a Bridge.",
    openingResourceTileIds: Object.freeze(["core_forest_basic"]),
    openingSummary: "First Travel or Resource placement costs 1 fewer resource"
  }),
  Object.freeze({
    id: "sentinel",
    name: "Sentinel",
    houseTileId: "core_sentinel_house_basic",
    houseTerrainOptions: Object.freeze(["Mountains"]),
    tokenPlacementSummary: "Place Sentinel token on Mountains",
    startingBenefit: "First upgrade costs 1 fewer resource.",
    objectiveSummary: "+5 Renown if the settlement contains 5+ upgraded non-Overstrained Core Tiles.",
    openingResourceTileIds: Object.freeze(["core_mine_basic"]),
    openingSummary: "First upgrade costs 1 fewer resource"
  }),
  Object.freeze({
    id: "ranger",
    name: "Ranger",
    houseTileId: "core_ranger_house_basic",
    houseTerrainOptions: Object.freeze(["Heaths"]),
    tokenPlacementSummary: "Place Ranger token on Heaths or an empty non-River hex adjacent to Heaths",
    startingBenefit: "May place the setup token on any empty non-River hex adjacent to Heaths.",
    objectiveSummary: "+5 Renown if the settlement has tiles on 3+ non-Grasslands terrain types.",
    openingResourceTileIds: Object.freeze(["core_wildlands_basic"]),
    openingSummary: "May start adjacent to Heaths"
  }),
  Object.freeze({
    id: "knight",
    name: "Knight",
    houseTileId: "core_knight_house_basic",
    houseTerrainOptions: Object.freeze(["Arable Land"]),
    tokenPlacementSummary: "Place Knight token on Arable Land",
    startingBenefit: "First Housing placement costs 1 fewer resource.",
    objectiveSummary: "+5 Renown if the settlement contains a Housing cluster of 4+ non-Overstrained Housing Tiles.",
    openingResourceTileIds: Object.freeze(["core_farm_basic"]),
    openingSummary: "First Housing placement costs 1 fewer resource"
  }),
  Object.freeze({
    id: "warden",
    name: "Warden",
    houseTileId: "core_warden_house_basic",
    houseTerrainOptions: Object.freeze(["Ruins"]),
    tokenPlacementSummary: "Place Warden token on Ruins",
    startingBenefit: "After the first tile is placed, it gains Supported.",
    objectiveSummary: "+5 Renown if there are no active Burdens.",
    openingResourceTileIds: Object.freeze(["core_dig_site_basic"]),
    openingSummary: "First placed tile gains Supported"
  }),
  Object.freeze({
    id: "quartermaster",
    name: "Quartermaster",
    houseTileId: "core_quartermaster_house_basic",
    houseTerrainOptions: Object.freeze(["Woodland", "Mountains", "Heaths", "Arable Land", "Ruins"]),
    tokenPlacementSummary: "Place Quartermaster token on any Steward terrain",
    startingBenefit: "Before Season I seeding, exchange up to 2 Warehouse resources for resources of any type.",
    objectiveSummary: "+5 Renown if the Warehouse has 5+ resources in at least 4 resource types.",
    openingResourceTileIds: Object.freeze([
      "core_forest_basic",
      "core_mine_basic",
      "core_wildlands_basic",
      "core_farm_basic",
      "core_dig_site_basic"
    ]),
    openingSummary: "May exchange up to 2 resources before Season I seeding"
  })
]);

export const DEFAULT_STEWARD_ROLE_IDS = Object.freeze(
  STEWARD_ROLES.map((role) => role.id)
);

const STEWARD_ROLE_INDEX = new Map(STEWARD_ROLES.map((role) => [role.id, role]));

export const STEWARD_POWER_TYPES = Object.freeze({
  FREE_PLACEMENT_ACTION: "free_placement_action",
  FREE_CORE_UPGRADE_ACTION: "free_core_upgrade_action",
  IGNORE_DISCONNECTED_TRAVEL_ACTION: "ignore_disconnected_travel_action",
  RESOURCE_EXCHANGE: "resource_exchange",
  FREE_BURDEN_RESOLUTION_ACTION: "free_burden_resolution_action",
  SUPPRESS_BURDEN: "suppress_burden"
});

export function getStewardRole(roleId) {
  return STEWARD_ROLE_INDEX.get(roleId) ?? null;
}

export function getStewardRoleName(roleId) {
  return getStewardRole(roleId)?.name ?? "Steward";
}

export function normalizeStewardRoleIds(playerCount, roleIds = []) {
  const normalized = [];
  const used = new Set();
  const requested = Array.isArray(roleIds) ? roleIds : [];

  for (let index = 0; index < playerCount; index += 1) {
    const requestedRoleId = requested[index];
    const requestedRole = getStewardRole(requestedRoleId);

    if (requestedRole && !used.has(requestedRole.id)) {
      normalized.push(requestedRole.id);
      used.add(requestedRole.id);
      continue;
    }

    const fallbackRoleId =
      DEFAULT_STEWARD_ROLE_IDS.find((roleId) => !used.has(roleId)) ?? DEFAULT_STEWARD_ROLE_IDS[0];

    normalized.push(fallbackRoleId);
    used.add(fallbackRoleId);
  }

  return normalized;
}

export function getUnlockedStewardHouseTileIds(roleIds = []) {
  return roleIds.map((roleId) => getStewardRole(roleId)?.houseTileId).filter(Boolean);
}

export function isStewardHouseTileUnlockedForRoles(tileId, roleIds = []) {
  return getUnlockedStewardHouseTileIds(roleIds).includes(tileId);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getStewardHouseRole(tile) {
  if (tile?.subtype !== "Steward House") {
    return null;
  }

  return (
    STEWARD_ROLES.find((role) => tile.tile_id === role.houseTileId) ??
    STEWARD_ROLES.find((role) =>
      new RegExp(`\\b${escapeRegExp(role.name)}\\s+only\\b`, "i").test(tile.placement_rules ?? "")
    ) ??
    STEWARD_ROLES.find((role) =>
      new RegExp(`\\b${escapeRegExp(role.name)}\\b`, "i").test(tile.tile_name ?? "")
    ) ??
    null
  );
}

export function isStewardHouseTileForPlayer(tile, player) {
  const role = getStewardHouseRole(tile);

  return Boolean(role && player?.stewardRoleId === role.id);
}

export function isStewardHousePlacementTerrainForRole(role, terrain) {
  return Boolean(role?.houseTerrainOptions?.includes(terrain));
}

export function getPendingStewardHousePlacement(state, playerId = state.activePlayerId) {
  if (
    state.stewardHousePlacementRequired !== true ||
    state.phase !== "place_steward_houses"
  ) {
    return null;
  }

  const player = state.players.find((candidate) => candidate.id === playerId);

  if (!player || player.stewardHousePlacement?.completed) {
    return null;
  }

  const role = getStewardRole(player.stewardRoleId);

  if (!role) {
    return null;
  }

  return {
    player,
    role,
    tileId: null,
    terrainOptions: [...(role.houseTerrainOptions ?? [])],
    summary: role.tokenPlacementSummary ?? role.housePlacementSummary
  };
}

export function markStewardHousePlacementComplete(player, placedToken) {
  const role = getStewardRole(player?.stewardRoleId);

  if (!role || !placedToken?.coordinate) {
    return player;
  }

  return {
    ...player,
    stewardHousePlacement: {
      ...(player.stewardHousePlacement ?? {}),
      completed: true,
      placedTileId: null,
      tileId: null,
      coordinate: placedToken.coordinate,
      tokenCoordinate: placedToken.coordinate
    }
  };
}

export function getPendingOpeningResourcePlacement(state, playerId = state.activePlayerId) {
  if (
    state.openingResourcePlacementRequired !== true ||
    state.round !== 1 ||
    state.phase !== "player_turns" ||
    !(state.encounter?.revealedRounds ?? []).includes(1)
  ) {
    return null;
  }

  const player = state.players.find((candidate) => candidate.id === playerId);

  if (!player || player.openingResourcePlacement?.completed) {
    return null;
  }

  const role = getStewardRole(player.stewardRoleId);

  if (!role) {
    return null;
  }

  return {
    player,
    role,
    tileIds: [...role.openingResourceTileIds],
    summary: role.openingSummary
  };
}

export function isOpeningResourceTileForPlayer(player, tileId) {
  const role = getStewardRole(player?.stewardRoleId);

  return Boolean(role?.openingResourceTileIds.includes(tileId));
}

export function markOpeningResourcePlacementComplete(player, placedTile) {
  if (!isOpeningResourceTileForPlayer(player, placedTile?.tileId)) {
    return player;
  }

  return {
    ...player,
    openingResourcePlacement: {
      ...(player.openingResourcePlacement ?? {}),
      completed: true,
      placedTileId: placedTile.id,
      tileId: placedTile.tileId,
      coordinate: placedTile.coordinate ?? placedTile.coordinates?.[0] ?? null
    }
  };
}

export function getStewardPowerDetails(tile) {
  if (tile?.subtype !== "Steward House" || tile.side !== "Upgraded") {
    return null;
  }

  const benefit = String(tile.benefit ?? "");

  if (/when you place a Travel Tile or Resource Tile, you may place it without spending an Action/i.test(benefit)) {
    return {
      type: STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION,
      categories: ["Travel", "Resource"],
      label: "Free Travel/Resource placement"
    };
  }

  if (/when you place a Housing Tile, you may place it without spending an Action/i.test(benefit)) {
    return {
      type: STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION,
      categories: ["Housing"],
      label: "Free Housing placement"
    };
  }

  if (/when you upgrade a Core Tile, you may upgrade it without spending an Action/i.test(benefit)) {
    return {
      type: STEWARD_POWER_TYPES.FREE_CORE_UPGRADE_ACTION,
      label: "Free Core upgrade"
    };
  }

  if (/when you place a tile in a disconnected empty hex, you may ignore the Travel action required/i.test(benefit)) {
    return {
      type: STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION,
      label: "Travel anywhere"
    };
  }

  const exchangeMatch = /you may exchange up to (\d+) resources in the Warehouse for the same number of resources of any type/i.exec(
    benefit
  );
  if (exchangeMatch) {
    return {
      type: STEWARD_POWER_TYPES.RESOURCE_EXCHANGE,
      maxAmount: Number(exchangeMatch[1]),
      label: "Warehouse exchange"
    };
  }

  if (/when you resolve an active Burden, you may do so without spending an Action/i.test(benefit)) {
    return {
      type: STEWARD_POWER_TYPES.FREE_BURDEN_RESOLUTION_ACTION,
      label: "Free Burden resolution"
    };
  }

  return null;
}

export function getStewardPowerDetailsForRole(roleId) {
  switch (roleId) {
    case "vanguard":
      return {
        type: STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION,
        categories: ["Travel", "Resource"],
        label: "Place Travel/Resource beyond network"
      };
    case "knight":
      return {
        type: STEWARD_POWER_TYPES.FREE_PLACEMENT_ACTION,
        categories: ["Housing"],
        label: "Free Housing placement"
      };
    case "sentinel":
      return {
        type: STEWARD_POWER_TYPES.FREE_CORE_UPGRADE_ACTION,
        label: "Free Core upgrade"
      };
    case "ranger":
      return {
        type: STEWARD_POWER_TYPES.IGNORE_DISCONNECTED_TRAVEL_ACTION,
        label: "Reach one disconnected tile"
      };
    case "quartermaster":
      return {
        type: STEWARD_POWER_TYPES.RESOURCE_EXCHANGE,
        maxAmount: 3,
        label: "Substitute up to 3 resources in a cost"
      };
    case "warden":
      return {
        type: STEWARD_POWER_TYPES.SUPPRESS_BURDEN,
        label: "Ignore one Burden this round"
      };
    default:
      return null;
  }
}

export function isStewardPowerUsedThisSeason(placedTile, season) {
  return (placedTile?.stewardPowerSeasons ?? []).includes(season);
}

export function markStewardPowerUsed(placedTile, season) {
  if (isStewardPowerUsedThisSeason(placedTile, season)) {
    return placedTile;
  }

  return {
    ...placedTile,
    stewardPowerSeasons: [...(placedTile.stewardPowerSeasons ?? []), season]
  };
}

export function isPlayerStewardPowerUsedThisSeason(player, season, type) {
  return Boolean((player?.stewardPowerSeasons?.[type] ?? []).includes(season));
}

export function markPlayerStewardPowerUsed(player, season, type) {
  if (!player || !type || isPlayerStewardPowerUsedThisSeason(player, season, type)) {
    return player;
  }

  return {
    ...player,
    stewardPowerSeasons: {
      ...(player.stewardPowerSeasons ?? {}),
      [type]: [...(player.stewardPowerSeasons?.[type] ?? []), season]
    }
  };
}

export function getAvailableStewardPowerProviders(state, context = {}, type, predicate = () => true) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);
  const playerId = context.playerId ?? state.activePlayerId;
  const playerCandidates = context.allowAnyPlayer
    ? state.players
    : state.players.filter((candidate) => candidate.id === playerId);

  return playerCandidates.flatMap((player) => {
    const role = getStewardRole(player?.stewardRoleId);
    const details = getStewardPowerDetailsForRole(role?.id);

    if (
      !player ||
      !role ||
      !details ||
      details.type !== type ||
      isPlayerStewardPowerUsedThisSeason(player, state.season, details.type)
    ) {
      return [];
    }

    const placedTile = {
      id: `steward-power-${player.id}-${role.id}`,
      tileId: `steward_power_${role.id}`,
      coordinate: player.stewardHousePlacement?.coordinate ?? player.lastInteraction?.coordinate ?? null,
      coordinates: [player.stewardHousePlacement?.coordinate ?? player.lastInteraction?.coordinate ?? null].filter(Boolean),
      stewardPowerProvider: true
    };
    const provider = {
      player,
      role,
      placedTile,
      tile: {
        tile_id: placedTile.tileId,
        tile_name: `${role.name} Steward`,
        tile_category: "Steward",
        side: "Power"
      },
      details
    };
    const legacyProviders = state.map.placedTiles
      .map((legacyPlacedTile) => {
        const legacyTile = tileIndex.get(legacyPlacedTile.tileId);
        const legacyDetails = getStewardPowerDetails(legacyTile);

        return {
          player,
          role,
          placedTile: legacyPlacedTile,
          tile: legacyTile,
          details: legacyDetails
        };
      })
      .filter(
        (legacyProvider) =>
          legacyProvider.details?.type === type &&
          isStewardHouseTileForPlayer(legacyProvider.tile, player) &&
          !isOverstrainedPlacedTile(legacyProvider.placedTile)
      );

    return [provider, ...legacyProviders].filter(predicate);
  });
}

export function getRequestedStewardPowerProvider(state, context = {}, placedTileId, type, predicate = () => true) {
  if (!placedTileId) {
    return {
      valid: true,
      provider: null,
      errors: []
    };
  }

  const providers = getAvailableStewardPowerProviders(state, context, type, predicate);
  const provider = providers.find((candidate) => candidate.placedTile.id === placedTileId);

  if (!provider) {
    return {
      valid: false,
      provider: null,
      errors: ["Selected Steward Power is not available for this action."]
    };
  }

  return {
    valid: true,
    provider,
    errors: []
  };
}
