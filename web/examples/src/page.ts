/**
 * Family page: mounts every demo of `src/demos/<family>/` (body `data-family`) in a card with
 * its source next to it. `window.__ready` turns true once every demo has mounted (or failed);
 * failures are shown in the card and logged with `console.error`. Edit turns the source into an
 * editor; Run then replaces the demo with the edited code in a playground runner frame.
 */
// First: sets <html lang> (the library's default locale) before anything else runs.
import { docsHref, t, setPageMeta } from './i18n';
import './style.css';
import { demoText } from './demo-text';
import { DOC_PAGES, FAMILIES, renderHeader } from './families';
import { renderFooter } from './site-footer';
import { highlight } from './highlight';
import { Charturbo } from 'charturbo';
import { bindTheme } from './theme';
import { stripMeta } from './playground/meta';
import type { RunnerFrame } from './playground/frame';
import './playground/playground.css';

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

async function main() {
  const familyId = document.body.dataset.family ?? '';
  const family = FAMILIES.find((f) => f.id === familyId);
  setPageMeta(t('page.title', { family: family?.title ?? familyId }), family?.description);
  document.body.prepend(renderHeader(familyId));
  document.querySelector('main')!.after(renderFooter());
  const mainEl = document.querySelector('main')!;
  const intro = document.createElement('section');
  intro.className = 'intro';
  intro.innerHTML = `<h1></h1><p></p>`;
  intro.querySelector('h1')!.textContent = family?.title ?? familyId;
  intro.querySelector('p')!.textContent = family?.description ?? '';
  if (DOC_PAGES[familyId]) {
    const links = intro.appendChild(document.createElement('p'));
    links.className = 'intro-links';
    const docs = links.appendChild(document.createElement('a'));
    docs.href = docsHref(DOC_PAGES[familyId]);
    docs.textContent = t('page.docs');
  }
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
        const card = document.createElement('article');
        card.className = 'demo';
        card.id = id;
        card.style.order = String(paths.indexOf(path));
        const body = card.appendChild(document.createElement('div'));
        body.className = 'demo-main';
        body.style.gridColumn = '1 / -1';
        const title = body.appendChild(document.createElement('h2'));
        title.textContent = demoText(familyId, id).title;
        const box = body.appendChild(document.createElement('div'));
        box.className = 'demo-error';
        box.setAttribute('role', 'alert');
        box.textContent = t('page.loadFailed', { error: String(err) });
        mainEl.appendChild(card);
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
        <details class="demo-source" open><summary></summary>
          <div class="demo-source-actions"><button type="button" class="pg-edit"></button><a class="pg-open"></a></div>
          <pre><code></code></pre>
        </details>`;
      const text = demoText(familyId, id, mod.meta);
      const code = `${stripMeta(source).trim()}\n`;
      const filename = path.split('/').slice(-2).join('/');
      card.querySelector('h2')!.textContent = text.title;
      card.querySelector('.demo-desc')!.textContent = text.description;
      card.querySelector('summary')!.textContent = t('page.source');
      card.querySelector('code')!.innerHTML = highlight(code.trim());
      const host = card.querySelector<HTMLElement>('.demo-host')!;
      host.style.height = `${mod.meta.height ?? 340}px`;
      mainEl.appendChild(card);
      // Keep file order in the DOM regardless of load order
      card.style.order = String(paths.indexOf(path));

      // The running demo (direct mount or runner frame) and how to stop it. Mounts, runs and
      // resets of a card are queued, so an async mount can never land next to a newer one.
      let stop = () => {};
      disposers.push(() => stop());
      let queue: Promise<unknown> = Promise.resolve();
      const enqueue = <T,>(task: () => T | Promise<T>): Promise<T> => {
        const next = queue.then(task);
        queue = next.catch(() => {});
        return next;
      };
      const actions = card.querySelector<HTMLElement>('.demo-source-actions')!;
      const open = actions.querySelector<HTMLAnchorElement>('.pg-open')!;
      open.textContent = t('page.openPlayground');
      open.href = `./playground.html?example=${encodeURIComponent(`${familyId}/${id}`)}`;
      const edit = actions.querySelector<HTMLButtonElement>('.pg-edit')!;
      edit.textContent = t('page.edit');
      edit.addEventListener('click', () => void startEditing());

      async function startEditing() {
        if (edit.disabled) return;
        edit.disabled = true;
        let modules;
        try {
          modules = await Promise.all([import('./playground/editor'), import('./playground/frame'), import('./playground/share')]);
        } catch (err) {
          // Offline or a stale chunk after a deploy: let the user try again
          console.error(`[examples] ${id}: the editor could not be loaded`, err);
          edit.disabled = false;
          return;
        }
        const [{ createEditor }, { createRunnerFrame }, { encodeShare }] = modules;
        const box = document.createElement('div');
        box.className = 'demo-editor';
        card.querySelector('pre')!.replaceWith(box);
        let dirty = false;
        const runEdited = () => void enqueue(() => {
          stop();
          host.replaceChildren();
          const frame: RunnerFrame = createRunnerFrame(host, { source: editor.getValue(), filename, family: familyId }, () => {});
          stop = () => frame.dispose();
        });
        const editor = createEditor(box, code, {
          tsx: filename.endsWith('.tsx'),
          label: t('playground.editorLabel'),
          onRun: runEdited,
          onChange: () => { dirty = true; },
        });
        const run = document.createElement('button');
        run.type = 'button';
        run.className = 'pg-run';
        run.textContent = `▶ ${t('page.run')}`;
        run.addEventListener('click', runEdited);
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = t('page.reset');
        reset.addEventListener('click', () => {
          editor.setValue(code);
          dirty = false;
          void enqueue(mountDirect);
        });
        const hint = document.createElement('span');
        hint.className = 'pg-hint';
        hint.textContent = t('page.runHint');
        edit.replaceWith(run, reset);
        actions.append(hint);
        // Carry the edits over to the playground
        open.addEventListener('click', async (event) => {
          // Modified clicks open a new tab or window: leave those to the browser
          if (!dirty || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          location.href = `${open.href}#code=${await encodeShare(editor.getValue())}`;
        });
        editor.view.focus();
      }

      async function mountDirect(): Promise<NonNullable<Window['__demos']>[number]> {
        stop();
        stop = () => {};
        host.replaceChildren();
        try {
          const demo = await mod.default(host);
          const sdk = demo instanceof Charturbo ? demo
            : demo && typeof demo === 'object' && 'sdk' in demo && demo.sdk instanceof Charturbo ? demo.sdk : null;
          const unbind = sdk && familyId !== 'scene' ? bindTheme(sdk) : undefined;
          const dispose = demo && typeof demo === 'object' && 'dispose' in demo && typeof demo.dispose === 'function'
            ? demo.dispose.bind(demo) as () => void : undefined;
          stop = () => { unbind?.(); dispose?.(); };
          return { id, ok: true };
        } catch (err) {
          console.error(`[examples] ${id} failed`, err);
          const box = document.createElement('div');
          box.className = 'demo-error';
          const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          box.textContent = t('page.runFailed', { error: message });
          host.appendChild(box);
          return { id, ok: false, error: message };
        }
      }
      results.push(await enqueue(mountDirect));
    })
  );
  window.__demos = results;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__ready = true;
}

void main();
