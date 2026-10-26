#!/usr/bin/env node
// Post-build step of `npm run build:lib` (declarations in dist-lib/):
// 1. tsc emits extensionless relative specifiers (`from './color'`, `import("..")`) because the
//    sources use `moduleResolution: bundler`. Consumers on `moduleResolution: node16 / nodenext`
//    (ESM) cannot resolve those, and the types silently become `any`. Rewrites them to explicit
//    `.js` / `/index.js` specifiers.
// 2. Writes `index.d.cts` / `inline.d.cts` for the `require` condition (UMD build): the package is
//    `"type": "module"`, so `index.d.ts` is ESM-typed and a node16 CJS consumer would get TS1479.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-lib');
const SPEC_RE = /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\.?(?:\/[^'"]*)?)\2/g;

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

let files = 0;
let rewrites = 0;
const unresolved = [];
for (const file of walk(DIST).filter((f) => f.endsWith('.d.ts'))) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(SPEC_RE, (match, lead, quote, spec) => {
    if (/\.(js|mjs|cjs)$/.test(spec)) return match;
    const target = path.resolve(path.dirname(file), spec);
    let next;
    if (fs.existsSync(`${target}.d.ts`)) next = `${spec}.js`;
    else if (fs.existsSync(path.join(target, 'index.d.ts'))) next = `${spec.replace(/\/$/, '')}/index.js`;
    if (!next) {
      unresolved.push(`${path.relative(DIST, file)}: ${spec}`);
      return match;
    }
    rewrites++;
    return `${lead}${quote}${next}${quote}`;
  });
  if (out !== src) {
    fs.writeFileSync(file, out);
    files++;
  }
}
if (unresolved.length) {
  console.error(`[finalize-dts] unresolved relative specifiers:\n  ${unresolved.join('\n  ')}`);
  process.exit(1);
}
for (const entry of ['index', 'inline']) {
  fs.writeFileSync(
    path.join(DIST, `${entry}.d.cts`),
    `// @ts-ignore TS1479: CJS view of the ESM declarations (same API as the UMD build)\nexport * from './${entry}.js';\n`
  );
}
console.log(`[finalize-dts] ${rewrites} specifiers in ${files} files, index.d.cts + inline.d.cts`);
