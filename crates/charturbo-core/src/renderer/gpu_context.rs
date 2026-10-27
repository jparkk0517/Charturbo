//! One GPU device shared by many engines (dashboards, tables of sparklines).
//!
//! Browsers cap live WebGL contexts (~16) and every WebGPU device costs an adapter request, a
//! device and a full set of compiled pipelines. A `GpuContext` holds one instance / adapter /
//! device / queue plus the render pipelines (cached per surface format); each engine created
//! on it owns only its surface configuration, depth texture, uniforms and instance buffers.
//!
//! Presentation per backend:
//! - WebGPU: every canvas gets its own `GPUCanvasContext` configured with the shared device, so
//!   N canvases cost N surfaces and one device.
//! - WebGL2 (built with the `webgl` feature): a GL context can only present to its own canvas, so
//!   the device renders every engine into one hidden shared canvas (resized to the engine's size
//!   when it differs) and copies the finished frame into the engine's canvas with a 2D
//!   `drawImage` in the same task (the GL drawing buffer is still intact before compositing).
//!   Engine canvases therefore use a `2d` context: one WebGL2 context serves any number of charts.
//!
//! The WebGPU-only build (`--no-default-features`) omits the WebGL2 fallback; its requests fail
//! with "No suitable GPU adapter found" and the SDK loads the full build instead.

use std::cell::RefCell;
use std::rc::Rc;

/// Backend the caller asks for (`WasmGpuDevice::create`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackendPreference {
    /// WebGPU when an adapter is available, else WebGL2 (if built with `webgl`)
    #[default]
    Auto,
    WebGpu,
    #[cfg(feature = "webgl")]
    WebGl2,
}

impl BackendPreference {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::WebGpu,
            #[cfg(feature = "webgl")]
            2 => Self::WebGl2,
            _ => Self::Auto,
        }
    }

    /// WebGPU is tried first.
    pub fn tries_webgpu(self) -> bool {
        #[cfg(feature = "webgl")]
        return self != Self::WebGl2;
        #[cfg(not(feature = "webgl"))]
        return true;
    }

    /// WebGL2 is tried (first, or after WebGPU found no adapter).
    pub fn tries_webgl2(self) -> bool {
        #[cfg(feature = "webgl")]
        return self != Self::WebGpu;
        #[cfg(not(feature = "webgl"))]
        return false;
    }
}

/// Backend a `GpuContext` runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuBackendKind {
    WebGpu,
    #[cfg(feature = "webgl")]
    WebGl2,
}

impl GpuBackendKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::WebGpu => "webgpu",
            #[cfg(feature = "webgl")]
            Self::WebGl2 => "webgl2",
        }
    }

    /// Engines present through the shared canvas + 2D copy (one GL context for every canvas).
    pub fn presents_via_shared_canvas(self) -> bool {
        #[cfg(feature = "webgl")]
        return self == Self::WebGl2;
        #[cfg(not(feature = "webgl"))]
        return false;
    }
}

/// Values built once per key and shared (render pipelines per surface format).
#[derive(Debug)]
pub struct KeyedCache<K, V> {
    entries: RefCell<Vec<(K, Rc<V>)>>,
}

impl<K, V> Default for KeyedCache<K, V> {
    fn default() -> Self {
        Self { entries: RefCell::new(Vec::new()) }
    }
}

impl<K: PartialEq + Copy, V> KeyedCache<K, V> {
    /// The value of `key`, built by `build` on first use.
    pub fn get_or_build(&self, key: K, build: impl FnOnce() -> V) -> Rc<V> {
        if let Some((_, v)) = self.entries.borrow().iter().find(|(k, _)| *k == key) {
            return v.clone();
        }
        let v = Rc::new(build());
        self.entries.borrow_mut().push((key, v.clone()));
        v
    }

    /// Number of distinct keys built.
    pub fn len(&self) -> usize {
        self.entries.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.borrow().is_empty()
    }
}

/// Hidden canvas the WebGL2 device renders into before each engine copies its frame out.
#[cfg(all(target_arch = "wasm32", feature = "webgl"))]
pub(crate) struct SharedGlCanvas {
    pub(crate) surface: wgpu::Surface<'static>,
    pub(crate) canvas: web_sys::HtmlCanvasElement,
    /// Format / present / alpha mode of the shared surface (size set per engine)
    pub(crate) base_config: wgpu::SurfaceConfiguration,
    /// Size the surface is configured at (0 x 0 = not yet)
    configured: std::cell::Cell<(u32, u32)>,
}

#[cfg(all(target_arch = "wasm32", feature = "webgl"))]
impl SharedGlCanvas {
    /// Configures the shared surface at `config`'s size unless it already is.
    pub(crate) fn ensure_size(&self, device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) {
        let size = (config.width, config.height);
        if self.configured.get() != size {
            self.surface.configure(device, config);
            self.configured.set(size);
        }
    }

    /// Forces a reconfigure on the next frame (surface lost / outdated).
    pub(crate) fn invalidate(&self) {
        self.configured.set((0, 0));
    }
}

/// Shared instance / adapter / device / queue and pipeline cache (see the module docs).
/// Engines keep it alive through an `Rc`; the device is released with the last reference.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub struct GpuContext {
    pub(crate) instance: wgpu::Instance,
    pub(crate) adapter: wgpu::Adapter,
    pub(crate) device: wgpu::Device,
    pub(crate) queue: wgpu::Queue,
    pub(crate) kind: GpuBackendKind,
    pub(crate) pipelines: KeyedCache<wgpu::TextureFormat, super::wgpu_backend::GpuPipelines>,
    #[cfg(all(target_arch = "wasm32", feature = "webgl"))]
    pub(crate) gl: Option<Rc<SharedGlCanvas>>,
}

impl GpuContext {
    pub fn kind(&self) -> GpuBackendKind {
        self.kind
    }

    /// Pipeline sets compiled so far (one per surface format in use).
    pub fn pipeline_sets(&self) -> usize {
        self.pipelines.len()
    }

    /// Engines currently holding this context (`this` = one handle that is not an engine).
    pub fn engine_count(this: &Rc<Self>) -> usize {
        Rc::strong_count(this).saturating_sub(1)
    }
}

#[cfg(target_arch = "wasm32")]
impl GpuContext {
    /// Requests the shared adapter + device (`pref`: see `BackendPreference`). Error messages
    /// use the same prefixes as `WgpuRenderBackend::from_canvas` (the SDK classifies them).
    pub async fn new(pref: BackendPreference) -> Result<Rc<Self>, String> {
        let mut webgpu_error = None;
        if pref.tries_webgpu() {
            match Self::new_webgpu().await {
                Ok(ctx) => return Ok(Rc::new(ctx)),
                Err(e) if pref.tries_webgl2() => webgpu_error = Some(e),
                Err(e) => return Err(e),
            }
        }
        #[cfg(feature = "webgl")]
        {
            Self::new_webgl2().await.map(Rc::new).map_err(|e| match webgpu_error {
                Some(w) => format!("{e} (WebGPU: {w})"),
                None => e,
            })
        }
        #[cfg(not(feature = "webgl"))]
        {
            // Unreachable: tries_webgpu() is always true without webgl, so WebGPU is always
            // tried and its error returns above. Keep a defensive fallback for the type checker.
            Err(webgpu_error.unwrap_or_else(|| "No suitable GPU adapter found".to_string()))
        }
    }

    async fn new_webgpu() -> Result<Self, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .filter(|a| a.get_info().backend == wgpu::Backend::BrowserWebGpu)
            .ok_or_else(|| "No suitable GPU adapter found".to_string())?;
        let (device, queue) = Self::request_device(&adapter).await?;
        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            kind: GpuBackendKind::WebGpu,
            pipelines: KeyedCache::default(),
            #[cfg(feature = "webgl")]
            gl: None,
        })
    }

    #[cfg(feature = "webgl")]
    async fn new_webgl2() -> Result<Self, String> {
        use wasm_bindgen::JsCast;
        let canvas: web_sys::HtmlCanvasElement = web_sys::window()
            .and_then(|w| w.document())
            .and_then(|d| d.create_element("canvas").ok())
            .and_then(|e| e.dyn_into().ok())
            .ok_or_else(|| "Failed to create wgpu surface: no document to host the shared canvas".to_string())?;
        canvas.set_width(1);
        canvas.set_height(1);
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::GL,
            ..Default::default()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
            .map_err(|e| format!("Failed to create wgpu surface: {e:?}"))?;
        // GL adapters are bound to a surface's WebGL2 context
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "No suitable GPU adapter found".to_string())?;
        let (device, queue) = Self::request_device(&adapter).await?;
        let base_config = super::wgpu_backend::surface_config(&surface, &adapter, 1, 1)?;
        let gl = SharedGlCanvas { surface, canvas, base_config, configured: std::cell::Cell::new((0, 0)) };
        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            kind: GpuBackendKind::WebGl2,
            pipelines: KeyedCache::default(),
            gl: Some(Rc::new(gl)),
        })
    }

    async fn request_device(adapter: &wgpu::Adapter) -> Result<(wgpu::Device, wgpu::Queue), String> {
        let limits = device_limits(adapter);
        adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("charturbo-core-shared-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: limits,
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to request device: {e:?}"))
    }
}

/// Compute is available on WebGPU, while the WebGL2 fallback retains downlevel limits.
#[cfg(target_arch = "wasm32")]
pub(crate) fn device_limits(adapter: &wgpu::Adapter) -> wgpu::Limits {
    let base = if adapter.get_info().backend == wgpu::Backend::Gl {
        wgpu::Limits::downlevel_webgl2_defaults()
    } else {
        wgpu::Limits::default()
    };
    base.using_resolution(adapter.limits())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn keyed_cache_builds_once_per_key() {
        let cache: KeyedCache<u8, String> = KeyedCache::default();
        let builds = Cell::new(0);
        let build = |s: &str| {
            builds.set(builds.get() + 1);
            s.to_string()
        };
        let a = cache.get_or_build(1, || build("bgra8unorm"));
        // 100 engines on the same surface format share one pipeline set
        for _ in 0..100 {
            let again = cache.get_or_build(1, || build("never"));
            assert!(Rc::ptr_eq(&a, &again));
        }
        let b = cache.get_or_build(2, || build("rgba8unorm"));
        assert_eq!((builds.get(), cache.len(), b.as_str()), (2, 2, "rgba8unorm"));
        assert!(!cache.is_empty());
    }

    #[test]
    fn backend_preferences_and_presentation() {
        assert_eq!(BackendPreference::from_u8(0), BackendPreference::Auto);
        assert_eq!(BackendPreference::from_u8(9), BackendPreference::Auto);
        let auto = BackendPreference::Auto;
        assert!(auto.tries_webgpu());
        #[cfg(feature = "webgl")]
        assert!(auto.tries_webgl2());
        #[cfg(not(feature = "webgl"))]
        assert!(!auto.tries_webgl2());
        let gpu = BackendPreference::from_u8(1);
        assert!(gpu.tries_webgpu() && !gpu.tries_webgl2());
        assert!(!GpuBackendKind::WebGpu.presents_via_shared_canvas());
        assert_eq!(GpuBackendKind::WebGpu.name(), "webgpu");
        #[cfg(feature = "webgl")]
        {
            let gl = BackendPreference::from_u8(2);
            assert!(!gl.tries_webgpu() && gl.tries_webgl2());
            assert!(GpuBackendKind::WebGl2.presents_via_shared_canvas());
            assert_eq!(GpuBackendKind::WebGl2.name(), "webgl2");
        }
    }
}
