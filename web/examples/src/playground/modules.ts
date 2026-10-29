/**
 * Modules a playground example can import: the public packages plus the example helpers
 * (`../../theme` and friends, served by file name). Loaded on demand, only what the code uses.
 * `__esModule` marks the namespaces so Sucrase's default-import interop returns them as is.
 */
type Loader = () => Promise<object>;

export const MODULE_LOADERS: Record<string, Loader> = {
  charturbo: () => import('charturbo'),
  'charturbo/react': () => import('charturbo/react'),
  'charturbo/vue': () => import('charturbo/vue'),
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react-dom/client': () => import('react-dom/client'),
  vue: () => import('vue'),
  theme: () => import('../theme'),
  'demo-playback': () => import('../demo-playback'),
  'scene-design': () => import('../scene-design'),
  'streaming-area': () => import('../streaming-area'),
};

export async function loadModules(ids: string[]): Promise<Record<string, unknown>> {
  const unknown = ids.filter((id) => !(id in MODULE_LOADERS));
  if (unknown.length) {
    throw new Error(`Cannot import ${unknown.map((id) => `"${id}"`).join(', ')}. Available: ${Object.keys(MODULE_LOADERS).join(', ')}`);
  }
  const entries = await Promise.all(ids.map(async (id) => [id, { __esModule: true, ...(await MODULE_LOADERS[id]()) }] as const));
  return Object.fromEntries(entries);
}
