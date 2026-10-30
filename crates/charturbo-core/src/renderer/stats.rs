//! GPU-side counters of a render backend (`RenderBackend::stats`): buffer / texture bytes,
//! chart upload traffic and staged instance counts, for benchmarks and diagnostics.

use super::ChartLayers;

/// Snapshot of `RenderBackend::stats`. Backends without counters report zeros.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RenderStats {
    /// Bytes allocated in vertex / instance buffers and chart textures (capacity, not length)
    pub gpu_bytes: u64,
    /// Bytes written by the last chart sync (0 when no chart layer changed)
    pub chart_upload_bytes: u64,
    /// Bytes written by every chart sync since the backend was created
    pub chart_upload_total: u64,
    /// Chart syncs that wrote at least one layer
    pub chart_uploads: u64,
    /// Frames rendered (`render_frame` calls)
    pub frames: u64,
    /// Staged instances of the last upload of each layer
    pub series_segments: u32,
    pub points: u32,
    pub bars: u32,
    pub fill_vertices: u32,
    pub markers: u32,
}

/// Bytes `sync_chart` writes for `layers` (layers passed as `None` are not uploaded).
pub fn chart_layer_bytes(layers: &ChartLayers<'_>) -> u64 {
    fn bytes<T>(v: Option<&[T]>) -> u64 {
        v.map_or(0, |v| std::mem::size_of_val(v) as u64)
    }
    let annotation = |l: &Option<super::ChartAnnotationLayer<'_>>| {
        l.as_ref().map_or(0, |l| bytes(Some(l.fills)) + bytes(Some(l.lines)) + bytes(Some(l.markers)))
    };
    bytes(layers.underlay)
        + bytes(layers.bars)
        + bytes(layers.bar_decals)
        + bytes(layers.fill_decals)
        + bytes(layers.series)
        + layers.series_style.as_ref().map_or(0, |l| bytes(Some(l.dashed)) + bytes(Some(l.markers)))
        + bytes(layers.overlay)
        + bytes(layers.markers)
        + bytes(layers.fills)
        + bytes(layers.contours_3d)
        + if layers.fills.is_none() { layers.fill_patch.as_ref().map_or(0, |p| p.bytes()) } else { 0 }
        + layers.fill_style.map_or(0, |s| std::mem::size_of_val(&s) as u64)
        + bytes(layers.points)
        + annotation(&layers.annotations_below)
        + annotation(&layers.annotations_above)
        + annotation(&layers.brush)
        + annotation(&layers.navigator)
        + annotation(&layers.navigator_window)
        + layers.heatmap.as_ref().map_or(0, |g| std::mem::size_of_val(g.values) as u64)
        + bytes(layers.heatmap_lut)
        + bytes(layers.parallel)
        + bytes(layers.parallel_flags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::{ChartPointRaw, ChartSegmentRaw};

    #[test]
    fn layer_bytes_count_only_uploaded_layers() {
        let seg = [<ChartSegmentRaw as bytemuck::Zeroable>::zeroed(); 3];
        let pts = [<ChartPointRaw as bytemuck::Zeroable>::zeroed(); 2];
        let mut layers = ChartLayers::default();
        assert_eq!(chart_layer_bytes(&layers), 0);
        layers.series = Some(&seg);
        layers.points = Some(&pts);
        let want = 3 * std::mem::size_of::<ChartSegmentRaw>() + 2 * std::mem::size_of::<ChartPointRaw>();
        assert_eq!(chart_layer_bytes(&layers), want as u64);
    }
}
