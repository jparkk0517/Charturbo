/**
 * Playground page: pick any example, edit it, run it in a runner frame. `?example=<family>/<id>`
 * selects the example, `#code=` (share.ts) carries edited code. Shared code waits for Run.
 * `window.__playground` holds the last run status, `window.__ready` turns true after the first.
 */
// First: sets <html lang> (the library's default locale) before anything else runs.
import { setPageMeta, t } from '../i18n';
import '../style.css';
import './playground.css';
import { demoText } from '../demo-text';
import { FAMILIES, renderHeader } from '../families';
import { readMeta, stripMeta } from './meta';
import { createEditor } from './editor';
import { createRunnerFrame, type RunnerFrame, type RunStatus } from './frame';
import { decodeShare, encodeShare } from './share';

declare global {
  interface Window {
    __ready?: boolean;
    __playground?: RunStatus;
  }
}

const sources = import.meta.glob<string>('../demos/*/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

interface Example {
  key: string;
  family: string;
  filename: string;
  title: string;
  source: string;
}

const EXAMPLES: Example[] = Object.keys(sources).sort().map((path) => {
  const [family, file] = path.split('/').slice(-2);
  const id = file.replace(/\.tsx?$/, '');
  const raw = sources[path];
  const meta = readMeta(raw);
  return {
    key: `${family}/${id}`,
    family,
    filename: `${family}/${file}`,
    title: demoText(family, id, { title: meta.title ?? id, description: meta.description }).title,
    source: `${stripMeta(raw).trim()}\n`,
  };
});
const DEFAULT_EXAMPLE = 'line/01-million';

setPageMeta(t('playground.title'), t('playground.description'));
document.body.prepend(renderHeader('playground'));
const main = document.querySelector<HTMLElement>('main.playground')!;
main.innerHTML = `
  <div class="pg-bar">
    <h1></h1>
    <label class="pg-field"><span></span><select name="example"></select></label>
    <button type="button" class="pg-run"></button>
    <button type="button" class="pg-reset"></button>
    <button type="button" class="pg-share"></button>
    <span class="pg-hint"></span>
    <span class="pg-status" role="status" aria-live="polite"></span>
  </div>
  <div class="pg-split">
    <div class="pg-editor"></div>
    <div class="pg-preview"></div>
  </div>`;
const $ = <T extends HTMLElement>(selector: string) => main.querySelector<T>(selector)!;
$('h1').textContent = t('site.playground');
$('.pg-field span').textContent = t('playground.example');
$('.pg-run').textContent = `▶ ${t('page.run')}`;
$('.pg-reset').textContent = t('page.reset');
$('.pg-share').textContent = t('playground.share');
$('.pg-hint').textContent = t('page.runHint');
const select = $<HTMLSelectElement>('select');
for (const family of FAMILIES) {
  const group = document.createElement('optgroup');
  group.label = family.title;
  for (const example of EXAMPLES.filter((e) => e.family === family.id)) group.append(new Option(example.title, example.key));
  if (group.children.length) select.append(group);
}
const status = $('.pg-status');
const preview = $('.pg-preview');

const params = new URLSearchParams(location.search);
let current = EXAMPLES.find((e) => e.key === params.get('example')) ?? EXAMPLES.find((e) => e.key === DEFAULT_EXAMPLE) ?? EXAMPLES[0];
let dirty = false;
let frame: RunnerFrame | undefined;

const setStatus = (text: string, state: 'idle' | 'ok' | 'error' = 'idle') => {
  status.textContent = text;
  status.dataset.state = state;
};

const editor = createEditor($('.pg-editor'), current.source, {
  tsx: current.filename.endsWith('.tsx'),
  label: t('playground.editorLabel'),
  onRun: () => run(),
  onChange: () => { dirty = true; },
});

function run(): void {
  frame?.dispose();
  preview.replaceChildren();
  setStatus(t('playground.running'));
  frame = createRunnerFrame(preview, { source: editor.getValue(), filename: current.filename, family: current.family }, (result) => {
    window.__playground = result;
    window.__ready = true;
    setStatus(result.ok ? t('playground.ok') : t('playground.failed', { error: result.error ?? '' }), result.ok ? 'ok' : 'error');
  });
}

/** `?example=` in the address bar; `code` adds the share hash. */
function updateUrl(code?: string): string {
  const url = new URL(location.href);
  url.searchParams.set('example', current.key);
  url.hash = code ? `code=${code}` : '';
  history.replaceState(null, '', url);
  return url.href;
}

function load(example: Example): void {
  current = example;
  select.value = example.key;
  editor.setValue(example.source, example.filename.endsWith('.tsx'));
  dirty = false;
  updateUrl();
  run();
}

select.addEventListener('change', () => {
  const next = EXAMPLES.find((e) => e.key === select.value)!;
  if (dirty && !confirm(t('playground.discard'))) {
    select.value = current.key;
    return;
  }
  load(next);
});
$('.pg-run').addEventListener('click', run);
$('.pg-reset').addEventListener('click', () => {
  if (!dirty || confirm(t('playground.discard'))) load(current);
});
$('.pg-share').addEventListener('click', async () => {
  const href = updateUrl(await encodeShare(editor.getValue()));
  try {
    await navigator.clipboard.writeText(href);
    setStatus(t('playground.copied'), 'ok');
  } catch {
    setStatus(t('playground.linkInAddressBar'));
  }
});

async function start(): Promise<void> {
  select.value = current.key;
  const shared = new URLSearchParams(location.hash.slice(1)).get('code');
  if (!shared) {
    updateUrl();
    run();
    return;
  }
  try {
    editor.setValue(await decodeShare(shared), current.filename.endsWith('.tsx'));
    dirty = true;
    frame?.dispose();
    frame = undefined;
    preview.replaceChildren();
    const note = preview.appendChild(document.createElement('p'));
    note.className = 'pg-placeholder';
    note.textContent = t('playground.shared');
    setStatus(t('playground.sharedStatus'));
  } catch (err) {
    setStatus(t('playground.badLink', { error: err instanceof Error ? err.message : String(err) }), 'error');
    run();
  }
}

// A share link pasted into an open playground only changes the hash
addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).has('code')) void start();
});
void start();
