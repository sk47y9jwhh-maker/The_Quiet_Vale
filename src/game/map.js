export const COORDINATE_CONVENTIONS = Object.freeze({
  ROW_LETTER_COLUMN_NUMBER: "row-letter-column-number",
  COLUMN_LETTER_ROW_NUMBER: "column-letter-row-number"
});

export const MAP_ROWS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
export const MAP_COLUMNS = Object.freeze(Array.from({ length: 14 }, (_, index) => index + 1));
export const MAP_COLUMN_LETTERS = Object.freeze(Array.from({ length: 14 }, (_, index) => String.fromCharCode(65 + index)));
export const MAP_ROW_NUMBERS = Object.freeze(Array.from({ length: 9 }, (_, index) => index + 1));

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

function mapValues(hexesOrIndex) {
  if (!hexesOrIndex) {
    return [];
  }

  if (hexesOrIndex instanceof Map) {
    return [...hexesOrIndex.values()];
  }

  return Array.isArray(hexesOrIndex) ? hexesOrIndex : [];
}

function getHexCoordinateConvention(hex) {
  if (hex?.Coordinate_Convention) {
    return hex.Coordinate_Convention;
  }

  if (typeof hex?.Column === "string" || typeof hex?.Row === "number") {
    return COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER;
  }

  return COORDINATE_CONVENTIONS.ROW_LETTER_COLUMN_NUMBER;
}

function sortLetters(values) {
  return [...new Set(values.filter((value) => value !== undefined).map((value) => String(value).toUpperCase()))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function sortNumbers(values) {
  return [...new Set(values.filter((value) => value !== undefined).map(Number))].sort((left, right) => left - right);
}

export function getMapAxes(hexesOrIndex) {
  const hexes = mapValues(hexesOrIndex);

  if (hexes.length === 0) {
    return {
      coordinateConvention: COORDINATE_CONVENTIONS.ROW_LETTER_COLUMN_NUMBER,
      columns: MAP_COLUMNS,
      rows: MAP_ROWS
    };
  }

  const coordinateConvention = getHexCoordinateConvention(hexes[0]);

  if (coordinateConvention === COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER) {
    return {
      coordinateConvention,
      columns: sortLetters(hexes.map((hex) => hex.Column ?? String(hex.Coordinate).match(/^([A-Z])/)?.[1])),
      rows: sortNumbers(hexes.map((hex) => hex.Row ?? String(hex.Coordinate).match(/\d+$/)?.[0]))
    };
  }

  return {
    coordinateConvention,
    columns: sortNumbers(hexes.map((hex) => hex.Column ?? String(hex.Coordinate).match(/\d+$/)?.[0])),
    rows: sortLetters(hexes.map((hex) => hex.Row ?? String(hex.Coordinate).match(/^([A-Z])/)?.[1]))
  };
}

export function parseCoordinate(coordinate, hexesOrIndex = null) {
  const match = /^([A-Z])(\d{1,2})$/.exec(String(coordinate ?? ""));

  if (!match) {
    throw new Error(`Invalid map coordinate: ${coordinate}`);
  }

  const axes = getMapAxes(hexesOrIndex);
  const letter = match[1];
  const number = Number(match[2]);

  if (axes.coordinateConvention === COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER) {
    const column = letter;
    const row = number;
    const columnIndex = axes.columns.indexOf(column);
    const rowIndex = axes.rows.indexOf(row);

    if (columnIndex === -1 || rowIndex === -1) {
      throw new Error(`Invalid map coordinate: ${coordinate}`);
    }

    return {
      row,
      rowIndex,
      column,
      columnIndex,
      coordinateConvention: axes.coordinateConvention
    };
  }

  const row = letter;
  const column = number;
  const columnIndex = axes.columns.indexOf(column);
  const rowIndex = axes.rows.indexOf(row);

  if (columnIndex === -1 || rowIndex === -1) {
    throw new Error(`Invalid map coordinate: ${coordinate}`);
  }

  return {
    row,
    rowIndex,
    column,
    columnIndex,
    coordinateConvention: axes.coordinateConvention
  };
}

export function coordinateFromOffset(columnIndex, rowIndex, hexesOrIndex = null) {
  const axes = getMapAxes(hexesOrIndex);

  if (
    columnIndex < 0 ||
    columnIndex >= axes.columns.length ||
    rowIndex < 0 ||
    rowIndex >= axes.rows.length
  ) {
    return null;
  }

  const column = axes.columns[columnIndex];
  const row = axes.rows[rowIndex];

  return axes.coordinateConvention === COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER
    ? `${column}${row}`
    : `${row}${column}`;
}

export function compareCoordinates(left, right, hexesOrIndex = null) {
  const leftParsed = parseCoordinate(left, hexesOrIndex);
  const rightParsed = parseCoordinate(right, hexesOrIndex);

  if (leftParsed.rowIndex !== rightParsed.rowIndex) {
    return leftParsed.rowIndex - rightParsed.rowIndex;
  }

  return leftParsed.columnIndex - rightParsed.columnIndex;
}

export function createMapIndex(hexes) {
  return new Map(hexes.map((hex) => [hex.Coordinate, hex]));
}

function designNoteForHex(terrain, feature, potentialBridgeSite) {
  if (terrain === "Water") {
    return potentialBridgeSite ? "Water; River; potential Bridge site" : "Water; River";
  }

  return terrain === "Grasslands" && feature === "None" ? null : terrain;
}

function coordinateFromAxes(convention, column, row) {
  return convention === COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER ? `${column}${row}` : `${row}${column}`;
}

export function normalizeMapSource(source) {
  if (Array.isArray(source)) {
    return source;
  }

  const coordinateConvention = source.coordinate_convention ?? COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER;
  const columns = source.columns ?? MAP_COLUMN_LETTERS;
  const rows = source.rows ?? MAP_ROW_NUMBERS;
  const terrainByCoordinate = source.terrain_by_coordinate ?? {};
  const featureByCoordinate = source.feature_by_coordinate ?? {};
  const bridgeCandidates = new Set(source.bridge_candidate_coordinates ?? []);
  const potentialBridgeSites = new Set(source.potential_bridge_site_coordinates ?? []);
  const sourceRiverAdjacentLand = source.river_adjacent_land_coordinates
    ? new Set(source.river_adjacent_land_coordinates)
    : null;
  const hexes = [];

  for (const row of rows) {
    for (const column of columns) {
      const coordinate = coordinateFromAxes(coordinateConvention, column, row);
      const terrain = terrainByCoordinate[coordinate];

      if (!terrain) {
        throw new Error(`Map source is missing terrain for ${coordinate}`);
      }

      const isWater = terrain === "Water";
      const feature = featureByCoordinate[coordinate] ?? (isWater ? "River" : "None");
      const potentialBridgeSite = isWater || potentialBridgeSites.has(coordinate);

      hexes.push({
        Coordinate: coordinate,
        Row: row,
        Column: column,
        Terrain: terrain,
        Feature: feature,
        River_Adjacent_Land: false,
        Bridge_Candidate: bridgeCandidates.has(coordinate),
        Potential_Bridge_Site: potentialBridgeSite,
        Coordinate_Convention: coordinateConvention,
        Design_Note: designNoteForHex(terrain, feature, potentialBridgeSite)
      });
    }
  }

  const computedRiverAdjacent = new Set(getRiverAdjacentLandSites(hexes).map((hex) => hex.Coordinate));

  return hexes.map((hex) => ({
    ...hex,
    River_Adjacent_Land: sourceRiverAdjacentLand
      ? sourceRiverAdjacentLand.has(hex.Coordinate)
      : computedRiverAdjacent.has(hex.Coordinate)
  }));
}

export function isWaterHex(hex) {
  return hex?.Terrain === "Water";
}

export function isRiverHex(hex) {
  return isWaterHex(hex);
}

export function getNeighborCoordinates(coordinate, hexesOrIndex) {
  const index = hexesOrIndex instanceof Map ? hexesOrIndex : createMapIndex(hexesOrIndex);
  const { columnIndex, rowIndex } = parseCoordinate(coordinate, index);
  const deltas = columnIndex % 2 === 0 ? EVEN_Q_DELTAS.even : EVEN_Q_DELTAS.odd;

  return deltas
    .map(([columnDelta, rowDelta]) => coordinateFromOffset(columnIndex + columnDelta, rowIndex + rowDelta, index))
    .filter((neighbor) => neighbor && index.has(neighbor));
}

export function getNeighborCoordinateInDirection(coordinate, directionId, hexesOrIndex) {
  const index = hexesOrIndex instanceof Map ? hexesOrIndex : createMapIndex(hexesOrIndex);
  const directionIndex = HEX_DIRECTIONS.findIndex((direction) => direction.id === directionId);

  if (directionIndex === -1) {
    throw new Error(`Unknown hex direction: ${directionId}`);
  }

  const { columnIndex, rowIndex } = parseCoordinate(coordinate, index);
  const deltas = columnIndex % 2 === 0 ? EVEN_Q_DELTAS.even : EVEN_Q_DELTAS.odd;
  const [columnDelta, rowDelta] = deltas[directionIndex];
  const neighbor = coordinateFromOffset(columnIndex + columnDelta, rowIndex + rowDelta, index);

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
  return hexes
    .filter(isRiverHex)
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, hexes));
}

export function getBridgeCandidateHexes(hexes) {
  return hexes
    .filter((hex) => hex.Bridge_Candidate === true)
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, hexes));
}

export function getRiverAdjacentLandSites(hexes) {
  const index = createMapIndex(hexes);
  const riverCoordinates = new Set(getRiverHexes(hexes).map((hex) => hex.Coordinate));

  return hexes
    .filter((hex) => !isWaterHex(hex))
    .filter((hex) => getNeighborCoordinates(hex.Coordinate, index).some((neighbor) => riverCoordinates.has(neighbor)))
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, index));
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

    components.push(component.sort((left, right) => compareCoordinates(left, right, index)));
  }

  return components.sort((left, right) => compareCoordinates(left[0], right[0], index));
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

function arraysMatch(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedCoordinates(coordinates, hexesOrIndex) {
  return [...coordinates].sort((left, right) => compareCoordinates(left, right, hexesOrIndex));
}

function coordinateForAxes(axes, columnIndex, rowIndex) {
  const column = axes.columns[columnIndex];
  const row = axes.rows[rowIndex];

  return axes.coordinateConvention === COORDINATE_CONVENTIONS.COLUMN_LETTER_ROW_NUMBER
    ? `${column}${row}`
    : `${row}${column}`;
}

export function validateMapOption(hexes, options = {}) {
  const errors = [];
  const label = options.label ?? "Map";
  const axes = getMapAxes(hexes);
  const coordinates = hexes.map((hex) => hex.Coordinate);
  const uniqueCoordinates = new Set(coordinates);
  const waterHexes = getRiverHexes(hexes);
  const bridgeCandidateHexes = getBridgeCandidateHexes(hexes);
  const riverComponents = getRiverComponents(hexes);
  const riverAdjacentLandSites = getRiverAdjacentLandSites(hexes);
  const sourceRiverAdjacentLandSites = hexes
    .filter((hex) => hex.River_Adjacent_Land === true)
    .sort((left, right) => compareCoordinates(left.Coordinate, right.Coordinate, hexes));
  const computedRiverAdjacentCoordinates = riverAdjacentLandSites.map((hex) => hex.Coordinate);
  const sourceRiverAdjacentCoordinates = sourceRiverAdjacentLandSites.map((hex) => hex.Coordinate);
  const bridgeCandidatesAreWater = bridgeCandidateHexes.every(isWaterHex);
  const terrainCounts = summarizeTerrain(hexes);
  const expectedHexes = options.expectedHexes ?? EXPECTED_SOURCE_COUNTS.mapHexes;
  const expectedRows = options.expectedRows ?? axes.rows;
  const expectedColumns = options.expectedColumns ?? axes.columns;
  const expectedCoordinateConvention = options.expectedCoordinateConvention ?? axes.coordinateConvention;
  const expectedTerrain = options.expectedTerrain ?? null;
  const expectedRiverCoordinates = options.expectedRiverCoordinates
    ? sortedCoordinates(options.expectedRiverCoordinates, hexes)
    : null;
  const waterCoordinates = waterHexes.map((hex) => hex.Coordinate);
  const allWaterHexesAreRiver = waterHexes.every(isRiverHex);
  const allWaterHexesAreRiverFeature = waterHexes.every((hex) => hex.Feature === "River");
  const allRiverHexesAreBridgePlacementSites = waterHexes.every(isWaterHex);
  const riverAdjacentLandMatchesSource =
    computedRiverAdjacentCoordinates.length === sourceRiverAdjacentCoordinates.length &&
    computedRiverAdjacentCoordinates.every((coordinate, index) => coordinate === sourceRiverAdjacentCoordinates[index]);

  if (hexes.length !== expectedHexes) {
    errors.push(`${label} expected ${expectedHexes} hexes, found ${hexes.length}`);
  }

  if (uniqueCoordinates.size !== coordinates.length) {
    errors.push(`${label} contains duplicate coordinates`);
  }

  if (axes.coordinateConvention !== expectedCoordinateConvention) {
    errors.push(`${label} uses ${axes.coordinateConvention}, expected ${expectedCoordinateConvention}`);
  }

  if (!arraysMatch(axes.rows, expectedRows)) {
    errors.push(`${label} rows do not match the expected axis`);
  }

  if (!arraysMatch(axes.columns, expectedColumns)) {
    errors.push(`${label} columns do not match the expected axis`);
  }

  const expectedAxes = {
    coordinateConvention: expectedCoordinateConvention,
    columns: expectedColumns,
    rows: expectedRows
  };

  for (let rowIndex = 0; rowIndex < expectedRows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < expectedColumns.length; columnIndex += 1) {
      const coordinate = coordinateForAxes(expectedAxes, columnIndex, rowIndex);
      if (!uniqueCoordinates.has(coordinate)) {
        errors.push(`${label} is missing ${coordinate}`);
      }
    }
  }

  if (options.expectedRiverComponents !== undefined && riverComponents.length !== options.expectedRiverComponents) {
    errors.push(`${label} river expected ${options.expectedRiverComponents} connected component(s), found ${riverComponents.length}`);
  }

  if (!bridgeCandidatesAreWater) {
    errors.push("One or more bridge candidates are not Water hexes");
  }

  if (!riverAdjacentLandMatchesSource) {
    errors.push("Computed river-adjacent land sites do not match the JSON source flags");
  }

  if (expectedTerrain) {
    for (const [terrain, expectedCount] of Object.entries(expectedTerrain)) {
      if ((terrainCounts[terrain] ?? 0) !== expectedCount) {
        errors.push(`${label} expected ${expectedCount} ${terrain} hexes, found ${terrainCounts[terrain] ?? 0}`);
      }
    }
  }

  if (expectedRiverCoordinates && !arraysMatch(waterCoordinates, expectedRiverCoordinates)) {
    errors.push(`${label} Water/River coordinates do not match the expected list`);
  }

  if (options.requireWaterFeatureRiver && !allWaterHexesAreRiverFeature) {
    errors.push(`${label} has Water hexes without Feature = River`);
  }

  return {
    errors,
    valid: errors.length === 0,
    rowCount: hexes.length,
    axes,
    terrainCounts,
    waterHexes,
    waterCoordinates,
    bridgeCandidateHexes,
    bridgeCandidatesAreWater,
    allWaterHexesAreRiver,
    allWaterHexesAreRiverFeature,
    allRiverHexesAreBridgePlacementSites,
    riverComponents,
    riverAdjacentLandSites,
    sourceRiverAdjacentLandSites,
    riverAdjacentLandMatchesSource
  };
}

export function validateApprovedMap(hexes) {
  return validateMapOption(hexes, {
    label: "Approved map",
    expectedRows: MAP_ROWS,
    expectedColumns: MAP_COLUMNS,
    expectedCoordinateConvention: COORDINATE_CONVENTIONS.ROW_LETTER_COLUMN_NUMBER,
    expectedHexes: EXPECTED_SOURCE_COUNTS.mapHexes,
    expectedRiverComponents: 1
  });
}
