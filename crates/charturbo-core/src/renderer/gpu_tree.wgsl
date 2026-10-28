// GPU Barnes-Hut octree equivalent to OctreeSpatialIndex (max depth 10):
// bounds -> Morton codes -> stable LSD radix sort -> Karras (2012) binary radix tree ->
// octree cells (topmost binary node per 3-bit level) in DFS order with escape indexes.
// Single-child CPU cells are collapsed: same mass and COM, smaller size, identical forces.
struct State { position_mass: vec4<f32>, velocity_pinned: vec4<f32> }
struct Body { position_mass: vec4<f32>, id: u32, next: u32, pad: vec2<u32> }
struct Cell { com_mass: vec4<f32>, size_sq: f32, escape: u32, body: u32, pad: u32 }
struct Header { center: vec3<f32>, half: f32, cells: u32, pad0: u32, pad1: u32, pad2: u32 }
// Internal binary node. Children: internal ids < count - 1, leaves are count - 1 + sorted index.
struct Node { left: u32, right: u32, parent: u32, delta: u32, first: u32, last: u32, count: u32, pad: u32 }
struct Params { count: u32, shift: u32, tiles: u32, pad: u32 }

@group(0) @binding(0) var<storage, read> state_in: array<State>;
@group(0) @binding(1) var<storage, read_write> header: Header;
@group(0) @binding(2) var<storage, read_write> partials: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> keys_in: array<u32>;
@group(0) @binding(4) var<storage, read> vals_in: array<u32>;
@group(0) @binding(5) var<storage, read_write> tmp_keys: array<u32>;
@group(0) @binding(6) var<storage, read_write> tmp_vals: array<u32>;
@group(0) @binding(7) var<storage, read_write> hist: array<u32>;
@group(0) @binding(8) var<storage, read_write> tile_start: array<u32>;
@group(0) @binding(9) var<storage, read_write> keys_out: array<u32>;
@group(0) @binding(10) var<storage, read_write> vals_out: array<u32>;
@group(0) @binding(11) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(12) var<storage, read_write> leaf_parent: array<u32>;
@group(0) @binding(13) var<storage, read_write> sums: array<vec4<f32>>;
@group(0) @binding(14) var<storage, read> done_in: array<u32>;
@group(0) @binding(15) var<storage, read_write> done_out: array<u32>;
@group(0) @binding(16) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(17) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(18) var<uniform> params: Params;

const NONE: u32 = 0xffffffffu;
const TILE: u32 = 256u;
const MAX_DEPTH: u32 = 10u;

var<workgroup> scan_scratch: array<u32, 256>;
var<workgroup> tile_keys: array<u32, 256>;
var<workgroup> tile_vals: array<u32, 256>;
var<workgroup> lo_scratch: array<vec3<f32>, 256>;
var<workgroup> hi_scratch: array<vec3<f32>, 256>;
var<workgroup> digit_start: array<u32, 16>;
var<workgroup> digit_count: array<u32, 16>;

// Workgroup-wide exclusive prefix sum (Hillis-Steele); every invocation must call it.
fn scan_exclusive(lid: u32, value: u32) -> u32 {
    scan_scratch[lid] = value;
    workgroupBarrier();
    for (var offset = 1u; offset < TILE; offset <<= 1u) {
        var add = 0u;
        if lid >= offset { add = scan_scratch[lid - offset]; }
        workgroupBarrier();
        scan_scratch[lid] += add;
        workgroupBarrier();
    }
    return scan_scratch[lid] - value;
}

// ---- Root cube: the CPU octree's AABB center and half extent ----

fn reduce_bounds(lid: u32, lo: vec3<f32>, hi: vec3<f32>) {
    lo_scratch[lid] = lo;
    hi_scratch[lid] = hi;
    workgroupBarrier();
    for (var stride = TILE / 2u; stride > 0u; stride >>= 1u) {
        if lid < stride {
            lo_scratch[lid] = min(lo_scratch[lid], lo_scratch[lid + stride]);
            hi_scratch[lid] = max(hi_scratch[lid], hi_scratch[lid + stride]);
        }
        workgroupBarrier();
    }
}

@compute @workgroup_size(256)
fn bounds_partial(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    var lo = vec3<f32>(3.4e38);
    var hi = vec3<f32>(-3.4e38);
    if gid.x < params.count {
        lo = state_in[gid.x].position_mass.xyz;
        hi = lo;
    }
    reduce_bounds(l.x, lo, hi);
    if l.x == 0u {
        partials[wid.x * 2u] = vec4<f32>(lo_scratch[0], 0.0);
        partials[wid.x * 2u + 1u] = vec4<f32>(hi_scratch[0], 0.0);
    }
}

@compute @workgroup_size(256)
fn bounds_final(@builtin(local_invocation_id) l: vec3<u32>) {
    var lo = vec3<f32>(3.4e38);
    var hi = vec3<f32>(-3.4e38);
    for (var t = l.x; t < params.tiles; t += TILE) {
        lo = min(lo, partials[t * 2u].xyz);
        hi = max(hi, partials[t * 2u + 1u].xyz);
    }
    reduce_bounds(l.x, lo, hi);
    if l.x == 0u {
        let extent = hi_scratch[0] - lo_scratch[0];
        header.center = (lo_scratch[0] + hi_scratch[0]) * 0.5;
        header.half = max(max(extent.x, extent.y), extent.z) * 0.5 + 1.0;
    }
}

// ---- Morton codes: the octree's per-depth `>= center` octant tests, x = 1, y = 2, z = 4 ----

@compute @workgroup_size(256)
fn codes(@builtin(global_invocation_id) gid: vec3<u32>) {
    let k = gid.x;
    if k >= params.tiles * TILE { return; }
    if k >= params.count {
        // Sentinels sort after every 30-bit code
        keys_out[k] = NONE;
        vals_out[k] = NONE;
        return;
    }
    let p = state_in[k].position_mass.xyz;
    var c = header.center;
    var h = header.half;
    var key = 0u;
    for (var depth = 0u; depth < MAX_DEPTH; depth++) {
        let step = h * 0.5;
        var octant = 0u;
        if p.x >= c.x { octant |= 1u; c.x += step; } else { c.x += -step; }
        if p.y >= c.y { octant |= 2u; c.y += step; } else { c.y += -step; }
        if p.z >= c.z { octant |= 4u; c.z += step; } else { c.z += -step; }
        key = (key << 3u) | octant;
        h = step;
    }
    keys_out[k] = key;
    vals_out[k] = k;
}

// ---- Stable LSD radix sort, 4 bits per pass (Satish, Harris & Garland 2009) ----

fn digit_of(key: u32) -> u32 { return (key >> params.shift) & 15u; }

@compute @workgroup_size(256)
fn sort_local(@builtin(local_invocation_id) l: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    let lid = l.x;
    let g = wid.x * TILE + lid;
    var key = keys_in[g];
    var val = vals_in[g];
    // Four stable 1-bit splits sort the tile by digit
    for (var b = 0u; b < 4u; b++) {
        let bit = (key >> (params.shift + b)) & 1u;
        let zeros_before = scan_exclusive(lid, 1u - bit);
        let total_zeros = scan_scratch[TILE - 1u];
        workgroupBarrier();
        var dest = zeros_before;
        if bit == 1u { dest = total_zeros + (lid - zeros_before); }
        tile_keys[dest] = key;
        tile_vals[dest] = val;
        workgroupBarrier();
        key = tile_keys[lid];
        val = tile_vals[lid];
        workgroupBarrier();
    }
    if lid < 16u { digit_start[lid] = 0u; digit_count[lid] = 0u; }
    workgroupBarrier();
    let d = digit_of(key);
    if lid == 0u || digit_of(tile_keys[lid - 1u]) != d { digit_start[d] = lid; }
    workgroupBarrier();
    if lid == TILE - 1u || digit_of(tile_keys[lid + 1u]) != d { digit_count[d] = lid + 1u - digit_start[d]; }
    workgroupBarrier();
    if lid < 16u {
        hist[lid * params.tiles + wid.x] = digit_count[lid];
        tile_start[wid.x * 16u + lid] = digit_start[lid];
    }
    tmp_keys[g] = key;
    tmp_vals[g] = val;
}

// Exclusive scan of the digit-major histogram (one workgroup).
@compute @workgroup_size(256)
fn sort_scan(@builtin(local_invocation_id) l: vec3<u32>) {
    let len = params.tiles * 16u;
    let per = (len + TILE - 1u) / TILE;
    let base = l.x * per;
    var sum = 0u;
    for (var j = 0u; j < per; j++) {
        if base + j < len { sum += hist[base + j]; }
    }
    var run = scan_exclusive(l.x, sum);
    for (var j = 0u; j < per; j++) {
        if base + j < len {
            let v = hist[base + j];
            hist[base + j] = run;
            run += v;
        }
    }
}

@compute @workgroup_size(256)
fn sort_scatter(@builtin(local_invocation_id) l: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    let g = wid.x * TILE + l.x;
    let key = tmp_keys[g];
    let d = digit_of(key);
    let dest = hist[d * params.tiles + wid.x] + l.x - tile_start[wid.x * 16u + d];
    keys_out[dest] = key;
    vals_out[dest] = tmp_vals[g];
}

// ---- Karras binary radix tree over (code, sorted index) ----

fn delta(i: i32, j: i32) -> i32 {
    if j < 0 || j >= i32(params.count) { return -1; }
    let a = keys_in[i];
    let b = keys_in[j];
    if a == b { return 32 + i32(countLeadingZeros(u32(i) ^ u32(j))); }
    return i32(countLeadingZeros(a ^ b));
}

fn set_parent(child: u32, parent: u32) {
    if child >= params.count - 1u { leaf_parent[child - (params.count - 1u)] = parent; } else { nodes[child].parent = parent; }
}

@compute @workgroup_size(64)
fn tree_build(@builtin(global_invocation_id) gid: vec3<u32>) {
    let n = i32(params.count);
    let i = i32(gid.x);
    if i >= n - 1 { return; }
    let d = select(-1, 1, delta(i, i + 1) > delta(i, i - 1));
    let delta_min = delta(i, i - d);
    var l_max = 2;
    while delta(i, i + l_max * d) > delta_min { l_max *= 2; }
    var l = 0;
    for (var t = l_max / 2; t >= 1; t /= 2) {
        if delta(i, i + (l + t) * d) > delta_min { l += t; }
    }
    let j = i + l * d;
    let delta_node = delta(i, j);
    var s = 0;
    var div = 2;
    loop {
        let t = (l + div - 1) / div;
        if delta(i, i + (s + t) * d) > delta_node { s += t; }
        if t <= 1 { break; }
        div *= 2;
    }
    let gamma = i + s * d + min(d, 0);
    let first = min(i, j);
    let last = max(i, j);
    let leaf_base = u32(n - 1);
    let left = select(u32(gamma), leaf_base + u32(gamma), first == gamma);
    let right = select(u32(gamma + 1), leaf_base + u32(gamma + 1), last == gamma + 1);
    nodes[i].left = left;
    nodes[i].right = right;
    nodes[i].delta = u32(delta_node);
    nodes[i].first = u32(first);
    nodes[i].last = u32(last);
    set_parent(left, u32(i));
    set_parent(right, u32(i));
    if i == 0 { nodes[0].parent = NONE; }
}

// ---- Octree view of the binary tree ----

// Octree level of a binary node: shared 3-bit groups, 10 = equal codes (max-depth chain).
fn level(delta: u32) -> u32 { return select((delta - 2u) / 3u, MAX_DEPTH, delta >= 32u); }

fn leaf_parent_of(k: u32) -> u32 { return select(leaf_parent[k], NONE, params.count == 1u); }

fn emits_internal(i: u32) -> bool {
    let p = nodes[i].parent;
    return p == NONE || level(nodes[p].delta) < level(nodes[i].delta);
}

fn emits_leaf(k: u32) -> bool {
    let p = leaf_parent_of(k);
    return p == NONE || level(nodes[p].delta) < MAX_DEPTH;
}

fn leaf_sum(k: u32) -> vec4<f32> {
    let s = state_in[vals_in[k]].position_mass;
    return vec4<f32>(s.xyz * s.w, s.w);
}

fn child_sum(c: u32) -> vec4<f32> {
    if c >= params.count - 1u { return leaf_sum(c - (params.count - 1u)); }
    return sums[c];
}

fn child_count(c: u32) -> u32 {
    if c >= params.count - 1u { return select(0u, 1u, emits_leaf(c - (params.count - 1u))); }
    return nodes[c].count;
}

fn ready(c: u32) -> bool { return c >= params.count - 1u || done_in[c] != 0u; }

// One bottom-up wave: nodes whose children finished in an earlier wave (ping-pong flags keep
// every read of a child's sum after the dispatch that wrote it).
@compute @workgroup_size(64)
fn tree_reduce(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if i + 1u >= params.count { return; }
    if done_in[i] != 0u { done_out[i] = 1u; return; }
    let left = nodes[i].left;
    let right = nodes[i].right;
    if !(ready(left) && ready(right)) { done_out[i] = 0u; return; }
    sums[i] = child_sum(left) + child_sum(right);
    let own = select(0u, 1u, emits_internal(i));
    // A max-depth chain is one leaf cell; inner chain nodes emit nothing
    nodes[i].count = select(own + child_count(left) + child_count(right), own, level(nodes[i].delta) >= MAX_DEPTH);
    done_out[i] = 1u;
}

// DFS position of the octree cell at binary node `id`: emitted ancestors plus left siblings' cells.
fn dfs_index(id: u32, parent: u32) -> u32 {
    var index = 0u;
    var c = id;
    var p = parent;
    while p != NONE {
        if nodes[p].right == c { index += child_count(nodes[p].left); }
        if emits_internal(p) { index += 1u; }
        c = p;
        p = nodes[p].parent;
    }
    return index;
}

@compute @workgroup_size(64)
fn tree_cells(@builtin(global_invocation_id) gid: vec3<u32>) {
    let n = params.count;
    let id = gid.x;
    if id >= 2u * n - 1u { return; }
    if id + 1u < n {
        if !emits_internal(id) { return; }
        let node = nodes[id];
        let index = dfs_index(id, node.parent);
        let sum = sums[id];
        var cell = Cell(vec4<f32>(sum.xyz / sum.w, sum.w), 0.0, index + node.count, NONE, 0u);
        let lvl = level(node.delta);
        if lvl >= MAX_DEPTH {
            cell.body = vals_in[node.last];
        } else {
            let size = ldexp(header.half, -i32(lvl)) * 2.0;
            cell.size_sq = size * size;
        }
        cells[index] = cell;
        if node.parent == NONE { header.cells = node.count; }
    } else {
        let k = id - (n - 1u);
        if !emits_leaf(k) { return; }
        let parent = leaf_parent_of(k);
        let index = dfs_index(id, parent);
        let sum = leaf_sum(k);
        cells[index] = Cell(vec4<f32>(sum.xyz / sum.w, sum.w), 0.0, index + 1u, vals_in[k], 0u);
        if parent == NONE { header.cells = 1u; }
    }
}

// Bodies in node order; equal codes chain from the highest node id down, like the CPU leaf list.
@compute @workgroup_size(64)
fn tree_bodies(@builtin(global_invocation_id) gid: vec3<u32>) {
    let k = gid.x;
    if k >= params.count { return; }
    let id = vals_in[k];
    var next = NONE;
    if k > 0u && keys_in[k - 1u] == keys_in[k] { next = vals_in[k - 1u]; }
    bodies[id] = Body(state_in[id].position_mass, id, next, vec2<u32>(0u));
}
