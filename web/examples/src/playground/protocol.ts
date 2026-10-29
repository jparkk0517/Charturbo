/** Messages between a page and its runner frame (`runner.html`, same origin). */
import type { ThemeName } from '../theme-state';

export const TO_RUNNER = 'charturbo-playground';
export const FROM_RUNNER = 'charturbo-runner';

export interface RunRequest {
  source: string;
  /** `.tsx` turns on JSX. */
  filename: string;
  /** Example family: the 3D scene demos keep their own theme handling. */
  family?: string;
}

export type ToRunner =
  | ({ channel: typeof TO_RUNNER; type: 'run' } & RunRequest)
  | { channel: typeof TO_RUNNER; type: 'theme'; theme: ThemeName };

export type FromRunner =
  | { channel: typeof FROM_RUNNER; type: 'ready' }
  /** Mount finished (`ok`) or compiling / importing / mounting threw. */
  | { channel: typeof FROM_RUNNER; type: 'result'; ok: boolean; error?: string }
  /** Uncaught error or rejection after mount. */
  | { channel: typeof FROM_RUNNER; type: 'error'; error: string };
