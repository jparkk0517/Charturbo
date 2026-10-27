// Same Barnes-Hut acceptance test, softening and leaf order as the CPU octree.
// xyzw records keep CPU/GPU alignment explicit; w of the output is reserved.
struct Body { position_mass: vec4<f32>, id: u32, next: u32, pad: vec2<u32> }
struct Cell { com_mass: vec4<f32>, size_sq: f32, escape: u32, body: u32, pad: u32 }
struct Params { count: u32, cells: u32, theta_sq: f32, strength: f32, softening: f32, pad: vec3<f32> }
@group(0) @binding(0) var<storage, read> bodies: array<Body>;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: Params;

fn pair_force(subject: Body, other: Body) -> vec3<f32> {
    var delta = subject.position_mass.xyz - other.position_mass.xyz;
    var len_sq = dot(delta, delta);
    if len_sq < 1e-12 {
        let lo = min(subject.id, other.id);
        let hi = max(subject.id, other.id);
        let hash = (lo * 0x9E3779B1u) ^ (hi * 0x85EBCA77u);
        let angle = f32(hash % 6283u) * 0.001;
        let z = f32((hash >> 13u) % 2001u) * 0.001 - 1.0;
        let r = sqrt(max(0.0, 1.0 - z * z));
        let sign = select(-1.0, 1.0, subject.id < other.id);
        delta = vec3<f32>(r * cos(angle), r * sin(angle), z) * (sign * 0.001);
        len_sq = 1e-6;
    }
    let d2 = len_sq + params.softening;
    return delta * (inverseSqrt(d2) * (params.strength * other.position_mass.w / d2));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if i >= params.count { return; }
    let subject = bodies[i];
    var force = vec3<f32>(0.0);
    if params.theta_sq == 0.0 {
        for (var j = 0u; j < params.count; j++) {
            if bodies[j].id != subject.id { force += pair_force(subject, bodies[j]); }
        }
    } else {
        var cell_index = 0u;
        while cell_index < params.cells {
            let cell = cells[cell_index];
            if cell.com_mass.w <= 0.0 { cell_index = cell.escape; continue; }
            if cell.body != 0xffffffffu {
                var body = cell.body;
                while body != 0xffffffffu {
                    let other = bodies[body];
                    if other.id != subject.id { force += pair_force(subject, other); }
                    body = other.next;
                }
                cell_index = cell.escape;
            } else {
                let delta = subject.position_mass.xyz - cell.com_mass.xyz;
                let d2 = dot(delta, delta);
                if cell.size_sq < params.theta_sq * d2 {
                    let softened = d2 + params.softening;
                    force += delta * (inverseSqrt(softened) * (params.strength * cell.com_mass.w / softened));
                    cell_index = cell.escape;
                } else { cell_index++; }
            }
        }
    }
    forces[i] = vec4<f32>(force, 0.0);
}
