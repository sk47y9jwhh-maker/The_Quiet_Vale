export const MAP_ROWS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
export const MAP_COLUMNS = Object.freeze(Array.from({ length: 14 }, (_, index) => index + 1));

export const EXPECTED_SOURCE_COUNTS = Object.freeze({
  encounterCards: 80,
  tiles: 77,
  mapHexes: 126,
  riverRules: 11
});

const EVEN_Q_DELTAS = Object.freeze({
  even: Object.freeze([
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [0, 1]
  ]),
  odd: Object.freeze([
    [1, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1]
  ])
});

export const HEX_DIRECTIONS = Object.freeze([
  Object.freeze({ id: "rotation-0", label: "Rotation 1" }),
  Object.freeze({ id: "rotation-1", label: "Rotation 2" }),
  Object.freeze({ id: "rotation-2", label: "Rotation 3" }),
  Object.freeze({ id: "rotation-3", label: "Rotation 4" }),
  Object.freeze({ id: "rotation-4", label: "Rotation 5" }),
  Object.freeze({ id: "rotation-5", label: "Rotation 6" })
]);

export function parseCoordinate(coordinate) {
  const match = /^([A-I])(\d{1,2})$/.exec(coordinate);

  if (!match) {
    throw new Error(`Invalid map coordinate: ${coordinate}`);
  }

  const row = match[1];
  const column = Number(match[2]);

  if (!MAP_COLUMNS.includes(column)) {
    throw new Error(`Invalid map column in coordinate: ${coordinate}`);
  }

  return {
    row,
    rowIndex: MAP_ROWS.indexOf(row),
    column,
    columnIndex: column - 1
  };
}

export function coordinateFromOffset(columnIndex, rowIndex) {
  if (
    columnIndex < 0 ||
    columnIndex >= MAP_COLUMNS.length ||
    rowIndex < 0 ||
    rowIndex >= MAP_ROWS.length
  ) {
    return null;
  }

  return `${MAP_ROWS[rowIndex]}${columnIndex + 1}`;
}

export function compareCoordinates(left, right) {
  const leftParsed = parseCoordinate(left);
  const rightParsed = parseCoordinate(right);

  if (leftParsed.rowIndex !== rightParsed.rowIndex) {
    return leftParsed.rowIndex - rightParsed.rowIndex;
  }

  return leftParsed.column - rightParsed.column;
}

export function createMapIndex(hexes) {
  return new Map(hexes.map((hex) => [hex.Coordinate, hex]));
}

export function isWaterHex(hex) {
  return hex?.Terrain === "Water";
}

export function isRiverHex(hex) {
  return isWaterHex(hex);
}

export function getNeighborCoordinates(coordinate, hexesOrIndex) {
  const index = hexesOrIndex instanceof Map ? hexesOrIndex : createMapIndex(hexesOrIndex);
  const { columnIndex, rowIndex } = parseCoordinate(coordinate);
  const deltas = columnIndex % 2 === 0 ? EVEN_Q_DELTAS.even : EVEN_Q_DELTAS.odd;

  return deltas
    .map(([columnDelta, rowDelta]) => coordinateFromOffset(columnIndex + columnDelta, rowIndex + rowDelta))
    .filter((neighbor) => neighbor && index.has(neighbor));
}

export function getNeighborCoordinateInDirection(coordinate, directionId, hexesOrIndex) {
  const index = hexesOrIndex instanceof Map ? hexesOrIndex : createMapIndex(hexesOrIndex);
  const directionIndex = HEX_DIRECTIONS.findIndex((direction) => direction.id === directionId);

  if (directionIndex === -1) {
    throw new Error(`Unknown hex direction: ${directionId}`);
  }

  const { columnIndex, rowIndex } = parseCoordinate(coordinate);
  const deltas = columnIndex % 2 === 0 ? EVEN_Q_DELTAS.even : EVEN_Q_DELTAS.odd;
  const [columnDelta, rowDelta] = deltas[directionIndex];
  const neighbor = coordinateFromOffset(columnIndex + columnDelta, rowIndex + rowDelta);

  return neighbor && index.has(neighbor) ? neighbor : null;
}

export function getFootprintCoordinates(anchorCoordinate, sizeHexes, directionId, hexesOrIndex) {
  const index = hexesOrIndex instanceof Map ? hexesOrIndex : createMapIndex(hexesOrIndex);
  const footprint = [anchorCoordinate];
  let current = anchorCoordinate;

  if (!index.has(anchorCoordinate)) {
    return null;
  }

  for (let step = 1; step < sizeHexes; step += 1) {
    const next = getNeighborCoordinateInDirection(current, directionId, index);

    if (!next) {
      return null;
    }

    footprint.push(next);
    current = next;
  }

  return footprint;
}

export function getRiverHexes(hexes) {
  return hexes.filter(isRiverHex).sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate));
}

export function getBridgeCandidateHexes(hexes) {
  return hexes
    .filter((hex) => hex.Bridge_Candidate === true)
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate));
}

export function getRiverAdjacentLandSites(hexes) {
  const index = createMapIndex(hexes);
  const riverCoordinates = new Set(getRiverHexes(hexes).map((hex) => hex.Coordinate));

  return hexes
    .filter((hex) => !isWaterHex(hex))
    .filter((hex) => getNeighborCoordinates(hex.Coordinate, index).some((neighbor) => riverCoordinates.has(neighbor)))
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate));
}

export function getRiverComponents(hexes) {
  const index = createMapIndex(hexes);
  const unvisited = new Set(getRiverHexes(hexes).map((hex) => hex.Coordinate));
  const components = [];

  while (unvisited.size > 0) {
    const [start] = unvisited;
    const stack = [start];
    const component = [];
    unvisited.delete(start);

    while (stack.length > 0) {
      const coordinate = stack.pop();
      component.push(coordinate);

      for (const neighbor of getNeighborCoordinates(coordinate, index)) {
        if (unvisited.has(neighbor)) {
          unvisited.delete(neighbor);
          stack.push(neighbor);
        }
      }
    }

    components.push(component.sort(compareCoordinates));
  }

  return components.sort((left, right) => compareCoordinates(left[0], right[0]));
}

export function summarizeTerrain(hexes) {
  return hexes.reduce((summary, hex) => {
    summary[hex.Terrain] = (summary[hex.Terrain] ?? 0) + 1;
    return summary;
  }, {});
}

export function validateSourceCounts(data) {
  const actual = {
    encounterCards: data.encounterCards?.length ?? 0,
    tiles: data.tiles?.length ?? 0,
    mapHexes: data.mapHexes?.length ?? 0,
    riverRules: data.riverRules?.length ?? 0
  };
  const errors = Object.entries(EXPECTED_SOURCE_COUNTS)
    .filter(([key, expected]) => actual[key] !== expected)
    .map(([key, expected]) => `${key} expected ${expected}, found ${actual[key]}`);

  return {
    actual,
    expected: EXPECTED_SOURCE_COUNTS,
    valid: errors.length === 0,
    errors
  };
}

export function validateApprovedMap(hexes) {
  const errors = [];
  const coordinates = hexes.map((hex) => hex.Coordinate);
  const uniqueCoordinates = new Set(coordinates);
  const waterHexes = getRiverHexes(hexes);
  const bridgeCandidateHexes = getBridgeCandidateHexes(hexes);
  const riverComponents = getRiverComponents(hexes);
  const riverAdjacentLandSites = getRiverAdjacentLandSites(hexes);
  const sourceRiverAdjacentLandSites = hexes
    .filter((hex) => hex.River_Adjacent_Land === true)
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate));
  const computedRiverAdjacentCoordinates = riverAdjacentLandSites.map((hex) => hex.Coordinate);
  const sourceRiverAdjacentCoordinates = sourceRiverAdjacentLandSites.map((hex) => hex.Coordinate);
  const bridgeCandidatesAreWater = bridgeCandidateHexes.every(isWaterHex);
  const riverAdjacentLandMatchesSource =
    computedRiverAdjacentCoordinates.length === sourceRiverAdjacentCoordinates.length &&
    computedRiverAdjacentCoordinates.every((coordinate, index) => coordinate === sourceRiverAdjacentCoordinates[index]);

  if (hexes.length !== EXPECTED_SOURCE_COUNTS.mapHexes) {
    errors.push(`Approved map expected ${EXPECTED_SOURCE_COUNTS.mapHexes} hexes, found ${hexes.length}`);
  }

  if (uniqueCoordinates.size !== coordinates.length) {
    errors.push("Approved map contains duplicate coordinates");
  }

  for (const row of MAP_ROWS) {
    for (const column of MAP_COLUMNS) {
      const coordinate = `${row}${column}`;
      if (!uniqueCoordinates.has(coordinate)) {
        errors.push(`Approved map is missing ${coordinate}`);
      }
    }
  }

  if (riverComponents.length !== 1) {
    errors.push(`Approved river expected 1 connected component, found ${riverComponents.length}`);
  }

  if (!bridgeCandidatesAreWater) {
    errors.push("One or more bridge candidates are not Water hexes");
  }

  if (!riverAdjacentLandMatchesSource) {
    errors.push("Computed river-adjacent land sites do not match the JSON source flags");
  }

  return {
    errors,
    valid: errors.length === 0,
    rowCount: hexes.length,
    waterHexes,
    bridgeCandidateHexes,
    bridgeCandidatesAreWater,
    riverComponents,
    riverAdjacentLandSites,
    sourceRiverAdjacentLandSites,
    riverAdjacentLandMatchesSource
  };
}
