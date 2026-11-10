// Entry point of the embed script. Turns marked elements into maps:
//
//   <div data-iran-map></div>      the explorable map
//   <div data-iran-story></div>    the scrolling story
//   <script src="iran-map.js"></script>

import { createIranMap } from './map';
import { createIranStory } from './story';

const mounted = new WeakSet<Element>();

function mountAll(): void {
  for (const [selector, create] of [
    ['[data-iran-map]', createIranMap],
    ['[data-iran-story]', createIranStory],
  ] as const) {
    for (const host of document.querySelectorAll<HTMLElement>(selector)) {
      if (mounted.has(host)) continue;
      mounted.add(host);
      create(host);
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
else mountAll();
