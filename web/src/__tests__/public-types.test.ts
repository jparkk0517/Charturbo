/**
 * Public-type export audit: every type a consumer can *see* through the package
 * entry (src/index.ts) — public method parameters / return types / option fields /
 * event payloads, transitively — must itself be importable from the entry.
 *
 * Uses the TypeScript compiler API (no ts-morph): builds a program for index.ts,
 * walks the declarations of every value/type exported there, resolves each type
 * reference, and fails listing any src-declared interface/type alias/class/enum
 * that is reachable but not exported. Complements public-types.typecheck.ts
 * (a compile-time import list checked by `tsc --noEmit`).
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// No @types/node in this package: paths via URL (POSIX separators, as TypeScript reports them)
const WEB = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const SRC = `${WEB}/src/`;
const ENTRY = `${SRC}index.ts`;

/** Reachable but intentionally internal (not part of the documented surface). */
const ALLOW_INTERNAL = new Set<string>([]);

function loadProgram() {
  const cfg = ts.getParsedCommandLineOfConfigFile(`${WEB}/tsconfig.json`, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  const program = ts.createProgram([ENTRY], { ...(cfg?.options ?? {}), noEmit: true });
  return { program, checker: program.getTypeChecker() };
}

function isOurs(decl: ts.Declaration): boolean {
  const f = decl.getSourceFile().fileName;
  return f.startsWith(SRC) && !f.includes('node_modules');
}

function isNamedTypeDecl(d: ts.Declaration): boolean {
  return (
    ts.isInterfaceDeclaration(d) ||
    ts.isTypeAliasDeclaration(d) ||
    ts.isClassDeclaration(d) ||
    ts.isEnumDeclaration(d)
  );
}

function isPublicMember(m: ts.ClassElement): boolean {
  if (m.name && ts.isPrivateIdentifier(m.name)) return false;
  const flags = ts.getCombinedModifierFlags(m as unknown as ts.Declaration);
  return !(flags & ts.ModifierFlags.Private) && !(flags & ts.ModifierFlags.Protected);
}

function auditPublicTypes() {
  const { program, checker } = loadProgram();
  const entry = program.getSourceFile(ENTRY)!;
  const modSym = checker.getSymbolAtLocation(entry)!;
  const resolve = (s: ts.Symbol) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);

  const exported = new Set<ts.Symbol>();
  const roots: ts.Symbol[] = [];
  for (const s of checker.getExportsOfModule(modSym)) {
    const r = resolve(s);
    exported.add(r);
    roots.push(r);
  }

  const missing = new Map<string, string>(); // name -> first referencing site
  const visited = new Set<ts.Symbol>();
  const queue: { sym: ts.Symbol; from: string }[] = roots.map((sym) => ({ sym, from: '<index>' }));

  const noteSymbol = (raw: ts.Symbol | undefined, from: string) => {
    if (!raw) return;
    const sym = resolve(raw);
    if (sym.flags & ts.SymbolFlags.TypeParameter) return;
    const decls = sym.declarations ?? [];
    if (!decls.some((d) => isOurs(d) && isNamedTypeDecl(d))) return;
    if (!exported.has(sym) && !ALLOW_INTERNAL.has(sym.name) && !missing.has(sym.name)) missing.set(sym.name, from);
    queue.push({ sym, from: sym.name });
  };

  // Inferred (unannotated) return / property types: check the named type, unions and arrays.
  const noteType = (t: ts.Type, from: string, depth = 0) => {
    if (depth > 3) return;
    noteSymbol(t.aliasSymbol, from);
    if (t.isUnionOrIntersection()) {
      for (const p of t.types) noteType(p, from, depth + 1);
      return;
    }
    if (!t.aliasSymbol) noteSymbol(t.getSymbol(), from);
    const args = checker.getTypeArguments?.(t as ts.TypeReference) ?? [];
    if ((t as ts.TypeReference).target) for (const a of args) noteType(a, from, depth + 1);
  };

  const walkTypeNode = (node: ts.Node, from: string) => {
    const visit = (n: ts.Node) => {
      if (ts.isTypeReferenceNode(n)) noteSymbol(checker.getSymbolAtLocation(n.typeName), from);
      else if (ts.isExpressionWithTypeArguments(n)) noteSymbol(checker.getSymbolAtLocation(n.expression), from);
      else if (ts.isTypeQueryNode(n)) {
        // `typeof X` / `Parameters<typeof X.create>`: the referenced value's declared type is public.
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  };

  const walkSignatureLike = (d: ts.SignatureDeclaration, from: string) => {
    for (const tp of d.typeParameters ?? []) walkTypeNode(tp, from);
    for (const p of d.parameters) if (p.type) walkTypeNode(p.type, from);
    if (d.type) walkTypeNode(d.type, from);
    else {
      const sig = checker.getSignatureFromDeclaration(d);
      if (sig) noteType(checker.getReturnTypeOfSignature(sig), from);
    }
  };

  while (queue.length) {
    const { sym } = queue.pop()!;
    if (visited.has(sym)) continue;
    visited.add(sym);
    for (const d of sym.declarations ?? []) {
      if (!isOurs(d)) continue;
      const from = sym.name;
      if (ts.isClassDeclaration(d)) {
        for (const h of d.heritageClauses ?? []) walkTypeNode(h, from);
        for (const m of d.members) {
          if (!isPublicMember(m)) continue;
          const site = `${from}.${m.name && !ts.isComputedPropertyName(m.name) ? m.name.getText() : 'constructor'}`;
          if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) {
            walkSignatureLike(m, site);
          } else if (ts.isPropertyDeclaration(m)) {
            if (m.type) walkTypeNode(m.type, site);
            else noteType(checker.getTypeAtLocation(m), site);
          }
        }
      } else if (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)) {
        walkTypeNode(d, from);
      } else if (ts.isFunctionDeclaration(d)) {
        walkSignatureLike(d, from);
      } else if (ts.isVariableDeclaration(d)) {
        if (d.type) walkTypeNode(d.type, from);
        else noteType(checker.getTypeAtLocation(d), from);
      }
    }
  }
  return { missing, reached: new Set([...visited].map((s) => s.name)) };
}

describe('public type exports (src/index.ts)', () => {
  it('exports every src-declared type reachable from the public API', { timeout: 60_000 }, () => {
    const { missing, reached } = auditPublicTypes();
    // The walk really covered the surface (a path mismatch would silently skip every declaration)
    expect(reached.size).toBeGreaterThan(100);
    for (const name of ['VizEngineSDK', 'ChartTooltipContext', 'VizSelection', 'ChartTooltipOptions', 'ChartFormatSpec']) {
      expect(reached.has(name), name).toBe(true);
    }
    const report = [...missing].map(([name, from]) => `${name} (referenced by ${from})`).sort();
    expect(report).toEqual([]);
  });
});
