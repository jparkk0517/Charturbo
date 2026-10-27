//! Contact-point impulses with world-space inertia and Coulomb friction.
use super::collision::Contact;
use super::{BodyType, PrimitiveKind, SceneGeometry, SceneObject};
use glam::{Mat3, Vec3};

/// Principal moments about the object's origin (the center of the primitive / bounds).
/// Custom meshes use their bounding box; spheres match the collision sphere under scaling.
pub(super) fn local_inertia(obj: &SceneObject) -> Vec3 {
    let h = obj.world_half_extents();
    let mass = obj.body.mass.max(0.05);
    match obj.geometry {
        SceneGeometry::Primitive(PrimitiveKind::Sphere) => {
            Vec3::splat(0.4 * mass * h.max_element().powi(2))
        }
        SceneGeometry::Primitive(PrimitiveKind::Cylinder) => {
            let radius_sq = h.x.max(h.z).powi(2);
            let side = mass * (3.0 * radius_sq + 4.0 * h.y * h.y) / 12.0;
            Vec3::new(side, mass * radius_sq * 0.5, side)
        }
        _ => {
            mass / 3.0
                * Vec3::new(
                    h.y * h.y + h.z * h.z,
                    h.x * h.x + h.z * h.z,
                    h.x * h.x + h.y * h.y,
                )
        }
    }
}

pub(super) fn kinetic_energy(obj: &SceneObject) -> f32 {
    let local_spin = obj.transform.rotation_quat().conjugate() * obj.body.angular_velocity;
    0.5 * (obj.body.mass * obj.body.velocity.length_squared()
        + local_spin.dot(local_inertia(obj) * local_spin))
}

pub(super) struct Motion {
    pub center: Vec3,
    pub linear: Vec3,
    pub angular: Vec3,
    pub inv_mass: f32,
    inv_inertia: Mat3,
}

impl Motion {
    pub fn new(
        obj: &SceneObject,
        root: &SceneObject,
        center: Vec3,
        root_center: Vec3,
        dynamic: bool,
    ) -> Self {
        let rotation = Mat3::from_quat(obj.transform.rotation_quat());
        let moving = root.body.body_type != BodyType::Static;
        let angular = if moving {
            root.body.angular_velocity
        } else {
            Vec3::ZERO
        };
        Self {
            center,
            linear: if moving {
                root.body.velocity + angular.cross(center - root_center)
            } else {
                Vec3::ZERO
            },
            angular,
            inv_mass: if dynamic {
                obj.body.mass.max(0.05).recip()
            } else {
                0.0
            },
            inv_inertia: if dynamic {
                rotation * Mat3::from_diagonal(local_inertia(obj).recip()) * rotation.transpose()
            } else {
                Mat3::ZERO
            },
        }
    }

    fn velocity_at(&self, arm: Vec3) -> Vec3 {
        self.linear + self.angular.cross(arm)
    }

    fn effective_inverse_mass(&self, arm: Vec3, direction: Vec3) -> f32 {
        self.inv_mass
            + arm
                .cross(direction)
                .dot(self.inv_inertia * arm.cross(direction))
    }

    fn impulse(&mut self, arm: Vec3, impulse: Vec3) {
        self.linear += impulse * self.inv_mass;
        self.angular += self.inv_inertia * arm.cross(impulse);
    }
}

pub(super) struct Constraint {
    a: usize,
    b: usize,
    ra: Vec3,
    rb: Vec3,
    normal: Vec3,
    tangents: [Vec3; 2],
    normal_mass: f32,
    tangent_mass: [f32; 2],
    target_speed: f32,
    friction: f32,
    normal_impulse: f32,
    tangent_impulse: Vec3,
}

impl Constraint {
    pub fn append(
        out: &mut Vec<Self>,
        a: usize,
        b: usize,
        contact: &Contact,
        bodies: &[Motion],
        objects: &[SceneObject],
        rest_speed: f32,
    ) {
        let (ma, mb) = (&bodies[a], &bodies[b]);
        let restitution = (objects[a].body.restitution * objects[b].body.restitution)
            .max(0.0)
            .sqrt();
        let friction = (objects[a].body.friction * objects[b].body.friction)
            .max(0.0)
            .sqrt();
        let normal = contact.normal;
        let t = normal.any_orthonormal_vector();
        let tangents = [t, normal.cross(t)];
        for &point in &contact.points {
            let (ra, rb) = (point - ma.center, point - mb.center);
            let mass = |direction| {
                (ma.effective_inverse_mass(ra, direction)
                    + mb.effective_inverse_mass(rb, direction))
                .max(1e-12)
                .recip()
            };
            let speed = (mb.velocity_at(rb) - ma.velocity_at(ra)).dot(normal);
            out.push(Self {
                a,
                b,
                ra,
                rb,
                normal,
                tangents,
                normal_mass: mass(normal),
                tangent_mass: [mass(tangents[0]), mass(tangents[1])],
                target_speed: if speed < -rest_speed {
                    -restitution * speed
                } else {
                    0.0
                },
                friction,
                normal_impulse: 0.0,
                tangent_impulse: Vec3::ZERO,
            });
        }
    }

    pub fn solve(&mut self, bodies: &mut [Motion]) {
        let relative = bodies[self.b].velocity_at(self.rb) - bodies[self.a].velocity_at(self.ra);
        let normal_impulse = (self.normal_impulse
            + (self.target_speed - relative.dot(self.normal)) * self.normal_mass)
            .max(0.0);
        let impulse = self.normal * (normal_impulse - self.normal_impulse);
        self.normal_impulse = normal_impulse;
        bodies[self.a].impulse(self.ra, -impulse);
        bodies[self.b].impulse(self.rb, impulse);

        let relative = bodies[self.b].velocity_at(self.rb) - bodies[self.a].velocity_at(self.ra);
        let mut friction = self.tangent_impulse;
        for i in 0..2 {
            friction -= self.tangents[i] * (relative.dot(self.tangents[i]) * self.tangent_mass[i]);
        }
        friction = friction.clamp_length_max(self.friction * self.normal_impulse);
        let impulse = friction - self.tangent_impulse;
        self.tangent_impulse = friction;
        bodies[self.a].impulse(self.ra, -impulse);
        bodies[self.b].impulse(self.rb, impulse);
    }
}
