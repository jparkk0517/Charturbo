/** Page side of a runner frame: create it, send the example, forward theme changes. */
import { lang, t } from '../i18n';
import { getThemeName, subscribeTheme } from '../theme-state';
import { FROM_RUNNER, TO_RUNNER, type FromRunner, type RunRequest, type ToRunner } from './protocol';

export interface RunStatus {
  ok: boolean;
  error?: string;
}

export interface RunnerFrame {
  element: HTMLIFrameElement;
  dispose(): void;
}

const LOAD_TIMEOUT = 15_000;

type Outgoing = ToRunner extends infer M ? (M extends { channel: string } ? Omit<M, 'channel'> : never) : never;

export function createRunnerFrame(container: HTMLElement, request: RunRequest, onStatus: (status: RunStatus) => void): RunnerFrame {
  const frame = document.createElement('iframe');
  frame.className = 'runner-frame';
  frame.title = t('playground.preview');
  // Opaque origin: example code (maybe from a shared link) cannot reach the site's storage,
  // cookies or DOM. The frame has no storage either, so the language travels in the URL. Not in
  // dev: the dev server would have to let any site's sandboxed frame read its files (CORS `null`).
  if (!import.meta.env.DEV) frame.sandbox.add('allow-scripts');
  frame.src = `./runner.html?lang=${lang}`;
  // An opaque origin is "null" and cannot be targeted; `contentWindow` identifies the frame.
  const send = (message: Outgoing) => frame.contentWindow?.postMessage({ channel: TO_RUNNER, ...message }, '*');
  const onMessage = (event: MessageEvent<FromRunner>) => {
    if (event.source !== frame.contentWindow || event.data?.channel !== FROM_RUNNER) return;
    const message = event.data;
    if (message.type === 'ready') {
      clearTimeout(loading);
      send({ type: 'theme', theme: getThemeName() });
      send({ type: 'run', ...request });
    } else if (message.type === 'result') onStatus({ ok: message.ok, error: message.error });
    else onStatus({ ok: false, error: message.error });
  };
  // A runner that never loads (e.g. a host that refuses the sandbox's CORS requests) posts nothing.
  const failure = Object.assign(document.createElement('div'), { className: 'demo-error', textContent: t('playground.loadFailed') });
  failure.setAttribute('role', 'alert');
  const loading = setTimeout(() => {
    frame.replaceWith(failure);
    onStatus({ ok: false, error: failure.textContent! });
  }, LOAD_TIMEOUT);
  addEventListener('message', onMessage);
  const unsubscribe = subscribeTheme(() => send({ type: 'theme', theme: getThemeName() }));
  container.appendChild(frame);
  return {
    element: frame,
    dispose() {
      clearTimeout(loading);
      removeEventListener('message', onMessage);
      unsubscribe();
      frame.remove();
      failure.remove();
    },
  };
}
