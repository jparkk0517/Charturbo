import { CHARTURBO_THEMES, parseColor, type Charturbo, type ObjectMaterialDescriptor, type RgbaTuple } from 'charturbo';

import { THEMES, getThemeName, setThemeName, subscribeTheme } from './theme';
const PALETTES = {
  vivid: ['#3987e5', '#f28c33', '#4dc78c', '#db5473', '#9e80eb'],
  ocean: ['#3987e5', '#22d3ee', '#14b8a6', '#818cf8', '#a5f3fc'],
  sunset: ['#3987e5', '#fb7185', '#fbbf24', '#f97316', '#c084fc'],
  mono: [],
};
const MATERIALS = {
  original: null,
  matte: { metallic: 0, roughness: 0.95 },
  glossy: { metallic: 0.15, roughness: 0.12 },
  metal: { metallic: 0.95, roughness: 0.25 },
};
interface SceneDesign {
  theme: keyof typeof THEMES;
  palette: keyof typeof PALETTES;
  accent: string;
  material: keyof typeof MATERIALS;
  brightness: number;
  grid: boolean;
  axes: boolean;
}
const DEFAULTS: SceneDesign = { theme: 'dark', palette: 'vivid', accent: '#3987e5', material: 'original', brightness: 1, grid: true, axes: false };
const STORAGE_KEY = 'charturbo-examples-scene-design';
let design = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SceneDesign> | null;
  if (saved) {
    if (saved.theme && Object.hasOwn(THEMES, saved.theme)) design.theme = saved.theme;
    if (saved.palette && Object.hasOwn(PALETTES, saved.palette)) design.palette = saved.palette;
    if (saved.material && Object.hasOwn(MATERIALS, saved.material)) design.material = saved.material;
    if (typeof saved.accent === 'string' && /^#[0-9a-f]{6}$/i.test(saved.accent)) design.accent = saved.accent;
    if (typeof saved.brightness === 'number' && Number.isFinite(saved.brightness)) design.brightness = Math.max(0.25, Math.min(2, saved.brightness));
    if (typeof saved.grid === 'boolean') design.grid = saved.grid;
    if (typeof saved.axes === 'boolean') design.axes = saved.axes;
  }
} catch { /* Storage can be disabled; controls still work in memory. */ }
design.theme = getThemeName();

const listeners = new Set<() => void>();
function applyPageDesign() {
  setThemeName(design.theme);
  document.documentElement.style.setProperty('--accent', design.accent);
}

/** One shared control panel for both 3D demos; no remount is needed for a design change. */
export function mountSceneDesignControls(host: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'scene-design';
  section.setAttribute('aria-labelledby', 'scene-design-heading');
  section.innerHTML = `
    <div class="scene-design-heading"><div><h2 id="scene-design-heading">디자인 · 테마</h2><p>두 3D 데모에 실시간 적용됩니다. 선택한 설정은 다음 방문에도 유지됩니다.</p></div><button type="button" data-reset>디자인 초기화</button></div>
    <div class="scene-design-fields">
      <label>테마<select name="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="midnight">Midnight</option><option value="paper">Paper</option></select></label>
      <label>팔레트<select name="palette"><option value="vivid">Vivid · 다채롭게</option><option value="ocean">Ocean · 시원하게</option><option value="sunset">Sunset · 따뜻하게</option><option value="mono">Mono · 단색</option></select></label>
      <label>강조 색상<input name="accent" type="color"></label>
      <label>재질<select name="material"><option value="original">데모 기본값</option><option value="matte">Matte · 무광</option><option value="glossy">Glossy · 유광</option><option value="metal">Metal · 금속</option></select></label>
      <label class="scene-brightness">조명 <output></output><input name="brightness" type="range" min="0.25" max="2" step="0.05" aria-label="조명 밝기"></label>
      <label class="scene-check"><input name="grid" type="checkbox">격자</label>
      <label class="scene-check"><input name="axes" type="checkbox">좌표축</label>
    </div>`;
  const input = (name: string) => section.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const syncControls = () => {
    for (const key of ['theme', 'palette', 'accent', 'material', 'brightness'] as const) input(key).value = String(design[key]);
    for (const key of ['grid', 'axes'] as const) input(key).checked = design[key];
    section.querySelector('output')!.textContent = `${Math.round(design.brightness * 100)}%`;
  };
  const update = () => {
    syncControls();
    applyPageDesign();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(design)); } catch { /* In-memory fallback. */ }
    for (const listener of listeners) listener();
  };
  section.addEventListener('input', () => {
    design = {
      theme: input('theme').value as SceneDesign['theme'],
      palette: input('palette').value as SceneDesign['palette'],
      accent: input('accent').value,
      material: input('material').value as SceneDesign['material'],
      brightness: Number(input('brightness').value),
      grid: input('grid').checked,
      axes: input('axes').checked,
    };
    update();
  });
  section.querySelector('[data-reset]')!.addEventListener('click', () => { design = { ...DEFAULTS }; update(); });
  syncControls();
  applyPageDesign();
  host.appendChild(section);
  subscribeTheme(() => {
    design.theme = getThemeName();
    syncControls();
    for (const listener of listeners) listener();
  });
}

/** Reapply after adding/resetting objects. Only appearance is changed, preserving live physics. */
export function bindSceneDesign(sdk: Charturbo, applyLighting: (brightness: number) => void) {
  const originals = new Map<number, ObjectMaterialDescriptor>();
  const refresh = () => {
    const theme = THEMES[design.theme];
    sdk.setTheme({ ...CHARTURBO_THEMES[theme.base], name: theme.label, surface: parseColor(theme.surface) });
    sdk.setHelpers({ showGrid: design.grid, showAxes: design.axes, gridSize: 180, gridDivisions: 18, axesLength: 70 });
    const objects = sdk.getObjects();
    const live = new Set(objects.map((o) => o.id));
    for (const id of originals.keys()) if (!live.has(id)) originals.delete(id);
    const palette = [design.accent, ...PALETTES[design.palette].slice(1)];
    let index = 0;
    for (const obj of objects) {
      if (!originals.has(obj.id)) originals.set(obj.id, { metallic: obj.metallic, roughness: obj.roughness, emissive: obj.emissive });
      const floor = obj.shape === 'plane';
      const obstacle = obj.name === 'step' || obj.name === 'pillar';
      const color: RgbaTuple = parseColor(floor ? theme.floor : obstacle ? theme.obstacle : palette[index++ % palette.length]);
      color[3] = obj.color[3];
      sdk.setObjectMaterial(obj.id, {
        ...originals.get(obj.id),
        ...(!floor && !obstacle ? MATERIALS[design.material] : null),
        color,
      });
    }
    applyLighting(design.brightness);
    sdk.render();
  };
  listeners.add(refresh);
  refresh();
  return { refresh, dispose: () => { listeners.delete(refresh); originals.clear(); } };
}
