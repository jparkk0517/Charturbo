/** The page-only `meta` export of an example file (no compiler: the example pages import this). */
const META = /export const meta = \{[\s\S]*?\n\};\n\n?/;

/** The `meta` export is page plumbing (title, card height), not part of the example. */
export const stripMeta = (source: string) => source.replace(META, '');

export interface DemoMeta {
  title?: string;
  description?: string;
  height?: number;
}

/** `meta.title` / `description` (string literals) and `height` of an example, as far as set. */
export function readMeta(source: string): DemoMeta {
  const block = META.exec(source)?.[0] ?? '';
  const text = (key: string) => {
    const m = block.match(new RegExp(`\\b${key}:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`));
    return m ? m[2].replace(/\\(.)/g, '$1') : undefined;
  };
  const height = block.match(/\bheight:\s*(\d+)/);
  const meta: DemoMeta = {};
  const title = text('title');
  const description = text('description');
  if (title !== undefined) meta.title = title;
  if (description !== undefined) meta.description = description;
  if (height) meta.height = Number(height[1]);
  return meta;
}
