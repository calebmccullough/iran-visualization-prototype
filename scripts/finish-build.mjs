// Runs after `vite build`. Two jobs:
//
//   1. Prepend the third-party licence notices to dist/iran-map.js. The bundled
//      libraries' licences (ISC, BSD) require their notices to travel with every
//      copy, and minifying strips them.
//   2. Write dist/index.html (the explorable map) and dist/story.html (the
//      scrolling story): the pages of the same names with that script inlined,
//      so each is one file that makes no network requests.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'dist', 'iran-map.js');
const DEV_SCRIPT = '<script type="module" src="/src/embed.ts"></script>';
// In the dependency tree but not in the bundle (topojson-client's CLI only).
const NOT_BUNDLED = new Set(['commander']);

// Licence text of every runtime dependency, grouped where the text is shared.
function thirdPartyNotices() {
  const byText = new Map();
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name) || NOT_BUNDLED.has(name)) return;
    seen.add(name);
    const dir = join(ROOT, 'node_modules', name);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((f) => /^licen[sc]e/i.test(f));
    if (!file) throw new Error(`${name} has no licence file to include in the bundle`);
    const text = readFileSync(join(dir, file), 'utf8').trim();
    byText.set(text, [...(byText.get(text) ?? []), `${name}@${pkg.version}`]);
    Object.keys(pkg.dependencies ?? {}).forEach(visit);
  };
  const { dependencies } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  Object.keys(dependencies).sort().forEach(visit);

  const body = [
    'Map of Iran and the surrounding region.',
    'Map data: Natural Earth (public domain), naturalearthdata.com',
    'Includes the following open-source libraries:',
    ...[...byText].map(([text, names]) => `${names.join(', ')}\n\n${text}`),
  ].join('\n\n');
  return `/*!\n${body.replaceAll('*/', '* /')}\n*/\n`;
}

const bundle = thirdPartyNotices() + readFileSync(BUNDLE, 'utf8');
writeFileSync(BUNDLE, bundle);

const kb = (text) => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;
const written = [`dist/iran-map.js ${kb(bundle)}`];

for (const name of ['index.html', 'story.html']) {
  const page = readFileSync(join(ROOT, name), 'utf8');
  if (!page.includes(DEV_SCRIPT)) throw new Error(`${name} no longer contains the dev script tag`);
  // "</script" inside the bundle would end the inline script early. A function
  // replacement keeps "$" sequences in the bundle literal.
  const html = page.replace(DEV_SCRIPT, () => `<script>\n${bundle.replaceAll('</script', '<\\/script')}</script>`);
  writeFileSync(join(ROOT, 'dist', name), html);
  written.push(`dist/${name} ${kb(html)}`);
}
console.log(written.join(', '));
