#!/usr/bin/env node
// Every plotted mark / axis / label is rendered by VizEngineSDK and exportChartSVG().
// npm run bench:charts -- [results.json] [--out=directory]
import fs from 'node:fs';
import path from 'node:path';
import { openReport } from './report-browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const input = process.argv.slice(2).find((s) => !s.startsWith('--')) ?? path.join(ROOT, 'docs/bench/results.json');
const out = process.argv.find((s) => s.startsWith('--out='))?.slice(6) ?? path.join(ROOT, 'docs/assets');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!data.meta || !Array.isArray(data.compare)) throw new Error('Expected benchmark results with meta and compare');
const browser = await openReport();
try {
  await browser.evaluate(`window.__reportData = ${JSON.stringify(data)}`);
  const exports = [];
  for (const group of ['ttff', 'fps', 'graph']) {
    for (const theme of ['light', 'dark']) {
      const svg = await browser.evaluate(`window.__benchmark.export(window.__reportData, '${group}', '${theme}')`);
      if (!svg?.includes('Rendered with VizEngineSDK') || /(?:NaN|Infinity)/.test(svg)) throw new Error(`Invalid SVG: ${group}/${theme}`);
      exports.push({ file: path.join(out, `bench-${group}-${theme}.svg`), svg });
    }
  }
  if (browser.errors.length) throw new Error(browser.errors.join('\n'));
  fs.mkdirSync(out, { recursive: true });
  for (const { file, svg } of exports) { fs.writeFileSync(file, svg); console.log(`[bench:charts] ${path.relative(ROOT, file)}`); }
} finally { await browser.close(); }
