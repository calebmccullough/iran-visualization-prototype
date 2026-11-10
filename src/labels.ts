// Label layer: place names drawn at a constant size on top of the map.
//
// Labels live in screen pixels, not in the zooming drawing, so they stay the
// same size while the map scales beneath them. On every view change layout()
// walks the labels in priority order and shows each one only if it is due at
// this zoom level, fits inside the frame, and does not overlap a label already
// placed. Hidden labels stay in the DOM and fade out.

import type { ZoomTransform } from 'd3-zoom';
import type { LabelKind, LabelSpec } from './label-data';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface TextStyle {
  size: number;
  weight: number;
  italic?: boolean;
  /** Extra space between letters, in em. */
  tracking?: number;
  upper?: boolean;
}

// Text metrics are needed for collision tests, so sizes are set here and
// applied as attributes. Colours and halos are in map.css.
const STYLES: Record<LabelKind, TextStyle> = {
  focus: { size: 15, weight: 700, tracking: 0.14, upper: true },
  country: { size: 11, weight: 600, tracking: 0.08, upper: true },
  territory: { size: 10.5, weight: 500, italic: true },
  water: { size: 11.5, weight: 400, italic: true, tracking: 0.02 },
  city: { size: 12, weight: 500 },
  site: { size: 12.5, weight: 700 },
};

const LINE_HEIGHT = 1.2;
/** Radius of the marker each point label sits beside. Cities draw their own dot. */
const POINT_RADIUS: Partial<Record<LabelKind, number>> = { city: 2.5, site: 7 };
const DOT_GAP = 4;
/** Minimum clear space between two labels, in pixels. */
const PADDING = 3;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Label {
  spec: LabelSpec;
  /** Position in drawing units. */
  x: number;
  y: number;
  group: SVGGElement;
  text: SVGTextElement;
  width: number;
  height: number;
  shown: boolean;
  /** False for labels with an id until setEnabled() switches them on. */
  enabled: boolean;
  /** Point labels only: radius of the marker beside the name. */
  radius: number;
  /** Point labels only: where the name sits relative to the marker. */
  side: Side;
}

type Side = 'right' | 'left' | 'below';

// Placements tried in order. A site's name goes under its marker first, which
// keeps it clear of anything drawn to the marker's side (such as an arc).
const SIDES: Partial<Record<LabelKind, Side[]>> = { city: ['right', 'left'], site: ['below', 'right', 'left'] };

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 + PADDING && a.x1 > b.x0 - PADDING && a.y0 < b.y1 + PADDING && a.y1 > b.y0 - PADDING;

export class LabelLayer {
  private labels: Label[];

  constructor(
    parent: SVGGElement,
    specs: LabelSpec[],
    project: (lon: number, lat: number) => [number, number],
    fontFamily: string,
  ) {
    const measure = document.createElement('canvas').getContext('2d')!;
    this.labels = specs.map((spec) => {
      const style = STYLES[spec.kind];
      const lines = (style.upper ? spec.text.toUpperCase() : spec.text).split('\n');
      const tracking = (style.tracking ?? 0) * style.size;

      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', `label label--${spec.kind} is-hidden`);
      const radius = POINT_RADIUS[spec.kind] ?? 0;
      if (spec.kind === 'city') {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('r', String(radius));
        group.append(dot);
      }

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('font-size', String(style.size));
      text.setAttribute('font-weight', String(style.weight));
      if (style.italic) text.setAttribute('font-style', 'italic');
      if (tracking) text.setAttribute('letter-spacing', `${tracking}px`);
      lines.forEach((line, i) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', '0');
        // Centre the block of lines vertically on the anchor point.
        tspan.setAttribute('dy', i === 0 ? `${0.35 - ((lines.length - 1) * LINE_HEIGHT) / 2}em` : `${LINE_HEIGHT}em`);
        tspan.textContent = line;
        text.append(tspan);
      });
      group.append(text);
      parent.append(group);

      measure.font = `${style.italic ? 'italic ' : ''}${style.weight} ${style.size}px ${fontFamily}`;
      const width = Math.max(...lines.map((line) => measure.measureText(line).width + tracking * line.length));
      const [x, y] = project(spec.lon, spec.lat);
      const label: Label = {
        spec,
        x,
        y,
        group,
        text,
        width,
        height: lines.length * style.size * LINE_HEIGHT,
        shown: false,
        enabled: spec.id === undefined,
        radius,
        side: 'right',
      };
      if (radius) this.setSide(label, 'right');
      else text.setAttribute('text-anchor', 'middle');
      return label;
    });
  }

  /**
   * Show, hide and position every label for the current view.
   * `reserved` boxes (the zoom buttons, the credit line) are kept clear.
   */
  layout(view: ZoomTransform, width: number, height: number, zoomLevel: number, reserved: Box[]): void {
    const placed: Box[] = [...reserved];
    const frame: Box = { x0: PADDING, y0: PADDING, x1: width - PADDING, y1: height - PADDING };
    const fits = (box: Box) =>
      box.x0 >= frame.x0 && box.x1 <= frame.x1 && box.y0 >= frame.y0 && box.y1 <= frame.y1 && !placed.some((p) => overlaps(box, p));

    for (const label of this.labels) {
      let box: Box | undefined;
      if (label.enabled && zoomLevel >= label.spec.minZoom) {
        const sx = view.applyX(label.x);
        const sy = view.applyY(label.y);
        if (label.radius) {
          for (const side of SIDES[label.spec.kind] ?? ['right', 'left']) {
            const candidate = this.cityBox(label, sx, sy, side);
            if (fits(candidate)) {
              box = candidate;
              if (side !== label.side) this.setSide(label, side);
              break;
            }
          }
        } else {
          const candidate = {
            x0: sx - label.width / 2,
            x1: sx + label.width / 2,
            y0: sy - label.height / 2,
            y1: sy + label.height / 2,
          };
          if (fits(candidate)) box = candidate;
        }
        if (box) {
          placed.push(box);
          label.group.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
        }
      }
      const show = box !== undefined;
      if (show !== label.shown) {
        label.shown = show;
        label.group.classList.toggle('is-hidden', !show);
      }
    }
  }

  /** Switch labels with this id on or off. Takes effect at the next layout(). */
  setEnabled(id: string, enabled: boolean): void {
    for (const label of this.labels) if (label.spec.id === id) label.enabled = enabled;
  }

  // The name plus its marker, so other labels keep clear of both.
  private cityBox(label: Label, sx: number, sy: number, side: Side): Box {
    const r = label.radius;
    if (side === 'below') {
      return { x0: sx - Math.max(r, label.width / 2), x1: sx + Math.max(r, label.width / 2), y0: sy - r, y1: sy + r + DOT_GAP + label.height };
    }
    const reach = r + DOT_GAP + label.width;
    return {
      x0: side === 'right' ? sx - r : sx - reach,
      x1: side === 'right' ? sx + reach : sx + r,
      y0: Math.min(sy - r, sy - label.height / 2),
      y1: Math.max(sy + r, sy + label.height / 2),
    };
  }

  private setSide(label: Label, side: Side): void {
    label.side = side;
    const offset = label.radius + DOT_GAP;
    if (side === 'below') {
      label.text.setAttribute('text-anchor', 'middle');
      label.text.setAttribute('transform', `translate(0,${(offset + label.height / 2).toFixed(1)})`);
      for (const tspan of label.text.children) tspan.setAttribute('x', '0');
      return;
    }
    label.text.removeAttribute('transform');
    label.text.setAttribute('text-anchor', side === 'right' ? 'start' : 'end');
    for (const tspan of label.text.children) tspan.setAttribute('x', String(side === 'right' ? offset : -offset));
  }
}
