// Typed access to the generated data files (see scripts/build-geodata.mjs).
// The casts are needed because TypeScript infers JSON imports as plain
// objects and arrays, which do not match the TopoJSON types.

import type { GeometryCollection, Topology } from 'topojson-specification';
import basemapJson from './basemap.topo.json';
import placesJson from './places.json';

export type CountryProps = { iso: string; name: string };
export type BorderProps = { kind: 'intl' | 'disputed' };

export type Basemap = Topology<{
  countries: GeometryCollection<CountryProps>;
  borders: GeometryCollection<BorderProps>;
  lakes: GeometryCollection<{ name: string }>;
}>;

export interface Place {
  name: string;
  lon: number;
  lat: number;
  /** Web-map zoom level at which Natural Earth suggests first showing the place. */
  minZoom: number;
  /** ISO 3166-1 alpha-3 code of the country, as Natural Earth assigns it. */
  iso: string;
}

export const basemap = basemapJson as unknown as Basemap;
export const places: Place[] = placesJson;
