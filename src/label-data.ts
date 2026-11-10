// Hand-placed labels for countries, territories and bodies of water.
//
// Cities are not listed here: they come from Natural Earth (src/data/places.json).
// Positions are [longitude, latitude] of the label's centre. "\n" breaks a line.
// minZoom is the web-map zoom level at which a label first appears, so smaller
// places stay hidden until there is room for them. Names follow AP style.

// 'site' is a point of interest added by a story (see story-content.ts): its
// marker is drawn by the story, and the label keeps clear of it.
export type LabelKind = 'focus' | 'country' | 'territory' | 'water' | 'city' | 'site';

export interface LabelSpec {
  text: string;
  lon: number;
  lat: number;
  kind: LabelKind;
  minZoom: number;
  /** Labels with an id start hidden and are switched on with setLabelEnabled(). */
  id?: string;
}

type Row = [text: string, lon: number, lat: number, minZoom?: number];

const rows = (kind: LabelKind, list: Row[]): LabelSpec[] =>
  list.map(([text, lon, lat, minZoom = 0]) => ({ text, lon, lat, kind, minZoom }));

// Earlier rows win when two labels would overlap.
export const AREA_LABELS: LabelSpec[] = [
  ...rows('focus', [['Iran', 55.8, 32.4]]),

  ...rows('country', [
    ['Iraq', 42.3, 34.8],
    ['Saudi\nArabia', 44.8, 24.2],
    ['Turkey', 34.8, 39.1],
    ['Afghanistan', 64.6, 33.0],
    ['Pakistan', 68.6, 29.4],
    ['Turkmenistan', 59.2, 39.6],
    ['Syria', 38.6, 35.0],
    ['Egypt', 29.8, 26.6],
    ['Yemen', 46.6, 15.6],
    ['Oman', 56.8, 20.6],
    ['India', 75.2, 24.4],
    ['Kazakhstan', 60.5, 45.8],
    ['Uzbekistan', 63.4, 41.9],
    ['Russia', 44.4, 45.6],
    ['Sudan', 31.4, 17.2],
    ['Israel', 34.85, 30.75, 4.6],
    ['Jordan', 36.9, 30.9, 4.6],
    ['Kuwait', 47.6, 29.35, 4.6],
    ['UAE', 54.4, 23.6, 4.6],
    ['Qatar', 51.2, 25.3, 4.6],
    ['Azerbaijan', 47.9, 40.4, 4.6],
    ['Armenia', 44.9, 40.3, 4.6],
    ['Georgia', 43.5, 42.1, 4.6],
    ['Tajikistan', 71.0, 38.7, 4.6],
    ['Kyrgyzstan', 74.6, 41.5, 4.6],
    ['China', 79.5, 38.0, 4.6],
    ['Ethiopia', 39.6, 11.2, 4.6],
    ['Eritrea', 38.4, 15.9, 4.6],
    ['Somalia', 48.4, 9.6, 4.6],
    ['Ukraine', 33.5, 47.3, 4.6],
    ['Greece', 22.4, 39.6, 4.6],
    ['Bulgaria', 25.3, 42.7, 4.6],
    ['Romania', 25.0, 45.6, 4.6],
    ['Cyprus', 33.1, 34.95, 5.4],
    ['Lebanon', 35.85, 34.0, 5.4],
    ['Bahrain', 50.55, 26.05, 5.4],
    ['Djibouti', 42.6, 11.8, 5.4],
  ]),

  ...rows('water', [
    ['Persian\nGulf', 51.4, 27.1],
    ['Caspian\nSea', 50.7, 41.2],
    ['Arabian Sea', 63.0, 18.0],
    ['Red\nSea', 37.9, 20.8],
    ['Mediterranean Sea', 30.0, 33.7],
    ['Black Sea', 35.5, 43.4],
    ['Gulf of Oman', 59.4, 24.6, 4.6],
    ['Gulf of Aden', 47.5, 12.5, 4.6],
    ['Strait of\nHormuz', 56.5, 26.55, 6],
    ['Bab el-Mandeb', 43.4, 12.6, 6.6],
  ]),

  ...rows('territory', [
    ['West Bank', 35.25, 32.0, 6.6],
    ['Gaza Strip', 34.38, 31.42, 6.6],
    ['Golan Heights', 35.75, 33.0, 7.4],
  ]),
];
