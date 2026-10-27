import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { encodeAnnotations, labelTransform, type ChartAnnotation } from '../sdk/chart-annotations';

// The a11y layer needs a full DOM and has its own tests: replace it with an inert stand-in
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    showDataTable(): void {}
    hideDataTable(): void {}
    getDataTable(): null {
      return null;
    }
    exportCSV(): string {
      return '';
    }
    summary(): string {
      return '';
    }
  },
}));

/** Minimal DOM element: enough for the chart overlay and its annotation labels. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 800;
  offsetHeight = 400;

  constructor(readonly tag: string) {}

  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    cs.forEach((c) => this.appendChild(c));
  }
  removeChild(c: FakeEl): void {
    this.children = this.children.filter((x) => x !== c);
    c.parentElement = null;
  }
  remove(): void {
    this.parentElement?.removeChild(this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  insertAdjacentElement(_where: string, el: FakeEl): FakeEl {
    return (this.parentElement ?? this).appendChild(el);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 400 };
  }
  /** Class selectors only (`.name`) */
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.slice(1);
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) =>
      el.children.forEach((c) => {
        if (c.className.split(' ').includes(cls)) out.push(c);
        walk(c);
      });
    walk(this);
    return out;
  }
}

type Calls = Record<string, unknown[][]>;

/** Backend whose annotation labels are `labels()`; the revision bumps on every set / clear. */
function mockBackend(calls: Calls, labels: () => Float64Array): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let rev = 0;
  return {
    set_line_chart: record('set_line_chart', 0),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: record('set_clear_color'),
    set_chart_annotations: (...args: unknown[]) => {
      (calls.set_chart_annotations ??= []).push(args);
      rev++;
    },
    clear_chart_annotations: () => {
      (calls.clear_chart_annotations ??= []).push([]);
      rev++;
    },
    chart_annotation_labels_revision: () => rev,
    chart_annotation_labels: () => labels(),
    chart_axes_revision: () => 0,
    chart_axes: () => new Float64Array(0),
    reload_dataset: () => {},
    load_raw_dataset: () => {},
    export_positions: () => new Float32Array(0),
    import_positions: () => {},
    warmup: () => 0,
    step_physics: () => 0,
    set_auto_sleep: () => {},
    is_sleeping: () => false,
    wake_up: () => {},
    set_force_params: () => {},
    set_frustum_culling: () => {},
    sync_and_render: () => {},
    rotate_camera: () => {},
    zoom_camera: () => {},
    pan_camera: () => {},
    fit_to_view: () => {},
    focus_on_node: () => true,
    resize: () => {},
    pick_node_at_ndc: () => -1,
    select_box_ndc: () => new Uint32Array(0),
    query_radius: () => new Uint32Array(0),
    select_node_and_neighbors: () => new Uint32Array(0),
    select_cluster: () => new Uint32Array(0),
    clear_selection: () => {},
    set_node_pinned: () => true,
    move_node_to: () => true,
    node_count: () => 0,
    edge_count: () => 0,
    set_camera_pose: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    clear_scene_objects: () => {},
  };
}

const LIST: ChartAnnotation[] = [
  { type: 'hline', y: 250, label: 'SLO', dash: true, color: [1, 0, 0, 1] },
  { type: 'xband', from: 100, to: 140, label: 'Incident', z: 'above', labelPosition: 'start' },
  { type: 'point', x: new Date(5000), y: 3, width: 7 },
  { type: 'text', x: 1, y: 2, text: 'note' },
];

describe('chart annotations', () => {
  it('encodes kinds, data coords, styles, and engine defaults as flat arrays', () => {
    const e = encodeAnnotations(LIST, CHARTURBO_THEMES.dark);
    expect(Array.from(e.kinds)).toEqual([0, 3, 4, 5]);
    expect(Array.from(e.coords.slice(0, 1))).toEqual([250]);
    expect(Array.from(e.coords.slice(4, 6))).toEqual([100, 140]);
    expect(Array.from(e.coords.slice(8, 10))).toEqual([5000, 3]); // Date -> epoch ms
    expect(Number.isNaN(e.coords[1])).toBe(true);
    expect(Array.from(e.colors.slice(0, 4))).toEqual([1, 0, 0, 1]);
    // Bands default to the theme crosshair color, lines / points to the baseline color
    expect(Array.from(e.colors.slice(4, 8))).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.dark.crosshair)));
    expect(Array.from(e.colors.slice(8, 12))).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.dark.baseline)));
    expect(Array.from(e.dash)).toEqual([6, 0, 0, 0]);
    expect(e.widths[2]).toBe(7);
    expect(Number.isNaN(e.widths[0]) && Number.isNaN(e.opacity[1])).toBe(true); // engine defaults
    expect(Array.from(e.layers)).toEqual([0, 1, 0, 0]);
    expect(Array.from(e.labelPositions)).toEqual([1, 0, 1, 1]);
  });

  it('places labels off their line / band', () => {
    expect(labelTransform({ type: 'hline', y: 0 })).toBe('translate(calc(-100% - 4px), calc(-100% - 3px))');
    expect(labelTransform({ type: 'xband', from: 0, to: 1, labelPosition: 'start' })).toBe(
      'translate(-50%, calc(-100% - 4px))'
    );
    expect(labelTransform({ type: 'point', x: 0, y: 0 })).toBe('translate(-50%, calc(-100% - 9px))');
  });

  describe('SDK', () => {
    let container: FakeEl;
    let canvas: FakeEl;

    beforeEach(() => {
      const body = new FakeEl('body');
      container = body.appendChild(new FakeEl('div'));
      canvas = container.appendChild(new FakeEl('canvas'));
      vi.stubGlobal('document', {
        body,
        head: new FakeEl('head'),
        createElement: (tag: string) => new FakeEl(tag),
        getElementById: () => null,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends annotations to the engine and lays out visible labels at the engine anchors', () => {
      const calls: Calls = {};
      // hline at (700, 120); xband at (300, 340); point hidden; text at (50, 60)
      let labels = new Float64Array([4, 0, 700, 120, 1, 1, 300, 340, 1, 2, 0, 0, 0, 3, 50, 60, 1]);
      const sdk = Charturbo.fromBackend(mockBackend(calls, () => labels));
      sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
      sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);

      sdk.setAnnotations(LIST);
      const [kinds, coords] = calls.set_chart_annotations[0] as [Uint8Array, Float64Array];
      expect(Array.from(kinds)).toEqual([0, 3, 4, 5]);
      expect(coords.length).toBe(16);
      sdk.render();
      const els = () => container.querySelectorAll('.charturbo-sdk-annotation-label').filter((e) => e.style.display !== 'none');
      // The point has no label text (and is hidden): 3 labels
      expect(els().map((e) => e.textContent)).toEqual(['SLO', 'Incident', 'note']);
      const [slo, incident, note] = els();
      expect([slo.style.left, slo.style.top]).toEqual(['700px', '120px']);
      expect(slo.style.borderLeft).toBe('3px solid rgb(255, 0, 0)');
      expect(slo.style.background).toBe(CHARTURBO_THEMES.dark.tooltipBackground);
      expect(incident.style.transform).toBe('translate(-50%, calc(-100% - 4px))');
      expect(note.style.background).toBe('none'); // text annotations are plain text

      // Zoom moved the hline out of view: the engine flags it invisible
      labels = new Float64Array([4, 0, 0, 0, 0, 1, 310, 340, 1, 2, 0, 0, 0, 3, 50, 60, 1]);
      sdk.addAnnotation({ type: 'vline', x: 2, label: 'deploy' });
      expect((calls.set_chart_annotations[1][0] as Uint8Array).length).toBe(5);
      sdk.render();
      expect(els().map((e) => e.textContent)).toEqual(['Incident', 'note']);

      sdk.clearAnnotations();
      expect(calls.clear_chart_annotations.length).toBe(1);
      labels = new Float64Array([0]);
      sdk.render();
      expect(els()).toEqual([]);
      expect(sdk.getAnnotations()).toEqual([]);

      // A new chart starts without annotations
      sdk.setAnnotations(LIST);
      sdk.renderLineChart([{ name: 'B', values: [4, 5] }]);
      expect(sdk.getAnnotations()).toEqual([]);
    });

    it('rejects an invalid color without keeping the bad annotation', () => {
      const calls: Calls = {};
      const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array([0])));
      sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
      sdk.addAnnotation({ type: 'hline', y: 2, color: '#e66767' });
      expect(() => sdk.addAnnotation({ type: 'hline', y: 1, color: 'not-a-color' })).toThrow();
      expect(sdk.getAnnotations()).toHaveLength(1);
      // Later syncs (theme change re-sends the list) keep working
      expect(() => sdk.setTheme('light')).not.toThrow();
    });
  });
});
