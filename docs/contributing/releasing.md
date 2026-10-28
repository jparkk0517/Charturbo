# Releasing

The npm package `charturbo` is built from `web/` (`web/package.json`, output in `web/dist-lib/`).
This page defines the procedure only. The actual release (`npm publish`, tag push) is run by hand by the maintainer.

## 1. Version policy (0.x SemVer)

Until 1.0.0 the project follows the [SemVer](https://semver.org/) 0.x conventions.

| Change | Bump | Example |
|---|---|---|
| Incompatible change to the public API (removing or changing names · signatures · defaults · event payloads · exported types, an intended rendering change that requires updating the visual baselines, narrowing the supported browser · Node · peer ranges) | **minor** | 0.1.x → 0.2.0 |
| Backward-compatible feature (new chart type · option · method · exported type) | **minor** | 0.1.x → 0.2.0 |
| Bug fix, performance improvement, docs, internal change that does not alter rendering | **patch** | 0.1.0 → 0.1.1 |

- In 0.x a single minor may contain both features and breaking changes. Breaking changes must be listed under
  `### 변경` (Changed) / `### 제거` (Removed) in the CHANGELOG (written in Korean) **together with migration steps**.
- Public API = the values and types exported from `charturbo`, `charturbo/inline`, `charturbo/react` and `charturbo/vue`
  (`web/src/index.ts`, `src/react/index.ts`, `src/vue/index.ts`). The wasm bindings of `WasmCharturboEngineBackend`
  (`snake_case`) and internal module paths (`dist-lib/sdk/*`) are not public API.
- APIs scheduled for removal are marked with JSDoc `@deprecated`, kept for at least one minor, then removed.
- The npm default range `^0.1.0` (= `>=0.1.0 <0.2.0`) only picks up patches in 0.x, so users only need to check the CHANGELOG when upgrading a minor.
- 1.0.0 ships once the API is stable (no breaking change for at least two minors) and the support matrix is settled.
- Prereleases use the `0.2.0-rc.1` format and are published with `npm publish --tag next` (the `latest` tag is not changed).

## 2. Release checklist

Attach the result of each step to the release PR. Stop if any step fails.

### Preparation
- [ ] Fill in the `TODO` placeholders in `web/package.json` (author · homepage · repository · bugs) and the copyright holder in `LICENSE`
      (`scripts/check-release-metadata.mjs` in `prepublishOnly` blocks `npm publish` while they remain).
- [ ] Make sure `main` is clean and up to date (`git status`, `git pull`).
- [ ] Decide the version (table above) and update `version` in `web/package.json`.
- [ ] `web/CHANGELOG.md`: move the `[Unreleased]` content into a new version section and update the date · compare links.
- [ ] Make sure the WASM is built from the latest Rust sources:
      `wasm-pack build crates/charturbo-core --release --target web --out-dir ../../web/src/wasm-pkg`
      and `wasm-pack build crates/charturbo-core --release --target web --out-dir ../../web/src/wasm-pkg-webgpu --no-default-features`.
      The generated files are build output; packaging needs both WASM builds (default and WebGPU-only).

### Tests
- [ ] Rust: `cargo test -p charturbo-core`, `cargo clippy -p charturbo-core` (no new warnings).
- [ ] Types · unit: `cd web && npx tsc --noEmit && npx vitest run`.
- [ ] Visual regression: `npm run test:visual` (WebGPU + WebGL2, no baseline changes.
      If a change is intended, update with `-- --update` and bump the minor). See [Development](./development) for details.
- [ ] Benchmarks: with `npm run bench` ([Benchmark Methodology](./benchmarks)), confirm that FPS and
      time to first frame (TTFF) did not regress by 10% or more against the previous release, and record the numbers in the PR.
- [ ] Examples site: after `npm run examples:build`, confirm that every page renders without console errors
      (`npm run examples:preview`).
- [ ] API docs: confirm that `npm run docs` generates `docs/public/api/` without warnings.
- [ ] Documentation site: confirm that `cd docs && npm run check && npm run build` passes.

### Package check
- [ ] `npm pack --dry-run` (`prepack` builds both the default and the WebGPU-only library): confirm the included files are only `dist-lib/**`, `README.md`, `CHANGELOG.md`,
      `LICENSE` and `package.json`, and that the size is close to the previous release (currently ~4.1 MB compressed).
- [ ] Install the tarball made by `npm pack` into consumer projects with `npm install ./charturbo-x.y.z.tgz` and check:
  - Vite app (dev + build): `charturbo_core_bg.wasm` is emitted as an asset and charts render.
  - webpack 5 app: `.wasm` asset emitted, charts render.
  - `charturbo/inline` (bundlers without asset handling such as esbuild), UMD `<script>` tag.
  - Node ESM `import` / CJS `require` / React · Vue SSR `renderToString` work without exceptions.
  - Type checking: `moduleResolution` `bundler`, `node16` (ESM + `.cts`), `nodenext`, `node10`.
- [ ] (Optional) confirm `npx @arethetypeswrong/cli --pack` reports no new problems.

### Publish (maintainer, manual)
- [ ] Release commit: `chore(release): vX.Y.Z`.
- [ ] Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"` → `git push origin vX.Y.Z`.
- [ ] `cd web && npm publish` (prereleases with `--tag next`; `prepack` reruns `build:lib` and `build:lib:webgpu`).
- [ ] Repository release notes = the matching CHANGELOG section.
- [ ] Publish the examples site (`web/examples-dist/`) and the API docs (`docs/public/api/`) to static hosting.
- [ ] Right after publishing, smoke-test install · import with `npm install charturbo@X.Y.Z` in a fresh directory.

## 3. Handling a bad release

- Within 72 hours and with no dependent packages, `npm unpublish charturbo@X.Y.Z` is possible, but the default is
  `npm deprecate charturbo@X.Y.Z "<reason>, use X.Y.(Z+1)"` followed by a fix patch release.
- The same version number cannot be reused.

## See also
- [Development](./development)
- [Changelog & Migration](../guide/migration)
