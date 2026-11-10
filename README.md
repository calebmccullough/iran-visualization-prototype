<img src="assets/icon.svg" width="64" height="64" alt="">

# iran-visual

A pannable, zoomable map of Iran and the surrounding region, built as a base
layer for news graphics and packaged for embedding in WordPress.

The map is self-contained: the build produces one file holding the code, styles
and geography. It makes no network requests when a reader loads it, so there is
no tile server, API key or third-party tracker involved.

## Live prototype

GitHub Pages rebuilds and publishes the site on every push to `main`
(`.github/workflows/pages.yml` runs `npm run build` and deploys `dist/`):

- Scrolling story: https://calebmccullough.github.io/iran-visualization-prototype/story.html
- Explorable map: https://calebmccullough.github.io/iran-visualization-prototype/

## Run it

Requires Node 22.18 or newer.

```sh
npm install
npm run dev      # live-reloading preview at the address Vite prints
npm run build    # type-check, then write dist/
```

`npm run build` writes two files:

| File | Use |
| --- | --- |
| `dist/index.html` | The whole map as one page. Host it and point an `<iframe>` at it. |
| `dist/iran-map.js` | The same map as a script that mounts inside a page. |

## Embed in WordPress

**Iframe (recommended).** Upload `dist/index.html` to any static host, then add
a Custom HTML block:

```html
<iframe
  src="https://example.org/path/to/index.html"
  title="Map of Iran and the surrounding region"
  style="width: 100%; height: min(70vh, 600px); border: 0"
  loading="lazy"
></iframe>
```

This works for any WordPress role that can add an iframe, and the map cannot
affect or be affected by the rest of the page.

**Inline.** Host `dist/iran-map.js` and add a Custom HTML block:

```html
<div data-iran-map></div>
<script src="https://example.org/path/to/iran-map.js" defer></script>
```

The map fills the width of its container at a 4:3 ratio (5:6 on narrow
screens); set a `height` on the `div` to override that. It renders inside a
shadow root, so theme CSS does not reach it. WordPress strips `<script>` tags
for users without the `unfiltered_html` capability, which on multisite
installations means everyone except super admins. Use the iframe if the script
tag disappears on save.

## Scrolling story

`dist/story.html` is a scroll-driven sequence built on the same map, in two
parts that follow the same pattern: Trump's March 25 and 26 claims of victory,
then the March 27 strike on Prince Sultan Air Base in Saudi Arabia; and his
June 11, July 8 and July 14 remarks, then the July 17 strike on Muwaffaq Salti
Air Base in Jordan. The map stays pinned while text cards scroll
over it, and each card sets the map's state.

To place it in an article, host `dist/iran-map.js` and add a Custom HTML block:

```html
<div data-iran-story data-full-bleed></div>
<script src="https://example.org/path/to/iran-map.js" defer></script>
```

Leave out `data-full-bleed` to keep the story inside the article column. The
story has to sit in the page itself, not in an iframe, because the page's scroll
drives it; the `unfiltered_html` note above therefore applies.

- **Text and map states** are in `src/story-content.ts`: each step's card and
  the camera, highlighted countries and strike graphic while it is on screen.
  Quotes were checked against the CQ transcripts (IDs in the comments).
- **Pinning** uses CSS `position: sticky`. Themes that set `overflow: hidden`
  on a wrapper break sticky, so the story detects that and pins the map with
  JavaScript instead.
- **Reduced motion** is honoured: camera moves and the arc happen instantly.
- **Cards** use the Dispatch design in `src/story.css`: a dateline strip,
  hairline rules, and a red strip for attacks. They are set in PolitiFact's
  typefaces, Public Sans and Merriweather, which PolitiFact pages already
  load; elsewhere they fall back to system fonts. The preview pages load both
  from Google Fonts, so `dist/story.html` makes that one outside request.

## Reader controls

- Drag to pan; the buttons, double-click, or `+` / `-` zoom; `0` or the reset
  button returns to the opening view; arrow keys pan.
- The scroll wheel zooms only with Ctrl or ⌘ held, and on touch screens the map
  moves with two fingers. A plain scroll or a one-finger swipe keeps scrolling
  the article, so the map never traps the reader.

## How it is put together

| File | Role |
| --- | --- |
| `src/projection.ts` | Map extent, zoom limit and projection (Lambert conformal conic centred on Iran). |
| `src/map.ts` | The component: draws the map and handles panning, zooming and resizing. |
| `src/labels.ts` | Label layout: which names show at each zoom, without overlapping. |
| `src/label-data.ts` | Hand-placed country, territory and water labels. |
| `src/touch.ts` | Two-finger pan and pinch. |
| `src/story.ts` | The scrolling story: pinned stage, step triggers, strike arc. |
| `src/story-content.ts` | The story's text and per-step map states. |
| `src/map.css` | All styling. Colours are `--iran-map-*` custom properties. |
| `scripts/build-geodata.mjs` | Rebuilds `src/data/` from Natural Earth (`npm run geodata`). |

`createIranMap()` in `src/map.ts` returns a handle for adding data on top of the
base map: `dataLayer` is an SVG group that pans and zooms with the map, and
`project(lon, lat)` converts coordinates into that group's space.

## Data and editorial conventions

Geography comes from [Natural Earth](https://www.naturalearthdata.com) 1:10m
(release 5.1.2), which is in the public domain. `src/data/SOURCES.json` records
the exact files and their SHA-256 hashes.

- **Boundaries.** Lines follow Natural Earth's classification. International
  boundaries are solid. Disputed boundaries, lines of control and undefined
  frontiers are dashed; in this region that includes the West Bank, Gaza, the
  Golan Heights, the Israel–Lebanon line, parts of the Lebanon–Syria border,
  the Line of Control in Kashmir, Crimea, northern Cyprus and Somaliland.
- **Land.** Every country except Iran has the same fill, so the map does not
  assign disputed areas to either claimant. Iran's highlight follows de facto
  control, which includes Abu Musa and the Tunb islands, also claimed by the
  United Arab Emirates.
- **Names.** Country and water names follow AP style (for example "Persian
  Gulf"). "West Bank", "Gaza Strip" and "Golan Heights" are labelled as
  territories. City names come from Natural Earth, with a short list of
  spellings changed in `scripts/build-geodata.mjs`. Capitals are not marked
  differently from other cities.
- **Detail.** 1:10m data suits a regional map. At the maximum zoom the frame
  spans roughly 350 km, and coastlines are visibly generalised; street- or
  neighbourhood-level maps would need a different data source.

## Licences

The bundle includes d3-geo, d3-zoom, d3-selection, d3-transition and their D3
dependencies (ISC and BSD-3-Clause) and topojson-client (ISC). Their licence
notices are written into the top of `dist/iran-map.js` and `dist/index.html` by
the build. Vite, TypeScript and mapshaper are build tools and are not
distributed.
