#!/usr/bin/env node
// `prepublishOnly` guard: refuses to publish while package.json / LICENSE still hold the
// `TODO` placeholders of the release prep (author, homepage, repository, bugs, copyright holder).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8'));
const problems = [];
for (const key of ['author', 'homepage', 'repository', 'bugs']) {
  const value = JSON.stringify(pkg[key] ?? '');
  if (!pkg[key] || value.includes('TODO')) problems.push(`package.json "${key}" is missing or a TODO placeholder`);
}
const license = path.join(WEB, 'LICENSE');
if (!fs.existsSync(license)) problems.push('LICENSE is missing');
else if (fs.readFileSync(license, 'utf8').includes('TODO')) problems.push('LICENSE copyright holder is a TODO placeholder');
if (problems.length) {
  console.error(`[release] not publishable:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('[release] metadata ok');
