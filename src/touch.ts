// Two-finger touch handling for a map embedded in a scrolling article.
//
// One finger is left to the browser, so swiping over the map scrolls the page
// instead of trapping the reader. Two fingers pan and pinch-zoom the map.
// (d3-zoom's own touch handling treats one finger as a pan, and cannot pick up
// a second finger that lands after the first, so it is switched off in map.ts.)

export interface TouchGesture {
  /** Screen point, relative to the map, that was under the fingers' midpoint. */
  from: [number, number];
  /** Where that midpoint is now. */
  to: [number, number];
  /** Change in finger spread since the last event: >1 spreads, <1 pinches. */
  scale: number;
}

interface Options {
  onGesture(gesture: TouchGesture): void;
  /** A one-finger drag over the map: the page scrolls and the map stays put. */
  onOneFingerDrag(): void;
}

export function attachTouch(target: Element, { onGesture, onOneFingerDrag }: Options): () => void {
  let last: { x: number; y: number; spread: number } | null = null;

  const read = (event: TouchEvent) => {
    const rect = target.getBoundingClientRect();
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    return {
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
      spread: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    };
  };

  const start = (event: TouchEvent) => {
    if (event.touches.length === 2) {
      // Claim the gesture before the browser starts scrolling or page-zooming.
      if (event.cancelable) event.preventDefault();
      last = read(event);
    } else {
      last = null;
    }
  };

  const move = (event: TouchEvent) => {
    if (event.touches.length === 2 && last) {
      if (event.cancelable) event.preventDefault();
      const now = read(event);
      onGesture({ from: [last.x, last.y], to: [now.x, now.y], scale: last.spread > 0 ? now.spread / last.spread : 1 });
      last = now;
    } else if (event.touches.length === 1) {
      onOneFingerDrag();
    }
  };

  const end = (event: TouchEvent) => {
    last = event.touches.length === 2 ? read(event) : null;
  };

  // passive: false is what allows preventDefault() above.
  const active = { passive: false } as const;
  target.addEventListener('touchstart', start as EventListener, active);
  target.addEventListener('touchmove', move as EventListener, active);
  target.addEventListener('touchend', end as EventListener);
  target.addEventListener('touchcancel', end as EventListener);

  return () => {
    target.removeEventListener('touchstart', start as EventListener);
    target.removeEventListener('touchmove', move as EventListener);
    target.removeEventListener('touchend', end as EventListener);
    target.removeEventListener('touchcancel', end as EventListener);
  };
}
