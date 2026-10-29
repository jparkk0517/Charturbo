import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileDemo, evaluateDemo, resolveSpecifier } from '../../examples/src/playground/compile';
import { readMeta, stripMeta } from '../../examples/src/playground/meta';
import { MODULE_LOADERS } from '../../examples/src/playground/modules';
import { decodeShare, encodeShare } from '../../examples/src/playground/share';

const demos = resolve(import.meta.dirname, '../../examples/src/demos');
const demoFiles = readdirSync(demos).flatMap((family) =>
  readdirSync(resolve(demos, family)).map((file) => ({ path: `${family}/${file}`, source: readFileSync(resolve(demos, family, file), 'utf8') }))
);

describe('playground compiler', () => {
  it('strips types, rewrites imports to require and keeps the default mount export', () => {
    const { code, imports } = compileDemo(
      `import { Charturbo, type ChartOptions } from 'charturbo';\nimport { chartTheme } from '../../theme';\n` +
        `const n: number = 3;\nexport default function mount(host: HTMLElement) { return [Charturbo, chartTheme, n, host]; }`,
      'demo.ts'
    );
    expect(code).not.toContain(': number');
    expect(imports).toEqual(['charturbo', 'theme']);
    const mod = evaluateDemo(code, { charturbo: { __esModule: true, Charturbo: 'C' }, theme: { __esModule: true, chartTheme: 'T' } });
    expect(typeof mod.default).toBe('function');
    expect((mod.default as (h: unknown) => unknown[])('host')).toEqual(['C', 'T', 3, 'host']);
  });

  it('compiles TSX with the automatic React runtime', () => {
    const { imports } = compileDemo(`export default function mount() { return <div className="x">hi</div>; }`, 'demo.tsx');
    expect(imports).toEqual(['react/jsx-runtime']);
  });

  it('reports a module that the playground does not provide', () => {
    const { code } = compileDemo(`import x from 'left-pad';\nexport default () => x;`, 'demo.ts');
    expect(() => evaluateDemo(code, {})).toThrow(/left-pad/);
  });

  it('maps example helper imports to their module name', () => {
    expect(resolveSpecifier('../../theme')).toBe('theme');
    expect(resolveSpecifier('./demo-playback.ts')).toBe('demo-playback');
    expect(resolveSpecifier('charturbo/react')).toBe('charturbo/react');
  });

  it('reads and removes the page-only meta block', () => {
    const source = `import { Charturbo } from 'charturbo';\n\nexport const meta = {\n  title: 'React <Chart> \\'1M\\'',\n  description: "d",\n  height: 520,\n};\n\nexport default function mount() {}\n`;
    expect(readMeta(source)).toEqual({ title: "React <Chart> '1M'", description: 'd', height: 520 });
    expect(readMeta(`export const meta = {\n  title: 'T',\n};\n`)).toEqual({ title: 'T' });
    expect(readMeta('export default 1;')).toEqual({});
    expect(stripMeta(source)).toBe(`import { Charturbo } from 'charturbo';\n\nexport default function mount() {}\n`);
  });

  it.each(demoFiles)('compiles $path with only modules the runner provides', ({ path, source }) => {
    const { code, imports } = compileDemo(stripMeta(source), path);
    expect(code).toContain('exports.default');
    for (const id of imports) expect(Object.keys(MODULE_LOADERS)).toContain(id);
  });
});

describe('playground share links', () => {
  it('round-trips source code through a URL-safe string', async () => {
    const source = `// 한국어 · 中文\nexport default function mount(host) { host.textContent = '${'x'.repeat(2000)}'; }\n`;
    const encoded = await encodeShare(source);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(source.length);
    expect(await decodeShare(encoded)).toBe(source);
  });

  it('refuses code that inflates beyond 1 MB', async () => {
    await expect(decodeShare(await encodeShare('x'.repeat((1 << 20) + 1)))).rejects.toThrow(/too large/);
  });

  it('rejects a damaged link', async () => {
    await expect(decodeShare('not*valid')).rejects.toThrow();
  });
});
