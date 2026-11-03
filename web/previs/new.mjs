#!/usr/bin/env node
// Scaffold a previs generator: node previs/new.mjs <name>   (usually: npm run previs:new -- <name>)
//
// Writes previs/examples/<name>.gen.ts from a minimal template (one mannequin, one shot, one role).
// Refuses to overwrite an existing generator (exit 2). Name must match ^[a-z0-9][a-z0-9-]*$ (exit 2).
// Then run the generator the documented way (from web/):
//   node --experimental-strip-types previs/examples/<name>.gen.ts      -> writes previs/examples/<name>.json
// and render it:
//   npm run previs:render -- previs/examples/<name>.json --still=0.5 --out=<out.png>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const TEMPLATE = `// Generator for __NAME__.json (scaffold from \`npm run previs:new -- __NAME__\`).
// Run from web/: node --experimental-strip-types previs/examples/__NAME__.gen.ts
// Writes previs/examples/__NAME__.json next to this file; render it with
//   npm run previs:render -- previs/examples/__NAME__.json --still=0.5 --out=__NAME__.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMannequin, validateDoc } from '../../src/previs/index.ts';
import type { PrevisDoc, Rgb } from '../../src/previs/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const DUR = 3; // seconds

const HERO_COLOR: Rgb = [0.85, 0.35, 0.2];

// one mannequin (rigid, default limbs); its nodes are plain PrevisNode data
const hero = createMannequin({ id: 'hero', color: HERO_COLOR, role: 'hero', height: 1.75, position: [0, 0, 0] });

const doc: PrevisDoc = {
  version: 1,
  title: '__NAME__',
  fps: FPS,
  size: { width: 640, height: 360 },
  background: [0.2, 0.2, 0.22],
  roles: [{ id: 'hero', label: 'hero', color: HERO_COLOR }],
  nodes: hero.nodes,
  // one shot covering [0, DUR)
  shots: [
    {
      id: 's1',
      start: 0,
      end: DUR,
      camera: {
        position: [{ t: 0, v: [0, 1.4, 5] }],
        target: { track: [{ t: 0, v: [0, 1.0, 0] }] },
      },
    },
  ],
};

const v = validateDoc(JSON.parse(JSON.stringify(doc)));
if (!v.ok) {
  for (const i of v.issues) console.error(\`\${i.path}: \${i.message}\`);
  process.exit(2);
}
const outJson = path.join(HERE, '__NAME__.json');
fs.writeFileSync(outJson, JSON.stringify(doc, null, 2) + '\\n');
console.log('wrote', outJson, 'nodes', doc.nodes.length);
`;

function main() {
  const name = process.argv[2];
  if (!name || !NAME_RE.test(name)) {
    console.error('usage: npm run previs:new -- <name>   (name: lowercase letters, digits, hyphens; must start with a letter or digit)');
    process.exit(2);
  }
  const target = path.join(HERE, 'examples', `${name}.gen.ts`);
  let fd;
  try {
    // 'wx': fail if the file exists, so an existing generator is never overwritten
    fd = fs.openSync(target, 'wx');
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      console.error(`refusing to overwrite existing ${path.relative(process.cwd(), target)}`);
      process.exit(2);
    }
    throw err;
  }
  fs.writeSync(fd, TEMPLATE.split('__NAME__').join(name));
  fs.closeSync(fd);
  console.log('wrote', target);
  console.log(`next: node --experimental-strip-types previs/examples/${name}.gen.ts`);
}

main();
