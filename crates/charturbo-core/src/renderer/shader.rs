/// WGSL shader for instanced spherical billboard impostors with procedural normal & lighting.
pub const NODE_BILLBOARD_WGSL: &str = r#"
struct CameraUniform {
    view_proj: mat4x4<f32>,
    camera_right: vec4<f32>,
    camera_up: vec4<f32>,
    viewport: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

struct NodeInstance {
    @location(0) position_radius: vec4<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_node(
    @builtin(vertex_index) vertex_idx: u32,
    instance: NodeInstance,
) -> VertexOutput {
    // 6 vertices forming a quad [-1, 1] x [-1, 1]
    var quad = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0,  1.0),
    );

    let corner = quad[vertex_idx];
    let center = instance.position_radius.xyz;
    let radius = instance.position_radius.w;

    let world_pos = center
        + camera.camera_right.xyz * (corner.x * radius)
        + camera.camera_up.xyz * (corner.y * radius);

    var out: VertexOutput;
    out.clip_position = camera.view_proj * vec4<f32>(world_pos, 1.0);
    out.uv = corner;
    out.color = instance.color;
    return out;
}

@fragment
fn fs_node(in: VertexOutput) -> @location(0) vec4<f32> {
    let r2 = dot(in.uv, in.uv);
    if (r2 > 1.0) {
        discard;
    }
    let z = sqrt(max(0.0, 1.0 - r2));
    let normal = normalize(vec3<f32>(in.uv.x, in.uv.y, z));
    let light_dir = normalize(vec3<f32>(0.45, 0.65, 0.85));
    let diffuse = max(dot(normal, light_dir), 0.0);
    let rim = pow(1.0 - z, 2.5) * 0.35;
    let lit_color = in.color.rgb * (0.32 + 0.68 * diffuse) + vec3<f32>(rim);
    return vec4<f32>(lit_color, in.color.a);
}
"#;

/// GPU-resident layout state (`gpu_layout.rs`) for graph shaders that read positions on the GPU.
const LAYOUT_STATE_WGSL: &str = "struct LayoutState { position_mass: vec4<f32>, velocity_pinned: vec4<f32> };
@group(1) @binding(0) var<storage, read> layout_state: array<LayoutState>;
";

/// `NODE_BILLBOARD_WGSL` for a GPU-resident layout: `position_radius.x` holds the node index
/// (an exact float below 2^24); the center comes from the layout buffer.
pub fn node_billboard_resident_wgsl() -> String {
    let src = NODE_BILLBOARD_WGSL.replace(
        "let center = instance.position_radius.xyz;",
        "let center = layout_state[u32(instance.position_radius.x)].position_mass.xyz;",
    );
    format!("{LAYOUT_STATE_WGSL}{src}")
}

/// `EDGE_LINE_WGSL` for a GPU-resident layout: `position_pad.x` holds the endpoint's node index.
pub fn edge_line_resident_wgsl() -> String {
    let src = EDGE_LINE_WGSL.replace(
        "vec4<f32>(v.position_pad.xyz, 1.0)",
        "vec4<f32>(layout_state[u32(v.position_pad.x)].position_mass.xyz, 1.0)",
    );
    format!("{LAYOUT_STATE_WGSL}{src}")
}

/// WGSL shader for single-draw-call translucent graph edges.
pub const EDGE_LINE_WGSL: &str = r#"
struct CameraUniform {
    view_proj: mat4x4<f32>,
    camera_right: vec4<f32>,
    camera_up: vec4<f32>,
    viewport: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

struct EdgeVertex {
    @location(0) position_pad: vec4<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_edge(v: EdgeVertex) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = camera.view_proj * vec4<f32>(v.position_pad.xyz, 1.0);
    out.color = v.color;
    return out;
}

@fragment
fn fs_edge(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}
"#;

/// WGSL shader for 3D lit meshes (Primitives & Custom Meshes) with Ambient, Directional, and Point lighting.
pub const MESH_LIT_WGSL: &str = r#"
struct CameraUniform {
    view_proj: mat4x4<f32>,
    camera_right: vec4<f32>,
    camera_up: vec4<f32>,
    viewport: vec4<f32>,
};

struct SceneLightUniform {
    eye_pos_ambient: vec4<f32>,
    dir_light_dir_intensity: vec4<f32>,
    point_light_pos_intensity: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

@group(0) @binding(1)
var<uniform> light: SceneLightUniform;

// Base-color texture (1 x 1 white when the object has no map) and the engine's sampler
@group(1) @binding(0)
var base_map: texture_2d<f32>;

@group(1) @binding(1)
var base_sampler: sampler;

// position.w = u, normal.w = v (v = 0 is the top row of the image)
struct MeshVertex {
    @location(0) position: vec4<f32>,
    @location(1) normal: vec4<f32>,
};

// Per-object instance: world matrix, normal matrix, color, material
struct MeshInstance {
    @location(2) model_0: vec4<f32>,
    @location(3) model_1: vec4<f32>,
    @location(4) model_2: vec4<f32>,
    @location(5) model_3: vec4<f32>,
    @location(6) normal_0: vec4<f32>,
    @location(7) normal_1: vec4<f32>,
    @location(8) normal_2: vec4<f32>,
    @location(9) color: vec4<f32>,
    @location(10) material: vec4<f32>, // (metallic, roughness, emissive, alpha_test)
    @location(11) uv_transform: vec4<f32>, // (repeat_u, repeat_v, offset_u, offset_v)
};

struct MeshVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) mat_params: vec4<f32>, // (metallic, roughness, emissive, alpha_test)
    @location(3) color: vec4<f32>,
    @location(4) uv: vec2<f32>,
};

@vertex
fn vs_mesh(v: MeshVertex, inst: MeshInstance) -> MeshVertexOutput {
    let model = mat4x4<f32>(inst.model_0, inst.model_1, inst.model_2, inst.model_3);
    let normal_mat = mat3x3<f32>(inst.normal_0.xyz, inst.normal_1.xyz, inst.normal_2.xyz);
    let world = model * vec4<f32>(v.position.xyz, 1.0);
    var out: MeshVertexOutput;
    out.clip_position = camera.view_proj * world;
    out.world_pos = world.xyz;
    out.world_normal = normal_mat * v.normal.xyz;
    out.mat_params = inst.material;
    out.color = inst.color;
    out.uv = vec2<f32>(v.position.w, v.normal.w) * inst.uv_transform.xy + inst.uv_transform.zw;
    return out;
}

@fragment
fn fs_mesh(in: MeshVertexOutput) -> @location(0) vec4<f32> {
    // Sampled first (uniform control flow) so the alpha-test discard can follow
    let tex = textureSample(base_map, base_sampler, in.uv);
    let alpha = clamp(in.color.a, 0.0, 1.0) * tex.a;
    if (alpha < in.mat_params.w) {
        discard;
    }
    let N = normalize(in.world_normal);
    let V = normalize(light.eye_pos_ambient.xyz - in.world_pos);
    let metallic = clamp(in.mat_params.x, 0.0, 1.0);
    let roughness = clamp(in.mat_params.y, 0.05, 1.0);
    let base_rgb = in.color.rgb * tex.rgb;
    let emissive = max(0.0, in.mat_params.z);

    // Sky/ground hemisphere ambient
    let hemi = 0.5 + 0.5 * N.y;
    let ambient_tint = mix(vec3<f32>(0.18, 0.22, 0.32), vec3<f32>(0.92, 0.96, 1.0), hemi);
    let ambient = base_rgb * ambient_tint * light.eye_pos_ambient.w;

    // Directional light (diffuse + Blinn-Phong specular)
    let L_dir = normalize(light.dir_light_dir_intensity.xyz);
    let dir_intensity = light.dir_light_dir_intensity.w;
    let ndotl_dir = max(dot(N, L_dir), 0.0);
    let H_dir = normalize(L_dir + V);
    let shininess = mix(128.0, 8.0, roughness);
    let spec_strength = mix(0.18, 0.95, metallic) * (1.0 - roughness * 0.7);
    let spec_dir = pow(max(dot(N, H_dir), 0.0), shininess) * spec_strength;
    let spec_tint = mix(vec3<f32>(1.0, 1.0, 1.0), base_rgb, metallic);
    let dir_contrib = (base_rgb * (1.0 - metallic * 0.45) * ndotl_dir + spec_tint * spec_dir) * dir_intensity;

    // Point light with distance attenuation
    let point_vec = light.point_light_pos_intensity.xyz - in.world_pos;
    let dist = length(point_vec);
    let L_pt = point_vec / max(dist, 0.001);
    let attenuation = 1.0 / (1.0 + 0.0035 * dist + 0.00008 * dist * dist);
    let ndotl_pt = max(dot(N, L_pt), 0.0);
    let H_pt = normalize(L_pt + V);
    let spec_pt = pow(max(dot(N, H_pt), 0.0), shininess) * spec_strength;
    let pt_contrib = (base_rgb * ndotl_pt + spec_tint * spec_pt) * light.point_light_pos_intensity.w * attenuation;

    // Subtle Fresnel rim
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.14;
    let final_rgb = ambient + dir_contrib + pt_contrib + base_rgb * emissive + vec3<f32>(fresnel);

    return vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}
"#;

/// Light uniform as declared by the classic `MESH_LIT_WGSL` (first 48 bytes of
/// `SceneLightUniformRaw`); `mesh_pbr_wgsl` swaps it for the full struct.
const MESH_LIGHT_STRUCT_CLASSIC: &str = "struct SceneLightUniform {
    eye_pos_ambient: vec4<f32>,
    dir_light_dir_intensity: vec4<f32>,
    point_light_pos_intensity: vec4<f32>,
};";

const MESH_LIGHT_STRUCT_PBR: &str = "struct SceneLightUniform {
    eye_pos_ambient: vec4<f32>,
    dir_light_dir_intensity: vec4<f32>,
    point_light_pos_intensity: vec4<f32>,
    // (model, tone mapping 0 none / 1 aces / 2 reinhard, exposure, env intensity)
    shading: vec4<f32>,
    // linear sky rgb, w = env map mip count (0 = no map: hemisphere)
    env_sky: vec4<f32>,
    // linear ground rgb, w = 1: encode the output to sRGB (non-sRGB surface)
    env_ground: vec4<f32>,
};";

/// Physically based mesh shading: the classic module (same vertex stage, bindings and instance
/// layout; its text stays untouched so classic output is unchanged) with the full light
/// uniform, the environment map in group 2 and the `fs_mesh_pbr` entry point.
pub fn mesh_pbr_wgsl() -> String {
    assert!(MESH_LIT_WGSL.contains(MESH_LIGHT_STRUCT_CLASSIC), "classic light struct changed");
    format!(
        "{}{MESH_PBR_BODY_WGSL}",
        MESH_LIT_WGSL.replacen(MESH_LIGHT_STRUCT_CLASSIC, MESH_LIGHT_STRUCT_PBR, 1)
    )
}

const MESH_PBR_BODY_WGSL: &str = r#"
// Equirectangular LDR (sRGB) environment, mipmapped; 1 x 1 white when unset (env_sky.w = 0)
@group(2) @binding(0)
var env_map: texture_2d<f32>;

@group(2) @binding(1)
var env_sampler: sampler;

const PI: f32 = 3.141592653589793;

// Exact piecewise sRGB transfer functions (inputs >= 0)
fn srgb_to_linear3(c: vec3<f32>) -> vec3<f32> {
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(hi, c / 12.92, c <= vec3<f32>(0.04045));
}

fn linear_to_srgb3(c: vec3<f32>) -> vec3<f32> {
    let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(hi, c * 12.92, c <= vec3<f32>(0.0031308));
}

// Direction -> equirect uv: u = 0.5 looks toward -z, v = 0 is straight up (top image row)
fn equirect_uv(d: vec3<f32>) -> vec2<f32> {
    let pole = abs(d.x) + abs(d.z) < 1e-6;
    let u = atan2(d.x, select(-d.z, 1.0, pole)) * (0.5 / PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2<f32>(u, v);
}

fn hemisphere(d: vec3<f32>) -> vec3<f32> {
    return mix(light.env_ground.rgb, light.env_sky.rgb, 0.5 + 0.5 * d.y) * light.shading.w;
}

// Environment radiance along `d` at mip `lod` (hemisphere colour without a map)
fn env_radiance(d: vec3<f32>, lod: f32) -> vec3<f32> {
    if (light.env_sky.w >= 1.0) {
        let t = textureSampleLevel(env_map, env_sampler, equirect_uv(d), lod).rgb;
        return srgb_to_linear3(t) * light.shading.w;
    }
    return hemisphere(d);
}

// Split-sum environment BRDF, analytic fit (Karis, "Physically Based Shading on Mobile")
fn env_brdf_approx(f0: vec3<f32>, n_dot_v: f32, roughness: f32) -> vec3<f32> {
    let c0 = vec4<f32>(-1.0, -0.0275, -0.572, 0.022);
    let c1 = vec4<f32>(1.0, 0.0425, 1.04, -0.04);
    let r = roughness * c0 + c1;
    let a004 = min(r.x * r.x, exp2(-9.28 * n_dot_v)) * r.x + r.y;
    let ab = vec2<f32>(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + vec3<f32>(ab.y);
}

// One punctual light: GGX NDF, height-correlated Smith visibility, Schlick Fresnel and
// Lambert diffuse * (1 - F). Scaled by PI so intensity 1 lights a white Lambert surface
// facing it to 1 (the classic shader's convention).
fn punctual(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, n_dot_v: f32, f0: vec3<f32>, diffuse_color: vec3<f32>, roughness: f32) -> vec3<f32> {
    let n_dot_l = dot(n, l);
    if (!(n_dot_l > 0.0)) {
        return vec3<f32>(0.0);
    }
    let hv = v + l;
    let h = hv * inverseSqrt(max(dot(hv, hv), 1e-12));
    let n_dot_h = clamp(dot(n, h), 0.0, 1.0);
    let v_dot_h = clamp(dot(v, h), 0.0, 1.0);
    let a = roughness * roughness;
    let a2 = a * a;
    let dd = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
    let ndf = a2 / (PI * dd * dd);
    let gv = n_dot_l * sqrt(n_dot_v * n_dot_v * (1.0 - a2) + a2);
    let gl = n_dot_v * sqrt(n_dot_l * n_dot_l * (1.0 - a2) + a2);
    let vis = 0.5 / max(gv + gl, 1e-6);
    let f = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - v_dot_h, 5.0);
    let diffuse = (vec3<f32>(1.0) - f) * diffuse_color * (1.0 / PI);
    return (diffuse + f * (ndf * vis)) * (n_dot_l * PI);
}

fn tone_map(c: vec3<f32>, mode: f32) -> vec3<f32> {
    if (mode > 1.5) {
        return c / (vec3<f32>(1.0) + c);
    }
    if (mode > 0.5) {
        // ACES filmic fit (Narkowicz 2015)
        return (c * (2.51 * c + vec3<f32>(0.03))) / (c * (2.43 * c + vec3<f32>(0.59)) + vec3<f32>(0.14));
    }
    return c;
}

@fragment
fn fs_mesh_pbr(in: MeshVertexOutput) -> @location(0) vec4<f32> {
    // Sampled first (uniform control flow) so the alpha-test discard can follow
    let tex = textureSample(base_map, base_sampler, in.uv);
    let alpha = clamp(in.color.a, 0.0, 1.0) * tex.a;
    if (alpha < in.mat_params.w) {
        discard;
    }
    let n = normalize(in.world_normal);
    let v = normalize(light.eye_pos_ambient.xyz - in.world_pos);
    let metallic = clamp(in.mat_params.x, 0.0, 1.0);
    let roughness = clamp(in.mat_params.y, 0.045, 1.0);
    let base = srgb_to_linear3(clamp(in.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0))) * srgb_to_linear3(tex.rgb);
    let emissive = max(0.0, in.mat_params.z);
    let f0 = mix(vec3<f32>(0.04), base, metallic);
    let diffuse_color = base * (1.0 - metallic);
    let n_dot_v = max(dot(n, v), 1e-4);

    // Directional light
    var color = punctual(n, v, normalize(light.dir_light_dir_intensity.xyz), n_dot_v, f0, diffuse_color, roughness)
        * light.dir_light_dir_intensity.w;

    // Point light: the classic distance attenuation (no range cut-off)
    let point_vec = light.point_light_pos_intensity.xyz - in.world_pos;
    let dist = length(point_vec);
    let attenuation = 1.0 / (1.0 + 0.0035 * dist + 0.00008 * dist * dist);
    color += punctual(n, v, point_vec / max(dist, 0.001), n_dot_v, f0, diffuse_color, roughness)
        * (light.point_light_pos_intensity.w * attenuation);

    // Environment: diffuse irradiance from a coarse mip (or the hemisphere), specular from the
    // roughness-selected mip along the dominant reflection direction
    let mips = light.env_sky.w;
    let r = reflect(-v, n);
    let spec_dir = normalize(mix(r, n, roughness * roughness));
    let spec_env = env_radiance(spec_dir, roughness * max(mips - 1.0, 0.0));
    let diffuse_env = env_radiance(n, max(mips - 3.0, (mips - 1.0) * 0.5));
    color += diffuse_color * diffuse_env + spec_env * env_brdf_approx(f0, n_dot_v, roughness);

    color += base * emissive;

    let mapped = clamp(tone_map(color * light.shading.z, light.shading.y), vec3<f32>(0.0), vec3<f32>(1.0));
    let out_rgb = select(mapped, linear_to_srgb3(mapped), light.env_ground.w > 0.5);
    return vec4<f32>(out_rgb, alpha);
}
"#;

/// WGSL mipmap generation: a fullscreen triangle that linearly samples the previous mip level
/// (bound as its own single-level view) into the next one.
pub const MIPMAP_BLIT_WGSL: &str = r#"
@group(0) @binding(0)
var src_level: texture_2d<f32>;

@group(0) @binding(1)
var src_sampler: sampler;

struct BlitOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_blit(@builtin(vertex_index) vi: u32) -> BlitOutput {
    // (0,0) (2,0) (0,2) in uv space covers the whole target
    let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    var out: BlitOutput;
    out.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}

@fragment
fn fs_blit(in: BlitOutput) -> @location(0) vec4<f32> {
    return textureSample(src_level, src_sampler, in.uv);
}
"#;

/// Shared WGSL prelude for screen-space chart marks: camera uniform + clip/pixel helpers.
const CHART_PRELUDE_WGSL: &str = r#"
struct CameraUniform {
    view_proj: mat4x4<f32>,
    camera_right: vec4<f32>,
    camera_up: vec4<f32>,
    // [width_px, height_px, pixel_ratio, 0] in physical pixels
    viewport: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

// Clip-space position of a world point (w clamped so points behind the eye never flip)
fn to_clip(p: vec3<f32>) -> vec4<f32> {
    let c = camera.view_proj * vec4<f32>(p, 1.0);
    return vec4<f32>(c.xyz, max(c.w, 1e-4));
}

// Clip position -> physical-pixel offset from the viewport center
fn clip_to_px(c: vec4<f32>) -> vec2<f32> {
    return (c.xy / c.w) * 0.5 * camera.viewport.xy;
}

fn px_to_ndc(px: vec2<f32>) -> vec2<f32> {
    return px / (0.5 * camera.viewport.xy);
}
"#;

/// Screen-space thick polyline segments: constant pixel width at any zoom, round joins/caps, 1px AA.
pub fn chart_line_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_LINE_BODY_WGSL}")
}

const CHART_LINE_BODY_WGSL: &str = r#"
struct SegmentInstance {
    @location(0) p0_width: vec4<f32>,
    @location(1) p1_pad: vec4<f32>,
    @location(2) color: vec4<f32>,
};

struct SegmentOut {
    @builtin(position) clip_position: vec4<f32>,
    // (distance along segment, signed distance across) in physical px
    @location(0) local: vec2<f32>,
    // (segment length px, half stroke width px)
    @location(1) dims: vec2<f32>,
    @location(2) color: vec4<f32>,
    // Dash length in physical px (0 = solid)
    @location(3) dash: f32,
};

@vertex
fn vs_segment(@builtin(vertex_index) vi: u32, inst: SegmentInstance) -> SegmentOut {
    // Quad corners: x = 0 (start) / 1 (end), y = -1 / +1 side
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let corner = corners[vi];

    let c0 = to_clip(inst.p0_width.xyz);
    let c1 = to_clip(inst.p1_pad.xyz);
    let s0 = clip_to_px(c0);
    let s1 = clip_to_px(c1);

    let delta = s1 - s0;
    let len = length(delta);
    var dir = vec2<f32>(1.0, 0.0);
    if (len > 1e-4) {
        dir = delta / len;
    }
    let normal = vec2<f32>(-dir.y, dir.x);

    let half_w = max(0.5 * inst.p0_width.w * camera.viewport.z, 0.5);
    // 1px margin around the capsule for anti-aliasing
    let ext = half_w + 1.0;

    let along = select(-ext, len + ext, corner.x > 0.5);
    let across = corner.y * ext;
    let px = s0 + dir * along + normal * across;

    let t = clamp(along / max(len, 1e-4), 0.0, 1.0);
    let z = mix(c0.z / c0.w, c1.z / c1.w, t);

    var out: SegmentOut;
    out.clip_position = vec4<f32>(px_to_ndc(px), z, 1.0);
    out.local = vec2<f32>(along, across);
    out.dims = vec2<f32>(len, half_w);
    out.color = inst.color;
    out.dash = max(inst.p1_pad.w, 0.0) * camera.viewport.z;
    return out;
}

@fragment
fn fs_segment(in: SegmentOut) -> @location(0) vec4<f32> {
    // Capsule distance: round caps double as round joins between consecutive segments
    let x = clamp(in.local.x, 0.0, in.dims.x);
    let d = length(vec2<f32>(in.local.x - x, in.local.y));
    var coverage = clamp(in.dims.y + 0.5 - d, 0.0, 1.0);
    if (in.dash > 0.0) {
        // Equal dashes and gaps from the segment start, anti-aliased at both dash ends
        let period = 2.0 * in.dash;
        let phase = in.local.x - floor(in.local.x / period) * period;
        coverage = coverage * clamp(min(phase, in.dash - phase) + 0.5, 0.0, 1.0);
    }
    if (coverage <= 0.0) {
        discard;
    }
    return vec4<f32>(in.color.rgb, in.color.a * coverage);
}
"#;

/// Screen-space circular markers with a separating ring (hover points).
pub fn chart_marker_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{MARKER_SD_WGSL}{CHART_MARKER_BODY_WGSL}")
}

/// Signed distance of the marker / point shapes (shared by the marker and scatter point shaders).
const MARKER_SD_WGSL: &str = r#"
// Signed distance (px, < 0 inside) of a marker of size `r` at `p` (+y up). Shapes are scaled
// to a similar visual weight as the circle of radius `r`.
fn marker_sd(p: vec2<f32>, r: f32, shape: f32) -> f32 {
    let a = abs(p);
    if (shape > 2.5) {
        // Equilateral triangle: circumradius 1.25 r, inradius 0.625 r
        return max(-p.y, 0.8660254 * a.x + 0.5 * p.y) - 0.625 * r;
    }
    if (shape > 1.5) {
        return (a.x + a.y - 1.2 * r) * 0.70710678;
    }
    if (shape > 0.5) {
        return max(a.x, a.y) - 0.85 * r;
    }
    return length(p) - r;
}
"#;

const CHART_MARKER_BODY_WGSL: &str = r#"
struct MarkerInstance {
    @location(0) center_radius: vec4<f32>,
    @location(1) fill: vec4<f32>,
    @location(2) ring: vec4<f32>,
    // [ring_width_css_px, shape, 0, 0]
    @location(3) params: vec4<f32>,
};

struct MarkerOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local: vec2<f32>,
    // (fill radius px, outer radius px)
    @location(1) radii: vec2<f32>,
    @location(2) fill: vec4<f32>,
    @location(3) ring: vec4<f32>,
    // 0 = circle, 1 = square, 2 = diamond, 3 = triangle (pointing up)
    @location(4) shape: f32,
};

@vertex
fn vs_marker(@builtin(vertex_index) vi: u32, inst: MarkerInstance) -> MarkerOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    let corner = corners[vi];
    let pr = camera.viewport.z;
    let r = inst.center_radius.w * pr;
    let outer = r + inst.params.x * pr;
    // Diamonds / triangles reach past the radius (see marker_sd)
    let ext = select(outer, outer * 1.25, inst.params.y > 0.5) + 1.0;

    let c = to_clip(inst.center_radius.xyz);
    let px = clip_to_px(c) + corner * ext;

    var out: MarkerOut;
    out.clip_position = vec4<f32>(px_to_ndc(px), 0.0, 1.0);
    out.local = corner * ext;
    out.radii = vec2<f32>(r, outer);
    out.fill = inst.fill;
    out.ring = inst.ring;
    out.shape = inst.params.y;
    return out;
}

@fragment
fn fs_marker(in: MarkerOut) -> @location(0) vec4<f32> {
    let coverage = clamp(0.5 - marker_sd(in.local, in.radii.y, in.shape), 0.0, 1.0);
    if (coverage <= 0.0) {
        discard;
    }
    let ring_mix = clamp(marker_sd(in.local, in.radii.x, in.shape) + 0.5, 0.0, 1.0);
    let c = mix(in.fill, in.ring, ring_mix);
    return vec4<f32>(c.rgb, c.a * coverage);
}
"#;

/// Dashed series polylines (chart/linestyle.rs): the thick-segment quad of `chart_line_wgsl`
/// with a `[on, off, on, off]` pattern whose phase continues from segment to segment (the
/// phase at each segment start is the cumulative CSS-px length computed on the CPU).
pub fn chart_dash_line_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_DASH_LINE_BODY_WGSL}")
}

const CHART_DASH_LINE_BODY_WGSL: &str = r#"
struct DashInstance {
    @location(0) p0_width: vec4<f32>,
    @location(1) p1_phase: vec4<f32>,
    @location(2) color: vec4<f32>,
    @location(3) dash: vec4<f32>,
};

struct DashOut {
    @builtin(position) clip_position: vec4<f32>,
    // (distance along segment, signed distance across) in physical px
    @location(0) local: vec2<f32>,
    // (segment length px, half stroke width px)
    @location(1) dims: vec2<f32>,
    @location(2) color: vec4<f32>,
    // [on, off, on, off] in physical px
    @location(3) dash: vec4<f32>,
    // Pattern phase at the segment start, physical px
    @location(4) phase: f32,
};

@vertex
fn vs_dash(@builtin(vertex_index) vi: u32, inst: DashInstance) -> DashOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let corner = corners[vi];

    let c0 = to_clip(inst.p0_width.xyz);
    let c1 = to_clip(inst.p1_phase.xyz);
    let s0 = clip_to_px(c0);
    let s1 = clip_to_px(c1);

    let delta = s1 - s0;
    let len = length(delta);
    var dir = vec2<f32>(1.0, 0.0);
    if (len > 1e-4) {
        dir = delta / len;
    }
    let normal = vec2<f32>(-dir.y, dir.x);

    let pr = camera.viewport.z;
    let half_w = max(0.5 * inst.p0_width.w * pr, 0.5);
    let ext = half_w + 1.0;

    let along = select(-ext, len + ext, corner.x > 0.5);
    let across = corner.y * ext;
    let px = s0 + dir * along + normal * across;

    let t = clamp(along / max(len, 1e-4), 0.0, 1.0);
    let z = mix(c0.z / c0.w, c1.z / c1.w, t);

    var out: DashOut;
    out.clip_position = vec4<f32>(px_to_ndc(px), z, 1.0);
    out.local = vec2<f32>(along, across);
    out.dims = vec2<f32>(len, half_w);
    out.color = inst.color;
    out.dash = max(inst.dash, vec4<f32>(0.0)) * pr;
    out.phase = inst.p1_phase.w * pr;
    return out;
}

// Anti-aliased coverage of position `p` by the dash interval [a, b)
fn dash_on(p: f32, a: f32, b: f32) -> f32 {
    if (b <= a) {
        return 0.0;
    }
    return clamp(min(p - a, b - p) + 0.5, 0.0, 1.0);
}

@fragment
fn fs_dash(in: DashOut) -> @location(0) vec4<f32> {
    let x = clamp(in.local.x, 0.0, in.dims.x);
    let d = length(vec2<f32>(in.local.x - x, in.local.y));
    var coverage = clamp(in.dims.y + 0.5 - d, 0.0, 1.0);
    let pat = in.dash;
    let period = pat.x + pat.y + pat.z + pat.w;
    if (period > 0.0) {
        let s = in.phase + in.local.x;
        let p = s - floor(s / period) * period;
        let c = pat.x + pat.y;
        // Both "on" intervals plus their neighbours across the period wrap (edge AA)
        let on = max(
            max(dash_on(p, 0.0, pat.x), dash_on(p, c, c + pat.z)),
            max(dash_on(p, period, period + pat.x), dash_on(p, c - period, c + pat.z - period)),
        );
        coverage = coverage * on;
    }
    if (coverage <= 0.0) {
        discard;
    }
    return vec4<f32>(in.color.rgb, in.color.a * coverage);
}
"#;

/// Instanced scatter points: px-sized anti-aliased circles with an optional separating ring.
/// The layer transform (zoom / pan) and per-series alpha (legend emphasis / visibility) are a
/// uniform, so points are uploaded only once. Vertices 0..6 draw the base pass, 6..12 the
/// emphasized series on top (second draw call, only while a series is emphasized).
pub fn chart_point_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{MARKER_SD_WGSL}{CHART_POINT_BODY_WGSL}")
}

const CHART_POINT_BODY_WGSL: &str = r#"
struct PointStyle {
    // [sx, sy, tx, ty]: world xy = base xy * s + t
    transform: vec4<f32>,
    ring_color: vec4<f32>,
    // [ring_width_css_px, emphasized_slot (< 0 = none), effect_time_s, 0]
    params: vec4<f32>,
    // Ripple: [period_s, scale, ring count, fill (1) / stroke (0)]
    effect: vec4<f32>,
    // Alpha multiplier of series slot s at [s / 4][s % 4]; 0 = hidden
    series_alpha: array<vec4<f32>, 64>,
};

@group(0) @binding(1)
var<uniform> point_style: PointStyle;

struct PointInstance {
    // [x, y, series_slot + 256 * (shape + 4 * ripple), radius_css_px] (shape: see marker_sd)
    @location(0) center_radius: vec4<f32>,
    @location(1) color: vec4<f32>,
};

struct PointOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local: vec2<f32>,
    // (fill radius px, outer radius px)
    @location(1) radii: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) shape: f32,
    // Rippling rings behind the point (0 / 1)
    @location(4) ripple: f32,
};

@vertex
fn vs_point(@builtin(vertex_index) vi: u32, inst: PointInstance) -> PointOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    let corner = corners[vi % 6u];
    let packed = max(inst.center_radius.z, 0.0);
    let slot = min(u32(packed) % 256u, 255u);
    let bits = floor(packed / 256.0);
    let shape = bits % 4.0;
    let ripple = select(0.0, 1.0, bits >= 4.0);
    let alpha = point_style.series_alpha[slot / 4u][slot % 4u];
    let emphasized = i32(slot) == i32(point_style.params.y);
    // Pass 0 skips the emphasized slot, pass 1 draws only it
    let in_pass = point_style.params.y < 0.0 || emphasized == (vi >= 6u);

    var out: PointOut;
    if (alpha <= 0.0 || !in_pass) {
        // Degenerate quad: no fragments for hidden series / the other pass
        out.clip_position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        out.local = vec2<f32>(0.0);
        out.radii = vec2<f32>(0.0);
        out.color = vec4<f32>(0.0);
        out.shape = 0.0;
        out.ripple = 0.0;
        return out;
    }

    let pr = camera.viewport.z;
    // Sub-pixel points still cover about one pixel
    let r = max(inst.center_radius.w * pr, 0.5);
    let outer = r + max(point_style.params.x, 0.0) * pr;
    // Diamonds / triangles reach past the radius (see marker_sd); ripples reach `scale` radii
    var ext = select(outer, outer * 1.25, shape > 0.5) + 1.0;
    if (ripple > 0.5) {
        ext = max(ext, r * max(point_style.effect.y, 1.0) * select(1.0, 1.25, shape > 0.5) + 2.0 * pr + 1.0);
    }

    let xy = inst.center_radius.xy * point_style.transform.xy + point_style.transform.zw;
    let c = to_clip(vec3<f32>(xy, 0.0));
    let px = clip_to_px(c) + corner * ext;

    out.clip_position = vec4<f32>(px_to_ndc(px), c.z / c.w, 1.0);
    out.local = corner * ext;
    out.radii = vec2<f32>(r, outer);
    out.color = vec4<f32>(inst.color.rgb, inst.color.a * min(alpha, 1.0));
    out.shape = shape;
    out.ripple = ripple;
    return out;
}

@fragment
fn fs_point(in: PointOut) -> @location(0) vec4<f32> {
    // Circles: 0.5 - (d - outer) and d - r + 0.5, as before the shapes
    let coverage = clamp(0.5 - marker_sd(in.local, in.radii.y, in.shape), 0.0, 1.0);
    var c = in.color;
    if (in.radii.y > in.radii.x) {
        let ring = vec4<f32>(point_style.ring_color.rgb, point_style.ring_color.a * in.color.a);
        c = mix(in.color, ring, clamp(marker_sd(in.local, in.radii.x, in.shape) + 0.5, 0.0, 1.0));
    }
    let a_point = c.a * coverage;
    // Ripple rings behind the point: each grows to `scale` radii and fades over one period
    var a_ripple = 0.0;
    if (in.ripple > 0.5) {
        let e = point_style.effect;
        let n = u32(clamp(e.z, 1.0, 8.0));
        let width = 1.5 * camera.viewport.z;
        for (var k = 0u; k < n; k = k + 1u) {
            let phase = fract(point_style.params.z / max(e.x, 0.1) + f32(k) / f32(n));
            let sd = marker_sd(in.local, in.radii.x * (1.0 + (max(e.y, 1.0) - 1.0) * phase), in.shape);
            let cov = select(clamp(0.5 * width + 0.5 - abs(sd), 0.0, 1.0), clamp(0.5 - sd, 0.0, 1.0) * 0.5, e.w > 0.5);
            a_ripple = max(a_ripple, cov * (1.0 - phase));
        }
        a_ripple = a_ripple * in.color.a;
    }
    // Point over its rings (straight alpha "over")
    let a = a_point + a_ripple * (1.0 - a_point);
    if (a <= 0.0) {
        discard;
    }
    let rgb = (c.rgb * a_point + in.color.rgb * a_ripple * (1.0 - a_point)) / a;
    return vec4<f32>(rgb, a);
}
"#;

/// Filled areas: world-space triangle list with per-vertex color (alpha blended); vertices tagged
/// in `position.w` follow the emphasis uniform (see renderer/fill_style.rs).
pub fn chart_fill_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_FILL_BODY_WGSL}")
}

const CHART_FILL_BODY_WGSL: &str = r#"
struct FillVertex {
    @location(0) position: vec4<f32>,
    @location(1) color: vec4<f32>,
};

struct FillOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

struct FillStyle {
    // [on, lit alpha boost, unlit alpha factor, unlit fade toward the surface]
    emphasis: vec4<f32>,
    surface: vec4<f32>,
    // [emphasized group key (0 = none), 0, 0, 0]
    key: vec4<f32>,
};

@group(0) @binding(1)
var<uniform> fill_style: FillStyle;

// Emphasis of a tagged vertex: tag = kind (1 = alpha, 2 = fade) | lit << 2 | group key << 3
fn fill_color(c: vec4<f32>, tag: f32) -> vec4<f32> {
    let code = u32(max(tag, 0.0) + 0.5);
    let e = fill_style.emphasis;
    if (code == 0u || e.x < 0.5) {
        return c;
    }
    let key = code >> 3u;
    let lit = (code & 4u) != 0u || (key != 0u && f32(key) == fill_style.key.x);
    if ((code & 1u) != 0u) {
        if (lit) {
            return vec4<f32>(c.rgb, min(c.a + e.y, 1.0));
        }
        return vec4<f32>(c.rgb, c.a * e.z);
    }
    if (lit) {
        return c;
    }
    return vec4<f32>(c.rgb + (fill_style.surface.rgb - c.rgb) * e.w, c.a);
}

@vertex
fn vs_fill(v: FillVertex) -> FillOut {
    var out: FillOut;
    out.clip_position = camera.view_proj * vec4<f32>(v.position.xyz, 1.0);
    out.color = fill_color(v.color, v.position.w);
    return out;
}

@fragment
fn fs_fill(in: FillOut) -> @location(0) vec4<f32> {
    if (in.color.a <= 0.0) { discard; }
    return in.color;
}
"#;

/// Flat 2D bars with pixel-sized rounded corners on the data end (top / bottom, or right / left
/// for horizontal bars).
pub fn chart_bar_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_BAR_BODY_WGSL}")
}

const CHART_BAR_BODY_WGSL: &str = r#"
struct BarInstance {
    @location(0) rect: vec4<f32>,
    @location(1) z_radius: vec4<f32>,
    @location(2) color: vec4<f32>,
};

struct BarOut {
    @builtin(position) clip_position: vec4<f32>,
    // Position inside the bar in physical px from its bottom-left corner
    @location(0) local_px: vec2<f32>,
    // (bar width px, bar height px, corner radius px, rounded end) after the gap trim
    @location(1) dims: vec4<f32>,
    @location(2) color: vec4<f32>,
    // Px trimmed off each side (grouped gap) and off the data end (stack gap)
    @location(3) trim: vec2<f32>,
};

@vertex
fn vs_bar(@builtin(vertex_index) vi: u32, inst: BarInstance) -> BarOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let corner = corners[vi];
    let z = inst.z_radius.x;
    let p00 = clip_to_px(to_clip(vec3<f32>(inst.rect.x, inst.rect.y, z)));
    let p11 = clip_to_px(to_clip(vec3<f32>(inst.rect.z, inst.rect.w, z)));
    var size = abs(p11 - p00);

    let world = vec3<f32>(mix(inst.rect.x, inst.rect.z, corner.x), mix(inst.rect.y, inst.rect.w, corner.y), z);
    var out: BarOut;
    out.clip_position = camera.view_proj * vec4<f32>(world, 1.0);
    out.local_px = corner * size;
    // Horizontal bars (rounded end +-2 = right / left): work in transposed px so the data end is
    // "up" and the thickness "across", like vertical bars
    if (abs(inst.z_radius.z) > 1.5) {
        size = size.yx;
        out.local_px = out.local_px.yx;
    }
    // Gaps are cut in px so they stay crisp at any zoom; never trim a bar away entirely
    let gap = inst.z_radius.w * camera.viewport.z;
    let side = clamp(-gap * 0.5, 0.0, size.x * 0.25);
    let end = clamp(gap, 0.0, size.y * 0.5);
    let inner = vec2<f32>(size.x - 2.0 * side, size.y - end);
    let radius = min(inst.z_radius.y * camera.viewport.z, min(inner.x * 0.5, inner.y));
    out.dims = vec4<f32>(inner, radius, inst.z_radius.z);
    out.color = inst.color;
    out.trim = vec2<f32>(side, end);
    return out;
}

@fragment
fn fs_bar(in: BarOut) -> @location(0) vec4<f32> {
    let w = in.dims.x;
    let h = in.dims.y;
    let r = in.dims.z;
    var p = in.local_px - vec2<f32>(in.trim.x, 0.0);
    // Mirror so the rounded data end is always at the top (trimmed gap above `h`)
    if (in.dims.w < 0.0) {
        p.y = h + in.trim.y - p.y;
    }
    if (p.x < 0.0 || p.x > w || p.y > h) {
        discard;
    }
    var coverage = 1.0;
    if (r > 0.5 && p.y > h - r && (p.x < r || p.x > w - r)) {
        let c = vec2<f32>(clamp(p.x, r, w - r), h - r);
        coverage = clamp(r + 0.5 - length(p - c), 0.0, 1.0);
    }
    if (coverage <= 0.0) {
        discard;
    }
    return vec4<f32>(in.color.rgb, in.color.a * coverage);
}
"#;

/// Heatmap: ONE quad over the plot. The fragment shader finds the cell under the pixel from the
/// zoom window (nearest: cells stay crisp at any zoom), fetches its value from the row-major
/// value texture (wrapped at `grid.z` texels per row), normalizes it with the uniform scale
/// (mirrors `chart::ValueScale::normalize`) and looks the color up in the 256 x 1 LUT.
pub fn chart_heatmap_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_HEATMAP_BODY_WGSL}")
}

const CHART_HEATMAP_BODY_WGSL: &str = r#"
struct HeatmapStyle {
    // World rect of the plot [x0, y0, x1, y1]
    rect: vec4<f32>,
    // Visible part of the grid, normalized [x0, x1, y0, y1] (y from the bottom)
    window: vec4<f32>,
    // [cols, rows, texture width, row 0 at the top (1)]
    grid: vec4<u32>,
    // [lo, hi, center, diverging (1)]
    scale: vec4<f32>,
    // Empty (NaN) cell color
    empty: vec4<f32>,
};

@group(0) @binding(1)
var<uniform> heatmap: HeatmapStyle;
@group(0) @binding(2)
var heatmap_values: texture_2d<f32>;
@group(0) @binding(3)
var heatmap_lut: texture_2d<f32>;

struct HeatmapOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_heatmap(@builtin(vertex_index) vi: u32) -> HeatmapOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let c = corners[vi % 6u];
    let r = heatmap.rect;
    var out: HeatmapOut;
    out.clip_position = camera.view_proj * vec4<f32>(mix(r.x, r.z, c.x), mix(r.y, r.w, c.y), 0.0, 1.0);
    out.uv = c;
    return out;
}

// Clamped ramp of v over [a, b]; `flat` when the span is empty
fn heatmap_ramp(v: f32, a: f32, b: f32, flat: f32) -> f32 {
    if (b > a) {
        return clamp((v - a) / (b - a), 0.0, 1.0);
    }
    return flat;
}

@fragment
fn fs_heatmap(in: HeatmapOut) -> @location(0) vec4<f32> {
    let w = heatmap.window;
    let tx = mix(w.x, w.y, in.uv.x);
    let ty = mix(w.z, w.w, in.uv.y);
    let cols = max(heatmap.grid.x, 1u);
    let rows = max(heatmap.grid.y, 1u);
    let col = min(u32(max(tx * f32(cols), 0.0)), cols - 1u);
    var row = min(u32(max(ty * f32(rows), 0.0)), rows - 1u);
    if (heatmap.grid.w == 1u) {
        row = rows - 1u - row;
    }
    let idx = row * cols + col;
    let tw = max(heatmap.grid.z, 1u);
    let texel = vec2<u32>(idx % tw, idx / tw);
    if (texel.y >= textureDimensions(heatmap_values).y) {
        // Beyond the device texture limit (grid truncated)
        return heatmap.empty;
    }
    let v = textureLoad(heatmap_values, vec2<i32>(texel), 0).r;
    // NaN / infinity: all exponent bits set (bit test survives fast-math NaN folding)
    if ((bitcast<u32>(v) & 0x7f800000u) == 0x7f800000u) {
        return heatmap.empty;
    }
    let s = heatmap.scale;
    var t: f32;
    if (s.w > 0.5) {
        if (v < s.z) {
            t = 0.5 * heatmap_ramp(v, s.x, s.z, 0.0);
        } else if (v > s.z) {
            t = 0.5 + 0.5 * heatmap_ramp(v, s.z, s.y, 1.0);
        } else {
            t = 0.5;
        }
    } else {
        t = heatmap_ramp(v, s.x, s.y, 0.5);
    }
    let i = min(i32(t * 255.0 + 0.5), 255);
    return textureLoad(heatmap_lut, vec2<i32>(i, 0), 0);
}
"#;

/// Parallel coordinates polylines: `vs_segment` geometry plus a per-row flag texture read in the
/// vertex stage (`p1_pad.w` = row). Vertices 0..6 draw the inactive (brushed-out, dimmed) rows,
/// 6..12 the active ones, so two draws layer active rows over inactive ones; hidden rows collapse.
pub fn chart_parallel_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_LINE_BODY_WGSL}{CHART_PARALLEL_BODY_WGSL}")
}

const CHART_PARALLEL_BODY_WGSL: &str = r#"
struct ParallelStyle {
    // Inactive rows: rgb mixed into the row color by a
    inactive: vec4<f32>,
    // [inactive opacity, brushed (1), flag texture width, layer opacity]
    params: vec4<f32>,
};

@group(0) @binding(1)
var<uniform> parallel: ParallelStyle;
@group(0) @binding(2)
var parallel_flags: texture_2d<f32>;

// Row flag: 1 = active, 0 = brushed out, -1 = hidden (rows beyond the texture read as active)
fn parallel_flag(row: u32) -> f32 {
    let tw = max(u32(parallel.params.z), 1u);
    let texel = vec2<u32>(row % tw, row / tw);
    if (texel.y >= textureDimensions(parallel_flags).y) {
        return 1.0;
    }
    return textureLoad(parallel_flags, vec2<i32>(texel), 0).r;
}

@vertex
fn vs_parallel(@builtin(vertex_index) vi: u32, inst: SegmentInstance) -> SegmentOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let corner = corners[vi % 6u];
    let flag = parallel_flag(u32(max(inst.p1_pad.w, 0.0)));
    let live = flag > 0.5;
    // Pass 0 (vertices 0..6) draws inactive rows, pass 1 (6..12) active ones
    let drawn = flag > -0.5 && (live == (vi >= 6u));

    let c0 = to_clip(inst.p0_width.xyz);
    let c1 = to_clip(inst.p1_pad.xyz);
    let s0 = clip_to_px(c0);
    let s1 = clip_to_px(c1);
    let delta = s1 - s0;
    let len = length(delta);
    var dir = vec2<f32>(1.0, 0.0);
    if (len > 1e-4) {
        dir = delta / len;
    }
    let normal = vec2<f32>(-dir.y, dir.x);
    let half_w = max(0.5 * inst.p0_width.w * camera.viewport.z, 0.5);
    let ext = half_w + 1.0;
    let along = select(-ext, len + ext, corner.x > 0.5);
    let across = corner.y * ext;
    let px = s0 + dir * along + normal * across;
    let t = clamp(along / max(len, 1e-4), 0.0, 1.0);
    let z = mix(c0.z / c0.w, c1.z / c1.w, t);

    var color = inst.color;
    if (!live) {
        let k = clamp(parallel.inactive.a, 0.0, 1.0);
        color = vec4<f32>(mix(color.rgb, parallel.inactive.rgb, k), color.a * clamp(parallel.params.x, 0.0, 1.0));
    }
    color.a = color.a * clamp(parallel.params.w, 0.0, 1.0);

    var out: SegmentOut;
    out.clip_position = vec4<f32>(px_to_ndc(px), z, 1.0);
    if (!drawn) {
        // Collapse the quad (zero area: nothing rasterized)
        out.clip_position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    }
    out.local = vec2<f32>(along, across);
    out.dims = vec2<f32>(len, half_w);
    out.color = color;
    out.dash = 0.0;
    return out;
}
"#;

/// Decal pass over the bars (chart/decal.rs): the bar instance plus its decal, cut like
/// `fs_bar` and tiled with the decal symbol in screen space.
pub fn chart_bar_decal_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_DECAL_COMMON_WGSL}{CHART_BAR_DECAL_BODY_WGSL}")
}

/// Decal pass over the fill triangles: the fill vertex plus its decal; the decal color follows
/// the fill emphasis uniform like `fs_fill`.
pub fn chart_fill_decal_wgsl() -> String {
    format!("{CHART_PRELUDE_WGSL}{CHART_FILL_BODY_WGSL}{CHART_DECAL_COMMON_WGSL}{CHART_FILL_DECAL_BODY_WGSL}")
}

const CHART_DECAL_COMMON_WGSL: &str = r#"
// Decal paint over a mark of color `base`: `dc.r < 0` = auto contrast (black on light marks,
// white on dark ones); alpha = opacity * the mark's alpha (chart/decal.rs `decal_paint`)
fn decal_paint(base: vec4<f32>, dc: vec4<f32>) -> vec4<f32> {
    var rgb = dc.rgb;
    if (dc.r < 0.0) {
        let lum = dot(base.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        rgb = select(vec3<f32>(1.0), vec3<f32>(0.0), lum > 0.5);
    }
    return vec4<f32>(rgb, dc.a * base.a);
}

fn decal_symbol(pat: vec4<f32>) -> u32 {
    return u32(max(pat.x, 0.0) + 0.5);
}

// Coverage of the decal symbol at framebuffer pixel `px`: the symbol is centered in square
// cells of `spacing` CSS px tiled from the canvas top-left, rotated by `rotation` about it
// (pattern [symbol, size, spacing, rotation]; mirrored by chart/svg.rs `svg_pattern`)
fn decal_coverage(px: vec2<f32>, pat: vec4<f32>) -> f32 {
    let symbol = decal_symbol(pat);
    if (symbol == 0u) {
        return 0.0;
    }
    let pr = camera.viewport.z;
    let cell = max(pat.z * pr, 1.0);
    let cs = cos(pat.w);
    let sn = sin(pat.w);
    let q = vec2<f32>(cs * px.x + sn * px.y, cs * px.y - sn * px.x);
    let l = (fract(q / cell) - vec2<f32>(0.5)) * cell;
    let a = abs(l);
    let r = 0.5 * pat.y * pr;
    var d = 0.0;
    switch symbol {
        case 1u: {
            d = max(a.x, a.y) - r;
        }
        case 2u: {
            d = length(l) - r;
        }
        case 3u: {
            d = max(a.x * 0.8660254 - l.y * 0.5, l.y) - 0.5 * r;
        }
        case 4u: {
            d = (a.x + a.y - r) * 0.70710678;
        }
        case 5u: {
            d = a.y - r;
        }
        default: {
            let t = max(0.5 * pr, 0.25 * r);
            d = min(max(a.x - r, a.y - t), max(a.y - r, a.x - t));
        }
    }
    return clamp(0.5 - d, 0.0, 1.0);
}
"#;

const CHART_BAR_DECAL_BODY_WGSL: &str = r#"
struct BarDecalInstance {
    @location(0) rect: vec4<f32>,
    @location(1) z_radius: vec4<f32>,
    @location(2) color: vec4<f32>,
    @location(3) pattern: vec4<f32>,
    @location(4) decal_color: vec4<f32>,
};

struct BarDecalOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_px: vec2<f32>,
    @location(1) dims: vec4<f32>,
    @location(2) color: vec4<f32>,
    @location(3) trim: vec2<f32>,
    @location(4) pattern: vec4<f32>,
};

// Same quad, gap trim and corner radius as `vs_bar`
@vertex
fn vs_bar_decal(@builtin(vertex_index) vi: u32, inst: BarDecalInstance) -> BarDecalOut {
    var out: BarDecalOut;
    out.pattern = inst.pattern;
    if (decal_symbol(inst.pattern) == 0u) {
        // Undecorated bar: degenerate triangles, no fragments
        out.clip_position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        return out;
    }
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let corner = corners[vi];
    let z = inst.z_radius.x;
    let p00 = clip_to_px(to_clip(vec3<f32>(inst.rect.x, inst.rect.y, z)));
    let p11 = clip_to_px(to_clip(vec3<f32>(inst.rect.z, inst.rect.w, z)));
    var size = abs(p11 - p00);
    let world = vec3<f32>(mix(inst.rect.x, inst.rect.z, corner.x), mix(inst.rect.y, inst.rect.w, corner.y), z);
    out.clip_position = camera.view_proj * vec4<f32>(world, 1.0);
    out.local_px = corner * size;
    if (abs(inst.z_radius.z) > 1.5) {
        size = size.yx;
        out.local_px = out.local_px.yx;
    }
    let gap = inst.z_radius.w * camera.viewport.z;
    let side = clamp(-gap * 0.5, 0.0, size.x * 0.25);
    let end = clamp(gap, 0.0, size.y * 0.5);
    let inner = vec2<f32>(size.x - 2.0 * side, size.y - end);
    let radius = min(inst.z_radius.y * camera.viewport.z, min(inner.x * 0.5, inner.y));
    out.dims = vec4<f32>(inner, radius, inst.z_radius.z);
    out.color = decal_paint(inst.color, inst.decal_color);
    out.trim = vec2<f32>(side, end);
    return out;
}

// `fs_bar`'s coverage times the symbol's
@fragment
fn fs_bar_decal(in: BarDecalOut) -> @location(0) vec4<f32> {
    let w = in.dims.x;
    let h = in.dims.y;
    let r = in.dims.z;
    var p = in.local_px - vec2<f32>(in.trim.x, 0.0);
    if (in.dims.w < 0.0) {
        p.y = h + in.trim.y - p.y;
    }
    if (p.x < 0.0 || p.x > w || p.y > h) {
        discard;
    }
    var coverage = 1.0;
    if (r > 0.5 && p.y > h - r && (p.x < r || p.x > w - r)) {
        let c = vec2<f32>(clamp(p.x, r, w - r), h - r);
        coverage = clamp(r + 0.5 - length(p - c), 0.0, 1.0);
    }
    let a = in.color.a * coverage * decal_coverage(in.clip_position.xy, in.pattern);
    if (a <= 0.0) {
        discard;
    }
    return vec4<f32>(in.color.rgb, a);
}
"#;

const CHART_FILL_DECAL_BODY_WGSL: &str = r#"
struct FillDecalVertex {
    @location(0) position: vec4<f32>,
    @location(1) color: vec4<f32>,
    @location(2) pattern: vec4<f32>,
    @location(3) decal_color: vec4<f32>,
};

struct FillDecalOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) pattern: vec4<f32>,
};

@vertex
fn vs_fill_decal(v: FillDecalVertex) -> FillDecalOut {
    var out: FillDecalOut;
    out.pattern = v.pattern;
    if (decal_symbol(v.pattern) == 0u) {
        out.clip_position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        return out;
    }
    out.clip_position = camera.view_proj * vec4<f32>(v.position.xyz, 1.0);
    out.color = fill_color(decal_paint(v.color, v.decal_color), v.position.w);
    return out;
}

@fragment
fn fs_fill_decal(in: FillDecalOut) -> @location(0) vec4<f32> {
    let a = in.color.a * decal_coverage(in.clip_position.xy, in.pattern);
    if (a <= 0.0) {
        discard;
    }
    return vec4<f32>(in.color.rgb, a);
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decal_shaders_translate_to_webgl2_glsl() {
        // Symbol switch, fract tiling and the fill emphasis uniform must survive GLSL ES 3.00
        use naga::back::glsl;
        for (src, vs, fs) in [
            (chart_bar_decal_wgsl(), "vs_bar_decal", "fs_bar_decal"),
            (chart_fill_decal_wgsl(), "vs_fill_decal", "fs_fill_decal"),
        ] {
            let module = naga::front::wgsl::parse_str(&src).unwrap_or_else(|e| panic!("{}", e.emit_to_string(&src)));
            let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
                .validate(&module)
                .unwrap();
            let options = glsl::Options { version: glsl::Version::Embedded { version: 300, is_webgl: true }, ..Default::default() };
            for (stage, entry) in [(naga::ShaderStage::Vertex, vs), (naga::ShaderStage::Fragment, fs)] {
                let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
                let mut out = String::new();
                glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                    .and_then(|mut w| w.write())
                    .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
                assert!(out.contains("#version 300 es"));
                if stage == naga::ShaderStage::Fragment {
                    assert!(out.contains("gl_FragCoord"), "{entry}: tiles in screen space");
                }
            }
        }
    }

    #[test]
    fn shader_sources_define_expected_entry_points() {
        assert!(NODE_BILLBOARD_WGSL.contains("fn vs_node"));
        assert!(NODE_BILLBOARD_WGSL.contains("fn fs_node"));
        assert!(EDGE_LINE_WGSL.contains("fn vs_edge"));
        assert!(EDGE_LINE_WGSL.contains("fn fs_edge"));
        assert!(MESH_LIT_WGSL.contains("fn vs_mesh"));
        assert!(MESH_LIT_WGSL.contains("fn fs_mesh"));
        assert!(chart_line_wgsl().contains("fn vs_segment"));
        assert!(chart_marker_wgsl().contains("fn fs_marker"));
        assert!(chart_dash_line_wgsl().contains("fn fs_dash"));
        assert!(chart_bar_wgsl().contains("fn fs_bar"));
        assert!(chart_point_wgsl().contains("fn vs_point"));
        assert!(chart_fill_wgsl().contains("fn fs_fill"));
        assert!(chart_heatmap_wgsl().contains("fn fs_heatmap"));
    }

    #[test]
    fn resident_graph_shaders_read_positions_from_the_gpu_layout() {
        for src in [node_billboard_resident_wgsl(), edge_line_resident_wgsl()] {
            assert!(src.contains("var<storage, read> layout_state: array<LayoutState>"));
            assert!(src.contains("layout_state[u32("), "positions must come from the layout buffer");
        }
    }

    #[test]
    fn every_shader_parses_and_validates() {
        let sources = [
            ("node", NODE_BILLBOARD_WGSL.to_string()),
            ("edge", EDGE_LINE_WGSL.to_string()),
            ("mesh", MESH_LIT_WGSL.to_string()),
            ("mesh-pbr", mesh_pbr_wgsl()),
            ("mipmap-blit", MIPMAP_BLIT_WGSL.to_string()),
            ("chart-line", chart_line_wgsl()),
            ("chart-marker", chart_marker_wgsl()),
            ("chart-dash-line", chart_dash_line_wgsl()),
            ("chart-bar", chart_bar_wgsl()),
            ("chart-point", chart_point_wgsl()),
            ("chart-fill", chart_fill_wgsl()),
            ("chart-heatmap", chart_heatmap_wgsl()),
            ("node-resident", node_billboard_resident_wgsl()),
            ("edge-resident", edge_line_resident_wgsl()),
        ];
        for (name, src) in sources {
            let module = naga::front::wgsl::parse_str(&src)
                .unwrap_or_else(|e| panic!("{name}: {}", e.emit_to_string(&src)));
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::empty(),
            )
            .validate(&module)
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
    }

    #[test]
    fn point_shader_translates_to_webgl2_glsl() {
        // Per-series alpha indexes a uniform array dynamically: must survive GLSL ES 3.00
        use naga::back::glsl;
        let src = chart_point_wgsl();
        let module = naga::front::wgsl::parse_str(&src).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        let options = glsl::Options {
            version: glsl::Version::Embedded { version: 300, is_webgl: true },
            ..Default::default()
        };
        for (stage, entry) in [(naga::ShaderStage::Vertex, "vs_point"), (naga::ShaderStage::Fragment, "fs_point")] {
            let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
            let mut out = String::new();
            glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .and_then(|mut w| w.write())
                .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
            assert!(out.contains("#version 300 es"));
        }
    }

    #[test]
    fn mesh_and_mipmap_shaders_translate_to_webgl2_glsl() {
        // Base-color texture sampling + alpha-test discard (mesh) and the mip blit must
        // survive GLSL ES 3.00
        use naga::back::glsl;
        let shaders = [
            (MESH_LIT_WGSL, ["vs_mesh", "fs_mesh"]),
            (MIPMAP_BLIT_WGSL, ["vs_blit", "fs_blit"]),
        ];
        for (src, [vs, fs]) in shaders {
            let module = naga::front::wgsl::parse_str(src).unwrap();
            let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
                .validate(&module)
                .unwrap();
            let options = glsl::Options {
                version: glsl::Version::Embedded { version: 300, is_webgl: true },
                ..Default::default()
            };
            for (stage, entry) in [(naga::ShaderStage::Vertex, vs), (naga::ShaderStage::Fragment, fs)] {
                let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
                let mut out = String::new();
                glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                    .and_then(|mut w| w.write())
                    .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
                assert!(out.contains("#version 300 es"));
                if stage == naga::ShaderStage::Fragment {
                    assert!(out.contains("texture("), "{entry}: filtered texture sample");
                }
                if entry == "fs_mesh" {
                    assert!(out.contains("discard"), "alpha test");
                }
            }
        }
    }

    #[test]
    fn pbr_mesh_shader_translates_to_webgl2_glsl() {
        // Env map sampled with an explicit lod (non-uniform control flow is fine), tone mapping
        // and sRGB encode must survive GLSL ES 3.00; the classic entry point stays env-free
        use naga::back::glsl;
        let src = mesh_pbr_wgsl();
        let module = naga::front::wgsl::parse_str(&src).unwrap_or_else(|e| panic!("{}", e.emit_to_string(&src)));
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        let options = glsl::Options { version: glsl::Version::Embedded { version: 300, is_webgl: true }, ..Default::default() };
        let write = |stage, entry: &str| {
            let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
            let mut out = String::new();
            glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .and_then(|mut w| w.write())
                .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
            out
        };
        assert!(write(naga::ShaderStage::Vertex, "vs_mesh").contains("#version 300 es"));
        let fs = write(naga::ShaderStage::Fragment, "fs_mesh_pbr");
        assert!(fs.contains("textureLod("), "env map sampled at an explicit mip");
        assert!(fs.contains("discard"), "alpha test");
        assert!(fs.contains("_group_2_binding_0_fs"), "env map bound in group 2: {fs}");
        let classic = write(naga::ShaderStage::Fragment, "fs_mesh");
        assert!(!classic.contains("_group_2_"), "classic fragment stage has no env binding");
    }

    #[test]
    fn classic_mesh_shader_text_is_untouched_by_pbr() {
        // The PBR module only swaps the light struct and appends its own entry point
        let pbr = mesh_pbr_wgsl();
        assert!(pbr.contains(MESH_LIGHT_STRUCT_PBR) && !pbr.contains(MESH_LIGHT_STRUCT_CLASSIC));
        assert!(pbr.ends_with(MESH_PBR_BODY_WGSL));
        assert_eq!(
            pbr.trim_end_matches(MESH_PBR_BODY_WGSL).replacen(MESH_LIGHT_STRUCT_PBR, MESH_LIGHT_STRUCT_CLASSIC, 1),
            MESH_LIT_WGSL
        );
        assert!(!MESH_LIT_WGSL.contains("env_map"));
        // Uniform layout: struct fields match `SceneLightUniformRaw` (6 x vec4)
        assert_eq!(MESH_LIGHT_STRUCT_PBR.matches("vec4<f32>").count() * 16, std::mem::size_of::<super::super::SceneLightUniformRaw>());
    }

    #[test]
    fn heatmap_shader_translates_to_webgl2_glsl() {
        // Integer texel fetches (value grid + LUT) and the NaN bit test must survive GLSL ES 3.00
        use naga::back::glsl;
        let src = chart_heatmap_wgsl();
        let module = naga::front::wgsl::parse_str(&src).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        let options = glsl::Options {
            version: glsl::Version::Embedded { version: 300, is_webgl: true },
            ..Default::default()
        };
        for (stage, entry) in [(naga::ShaderStage::Vertex, "vs_heatmap"), (naga::ShaderStage::Fragment, "fs_heatmap")] {
            let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
            let mut out = String::new();
            glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .and_then(|mut w| w.write())
                .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
            assert!(out.contains("#version 300 es"));
            if stage == naga::ShaderStage::Fragment {
                assert!(out.contains("texelFetch"), "nearest texel fetch, no sampler");
                assert!(out.contains("floatBitsToUint"));
            }
        }
    }

    #[test]
    fn dash_and_marker_shaders_translate_to_webgl2_glsl() {
        use naga::back::glsl;
        let shaders = [
            (chart_dash_line_wgsl(), ["vs_dash", "fs_dash"]),
            (chart_marker_wgsl(), ["vs_marker", "fs_marker"]),
        ];
        for (src, [vs, fs]) in shaders {
            let module = naga::front::wgsl::parse_str(&src).unwrap();
            let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
                .validate(&module)
                .unwrap();
            let options = glsl::Options {
                version: glsl::Version::Embedded { version: 300, is_webgl: true },
                ..Default::default()
            };
            for (stage, entry) in [(naga::ShaderStage::Vertex, vs), (naga::ShaderStage::Fragment, fs)] {
                let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
                let mut out = String::new();
                glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                    .and_then(|mut w| w.write())
                    .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
                assert!(out.contains("#version 300 es"));
            }
        }
    }

    #[test]
    fn parallel_shader_validates_and_reads_row_flags_in_webgl2_glsl() {
        // Row flags come from a texture fetched in the vertex stage: must survive GLSL ES 3.00
        use naga::back::glsl;
        let src = chart_parallel_wgsl();
        assert!(src.contains("fn vs_parallel") && src.contains("fn fs_segment"));
        let module = naga::front::wgsl::parse_str(&src).unwrap_or_else(|e| panic!("{}", e.emit_to_string(&src)));
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        let options = glsl::Options {
            version: glsl::Version::Embedded { version: 300, is_webgl: true },
            ..Default::default()
        };
        for (stage, entry) in [(naga::ShaderStage::Vertex, "vs_parallel"), (naga::ShaderStage::Fragment, "fs_segment")] {
            let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
            let mut out = String::new();
            glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .and_then(|mut w| w.write())
                .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
            assert!(out.contains("#version 300 es"));
            if stage == naga::ShaderStage::Vertex {
                assert!(out.contains("texelFetch"), "row flag fetched per vertex");
            }
        }
    }
}
