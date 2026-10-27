use crate::renderer::{EdgeVertexRaw, MeshDraw, MeshInstanceRaw, MeshVertexRaw, SceneLightUniformRaw};
use crate::spatial::Ray;
use collision::Collider;
use glam::{Mat3, Mat4, Quat, Vec3};
use std::f32::consts::{PI, TAU};

mod collision;
#[cfg(test)]
mod collision_tests;
mod dynamics;

/// Primitive 3D shape types supported natively by the scene engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PrimitiveKind {
    Box = 0,
    Sphere = 1,
    Plane = 2,
    Cylinder = 3,
}

impl PrimitiveKind {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Box,
            1 => Self::Sphere,
            2 => Self::Plane,
            3 => Self::Cylinder,
            _ => Self::Box,
        }
    }
}

/// Rigid body simulation behavior for a 3D scene object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BodyType {
    Static = 0,
    Dynamic = 1,
    Kinematic = 2,
}

impl BodyType {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Static,
            1 => Self::Dynamic,
            2 => Self::Kinematic,
            _ => Self::Static,
        }
    }
}

/// Local-space vertex with position and unit normal.
#[derive(Debug, Clone, Copy)]
pub struct LocalVertex {
    pub position: Vec3,
    pub normal: Vec3,
}

/// Geometry representation for a `SceneObject`.
#[derive(Debug, Clone)]
pub enum SceneGeometry {
    Primitive(PrimitiveKind),
    Custom {
        vertices: Vec<LocalVertex>,
        indices: Vec<u32>,
        local_half_extents: Vec3,
    },
}

/// 3D Transform with position, Euler/Quaternion rotation, scale, and optional parent object ID.
#[derive(Debug, Clone, Copy)]
pub struct Transform {
    pub position: Vec3,
    pub euler_radians: Vec3,
    pub scale: Vec3,
    pub parent_id: Option<u32>,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
            euler_radians: Vec3::ZERO,
            scale: Vec3::ONE,
            parent_id: None,
        }
    }
}

impl Transform {
    pub fn rotation_quat(&self) -> Quat {
        Quat::from_euler(
            glam::EulerRot::YXZ,
            self.euler_radians.y,
            self.euler_radians.x,
            self.euler_radians.z,
        )
    }

    pub fn local_matrix(&self) -> Mat4 {
        Mat4::from_scale_rotation_translation(self.scale, self.rotation_quat(), self.position)
    }
}

/// Surface material properties for 3D lit shading.
#[derive(Debug, Clone, Copy)]
pub struct Material {
    pub color: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub emissive: f32,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            color: [0.35, 0.65, 0.95, 1.0],
            metallic: 0.15,
            roughness: 0.45,
            emissive: 0.0,
        }
    }
}

/// Rigid body state attached to a `SceneObject`.
#[derive(Debug, Clone, Copy)]
pub struct RigidBody {
    pub body_type: BodyType,
    pub velocity: Vec3,
    /// World-space angular velocity in radians per second.
    pub angular_velocity: Vec3,
    pub mass: f32,
    pub restitution: f32,
    pub friction: f32,
}

impl Default for RigidBody {
    fn default() -> Self {
        Self {
            body_type: BodyType::Static,
            velocity: Vec3::ZERO,
            angular_velocity: Vec3::ZERO,
            mass: 1.0,
            restitution: 0.55,
            friction: 0.85,
        }
    }
}

/// A 3D entity inside `SceneWorld`.
#[derive(Debug, Clone)]
pub struct SceneObject {
    pub id: u32,
    pub transform: Transform,
    pub geometry: SceneGeometry,
    pub material: Material,
    pub body: RigidBody,
    pub selected: bool,
    pub visible: bool,
}

impl SceneObject {
    /// Local-space half extents before scaling.
    pub fn base_half_extents(&self) -> Vec3 {
        match &self.geometry {
            SceneGeometry::Primitive(PrimitiveKind::Box) => Vec3::splat(0.5),
            SceneGeometry::Primitive(PrimitiveKind::Sphere) => Vec3::splat(0.5),
            SceneGeometry::Primitive(PrimitiveKind::Plane) => Vec3::new(0.5, 0.02, 0.5),
            SceneGeometry::Primitive(PrimitiveKind::Cylinder) => Vec3::splat(0.5),
            SceneGeometry::Custom {
                local_half_extents, ..
            } => *local_half_extents,
        }
    }

    /// World-space approximate half extents for broad-phase physics & AABB bounds.
    pub fn world_half_extents(&self) -> Vec3 {
        (self.base_half_extents() * self.transform.scale.abs()).max(Vec3::splat(0.05))
    }

    /// Intersects a world-space ray with this object using its world transform matrix.
    /// Returns the positive ray parameter `t` along `ray.direction` if hit.
    pub fn intersect_ray(&self, world_matrix: &Mat4, ray: &Ray) -> Option<f32> {
        if !self.visible {
            return None;
        }
        let inv_mat = world_matrix.inverse();
        let local_origin = inv_mat.transform_point3(ray.origin);
        let local_dir_unnorm = inv_mat.transform_vector3(ray.direction);
        let dir_len = local_dir_unnorm.length();
        if dir_len < 1e-6 {
            return None;
        }
        let local_dir = local_dir_unnorm / dir_len;

        let local_t = match &self.geometry {
            SceneGeometry::Primitive(PrimitiveKind::Sphere) => {
                intersect_local_sphere(local_origin, local_dir, 0.5)
            }
            SceneGeometry::Primitive(PrimitiveKind::Plane) => {
                intersect_local_plane(local_origin, local_dir)
            }
            SceneGeometry::Primitive(PrimitiveKind::Box | PrimitiveKind::Cylinder) => {
                intersect_local_aabb(local_origin, local_dir, Vec3::splat(0.5))
            }
            SceneGeometry::Custom {
                vertices,
                indices,
                local_half_extents,
            } => {
                // Broad-phase AABB check first
                intersect_local_aabb(
                    local_origin,
                    local_dir,
                    (*local_half_extents).max(Vec3::splat(0.1)),
                )?;
                intersect_local_triangles(local_origin, local_dir, vertices, indices)
            }
        }?;

        Some(local_t / dir_len)
    }
}

fn intersect_local_triangles(
    origin: Vec3,
    dir: Vec3,
    vertices: &[LocalVertex],
    indices: &[u32],
) -> Option<f32> {
    let mut best_t = f32::INFINITY;
    for tri in indices.chunks_exact(3) {
        let v0 = vertices[tri[0] as usize].position;
        let v1 = vertices[tri[1] as usize].position;
        let v2 = vertices[tri[2] as usize].position;

        let e1 = v1 - v0;
        let e2 = v2 - v0;
        let h = dir.cross(e2);
        let a = e1.dot(h);
        if a.abs() < 1e-6 {
            continue;
        }
        let f = 1.0 / a;
        let s = origin - v0;
        let u = f * s.dot(h);
        if !(0.0..=1.0).contains(&u) {
            continue;
        }
        let q = s.cross(e1);
        let v = f * dir.dot(q);
        if v < 0.0 || u + v > 1.0 {
            continue;
        }
        let t = f * e2.dot(q);
        if t >= 0.0 && t < best_t {
            best_t = t;
        }
    }
    if best_t.is_finite() {
        Some(best_t)
    } else {
        None
    }
}

/// A plane is the infinitely thin unit square at local `y = 0` (its scale.y never thickens it).
fn intersect_local_plane(origin: Vec3, dir: Vec3) -> Option<f32> {
    if dir.y.abs() < 1e-6 {
        return None;
    }
    let t = -origin.y / dir.y;
    let p = origin + dir * t;
    (t >= 0.0 && p.x.abs() <= 0.5 && p.z.abs() <= 0.5).then_some(t)
}

fn intersect_local_sphere(origin: Vec3, dir: Vec3, radius: f32) -> Option<f32> {
    let b = origin.dot(dir);
    let c = origin.length_squared() - radius * radius;
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let sqrt_disc = disc.sqrt();
    let t0 = -b - sqrt_disc;
    let t1 = -b + sqrt_disc;
    if t0 >= 0.0 {
        Some(t0)
    } else if t1 >= 0.0 {
        Some(t1)
    } else {
        None
    }
}

fn intersect_local_aabb(origin: Vec3, dir: Vec3, half: Vec3) -> Option<f32> {
    let min = -half;
    let max = half;
    let mut tmin = f32::NEG_INFINITY;
    let mut tmax = f32::INFINITY;

    for axis in 0..3 {
        let o = origin[axis];
        let d = dir[axis];
        if d.abs() < 1e-6 {
            if o < min[axis] || o > max[axis] {
                return None;
            }
        } else {
            let inv_d = 1.0 / d;
            let mut t1 = (min[axis] - o) * inv_d;
            let mut t2 = (max[axis] - o) * inv_d;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            tmin = tmin.max(t1);
            tmax = tmax.min(t2);
            if tmin > tmax {
                return None;
            }
        }
    }

    if tmax < 0.0 {
        None
    } else if tmin >= 0.0 {
        Some(tmin)
    } else {
        Some(tmax)
    }
}

/// Scene lighting configuration (Ambient + Directional + Point light).
#[derive(Debug, Clone, Copy)]
pub struct LightingConfig {
    pub ambient_intensity: f32,
    pub dir_light_dir: Vec3,
    pub dir_light_intensity: f32,
    pub point_light_pos: Vec3,
    pub point_light_intensity: f32,
}

impl Default for LightingConfig {
    fn default() -> Self {
        Self {
            ambient_intensity: 0.32,
            dir_light_dir: Vec3::new(0.45, 0.85, 0.55).normalize(),
            dir_light_intensity: 0.95,
            point_light_pos: Vec3::new(0.0, 45.0, 25.0),
            point_light_intensity: 0.65,
        }
    }
}

/// Visual helpers in 3D space (GridHelper, AxesHelper).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SceneHelpersConfig {
    pub show_grid: bool,
    pub grid_size: f32,
    pub grid_divisions: u32,
    pub show_axes: bool,
    pub axes_length: f32,
}

impl Default for SceneHelpersConfig {
    fn default() -> Self {
        Self {
            show_grid: false,
            grid_size: 200.0,
            grid_divisions: 20,
            show_axes: false,
            axes_length: 60.0,
        }
    }
}

/// Cached unit primitive meshes so geometry generation is zero-allocation per frame.
struct UnitPrimitives {
    box_mesh: (Vec<LocalVertex>, Vec<u32>),
    sphere_mesh: (Vec<LocalVertex>, Vec<u32>),
    plane_mesh: (Vec<LocalVertex>, Vec<u32>),
    cylinder_mesh: (Vec<LocalVertex>, Vec<u32>),
}

impl Default for UnitPrimitives {
    fn default() -> Self {
        Self {
            box_mesh: build_unit_box(),
            sphere_mesh: build_unit_sphere(18, 14),
            plane_mesh: build_unit_plane(),
            cylinder_mesh: build_unit_cylinder(20),
        }
    }
}

/// Complete 3D Scene managing objects, hierarchy, rigid-body physics, lighting, and GPU mesh packing.
pub struct SceneWorld {
    objects: Vec<SceneObject>,
    next_id: u32,
    pub lighting: LightingConfig,
    pub helpers: SceneHelpersConfig,
    pub gravity: Vec3,
    pub rigid_physics_enabled: bool,
    pub hovered_object: Option<u32>,
    pub selected_object: Option<u32>,
    primitives: UnitPrimitives,
    helper_lines: Vec<EdgeVertexRaw>,
    world_scratch: Vec<Mat4>,
    order_scratch: Vec<usize>,
    revision: u64,
    instances: Vec<MeshInstanceRaw>,
    draws: Vec<MeshDraw>,
    geometry_vertices: Vec<MeshVertexRaw>,
    geometry_indices: Vec<u32>,
    /// `(first_index, index_count)` of box / sphere / plane / cylinder
    primitive_ranges: [(u32, u32); 4],
    /// `(object_id, first_index, index_count)` of custom meshes, sorted by id
    custom_ranges: Vec<(u32, u32, u32)>,
    /// Bumped when a custom mesh is added / removed; geometry is re-uploaded only then
    geometry_revision: u64,
    packed_geometry_revision: u64,
}

impl Default for SceneWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl SceneWorld {
    pub fn new() -> Self {
        Self {
            objects: Vec::new(),
            next_id: 1,
            lighting: LightingConfig::default(),
            helpers: SceneHelpersConfig::default(),
            gravity: Vec3::new(0.0, -40.0, 0.0),
            rigid_physics_enabled: true,
            hovered_object: None,
            selected_object: None,
            primitives: UnitPrimitives::default(),
            helper_lines: Vec::new(),
            world_scratch: Vec::new(),
            order_scratch: Vec::new(),
            revision: next_scene_revision(),
            instances: Vec::new(),
            draws: Vec::new(),
            geometry_vertices: Vec::new(),
            geometry_indices: Vec::new(),
            primitive_ranges: [(0, 0); 4],
            custom_ranges: Vec::new(),
            geometry_revision: next_scene_revision(),
            packed_geometry_revision: 0,
        }
    }

    pub fn objects(&self) -> &[SceneObject] {
        &self.objects
    }

    pub fn object_count(&self) -> usize {
        self.objects.len()
    }

    pub fn clear_objects(&mut self) {
        self.touch();
        if self.objects.iter().any(|o| matches!(o.geometry, SceneGeometry::Custom { .. })) {
            self.bump_geometry();
        }
        self.objects.clear();
        self.hovered_object = None;
        self.selected_object = None;
    }

    pub fn add_primitive(
        &mut self,
        kind: PrimitiveKind,
        position: Vec3,
        scale: Vec3,
        color: [f32; 4],
        body_type: BodyType,
    ) -> u32 {
        self.touch();
        let id = self.next_id;
        self.next_id += 1;
        let mass = (scale.x.abs() * scale.y.abs() * scale.z.abs()).clamp(0.2, 100.0);
        self.objects.push(SceneObject {
            id,
            transform: Transform {
                position,
                euler_radians: Vec3::ZERO,
                scale: scale.max(Vec3::splat(0.05)),
                parent_id: None,
            },
            geometry: SceneGeometry::Primitive(kind),
            material: Material {
                color,
                ..Material::default()
            },
            body: RigidBody {
                body_type,
                mass,
                ..RigidBody::default()
            },
            selected: false,
            visible: true,
        });
        id
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_custom_mesh(
        &mut self,
        positions: &[f32],
        normals: &[f32],
        indices: &[u32],
        position: Vec3,
        scale: Vec3,
        color: [f32; 4],
        body_type: BodyType,
    ) -> Result<u32, &'static str> {
        if positions.is_empty() || !positions.len().is_multiple_of(3) {
            return Err("positions must be a non-empty multiple of 3 floats");
        }
        let v_count = positions.len() / 3;
        if !normals.is_empty() && normals.len() != positions.len() {
            return Err("normals length must match positions length or be empty");
        }
        if indices.is_empty() || !indices.len().is_multiple_of(3) {
            return Err("indices must be a non-empty multiple of 3");
        }
        for &idx in indices {
            if (idx as usize) >= v_count {
                return Err("mesh index out of bounds");
            }
        }

        let mut vertices = Vec::with_capacity(v_count);
        let mut max_abs = Vec3::splat(0.1);
        for i in 0..v_count {
            let p = Vec3::new(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            max_abs = max_abs.max(p.abs());
            let n = if !normals.is_empty() {
                Vec3::new(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])
                    .normalize_or_zero()
            } else {
                Vec3::Y
            };
            vertices.push(LocalVertex {
                position: p,
                normal: if n.length_squared() > 0.0 { n } else { Vec3::Y },
            });
        }

        // If normals were omitted, compute face-averaged vertex normals
        if normals.is_empty() {
            for v in &mut vertices {
                v.normal = Vec3::ZERO;
            }
            for tri in indices.chunks_exact(3) {
                let i0 = tri[0] as usize;
                let i1 = tri[1] as usize;
                let i2 = tri[2] as usize;
                let p0 = vertices[i0].position;
                let p1 = vertices[i1].position;
                let p2 = vertices[i2].position;
                let face_n = (p1 - p0).cross(p2 - p0).normalize_or_zero();
                vertices[i0].normal += face_n;
                vertices[i1].normal += face_n;
                vertices[i2].normal += face_n;
            }
            for v in &mut vertices {
                v.normal = v.normal.normalize_or_zero();
                if v.normal.length_squared() == 0.0 {
                    v.normal = Vec3::Y;
                }
            }
        }

        self.touch();
        self.bump_geometry();
        let id = self.next_id;
        self.next_id += 1;
        self.objects.push(SceneObject {
            id,
            transform: Transform {
                position,
                euler_radians: Vec3::ZERO,
                scale: scale.max(Vec3::splat(0.05)),
                parent_id: None,
            },
            geometry: SceneGeometry::Custom {
                vertices,
                indices: indices.to_vec(),
                local_half_extents: max_abs,
            },
            material: Material {
                color,
                ..Material::default()
            },
            body: RigidBody {
                body_type,
                mass: (scale.x.abs() * scale.y.abs() * scale.z.abs()).clamp(0.2, 100.0),
                ..RigidBody::default()
            },
            selected: false,
            visible: true,
        });
        Ok(id)
    }

    pub fn remove_object(&mut self, object_id: u32) -> bool {
        if let Some(pos) = self.index_of(object_id) {
            self.touch();
            if matches!(self.objects[pos].geometry, SceneGeometry::Custom { .. }) {
                self.bump_geometry();
            }
            self.objects.remove(pos);
            // Detach any children referencing this parent
            for obj in &mut self.objects {
                if obj.transform.parent_id == Some(object_id) {
                    obj.transform.parent_id = None;
                }
            }
            if self.hovered_object == Some(object_id) {
                self.hovered_object = None;
            }
            if self.selected_object == Some(object_id) {
                self.selected_object = None;
            }
            true
        } else {
            false
        }
    }

    /// Objects are kept sorted by id (ids only grow and removal preserves order), so lookups
    /// are a binary search.
    fn index_of(&self, object_id: u32) -> Option<usize> {
        self.objects.binary_search_by_key(&object_id, |o| o.id).ok()
    }

    pub fn find_object(&self, object_id: u32) -> Option<&SceneObject> {
        self.index_of(object_id).map(|i| &self.objects[i])
    }

    /// Mutable access marks the scene as changed.
    pub fn find_object_mut(&mut self, object_id: u32) -> Option<&mut SceneObject> {
        let i = self.index_of(object_id)?;
        self.touch();
        Some(&mut self.objects[i])
    }

    pub fn set_object_transform(
        &mut self,
        object_id: u32,
        position: Vec3,
        euler_radians: Vec3,
        scale: Vec3,
    ) -> bool {
        if let Some(obj) = self.find_object_mut(object_id) {
            obj.transform.position = position;
            obj.transform.euler_radians = euler_radians;
            obj.transform.scale = scale.max(Vec3::splat(0.05));
            true
        } else {
            false
        }
    }

    pub fn set_object_material(&mut self, object_id: u32, material: Material) -> bool {
        if let Some(obj) = self.find_object_mut(object_id) {
            obj.material = material;
            true
        } else {
            false
        }
    }

    pub fn set_object_physics(
        &mut self,
        object_id: u32,
        body_type: BodyType,
        velocity: Vec3,
        mass: f32,
        restitution: f32,
    ) -> bool {
        if let Some(obj) = self.find_object_mut(object_id) {
            obj.body.body_type = body_type;
            obj.body.velocity = velocity;
            obj.body.mass = mass.max(0.05);
            obj.body.restitution = restitution.clamp(0.0, 1.0);
            true
        } else {
            false
        }
    }

    pub fn set_object_parent(&mut self, object_id: u32, parent_id: Option<u32>) -> bool {
        if Some(object_id) == parent_id {
            return false;
        }
        if let Some(pid) = parent_id {
            if self.find_object(pid).is_none() {
                return false;
            }
            // Reject cycles: `object_id` must not be an ancestor of the new parent
            let mut cur = Some(pid);
            let mut depth = 0;
            while let Some(c) = cur {
                if c == object_id || depth > MAX_HIERARCHY_DEPTH {
                    return false;
                }
                cur = self.find_object(c).and_then(|o| o.transform.parent_id);
                depth += 1;
            }
        }
        if let Some(obj) = self.find_object_mut(object_id) {
            obj.transform.parent_id = parent_id;
            true
        } else {
            false
        }
    }

    pub fn select_object(&mut self, object_id: Option<u32>) {
        self.touch();
        self.selected_object = object_id;
        for obj in &mut self.objects {
            obj.selected = Some(obj.id) == object_id;
        }
    }

    /// Computes world transform matrix for `object_id`, walking up the parent hierarchy.
    pub fn world_matrix_of(&self, object_id: u32) -> Mat4 {
        let mut mat = Mat4::IDENTITY;
        let mut current_id = Some(object_id);
        let mut depth = 0;
        while let Some(cid) = current_id {
            if depth > MAX_HIERARCHY_DEPTH {
                break;
            }
            if let Some(obj) = self.find_object(cid) {
                mat = obj.transform.local_matrix() * mat;
                current_id = obj.transform.parent_id;
                depth += 1;
            } else {
                break;
            }
        }
        mat
    }

    /// Picks the closest visible 3D object intersected by `ray`.
    pub fn pick_object(&mut self, ray: &Ray) -> Option<u32> {
        self.raycast_object(ray).map(|(id, _)| id)
    }

    /// Picks the closest visible 3D object intersected by `ray`, returning `(object_id, world_hit_point)`.
    /// Also marks the object as hovered (highlight + wireframe).
    pub fn raycast_object(&mut self, ray: &Ray) -> Option<(u32, Vec3)> {
        let hit = self.raycast_object_silent(ray);
        self.hovered_object = hit.map(|(id, _)| id);
        hit
    }

    /// Same as `raycast_object` but leaves the hover highlight untouched (for chart hit-testing).
    pub fn raycast_object_silent(&self, ray: &Ray) -> Option<(u32, Vec3)> {
        let mut best_id = None;
        let mut best_t = f32::INFINITY;

        for obj in &self.objects {
            if !obj.visible {
                continue;
            }
            let world_mat = self.world_matrix_of(obj.id);
            if let Some(t) = obj.intersect_ray(&world_mat, ray) {
                if t < best_t {
                    best_t = t;
                    best_id = Some(obj.id);
                }
            }
        }

        best_id.map(|id| (id, ray.origin + ray.direction * best_t))
    }

    /// Steps 3D rigid-body physics (gravity, integration, oriented collision resolution).
    pub fn step_physics(&mut self, dt: f32) -> f32 {
        if !self.rigid_physics_enabled || self.objects.is_empty() {
            return 0.0;
        }
        if !dt.is_finite() || dt <= 0.0 {
            return 0.0;
        }
        let clamped_dt = dt.clamp(0.001, 0.05);

        // Static-only scenes never move: keep the packed geometry cached
        if self
            .objects
            .iter()
            .all(|o| o.body.body_type == BodyType::Static)
        {
            return 0.0;
        }
        self.touch();

        // Small substeps keep contact torques stable as an object tips onto a new face.
        let steps = (clamped_dt / (1.0 / 120.0)).ceil() as usize;
        let sub_dt = clamped_dt / steps as f32;
        for _ in 0..steps {
            self.step_rigid_bodies(sub_dt);
        }
        self.objects
            .iter()
            .filter(|o| o.body.body_type == BodyType::Dynamic && o.transform.parent_id.is_none())
            .map(dynamics::kinetic_energy)
            .sum()
    }

    fn step_rigid_bodies(&mut self, dt: f32) {
        // Integrate world-space angular velocity using quaternion composition; Euler-angle
        // derivatives are not angular velocity when multiple axes rotate together.
        for obj in &mut self.objects {
            if obj.transform.parent_id.is_some() {
                continue;
            }
            match obj.body.body_type {
                BodyType::Dynamic => {
                    obj.body.velocity += self.gravity * dt;
                    obj.body.velocity *= 0.995_f32.powf(dt * 60.0);
                }
                BodyType::Kinematic => {}
                BodyType::Static => continue,
            }
            obj.transform.position += obj.body.velocity * dt;
            let rotation = (Quat::from_scaled_axis(obj.body.angular_velocity * dt)
                * obj.transform.rotation_quat()).normalize();
            let (y, x, z) = rotation.to_euler(glam::EulerRot::YXZ);
            obj.transform.euler_radians = Vec3::new(x, y, z);
        }

        // 2. Resolve collisions of Dynamic bodies against all other bodies with oriented shapes
        //    (collision.rs). World transforms are resolved once (parented colliders included), a
        //    sort-and-sweep broad phase lists candidate pairs, and a few sequential passes settle
        //    stacks. Contacts below `rest_speed` do not bounce, so resting bodies stay put.
        let len = self.objects.len();
        let mut world = std::mem::take(&mut self.world_scratch);
        self.compute_world_matrices(&mut world);
        let mut colliders: Vec<Collider> = Vec::with_capacity(len);
        let mut dynamic: Vec<bool> = Vec::with_capacity(len);
        let mut group: Vec<usize> = Vec::with_capacity(len);
        for (i, o) in self.objects.iter().enumerate() {
            colliders.push(Collider::from_object(o, &world[i]));
            dynamic.push(o.body.body_type == BodyType::Dynamic && o.transform.parent_id.is_none());
            group.push(self.root_index(i));
        }
        let mut motions: Vec<dynamics::Motion> = self.objects.iter().enumerate()
            .map(|(i, obj)| {
                let root = group[i];
                dynamics::Motion::new(
                    obj, &self.objects[root], world[i].w_axis.truncate(),
                    world[root].w_axis.truncate(), dynamic[i],
                )
            }).collect();
        self.world_scratch = world;
        let mut boxes = Vec::with_capacity(len);
        collision::aabbs(&colliders, BROADPHASE_MARGIN, &mut boxes);
        let mut order = std::mem::take(&mut self.order_scratch);
        let mut pairs = Vec::new();
        collision::sweep_pairs(&boxes, &dynamic, &group, &mut order, &mut pairs);
        self.order_scratch = order;

        let rest_speed = self.gravity.length() * dt * 2.0 + 0.05;
        let mut constraints = Vec::new();
        for &(i, j) in &pairs {
            if let Some(c) = collision::collide(&colliders[i], &colliders[j]) {
                dynamics::Constraint::append(&mut constraints, i, j, &c, &motions, &self.objects, rest_speed);
            }
        }
        // Accumulated impulses support resting manifolds and bound friction by the normal
        // impulse. Restitution targets are computed once, not reapplied on every iteration.
        for _ in 0..VELOCITY_SOLVER_ITERATIONS {
            for c in &mut constraints {
                c.solve(&mut motions);
            }
        }
        for (i, motion) in motions.iter().enumerate() {
            if dynamic[i] {
                self.objects[i].body.velocity = motion.linear;
                self.objects[i].body.angular_velocity = motion.angular;
            }
        }

        // Split positional correction from velocity impulses so overlap removal does not
        // inject energy into spin. Re-evaluate penetration as stacks are separated.
        for _ in 0..SOLVER_ITERATIONS {
            for &(i, j) in &pairs {
                if let Some(c) = collision::collide(&colliders[i], &colliders[j]) {
                    let (a, b) = (motions[i].inv_mass, motions[j].inv_mass);
                    let correction = c.normal * (c.depth / (a + b));
                    self.objects[i].transform.position -= correction * a;
                    self.objects[j].transform.position += correction * b;
                    colliders[i].center -= correction * a;
                    colliders[j].center += correction * b;
                }
            }
        }
    }

    /// Index of the top-most ancestor of `idx` (itself when unparented).
    fn root_index(&self, mut idx: usize) -> usize {
        for _ in 0..MAX_HIERARCHY_DEPTH {
            match self.objects[idx].transform.parent_id.and_then(|p| self.index_of(p)) {
                Some(p) => idx = p,
                None => break,
            }
        }
        idx
    }

    /// Monotonic revision bumped by every change that affects packed geometry or colors.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn touch(&mut self) {
        self.revision = next_scene_revision();
    }

    /// True if any visible object needs back-to-front sorting (its packing depends on the eye).
    pub fn has_translucent_objects(&self) -> bool {
        self.objects
            .iter()
            .any(|o| o.visible && o.material.color[3] < 0.999)
    }

    /// World matrices of every object (index-aligned with `objects`), each parent chain walked once.
    fn compute_world_matrices(&self, out: &mut Vec<Mat4>) {
        out.clear();
        out.resize(self.objects.len(), Mat4::IDENTITY);
        let mut done = vec![false; self.objects.len()];
        for i in 0..self.objects.len() {
            self.resolve_world_matrix(i, out, &mut done, 0);
        }
    }

    fn resolve_world_matrix(&self, idx: usize, out: &mut [Mat4], done: &mut [bool], depth: usize) -> Mat4 {
        if done[idx] {
            return out[idx];
        }
        let obj = &self.objects[idx];
        let local = obj.transform.local_matrix();
        let parent_idx = obj
            .transform
            .parent_id
            .and_then(|pid| self.index_of(pid))
            .filter(|_| depth < MAX_HIERARCHY_DEPTH);
        let world = match parent_idx {
            Some(p) => self.resolve_world_matrix(p, out, done, depth + 1) * local,
            None => local,
        };
        out[idx] = world;
        done[idx] = true;
        world
    }

    /// Lighting uniform for the current camera eye (sent every frame; it is 48 bytes).
    pub fn light_uniform(&self, camera_eye: Vec3) -> SceneLightUniformRaw {
        let dir = self.lighting.dir_light_dir.normalize_or_zero();
        SceneLightUniformRaw {
            eye_pos_ambient: [
                camera_eye.x,
                camera_eye.y,
                camera_eye.z,
                self.lighting.ambient_intensity,
            ],
            dir_light_dir_intensity: [dir.x, dir.y, dir.z, self.lighting.dir_light_intensity],
            point_light_pos_intensity: [
                self.lighting.point_light_pos.x,
                self.lighting.point_light_pos.y,
                self.lighting.point_light_pos.z,
                self.lighting.point_light_intensity,
            ],
        }
    }

    /// Packs object instances + draw list (opaque draws batched per geometry, then translucent
    /// draws far-to-near from `camera_eye`) and helper lines. When meshes were added / removed
    /// since the last call, the combined static geometry is returned too.
    pub fn pack_render_data(&mut self, camera_eye: Vec3) -> PackedScene<'_> {
        let geometry_changed = self.packed_geometry_revision != self.geometry_revision;
        if geometry_changed {
            self.rebuild_geometry();
        }

        self.instances.clear();
        self.draws.clear();
        self.helper_lines.clear();
        self.pack_helpers();

        let mut world = std::mem::take(&mut self.world_scratch);
        self.compute_world_matrices(&mut world);

        let mut order = std::mem::take(&mut self.order_scratch);
        order.clear();
        order.extend((0..self.objects.len()).filter(|&i| self.objects[i].visible));
        let split = partition_in_place(&mut order, |&i| self.objects[i].material.color[3] >= 0.999);
        // Opaque: group by geometry so each mesh is one instanced draw
        order[..split].sort_by_key(|&i| self.geometry_range(i).0);
        // Translucent: far-to-near for correct blending
        order[split..].sort_by(|&a, &b| {
            let da = world[a].w_axis.truncate().distance_squared(camera_eye);
            let db = world[b].w_axis.truncate().distance_squared(camera_eye);
            db.total_cmp(&da)
        });

        for (k, &idx) in order.iter().enumerate() {
            let translucent = k >= split;
            let (first_index, index_count) = self.geometry_range(idx);
            let instance = self.instances.len() as u32;
            self.pack_instance(idx, &world[idx]);
            match self.draws.last_mut() {
                // Consecutive instances of the same mesh share a draw
                Some(d) if d.first_index == first_index && d.translucent == translucent => {
                    d.instance_count += 1;
                }
                _ => self.draws.push(MeshDraw {
                    first_index,
                    index_count,
                    first_instance: instance,
                    instance_count: 1,
                    translucent,
                }),
            }
        }

        self.world_scratch = world;
        self.order_scratch = order;

        PackedScene {
            geometry: geometry_changed.then_some((
                self.geometry_vertices.as_slice(),
                self.geometry_indices.as_slice(),
            )),
            instances: &self.instances,
            draws: &self.draws,
            helper_lines: &self.helper_lines,
        }
    }

    /// Builds the combined object-space vertex / index buffers: the four unit primitives, then
    /// every custom mesh (indices are absolute, so draws never need a base vertex).
    fn rebuild_geometry(&mut self) {
        self.geometry_vertices.clear();
        self.geometry_indices.clear();
        self.custom_ranges.clear();

        let append = |verts: &[LocalVertex], idx: &[u32], gv: &mut Vec<MeshVertexRaw>, gi: &mut Vec<u32>| {
            let base = gv.len() as u32;
            let first = gi.len() as u32;
            gv.extend(verts.iter().map(|v| MeshVertexRaw {
                position: [v.position.x, v.position.y, v.position.z, 0.0],
                normal: [v.normal.x, v.normal.y, v.normal.z, 0.0],
            }));
            gi.extend(idx.iter().map(|&i| base + i));
            (first, idx.len() as u32)
        };

        let p = &self.primitives;
        let (gv, gi) = (&mut self.geometry_vertices, &mut self.geometry_indices);
        self.primitive_ranges = [
            append(&p.box_mesh.0, &p.box_mesh.1, gv, gi),
            append(&p.sphere_mesh.0, &p.sphere_mesh.1, gv, gi),
            append(&p.plane_mesh.0, &p.plane_mesh.1, gv, gi),
            append(&p.cylinder_mesh.0, &p.cylinder_mesh.1, gv, gi),
        ];
        for obj in &self.objects {
            if let SceneGeometry::Custom { vertices, indices, .. } = &obj.geometry {
                let range = append(vertices, indices, gv, gi);
                self.custom_ranges.push((obj.id, range.0, range.1));
            }
        }
        self.packed_geometry_revision = self.geometry_revision;
    }

    /// `(first_index, index_count)` of the object's mesh in the combined geometry buffer.
    fn geometry_range(&self, idx: usize) -> (u32, u32) {
        let obj = &self.objects[idx];
        match &obj.geometry {
            SceneGeometry::Primitive(kind) => self.primitive_ranges[*kind as usize],
            SceneGeometry::Custom { .. } => self
                .custom_ranges
                .binary_search_by_key(&obj.id, |r| r.0)
                .map(|i| (self.custom_ranges[i].1, self.custom_ranges[i].2))
                .unwrap_or((0, 0)),
        }
    }

    fn bump_geometry(&mut self) {
        self.geometry_revision = next_scene_revision();
    }

    fn pack_helpers(&mut self) {
        if self.helpers.show_grid {
            let half = (self.helpers.grid_size * 0.5).max(5.0);
            let divs = self.helpers.grid_divisions.clamp(2, 200);
            let step = (half * 2.0) / (divs as f32);
            for i in 0..=divs {
                let offset = -half + (i as f32) * step;
                let is_center = (offset.abs()) < 1e-3;
                let color = if is_center {
                    [0.45, 0.55, 0.72, 0.55]
                } else {
                    [0.25, 0.32, 0.45, 0.28]
                };
                for (a, b) in [
                    ([-half, 0.0, offset], [half, 0.0, offset]),
                    ([offset, 0.0, -half], [offset, 0.0, half]),
                ] {
                    self.helper_lines.push(EdgeVertexRaw {
                        position_pad: [a[0], a[1], a[2], 1.0],
                        color,
                    });
                    self.helper_lines.push(EdgeVertexRaw {
                        position_pad: [b[0], b[1], b[2], 1.0],
                        color,
                    });
                }
            }
        }

        if self.helpers.show_axes {
            let len = self.helpers.axes_length.max(1.0);
            let axes = [
                ([0.0, 0.05, 0.0], [len, 0.05, 0.0], [1.0, 0.28, 0.28, 0.95]),
                ([0.0, 0.0, 0.0], [0.0, len, 0.0], [0.28, 0.95, 0.42, 0.95]),
                ([0.0, 0.05, 0.0], [0.0, 0.05, len], [0.32, 0.62, 1.0, 0.95]),
            ];
            for (a, b, color) in axes {
                self.helper_lines.push(EdgeVertexRaw {
                    position_pad: [a[0], a[1], a[2], 1.0],
                    color,
                });
                self.helper_lines.push(EdgeVertexRaw {
                    position_pad: [b[0], b[1], b[2], 1.0],
                    color,
                });
            }
        }
    }

    fn pack_instance(&mut self, idx: usize, world_mat: &Mat4) {
        let obj = &self.objects[idx];
        let obj_id = obj.id;
        let normal_mat = Mat3::from_mat4(*world_mat).inverse().transpose();

        let is_hovered = self.hovered_object == Some(obj_id);
        let is_selected = obj.selected || self.selected_object == Some(obj_id);

        let mut base_color = obj.material.color;
        let mut emissive = obj.material.emissive;
        // Floors / large static backdrops: a tint would fill the view, the outline is enough
        let tint = (is_hovered || is_selected) && !highlight_outline_only(obj, world_mat);
        if tint && is_hovered {
            base_color = [
                (base_color[0] + 0.25).min(1.0),
                (base_color[1] + 0.25).min(1.0),
                (base_color[2] + 0.15).min(1.0),
                base_color[3],
            ];
            emissive = (emissive + 0.35).min(2.0);
        } else if tint {
            emissive = (emissive + 0.2).min(2.0);
        }

        let n = normal_mat.to_cols_array_2d();
        self.instances.push(MeshInstanceRaw {
            model: world_mat.to_cols_array_2d(),
            normal: [
                [n[0][0], n[0][1], n[0][2], 0.0],
                [n[1][0], n[1][1], n[1][2], 0.0],
                [n[2][0], n[2][1], n[2][2], 0.0],
            ],
            color: base_color,
            material: [
                obj.material.metallic,
                obj.material.roughness.clamp(0.04, 1.0),
                emissive,
                0.0,
            ],
        });

        // If selected or hovered, emit a bounding wireframe box in helper_lines
        if is_selected || is_hovered {
            let he = obj.base_half_extents() * 1.03;
            let wire_color = if is_selected {
                [1.0, 0.82, 0.22, 0.95]
            } else {
                [0.45, 0.92, 1.0, 0.75]
            };
            if matches!(obj.geometry, SceneGeometry::Primitive(PrimitiveKind::Plane)) {
                // The plane slab spans local y in [-0.02, 0]: hug it instead of straddling y = 0
                let slab = *world_mat * Mat4::from_translation(Vec3::new(0.0, -0.01, 0.0));
                append_wireframe_box(&mut self.helper_lines, &slab, Vec3::new(0.5, 0.01, 0.5) * 1.03, wire_color);
            } else {
                append_wireframe_box(&mut self.helper_lines, world_mat, he, wire_color);
            }
        }
    }
}

/// Static objects at least this wide (world half extent on x or z) are highlighted by outline only.
const LARGE_STATIC_HALF_EXTENT: f32 = 10.0;

/// Planes and large static objects skip the hover / selection tint (outline only).
fn highlight_outline_only(obj: &SceneObject, world_mat: &Mat4) -> bool {
    if matches!(obj.geometry, SceneGeometry::Primitive(PrimitiveKind::Plane)) {
        return true;
    }
    let he = obj.base_half_extents();
    let wide = (he.x * world_mat.x_axis.truncate().length())
        .max(he.z * world_mat.z_axis.truncate().length());
    obj.body.body_type == BodyType::Static && wide >= LARGE_STATIC_HALF_EXTENT
}

/// Packed scene for one upload.
pub struct PackedScene<'a> {
    /// Combined static geometry, present only when meshes were added / removed
    pub geometry: Option<(&'a [MeshVertexRaw], &'a [u32])>,
    pub instances: &'a [MeshInstanceRaw],
    pub draws: &'a [MeshDraw],
    pub helper_lines: &'a [EdgeVertexRaw],
}

/// Sequential contact passes per physics step (lets stacks settle without sinking).
const SOLVER_ITERATIONS: usize = 4;
const VELOCITY_SOLVER_ITERATIONS: usize = 12;

/// Broad-phase AABB growth so contacts created by positional corrections are still candidates.
const BROADPHASE_MARGIN: f32 = 0.02;

/// Max parent chain length followed when resolving world matrices (guards against cycles).
const MAX_HIERARCHY_DEPTH: usize = 32;

static NEXT_SCENE_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_scene_revision() -> u64 {
    NEXT_SCENE_REVISION.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Stable partition: elements matching `pred` first. Returns the split point.
fn partition_in_place<T: Copy>(v: &mut Vec<T>, pred: impl Fn(&T) -> bool) -> usize {
    let (yes, no): (Vec<T>, Vec<T>) = v.iter().partition(|x| pred(x));
    let split = yes.len();
    v.clear();
    v.extend(yes);
    v.extend(no);
    split
}

fn append_wireframe_box(
    lines: &mut Vec<EdgeVertexRaw>,
    world_mat: &Mat4,
    he: Vec3,
    color: [f32; 4],
) {
    let corners = [
        Vec3::new(-he.x, -he.y, -he.z),
        Vec3::new(he.x, -he.y, -he.z),
        Vec3::new(he.x, he.y, -he.z),
        Vec3::new(-he.x, he.y, -he.z),
        Vec3::new(-he.x, -he.y, he.z),
        Vec3::new(he.x, -he.y, he.z),
        Vec3::new(he.x, he.y, he.z),
        Vec3::new(-he.x, he.y, he.z),
    ];
    let world_c: [Vec3; 8] = std::array::from_fn(|i| world_mat.transform_point3(corners[i]));
    let edges = [
        (0, 1),
        (1, 2),
        (2, 3),
        (3, 0),
        (4, 5),
        (5, 6),
        (6, 7),
        (7, 4),
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7),
    ];
    for (a, b) in edges {
        let pa = world_c[a];
        let pb = world_c[b];
        lines.push(EdgeVertexRaw {
            position_pad: [pa.x, pa.y, pa.z, 1.0],
            color,
        });
        lines.push(EdgeVertexRaw {
            position_pad: [pb.x, pb.y, pb.z, 1.0],
            color,
        });
    }
}

fn build_unit_box() -> (Vec<LocalVertex>, Vec<u32>) {
    let faces: [([f32; 3], [[f32; 3]; 4]); 6] = [
        // +Z front
        (
            [0.0, 0.0, 1.0],
            [
                [-0.5, -0.5, 0.5],
                [0.5, -0.5, 0.5],
                [0.5, 0.5, 0.5],
                [-0.5, 0.5, 0.5],
            ],
        ),
        // -Z back
        (
            [0.0, 0.0, -1.0],
            [
                [0.5, -0.5, -0.5],
                [-0.5, -0.5, -0.5],
                [-0.5, 0.5, -0.5],
                [0.5, 0.5, -0.5],
            ],
        ),
        // +Y top
        (
            [0.0, 1.0, 0.0],
            [
                [-0.5, 0.5, 0.5],
                [0.5, 0.5, 0.5],
                [0.5, 0.5, -0.5],
                [-0.5, 0.5, -0.5],
            ],
        ),
        // -Y bottom
        (
            [0.0, -1.0, 0.0],
            [
                [-0.5, -0.5, -0.5],
                [0.5, -0.5, -0.5],
                [0.5, -0.5, 0.5],
                [-0.5, -0.5, 0.5],
            ],
        ),
        // +X right
        (
            [1.0, 0.0, 0.0],
            [
                [0.5, -0.5, 0.5],
                [0.5, -0.5, -0.5],
                [0.5, 0.5, -0.5],
                [0.5, 0.5, 0.5],
            ],
        ),
        // -X left
        (
            [-1.0, 0.0, 0.0],
            [
                [-0.5, -0.5, -0.5],
                [-0.5, -0.5, 0.5],
                [-0.5, 0.5, 0.5],
                [-0.5, 0.5, -0.5],
            ],
        ),
    ];

    let mut vertices = Vec::with_capacity(24);
    let mut indices = Vec::with_capacity(36);

    for (n, quad) in faces {
        let base = vertices.len() as u32;
        let normal = Vec3::from_array(n);
        for p in quad {
            vertices.push(LocalVertex {
                position: Vec3::from_array(p),
                normal,
            });
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }

    (vertices, indices)
}

fn build_unit_plane() -> (Vec<LocalVertex>, Vec<u32>) {
    // Thin slab just below Y=0 (clean normals and depth on both sides); its top face is the
    // plane surface that picking and collisions use
    let (mut verts, indices) = build_unit_box();
    for v in &mut verts {
        v.position.y = v.position.y * 0.02 - 0.01;
    }
    (verts, indices)
}

fn build_unit_sphere(sectors: u32, stacks: u32) -> (Vec<LocalVertex>, Vec<u32>) {
    let radius = 0.5_f32;
    let mut vertices = Vec::new();
    let mut indices = Vec::new();

    for i in 0..=stacks {
        let stack_angle = PI * 0.5 - (i as f32) * (PI / stacks as f32);
        let xy = radius * stack_angle.cos();
        let y = radius * stack_angle.sin();

        for j in 0..=sectors {
            let sector_angle = (j as f32) * (TAU / sectors as f32);
            let x = xy * sector_angle.cos();
            let z = xy * sector_angle.sin();
            let pos = Vec3::new(x, y, z);
            vertices.push(LocalVertex {
                position: pos,
                normal: pos.normalize_or_zero(),
            });
        }
    }

    for i in 0..stacks {
        let k1 = i * (sectors + 1);
        let k2 = k1 + sectors + 1;
        for j in 0..sectors {
            if i != 0 {
                indices.extend_from_slice(&[k1 + j, k2 + j, k1 + j + 1]);
            }
            if i != (stacks - 1) {
                indices.extend_from_slice(&[k1 + j + 1, k2 + j, k2 + j + 1]);
            }
        }
    }

    (vertices, indices)
}

fn build_unit_cylinder(segments: u32) -> (Vec<LocalVertex>, Vec<u32>) {
    let radius = 0.5_f32;
    let half_h = 0.5_f32;
    let mut vertices = Vec::new();
    let mut indices = Vec::new();

    // Side wall
    for i in 0..=segments {
        let theta = (i as f32 / segments as f32) * TAU;
        let c = theta.cos();
        let s = theta.sin();
        let normal = Vec3::new(c, 0.0, s);
        vertices.push(LocalVertex {
            position: Vec3::new(radius * c, -half_h, radius * s),
            normal,
        });
        vertices.push(LocalVertex {
            position: Vec3::new(radius * c, half_h, radius * s),
            normal,
        });
    }

    for i in 0..segments {
        let b = i * 2;
        indices.extend_from_slice(&[b, b + 1, b + 2, b + 1, b + 3, b + 2]);
    }

    // Top cap
    let top_center_idx = vertices.len() as u32;
    vertices.push(LocalVertex {
        position: Vec3::new(0.0, half_h, 0.0),
        normal: Vec3::Y,
    });
    for i in 0..=segments {
        let theta = (i as f32 / segments as f32) * TAU;
        vertices.push(LocalVertex {
            position: Vec3::new(radius * theta.cos(), half_h, radius * theta.sin()),
            normal: Vec3::Y,
        });
    }
    for i in 0..segments {
        indices.extend_from_slice(&[
            top_center_idx,
            top_center_idx + 1 + i + 1,
            top_center_idx + 1 + i,
        ]);
    }

    // Bottom cap
    let bot_center_idx = vertices.len() as u32;
    vertices.push(LocalVertex {
        position: Vec3::new(0.0, -half_h, 0.0),
        normal: Vec3::NEG_Y,
    });
    for i in 0..=segments {
        let theta = (i as f32 / segments as f32) * TAU;
        vertices.push(LocalVertex {
            position: Vec3::new(radius * theta.cos(), -half_h, radius * theta.sin()),
            normal: Vec3::NEG_Y,
        });
    }
    for i in 0..segments {
        indices.extend_from_slice(&[
            bot_center_idx,
            bot_center_idx + 1 + i,
            bot_center_idx + 1 + i + 1,
        ]);
    }

    (vertices, indices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_world_adds_primitives_and_computes_hierarchical_world_matrices() {
        let mut scene = SceneWorld::new();
        let parent_id = scene.add_primitive(
            PrimitiveKind::Box,
            Vec3::new(10.0, 0.0, 0.0),
            Vec3::ONE,
            [1.0, 0.0, 0.0, 1.0],
            BodyType::Static,
        );
        let child_id = scene.add_primitive(
            PrimitiveKind::Sphere,
            Vec3::new(0.0, 5.0, 0.0),
            Vec3::splat(2.0),
            [0.0, 1.0, 0.0, 1.0],
            BodyType::Static,
        );
        assert!(scene.set_object_parent(child_id, Some(parent_id)));

        let child_world = scene.world_matrix_of(child_id);
        let world_pos = child_world.transform_point3(Vec3::ZERO);
        assert!((world_pos - Vec3::new(10.0, 5.0, 0.0)).length() < 1e-4);
    }

    #[test]
    fn scene_world_rigid_body_falls_and_collides_with_static_floor() {
        let mut scene = SceneWorld::new();
        // Static floor plane at Y = 0 -> its surface (and the resting contact) is at Y = 0
        scene.add_primitive(
            PrimitiveKind::Plane,
            Vec3::ZERO,
            Vec3::new(100.0, 1.0, 100.0),
            [0.3, 0.3, 0.3, 1.0],
            BodyType::Static,
        );
        // Dynamic box at Y = 5
        let box_id = scene.add_primitive(
            PrimitiveKind::Box,
            Vec3::new(0.0, 5.0, 0.0),
            Vec3::splat(2.0),
            [0.9, 0.4, 0.2, 1.0],
            BodyType::Dynamic,
        );

        for _ in 0..90 {
            scene.step_physics(0.016);
        }

        let final_y = scene.find_object(box_id).unwrap().transform.position.y;
        // Should have settled near the floor (Y >= 0.8), not fallen to -infinity
        assert!(final_y > 0.5 && final_y < 4.5, "final_y was {final_y}");
    }

    #[test]
    fn scene_world_raycast_picks_closest_3d_object() {
        let mut scene = SceneWorld::new();
        let near_id = scene.add_primitive(
            PrimitiveKind::Box,
            Vec3::new(0.0, 0.0, 10.0),
            Vec3::splat(4.0),
            [1.0, 0.0, 0.0, 1.0],
            BodyType::Static,
        );
        let _far_id = scene.add_primitive(
            PrimitiveKind::Sphere,
            Vec3::new(0.0, 0.0, -20.0),
            Vec3::splat(6.0),
            [0.0, 0.0, 1.0, 1.0],
            BodyType::Static,
        );

        let ray = Ray::new(Vec3::new(0.0, 0.0, 50.0), Vec3::new(0.0, 0.0, -1.0));
        let picked = scene.pick_object(&ray);
        assert_eq!(picked, Some(near_id));
    }

    #[test]
    fn parent_cycles_are_rejected() {
        let mut scene = SceneWorld::new();
        let a = scene.add_primitive(PrimitiveKind::Box, Vec3::ZERO, Vec3::ONE, [1.0; 4], BodyType::Static);
        let b = scene.add_primitive(PrimitiveKind::Box, Vec3::ZERO, Vec3::ONE, [1.0; 4], BodyType::Static);
        assert!(scene.set_object_parent(b, Some(a)));
        assert!(!scene.set_object_parent(a, Some(b)), "a -> b -> a would loop");
    }

    #[test]
    fn translucent_objects_are_packed_after_opaque_ones_far_to_near() {
        let mut scene = SceneWorld::new();
        let near = scene.add_primitive(PrimitiveKind::Box, Vec3::new(0.0, 0.0, 50.0), Vec3::ONE, [1.0, 0.0, 0.0, 0.5], BodyType::Static);
        let _opaque = scene.add_primitive(PrimitiveKind::Box, Vec3::ZERO, Vec3::ONE, [0.0, 1.0, 0.0, 1.0], BodyType::Static);
        let far = scene.add_primitive(PrimitiveKind::Box, Vec3::new(0.0, 0.0, -50.0), Vec3::ONE, [0.0, 0.0, 1.0, 0.5], BodyType::Static);
        let _ = (near, far);
        let packed = scene.pack_render_data(Vec3::new(0.0, 0.0, 200.0));
        // One opaque draw, then one translucent draw whose instances run far-to-near
        // (instances inside a draw are rasterized in order, so blending stays correct)
        let kinds: Vec<(bool, u32)> = packed.draws.iter().map(|d| (d.translucent, d.instance_count)).collect();
        assert_eq!(kinds, vec![(false, 1), (true, 2)]);
        let far = packed.instances[packed.draws[1].first_instance as usize];
        assert_eq!(far.color, [0.0, 0.0, 1.0, 0.5], "far box first");
        // Emissive lives in the material channel; alpha is untouched
        assert_eq!(far.material[2], 0.0);
    }

    #[test]
    fn opaque_instances_of_one_mesh_share_a_draw_and_geometry_uploads_once() {
        let mut scene = SceneWorld::new();
        for i in 0..50 {
            scene.add_primitive(PrimitiveKind::Box, Vec3::X * i as f32, Vec3::ONE, [1.0; 4], BodyType::Static);
        }
        scene.add_primitive(PrimitiveKind::Sphere, Vec3::ZERO, Vec3::ONE, [1.0; 4], BodyType::Static);
        let packed = scene.pack_render_data(Vec3::Z * 100.0);
        assert!(packed.geometry.is_some(), "first pack uploads geometry");
        assert_eq!(packed.instances.len(), 51);
        assert_eq!(packed.draws.len(), 2, "50 boxes in one draw + 1 sphere");
        assert_eq!(packed.draws.iter().map(|d| d.instance_count).max(), Some(50));
        // Moving objects re-packs instances only
        scene.set_object_transform(1, Vec3::Y, Vec3::ZERO, Vec3::ONE);
        assert!(scene.pack_render_data(Vec3::Z * 100.0).geometry.is_none());
        // A new custom mesh re-uploads the geometry and gets its own range
        let id = scene
            .add_custom_mesh(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0], &[], &[0, 1, 2], Vec3::ZERO, Vec3::ONE, [1.0; 4], BodyType::Static)
            .unwrap();
        let packed = scene.pack_render_data(Vec3::Z * 100.0);
        let (verts, indices) = packed.geometry.expect("custom mesh uploads geometry");
        let draw = packed.draws.iter().find(|d| d.index_count == 3).expect("custom draw");
        let tri = &indices[draw.first_index as usize..][..3];
        assert_eq!(verts[tri[1] as usize].position[0], 1.0, "absolute indices point at the mesh");
        assert!(scene.remove_object(id));
        assert!(scene.pack_render_data(Vec3::Z * 100.0).geometry.is_some());
    }

    #[test]
    fn static_scenes_do_not_change_revision_when_stepped() {
        let mut scene = SceneWorld::new();
        scene.add_primitive(PrimitiveKind::Box, Vec3::ZERO, Vec3::ONE, [1.0; 4], BodyType::Static);
        let rev = scene.revision();
        scene.step_physics(0.016);
        assert_eq!(scene.revision(), rev);
        scene.add_primitive(PrimitiveKind::Box, Vec3::Y * 10.0, Vec3::ONE, [1.0; 4], BodyType::Dynamic);
        let rev = scene.revision();
        scene.step_physics(0.016);
        assert_ne!(scene.revision(), rev);
    }
}
