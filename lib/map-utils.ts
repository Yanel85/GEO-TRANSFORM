const PI = 3.1415926535897932384626;
const a = 6378245.0; // Semi-major axis
const ee = 0.00669342162296594323; // Eccentricity squared

// Check if coordinate is inside China
export function outOfChina(lng: number, lat: number): boolean {
  if (lng < 72.004 || lng > 137.8347) {
    return true;
  }
  if (lat < 0.8293 || lat > 55.8271) {
    return true;
  }
  return false;
}

function transformLat(lng: number, lat: number): number {
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += (20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(lat * PI) + 40.0 * Math.sin(lat * PI / 3.0)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(lat / 12.0 * PI) + 320 * Math.sin(lat * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(lng: number, lat: number): number {
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += (20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(lng * PI) + 40.0 * Math.sin(lng * PI / 3.0)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(lng / 12.0 * PI) + 300.0 * Math.sin(lng / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/**
 * WGS-84 to GCJ-02 (Mars) coordinate offset
 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) {
    return [lng, lat];
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1.0 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1.0 - ee)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * PI);
  const mgLat = lat + dLat;
  const mgLng = lng + dLng;
  return [mgLng, mgLat];
}

/**
 * Custom high-performance Douglas-Peucker simplification
 */
function getSqSegDist(p: [number, number], p1: [number, number], p2: [number, number]) {
  let x = p1[0];
  let y = p1[1];
  let dx = p2[0] - x;
  let dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2[0];
      y = p2[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(
  points: [number, number][],
  first: number,
  last: number,
  sqTolerance: number,
  simplified: [number, number][]
) {
  let maxSqDist = sqTolerance;
  let index = -1;
  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (index !== -1) {
    simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

export function simplifyDouglasPeucker(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  const simplified: [number, number][] = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}

/**
 * Top-level geometry simplifier that navigates GeoJSON types
 */
export function simplifyGeometry(geom: any, tolerance: number): any {
  if (!geom || tolerance <= 0) return geom;

  const type = geom.type;
  if (type === "LineString") {
    return {
      ...geom,
      coordinates: simplifyDouglasPeucker(geom.coordinates, tolerance),
    };
  } else if (type === "MultiLineString") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((line: any) =>
        simplifyDouglasPeucker(line, tolerance)
      ),
    };
  } else if (type === "Polygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((ring: any) => {
        const simplified = simplifyDouglasPeucker(ring, tolerance);
        if (simplified.length < 4) {
          return ring; // Retain original if DP collapses it below 4 points (closed ring minimum)
        }
        return simplified;
      }),
    };
  } else if (type === "MultiPolygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((poly: any) =>
        poly.map((ring: any) => {
          const simplified = simplifyDouglasPeucker(ring, tolerance);
          if (simplified.length < 4) {
            return ring;
          }
          return simplified;
        })
      ),
    };
  }
  return geom;
}

/**
 * Top-level GCJ-02 coordinate offset applier
 */
export function convertGeometryToGcj02(geom: any): any {
  if (!geom) return geom;
  const type = geom.type;

  if (type === "Point") {
    return {
      ...geom,
      coordinates: wgs84ToGcj02(geom.coordinates[0], geom.coordinates[1]),
    };
  } else if (type === "MultiPoint") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((pt: [number, number]) =>
        wgs84ToGcj02(pt[0], pt[1])
      ),
    };
  } else if (type === "LineString") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((pt: [number, number]) =>
        wgs84ToGcj02(pt[0], pt[1])
      ),
    };
  } else if (type === "MultiLineString") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((line: [number, number][]) =>
        line.map((pt: [number, number]) => wgs84ToGcj02(pt[0], pt[1]))
      ),
    };
  } else if (type === "Polygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((ring: [number, number][]) =>
        ring.map((pt: [number, number]) => wgs84ToGcj02(pt[0], pt[1]))
      ),
    };
  } else if (type === "MultiPolygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((poly: [number, number][][]) =>
        poly.map((ring: [number, number][]) =>
          ring.map((pt: [number, number]) => wgs84ToGcj02(pt[0], pt[1]))
        )
      ),
    };
  }
  return geom;
}

/**
 * Decimal trimmer
 */
export function roundCoords(val: number, decimals: number): number {
  if (isNaN(val)) return 0;
  const p = Math.pow(10, decimals);
  return Math.round(val * p) / p;
}

export function trimGeometryPrecision(geom: any, decimals: number): any {
  if (!geom) return geom;
  const type = geom.type;

  if (type === "Point") {
    return {
      ...geom,
      coordinates: [roundCoords(geom.coordinates[0], decimals), roundCoords(geom.coordinates[1], decimals)],
    };
  } else if (type === "MultiPoint") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((pt: [number, number]) => [
        roundCoords(pt[0], decimals),
        roundCoords(pt[1], decimals),
      ]),
    };
  } else if (type === "LineString") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((pt: [number, number]) => [
        roundCoords(pt[0], decimals),
        roundCoords(pt[1], decimals),
      ]),
    };
  } else if (type === "MultiLineString") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((line: [number, number][]) =>
        line.map((pt: [number, number]) => [
          roundCoords(pt[0], decimals),
          roundCoords(pt[1], decimals),
        ])
      ),
    };
  } else if (type === "Polygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((ring: [number, number][]) =>
        ring.map((pt: [number, number]) => [
          roundCoords(pt[0], decimals),
          roundCoords(pt[1], decimals),
        ])
      ),
    };
  } else if (type === "MultiPolygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((poly: [number, number][][]) =>
        poly.map((ring: [number, number][]) =>
          ring.map((pt: [number, number]) => [
            roundCoords(pt[0], decimals),
            roundCoords(pt[1], decimals),
          ])
        )
      ),
    };
  }
  return geom;
}

/**
 * Calculate the bounding box of a GeoJSON Feature or FeatureCollection
 */
export function calculateBBox(geojson: any): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function processCoord(coord: [number, number]) {
    const x = coord[0];
    const y = coord[1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  function processGeom(geom: any) {
    if (!geom) return;
    const type = geom.type;
    const coords = geom.coordinates;
    if (!coords) return;

    if (type === "Point") {
      processCoord(coords);
    } else if (type === "MultiPoint" || type === "LineString") {
      coords.forEach(processCoord);
    } else if (type === "MultiLineString" || type === "Polygon") {
      coords.forEach((line: any) => line.forEach(processCoord));
    } else if (type === "MultiPolygon") {
      coords.forEach((poly: any) => poly.forEach((ring: any) => ring.forEach(processCoord)));
    }
  }

  if (geojson.type === "FeatureCollection") {
    geojson.features.forEach((f: any) => processGeom(f.geometry));
  } else if (geojson.type === "Feature") {
    processGeom(geojson.geometry);
  } else {
    processGeom(geojson);
  }

  // Handle empty or invalid geometries safely
  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
    return [0, 0, 0, 0];
  }

  return [minX, minY, maxX, maxY];
}

/**
 * Count total vertices in a GeoJSON geometry or collection
 */
export function countVertices(geojson: any): number {
  let total = 0;

  function countGeom(geom: any) {
    if (!geom) return;
    const type = geom.type;
    const coords = geom.coordinates;
    if (!coords) return;

    if (type === "Point") {
      total += 1;
    } else if (type === "MultiPoint" || type === "LineString") {
      total += coords.length;
    } else if (type === "MultiLineString" || type === "Polygon") {
      coords.forEach((line: any) => { total += line.length; });
    } else if (type === "MultiPolygon") {
      coords.forEach((poly: any) => {
        poly.forEach((ring: any) => { total += ring.length; });
      });
    }
  }

  if (geojson.type === "FeatureCollection") {
    geojson.features.forEach((f: any) => countGeom(f.geometry));
  } else if (geojson.type === "Feature") {
    countGeom(geojson.geometry);
  } else {
    countGeom(geojson);
  }

  return total;
}
