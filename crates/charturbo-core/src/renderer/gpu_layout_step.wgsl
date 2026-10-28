// Center gravity, CSR spring gather and semi-implicit Euler: the same formulas and operation
// order as ForceDirectedSimulator::step, one invocation per node. Reads start-of-step state only.
struct State { position_mass: vec4<f32>, velocity_pinned: vec4<f32> }
struct Edge { src: u32, dst: u32, weight: f32 }
struct Params { count: u32, dt: f32, stiffness: f32, rest: f32, gravity: f32, damping: f32, max_speed: f32, pad: f32 }
@group(0) @binding(0) var<storage, read> state_in: array<State>;
@group(0) @binding(1) var<storage, read> repulsion: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read> edge_ids: array<u32>;
@group(0) @binding(4) var<storage, read> edges: array<Edge>;
@group(0) @binding(5) var<storage, read_write> state_out: array<State>;
@group(0) @binding(6) var<storage, read_write> energy: array<f32>;
@group(0) @binding(7) var<uniform> params: Params;

// Exponent bits, so fast-math compilers cannot fold the NaN / Infinity test away.
fn finite(v: vec3<f32>) -> bool {
    return all((bitcast<vec3<u32>>(v) & vec3<u32>(0x7f800000u)) != vec3<u32>(0x7f800000u));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if i >= params.count { return; }
    let node = state_in[i];
    let position = node.position_mass.xyz;
    let mass = node.position_mass.w;
    if node.velocity_pinned.w != 0.0 {
        state_out[i] = State(node.position_mass, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        energy[i] = 0.0;
        return;
    }
    var force = repulsion[i].xyz - position * params.gravity * mass;
    for (var k = offsets[i]; k < offsets[i + 1u]; k++) {
        let e = edges[edge_ids[k]];
        let delta = state_in[e.dst].position_mass.xyz - state_in[e.src].position_mass.xyz;
        let dist = length(delta);
        if dist > 1e-5 {
            let f = (delta / dist) * (params.stiffness * (dist - params.rest) * e.weight);
            if e.src == i { force += f; } else { force -= f; }
        }
    }
    let accel = force / max(mass, 0.1);
    var velocity = (node.velocity_pinned.xyz + accel * params.dt) * params.damping;
    let speed_sq = dot(velocity, velocity);
    if speed_sq > params.max_speed * params.max_speed {
        velocity = velocity * (params.max_speed / sqrt(speed_sq));
    }
    let next = position + velocity * params.dt;
    if !finite(velocity) || !finite(next) {
        state_out[i] = State(node.position_mass, vec4<f32>(0.0));
        energy[i] = 0.0;
        return;
    }
    state_out[i] = State(vec4<f32>(next, mass), vec4<f32>(velocity, 0.0));
    energy[i] = 0.5 * mass * dot(velocity, velocity);
}
