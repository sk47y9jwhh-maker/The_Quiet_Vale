import { STRAIN_MAX_PER_TILE, isOverstrainedPlacedTile } from "./tiles.js";

export function isSupportedPlacedTile(placedTile) {
  return Boolean(placedTile?.supported);
}

export function setPlacedTileSupported(placedTile, supported) {
  return {
    ...placedTile,
    supported: Boolean(supported),
    supportedUsedThisRound: supported ? Boolean(placedTile.supportedUsedThisRound) : false
  };
}

export function resetRoundSupportUsage(placedTile) {
  return {
    ...placedTile,
    supportedUsedThisRound: false
  };
}

export function applyStrainToPlacedTile(placedTile, amount = 1, options = {}) {
  if (!placedTile) {
    return {
      valid: false,
      errors: ["Unknown placed tile."]
    };
  }

  const strainAmount = Number(amount);
  if (!Number.isInteger(strainAmount) || strainAmount <= 0) {
    return {
      valid: false,
      errors: ["Strain amount must be a positive whole number."]
    };
  }

  if (isOverstrainedPlacedTile(placedTile)) {
    return {
      valid: false,
      errors: ["Overstrained tiles are not valid targets for more Strain."]
    };
  }

  const ignoreSupported = Boolean(options.ignoreSupported);
  const supported = options.supported ?? isSupportedPlacedTile(placedTile);
  let strain = Math.max(0, Math.min(STRAIN_MAX_PER_TILE, Number(placedTile.strain ?? 0)));
  let supportedUsedThisRound = Boolean(placedTile.supportedUsedThisRound);
  let strainAdded = 0;
  let strainPrevented = 0;
  let blockedByMax = 0;

  for (let index = 0; index < strainAmount; index += 1) {
    if (strain >= STRAIN_MAX_PER_TILE) {
      blockedByMax += strainAmount - index;
      break;
    }

    if (!ignoreSupported && supported && !supportedUsedThisRound) {
      supportedUsedThisRound = true;
      strainPrevented += 1;
      continue;
    }

    strain += 1;
    strainAdded += 1;
  }

  return {
    valid: true,
    placedTile: {
      ...placedTile,
      strain,
      supportedUsedThisRound
    },
    strainAdded,
    strainPrevented,
    blockedByMax,
    becameOverstrained: strain >= STRAIN_MAX_PER_TILE
  };
}
