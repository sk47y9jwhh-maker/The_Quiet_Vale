import { ENCOUNTER_TYPES } from "./setup.js";
import { createTileIndex, isOverstrainedPlacedTile } from "./tiles.js";

function numberValue(value) {
  return Number(value ?? 0) || 0;
}

function getTileIndex(context) {
  if (context.tileIndex) {
    return context.tileIndex;
  }

  return createTileIndex(context.tiles ?? []);
}

export function calculateScore(state, context = {}) {
  const tileIndex = getTileIndex(context);
  const placedTileScores = state.map.placedTiles.map((placedTile) => {
    const definition = tileIndex.get(placedTile.tileId);
    const overstrained = isOverstrainedPlacedTile(placedTile);

    return {
      placedTileId: placedTile.id,
      tileId: placedTile.tileId,
      tileName: definition?.tile_name ?? placedTile.tileId,
      population: overstrained ? 0 : numberValue(definition?.population),
      renown: overstrained ? 0 : numberValue(definition?.renown),
      strain: numberValue(placedTile.strain),
      overstrained
    };
  });
  const population = placedTileScores.reduce((sum, entry) => sum + entry.population, 0);
  const renown = placedTileScores.reduce((sum, entry) => sum + entry.renown, 0);
  const strainTokens = placedTileScores.reduce((sum, entry) => sum + entry.strain, 0);
  const activeBurdenCount = state.encounter.active.filter(
    (activeState) => activeState.encounterType === ENCOUNTER_TYPES.BURDEN && !activeState.resolved
  ).length;
  const activeBurdenPenalty = activeBurdenCount * numberValue(state.rules.activeBurdenPenaltyRenown);
  const strainPenalty = strainTokens * numberValue(state.rules.strainPenaltyRenown);

  return {
    population,
    renown,
    activeBurdenPenalty,
    strainPenalty,
    total: population + renown - activeBurdenPenalty - strainPenalty,
    activeBurdenCount,
    strainTokens,
    scoringTileCount: placedTileScores.filter((entry) => !entry.overstrained).length,
    overstrainedExcludedTileIds: placedTileScores
      .filter((entry) => entry.overstrained)
      .map((entry) => entry.placedTileId),
    placedTileScores
  };
}
