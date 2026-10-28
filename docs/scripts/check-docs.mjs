// Locale parity check: every sidebar page and every page under guide/, charts/ and contributing/
// must exist in English (root), Korean (ko/) and Simplified Chinese (zh/). Exits 1 on a gap.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['', 'ko', 'zh'];
const SECTIONS = ['guide', 'charts', 'contributing'];

// Sidebar slugs: groups declare `dir: '<dir>'` followed by `['<slug>', t(...)]` entries
const config = readFileSync(join(root, '.vitepress/config.mts'), 'utf8');
const sidebar = [];
let dir = '';
for (const line of config.split('\n')) {
  const d = line.match(/dir: '([\w-]+)'/);
  if (d) dir = d[1];
  const p = line.match(/^\s*\['([\w-]+)', t\(/);
  if (p && dir) sidebar.push(`${dir}/${p[1]}`);
}

const pagesOf = (locale) => {
  const base = join(root, locale);
  return SECTIONS.flatMap((s) => {
    const sec = join(base, s);
    if (!existsSync(sec)) return [];
    return readdirSync(sec).filter((f) => f.endsWith('.md')).map((f) => relative(base, join(sec, f)).replace(/\.md$/, ''));
  });
};

const all = new Set(['index', ...sidebar, ...LOCALES.flatMap(pagesOf)]);
const missing = [];
for (const page of all) {
  for (const locale of LOCALES) {
    if (!existsSync(join(root, locale, `${page}.md`))) missing.push(join(locale || '(en)', `${page}.md`));
  }
}
const orphans = [...all].filter((p) => p !== 'index' && !sidebar.includes(p));

if (missing.length) console.error(`Missing translations (${missing.length}):\n  ${missing.join('\n  ')}`);
if (orphans.length) console.error(`Pages not in the sidebar (${orphans.length}):\n  ${orphans.join('\n  ')}`);
if (missing.length || orphans.length) process.exit(1);
console.log(`docs: ${sidebar.length + 1} pages x ${LOCALES.length} locales OK`);
