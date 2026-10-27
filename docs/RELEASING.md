# 릴리스 절차 (`charturbo`)

npm 패키지는 `web/`에서 만들어집니다 (`web/package.json`, 산출물 `web/dist-lib/`).
이 문서는 절차만 정의합니다. 실제 배포(`npm publish`, 태그 push)는 담당자가 수동으로 실행합니다.

## 1. 버전 정책 (0.x SemVer)

1.0.0 전까지는 [SemVer](https://semver.org/lang/ko/) 0.x 관례를 따릅니다.

| 변경 | 올리는 자리 | 예 |
|---|---|---|
| 공개 API의 호환되지 않는 변경 (이름 · 시그니처 · 기본값 · 이벤트 페이로드 · 내보내는 타입 제거, 렌더링 결과가 의도적으로 바뀌어 시각 기준 이미지를 갱신해야 하는 변경, 지원 브라우저 · Node · peer 범위 축소) | **minor** | 0.1.x → 0.2.0 |
| 하위 호환 기능 추가 (새 차트 종류 · 옵션 · 메서드 · 내보내는 타입) | **minor** | 0.1.x → 0.2.0 |
| 버그 수정, 성능 개선, 문서, 렌더링이 바뀌지 않는 내부 변경 | **patch** | 0.1.0 → 0.1.1 |

- 0.x에서는 minor 하나에 기능 추가와 깨지는 변경이 함께 들어갈 수 있습니다. 깨지는 변경은 CHANGELOG의
  `### 변경` / `### 제거` 항목에 **마이그레이션 방법과 함께** 반드시 적습니다.
- 공개 API = `charturbo`, `charturbo/inline`, `charturbo/react`, `charturbo/vue`에서
  내보내는 값과 타입(`web/src/index.ts`, `src/react/index.ts`, `src/vue/index.ts`). `WasmCharturboEngineBackend`의
  wasm 바인딩(`snake_case`)과 내부 모듈 경로(`dist-lib/sdk/*`)는 공개 API가 아닙니다.
- 폐기 예정 API는 JSDoc `@deprecated`로 표시하고 최소 한 번의 minor 동안 유지한 뒤 제거합니다.
- npm 기본 `^0.1.0`(= `>=0.1.0 <0.2.0`) 범위는 0.x에서 patch만 받으므로, 사용자는 minor 업그레이드 시 CHANGELOG를 확인하면 됩니다.
- 1.0.0은 API가 안정되고(최소 두 번의 minor 동안 깨지는 변경 없음) 지원 매트릭스가 확정되면 냅니다.
- 프리릴리스는 `0.2.0-rc.1` 형식, `npm publish --tag next`로 배포합니다(`latest` 태그를 바꾸지 않음).

## 2. 릴리스 체크리스트

각 단계 결과를 릴리스 PR에 붙입니다. 하나라도 실패하면 중단합니다.

### 준비
- [ ] `web/package.json`의 `TODO` 자리표시자(author · homepage · repository · bugs)와 `LICENSE`의 저작권자를 채움
      (`prepublishOnly`의 `scripts/check-release-metadata.mjs`가 남아 있으면 `npm publish`를 막음).
- [ ] `main`이 깨끗하고 최신인지 확인 (`git status`, `git pull`).
- [ ] 버전 결정(위 표) 후 `web/package.json`의 `version` 갱신.
- [ ] `web/CHANGELOG.md`: `[Unreleased]` 내용을 새 버전 섹션으로 옮기고 날짜 · 비교 링크 갱신.
- [ ] WASM이 최신 Rust 소스로 빌드됐는지 확인:
      `wasm-pack build crates/charturbo-core --release --target web --out-dir ../../web/src/wasm-pkg`
      및 `wasm-pack build crates/charturbo-core --release --target web --out-dir ../../web/src/wasm-pkg-webgpu --no-default-features`.
      생성 파일은 빌드 산출물이며, 패키징에는 기본/WebGPU 전용 두 WASM 빌드가 모두 필요합니다.

### 테스트
- [ ] Rust: `cargo test -p charturbo-core`, `cargo clippy -p charturbo-core` (새 경고 없음).
- [ ] 타입 · 단위: `cd web && npx tsc --noEmit && npx vitest run`.
- [ ] 시각 회귀: `npm run test:visual` (WebGPU + WebGL2, 기준 이미지 변경 없음.
      의도한 변경이면 `-- --update`로 갱신하고 minor로 올림).
- [ ] 벤치마크: `npm run dev` → 벤치마크 화면(1M 선 · 산점도, 스파크라인 100개)에서 이전 릴리스 대비 FPS ·
      생성 시간이 10% 이상 나빠지지 않았는지 확인하고 수치를 PR에 기록. (자동 벤치 스크립트는 아직 없음.)
- [ ] 예제 사이트: `npm run examples:build` 후 모든 페이지가 콘솔 오류 없이 렌더링되는지 확인
      (`npm run examples:preview`).
- [ ] API 문서: `npm run docs`가 경고 없이 `docs/api/`를 생성하는지 확인.

### 패키지 확인
- [ ] `npm pack --dry-run` (`prepack`이 기본/WebGPU 전용 라이브러리를 모두 빌드): 포함 파일이 `dist-lib/**`, `README.md`, `CHANGELOG.md`,
      `LICENSE`, `package.json`뿐인지, 크기가 이전 릴리스와 비슷한지(현재 압축 ~4.1 MB) 확인.
- [ ] `npm pack`으로 만든 tarball을 소비자 프로젝트에 `npm install ./charturbo-x.y.z.tgz`로 설치해 확인:
  - Vite 앱(dev + build): `charturbo_core_bg.wasm`이 에셋으로 나오고 차트가 그려짐.
  - webpack 5 앱: `.wasm` 에셋 방출, 차트 렌더링.
  - `charturbo/inline`(esbuild 등 에셋 처리가 없는 번들러), UMD `<script>` 태그.
  - Node ESM `import` / CJS `require` / React · Vue SSR `renderToString`이 예외 없이 동작.
  - 타입 검사: `moduleResolution` `bundler`, `node16`(ESM + `.cts`), `nodenext`, `node10`.
- [ ] (선택) `npx @arethetypeswrong/cli --pack` 결과에 새 문제가 없는지 확인.

### 배포 (담당자, 수동)
- [ ] 릴리스 커밋: `chore(release): vX.Y.Z`.
- [ ] 태그: `git tag -a vX.Y.Z -m "vX.Y.Z"` → `git push origin vX.Y.Z`.
- [ ] `cd web && npm publish` (프리릴리스는 `--tag next`; `prepack`이 `build:lib`와 `build:lib:webgpu`를 다시 실행).
- [ ] 저장소 릴리스 노트 = CHANGELOG 해당 섹션.
- [ ] 예제 사이트(`web/examples-dist/`)와 API 문서(`docs/api/`)를 정적 호스팅에 게시.
- [ ] 배포 직후 새 디렉터리에서 `npm install charturbo@X.Y.Z`로 설치 · import 스모크 테스트.

## 3. 잘못된 배포 대응

- 72시간 이내이고 의존하는 패키지가 없으면 `npm unpublish charturbo@X.Y.Z`가 가능하지만, 기본은
  `npm deprecate charturbo@X.Y.Z "<이유>, X.Y.(Z+1) 사용"` 후 수정 patch를 배포합니다.
- 같은 버전 번호는 재사용할 수 없습니다.
