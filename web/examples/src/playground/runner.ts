/**
 * Runner frame (`runner.html`): compiles and mounts one example sent by the parent page, then
 * reports the outcome. One run per frame: the page replaces the frame to run again, which also
 * releases the GPU device, timers and listeners of the previous run.
 */
// First: sets <html lang> (the library's default locale) before anything else runs.
import '../i18n';
import '../style.css';
import './playground.css';
import { Charturbo } from 'charturbo';
import { bindTheme, setThemeName, THEMES } from '../theme';
import { compileDemo, evaluateDemo } from './compile';
import { loadModules } from './modules';
import { FROM_RUNNER, TO_RUNNER, type FromRunner, type RunRequest, type ToRunner } from './protocol';

type Message = FromRunner extends infer M ? (M extends { channel: string } ? Omit<M, 'channel'> : never) : never;

const host = document.querySelector<HTMLElement>('.demo-host')!;
// Sandboxed (except in dev), so `location.origin` is "null"; the URL still names the site that
// serves the frame, and only a page of that site (the parent) may run code here.
const SITE = new URL(location.href).origin;
const post = (message: Message) => parent.postMessage({ channel: FROM_RUNNER, ...message }, SITE);
const describe = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

function showError(message: string): void {
  const list = document.querySelector('.runner-errors') ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'runner-errors' }));
  const box = list.appendChild(document.createElement('div'));
  box.className = 'demo-error';
  box.setAttribute('role', 'alert');
  box.textContent = message;
}

let started = false;
async function run({ source, filename, family }: RunRequest): Promise<void> {
  if (started) return;
  started = true;
  try {
    const { code, imports } = compileDemo(source, filename);
    const exports = evaluateDemo(code, await loadModules(imports));
    if (typeof exports.default !== 'function') throw new Error('The example must `export default function mount(host) { … }`');
    const demo: unknown = await exports.default(host);
    const sdk = demo instanceof Charturbo ? demo
      : demo && typeof demo === 'object' && 'sdk' in demo && demo.sdk instanceof Charturbo ? demo.sdk : null;
    if (sdk && family !== 'scene') bindTheme(sdk);
    post({ type: 'result', ok: true });
  } catch (err) {
    console.error('[playground]', err);
    showError(describe(err));
    post({ type: 'result', ok: false, error: describe(err) });
  }
}

addEventListener('message', (event: MessageEvent<ToRunner>) => {
  if (event.source !== parent || event.origin !== SITE || event.data?.channel !== TO_RUNNER) return;
  const message = event.data;
  if (message.type === 'run') void run(message);
  else if (message.type === 'theme' && message.theme in THEMES) setThemeName(message.theme);
});
addEventListener('error', (event) => {
  const message = describe(event.error ?? event.message);
  showError(message);
  post({ type: 'error', error: message });
});
addEventListener('unhandledrejection', (event) => {
  const message = describe(event.reason);
  showError(message);
  post({ type: 'error', error: message });
});
post({ type: 'ready' });
