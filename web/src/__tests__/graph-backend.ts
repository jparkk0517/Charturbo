/**
 * Test doubles for graph-mode SDK tests: a backend with a simulated orbit camera (optional
 * `camera_state`), 4 nodes, enough chart calls for a line chart, and a canvas whose listeners
 * are callable directly.
 */
import type { WasmCharturboEngineBackend } from '../sdk/charturbo';

/** Graph-mode backend with a simulated orbit camera (`camera_state` optional). */
export function graphBackend(withCameraState = true) {
  const calls: Record<string, unknown[][]> = {};
  const rec =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const cam = { target: [0, 0, 0], distance: 220, yaw: 0.4, pitch: 0.3 };
  let picked = -1;
  let hit = new Float64Array(0);
  const backend: WasmCharturboEngineBackend = {
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
    sync_and_render: rec('sync_and_render'),
    rotate_camera: (y: number, p: number) => {
      rec('rotate_camera')(y, p);
      cam.yaw += y;
      cam.pitch += p;
    },
    zoom_camera: (d: number) => {
      rec('zoom_camera')(d);
      cam.distance = Math.min(5000, Math.max(5, cam.distance + d));
    },
    pan_camera: rec('pan_camera'),
    fit_to_view: () => {
      rec('fit_to_view')();
      cam.target = [0, 0, 0];
      cam.distance = 300;
    },
    focus_on_node: (id: number) => {
      rec('focus_on_node')(id);
      if (id > 3) return false;
      cam.target = [id, 2 * id, 0];
      return true;
    },
    resize: () => {},
    pick_node_at_ndc: () => picked,
    select_box_ndc: () => new Uint32Array(0),
    query_radius: () => new Uint32Array(0),
    select_node_and_neighbors: rec('select_node_and_neighbors', new Uint32Array(0)),
    select_cluster: () => new Uint32Array(0),
    clear_selection: () => {},
    set_node_pinned: () => true,
    move_node_to: () => true,
    node_count: () => 4,
    edge_count: () => 2,
    get_node_info: () => new Float32Array([1.25, -2, 3, 1, 2, 0.2, 0.5, 0.9, 1, 3, 0, 0]),
    get_node_neighbors: () => new Uint32Array([1, 2]),
    set_camera_pose: rec('set_camera_pose'),
    // Enough of the chart surface for a line chart
    set_line_chart: () => 0,
    chart_series_count: () => 1,
    set_chart_hover_style: () => {},
    set_chart_frame_style: () => {},
    set_chart_padding: () => {},
    set_chart_series_visible: () => {},
    set_clear_color: () => {},
    set_node_hover_style: () => {},
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([56, 16, 200, 100, 0, 0]),
    chart_hover_at_ndc: () => hit,
    chart_zoom_x: rec('chart_zoom_x'),
    chart_pan_x: rec('chart_pan_x'),
    chart_range: () => new Float64Array([0, 2, NaN, NaN]),
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    clear_scene_objects: () => {},
    ...(withCameraState
      ? { camera_state: () => new Float32Array([...cam.target, cam.distance, cam.yaw, cam.pitch, Math.PI / 4, 2]) }
      : {}),
  };
  return { backend, calls, cam, pick: (id: number) => (picked = id), setHit: (h: number[]) => (hit = new Float64Array(h)) };
}

export function fakeCanvas() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const captured: number[] = [];
  const canvas = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h),
    removeEventListener: (type: string) => delete handlers[type],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
    setPointerCapture: (id: number) => captured.push(id),
  } as unknown as HTMLCanvasElement;
  return { canvas, handlers, captured };
}

