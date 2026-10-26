/**
 * Cursor and x zoom / pan sync between chart instances for dashboards (uPlot `cursor.sync`,
 * ECharts `connect`, Highcharts synchronized charts). Each member keeps its own engine; this only
 * relays data-unit positions: the hovered data x (`getHoverX` -> `hoverAtX`, hit-tested in the
 * engine) and the visible x range (`'rangechange'` -> `setXRange`, clamped by each engine to its
 * own domain). DOM-free so it runs under the test runner as-is.
 */
import {
  defaultFrameScheduler,
  frameThrottle,
  type FrameScheduler,
  type VizHoverEvent,
  type VizRange,
} from './chart-events';

export interface ChartSyncOptions {
  /** Share the hover: the others show crosshair + markers at the hovered data x (default: true) */
  cursor?: boolean;
  /** Share x zoom / pan in data units (default: true) */
  x?: boolean;
  /** y ranges are never shared (scatter y domains differ per chart) */
  y?: false;
  /** Followers also show their tooltip at the synced x (default: false = crosshair / markers only) */
  tooltip?: boolean;
}

/** Per-instance membership (`VizEngineSDK.create({ sync })` / `setSync`). */
export interface ChartSyncMemberOptions extends ChartSyncOptions {
  /** Group name: instances with the same key are synced */
  key: string;
}

/** What a group needs from a chart (`VizEngineSDK` implements it). */
export interface ChartSyncMember {
  on(event: 'hover', handler: (e: VizHoverEvent) => void): () => void;
  on(event: 'rangechange', handler: (r: VizRange) => void): () => void;
  /** Data x of the current hover (`null` = none) */
  getHoverX(): number | null;
  /** Hovers at a data x without emitting `'hover'` (`null` clears); true when something is hovered */
  hoverAtX(x: number | null, options?: { tooltip?: boolean }): boolean;
  getXRange(): [number, number] | null;
  setXRange(min: number, max: number): boolean;
  render(): void;
}

interface Membership {
  options: ChartSyncOptions;
  unsubscribe: () => void;
  /** Range this member reported right after the group moved it: its `'rangechange'` echo */
  echo: [number, number] | null;
}

type Flag = 'cursor' | 'x' | 'tooltip';
const FLAG_DEFAULTS: Record<Flag, boolean> = { cursor: true, x: true, tooltip: false };

class SyncGroup {
  readonly members = new Map<ChartSyncMember, Membership>();
  /** Group-wide flags from `connect(key, options)`; members' own flags win */
  defaults: ChartSyncOptions = {};
  /** Latest cursor / range of this frame (newer events overwrite older ones) */
  private cursor: { origin: ChartSyncMember; x: number | null } | null = null;
  private range: { origin: ChartSyncMember; x: [number, number] } | null = null;
  /** Members currently showing a synced cursor, and the member it comes from */
  private readonly following = new Set<ChartSyncMember>();
  private cursorOrigin: ChartSyncMember | null = null;
  private readonly frame: ReturnType<typeof frameThrottle>;

  constructor(
    readonly key: string,
    scheduler: FrameScheduler
  ) {
    this.frame = frameThrottle(() => this.flush(), scheduler);
  }

  flag(member: ChartSyncMember, name: Flag): boolean {
    return this.members.get(member)?.options[name] ?? this.defaults[name] ?? FLAG_DEFAULTS[name];
  }

  join(member: ChartSyncMember, options: ChartSyncOptions): void {
    const offHover = member.on('hover', (e) => this.onHover(member, e));
    const offRange = member.on('rangechange', (r) => this.onRange(member, r));
    const unsubscribe = () => {
      offHover();
      offRange();
    };
    this.members.set(member, { options, unsubscribe, echo: null });
  }

  leave(member: ChartSyncMember): void {
    const m = this.members.get(member);
    if (!m) return;
    m.unsubscribe();
    this.members.delete(member);
    if (this.cursor?.origin === member) this.cursor = null;
    if (this.range?.origin === member) this.range = null;
    // Its own synced cursor goes; so do the cursors it was driving
    const stale = this.cursorOrigin === member ? [...this.following] : [member];
    if (this.cursorOrigin === member) this.cursorOrigin = null;
    for (const f of stale) {
      if (!this.following.delete(f)) continue;
      f.hoverAtX(null);
      f.render();
    }
    if (this.members.size === 0) this.frame.cancel();
  }

  private onHover(origin: ChartSyncMember, e: VizHoverEvent): void {
    if (!this.flag(origin, 'cursor')) return;
    this.cursor = { origin, x: e.chart ? origin.getHoverX() : null };
    this.frame.request();
  }

  private onRange(origin: ChartSyncMember, r: VizRange): void {
    const m = this.members.get(origin);
    if (!m || !this.flag(origin, 'x')) return;
    const echo = m.echo;
    m.echo = null;
    // Our own `setXRange` coming back (one frame later): not a user zoom, do not relay it
    if (echo && echo[0] === r.xMin && echo[1] === r.xMax) return;
    this.range = { origin, x: [r.xMin, r.xMax] };
    this.frame.request();
  }

  private flush(): void {
    const { cursor, range } = this;
    this.cursor = this.range = null;
    const dirty = new Set<ChartSyncMember>();
    if (range) {
      for (const [member, m] of this.members) {
        if (member === range.origin || !this.flag(member, 'x')) continue;
        if (member.setXRange(range.x[0], range.x[1])) {
          m.echo = member.getXRange();
          dirty.add(member);
        }
      }
    }
    if (cursor) {
      this.cursorOrigin = cursor.x === null ? null : cursor.origin;
      for (const member of this.members.keys()) {
        if (member === cursor.origin || !this.flag(member, 'cursor')) continue;
        if (cursor.x === null) {
          if (!this.following.delete(member)) continue;
          member.hoverAtX(null);
        } else {
          member.hoverAtX(cursor.x, { tooltip: this.flag(member, 'tooltip') });
          this.following.add(member);
        }
        dirty.add(member);
      }
      // The origin itself is hovered by its pointer now, not by the group
      this.following.delete(cursor.origin);
    }
    for (const member of dirty) member.render();
  }
}

const groups = new Map<string, SyncGroup>();
const memberGroup = new Map<ChartSyncMember, SyncGroup>();
let anonymousGroups = 0;

function groupOf(key: string, scheduler: FrameScheduler): SyncGroup {
  let g = groups.get(key);
  if (!g) groups.set(key, (g = new SyncGroup(key, scheduler)));
  return g;
}

/** Removes `member` from its group (no-op when it is in none). */
export function leaveSyncGroup(member: ChartSyncMember): void {
  const g = memberGroup.get(member);
  if (!g) return;
  memberGroup.delete(member);
  g.leave(member);
  if (g.members.size === 0 && Object.keys(g.defaults).length === 0) groups.delete(g.key);
}

/** Puts `member` in group `options.key` (leaving any previous group); returns the leave function. */
export function joinSyncGroup(
  member: ChartSyncMember,
  options: ChartSyncMemberOptions,
  scheduler: FrameScheduler = defaultFrameScheduler
): () => void {
  leaveSyncGroup(member);
  const { key, ...flags } = options;
  const g = groupOf(key, scheduler);
  g.join(member, flags);
  memberGroup.set(member, g);
  return () => {
    if (memberGroup.get(member) === g) leaveSyncGroup(member);
  };
}

/** Group key and flags of `member` (`null` when not synced). */
export function syncMembership(member: ChartSyncMember): ChartSyncMemberOptions | null {
  const g = memberGroup.get(member);
  if (!g) return null;
  return { key: g.key, cursor: g.flag(member, 'cursor'), x: g.flag(member, 'x'), tooltip: g.flag(member, 'tooltip') };
}

/**
 * Syncs charts. An array: those charts form a new group with `options`. A key: sets the
 * group-wide `options` of every chart that joins `key` (members' own flags win). The returned
 * function disconnects: array members leave; a keyed group is disbanded (all its members leave).
 */
export function connectCharts(
  group: string | readonly ChartSyncMember[],
  options: ChartSyncOptions = {},
  scheduler: FrameScheduler = defaultFrameScheduler
): () => void {
  const flags = { cursor: options.cursor, x: options.x, tooltip: options.tooltip };
  if (typeof group === 'string') {
    const g = groupOf(group, scheduler);
    g.defaults = flags;
    return () => {
      for (const member of [...g.members.keys()]) leaveSyncGroup(member);
      g.defaults = {};
      if (groups.get(group) === g) groups.delete(group);
    };
  }
  const key = `\u0000connect-${++anonymousGroups}`;
  const leaves = group.map((member) => joinSyncGroup(member, { key, ...flags }, scheduler));
  return () => leaves.forEach((leave) => leave());
}
