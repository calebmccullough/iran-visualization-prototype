// Text and map states for the scrolling story: one entry per step.
//
// Each step describes the complete map state while it is on screen (camera,
// highlighted countries, strike graphic), not a change from the step before.
// That is what lets a reader scroll back up and see each state again.
//
// Quotes are checked against the CQ transcripts in the Neon transcript
// database (IDs noted beside each). Strike details come from the articles
// linked in each attack step.

import { HOME_BOUNDS, type Bounds } from './projection';

/** What the strike graphic shows: nothing, the base marker, or the attack. */
export type StrikeMode = 'none' | 'site' | 'attack';

export interface StepState {
  /** Lon/lat box the camera frames. */
  camera: Bounds;
  /** Used instead of camera when the cards span the screen (phones). */
  narrowCamera?: Bounds;
  /** Countries with the highlight fill (ISO 3166-1 alpha-3). */
  focus: string[];
  /** Which site's strike graphic to show, and how much of it. */
  strike?: { site: SiteId; mode: Exclude<StrikeMode, 'none'> };
}

export interface Source {
  label: string;
  url: string;
}

/**
 * What a card is, which sets how it looks: the opening title, a Trump claim,
 * background on a place, or an attack.
 */
export type CardType = 'title' | 'claim' | 'context' | 'attack';

export interface StepCard {
  type: CardType;
  /** Title cards only. */
  headline?: string;
  /** Short line above the card body, usually a date. */
  kicker?: string;
  /** Short date for the progress marker. Steps without one add no tick. */
  tick?: string;
  /** Context before the quote. */
  lead?: string;
  quote?: string;
  attribution?: string;
  body?: string[];
  /** Short list, e.g. people killed. */
  list?: string[];
  note?: string;
  sources?: Source[];
}

export interface Step {
  card: StepCard;
  state: StepState;
}

export type SiteId = 'prince-sultan' | 'muwaffaq-salti';

export interface Site {
  /** Label text; "\n" breaks a line. */
  name: string;
  lon: number;
  lat: number;
  /**
   * Where the attack arc starts, inside Iran. The reporting does not identify
   * launch sites, so the arc shows direction only and the cards say so.
   */
  arcFrom: { lon: number; lat: number };
}

// Coordinates are from each base's Wikipedia article.
export const SITES: Record<SiteId, Site> = {
  'prince-sultan': { name: 'Prince Sultan\nAir Base', lon: 47.56361, lat: 24.05528, arcFrom: { lon: 51.4, lat: 29.9 } },
  'muwaffaq-salti': { name: 'Muwaffaq Salti\nAir Base', lon: 36.78722, lat: 31.83417, arcFrom: { lon: 47.6, lat: 33.4 } },
};

const IRAN_ONLY = ['IRN'];
const IRAN_AND_JORDAN = ['IRN', 'JOR'];
const IRAN_AND_SAUDI = ['IRN', 'SAU'];
// The regional view is too wide for a portrait phone, so phones open on Iran.
const IRAN_VIEW: Bounds = [44, 25, 63, 39.8];
const SAUDI_VIEW: Bounds = [42.8, 20.8, 52.2, 28.6];
const SAUDI_STRIKE_VIEW: Bounds = [42.8, 20.5, 55.5, 31.2];
// Phones: the same subjects, framed so the base is not near the bottom edge.
const SAUDI_VIEW_NARROW: Bounds = [44.5, 21.6, 51.5, 28.4];
const SAUDI_STRIKE_VIEW_NARROW: Bounds = [44.0, 21.4, 53.5, 31.0];
const JORDAN_VIEW: Bounds = [34.6, 29.0, 39.6, 33.6];
const STRIKE_VIEW: Bounds = [34.6, 28.9, 50.2, 35.6];
const OPENING = { camera: HOME_BOUNDS, narrowCamera: IRAN_VIEW, focus: IRAN_ONLY } as const satisfies StepState;

export const STEPS: Step[] = [
  {
    card: {
      type: 'title',
      headline: 'A timeline of Trump’s claims of victory over Iran.',
      body: ['Trump repeatedly said the war was over and Iran had been beaten. Iran continued to target U.S. troops in the region.'],
    },
    state: OPENING,
  },
  {
    // CQ 8430815, NRCC annual fundraising dinner, March 25, 2026 (turn 1).
    card: {
      type: 'claim',
      kicker: 'March 25',
      tick: 'March 25',
      quote:
        'You saw that in Venezuela. One hour, the war was over. And, you know, this is a larger country now that we’re fighting. But the war essentially ended a few days after we went in. We knocked out their Navy.',
      attribution: 'Trump, at the National Republican Congressional Committee’s annual fundraising dinner',
    },
    state: OPENING,
  },
  {
    // CQ 8432048, call-in interview on Fox News' "The Five," March 26, 2026 (turns 24–25).
    card: {
      type: 'claim',
      kicker: 'March 26',
      tick: 'March 26',
      lead: 'On Fox News’ “The Five,” co-host Kennedy asked Trump what winning the war would look like.',
      quote: 'Well, we’ve already won the war. Militarily, we’ve totally won the war.',
      attribution: 'Trump',
    },
    state: OPENING,
  },
  {
    card: {
      type: 'context',
      kicker: 'Saudi Arabia',
      body: [
        'U.S. forces operate from Prince Sultan Air Base in Al Kharj, about 60 miles from Riyadh.',
        'Iran had already hit the base early in the war. On March 1, an attack wounded Sgt. Benjamin Pennington, who died March 8 of his injuries.',
      ],
      sources: [{ label: 'ABC News', url: 'https://abcnews.com/Politics/pentagon-ids-7th-us-service-member-killed-iran/story?id=130902276' }],
    },
    state: { camera: SAUDI_VIEW, narrowCamera: SAUDI_VIEW_NARROW, focus: IRAN_AND_SAUDI, strike: { site: 'prince-sultan', mode: 'site' } },
  },
  {
    card: {
      type: 'attack',
      kicker: 'March 27 · The next day',
      tick: 'March 27',
      body: [
        'Iranian missiles and drones struck Prince Sultan Air Base again.',
        'Twelve U.S. troops were wounded, two of them seriously, a U.S. official told Reuters.',
        'The attack damaged an E-3 Sentry, an airborne radar and command plane, and aerial refueling tankers, according to Air & Space Forces Magazine.',
      ],
      note: 'The arc shows the direction of the attack. Its launch site was not reported.',
      sources: [
        { label: 'Reuters', url: 'https://ca.marketscreener.com/news/twelve-us-troops-wounded-in-iran-strike-on-base-in-saudi-arabia-us-official-says-ce7e51d8da8bf52c' },
        { label: 'Air & Space Forces Magazine', url: 'https://www.airandspaceforces.com/key-e-3-awacs-aircraft-damaged-iranian-attack-saudi-air-base/' },
      ],
    },
    state: {
      camera: SAUDI_STRIKE_VIEW,
      narrowCamera: SAUDI_STRIKE_VIEW_NARROW,
      focus: IRAN_AND_SAUDI,
      strike: { site: 'prince-sultan', mode: 'attack' },
    },
  },
  {
    // CQ 8484947, Virtual Tele-Rally for Burt Jones, June 11, 2026.
    card: {
      type: 'claim',
      kicker: 'June 11',
      tick: 'June 11',
      lead: 'On June 11, Trump announced a deal for a 60-day ceasefire with Iran, while Iranian officials said they were still reviewing it. Before Iran’s leaders signed the deal, Trump said the war was over.',
      quote:
        'I don’t know if you heard, but we ended the war with Iran today and they have agreed never to have a nuclear weapon, something that we insisted on.',
      attribution: 'Trump, in a tele-rally for Burt Jones’ campaign in Georgia',
    },
    state: OPENING,
  },
  {
    // CQ 8497197, gaggle aboard Air Force One, July 8, 2026 (turns 34–35).
    card: {
      type: 'claim',
      kicker: 'July 8',
      tick: 'July 8',
      lead: 'Aboard Air Force One, a reporter asked whether the U.S. was returning to full-scale military conflict with Iran. Trump said he didn’t know, then added:',
      quote: 'We have many ways we can win, but we’ve already won militarily. They got very little left.',
      attribution: 'Trump',
    },
    state: OPENING,
  },
  {
    // CQ 8501905, Fox News interview with Trey Yingst, July 14, 2026 (turns 6–9).
    card: {
      type: 'claim',
      kicker: 'July 14',
      tick: 'July 14',
      lead:
        'Fox News’ Trey Yingst listed the U.S. objectives — ensuring Iran never has a nuclear weapon, keeping the Strait of Hormuz open and degrading Iran’s military — and asked whether they could be completed by an air campaign alone or required ground forces.',
      quote:
        'Well, I think they’re completed now, honestly. If we left right now, it would take them 20 years to rebuild what they have. I think it’s completed now.',
      attribution: 'Trump',
    },
    state: OPENING,
  },
  {
    card: {
      type: 'context',
      kicker: 'Jordan',
      body: ['U.S. forces are stationed at Muwaffaq Salti Air Base, a Royal Jordanian Air Force base in Azraq, east of Amman.'],
    },
    state: { camera: JORDAN_VIEW, focus: IRAN_AND_JORDAN, strike: { site: 'muwaffaq-salti', mode: 'site' } },
  },
  {
    card: {
      type: 'attack',
      kicker: 'July 17 · Three days later',
      tick: 'July 17',
      body: [
        'Iranian drones and missiles struck Muwaffaq Salti Air Base, part of a wave of attacks on installations used by U.S. troops in the region.',
        'Three U.S. soldiers died and four were injured.',
      ],
      list: [
        'Sgt. Angel S. Rampersad, 28, of Ozone Park, New York. First listed as missing; the Pentagon confirmed July 25 that remains found at the base were hers.',
        'Pvt. Isabella Gonzales, 19, of Carrollton, Texas.',
        '1st Lt. Tyler James Feehan, 25, of Ewa Beach, Hawaii, who died July 18.',
      ],
      note: 'The arc shows the direction of the attack. Its launch site was not reported.',
      sources: [
        { label: 'Task & Purpose', url: 'https://taskandpurpose.com/news/jordan-iran-feehan-gonzales-rampersad/' },
        { label: 'U.S. Army', url: 'https://www.army.mil/article/294039' },
      ],
    },
    state: { camera: STRIKE_VIEW, focus: IRAN_AND_JORDAN, strike: { site: 'muwaffaq-salti', mode: 'attack' } },
  },
];

export const CREDITS =
  'Quotes from CQ transcripts. Map data: Natural Earth. Base locations: Wikipedia.';
