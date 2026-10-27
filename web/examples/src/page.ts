/**
 * Family page: mounts every demo of `src/demos/<family>/` (body `data-family`) in a card with
 * its source next to it. `window.__ready` turns true once every demo has mounted (or failed);
 * failures are shown in the card and logged with `console.error`.
 */
import './style.css';
import { FAMILIES, renderHeader } from './families';
import { highlight } from './highlight';
import { VizEngineSDK } from 'viz-engine-sdk';
import { bindTheme } from './theme';

/** A demo file: `meta` + a default `mount(host)` (returns anything, e.g. the SDK instance). */
interface DemoModule {
  meta: { title: string; description?: string; height?: number };
  default: (host: HTMLElement) => unknown;
}

declare global {
  interface Window {
    __ready?: boolean;
    __demos?: { id: string; ok: boolean; error?: string }[];
  }
}

const modules = import.meta.glob<DemoModule>('./demos/*/*.{ts,tsx}');
const sources = import.meta.glob<string>('./demos/*/*.{ts,tsx}', { query: '?raw', import: 'default' });

/** The `meta` export is page plumbing, not part of the example. */
const stripMeta = (source: string) => source.replace(/export const meta = \{[\s\S]*?\n\};\n\n?/, '');

async function main() {
  const familyId = document.body.dataset.family ?? '';
  const family = FAMILIES.find((f) => f.id === familyId);
  document.body.prepend(renderHeader(familyId));
  const mainEl = document.querySelector('main')!;
  const intro = document.createElement('section');
  intro.className = 'intro';
  intro.innerHTML = `<h1></h1><p></p>`;
  intro.querySelector('h1')!.textContent = family?.title ?? familyId;
  intro.querySelector('p')!.textContent = family?.description ?? '';
  mainEl.appendChild(intro);
  if (familyId === 'scene') {
    const { mountSceneDesignControls } = await import('./scene-design');
    mountSceneDesignControls(mainEl);
  }

  const paths = Object.keys(modules)
    .filter((p) => p.startsWith(`./demos/${familyId}/`))
    .sort();
  const results: NonNullable<Window['__demos']> = [];
  const disposers: Array<() => void> = [];
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) disposers.forEach((dispose) => dispose());
  });
  await Promise.all(
    paths.map(async (path) => {
      const id = path.split('/').pop()!.replace(/\.tsx?$/, '');
      let mod: DemoModule;
      let source: string;
      try {
        [mod, source] = await Promise.all([modules[path](), sources[path]()]);
      } catch (err) {
        console.error(`[examples] ${id} failed to load`, err);
        results.push({ id, ok: false, error: String(err) });
        return;
      }
      const card = document.createElement('article');
      card.className = 'demo';
      card.id = id;
      card.innerHTML = `
        <div class="demo-main">
          <h2></h2><p class="demo-desc"></p>
          <div class="demo-host"></div>
        </div>
        <details class="demo-source" open><summary>Source</summary><pre><code></code></pre></details>`;
      card.querySelector('h2')!.textContent = mod.meta.title;
      card.querySelector('.demo-desc')!.textContent = mod.meta.description ?? '';
      card.querySelector('code')!.innerHTML = highlight(stripMeta(source).trim());
      const host = card.querySelector<HTMLElement>('.demo-host')!;
      host.style.height = `${mod.meta.height ?? 340}px`;
      mainEl.appendChild(card);
      // Keep file order in the DOM regardless of load order
      card.style.order = String(paths.indexOf(path));
      try {
        const demo = await mod.default(host);
        const sdk = demo instanceof VizEngineSDK ? demo
          : demo && typeof demo === 'object' && 'sdk' in demo && demo.sdk instanceof VizEngineSDK ? demo.sdk : null;
        if (sdk && familyId !== 'scene') disposers.push(bindTheme(sdk));
        if (demo && typeof demo === 'object' && 'dispose' in demo && typeof demo.dispose === 'function') {
          const dispose = demo.dispose.bind(demo);
          disposers.push(dispose);
        }
        results.push({ id, ok: true });
      } catch (err) {
        console.error(`[examples] ${id} failed`, err);
        const box = document.createElement('div');
        box.className = 'demo-error';
        box.textContent = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        host.appendChild(box);
        results.push({ id, ok: false, error: box.textContent });
      }
    })
  );
  window.__demos = results;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__ready = true;
}

void main();
