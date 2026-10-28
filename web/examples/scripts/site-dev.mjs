// The whole site locally, as deployed: the docs dev server (VitePress, base /docs/, port 5320)
// runs behind the examples dev server, which proxies /docs/ to it (examples/vite.config.ts).
// Extra arguments go to the examples server, e.g. `npm run site:dev -- --host` for a phone.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const web = resolve(import.meta.dirname, '../..');
const run = (cwd, args) => spawn('npm', args, { cwd, stdio: 'inherit' });
const children = [
  run(resolve(web, '../docs'), ['run', 'dev', '--', '--port', '5320', '--strictPort']),
  run(web, ['run', 'examples:dev', '--', ...process.argv.slice(2)]),
];
// One server stopping (or failing to start) stops the other
for (const child of children) {
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 0;
    for (const other of children) if (other !== child) other.kill();
  });
}
