//! WASM bindings of the shared GPU device (`renderer::gpu_context`): one adapter / device /
//! pipeline set for many engines (dashboards, tables of sparklines). Kept apart from `lib.rs`.

use crate::renderer::gpu_context::GpuContext;
use crate::WasmVizEngine;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

/// Shared GPU device handle. Engines created on it hold their own reference: freeing this
/// handle does not stop them, and the device is released once the handle and every engine
/// created on it are freed.
#[wasm_bindgen]
pub struct WasmGpuDevice {
    ctx: Rc<GpuContext>,
}

#[wasm_bindgen]
impl WasmGpuDevice {
    /// Requests the shared device. `backend`: 0 = auto (WebGPU, else WebGL2), 1 = WebGPU only,
    /// 2 = WebGL2 only. Errors use the `WasmVizEngine::create` message prefixes.
    #[cfg(target_arch = "wasm32")]
    pub async fn create(backend: u8) -> Result<WasmGpuDevice, JsValue> {
        console_error_panic_hook::set_once();
        let pref = crate::renderer::gpu_context::BackendPreference::from_u8(backend);
        let ctx = GpuContext::new(pref).await.map_err(|e| JsValue::from_str(&e))?;
        Ok(WasmGpuDevice { ctx })
    }

    /// `"webgpu"` or `"webgl2"` (WebGL2: engines present through one shared canvas + 2D copy).
    pub fn backend(&self) -> String {
        self.ctx.kind().name().to_string()
    }

    /// Engines currently alive on this device.
    pub fn engine_count(&self) -> u32 {
        GpuContext::engine_count(&self.ctx) as u32
    }

    /// Render pipeline sets compiled (one per surface format, however many engines).
    pub fn pipeline_sets(&self) -> u32 {
        self.ctx.pipeline_sets() as u32
    }

    /// Per-engine GPU bytes allocated at creation for a `width x height` px canvas (buffers,
    /// uniforms, depth texture), excluding the shared pipelines and the swap chain.
    pub fn engine_gpu_bytes(width: u32, height: u32) -> f64 {
        crate::renderer::wgpu_backend::engine_gpu_bytes(true, width, height) as f64
    }
}

#[wasm_bindgen]
impl WasmVizEngine {
    /// Engine on a shared device (`WasmGpuDevice`): no adapter / device request and no pipeline
    /// compilation (cached per surface format), compact initial buffers. WebGPU canvases get
    /// their own surface; WebGL2 canvases a `2d` context the shared GL canvas is copied into.
    #[cfg(target_arch = "wasm32")]
    pub fn create_with_device(
        device: &WasmGpuDevice,
        canvas: web_sys::HtmlCanvasElement,
        seed: u32,
        node_count: usize,
        edge_count: usize,
        cluster_count: usize,
    ) -> Result<WasmVizEngine, JsValue> {
        use crate::camera::OrbitCamera;
        use crate::domain::{DatasetConfig, GraphDataset};
        use crate::engine::VisualizationEngine;
        use crate::physics::{ForceConfig, ForceDirectedSimulator};
        use crate::spatial::OctreeSpatialIndex;

        console_error_panic_hook::set_once();
        let width = canvas.width().max(1);
        let height = canvas.height().max(1);
        let renderer = crate::renderer::wgpu_backend::WgpuRenderBackend::from_context(&device.ctx, canvas.clone())
            .map_err(|e| JsValue::from_str(&e))?;
        let dataset = GraphDataset::generate_seeded(&DatasetConfig {
            seed,
            node_count,
            edge_count,
            cluster_count,
            space_radius: 100.0,
        });
        let simulator = Box::new(ForceDirectedSimulator::new(OctreeSpatialIndex::compact(10), ForceConfig::default()));
        let camera = OrbitCamera::new(220.0, width as f32 / height as f32);
        let mut engine = WasmVizEngine {
            inner: VisualizationEngine::new(dataset, simulator, camera, Box::new(renderer)),
            canvas,
        };
        engine.resize(width, height);
        Ok(engine)
    }
}
