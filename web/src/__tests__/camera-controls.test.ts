// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_DRAG_SLOP_PX,
  MOUSE_ORBIT_RAD_PER_PX,
  MOUSE_PAN_UNITS_PER_PX,
  WHEEL_ZOOM_RATE,
  WHEEL_ZOOM_UNITS_PER_PX,
  createCameraControls,
  resolveCameraControls,
  type CameraControlOptions,
  type CameraControlsHost,
} from '../sdk/camera-controls';
// The a11y layer has its own tests: replaced by an inert stand-in
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));
import { Charturbo } from '../sdk/charturbo';
import { fakeCanvas, graphBackend } from './graph-backend';

function host(options: CameraControlOptions | false = {}, over: Partial<CameraControlsHost> = {}) {
  const calls = { rotate: [] as number[][], pan: [] as number[][], zoom: [] as number[], capture: [] as number[], cursor: [] as string[], changed: 0 };
  const h: CameraControlsHost = {
    options: resolveCameraControls(options),
    active: () => true,
    rotate: (y, p) => calls.rotate.push([y, p]),
    pan: (r, u) => calls.pan.push([r, u]),
    zoom: (d) => calls.zoom.push(d),
    unitsPerPixel: () => null,
    distance: () => null,
    viewHeight: () => 400,
    capture: (id) => calls.capture.push(id),
    setCursor: (c) => calls.cursor.push(c),
    changed: () => calls.changed++,
    ...over,
  };
  return { c: createCameraControls(h), calls };
}

const down = (button: number, x = 0, y = 0, extra: Record<string, unknown> = {}) => ({ button, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, ...extra });
const move = (x: number, y: number, buttons = 1) => ({ buttons, pointerType: 'mouse', clientX: x, clientY: y });

describe('createCameraControls', () => {
  it('left drag orbits past the slop, with pointer capture and a grabbing cursor', () => {
    const { c, calls } = host();
    expect(c.pointerDown(down(0, 10, 10))).toBe(true);
    expect(calls.capture).toEqual([1]);
    // Within the slop: owned (no hover) but the camera stays
    expect(c.pointerMove(move(10 + CAMERA_DRAG_SLOP_PX, 10))).toBe(true);
    expect(calls.rotate).toEqual([]);
    expect(c.dragging()).toBe(false);
    expect(c.pointerMove(move(30, 0))).toBe(true);
    expect(calls.rotate).toEqual([[-20 * MOUSE_ORBIT_RAD_PER_PX, -10 * MOUSE_ORBIT_RAD_PER_PX]]);
    expect(c.dragging()).toBe(true);
    expect(calls.cursor).toEqual(['grabbing']);
    c.pointerUp();
    expect(calls.cursor).toEqual(['grabbing', 'grab']);
    expect(c.pointerMove(move(40, 0))).toBe(false);
  });

  it('Shift + left, middle and right drags pan; the content follows the pointer', () => {
    for (const [button, shiftKey] of [[0, true], [1, false], [2, false]] as const) {
      const { c, calls } = host({}, { unitsPerPixel: () => 0.5 });
      c.pointerDown(down(button, 0, 0, { shiftKey }));
      c.pointerMove(move(10, 4));
      expect(calls.rotate).toEqual([]);
      expect(calls.pan).toEqual([[-5, 2]]);
    }
  });

  it('pan falls back to the fixed gain without a camera distance', () => {
    const { c, calls } = host();
    c.pointerDown(down(2));
    c.pointerMove(move(10, 0));
    expect(calls.pan).toEqual([[-10 * MOUSE_PAN_UNITS_PER_PX, 0]]);
  });

  it('orbit: false makes a left drag pan; pan: false ignores pan drags', () => {
    const a = host({ orbit: false });
    a.c.pointerDown(down(0));
    a.c.pointerMove(move(10, 0));
    expect(a.calls.pan.length).toBe(1);
    expect(a.calls.rotate).toEqual([]);
    const b = host({ pan: false });
    expect(b.c.pointerDown(down(0, 0, 0, { shiftKey: true }))).toBe(false);
    expect(b.c.pointerDown(down(2))).toBe(false);
    expect(b.c.pointerMove(move(10, 0))).toBe(false);
    expect(b.c.wantsContextMenuBlocked()).toBe(false);
    expect(b.calls.capture).toEqual([]);
  });

  it('a move with no buttons held (released outside without capture) ends the drag', () => {
    const { c, calls } = host();
    c.pointerDown(down(0));
    c.pointerMove(move(20, 0));
    expect(c.pointerMove(move(30, 0, 0))).toBe(false);
    expect(c.pointerMove(move(40, 0))).toBe(false);
    expect(calls.rotate.length).toBe(1);
  });

  it('ignores touch / pen and inactive views (charts)', () => {
    const { c, calls } = host();
    expect(c.pointerDown(down(0, 0, 0, { pointerType: 'touch' }))).toBe(false);
    let active = false;
    const off = host({}, { active: () => active });
    expect(off.c.pointerDown(down(0))).toBe(false);
    expect(off.c.wheel({ deltaY: 100 })).toBe(false);
    expect(off.c.wantsContextMenuBlocked()).toBe(false);
    active = true;
    expect(off.c.wantsContextMenuBlocked()).toBe(true);
    expect(calls.capture).toEqual([]);
  });

  it('wheel zooms by a factor of the distance, else additively; line / page deltas are normalized', () => {
    const a = host({}, { distance: () => 200 });
    expect(a.c.wheel({ deltaY: 100 })).toBe(true);
    expect(a.calls.zoom[0]).toBeCloseTo(200 * (Math.exp(100 * WHEEL_ZOOM_RATE) - 1));
    a.c.wheel({ deltaY: -100 });
    expect(a.calls.zoom[1]).toBeLessThan(0);
    expect(a.calls.changed).toBe(2);
    const b = host();
    b.c.wheel({ deltaY: 3, deltaMode: 1 });
    b.c.wheel({ deltaY: 1, deltaMode: 2 });
    expect(b.calls.zoom).toEqual([48 * WHEEL_ZOOM_UNITS_PER_PX, 400 * WHEEL_ZOOM_UNITS_PER_PX]);
    const c = host({ zoom: false });
    expect(c.c.wheel({ deltaY: 100 })).toBe(false);
    expect(host(false).c.pointerDown(down(0))).toBe(false);
  });
});

const ptr = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  buttons: type === 'pointermove' ? 1 : 0,
  clientX: x,
  clientY: y,
  preventDefault: () => {},
  ...extra,
});

describe('enableNodeInteractions camera controls', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function setup(options: Parameters<Charturbo['enableNodeInteractions']>[1] = {}, withCameraState = true) {
    const mock = graphBackend(withCameraState);
    const sdk = Charturbo.fromBackend(mock.backend);
    const c = fakeCanvas();
    const detach = sdk.enableNodeInteractions(c.canvas, { builtInTooltip: false, ...options });
    return { sdk, detach, ...mock, ...c };
  }

  it('mouse drag orbits, Shift / right drag pans, wheel zooms (no page scroll), capture ends drags', () => {
    const { sdk, handlers, calls, captured } = setup({ autoRender: true });
    expect(sdk.handlesCameraControls()).toBe(true);
    handlers.pointerdown(ptr('pointerdown', 100, 100));
    expect(captured).toEqual([1]);
    handlers.pointermove(ptr('pointermove', 140, 90));
    expect(calls.rotate_camera).toEqual([[-40 * MOUSE_ORBIT_RAD_PER_PX, -10 * MOUSE_ORBIT_RAD_PER_PX]]);
    expect(calls.sync_and_render?.length).toBeGreaterThan(0);
    handlers.pointerup(ptr('pointerup', 140, 90));

    handlers.pointerdown(ptr('pointerdown', 100, 100, { button: 2 }));
    handlers.pointermove(ptr('pointermove', 110, 100, { buttons: 2 }));
    // 2 * 220 * tan(22.5°) / 200 px world units per px
    const k = (2 * 220 * Math.tan(Math.PI / 8)) / 200;
    expect(calls.pan_camera?.[0][0]).toBeCloseTo(-10 * k);
    // Capture lost (e.g. window blur): the drag is over
    handlers.lostpointercapture(ptr('lostpointercapture', 110, 100));
    handlers.pointermove(ptr('pointermove', 150, 100, { buttons: 2 }));
    expect(calls.pan_camera?.length).toBe(1);

    let prevented = false;
    handlers.wheel({ deltaY: 100, clientX: 0, clientY: 0, preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
    expect(calls.zoom_camera?.[0][0]).toBeCloseTo(220 * (Math.exp(100 * WHEEL_ZOOM_RATE) - 1));

    let menuBlocked = false;
    handlers.contextmenu({ preventDefault: () => (menuBlocked = true) });
    expect(menuBlocked).toBe(true);
  });

  it('a press released within 5 px is still a node click', () => {
    const onNodeClick = vi.fn();
    const { handlers, calls, pick } = setup({ onNodeClick });
    pick(2);
    handlers.pointerdown(ptr('pointerdown', 50, 50));
    handlers.pointermove(ptr('pointermove', 52, 51));
    handlers.pointerup(ptr('pointerup', 52, 51));
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0][0].id).toBe(2);
    expect(calls.rotate_camera).toBeUndefined();
    // A real drag is not a click
    handlers.pointerdown(ptr('pointerdown', 50, 50));
    handlers.pointermove(ptr('pointermove', 90, 50));
    handlers.pointerup(ptr('pointerup', 90, 50));
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    // Nor is a 4 px drag past the camera slop, or an orbit released back at its press point
    handlers.pointerdown(ptr('pointerdown', 50, 50));
    handlers.pointermove(ptr('pointermove', 54, 50));
    handlers.pointerup(ptr('pointerup', 54, 50));
    handlers.pointerdown(ptr('pointerdown', 50, 50));
    handlers.pointermove(ptr('pointermove', 150, 50));
    handlers.pointermove(ptr('pointermove', 51, 50));
    handlers.pointerup(ptr('pointerup', 51, 50));
    expect(onNodeClick).toHaveBeenCalledTimes(1);
  });

  it('cameraControls: false leaves the camera to the host; switches gate single moves', () => {
    const off = setup({ cameraControls: false });
    expect(off.sdk.handlesCameraControls()).toBe(false);
    off.handlers.pointerdown(ptr('pointerdown', 0, 0));
    off.handlers.pointermove(ptr('pointermove', 50, 0));
    let prevented = false;
    off.handlers.wheel({ deltaY: 100, clientX: 0, clientY: 0, preventDefault: () => (prevented = true) });
    expect(off.calls.rotate_camera).toBeUndefined();
    expect(off.calls.zoom_camera).toBeUndefined();
    expect(prevented).toBe(false);

    const noZoom = setup({ cameraControls: { zoom: false } });
    noZoom.handlers.wheel({ deltaY: 100, clientX: 0, clientY: 0, preventDefault: () => {} });
    expect(noZoom.calls.zoom_camera).toBeUndefined();
    noZoom.handlers.pointerdown(ptr('pointerdown', 0, 0));
    noZoom.handlers.pointermove(ptr('pointermove', 50, 0));
    expect(noZoom.calls.rotate_camera?.length).toBe(1);
  });

  it('touch drags follow the switches (orbit: false pans), mouse and touch never double up', () => {
    const { handlers, calls } = setup({ cameraControls: { orbit: false } });
    const touch = (type: string, x: number) => ptr(type, x, 100, { pointerType: 'touch', timeStamp: 0 });
    handlers.pointerdown(touch('pointerdown', 100));
    handlers.pointermove(touch('pointermove', 140));
    handlers.pointermove(touch('pointermove', 160));
    handlers.pointerup(touch('pointerup', 160));
    expect(calls.rotate_camera).toBeUndefined();
    expect(calls.pan_camera?.length).toBeGreaterThan(0);
  });

  it('charts keep their own wheel / drag navigation', () => {
    const { sdk, handlers, calls } = setup();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    expect(sdk.handlesCameraControls()).toBe(false);
    handlers.pointerdown(ptr('pointerdown', 0, 0));
    handlers.pointermove(ptr('pointermove', 50, 0));
    handlers.pointerup(ptr('pointerup', 50, 0));
    handlers.wheel({ deltaY: 100, clientX: 0, clientY: 0, preventDefault: () => {} });
    expect(calls.rotate_camera).toBeUndefined();
    expect(calls.zoom_camera).toBeUndefined();
    expect(calls.chart_pan_x?.length).toBe(1);
    expect(calls.chart_zoom_x?.length).toBe(1);
    let menuBlocked = false;
    handlers.contextmenu({ preventDefault: () => (menuBlocked = true) });
    expect(menuBlocked).toBe(false);
  });

  it('detach removes the controls', () => {
    const { sdk, detach, handlers } = setup();
    detach();
    expect(sdk.handlesCameraControls()).toBe(false);
    expect(handlers.wheel).toBeUndefined();
    expect(handlers.contextmenu).toBeUndefined();
    sdk.enableNodeInteractions(fakeCanvas().canvas);
    sdk.dispose();
    expect(sdk.handlesCameraControls()).toBe(false);
  });
});

describe('camera state / framing', () => {
  it('getCameraState maps the engine pose (eye from yaw / pitch); null without the binding', () => {
    const { backend } = graphBackend();
    const sdk = Charturbo.fromBackend(backend);
    const s = sdk.getCameraState()!;
    expect(s.target).toEqual([0, 0, 0]);
    expect(s.distance).toBe(220);
    expect(s.fovY).toBeCloseTo(Math.PI / 4);
    expect(s.aspect).toBe(2);
    expect(Math.hypot(...s.eye)).toBeCloseTo(220, 3);
    expect(s.eye[1]).toBeCloseTo(220 * Math.sin(Math.fround(0.3)), 3);
    expect(Charturbo.fromBackend(graphBackend(false).backend).getCameraState()).toBeNull();
  });

  it('focusNode moves closer relative to the fitToView distance, never farther; options override', () => {
    const { backend, cam } = graphBackend();
    const sdk = Charturbo.fromBackend(backend);
    sdk.fitToView();
    expect(sdk.focusNode(1)).toBe(true);
    expect(cam.target).toEqual([1, 2, 0]);
    expect(cam.distance).toBeCloseTo(120); // 40 % of 300
    // Again: already there, no further zoom
    sdk.focusNode(2);
    expect(cam.distance).toBeCloseTo(120);
    // Closer than the default: stays
    cam.distance = 50;
    sdk.focusNode(3);
    expect(cam.distance).toBe(50);
    sdk.focusNode(1, { distance: 80 });
    expect(cam.distance).toBeCloseTo(80);
    sdk.focusNode(2, { distance: false });
    expect(cam.distance).toBeCloseTo(80);
    expect(sdk.focusNode(9)).toBe(false);
  });

  it('new data drops the overview: the next first focus measures it again', () => {
    const { backend, cam } = graphBackend();
    const sdk = Charturbo.fromBackend(backend);
    sdk.fitToView(); // overview 300
    sdk.reloadSeededDataset(1, 10, 10, 2);
    cam.distance = 1000;
    sdk.focusNode(1);
    expect(cam.distance).toBeCloseTo(400); // 40 % of 1000, not of 300
  });

  it('double-click focuses and zooms; without camera_state only the target moves', () => {
    for (const withState of [true, false]) {
      const { backend, calls, cam, pick } = graphBackend(withState);
      const sdk = Charturbo.fromBackend(backend);
      const { canvas, handlers } = fakeCanvas();
      sdk.enableNodeInteractions(canvas, { builtInTooltip: false });
      pick(1);
      handlers.dblclick({ clientX: 10, clientY: 10 });
      expect(calls.focus_on_node).toEqual([[1]]);
      expect(cam.distance).toBeCloseTo(withState ? 88 : 220); // 40 % of the first framing (220)
    }
  });
});
