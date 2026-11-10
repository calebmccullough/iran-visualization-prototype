// Map extent and projection: the one place that decides what the map shows and
// how longitude/latitude become drawing coordinates.
//
// The projection is fixed. Zooming and panning never re-project; they move and
// scale the already-projected drawing (see map.ts). This file has no browser or
// bundler dependencies, so scripts/build-geodata.mjs imports it too.

import { geoConicConformal, geoPath, type GeoProjection } from 'd3-geo';

/** [west, south, east, north] in degrees. */
export type Bounds = [number, number, number, number];

/** The view the map opens on, and returns to with the reset button. */
export const HOME_BOUNDS: Bounds = [34, 23, 66, 40.5];

/**
 * The reader can pan and zoom out as far as the rectangle drawn around this
 * box. Because meridians converge northward, that rectangle reaches further
 * east and west at its top corners than the box itself.
 */
export const PAN_BOUNDS: Bounds = [29, 11, 74, 44.5];

/** How far the reader can zoom in, as a multiple of the opening view. */
export const MAX_ZOOM = 8;

/**
 * Width of the pannable rectangle in drawing units. Paths are rounded to 0.1
 * unit, which stays under a screen pixel at maximum zoom.
 */
export const DRAWING_WIDTH = 2000;

// Lambert conformal conic centred on Iran: shapes and angles stay true across
// the region, without the northward stretching of a web-Mercator map.
const CENTRAL_MERIDIAN = 53.5;
const STANDARD_PARALLELS: [number, number] = [24, 40];

export type Rect = [[number, number], [number, number]];

export interface MapProjection {
  projection: GeoProjection;
  /** Pannable rectangle in drawing units; its top-left corner is [0, 0]. */
  panRect: Rect;
  /** Opening view in drawing units. */
  homeRect: Rect;
}

// Points along the edges of a lon/lat box. A box's edges curve once projected,
// so its drawn extent has to be measured from the edges, not the four corners.
export function boxEdge([w, s, e, n]: Bounds): GeoJSON.MultiPoint {
  const coordinates: GeoJSON.Position[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const lon = w + ((e - w) * i) / steps;
    const lat = s + ((n - s) * i) / steps;
    coordinates.push([lon, s], [lon, n], [w, lat], [e, lat]);
  }
  return { type: 'MultiPoint', coordinates };
}

export function createProjection(): MapProjection {
  const projection = geoConicConformal()
    .parallels(STANDARD_PARALLELS)
    .rotate([-CENTRAL_MERIDIAN, 0])
    .fitWidth(DRAWING_WIDTH, boxEdge(PAN_BOUNDS));
  const path = geoPath(projection);
  return {
    projection,
    panRect: path.bounds(boxEdge(PAN_BOUNDS)),
    homeRect: path.bounds(boxEdge(HOME_BOUNDS)),
  };
}

/** The lon/lat box that contains everything inside the pannable rectangle. */
export function requiredDataBounds(): Bounds {
  const { projection, panRect } = createProjection();
  const [[x0, y0], [x1, y1]] = panRect;
  const out: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    for (const point of [[x, y0], [x, y1], [x0, y], [x1, y]] as [number, number][]) {
      const [lon, lat] = projection.invert!(point)!;
      out[0] = Math.min(out[0], lon);
      out[1] = Math.min(out[1], lat);
      out[2] = Math.max(out[2], lon);
      out[3] = Math.max(out[3], lat);
    }
  }
  return out;
}
