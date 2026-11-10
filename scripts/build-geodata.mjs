// Builds the map's geographic data from Natural Earth (public domain).
//
// Downloads a pinned release of the 1:10m layers into data/raw/ (a gitignored
// cache), clips them to the region, simplifies them, and writes:
//   src/data/basemap.topo.json  countries, boundary lines and lakes (TopoJSON)
//   src/data/places.json        cities, with the zoom level each first appears at
//   src/data/SOURCES.json       release tag and SHA-256 of every source file
//
// The outputs are committed, so `npm run build` never needs the network. Rerun
// this (`npm run geodata`) only to change the extent, detail or source release.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { requiredDataBounds } from '../src/projection.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'src', 'data');

const NE_TAG = 'v5.1.2';
const NE_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson`;
const LAYERS = {
  countries: 'ne_10m_admin_0_countries',
  borders: 'ne_10m_admin_0_boundary_lines_land',
  lakes: 'ne_10m_lakes',
  places: 'ne_10m_populated_places_simple',
};

// Geometry is kept for this lon/lat box. It must contain everything the reader
// can pan to: the projected rectangle around PAN_BOUNDS in src/config.ts, which
// reaches well past that box at its corners because meridians converge to the
// north. checkCoverage() below fails the build if this box is too small.
const DATA_BBOX = [17, 6, 85, 49];
// Cities are kept for a tighter box, close to the pannable area itself.
const PLACES_BBOX = [19, 9, 83, 47];
// Around Iran, large cities are kept even where Natural Earth ranks them low.
const CORE_BBOX = [32, 11, 66, 43];
// Share of vertices kept. 1:10m source detail holds up to roughly 8x zoom.
const SIMPLIFY = '55%';

// Natural Earth spellings replaced with the forms U.S. news style uses.
const PLACE_NAMES = {
  'Bandar-e-Abbas': 'Bandar Abbas',
  'Bandar-e Bushehr': 'Bushehr',
  Makkah: 'Mecca',
  Sabzewar: 'Sabzevar',
  Khvoy: 'Khoy',
  Qomsheh: 'Shahreza',
  'Khomeini Shahr': 'Khomeinishahr',
  Irbil: 'Erbil',
  'As Sulaymaniyah': 'Sulaymaniyah',
  'Al Hudaydah': 'Hodeida',
  'Al Mukalla': 'Mukalla',
  Sadah: 'Saada',
  Taizz: 'Taiz',
  Naxcivan: 'Nakhchivan',
  Suhar: 'Sohar',
  Odessa: 'Odesa',
  Rostov: 'Rostov-on-Don',
  'Ṭarābulus': 'Tripoli',
  Icel: 'Mersin',
  Ganca: 'Ganja',
  'Bur Said': 'Port Said',
  'Ismaïlia': 'Ismailia',
  Hamah: 'Hama',
  'Dayr az Zawr': 'Deir el-Zour',
  'An Nasiriyah': 'Nasiriyah',
  'Ad Diwaniyah': 'Diwaniyah',
  'Al Kut': 'Kut',
  'Al Hillah': 'Hillah',
  'Al Amarah': 'Amarah',
  'Al Ayn': 'Al Ain',
  Medani: 'Wad Madani',
};

const inBox = (p, [w, s, e, n]) => p.longitude >= w && p.longitude <= e && p.latitude >= s && p.latitude <= n;

// Iran gets its provincial centres. Elsewhere: capitals and major cities, plus
// any city of 300,000 or more in the countries around Iran.
function keepPlace(p) {
  if (!inBox(p, PLACES_BBOX)) return false;
  if (p.adm0_a3 === 'IRN') return p.min_zoom <= 6.7 && p.pop_max >= 60_000;
  if (p.adm0cap === 1 || p.min_zoom <= 5.1) return true;
  return inBox(p, CORE_BBOX) && p.min_zoom <= 6.7 && p.pop_max >= 300_000;
}

async function fetchLayer(name) {
  const file = join(RAW, `${name}.geojson`);
  if (!existsSync(file)) {
    console.log(`downloading ${name}`);
    const res = await fetch(`${NE_BASE}/${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  return { file, sha256 };
}

// Boundary lines carry Natural Earth's own classification. Settled borders are
// drawn solid; disputed lines, lines of control and undefined frontiers are
// drawn dashed. Lease, overlay and unrecognized limits are left off.
const BORDER_KIND = `kind = /^International/.test(FEATURECLA) ? "intl"
  : /^(Disputed|Line of control|Indefinite|Indeterminant)/.test(FEATURECLA) ? "disputed" : null`
  .replace(/\s+/g, ' ');

async function buildBasemap(files) {
  const out = join(OUT, 'basemap.topo.json');
  // combine-files gives the three layers one shared topology, so a border line
  // and the country edge beneath it simplify to the same vertices.
  await mapshaper.runCommands(
    [
      `-i "${files.countries}" "${files.borders}" "${files.lakes}" combine-files`,
      `-rename-layers countries,borders,lakes target=*`,
      `-clip bbox=${DATA_BBOX.join(',')} target=*`,
      `-target countries -filter-fields ADM0_A3,NAME -rename-fields iso=ADM0_A3,name=NAME`,
      `-target borders -each '${BORDER_KIND}' -filter 'kind !== null' -filter-fields kind`,
      `-target lakes -filter 'scalerank <= 5' -filter-fields name`,
      `-simplify ${SIMPLIFY} keep-shapes target=*`,
      `-o "${out}" format=topojson quantization=30000 target=*`,
    ].join(' '),
  );
  return out;
}

async function buildPlaces(file) {
  const { features } = JSON.parse(await readFile(file, 'utf8'));
  const places = features
    .map((f) => f.properties)
    .filter(keepPlace)
    .sort((a, b) => a.min_zoom - b.min_zoom || b.pop_max - a.pop_max)
    .map((p) => ({
      name: PLACE_NAMES[p.name] ?? p.name,
      lon: +p.longitude.toFixed(3),
      lat: +p.latitude.toFixed(3),
      // Natural Earth's suggested first-appearance zoom (web-map zoom levels).
      minZoom: p.min_zoom,
      iso: p.adm0_a3,
    }));
  const out = join(OUT, 'places.json');
  await writeFile(out, JSON.stringify(places) + '\n');
  return { out, count: places.length };
}

// Past the edge of the data the map would show open water where there is land.
function checkCoverage() {
  const need = requiredDataBounds();
  const [w, s, e, n] = DATA_BBOX;
  const margin = 1; // degrees
  if (need[0] < w + margin || need[1] < s + margin || need[2] > e - margin || need[3] > n - margin) {
    throw new Error(
      `DATA_BBOX ${DATA_BBOX} does not cover the pannable area, which spans ` +
        `${need.map((v) => v.toFixed(1))} (plus a ${margin}° margin). Widen DATA_BBOX.`,
    );
  }
}

checkCoverage();
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });

const files = {};
const sources = {};
for (const [key, name] of Object.entries(LAYERS)) {
  const { file, sha256 } = await fetchLayer(name);
  files[key] = file;
  sources[name] = { url: `${NE_BASE}/${name}.geojson`, sha256 };
}

const basemap = await buildBasemap(files);
const places = await buildPlaces(files.places);

await writeFile(
  join(OUT, 'SOURCES.json'),
  JSON.stringify(
    {
      source: 'Natural Earth (public domain), https://www.naturalearthdata.com',
      repository: 'https://github.com/nvkelso/natural-earth-vector',
      release: NE_TAG,
      dataBbox: DATA_BBOX,
      simplify: SIMPLIFY,
      files: sources,
    },
    null,
    2,
  ) + '\n',
);

console.log(`basemap ${((await stat(basemap)).size / 1024).toFixed(0)} KB, ${places.count} places`);
