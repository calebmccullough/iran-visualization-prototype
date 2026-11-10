// Scrolling story: the map stays pinned to the screen while text cards scroll
// past it, and each card sets the map's state.
//
// How it fits together:
//   1. The page's own scroll drives everything. The map sits in a sticky
//      "stage"; the steps are ordinary blocks that scroll over it.
//   2. An IntersectionObserver watches a horizontal trigger line 80% of the
//      way down the screen. The step crossing that line is the active one, so
//      a card's state takes effect as the card comes into view.
//   3. activate() applies the active step's complete state from
//      story-content.ts: camera, highlighted countries and strike graphic.
//      Because each step is a full state, scrolling back up works the same way.
//
// Each attacked site gets a strike graphic (arc and base marker), drawn in the
// map's data layer, in drawing units, so it pans and zooms with the map.
//
// Cards are marked by type (title, claim, context, attack), so story.css can
// set Trump's claims apart from the attacks.
//
// Pinning: CSS position: sticky does the work, but it silently stops working
// when any ancestor clips overflow (many WordPress themes set overflow-x:
// hidden on a wrapper). watchPinning() notices that and pins the stage with
// position: fixed from a scroll listener instead.

import { createIranMap, type Inset, type IranMap } from './map';
import { CREDITS, SITES, STEPS, type CardType, type Site, type SiteId, type StepCard, type StepState, type StrikeMode } from './story-content';
import css from './story.css?inline';
import strikeCss from './strike.css?inline';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Fraction of the screen height where steps change. */
const TRIGGER = 0.8;
/** Below this map width, cards span the screen instead of sitting in a column. */
const WIDE = 860;
const CAMERA_MS = 1600;
const ARC_DELAY_MS = 700;
const ARC_MS = 1300;

const TAGS: Record<CardType, string> = { title: '', claim: 'Trump’s claim', context: 'Background', attack: 'Attack' };

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// One structure for every style: a head (date and type) and a body.
function cardHtml(card: StepCard): string {
  if (card.type === 'title') {
    return (
      `<div class="card card--title">` +
      `<p class="eyebrow">The Iran war</p>` +
      `<h2 class="headline">${escapeHtml(card.headline ?? '')}</h2>` +
      (card.body ?? []).map((p) => `<p class="dek">${escapeHtml(p)}</p>`).join('') +
      `<p class="scroll-cue" aria-hidden="true">Scroll to continue</p>` +
      `</div>`
    );
  }
  const head =
    `<div class="card-head">` +
    (card.kicker ? `<span class="kicker">${escapeHtml(card.kicker)}</span>` : '') +
    `<span class="tag">${TAGS[card.type]}</span>` +
    `</div>`;
  const parts: string[] = [];
  if (card.lead) parts.push(`<p class="lead">${escapeHtml(card.lead)}</p>`);
  // The quotation marks are separate elements so a style can enlarge or hide them.
  if (card.quote) parts.push(`<blockquote><span class="q-mark">“</span>${escapeHtml(card.quote)}<span class="q-mark">”</span></blockquote>`);
  if (card.attribution) parts.push(`<p class="attribution">— ${escapeHtml(card.attribution)}</p>`);
  for (const paragraph of card.body ?? []) parts.push(`<p>${escapeHtml(paragraph)}</p>`);
  if (card.list) parts.push(`<ul>${card.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
  if (card.note) parts.push(`<p class="note">${escapeHtml(card.note)}</p>`);
  if (card.sources?.length) {
    const links = card.sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`);
    parts.push(`<p class="sources">Sources: ${links.join(', ')}</p>`);
  }
  return `<div class="card card--${card.type}">${head}<div class="card-body">${parts.join('')}</div></div>`;
}

// Date ticks down the side of the stage: one per dated claim or attack.
function progressHtml(): string {
  const ticks = STEPS.map((step, i) => ({ i, card: step.card })).filter(({ card }) => card.tick);
  return (
    `<ol class="progress" aria-hidden="true">` +
    ticks.map(({ i, card }) => `<li class="tick tick--${card.type}" data-step="${i}"><span class="tick-mark"></span><span class="tick-label">${escapeHtml(card.tick!)}</span></li>`).join('') +
    `</ol>`
  );
}

/** Mark the tick for this step (or the latest one before it) as current. */
function updateProgress(root: ParentNode, stepIndex: number): void {
  const ticks = [...root.querySelectorAll<HTMLElement>('.tick')];
  const current = ticks.filter((t) => Number(t.dataset.step) <= stepIndex).pop();
  for (const tick of ticks) {
    const step = Number(tick.dataset.step);
    tick.classList.toggle('is-current', tick === current);
    tick.classList.toggle('is-past', step < stepIndex && tick !== current);
  }
}

// The credits sit outside .story: the pinned stage can cover anything inside it.
const TEMPLATE = `
<div class="story">
  <div class="stage"><div class="map-host" aria-hidden="true"></div>${progressHtml()}</div>
  <div class="steps">
    ${STEPS.map((step, i) => `<section class="step step--${step.card.type}" data-step="${i}">${cardHtml(step.card)}</section>`).join('')}
  </div>
</div>
<p class="credits">${escapeHtml(CREDITS)}</p>`;

export interface IranStory {
  destroy(): void;
}

export function createIranStory(host: HTMLElement): IranStory {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style>${TEMPLATE}`;
  const storyEl = root.querySelector<HTMLElement>('.story')!;
  const sections = [...root.querySelectorAll<HTMLElement>('.step')];

  let active = -1;
  let map: IranMap | undefined;

  // ---- Layout -----------------------------------------------------------

  // The part of the map the cards may cover, kept clear when framing a view.
  function inset(): Partial<Inset> {
    const height = map!.size()[1];
    if (storyEl.classList.contains('is-wide')) {
      const card = root.querySelector('.card')!.getBoundingClientRect();
      const stage = root.querySelector('.stage')!.getBoundingClientRect();
      return { top: 32, right: 32, bottom: 32, left: card.right - stage.left + 32 };
    }
    // Cards cross the whole screen on phones; the map's subject sits in the top
    // half, which a card reaches last.
    return { top: 16, right: 16, bottom: Math.round(height * 0.5), left: 16 };
  }

  const isWide = () => storyEl.classList.contains('is-wide');
  const cameraFor = (state: StepState) => (isWide() ? state.camera : (state.narrowCamera ?? state.camera));

  function onResize(): void {
    if (!map) return;
    const [width, height] = map.size();
    storyEl.classList.toggle('is-wide', width >= WIDE);
    // On wide screens the cards travel down a fixed column; labels stay out of
    // it rather than being cut off at a card's edge, and out from under the
    // progress marker.
    const stage = root.querySelector('.stage')!.getBoundingClientRect();
    const progress = root.querySelector('.progress')!.getBoundingClientRect();
    const underProgress = { x0: progress.left - stage.left, y0: progress.top - stage.top, x1: progress.right - stage.left, y1: progress.bottom - stage.top };
    map.setReserved(isWide() ? [{ x0: 0, y0: 0, x1: inset().left! - 16, y1: height }, underProgress] : [underProgress]);
    // Re-frame the current step for the new size, without animating.
    if (active >= 0) map.flyTo(cameraFor(STEPS[active]!.state), { duration: 0, inset: inset() });
  }

  const siteEntries = Object.entries(SITES) as [SiteId, Site][];
  map = createIranMap(root.querySelector<HTMLElement>('.map-host')!, {
    interactive: false,
    extraLabels: siteEntries.map(([id, site]) => ({ id, text: site.name, lon: site.lon, lat: site.lat, kind: 'site', minZoom: 0 })),
    onResize,
  });
  onResize();

  map.addStyles(strikeCss);
  const strikes = siteEntries.map(([id, site]) => ({ id, strike: createStrike(map!, id, site) }));

  // ---- Steps ------------------------------------------------------------

  function activate(index: number, instant = false): void {
    if (index === active) return;
    active = index;
    const state = STEPS[index]!.state;
    map!.setFocus(state.focus);
    map!.flyTo(cameraFor(state), { duration: instant ? 0 : CAMERA_MS, inset: inset() });
    for (const { id, strike } of strikes) strike.set(state.strike?.site === id ? state.strike.mode : 'none', !instant);
    sections.forEach((section, i) => section.classList.toggle('is-active', i === index));
    updateProgress(root, index);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activate(sections.indexOf(entry.target as HTMLElement));
      }
    },
    // Shrink the viewport to a line TRIGGER of the way down.
    { rootMargin: `-${TRIGGER * 100}% 0px -${(1 - TRIGGER) * 100 - 0.1}% 0px` },
  );
  sections.forEach((section) => observer.observe(section));
  activate(0, true);
  const stopPinning = watchPinning(storyEl, root.querySelector<HTMLElement>('.stage')!);

  return {
    destroy() {
      stopPinning();
      observer.disconnect();
      for (const { strike } of strikes) strike.destroy();
      map!.destroy();
      root.innerHTML = '';
    },
  };
}

// ---- Pinning fallback ---------------------------------------------------

function watchPinning(storyEl: HTMLElement, stage: HTMLElement): () => void {
  let fallback = false;

  function update(): void {
    const story = storyEl.getBoundingClientRect();
    const height = stage.offsetHeight;
    if (!fallback) {
      // Mid-story, a working sticky stage sits at the top of the screen.
      const midStory = story.top < -1 && story.bottom > height + 1;
      if (!midStory || Math.abs(stage.getBoundingClientRect().top) < 1) return;
      fallback = true;
      storyEl.classList.add('is-js-pinned');
    }
    // Before the story: at its top. During: fixed to the screen. After: at its bottom.
    const pinned = story.top <= 0 && story.bottom >= height;
    Object.assign(stage.style, {
      position: pinned ? 'fixed' : 'absolute',
      top: pinned ? '0px' : story.top > 0 ? '0px' : `${story.height - height}px`,
      left: pinned ? `${story.left}px` : '0px',
      width: `${story.width}px`,
    });
  }

  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
  return () => {
    removeEventListener('scroll', update);
    removeEventListener('resize', update);
  };
}

// ---- Strike graphic -----------------------------------------------------

interface Strike {
  set(mode: StrikeMode, animate: boolean): void;
  destroy(): void;
}

// The arc from Iran to one site and the marker at the site. The arc is a
// quadratic curve bowed to the north, split into short segments so it can be
// drawn progressively and fade in at the Iranian end without SVG gradients.
function createStrike(map: IranMap, id: SiteId, target: Site): Strike {
  const el = <K extends keyof SVGElementTagNameMap>(name: K, className: string) => {
    const node = document.createElementNS(SVG_NS, name);
    node.setAttribute('class', className);
    return node;
  };

  const group = el('g', 'strike');
  const arcGroup = el('g', 'strike-arc');
  const site = el('g', 'strike-site');
  const ring = el('circle', 'strike-ring');
  const dot = el('circle', 'strike-dot');
  site.append(ring, dot);
  group.append(arcGroup, site);
  map.dataLayer.append(group);

  const [x0, y0] = map.project(target.arcFrom.lon, target.arcFrom.lat);
  const [x1, y1] = map.project(target.lon, target.lat);
  for (const circle of [ring, dot]) {
    circle.setAttribute('cx', String(x1));
    circle.setAttribute('cy', String(y1));
  }

  // Control point: off the chord's midpoint, on its northern side.
  const length = Math.hypot(x1 - x0, y1 - y0);
  let nx = -(y1 - y0) / length;
  let ny = (x1 - x0) / length;
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const cx = (x0 + x1) / 2 + nx * length * 0.28;
  const cy = (y0 + y1) / 2 + ny * length * 0.28;
  const point = (t: number): [number, number] => [
    (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1,
    (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1,
  ];

  const SEGMENTS = 64;
  const FADE = 0.4; // share of the arc over which it fades in
  const segments = Array.from({ length: SEGMENTS }, (_, i) => {
    const path = el('path', 'strike-segment');
    const [ax, ay] = point(i / SEGMENTS);
    const [bx, by] = point((i + 1) / SEGMENTS);
    path.setAttribute('d', `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`);
    path.style.opacity = String(Math.min(1, (i + 0.5) / SEGMENTS / FADE));
    arcGroup.append(path);
    return path;
  });

  function setProgress(progress: number): void {
    const shown = Math.round(progress * SEGMENTS);
    segments.forEach((path, i) => (path.style.visibility = i < shown ? 'visible' : 'hidden'));
    group.classList.toggle('is-hit', progress >= 1);
  }

  // Marker radii are in screen pixels, so they are rescaled on every view.
  map.onView((view) => {
    dot.setAttribute('r', String(6 / view.k));
    ring.setAttribute('r', String(6 / view.k));
  });

  let frame = 0;
  let timer = 0;
  function stopAnimation(): void {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  }

  function set(mode: StrikeMode, animate: boolean): void {
    stopAnimation();
    group.dataset.mode = mode;
    map.setLabelEnabled(id, mode !== 'none');
    if (mode !== 'attack') return setProgress(0);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return setProgress(1);

    setProgress(0);
    timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ARC_MS);
        setProgress(1 - (1 - t) ** 2); // ease out
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, ARC_DELAY_MS);
  }

  return { set, destroy: stopAnimation };
}
