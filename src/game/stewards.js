import { createTileIndex, isOverstrainedPlacedTile } from "./tiles.js";

export const STEWARD_ROLES = Object.freeze([
  Object.freeze({
    id: "vanguard",
    name: "Vanguard",
    houseTileId: "core_vanguard_house_basic",
    openingResourceTileIds: Object.freeze(["core_forest_basic"]),
    openingSummary: "Place Forest on Woodland"
  }),
  Object.freeze({
    id: "sentinel",
    name: "Sentinel",
    houseTileId: "core_sentinel_house_basic",
    openingResourceTileIds: Object.freeze(["core_mine_basic"]),
    openingSummary: "Place Mine on Mountains"
  }),
  Object.freeze({
    id: "ranger",
    name: "Ranger",
    houseTileId: "core_ranger_house_basic",
    openingResourceTileIds: Object.freeze(["core_wildlands_basic"]),
    openingSummary: "Place Wildlands on Heaths"
  }),
  Object.freeze({
    id: "knight",
    name: "Knight",
    houseTileId: "core_knight_house_basic",
    openingResourceTileIds: Object.freeze(["core_farm_basic"]),
    openingSummary: "Place Farm on Arable Land"
  }),
  Object.freeze({
    id: "warden",
    name: "Warden",
    houseTileId: "core_warden_house_basic",
    openingResourceTileIds: Object.freeze(["core_dig_site_basic"]),
    openingSummary: "Place Dig Site on Ruins"
  }),
  Object.freeze({
    id: "quartermaster",
    name: "Quartermaster",
    houseTileId: "core_quartermaster_house_basic",
    openingResourceTileIds: Object.freeze([
      "core_forest_basic",
      "core_mine_basic",
      "core_wildlands_basic",
      "core_farm_basic",
      "core_dig_site_basic"
    ]),
    openingSummary: "Place any Resource tile on its matching terrain"
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
  FREE_BURDEN_RESOLUTION_ACTION: "free_burden_resolution_action"
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
      label: "Ignore disconnected Travel action"
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

export function getAvailableStewardPowerProviders(state, context, type, predicate = () => true) {
  const tileIndex = context.tileIndex ?? createTileIndex(context.tiles ?? []);

  return state.map.placedTiles
    .map((placedTile) => {
      const tile = tileIndex.get(placedTile.tileId);
      const details = getStewardPowerDetails(tile);

      return {
        placedTile,
        tile,
        details
      };
    })
    .filter(
      (provider) =>
        provider.details?.type === type &&
        !isOverstrainedPlacedTile(provider.placedTile) &&
        !isStewardPowerUsedThisSeason(provider.placedTile, state.season) &&
        predicate(provider)
    );
}

export function getRequestedStewardPowerProvider(state, context, placedTileId, type, predicate = () => true) {
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
