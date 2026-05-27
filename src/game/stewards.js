import { createTileIndex, isOverstrainedPlacedTile } from "./tiles.js";

export const STEWARD_POWER_TYPES = Object.freeze({
  FREE_PLACEMENT_ACTION: "free_placement_action",
  FREE_CORE_UPGRADE_ACTION: "free_core_upgrade_action",
  IGNORE_DISCONNECTED_TRAVEL_ACTION: "ignore_disconnected_travel_action",
  RESOURCE_EXCHANGE: "resource_exchange",
  FREE_BURDEN_RESOLUTION_ACTION: "free_burden_resolution_action"
});

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
