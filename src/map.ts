// The map component: builds the drawing inside a host element and wires up
// panning, zooming and labels.
//
// How it fits together:
//   1. Geometry is projected once into "drawing units" (projection.ts) and
//      written into SVG paths. That happens once per page, in getDrawing().
//   2. d3-zoom owns the view: a ZoomTransform {x, y, k} that maps drawing units
//      to screen pixels. Every input (drag, wheel, buttons, keys, pinch) only
//      changes that transform.
//   3. On each change, render() applies the transform to the <g class="view">
//      group that holds the paths, then re-lays out the labels, which are drawn
//      in screen pixels so they keep their size.
//
// Everything lives in a shadow root, so the host page's CSS cannot restyle the
// map and the map's CSS cannot leak out.
//
// With { interactive: false } the reader cannot move the map; a story drives
// the camera instead through flyTo(), setFocus() and setLabelEnabled().

import { geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3Zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';
import { feature, merge, mesh } from 'topojson-client';
import type { MultiPolygon, Polygon } from 'topojson-specification';
import { basemap, places, type BorderProps, type CountryProps } from './data';
import { AREA_LABELS, type LabelSpec } from './label-data';
import { LabelLayer, type Box } from './labels';

export type { Box };
import css from './map.css?inline';
import { boxEdge, createProjection, MAX_ZOOM, type Bounds, type Rect } from './projection';
import { attachTouch } from './touch';

const FOCUS_COUNTRY = 'IRN';

export interface MapOptions {
  /** Reader can pan and zoom (default). False for a story-driven map. */
  interactive?: boolean;
  /** Extra labels, placed before all others. Give them an id to toggle them. */
  extraLabels?: LabelSpec[];
  /** Called after the map adapts to a new size. */
  onResize?: () => void;
}

/** Screen space to keep clear when framing a view, in pixels from each edge. */
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface IranMap {
  /**
   * An SVG group that pans and zooms with the map, drawn above the land and
   * below the labels. Position children with project(). Add
   * vector-effect="non-scaling-stroke" to keep stroke widths constant.
   */
  dataLayer: SVGGElement;
  /** Longitude/latitude to drawing units (the coordinate space of dataLayer). */
  project(lon: number, lat: number): [number, number];
  /** Current view: screenX = x * view.k + view.x, and likewise for y. */
  view(): ZoomTransform;
  /** Called after every pan or zoom, and once immediately. */
  onView(listener: (view: ZoomTransform) => void): void;
  /** Animate back to the opening view. */
  reset(): void;
  /**
   * Move the camera to fit a lon/lat box inside the frame, less `inset`.
   * A duration of 0 jumps there. A new move interrupts one in progress.
   */
  flyTo(bounds: Bounds, options?: { duration?: number; inset?: Partial<Inset> }): void;
  /** Countries (ISO 3166-1 alpha-3) drawn with the highlight fill and outline. */
  setFocus(isos: string[]): void;
  /** Show or hide the extra labels with this id. */
  setLabelEnabled(id: string, enabled: boolean): void;
  /** Screen areas (pixels) where no label is placed, e.g. under a text panel. */
  setReserved(boxes: Box[]): void;
  /** Add CSS inside the map's shadow root, e.g. to style dataLayer children. */
  addStyles(css: string): void;
  /** Width and height of the map frame in pixels. */
  size(): [number, number];
  /** Remove the map and its listeners from the host element. */
  destroy(): void;
}

interface Drawing {
  paths: { land: string; lakes: string; borders: string; disputed: string };
  /** Outline path of one country, by ISO code (computed on first use). */
  country(iso: string): string;
  /** A lon/lat box as a rectangle in drawing units. */
  rect(bounds: Bounds): Rect;
  panRect: Rect;
  homeRect: Rect;
  /** Projection scale: drawing units per radian. */
  scale: number;
  project(lon: number, lat: number): [number, number];
}

let drawing: Drawing | undefined;

// Projecting ~30,000 vertices is the expensive step, so it is done once and
// shared by every map on the page.
function getDrawing(): Drawing {
  if (drawing) return drawing;
  const { projection, panRect, homeRect } = createProjection();
  const path = geoPath(projection).digits(1);

  const { countries, borders, lakes } = basemap.objects;
  const borderLines = (kind: BorderProps['kind']) =>
    mesh(basemap, { type: 'GeometryCollection', geometries: borders.geometries.filter((g) => (g.properties as BorderProps).kind === kind) });

  const countryPaths = new Map<string, string>();
  const country = (iso: string) => {
    if (!countryPaths.has(iso)) {
      const geometry = countries.geometries.find((g) => (g.properties as CountryProps).iso === iso);
      if (!geometry) throw new Error(`No country with code ${iso} in the basemap`);
      countryPaths.set(iso, path(feature(basemap, geometry)) ?? '');
    }
    return countryPaths.get(iso)!;
  };

  drawing = {
    paths: {
      // All countries merged into one shape, so land is a single uniform fill
      // and the map takes no position on who holds a disputed area.
      land: path(merge(basemap, countries.geometries as (Polygon | MultiPolygon)[])) ?? '',
      lakes: path(feature(basemap, lakes)) ?? '',
      borders: path(borderLines('intl')) ?? '',
      disputed: path(borderLines('disputed')) ?? '',
    },
    country,
    rect: (bounds) => geoPath(projection).bounds(boxEdge(bounds)),
    panRect,
    homeRect,
    scale: projection.scale(),
    project: (lon, lat) => projection([lon, lat]) as [number, number],
  };
  return drawing;
}

// Area labels first, then cities. Within the same zoom level, cities in the
// focus country are placed first, so they win any overlap.
function labelSpecs(extra: LabelSpec[]): LabelSpec[] {
  const cities = places
    .map((place, order) => ({ place, order }))
    .sort(
      (a, b) =>
        a.place.minZoom - b.place.minZoom ||
        Number(b.place.iso === FOCUS_COUNTRY) - Number(a.place.iso === FOCUS_COUNTRY) ||
        a.order - b.order,
    )
    .map(({ place }): LabelSpec => ({ text: place.name, lon: place.lon, lat: place.lat, kind: 'city', minZoom: place.minZoom }));
  return [...extra, ...AREA_LABELS, ...cities];
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const TEMPLATE = `
<div class="map" tabindex="0" role="group" aria-label="Interactive map of Iran and the surrounding region" aria-describedby="help">
  <svg class="canvas" role="img" aria-label="Map showing Iran, its neighbors and nearby seas">
    <g class="view">
      <path class="land"/>
      <g class="focus-fills"/>
      <path class="lakes"/>
      <path class="border"/>
      <path class="border border--disputed"/>
      <g class="focus-outlines"/>
      <g class="data"/>
    </g>
    <g class="labels" aria-hidden="true"/>
  </svg>
  <div class="controls">
    <button type="button" data-action="in" aria-label="Zoom in" title="Zoom in">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
    </button>
    <button type="button" data-action="out" aria-label="Zoom out" title="Zoom out">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>
    </button>
    <button type="button" data-action="reset" aria-label="Reset view" title="Reset view">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M3 2.5v2.6h2.6"/></svg>
    </button>
  </div>
  <div class="hint" aria-hidden="true"></div>
  <div class="credit">Map data: Natural Earth</div>
  <p class="visually-hidden" id="help">
    Drag to move the map. Zoom with the buttons, or with the plus and minus keys. Arrow keys move the map and 0 resets it.
  </p>
</div>`;

export function createIranMap(host: HTMLElement, options: MapOptions = {}): IranMap {
  const { interactive = true, extraLabels = [], onResize } = options;
  const d = getDrawing();
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style>${TEMPLATE}`;

  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  const mapEl = $<HTMLDivElement>('.map');
  const svgEl = $<SVGSVGElement>('.canvas');
  const viewEl = $<SVGGElement>('.view');
  const hintEl = $<HTMLDivElement>('.hint');

  if (!interactive) {
    // Nothing for the reader to operate: no focus stop, buttons or help text.
    mapEl.classList.add('is-static');
    for (const attr of ['tabindex', 'role', 'aria-label', 'aria-describedby']) mapEl.removeAttribute(attr);
    $('.controls').remove();
    $('#help').remove();
  }

  $('.land').setAttribute('d', d.paths.land);
  $('.lakes').setAttribute('d', d.paths.lakes);
  $('.border:not(.border--disputed)').setAttribute('d', d.paths.borders);
  $('.border--disputed').setAttribute('d', d.paths.disputed);

  // Each highlighted country gets a fill (under the borders) and an outline
  // (over them). Both fade, so switching focus mid-story is not abrupt.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const focusPaths = new Map<string, SVGPathElement[]>();
  function setFocus(isos: string[]): void {
    for (const iso of isos) {
      if (focusPaths.has(iso)) continue;
      const pair = (['focus-fills', 'focus-outlines'] as const).map((layer) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', layer === 'focus-fills' ? 'focus' : 'focus-outline');
        path.setAttribute('d', d.country(iso));
        $(`.${layer}`).append(path);
        return path;
      });
      focusPaths.set(iso, pair);
    }
    for (const [iso, pair] of focusPaths) for (const path of pair) path.classList.toggle('is-off', !isos.includes(iso));
  }
  setFocus([FOCUS_COUNTRY]);

  const labels = new LabelLayer($<SVGGElement>('.labels'), labelSpecs(extraLabels), d.project, getComputedStyle(mapEl).fontFamily);

  // ---- View state -------------------------------------------------------

  const [[panX0, panY0], [panX1, panY1]] = d.panRect;
  const [[homeX0, homeY0], [homeX1, homeY1]] = d.homeRect;
  const homeCentre: [number, number] = [(homeX0 + homeX1) / 2, (homeY0 + homeY1) / 2];

  let width = 0;
  let height = 0;
  /** Scale (screen pixels per drawing unit) of the opening view at this size. */
  let homeK = 1;
  let view: ZoomTransform = zoomIdentity;
  let reserved: Box[] = [];
  let extraReserved: Box[] = [];
  let frame = 0;
  const listeners: ((view: ZoomTransform) => void)[] = [];

  const svg = select(svgEl);
  // d3-zoom holds the view state even when the reader cannot change it:
  // programmatic moves (flyTo) go through zoomer.transform either way.
  const zoomer = d3Zoom<SVGSVGElement, unknown>()
    // Plain scrolling must keep scrolling the article, so the wheel zooms only
    // with Ctrl or ⌘ held. Trackpad pinches arrive as Ctrl+wheel and also pass.
    .filter((event: Event) => {
      if (event.type === 'wheel') return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey;
      return !(event as MouseEvent).button;
    })
    .on('start', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      if (event.sourceEvent?.type === 'mousedown') mapEl.classList.add('is-dragging');
    })
    .on('end', () => mapEl.classList.remove('is-dragging'))
    .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      view = event.transform;
      render();
    });
  svg.call(zoomer);
  if (interactive) {
    // Touch is handled in touch.ts instead (see the note there).
    svg.on('touchstart.zoom touchmove.zoom touchend.zoom touchcancel.zoom', null);
  } else {
    svg.on('.zoom', null);
  }

  function render(): void {
    viewEl.setAttribute('transform', view.toString());
    // Label layout is batched to one pass per animation frame.
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        labels.layout(view, width, height, zoomLevel(), [...reserved, ...extraReserved]);
        for (const listener of listeners) listener(view);
      });
    }
  }

  // The current scale expressed as a web-map zoom level (256px tiles, measured
  // at 32°N), which is the unit Natural Earth's label thresholds are given in.
  function zoomLevel(): number {
    return Math.log2((d.scale * view.k * 2 * Math.PI * Math.cos((32 * Math.PI) / 180)) / 256);
  }

  const centredOn = ([x, y]: [number, number], k: number) => zoomIdentity.translate(width / 2 - x * k, height / 2 - y * k).scale(k);
  const homeView = () => centredOn(homeCentre, homeK);

  // Keep a view inside the zoom limits and the pannable rectangle. d3-zoom
  // applies this itself for mouse and wheel input; views we compute need it.
  function constrain(next: ZoomTransform): ZoomTransform {
    const [minK, maxK] = zoomer.scaleExtent();
    const k = Math.min(maxK, Math.max(minK, next.k));
    const scaled = k === next.k ? next : zoomIdentity.translate(next.x, next.y).scale(k);
    return zoomer.constrain()(scaled, [[0, 0], [width, height]], d.panRect);
  }

  // Runs on first layout and whenever the host element changes size.
  function resize(): void {
    const nextWidth = mapEl.clientWidth;
    const nextHeight = mapEl.clientHeight;
    if (!nextWidth || !nextHeight) return;

    const first = width === 0;
    const oldCentre = view.invert([width / 2, height / 2]);
    const oldRelativeZoom = view.k / homeK;
    width = nextWidth;
    height = nextHeight;

    // Zoomed all the way out, the pannable rectangle exactly covers the frame.
    const minK = Math.max(width / (panX1 - panX0), height / (panY1 - panY0));
    // The opening view fits the home box inside the frame.
    homeK = Math.max(minK, Math.min(width / (homeX1 - homeX0), height / (homeY1 - homeY0)));
    zoomer
      .extent([[0, 0], [width, height]])
      .scaleExtent([minK, homeK * MAX_ZOOM])
      .translateExtent([[panX0, panY0], [panX1, panY1]]);

    const mapBox = mapEl.getBoundingClientRect();
    reserved = [...root.querySelectorAll('.controls, .credit')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x0: r.left - mapBox.left, y0: r.top - mapBox.top, x1: r.right - mapBox.left, y1: r.bottom - mapBox.top };
    });

    // Keep the same place centred, at the same zoom relative to the opening view.
    const next = first ? homeView() : constrain(centredOn(oldCentre, oldRelativeZoom * homeK));
    svg.interrupt('camera').call(zoomer.transform, next);
    onResize?.();
  }

  function flyTo(bounds: Bounds, { duration = 1500, inset = {} }: { duration?: number; inset?: Partial<Inset> } = {}): void {
    if (!width || !height) return;
    const { top = 0, right = 0, bottom = 0, left = 0 } = inset;
    const [[x0, y0], [x1, y1]] = d.rect(bounds);
    const frameW = Math.max(1, width - left - right);
    const frameH = Math.max(1, height - top - bottom);
    const k = Math.min(frameW / (x1 - x0), frameH / (y1 - y0));
    // Centre the box in the part of the frame left uncovered.
    const target = constrain(
      zoomIdentity.translate(left + frameW / 2 - ((x0 + x1) / 2) * k, top + frameH / 2 - ((y0 + y1) / 2) * k).scale(k),
    );
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    svg.interrupt('camera');
    if (duration <= 0 || reduced) svg.call(zoomer.transform, target);
    else svg.transition('camera').duration(duration).call(zoomer.transform, target);
  }

  // ---- Input ------------------------------------------------------------

  const duration = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250);
  const zoomBy = (factor: number) => svg.transition().duration(duration()).call(zoomer.scaleBy, factor);
  const panBy = (dx: number, dy: number) => svg.transition().duration(duration()).call(zoomer.translateBy, dx / view.k, dy / view.k);
  const reset = () => svg.transition().duration(duration() * 2).call(zoomer.transform, homeView());

  let hintTimer = 0;
  let detachTouch = () => {};
  if (interactive) {
    const onClick = (event: Event) => {
      const action = (event.target as Element).closest<HTMLButtonElement>('button')?.dataset.action;
      if (action === 'in') zoomBy(1.6);
      else if (action === 'out') zoomBy(1 / 1.6);
      else if (action === 'reset') reset();
    };
    $('.controls').addEventListener('click', onClick);

    const onKeydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const step = 80;
      const actions: Record<string, () => void> = {
        '+': () => zoomBy(1.6),
        '=': () => zoomBy(1.6),
        '-': () => zoomBy(1 / 1.6),
        '0': reset,
        ArrowLeft: () => panBy(step, 0),
        ArrowRight: () => panBy(-step, 0),
        ArrowUp: () => panBy(0, step),
        ArrowDown: () => panBy(0, -step),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault(); // otherwise the arrow keys also scroll the page
      action();
    };
    mapEl.addEventListener('keydown', onKeydown);

    function showHint(message: string): void {
      hintEl.textContent = message;
      hintEl.classList.add('is-visible');
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => hintEl.classList.remove('is-visible'), 1500);
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) showHint(`Hold ${isMac ? '⌘' : 'Ctrl'} and scroll to zoom the map`);
    };
    svgEl.addEventListener('wheel', onWheel, { passive: true });

    detachTouch = attachTouch(svgEl, {
      onGesture({ from, to, scale }) {
        hintEl.classList.remove('is-visible');
        const [minK, maxK] = zoomer.scaleExtent();
        const k = Math.min(maxK, Math.max(minK, view.k * scale));
        // The spot that was under the fingers stays under the fingers.
        const [x, y] = view.invert(from);
        svg.call(zoomer.transform, constrain(zoomIdentity.translate(to[0] - x * k, to[1] - y * k).scale(k)));
      },
      onOneFingerDrag: () => showHint('Use two fingers to move the map'),
    });

  }

  const observer = new ResizeObserver(resize);
  observer.observe(mapEl);
  resize();

  return {
    dataLayer: $<SVGGElement>('.data'),
    project: d.project,
    view: () => view,
    onView(listener) {
      listeners.push(listener);
      listener(view);
    },
    reset,
    flyTo,
    setFocus,
    setLabelEnabled(id, enabled) {
      labels.setEnabled(id, enabled);
      render();
    },
    setReserved(boxes) {
      extraReserved = boxes;
      render();
    },
    addStyles(extra) {
      const style = document.createElement('style');
      style.textContent = extra;
      root.append(style);
    },
    size: () => [width, height],
    destroy() {
      observer.disconnect();
      detachTouch();
      cancelAnimationFrame(frame);
      clearTimeout(hintTimer);
      svg.on('.zoom', null);
      root.innerHTML = '';
    },
  };
}
