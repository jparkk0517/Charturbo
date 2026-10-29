/**
 * Playground compiler: example source (TS / TSX, ES modules) → a CommonJS function body that
 * `evaluateDemo` runs with a `require` serving the modules of `modules.ts`. Sucrase keeps line
 * numbers, so stack traces point at the edited source.
 */
import { transform } from 'sucrase';

/** `'../../theme'` → `'theme'`: example helpers are served by file name; packages stay as is. */
export function resolveSpecifier(specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;
  return specifier.split('/').pop()!.replace(/\.(ts|tsx|js)$/, '');
}

export interface CompiledDemo {
  code: string;
  /** Resolved module ids the code requires, in first-use order. */
  imports: string[];
}

export function compileDemo(source: string, filename = 'playground.ts'): CompiledDemo {
  const tsx = filename.endsWith('.tsx');
  const { code } = transform(source, {
    transforms: tsx ? ['typescript', 'jsx', 'imports'] : ['typescript', 'imports'],
    jsxRuntime: 'automatic',
    production: true,
    disableESTransforms: true,
    filePath: filename,
  });
  const imports = [...code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map((m) => resolveSpecifier(m[2]));
  return { code: `${code}\n//# sourceURL=${filename}`, imports: [...new Set(imports)] };
}

/** Run compiled code; `modules` maps resolved ids to module objects. Returns its exports. */
export function evaluateDemo(code: string, modules: Record<string, unknown>): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const require = (specifier: string) => {
    const id = resolveSpecifier(specifier);
    if (!(id in modules)) throw new Error(`Cannot import "${specifier}" in the playground`);
    return modules[id];
  };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}
