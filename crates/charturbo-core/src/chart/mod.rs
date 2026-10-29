//! Native high-volume chart layer (line / area / bar / scatter / heatmap).
//!
//! Owns everything between raw values and GPU instances: world-space layout, screen-resolution
//! level-of-detail (M4 decimation), hover hit-testing (index / nearest), hover overlays
//! (crosshair, markers, bar highlight), gridlines, and camera framing. Strokes and markers are
//! sized in CSS pixels and expanded on the GPU, so zooming never requires re-tessellation.

use crate::camera::OrbitCamera;
use crate::renderer::{ChartBarRaw, ChartFillRaw, ChartLayers, ChartMarkerRaw, ChartPointRaw, ChartSegmentRaw};
use crate::renderer::ChartHeatmapGrid;
use crate::renderer::{ChartFillPatch, ChartFillStyleRaw};
use crate::scene::{BodyType, Material, PrimitiveKind, SceneWorld};
use crate::spatial::Ray;
use glam::{Vec3, Vec4};

mod animation;
mod area;
mod annotations;
mod bar;
mod bar_style;
mod boxplot;
mod brush;
mod candle;
mod combo;
mod fill;
mod finite;
mod funnel;
mod gauge;
mod histogram;
mod heatmap;
mod hierarchy;
#[cfg(test)]
mod hierarchy_emphasis_tests;
mod line;
mod linestyle;
mod navigator;
mod pie;
mod pieces;
mod radar;
mod range;
mod regression;
mod sankey;
mod scale;
mod scatter;
mod shape;
mod sparkline;
mod sparse;
mod scientific3d;
pub use scientific3d::{Scientific3DSeries, Scientific3DOptions, Scientific3DContours};
use scientific3d::Scientific3D;
#[cfg(test)]
mod scientific3d_tests;
mod svg;
mod sunburst;
mod sync;
mod theme_river;
mod ticks;
mod time_ticks;
mod time_zone;
mod waterfall;
mod zoom;
mod treemap;

pub use animation::{AnimSnapshot, AnimationOptions, Easing, MAX_ANIMATED_MARKS};
use area::AreaChart;
pub use area::{validate_area, AreaMode};
pub use annotations::{AnnotationKind, AnnotationLabel, AnnotationLayer, ChartAnnotation, LabelPosition};
use annotations::Annotations;
use bar::BarChart;
use boxplot::BoxChart;
pub use boxplot::{
    compute_box_stats, kde_binned, silverman_bandwidth, validate_box_plot, BoxLayout, BoxPlotOptions, BoxStats,
    ViolinOptions, ViolinScale, WhiskerRule, DEFAULT_MAX_OUTLIERS, KDE_POINTS,
};
use brush::Brush;
pub use brush::{BrushMode, BrushStyle, ChartSelection, SelectionKind};
pub use bar::{BarMode, BarSeriesLayout};
pub use bar_style::{BarLabel, BarLabelMode, BarLabelOptions, BarLabelPosition, BarOrientation, BarStyle};
use candle::CandleChart;
use combo::ComboChart;
pub use combo::{validate_combo, ComboLayout, ComboSeries, ComboSeriesKind};
pub use candle::{validate_candles, CandleData, CandleLayout, CandleMode, CandleSample, CandleStyle};
pub use fill::band_triangles;
pub use histogram::{compute_histogram, BinRule, Histogram, HistogramBins, HistogramOptions};
use heatmap::HeatmapChart;
pub use heatmap::{
    colormap_lut, validate_heatmap, ColormapKind, HeatmapColorbar, HeatmapColormap, HeatmapDomain, HeatmapLayout,
    ValueScale, MAX_HEATMAP_CELLS,
};
use line::{LineChart, LodWindow};
pub use line::validate_line_x;
pub use linestyle::{
    normalize_dash, LineCurve, LineSeriesStyle, MarkerShape, MarkerShow, NullPolicy, SeriesMarker,
    AUTO_MARKER_MIN_PX, DEFAULT_BAND_OPACITY,
};
use linestyle::{StyleCtx, StyledSeries};
pub use pieces::{ColorPiece, PieceDim, SeriesPieces};
use navigator::Navigator;
pub use time_zone::TimeZone;
pub use navigator::{NavigatorHit, NavigatorOptions, NavigatorStyle, DEFAULT_NAVIGATOR_HEIGHT_PX};
use scatter::ScatterChart;
use pie::PieChart;
use funnel::FunnelChart;
pub use funnel::{funnel_stages, validate_funnel, FunnelLabel, FunnelOptions, FunnelOrientation, FunnelShape, FunnelStage, FUNNEL_GAP_PX};
use gauge::GaugeChart;
pub use gauge::{validate_gauge, GaugeBand, GaugeIndicator, GaugeLabel, GaugeLayoutInfo, GaugeOptions, GaugeStyle};
use radar::RadarChart;
pub use radar::{validate_radar, RadarGridShape, RadarLabel, RadarLayoutInfo, RadarOptions, DEFAULT_RADAR_FILL_OPACITY};
use waterfall::WaterfallChart;
pub use waterfall::{compute_waterfall, validate_waterfall, WaterfallItem, WaterfallKind, WaterfallOptions, WaterfallStyle};
pub use pie::{
    fold_slices, validate_pie, validate_pie_rings, PieLabel, PieLabelMode, PieLayoutInfo, PieOptions, PieRing, PieRose, PieSlice, PieSort, PieStyle,
    DEFAULT_PIE_MAX_SLICES, PIE_CHORD_ERROR_PX, PIE_EXPLODE_PX, PIE_GAP_PX,
};
use hierarchy::HierChart;
pub use hierarchy::{HierarchyColorBy, HierarchyLabel, HierarchyLayoutInfo, HierarchyStyle, Tree, NO_PARENT};
pub use sankey::{
    validate_sankey, SankeyAlign, SankeyChart, SankeyGraph, SankeyLevel, SankeyLink, SankeyLinkColor, SankeyNode, SankeyOptions, SankeyOrient,
};
pub use sunburst::{SunburstOptions, SUNBURST_GAP_PX};
pub use treemap::{squarify, TreemapOptions, MAX_TREEMAP_LABELS, TREEMAP_GAP_PX};
pub use scale::{log_nice_domain, log_ticks, AxisScale, ScaleType};
pub use regression::{fit_trend, TrendFit, TrendModel, MAX_TREND_ORDER};
pub use scatter::{RippleOptions, ScatterLayout, ScatterPoints, ScatterTrendline};
pub use sparkline::{SparklineMarks, SparklineSummary};
pub use svg::{SvgExport, SvgSupport, SVG_DEFAULT_MAX_MARKS};
pub use zoom::ZOOM_HISTORY_MAX;
pub use theme_river::{stream_baseline, stream_order, StreamLabel, StreamOffset, StreamOrder};
use sparkline::Sparkline;
pub use ticks::{nice_domain, nice_step};
use ticks::ticks_between;

/// Chart render surface color (matches the renderer clear color); default marker ring color.
pub const CHART_SURFACE: [f32; 4] = [0.035, 0.045, 0.08, 1.0];

/// Depth step between overlapping 2D series so later series draw on top without z-fighting.
pub(crate) const SERIES_Z_STEP_2D: f32 = 0.02;
/// Depth gap between 2.5D series ribbons.
pub(crate) const SERIES_Z_STEP_LAYERED: f32 = 14.0;
/// Hover accepts pointers this fraction of the plot height outside the plot.
pub(crate) const HOVER_Y_SLACK: f32 = 0.06;
/// Max samples inspected on each side of the pointer in nearest-mode hit-testing.
pub(crate) const NEAREST_MAX_WINDOW: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChartViewMode {
    /// Camera faces the chart plane head-on (2D)
    Flat,
    /// Perspective view: 2.5D layered lines / 3D bar matrix
    Depth,
}

impl ChartViewMode {
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Depth
        } else {
            Self::Flat
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoverMode {
    /// Every series at the hovered x (crosshair)
    Index,
    /// Only the closest data point
    Nearest,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartHoverStyle {
    pub mode: HoverMode,
    pub crosshair: bool,
    pub crosshair_color: [f32; 4],
    pub crosshair_width_px: f32,
    pub marker: bool,
    pub marker_radius_px: f32,
    pub marker_ring_color: [f32; 4],
    pub marker_ring_px: f32,
    /// Hovered bar color; `None` lightens the bar color by 22%
    pub bar_highlight_color: Option<[f32; 4]>,
    /// Nearest-mode pick radius in CSS px
    pub hit_radius_px: f32,
}

impl Default for ChartHoverStyle {
    fn default() -> Self {
        Self {
            mode: HoverMode::Index,
            crosshair: true,
            crosshair_color: [0.58, 0.64, 0.72, 0.55],
            crosshair_width_px: 1.0,
            marker: true,
            marker_radius_px: 4.0,
            marker_ring_color: CHART_SURFACE,
            marker_ring_px: 2.0,
            bar_highlight_color: None,
            hit_radius_px: 24.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartFrameStyle {
    pub show_grid: bool,
    /// Target number of y-axis ticks (gridlines land on "nice" 1 / 2 / 5 x 10^n values)
    pub grid_rows: u32,
    pub grid_color: [f32; 4],
    pub baseline_color: [f32; 4],
    pub stroke_px: f32,
}

impl Default for ChartFrameStyle {
    fn default() -> Self {
        Self {
            show_grid: true,
            grid_rows: 5,
            grid_color: [0.13, 0.17, 0.24, 1.0],
            baseline_color: [0.36, 0.42, 0.52, 1.0],
            stroke_px: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LineSeries {
    pub values: Vec<f32>,
    /// Optional x of each sample (same length as `values`, finite, non-decreasing). Given for
    /// every series or none; `None` places samples evenly by index.
    pub x: Option<Vec<f64>>,
    pub color: [f32; 4],
    pub width_px: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineLayout {
    pub width: f32,
    pub height: f32,
    pub view: ChartViewMode,
    /// Tick scale of explicit x values (ignored without x)
    pub x_kind: LineXKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineXKind {
    /// Nice 1 / 2 / 5 x 10^n ticks
    #[default]
    Numeric,
    /// x is epoch milliseconds: ticks on calendar boundaries of the chart time zone (UTC default)
    Time,
}

impl LineXKind {
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Time
        } else {
            Self::Numeric
        }
    }
}

/// How the y domain of a line chart follows the data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum YAutoscale {
    /// Extent of all data (every series, hidden ones too), re-derived when data changes
    #[default]
    All,
    /// Extent of the visible series inside the x zoom window, re-derived on zoom / pan / data
    /// changes with hysteresis (see `LineChart::update_y_domain`)
    Visible,
    /// Derived once from all data, then kept while data changes
    None,
}

impl YAutoscale {
    /// 0 = all, 1 = visible, 2 = none
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Visible,
            2 => Self::None,
            _ => Self::All,
        }
    }
}

/// y domain control of a line chart.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineYAxis {
    /// Fixed bottom of the domain (`None` = from the data)
    pub min: Option<f64>,
    /// Fixed top of the domain (`None` = from the data)
    pub max: Option<f64>,
    pub autoscale: YAutoscale,
    /// Expand data-derived ends outward to whole tick steps (fixed ends are kept exactly)
    pub nice: bool,
}

impl Default for LineYAxis {
    fn default() -> Self {
        Self { min: None, max: None, autoscale: YAutoscale::All, nice: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BarLayout {
    pub width: f32,
    pub max_height: f32,
    /// 0 = automatic (72% of the slot)
    pub bar_width: f32,
    pub corner_radius_px: f32,
    pub view: ChartViewMode,
}

/// One hovered data point. `global_id` = series offset + sample index (bar index for bars).
/// Line / area ids are re-based by every data update:
/// offsets are prefix sums of the current lengths and indices count from the oldest kept sample.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HoverItem {
    pub series: u32,
    pub index: u32,
    pub value: f32,
    pub global_id: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HoverResult {
    pub is_bar: bool,
    /// Slot in `items` of the point closest to the pointer
    pub primary: usize,
    pub items: Vec<HoverItem>,
}

/// Plot margins in CSS px `[top, right, bottom, left]`, reserved for axis labels, legend, title.
pub type ChartPadding = [f32; 4];

pub const DEFAULT_CHART_PADDING: ChartPadding = [16.0, 16.0, 32.0, 56.0];

/// Axis tick for label rendering: which axis, its data value, and its anchor in CSS px from the
/// canvas top-left (y ticks anchor on the plot's left edge, right-axis y ticks on its right edge,
/// x ticks on its bottom edge).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AxisTick {
    /// 0 = x, 1 = y (left), 2 = right y (dual-axis line charts)
    pub axis: u8,
    pub value: f64,
    pub x_css: f32,
    pub y_css: f32,
    /// Time ticks: coarsest UTC boundary of `value` (1 = ms, 2 = s, 3 = min, 4 = h, 5 = day,
    /// 6 = month, 7 = year) so labels can pick a format; 0 = not a time tick
    pub granularity: u8,
}

/// Screen layout of the plot for DOM labels: plot rectangle `[left, top, width, height]` in CSS
/// px from the canvas top-left, plus visible ticks.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AxisLayout {
    pub plot_css: [f32; 4],
    pub ticks: Vec<AxisTick>,
}


/// Per-frame view parameters the chart needs for LOD and pixel-space hit-testing.
#[derive(Debug, Clone, Copy)]
pub struct ChartView<'a> {
    pub camera: &'a OrbitCamera,
    pub viewport_px: (u32, u32),
    pub pixel_ratio: f32,
}

impl ChartView<'_> {
    /// Physical-pixel position of a world point relative to the viewport center (+y up).
    pub(crate) fn project_px(&self, p: Vec3) -> Option<(f32, f32)> {
        let c = self.camera.view_proj_matrix() * Vec4::new(p.x, p.y, p.z, 1.0);
        if c.w <= 1e-4 {
            return None;
        }
        Some((
            c.x / c.w * 0.5 * self.viewport_px.0 as f32,
            c.y / c.w * 0.5 * self.viewport_px.1 as f32,
        ))
    }

    pub(crate) fn ndc_to_px(&self, ndc_x: f32, ndc_y: f32) -> (f32, f32) {
        (
            ndc_x * 0.5 * self.viewport_px.0 as f32,
            ndc_y * 0.5 * self.viewport_px.1 as f32,
        )
    }

    /// CSS px from the canvas top-left of a world point.
    pub(crate) fn project_css(&self, p: Vec3) -> Option<(f32, f32)> {
        let (x, y) = self.project_px(p)?;
        let pr = self.pixel_ratio.max(0.1);
        Some((
            (x + 0.5 * self.viewport_px.0 as f32) / pr,
            (0.5 * self.viewport_px.1 as f32 - y) / pr,
        ))
    }

    /// Cache key of everything that moves screen positions.
    pub(crate) fn key(&self) -> [f32; 19] {
        let m = self.camera.view_proj_matrix().to_cols_array();
        let mut k = [0.0; 19];
        k[..16].copy_from_slice(&m);
        k[16] = self.viewport_px.0 as f32;
        k[17] = self.viewport_px.1 as f32;
        k[18] = self.pixel_ratio;
        k
    }
}

/// Head-on 2D framing: `width x height` world rect fills the canvas minus `padding` (CSS px).
pub(crate) fn frame_flat(camera: &mut OrbitCamera, css: (f32, f32), width: f32, height: f32, padding: &ChartPadding) {
    frame_flat_at(camera, css, (0.0, 0.0), width, height, padding);
}

/// `frame_flat` for a `width` x `height` world rect centered on `center` instead of the origin.
pub(crate) fn frame_flat_at(camera: &mut OrbitCamera, css: (f32, f32), center: (f32, f32), width: f32, height: f32, padding: &ChartPadding) {
    let (w_css, h_css) = css;
    let [top, right, bottom, left] = *padding;
    let plot_w = (w_css - left - right).max(w_css * 0.2);
    let plot_h = (h_css - top - bottom).max(h_css * 0.2);
    // CSS px per world unit, limited by the tighter axis
    let s = (plot_w / width.max(1e-3)).min(plot_h / height.max(1e-3));
    let visible_h = h_css / s;
    let distance = camera.distance_for_visible_height(visible_h);
    // Shift the camera so the plot centre lands in the centre of the padded area
    let target = Vec3::new(center.0 - (left - right) * 0.5 / s, center.1 - (bottom - top) * 0.5 / s, 0.0);
    camera.set_pose(target + Vec3::new(0.0, 0.0, distance), target);
}

/// Plot rectangle `[left, top, width, height]` (CSS px) of a world rect at depth `z`.
pub(crate) fn plot_rect_css(view: &ChartView, half_w: f32, y0: f32, y1: f32, z: f32) -> Option<[f32; 4]> {
    let a = view.project_css(Vec3::new(-half_w, y1, z))?;
    let b = view.project_css(Vec3::new(half_w, y0, z))?;
    let (l, r) = (a.0.min(b.0), a.0.max(b.0));
    let (t, btm) = (a.1.min(b.1), a.1.max(b.1));
    Some([l, t, r - l, btm - t])
}

/// Intersects `ray` with the plane `z = plane_z`.
pub(crate) fn ray_hit_z_plane(ray: &Ray, plane_z: f32) -> Option<Vec3> {
    if ray.direction.z.abs() < 1e-6 {
        return None;
    }
    let t = (plane_z - ray.origin.z) / ray.direction.z;
    if t < 0.0 {
        return None;
    }
    Some(ray.origin + ray.direction * t)
}

/// Isometric-style framing that keeps a bounding sphere fully in view.
pub(crate) fn frame_oblique(camera: &mut OrbitCamera, center: Vec3, radius: f32) {
    camera.fit_to_bounds(center, radius * 0.92);
    let dir = Vec3::new(0.44, 0.34, 0.84).normalize();
    camera.set_pose(center + dir * camera.distance(), center);
}

pub(crate) fn lighten(c: [f32; 4], amount: f32) -> [f32; 4] {
    [
        c[0] + (1.0 - c[0]) * amount,
        c[1] + (1.0 - c[1]) * amount,
        c[2] + (1.0 - c[2]) * amount,
        c[3],
    ]
}

// -----------------------------------------------------------------------------
// Chart state (owned by the engine)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum ChartKind {
    Scientific3D(Scientific3D),
    Line(LineChart),
    Area(AreaChart),
    Bar(BarChart),
    Scatter(ScatterChart),
    Candle(CandleChart),
    Heatmap(HeatmapChart),
    Box(BoxChart),
    Pie(PieChart),
    /// Boxed: bars + lines make it the largest kind by far
    Combo(Box<ComboChart>),
    Radar(RadarChart),
    Gauge(GaugeChart),
    Funnel(FunnelChart),
    Waterfall(WaterfallChart),
    /// Treemap / sunburst / sankey (hierarchy.rs)
    Hierarchy(HierChart),
}

#[derive(Debug, Default, Clone, Copy)]
struct Dirty {
    underlay: bool,
    series: bool,
    bars: bool,
    overlay: bool,
    fills: bool,
    points: bool,
    point_style: bool,
    /// Heatmap value grid / colormap LUT / window + scale uniform
    heatmap: bool,
    heatmap_lut: bool,
    heatmap_style: bool,
    /// Fill emphasis uniform (hierarchy hover / legend emphasis)
    fill_style: bool,
}

impl Dirty {
    fn all() -> Self {
        Self {
            underlay: true,
            series: true,
            bars: true,
            overlay: true,
            fills: true,
            points: true,
            point_style: true,
            heatmap: true,
            heatmap_lut: true,
            heatmap_style: true,
            fill_style: true,
        }
    }
}

/// Active chart: data, styles, hover state, and CPU staging for GPU instances.
#[derive(Debug, Clone)]
pub struct ChartState {
    kind: ChartKind,
    hover_style: ChartHoverStyle,
    frame_style: ChartFrameStyle,
    hover: Option<HoverResult>,
    /// Last hovered pointer (NDC): data updates re-pick there (`refresh_hover`)
    hover_ndc: Option<(f32, f32)>,
    /// Last synced cursor x (`hover_at_data_x`): data updates re-pick there instead
    hover_x: Option<f64>,
    lod: Option<LodWindow>,
    dirty: Dirty,
    underlay: Vec<ChartSegmentRaw>,
    series: Vec<ChartSegmentRaw>,
    bars: Vec<ChartBarRaw>,
    overlay: Vec<ChartSegmentRaw>,
    markers: Vec<ChartMarkerRaw>,
    /// Filled areas (triangle list); empty until an area chart kind fills it
    fills: Vec<ChartFillRaw>,
    /// Scientific 3D surface isolines (line list); empty for every other kind
    contours_3d: Vec<ChartFillRaw>,
    /// Vertex ranges of `fills` re-written this frame (uploaded alone when `fills` is not dirty)
    fill_patches: Vec<(u32, u32)>,
    /// Emphasis uniform of tagged fill vertices (renderer/fill_style.rs)
    fill_style: ChartFillStyleRaw,
    points: Vec<ChartPointRaw>,
    padding: ChartPadding,
    axes: AxisLayout,
    axes_scratch: AxisLayout,
    /// View key + zoom window (x0, x1, y0, y1) the axes were computed for
    axes_key: Option<([f32; 19], [f32; 4])>,
    /// Bumped whenever `axes` changes, so the DOM only re-lays out labels when needed
    axes_revision: u32,
    /// Reference lines / bands / markers in data units (see annotations.rs)
    annotations: Annotations,
    /// Brush rectangle and committed selection (see brush.rs)
    brush: Brush,
    /// Range selector strip under 2D line / area plots (see navigator.rs)
    navigator: Navigator,
    /// Sparkline last / min / max markers and reference band (see sparkline.rs)
    sparkline: Option<Sparkline>,
    /// Zone of time x axes (empty table = UTC; see time_zone.rs)
    time_zone: TimeZone,
    /// Dashed strokes / point markers / band fills of styled line series (see linestyle.rs)
    styled: StyledSeries,
    /// Enter / update animation state and buffers (see animation.rs)
    anim: animation::Animator,
    /// Undo / redo zoom steps (see zoom.rs)
    zoom_history: zoom::ZoomHistory,
}

impl ChartState {
    fn with_kind(kind: ChartKind) -> Self {
        Self {
            kind,
            hover_style: ChartHoverStyle::default(),
            frame_style: ChartFrameStyle::default(),
            hover: None,
            hover_ndc: None,
            hover_x: None,
            lod: None,
            dirty: Dirty::all(),
            underlay: Vec::new(),
            series: Vec::new(),
            bars: Vec::new(),
            overlay: Vec::new(),
            markers: Vec::new(),
            fills: Vec::new(),
            contours_3d: Vec::new(),
            fill_patches: Vec::new(),
            fill_style: ChartFillStyleRaw::default(),
            points: Vec::new(),
            padding: DEFAULT_CHART_PADDING,
            axes: AxisLayout::default(),
            axes_scratch: AxisLayout::default(),
            axes_key: None,
            axes_revision: 0,
            annotations: Annotations::default(),
            brush: Brush::default(),
            navigator: Navigator::default(),
            sparkline: None,
            time_zone: TimeZone::default(),
            styled: StyledSeries::default(),
            anim: Default::default(),
            zoom_history: Default::default(),
        }
    }

    pub fn new_line(series: Vec<LineSeries>, layout: LineLayout) -> Self {
        Self::with_kind(ChartKind::Line(LineChart::new(series, layout)))
    }

    /// Creates a 2D area chart (overlapping / stacked / percent-stacked); `fill_opacity` NaN =
    /// mode default. Stacked modes expect aligned series (see `validate_area`).
    pub fn new_area(series: Vec<LineSeries>, layout: LineLayout, mode: AreaMode, fill_opacity: f32) -> Self {
        Self::with_kind(ChartKind::Area(AreaChart::new(series, layout, mode, fill_opacity)))
    }

    /// Creates a single-series bar chart; the 3D matrix view spawns its boxes into `scene`.
    pub fn new_bar(values: Vec<f32>, colors: Vec<[f32; 4]>, layout: BarLayout, scene: &mut SceneWorld) -> Self {
        Self::new_bar_series(values, colors, layout, BarSeriesLayout::default(), scene)
    }

    /// Creates a grouped / stacked bar chart from flat `[s * categories + i]` values and one
    /// color per series (per bar when there is a single series). 3D shows the first series only.
    pub fn new_bar_series(
        values: Vec<f32>,
        colors: Vec<[f32; 4]>,
        layout: BarLayout,
        series: BarSeriesLayout,
        scene: &mut SceneWorld,
    ) -> Self {
        let mut bar = BarChart::new(values, colors, layout, series);
        bar.spawn_scene_objects(scene);
        Self::with_kind(ChartKind::Bar(bar))
    }

    /// Creates a 2D scatter / bubble chart (points are packed once and drawn instanced).
    pub fn new_scatter(points: ScatterPoints, layout: ScatterLayout) -> Self {
        Self::with_kind(ChartKind::Scatter(ScatterChart::new(points, layout)))
    }

    /// Removes scene objects owned by the chart (3D bars).
    pub fn release(&mut self, scene: &mut SceneWorld) {
        if let ChartKind::Bar(bar) = &mut self.kind {
            bar.despawn_scene_objects(scene);
        }
    }

    /// Frames the camera so the plot fills the canvas (`css` size) minus the padding.
    pub fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32)) {
        match &self.kind {
            ChartKind::Scientific3D(c) => c.frame_camera(camera),
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l.frame_camera(camera, css, &self.frame_padding()),
            ChartKind::Bar(b) => b.frame_camera(camera, css, &self.padding),
            ChartKind::Scatter(s) => s.frame_camera(camera, css, &self.padding),
            ChartKind::Candle(c) => c.frame_camera(camera, css, &self.padding),
            ChartKind::Heatmap(h) => h.frame_camera(camera, css, &self.padding),
            ChartKind::Box(b) => b.frame_camera(camera, css, &self.padding),
            ChartKind::Pie(p) => p.frame_camera(camera, css, &self.padding),
            ChartKind::Combo(c) => c.line.frame_camera(camera, css, &self.padding),
            ChartKind::Radar(r) => r.frame_camera(camera, css, &self.padding),
            ChartKind::Gauge(g) => g.frame_camera(camera, css, &self.padding),
            ChartKind::Funnel(f) => f.frame_camera(camera, css, &self.padding),
            ChartKind::Waterfall(w) => w.bar.frame_camera(camera, css, &self.padding),
            ChartKind::Hierarchy(h) => h.frame_camera(camera, css, &self.padding),
        }
    }

    pub fn set_padding(&mut self, padding: ChartPadding) {
        self.padding = padding.map(|p| if p.is_finite() { p.clamp(0.0, 4096.0) } else { 0.0 });
    }

    pub fn padding(&self) -> ChartPadding {
        self.padding
    }

    /// Number of series (line series, or bar series; 1 for a plain bar chart).
    pub fn series_count(&self) -> usize {
        match &self.kind {
            ChartKind::Scientific3D(c) => c.series.len(),
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l.series.len(),
            ChartKind::Bar(b) => b.series_count,
            ChartKind::Scatter(s) => s.visible.len(),
            ChartKind::Candle(_) => 1,
            ChartKind::Heatmap(_) => 0,
            ChartKind::Box(b) => b.series_count,
            ChartKind::Pie(p) => p.len(),
            ChartKind::Combo(c) => c.len(),
            ChartKind::Radar(r) => r.series,
            ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => 1,
            ChartKind::Hierarchy(h) => h.series_count(),
        }
    }

    /// Shows / hides a series (legend toggle). The line y domain stays fixed unless it autoscales
    /// to the visible extent; bar stacks / groups are re-laid out without the hidden series.
    pub fn set_series_visible(&mut self, series: usize, visible: bool, scene: &mut SceneWorld) {
        let changed = match &mut self.kind {
            ChartKind::Scientific3D(c) => {
                if let Some(v) = c.visible.get_mut(series) { let changed = *v != visible; *v = visible; self.dirty.series |= changed; self.dirty.fills |= changed; changed } else { false }
            }
            ChartKind::Line(l) => match l.visible.get_mut(series) {
                Some(v) if *v != visible => {
                    *v = visible;
                    self.dirty.series = true;
                    // Visible-extent autoscale follows the shown series
                    if l.update_y_domain(false) {
                        self.dirty.underlay = true;
                        self.dirty.overlay = true;
                        self.axes_key = None;
                    }
                    true
                }
                _ => false,
            },
            ChartKind::Area(a) => {
                let changed = a.set_visible(series, visible);
                self.dirty.series |= changed;
                if changed {
                    self.dirty.underlay = true;
                    self.axes_key = None;
                }
                changed
            }
            ChartKind::Bar(b) => {
                let changed = b.set_visible(series, visible);
                self.dirty.bars |= changed;
                changed
            }
            ChartKind::Scatter(s) => {
                let in_uniform = s.series_in_uniform();
                match s.visible.get_mut(series) {
                    Some(v) if *v != visible => {
                        *v = visible;
                        // Per-series alpha in the point uniform: no point re-upload
                        self.dirty.point_style |= in_uniform;
                        self.dirty.points |= !in_uniform;
                        true
                    }
                    _ => false,
                }
            }
            ChartKind::Candle(_) => false,
            ChartKind::Heatmap(_) => false,
            ChartKind::Box(b) => {
                let changed = b.set_visible(series, visible);
                // Groups re-center: the outlier hover ring moves too
                self.dirty.bars |= changed;
                self.dirty.overlay |= changed;
                changed
            }
            ChartKind::Pie(p) => {
                let changed = p.set_visible(series, visible);
                self.dirty.fills |= changed;
                self.dirty.underlay |= changed;
                changed
            }
            // Bars restack / regroup, strokes and area fills rebuild
            ChartKind::Combo(c) => {
                let (bars, lines) = c.set_visible(series, visible);
                self.dirty.bars |= bars;
                self.dirty.series |= lines;
                bars || lines
            }
            ChartKind::Radar(r) => {
                let changed = r.set_visible(series, visible);
                self.dirty.series |= changed;
                self.dirty.fills |= changed;
                changed
            }
            // One fixed series (no legend toggles)
            ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => false,
            // Legend groups of hierarchy charts only emphasize
            ChartKind::Hierarchy(_) => false,
        };
        // A hidden series must not stay hovered; bar layouts / stacked areas moved either way, so
        // drop any bar hover or stacked-area hover
        if changed {
            // Hidden series drop out of the selection (re-queried on read)
            self.brush.invalidate();
        }
        let restacked = matches!(&self.kind, ChartKind::Area(a) if a.mode.stacks());
        // Pie slices re-lay out their angles
        let restacked = restacked || matches!(self.kind, ChartKind::Pie(_));
        // Combo bars restack / regroup and the shared tooltip lists the visible series: re-pick
        let restacked = restacked || matches!(self.kind, ChartKind::Combo(_));
        let stale = |h: &HoverResult| {
            h.is_bar || restacked || (!visible && h.items.iter().any(|i| i.series as usize == series))
        };
        if changed && self.hover.as_ref().is_some_and(stale) {
            self.set_hover(None, scene);
        }
        if changed {
            self.navigator.invalidate();
        }
    }

    pub fn series_visible(&self, series: usize) -> bool {
        match &self.kind {
            ChartKind::Scientific3D(c) => c.visible.get(series).copied().unwrap_or(false),
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l.visible.get(series).copied().unwrap_or(false),
            ChartKind::Bar(b) => b.visible.get(series).copied().unwrap_or(false),
            ChartKind::Scatter(s) => s.visible.get(series).copied().unwrap_or(false),
            ChartKind::Candle(_) => series == 0,
            ChartKind::Heatmap(_) => false,
            ChartKind::Box(b) => b.visible.get(series).copied().unwrap_or(false),
            ChartKind::Pie(p) => p.slices.get(series).is_some_and(|s| s.visible),
            ChartKind::Combo(c) => c.visible(series),
            ChartKind::Radar(r) => r.visible.get(series).copied().unwrap_or(false),
            ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => series == 0,
            ChartKind::Hierarchy(h) => series < h.series_count(),
        }
    }

    /// Emphasizes one series (others fade) or clears emphasis with `None` (legend hover).
    pub fn set_emphasis(&mut self, series: Option<usize>) {
        match &mut self.kind {
            ChartKind::Scientific3D(c) => { c.emphasis = series; self.dirty.series = true; self.dirty.fills = true; }
            ChartKind::Area(a) if a.stream.is_some() => self.dirty.series |= a.set_stream_emphasis(None, Some(series)),
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                let series = series.filter(|&i| i < l.series.len());
                if l.emphasis != series {
                    l.emphasis = series;
                    self.dirty.series = true;
                }
            }
            ChartKind::Bar(b) => {
                let series = series.filter(|&i| i < b.series_count);
                if b.emphasis != series {
                    b.emphasis = series;
                    self.dirty.bars = true;
                }
            }
            ChartKind::Scatter(s) => {
                let series = series.filter(|&i| i < s.visible.len());
                if s.emphasis != series {
                    s.emphasis = series;
                    self.dirty.point_style |= s.series_in_uniform();
                    self.dirty.points |= !s.series_in_uniform();
                }
            }
            ChartKind::Candle(_) => {}
            ChartKind::Heatmap(_) => {}
            ChartKind::Box(b) => {
                let series = series.filter(|&i| i < b.series_count);
                if b.emphasis != series {
                    b.emphasis = series;
                    self.dirty.bars = true;
                }
            }
            ChartKind::Pie(p) => self.dirty.fills |= p.set_emphasis(series),
            ChartKind::Combo(c) => {
                let (bars, lines) = c.set_emphasis(series.filter(|&i| i < c.len()));
                self.dirty.bars |= bars;
                self.dirty.series |= lines;
            }
            ChartKind::Radar(r) => {
                let changed = r.set_emphasis(series);
                self.dirty.series |= changed;
                self.dirty.fills |= changed;
                self.dirty.overlay |= changed;
            }
            ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => {}
            ChartKind::Hierarchy(h) => self.dirty.fills |= h.set_emphasis(series),
        }
    }

    /// Zooms the x axis of a 2D line chart around the pointer (`factor` < 1 zooms in).
    pub fn zoom_x(&mut self, view: &ChartView, factor: f32, anchor_ndc_x: f32) {
        if !factor.is_finite() || factor <= 0.0 || !anchor_ndc_x.is_finite() {
            return;
        }
        if let ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) = &mut self.kind {
            if l.layout.view != ChartViewMode::Flat {
                return;
            }
            let ray = view.camera.screen_to_ray(anchor_ndc_x, 0.0);
            let z0 = l.z.first().copied().unwrap_or(0.0);
            let anchor = ray_hit_z_plane(&ray, z0)
                .map(|p| l.t_of_x(p.x.clamp(-l.layout.width * 0.5, l.layout.width * 0.5)))
                .unwrap_or((l.window.0 + l.window.1) * 0.5);
            let before = l.window;
            l.zoom_x(factor, anchor);
            if l.window != before {
                self.on_window_changed();
            }
        }
        if let ChartKind::Candle(c) = &mut self.kind {
            if c.zoom_at(view, factor, anchor_ndc_x) {
                self.on_window_changed();
            }
        }
        if let ChartKind::Combo(c) = &mut self.kind {
            if c.zoom(view, factor, anchor_ndc_x) {
                self.on_window_changed();
            }
        }
    }

    /// Pans the x axis of a 2D line chart by a pointer delta in NDC (drag).
    pub fn pan_x(&mut self, view: &ChartView, delta_ndc_x: f32) {
        if !delta_ndc_x.is_finite() {
            return;
        }
        if let ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) = &mut self.kind {
            if l.layout.view != ChartViewMode::Flat {
                return;
            }
            let z0 = l.z.first().copied().unwrap_or(0.0);
            let half = l.layout.width * 0.5;
            let (Some(a), Some(b)) = (
                view.project_px(Vec3::new(-half, 0.0, z0)),
                view.project_px(Vec3::new(half, 0.0, z0)),
            ) else {
                return;
            };
            let plot_px = (b.0 - a.0).abs().max(1.0);
            let delta_px = delta_ndc_x * 0.5 * view.viewport_px.0 as f32;
            let (w0, w1) = l.window;
            // Content follows the pointer (a reversed axis runs the other way)
            let shift = -delta_px / plot_px * (w1 - w0) * l.x_scale.sign();
            let before = l.window;
            l.set_window(w0 + shift, w1 + shift);
            if l.window != before {
                self.on_window_changed();
            }
        }
        if let ChartKind::Candle(c) = &mut self.kind {
            if c.pan_by(view, delta_ndc_x) {
                self.on_window_changed();
            }
        }
        if let ChartKind::Combo(c) = &mut self.kind {
            if c.pan(view, delta_ndc_x) {
                self.on_window_changed();
            }
        }
    }

    /// Zooms both axes of a scatter chart around the pointer (`factor` < 1 zooms in).
    pub fn zoom_xy(&mut self, view: &ChartView, factor: f32, anchor_ndc: (f32, f32)) {
        if !factor.is_finite() || factor <= 0.0 || !anchor_ndc.0.is_finite() || !anchor_ndc.1.is_finite() {
            return;
        }
        if let ChartKind::Heatmap(h) = &mut self.kind {
            if h.zoom_at(view, factor, anchor_ndc) {
                self.on_window_changed();
            }
            return;
        }
        if let ChartKind::Scatter(s) = &mut self.kind {
            let (hw, hh) = (s.layout.width * 0.5, s.layout.height * 0.5);
            let ray = view.camera.screen_to_ray(anchor_ndc.0, anchor_ndc.1);
            let anchor = ray_hit_z_plane(&ray, 0.0)
                .map(|p| s.t_of_world(p.x.clamp(-hw, hw), p.y.clamp(-hh, hh)))
                .unwrap_or([(s.window_x.0 + s.window_x.1) * 0.5, (s.window_y.0 + s.window_y.1) * 0.5]);
            let before = (s.window_x, s.window_y);
            s.zoom(factor, anchor);
            if (s.window_x, s.window_y) != before {
                self.on_window_changed();
            }
        }
    }

    /// Pans both axes of a scatter chart by a pointer delta in NDC (drag; +y = up).
    pub fn pan_xy(&mut self, view: &ChartView, delta_ndc_x: f32, delta_ndc_y: f32) {
        if !delta_ndc_x.is_finite() || !delta_ndc_y.is_finite() {
            return;
        }
        if let ChartKind::Heatmap(h) = &mut self.kind {
            if h.pan_by(view, (delta_ndc_x, delta_ndc_y)) {
                self.on_window_changed();
            }
            return;
        }
        if let ChartKind::Scatter(s) = &mut self.kind {
            let (hw, hh) = (s.layout.width * 0.5, s.layout.height * 0.5);
            let (Some(a), Some(b)) = (
                view.project_px(Vec3::new(-hw, -hh, 0.0)),
                view.project_px(Vec3::new(hw, hh, 0.0)),
            ) else {
                return;
            };
            let (wx, wy) = (s.window_x, s.window_y);
            // Content follows the pointer: the window moves the opposite way
            let dx = -delta_ndc_x * 0.5 * view.viewport_px.0 as f32 / (b.0 - a.0).abs().max(1.0) * (wx.1 - wx.0);
            let dy = -delta_ndc_y * 0.5 * view.viewport_px.1 as f32 / (b.1 - a.1).abs().max(1.0) * (wy.1 - wy.0);
            // Reversed axes run the other way
            let (dx, dy) = (dx * s.x_scale.sign(), dy * s.y_scale.sign());
            s.set_window((wx.0 + dx, wx.1 + dx), (wy.0 + dy, wy.1 + dy));
            if (s.window_x, s.window_y) != (wx, wy) {
                self.on_window_changed();
            }
        }
    }

    pub fn reset_zoom(&mut self) {
        // A manual y zoom (zoom.rs) is dropped too
        self.clear_y_zoom();
        let changed = match &mut self.kind {
            ChartKind::Scientific3D(_) => false,
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => std::mem::replace(&mut l.window, (0.0, 1.0)) != (0.0, 1.0),
            ChartKind::Scatter(s) => {
                let before = (s.window_x, s.window_y);
                s.set_window((0.0, 1.0), (0.0, 1.0));
                before != ((0.0, 1.0), (0.0, 1.0))
            }
            ChartKind::Heatmap(h) => {
                let before = (h.window_x, h.window_y);
                h.set_window((0.0, 1.0), (0.0, 1.0));
                before != ((0.0, 1.0), (0.0, 1.0))
            }
            ChartKind::Bar(_) | ChartKind::Box(_) => false,
            ChartKind::Pie(_) => false,
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => false,
            ChartKind::Hierarchy(_) => false,
            ChartKind::Candle(c) => std::mem::replace(&mut c.window, (0.0, 1.0)) != (0.0, 1.0),
            ChartKind::Combo(c) => std::mem::replace(&mut c.line.window, (0.0, 1.0)) != (0.0, 1.0),
        };
        if changed {
            self.on_window_changed();
        }
    }

    /// Current x zoom window in normalized `[0, 1]` (line / scatter charts; bars return `(0, 1)`).
    pub fn x_window(&self) -> (f32, f32) {
        match &self.kind {
            ChartKind::Scientific3D(_) => (0., 1.),
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l.window,
            ChartKind::Bar(_) | ChartKind::Box(_) => (0.0, 1.0),
            ChartKind::Pie(_) => (0.0, 1.0),
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => (0.0, 1.0),
            ChartKind::Hierarchy(_) => (0.0, 1.0),
            ChartKind::Scatter(s) => s.window_x,
            ChartKind::Candle(c) => c.window,
            ChartKind::Heatmap(h) => h.window_x,
            ChartKind::Combo(c) => c.line.window,
        }
    }

    /// Current y zoom window in normalized `[0, 1]` (scatter charts; others return `(0, 1)`).
    pub fn y_window(&self) -> (f32, f32) {
        match &self.kind {
            ChartKind::Scatter(s) => s.window_y,
            ChartKind::Heatmap(h) => h.window_y,
            _ => (0.0, 1.0),
        }
    }

    fn on_window_changed(&mut self) {
        // World positions depend on the window: re-layout strokes and hover overlays
        self.dirty.overlay = true;
        if matches!(self.kind, ChartKind::Scatter(_)) {
            // Points stay on the GPU: only the layer transform and the gridlines move
            self.dirty.point_style = true;
            self.dirty.underlay = true;
        } else if matches!(self.kind, ChartKind::Heatmap(_)) {
            // One quad: only the uniform window moves
            self.dirty.heatmap_style = true;
        } else {
            self.dirty.series = true;
            self.lod = None;
        }
        if let ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) = &mut self.kind {
            if l.update_y_domain(false) {
                self.dirty.underlay = true;
                self.axes_key = None;
            }
        }
        // Combo bars are mapped through the window when built
        if matches!(self.kind, ChartKind::Combo(_)) {
            self.dirty.bars = true;
        }
        // Candles: the price axis fits the visible candles
        if let ChartKind::Candle(c) = &mut self.kind {
            if c.update_y_domain() {
                self.dirty.underlay = true;
                self.axes_key = None;
            }
        }
    }

    /// Sets how the y domain of a line chart is derived (fixed ends, autoscale, nice ends).
    pub fn set_y_axis(&mut self, axis: LineYAxis) {
        let changed = match &mut self.kind {
            ChartKind::Line(l) => l.set_y_axis(axis),
            // Percent areas are fixed at 0..100
            ChartKind::Area(a) if a.mode == AreaMode::Percent => false,
            ChartKind::Area(a) => a.line.set_y_axis(axis),
            _ => false,
        };
        if changed {
            self.on_y_domain_changed();
        }
    }

    /// Current y domain `(min, max, tick step)` of a line chart (left axis, data units; step 0 on
    /// a log scale).
    pub fn y_domain(&self) -> Option<(f64, f64, f64)> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => Some(l.domain_data(0)),
            _ => None,
        }
    }

    fn on_y_domain_changed(&mut self) {
        // Every mark, gridline and tick moves vertically
        self.dirty.series = true;
        self.dirty.underlay = true;
        self.dirty.overlay = true;
        self.axes_key = None;
    }

    /// Replaces the samples (and x, required iff the chart has x) of one line series, keeping
    /// styles and the zoom window (see `LineChart::restore_window`). Returns the new length.
    pub fn set_series_data(&mut self, series: usize, values: Vec<f32>, x: Option<Vec<f64>>) -> Result<usize, String> {
        if matches!(&self.kind, ChartKind::Line(l) if l.style.sparse.iter().any(Option::is_some)) {
            return Err("sparse charts require full chart replacement".into());
        }
        let n = match &mut self.kind {
            ChartKind::Line(l) => l.set_series_data(series, values, x)?,
            ChartKind::Area(a) => a.set_series_data(series, values, x)?,
            _ => return Err("series data updates need a line or area chart".into()),
        };
        // Tween from the frame on screen (staged layers are rebuilt on the next frame; see
        // animation.rs; no-op with animations off)
        self.begin_update_animation();
        self.on_data_changed();
        Ok(n)
    }

    /// Streams samples onto the end of one line series (x must not go back); `max_points > 0`
    /// drops the oldest samples beyond it. Returns the new length.
    pub fn append_series_data(
        &mut self,
        series: usize,
        values: &[f32],
        x: Option<&[f64]>,
        max_points: usize,
    ) -> Result<usize, String> {
        if matches!(&self.kind, ChartKind::Line(l) if l.style.sparse.iter().any(Option::is_some)) {
            return Err("sparse charts require full chart replacement".into());
        }
        let n = match &mut self.kind {
            ChartKind::Line(l) => l.append_series_data(series, values, x, max_points)?,
            ChartKind::Area(a) => a.append_series_data(series, values, x, max_points)?,
            _ => return Err("series data updates need a line or area chart".into()),
        };
        self.on_data_changed();
        Ok(n)
    }

    /// Atomically appends one chunk per area series, preserving stack alignment and viewport.
    pub fn append_area_data(&mut self, values: &[&[f32]], xs: Option<&[&[f64]]>, max_points: usize) -> Result<Vec<usize>, String> {
        let ChartKind::Area(a) = &mut self.kind else {
            return Err("appendAreaData needs an area chart".into());
        };
        let lengths = a.append_data(values, xs, max_points)?;
        self.on_data_changed();
        Ok(lengths)
    }

    fn on_data_changed(&mut self) {
        // Global ids are re-based and samples moved: the hover is re-picked by `refresh_hover`.
        // The series layer is rebuilt for the current view (O(visible)); the LOD window cache
        // stays, since `dirty.series` forces the rebuild anyway.
        self.hover = None;
        self.brush.invalidate();
        self.on_y_domain_changed();
        self.navigator.data_changed();
        if let Some(sp) = self.sparkline.as_mut() {
            sp.stale = true;
        }
    }

    /// Re-runs the hit test at the last hovered pointer after the hover was dropped by a data
    /// update, so crosshair / markers track live data under a resting pointer.
    pub fn refresh_hover(&mut self, view: &ChartView, scene: &mut SceneWorld) {
        if self.hover.is_none() {
            if let Some(ndc) = self.hover_ndc {
                self.hover_at(view, scene, ndc);
            } else if let Some(x) = self.hover_x {
                self.hover_at_data_x(scene, x);
            }
        }
    }

    /// Live samples of a line series.
    pub fn line_values(&self, series: usize) -> Option<&[f32]> {
        match &self.kind {
            ChartKind::Line(l) if series < l.series.len() => Some(l.vals(series)),
            ChartKind::Area(a) if series < a.line.series.len() => Some(a.values(series)),
            _ => None,
        }
    }

    /// Absolute x of a line series' live samples (`None` without x).
    pub fn line_x(&self, series: usize) -> Option<Vec<f64>> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if series < l.series.len() => {
                l.xs(series).map(|x| x.iter().map(|&v| l.x_data(v)).collect())
            }
            _ => None,
        }
    }

    /// Axis layout for DOM labels (recomputed in `prepare_layers`).
    pub fn axes(&self) -> &AxisLayout {
        &self.axes
    }

    pub fn axes_revision(&self) -> u32 {
        self.axes_revision
    }

    pub fn point_count(&self) -> usize {
        match &self.kind {
            ChartKind::Scientific3D(c) => c.len(),
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => (0..l.series.len()).map(|s| l.len(s)).sum(),
            ChartKind::Bar(b) => b.values.len(),
            ChartKind::Scatter(s) => s.len(),
            ChartKind::Candle(c) => c.len(),
            ChartKind::Heatmap(h) => h.len(),
            ChartKind::Box(b) => b.sample_count(),
            ChartKind::Pie(p) => p.len(),
            ChartKind::Combo(c) => c.len() * c.n,
            ChartKind::Radar(r) => r.series * r.axes,
            ChartKind::Gauge(g) => g.len(),
            ChartKind::Funnel(f) => f.len(),
            ChartKind::Waterfall(w) => w.items.len(),
            ChartKind::Hierarchy(h) => h.point_count(),
        }
    }

    pub fn hover_style(&self) -> ChartHoverStyle {
        self.hover_style
    }

    /// Applies a new hover style (re-tints a currently highlighted 3D bar in `scene`).
    pub fn set_hover_style(&mut self, style: ChartHoverStyle, scene: &mut SceneWorld) {
        self.hover_style = style;
        self.dirty.overlay = true;
        self.dirty.bars = true;
        // Scatter point rings use the marker ring color (chart surface)
        self.dirty.point_style = true;
        // Line series markers bake the ring color at build time
        if let ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) = &self.kind {
            if l.style.any_marker() {
                self.lod = None;
                self.dirty.series = true;
            }
        }
        if let ChartKind::Combo(c) = &self.kind {
            if c.line.style.any_marker() {
                self.lod = None;
                self.dirty.series = true;
            }
            self.dirty.bars = true;
        }
        if let ChartKind::Bar(b) = &self.kind {
            if let Some(g) = hovered_bar(self.hover.as_ref()) {
                b.set_scene_highlight(scene, g, true, &self.hover_style);
            }
        }
    }

    pub fn set_frame_style(&mut self, style: ChartFrameStyle) {
        let target_changed = style.grid_rows != self.frame_style.grid_rows;
        self.frame_style = style;
        self.dirty.underlay = true;
        if target_changed {
            // The tick target reshapes the nice domain: every mark moves
            if let ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) = &mut self.kind {
                l.set_tick_target(style.grid_rows);
                self.dirty.series = true;
                self.dirty.overlay = true;
                self.lod = None;
            }
            if let ChartKind::Combo(c) = &mut self.kind {
                c.line.tick_target = style.grid_rows;
                c.update_domains();
                self.dirty.series = true;
                self.dirty.bars = true;
                self.dirty.overlay = true;
                self.lod = None;
            }
            if let ChartKind::Candle(c) = &mut self.kind {
                c.set_tick_target(style.grid_rows);
                self.dirty.series = true;
                self.dirty.overlay = true;
            }
            self.axes_key = None;
        }
    }

    /// Sets the stroke width (CSS px) of one series, or all when `series` is `None`.
    pub fn set_line_width(&mut self, series: Option<usize>, width_px: f32) {
        if let ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) = &mut self.kind {
            let w = width_px.max(0.25);
            for (i, s) in l.series.iter_mut().enumerate() {
                if series.is_none_or(|only| only == i) {
                    s.width_px = w;
                }
            }
            self.dirty.series = true;
        }
    }

    /// Value and world position of a data point by global id.
    pub fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        match &self.kind {
            ChartKind::Scientific3D(c) => c.sample(global_id),
            ChartKind::Line(l) => {
                let s = l.offsets.iter().rposition(|&o| o <= global_id)?;
                let i = (global_id - l.offsets[s]) as usize;
                let v = *l.vals(s).get(i)?;
                Some((s as u32, i as u32, v, l.point(s, i)))
            }
            ChartKind::Area(a) => {
                // Raw value at the drawn (stacked) position
                let l = &a.line;
                let s = l.offsets.iter().rposition(|&o| o <= global_id)?;
                let i = (global_id - l.offsets[s]) as usize;
                let v = *a.values(s).get(i)?;
                Some((s as u32, i as u32, v, l.point(s, i)))
            }
            ChartKind::Bar(b) => b.sample(global_id as usize),
            ChartKind::Scatter(s) => {
                let i = global_id as usize;
                let v = *s.ys.get(i)?;
                Some((s.series_of(i) as u32, i as u32, v, s.point(i)))
            }
            ChartKind::Candle(c) => c.sample(global_id as usize),
            ChartKind::Heatmap(h) => h.sample(global_id),
            ChartKind::Box(b) => b.sample(global_id),
            ChartKind::Pie(p) => p.sample(global_id),
            ChartKind::Combo(c) => c.sample(global_id as usize),
            ChartKind::Radar(r) => r.sample(global_id),
            ChartKind::Gauge(g) => g.sample(global_id),
            ChartKind::Funnel(f) => f.sample(global_id),
            ChartKind::Waterfall(w) => w.bar.sample(global_id as usize),
            ChartKind::Hierarchy(h) => h.sample(global_id),
        }
    }

    /// Data x of a line sample by global id: its explicit x, else its sample index.
    pub fn sample_x(&self, global_id: u32) -> Option<f64> {
        if let ChartKind::Candle(c) = &self.kind {
            return c.sample_x(global_id as usize);
        }
        // Combo: the category's x (its index without explicit x)
        if let ChartKind::Combo(c) = &self.kind {
            let g = global_id as usize;
            return (g / c.n < c.len()).then(|| c.xs[g % c.n]);
        }
        let ChartKind::Line(l) = &self.kind else {
            return None;
        };
        let s = l.offsets.iter().rposition(|&o| o <= global_id)?;
        let i = (global_id - l.offsets[s]) as usize;
        if i >= l.len(s) {
            return None;
        }
        Some(l.xs(s).map_or(i as f64, |x| l.x_data(x[i])))
    }

    /// Hit-tests the pointer, updates hover overlays, and returns the hovered points.
    pub fn hover_at(&mut self, view: &ChartView, scene: &mut SceneWorld, ndc: (f32, f32)) -> Option<HoverResult> {
        self.hover_x = None;
        if !ndc.0.is_finite() || !ndc.1.is_finite() {
            self.hover_ndc = None;
            self.set_hover(None, scene);
            return None;
        }
        self.hover_ndc = Some(ndc);
        // The navigator strip sits within the hover slack below the plot: it never hovers data
        if self.navigator_hit(view, ndc) != NavigatorHit::None {
            self.set_hover(None, scene);
            return None;
        }
        if matches!(self.kind, ChartKind::Candle(_)) {
            return self.hover_candle(view, scene, ndc);
        }
        let result = match &self.kind {
            ChartKind::Scientific3D(c) => c.hover(view, ndc, &self.hover_style),
            ChartKind::Line(l) => l.hover(view, ndc, &self.hover_style),
            ChartKind::Area(a) => a.hover(view, ndc, &self.hover_style),
            ChartKind::Bar(b) => b.hover(view, scene, ndc),
            ChartKind::Scatter(s) => s.hover(view, ndc, &self.hover_style),
            ChartKind::Candle(_) => None,
            ChartKind::Heatmap(h) => h.hover(view, ndc),
            ChartKind::Box(b) => b.hover(view, ndc),
            ChartKind::Pie(p) => p.hover(view, ndc, hovered_bar(self.hover.as_ref())),
            ChartKind::Combo(c) => c.hover(view, ndc, &self.hover_style),
            ChartKind::Radar(r) => r.hover(view, ndc),
            ChartKind::Gauge(g) => g.hover(view, ndc),
            ChartKind::Funnel(f) => f.hover(view, ndc),
            ChartKind::Waterfall(w) => w.bar.hover(view, scene, ndc),
            ChartKind::Hierarchy(h) => h.hover(view, ndc),
        };
        self.set_hover(result.clone(), scene);
        result
    }

    pub fn clear_hover(&mut self, scene: &mut SceneWorld) {
        self.hover_ndc = None;
        self.hover_x = None;
        self.set_hover(None, scene);
    }

    fn set_hover(&mut self, hover: Option<HoverResult>, scene: &mut SceneWorld) {
        // ThemeRiver: the stream under the pointer is emphasized (before the early return: data
        // updates drop `self.hover` without passing here)
        if let ChartKind::Area(a) = &mut self.kind {
            let s = hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| i.series as usize);
            self.dirty.series |= a.set_stream_emphasis(Some(s), None);
        }
        if self.hover == hover {
            return;
        }
        if let ChartKind::Bar(b) = &self.kind {
            let old = hovered_bar(self.hover.as_ref());
            let new = hovered_bar(hover.as_ref());
            if b.layout.view == ChartViewMode::Depth {
                if let Some(i) = old {
                    b.set_scene_highlight(scene, i, false, &self.hover_style);
                }
                if let Some(i) = new {
                    b.set_scene_highlight(scene, i, true, &self.hover_style);
                }
            }
            self.dirty.bars = true;
        }
        if matches!(self.kind, ChartKind::Combo(_)) {
            // Hovered bars are re-tinted
            self.dirty.bars = true;
        }
        if matches!(self.kind, ChartKind::Box(_)) {
            // Hovered box / violin is re-tinted
            self.dirty.series = true;
        }
        // Hovered waterfall bar is re-tinted
        self.dirty.bars |= matches!(self.kind, ChartKind::Waterfall(_));
        self.hover = hover;
        self.dirty.overlay = true;
    }

    /// Rebuilds stale CPU staging (LOD follows the camera) and returns the layers to upload.
    pub fn prepare_layers(&mut self, view: &ChartView) -> ChartLayers<'_> {
        self.fill_patches.clear();
        let mut keep_series_dirty = self.prepare_candles(view);
        self.prepare_box();
        self.prepare_pie(view);
        self.prepare_hierarchy(view);
        self.prepare_bar_style(view);
        keep_series_dirty |= self.prepare_combo(view);
        self.prepare_radar(view);
        self.prepare_gauge(view);
        self.prepare_funnel(view);
        self.prepare_theme_river(view);
        self.prepare_waterfall();
        if let ChartKind::Scatter(s) = &mut self.kind {
            // The x tick density follows the plot width: vertical gridlines move with it
            if s.sync_view(view) {
                self.dirty.underlay = true;
                self.axes_key = None;
            }
            // Trendlines follow the zoom window, the scales, the camera and the legend
            if s.build_trendlines(view, self.dirty.series, &mut self.series, &mut self.styled.dashed) {
                self.dirty.series = true;
            }
        }
        if let ChartKind::Heatmap(h) = &mut self.kind {
            // Numeric x tick density follows the plot width
            if h.sync_view(view) {
                self.axes_key = None;
            }
        }
        match &self.kind {
            ChartKind::Scientific3D(c) => {
                if self.dirty.series || self.dirty.fills { c.build(&mut self.fills, &mut self.contours_3d, &mut self.series, &mut self.styled.markers); self.dirty.fills = true; self.dirty.series = true; }
                if self.dirty.underlay { c.grid(&self.frame_style, &mut self.underlay); }
                if self.dirty.overlay { self.overlay.clear(); self.markers.clear(); }
            }
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                if let Some(window) = l.view_window(view) {
                    let stale = match self.lod {
                        None => true,
                        Some(built) => {
                            let ratio = window.px_per_t / built.px_per_t;
                            window.t0 < built.t0
                                || window.t1 > built.t1
                                || window.reversed != built.reversed
                                || !(0.8..=1.25).contains(&ratio)
                                // Dash phases are CSS px along the stroke: exact scale only
                                || ((l.style.any_dash() || l.style.sparse.iter().any(Option::is_some)) && (ratio - 1.0).abs() > 1e-4)
                        }
                    };
                    if stale || self.dirty.series {
                        // Pad the window by half its span on both sides so panning reuses it
                        let pad = (window.t1 - window.t0) * 0.5;
                        let padded = LodWindow {
                            t0: (window.t0 - pad).max(0.0),
                            t1: (window.t1 + pad).min(1.0),
                            ..window
                        };
                        let ctx = StyleCtx { pixel_ratio: view.pixel_ratio, ring: self.hover_style.marker_ring_color };
                        l.build_segments(&padded, &ctx, &mut self.series, &mut self.styled);
                        if let ChartKind::Area(a) = &self.kind {
                            a.build_fills(&padded, &mut self.fills);
                            self.dirty.fills = true;
                        } else if !self.fills.is_empty() || !self.styled.band.is_empty() {
                            self.fills.clear();
                            self.dirty.fills = true;
                        }
                        // Range bands under the strokes (after area fills)
                        self.fills.extend_from_slice(&self.styled.band);
                        self.lod = Some(padded);
                        self.dirty.series = true;
                    }
                } else if self.dirty.series {
                    // View not resolvable this frame (eye inside / behind the plane): keep the
                    // request pending instead of dropping it
                    keep_series_dirty = true;
                }
                if self.dirty.underlay {
                    l.build_grid(&self.frame_style, &mut self.underlay);
                }
                if self.dirty.overlay {
                    match &self.hover {
                        Some(h) => l.build_overlay(h, &self.hover_style, &mut self.overlay, &mut self.markers),
                        None => {
                            self.overlay.clear();
                            self.markers.clear();
                        }
                    }
                }
            }
            ChartKind::Bar(b) => {
                if self.dirty.bars {
                    b.build_bars(hovered_bar(self.hover.as_ref()), &self.hover_style, &mut self.bars);
                }
                if self.dirty.underlay {
                    b.build_grid(&self.frame_style, &mut self.underlay);
                }
                if self.dirty.overlay {
                    self.overlay.clear();
                    self.markers.clear();
                }
            }
            ChartKind::Scatter(s) => {
                if self.dirty.points {
                    match self.brush.point_mask() {
                        // Brush selection: the rest dims, selected points pack last (on top)
                        Some(mask) => s.build_points_selected(mask, &mut self.points),
                        None => s.build_points(&mut self.points),
                    }
                }
                if self.dirty.underlay {
                    s.build_grid(&self.frame_style, &mut self.underlay);
                }
                if self.dirty.overlay {
                    self.overlay.clear();
                    match &self.hover {
                        Some(h) => s.build_overlay(h, &self.hover_style, &mut self.markers),
                        None => self.markers.clear(),
                    }
                }
            }
            // Built by `prepare_candles` / `prepare_box`
            ChartKind::Candle(_) | ChartKind::Box(_) => {}
            ChartKind::Heatmap(h) => {
                // Cells fill the plot: no gridlines
                if self.dirty.underlay {
                    self.underlay.clear();
                }
                if self.dirty.overlay {
                    self.markers.clear();
                    match &self.hover {
                        Some(hv) => h.build_overlay(hv, &self.hover_style, &mut self.overlay),
                        None => self.overlay.clear(),
                    }
                }
            }
            // Built by `prepare_combo`
            ChartKind::Combo(_) => {}
            // Built by `prepare_radar` / `prepare_gauge` / `prepare_funnel` / `prepare_waterfall`
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => {}
            // Slices / leader lines built by `prepare_pie`; hover explodes the slice itself
            ChartKind::Pie(_) => {
                if self.dirty.overlay {
                    self.overlay.clear();
                    self.markers.clear();
                }
            }
            // Built by `prepare_hierarchy` (treemap hover outline in the overlay layer)
            ChartKind::Hierarchy(_) => {}
        }

        // Axis labels follow the camera and the zoom window
        let (x0, x1) = self.x_window();
        let (y0, y1) = self.y_window();
        let key = (view.key(), [x0, x1, y0, y1]);
        if self.axes_key != Some(key) {
            // Lay out into scratch so the revision only bumps when labels actually move
            let mut axes = std::mem::take(&mut self.axes_scratch);
            match &self.kind {
                ChartKind::Scientific3D(c) => c.axes(view, &mut axes),
                ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                    l.axes(view, &self.time_zone, &mut axes)
                }
                ChartKind::Bar(b) => b.axes(view, &mut axes),
                ChartKind::Scatter(s) => s.axes(view, self.frame_style.grid_rows, &mut axes),
                ChartKind::Candle(c) => c.axes(view, &self.time_zone, &mut axes),
                ChartKind::Heatmap(h) => h.axes(view, self.frame_style.grid_rows, &mut axes),
                ChartKind::Box(b) => b.axes(view, &mut axes),
                ChartKind::Pie(p) => p.axes(view, &mut axes),
                ChartKind::Combo(c) => c.axes(view, &self.time_zone, &mut axes),
                ChartKind::Radar(r) => r.axes(view, &mut axes),
                ChartKind::Gauge(g) => g.axes(view, &mut axes),
                ChartKind::Funnel(f) => f.axes(view, &mut axes),
                ChartKind::Waterfall(w) => w.bar.axes(view, &mut axes),
                ChartKind::Hierarchy(h) => h.axes(view, &self.padding, &mut axes),
            }
            if axes != self.axes {
                self.axes_revision = self.axes_revision.wrapping_add(1);
                std::mem::swap(&mut self.axes, &mut axes);
            }
            self.axes_scratch = axes;
            self.axes_key = Some(key);
        }
        let mut series_clip = match &self.kind {
            ChartKind::Scientific3D(_) => None,
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l.clip_px(view),
            ChartKind::Bar(_) | ChartKind::Heatmap(_) | ChartKind::Box(_) => None,
            ChartKind::Pie(_) => None,
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => None,
            ChartKind::Hierarchy(_) => None,
            ChartKind::Scatter(s) => s.clip_px(view),
            ChartKind::Candle(c) => c.clip_px(view),
            ChartKind::Combo(c) => c.line.clip_px(view),
        };
        let point_style = match &self.kind {
            ChartKind::Scatter(s) if self.dirty.point_style => Some(s.point_style(&self.hover_style)),
            ChartKind::Box(b) if self.dirty.point_style => Some(b.point_style(&self.hover_style)),
            _ => None,
        };

        // Enter / update animation (animation.rs): eased copies of the staged layers, reveal clip
        let anim = self.prepare_animation(view, &mut series_clip);

        // Navigator strip (data / view) and window overlay (zoom), outside the series clip
        let (nav_strip, nav_window) = self.prepare_navigator(view);

        // Sparkline markers follow the data (rebuilt into the annotation layers on data changes)
        self.prepare_sparkline();
        // Annotations follow the data -> world mapping (zoom window, y domain) and the camera
        let frame = self.annotation_frame();
        let annotations = self.annotations.prepare(frame, view, self.hover_style.marker_ring_color);
        let brush = self.brush.prepare(frame);
        let (ann_below, ann_above) = self.annotations.layers();

        let d = std::mem::take(&mut self.dirty);
        self.dirty.series = keep_series_dirty;
        ChartLayers {
            depth_3d: matches!(self.kind, ChartKind::Scientific3D(_)),
            series_clip,
            underlay: d.underlay.then_some(self.underlay.as_slice()),
            bars: if anim.bars { Some(self.anim_bars()) } else { d.bars.then_some(self.bars.as_slice()) },
            fills: if anim.fills { Some(self.anim_fills()) } else { d.fills.then_some(self.fills.as_slice()) },
            fill_patch: (!anim.fills && !d.fills && !self.fill_patches.is_empty())
                .then_some(ChartFillPatch { fills: &self.fills, ranges: &self.fill_patches }),
            fill_style: d.fill_style.then_some(self.fill_style),
            contours_3d: d.fills.then_some(self.contours_3d.as_slice()),
            series: if anim.series {
                Some(self.anim_series())
            } else {
                (d.series && !keep_series_dirty).then_some(self.series.as_slice())
            },
            series_style: if anim.series_style {
                Some(self.anim_series_style())
            } else {
                (d.series && !keep_series_dirty).then_some(crate::renderer::ChartSeriesStyleLayer {
                    dashed: &self.styled.dashed,
                    markers: &self.styled.markers,
                })
            },
            points: if anim.points { Some(self.anim_points()) } else { d.points.then_some(self.points.as_slice()) },
            point_style,
            overlay: d.overlay.then_some(self.overlay.as_slice()),
            markers: d.overlay.then_some(self.markers.as_slice()),
            annotations_below: annotations.then_some(ann_below),
            annotations_above: annotations.then_some(ann_above),
            brush: brush.then_some(self.brush.layer()),
            navigator: nav_strip.then(|| self.navigator.strip_layer()),
            navigator_window: nav_window.then(|| self.navigator.window_layer()),
            // Other kinds clear a previous chart's heatmap on their first frame
            heatmap: d.heatmap.then(|| match &self.kind {
                ChartKind::Heatmap(h) => h.grid(),
                _ => ChartHeatmapGrid::default(),
            }),
            heatmap_lut: match &self.kind {
                ChartKind::Heatmap(h) if d.heatmap_lut => Some(h.lut()),
                _ => None,
            },
            heatmap_style: match &self.kind {
                ChartKind::Heatmap(h) if d.heatmap_style => Some(h.style()),
                _ => None,
            },
        }
    }
}

/// Global id of the highlighted bar / stack segment: the primary hovered item.
fn hovered_bar(hover: Option<&HoverResult>) -> Option<usize> {
    hover.and_then(|h| h.items.get(h.primary)).map(|i| i.global_id as usize)
}

/// Layers that clear every chart buffer on the GPU (used when the chart is removed).
pub fn empty_chart_layers() -> ChartLayers<'static> {
    ChartLayers {
        depth_3d: false,
        series_clip: None,
        underlay: Some(&[]),
        bars: Some(&[]),
        fills: Some(&[]),
        contours_3d: Some(&[]),
        fill_patch: None,
        fill_style: Some(ChartFillStyleRaw::default()),
        series: Some(&[]),
        series_style: Some(Default::default()),
        points: Some(&[]),
        point_style: None,
        overlay: Some(&[]),
        markers: Some(&[]),
        annotations_below: Some(Default::default()),
        annotations_above: Some(Default::default()),
        brush: Some(Default::default()),
        navigator: Some(Default::default()),
        navigator_window: Some(Default::default()),
        heatmap: Some(ChartHeatmapGrid::default()),
        heatmap_lut: None,
        heatmap_style: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_camera(aspect: f32) -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, aspect);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn line_state(values: Vec<Vec<f32>>, mode: ChartViewMode) -> ChartState {
        let series = values
            .into_iter()
            .map(|values| LineSeries {
                values,
                x: None,
                color: [1.0, 0.0, 0.0, 1.0],
                width_px: 2.0,
            })
            .collect();
        ChartState::new_line(
            series,
            LineLayout {
                width: 160.0,
                height: 80.0,
                view: mode,
                x_kind: LineXKind::Numeric,
            },
        )
    }

    #[test]
    fn small_series_emit_every_segment() {
        let mut cam = flat_camera(16.0 / 9.0);
        let mut chart = line_state(vec![(0..100).map(|i| i as f32).collect()], ChartViewMode::Flat);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.series.unwrap().len(), 99);
        assert_eq!(layers.underlay.unwrap().len(), 6); // 5 rows + baseline
    }

    #[test]
    fn large_series_are_decimated_to_screen_resolution_and_keep_extremes() {
        let mut cam = flat_camera(16.0 / 9.0);
        let n = 200_000;
        let mut values: Vec<f32> = (0..n).map(|i| (i as f32 * 0.01).sin()).collect();
        values[123_457] = 50.0; // single-sample spike must survive decimation
        let mut chart = line_state(vec![values], ChartViewMode::Flat);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let layers = chart.prepare_layers(&view(&cam));
        let segs = layers.series.unwrap();
        assert!(segs.len() < 4 * 1600 * 2, "segments {} not decimated", segs.len());
        let max_y = segs.iter().map(|s| s.p0_width[1].max(s.p1_pad[1])).fold(f32::MIN, f32::max);
        assert!((max_y - 40.0).abs() < 1e-3, "spike lost: max y {max_y}");
    }

    #[test]
    fn lod_is_reused_until_the_view_changes_enough() {
        let mut cam = flat_camera(16.0 / 9.0);
        let mut chart = line_state(vec![(0..50_000).map(|i| i as f32).collect()], ChartViewMode::Flat);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert!(chart.prepare_layers(&view(&cam)).series.is_some());
        // Same view: nothing re-uploaded
        let again = chart.prepare_layers(&view(&cam));
        assert!(again.series.is_none() && again.underlay.is_none() && again.overlay.is_none());
        // Zoom in 3x: density changes, so the LOD is rebuilt
        cam.zoom(-cam.distance() * 0.66);
        assert!(chart.prepare_layers(&view(&cam)).series.is_some());
    }

    #[test]
    fn nan_values_break_the_line() {
        let mut cam = flat_camera(1.0);
        let mut chart = line_state(vec![vec![1.0, 2.0, f32::NAN, 4.0, 5.0]], ChartViewMode::Flat);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.series.unwrap().len(), 2); // 0-1 and 3-4
    }

    #[test]
    fn index_hover_returns_every_series_at_the_pointer_x_and_draws_overlays() {
        let mut cam = flat_camera(16.0 / 9.0);
        let mut chart = line_state(
            vec![(0..101).map(|i| i as f32).collect(), (0..101).map(|i| 100.0 - i as f32).collect()],
            ChartViewMode::Flat,
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        // Padding shifts the plot off the canvas centre: hover over the plot centre itself
        let c = v.camera.project_to_ndc(Vec3::ZERO).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (c.x, c.y)).expect("hover at center");
        assert_eq!(hit.items.len(), 2);
        assert_eq!(hit.items[0].index, 50);
        assert_eq!(hit.items[1].global_id, 101 + 50);
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.overlay.unwrap().len(), 1); // crosshair
        assert_eq!(layers.markers.unwrap().len(), 2);

        // Outside the plot: no hover, overlays cleared
        assert!(chart.hover_at(&v, &mut scene, (0.0, 0.99)).is_none());
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.markers.unwrap().len(), 0);
    }

    #[test]
    fn nearest_hover_picks_the_closest_series_within_the_radius() {
        let mut cam = flat_camera(16.0 / 9.0);
        let mut chart = line_state(
            vec![vec![0.0; 101], vec![100.0; 101]],
            ChartViewMode::Flat,
        );
        let mut scene = SceneWorld::new();
        chart.set_hover_style(
            ChartHoverStyle {
                mode: HoverMode::Nearest,
                ..Default::default()
            },
            &mut scene,
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        // Series 1 sits at the top edge of the plot
        let top_ndc = v.camera.project_to_ndc(Vec3::new(0.0, 40.0, SERIES_Z_STEP_2D)).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (0.0, top_ndc.y)).expect("near series 1");
        assert_eq!(hit.items.len(), 1);
        assert_eq!(hit.items[0].series, 1);
        // Middle of the plot is far from both flat lines
        assert!(chart.hover_at(&v, &mut scene, (0.0, 0.0)).is_none());
    }

    #[test]
    fn bar_hover_highlights_the_hovered_bar_only() {
        let mut cam = flat_camera(16.0 / 9.0);
        let mut scene = SceneWorld::new();
        let mut chart = ChartState::new_bar(
            vec![10.0, 20.0, 30.0, -5.0],
            vec![[0.2, 0.4, 0.8, 1.0]],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 4.0,
                view: ChartViewMode::Flat,
            },
            &mut scene,
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        let layers = chart.prepare_layers(&v);
        let bars = layers.bars.unwrap();
        assert_eq!(bars.len(), 4);
        // Negative bar hangs below the zero baseline with its rounded end at the bottom
        assert_eq!(bars[3].z_radius[2], -1.0);
        assert!(bars[3].rect[1] < bars[0].rect[1]);

        let slot2 = v.camera.project_to_ndc(Vec3::new(20.0, 0.0, 0.0)).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (slot2.x, slot2.y)).expect("bar 2");
        assert_eq!(hit.items[0].index, 2);
        let bars = chart.prepare_layers(&v).bars.unwrap().to_vec();
        assert_ne!(bars[2].color, bars[1].color);
        assert_eq!(bars[1].color, [0.2, 0.4, 0.8, 1.0]);
    }

    #[test]
    fn matrix_bars_live_in_the_scene_and_are_released() {
        let mut scene = SceneWorld::new();
        let mut chart = ChartState::new_bar(
            vec![1.0; 9],
            vec![],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 0.0,
                view: ChartViewMode::Depth,
            },
            &mut scene,
        );
        assert_eq!(scene.object_count(), 10); // 9 bars + floor
        chart.release(&mut scene);
        assert_eq!(scene.object_count(), 0);
    }

    #[test]
    fn sample_lookup_maps_global_ids_back_to_series() {
        let chart = line_state(vec![vec![1.0, 2.0, 3.0], vec![7.0, 8.0]], ChartViewMode::Flat);
        let (s, i, v, _) = chart.sample(4).unwrap();
        assert_eq!((s, i, v), (1, 1, 8.0));
        assert!(chart.sample(5).is_none());
    }

    #[test]
    fn mirrored_view_decimates_the_visible_window() {
        // Camera behind the chart plane and zoomed in: x is mirrored on screen
        let mut cam = flat_camera(16.0 / 9.0);
        let mut chart = line_state(vec![(0..100_000).map(|i| i as f32).collect()], ChartViewMode::Flat);
        cam.set_pose(Vec3::new(60.0, 0.0, -40.0), Vec3::new(60.0, 0.0, 0.0));
        let window = match &chart.kind {
            ChartKind::Line(l) => l.view_window(&view(&cam)).unwrap(),
            _ => unreachable!(),
        };
        // The camera looks at x = +60 (t = 0.875): that t must be inside the window
        assert!(window.t0 < 0.875 && window.t1 > 0.875, "{window:?}");
        assert!(window.reversed);
        assert!(chart.prepare_layers(&view(&cam)).series.unwrap().len() > 10);
    }

    #[test]
    fn non_finite_pointer_clears_hover() {
        let mut cam = flat_camera(1.0);
        let mut chart = line_state(vec![vec![1.0; 10]], ChartViewMode::Flat);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        assert!(chart.hover_at(&v, &mut scene, (0.0, 0.0)).is_some());
        assert!(chart.hover_at(&v, &mut scene, (f32::NAN, 0.0)).is_none());
        assert_eq!(chart.prepare_layers(&v).markers.unwrap().len(), 0);
    }

    #[test]
    fn matrix_layout_is_centered_for_any_bar_count() {
        let mut scene = SceneWorld::new();
        for n in [1usize, 2, 5, 9] {
            let chart = ChartState::new_bar(
                vec![1.0; n],
                vec![],
                BarLayout {
                    width: 100.0,
                    max_height: 50.0,
                    bar_width: 0.0,
                    corner_radius_px: 0.0,
                    view: ChartViewMode::Depth,
                },
                &mut scene,
            );
            let ChartKind::Bar(b) = &chart.kind else { unreachable!() };
            let (sx, sz) = b.slots.iter().fold((0.0, 0.0), |a, s| (a.0 + s.0, a.1 + s.1));
            let rows = n.div_ceil((n as f32).sqrt().ceil() as usize);
            // Full grids average to the origin; partial last rows only shift z
            assert!((sx / n as f32).abs() < 1e-3 || rows * rows != n, "n={n} x={sx}");
            assert!(b.slots[0].0 <= 0.0 && b.slots[0].1 <= 0.0, "n={n}");
            if n == 1 {
                assert_eq!(b.slots[0], (0.0, 0.0));
            }
            let _ = sz;
        }
    }

    #[test]
    fn nice_ticks_land_on_round_values() {
        assert_eq!(nice_step(97.0, 5), 20.0);
        assert_eq!(nice_step(0.73, 5), 0.2);
        let (lo, hi, step) = nice_domain(52.6, 247.1, 5);
        assert_eq!((lo, hi, step), (50.0, 250.0, 50.0));
        assert_eq!(ticks_between(0.0, 1.0, 0.1).len(), 11);
        assert_eq!(ticks_between(0.0, 1.0, 0.1)[3], 0.3); // no float noise
        // Domains stored as f32 must keep their end ticks (0.7 as f32 = 0.69999998)
        assert_eq!(ticks_between(0.0, 0.7f32 as f64, 0.1).len(), 8);
        assert_eq!(ticks_between(0.3f32 as f64, 1.4f32 as f64, 0.1).len(), 12);
        for k in 1..400 {
            let max = k as f64 * 0.037;
            let (lo, hi, step) = nice_domain(0.0, max, 5);
            let n = ticks_between(lo as f32 as f64, hi as f32 as f64, step).len();
            assert_eq!(n as f64, ((hi - lo) / step).round() + 1.0, "max {max}");
        }
    }

    fn line_view_chart() -> (OrbitCamera, ChartState) {
        let mut cam = flat_camera(16.0 / 9.0);
        let chart = line_state(
            vec![(0..1001).map(|i| i as f32).collect(), (0..1001).map(|i| 1000.0 - i as f32).collect()],
            ChartViewMode::Flat,
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    #[test]
    fn padding_frames_the_plot_inside_the_margins() {
        let (cam, mut chart) = line_view_chart();
        chart.prepare_layers(&view(&cam));
        let [l, t, w, h] = chart.axes().plot_css;
        let [pt, pr, pb, pl] = DEFAULT_CHART_PADDING;
        // The tighter axis touches its margins exactly; the other stays inside them
        assert!(l >= pl - 0.5 && t >= pt - 0.5, "{l} {t}");
        assert!(l + w <= 1600.0 - pr + 0.5 && t + h <= 900.0 - pb + 0.5, "{w} {h}");
        assert!((t - pt).abs() < 0.5 || (l - pl).abs() < 0.5);
    }

    #[test]
    fn axes_report_ticks_on_the_plot_edges_and_revision_tracks_changes() {
        let (cam, mut chart) = line_view_chart();
        chart.prepare_layers(&view(&cam));
        let rev = chart.axes_revision();
        let axes = chart.axes().clone();
        let ys: Vec<f64> = axes.ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert_eq!(ys, vec![0.0, 200.0, 400.0, 600.0, 800.0, 1000.0]);
        let xs: Vec<&AxisTick> = axes.ticks.iter().filter(|t| t.axis == 0).collect();
        assert!(xs.len() >= 3);
        assert!(xs.iter().all(|t| t.value.fract() == 0.0), "x ticks are whole sample indices");
        assert!(xs.iter().all(|t| (t.y_css - (axes.plot_css[1] + axes.plot_css[3])).abs() < 1e-3));
        // Static frame: same revision
        chart.prepare_layers(&view(&cam));
        assert_eq!(chart.axes_revision(), rev);
        // Forced re-layout with identical result: the DOM is not told to re-lay out
        chart.axes_key = None;
        chart.prepare_layers(&view(&cam));
        assert_eq!(chart.axes_revision(), rev);
        // Zoom: x ticks change, revision bumps
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&view(&cam), 0.1, c.x);
        chart.prepare_layers(&view(&cam));
        assert_ne!(chart.axes_revision(), rev);
    }

    #[test]
    fn zoom_keeps_the_anchor_and_pan_clamps_to_the_data() {
        let (cam, mut chart) = line_view_chart();
        let v = view(&cam);
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&v, 0.25, c.x);
        let (w0, w1) = chart.x_window();
        assert!((w1 - w0 - 0.25).abs() < 1e-4);
        assert!(((w0 + w1) * 0.5 - 0.5).abs() < 1e-3, "anchor at the plot centre stays put");
        let layers = chart.prepare_layers(&v);
        assert!(layers.series_clip.is_some(), "zoomed series are scissored to the plot");
        // Dragging far right pans to the start and stops there
        chart.pan_x(&v, 50.0);
        assert_eq!(chart.x_window().0, 0.0);
        // Zoom cannot go below ~8 samples
        chart.zoom_x(&v, 1e-6, c.x);
        let (w0, w1) = chart.x_window();
        assert!(w1 - w0 >= 8.0 / 1000.0 - 1e-6);
        chart.reset_zoom();
        assert_eq!(chart.x_window(), (0.0, 1.0));
        assert!(chart.prepare_layers(&v).series_clip.is_none());
    }

    #[test]
    fn hidden_series_are_not_drawn_or_hovered_and_emphasis_fades_others() {
        let (cam, mut chart) = line_view_chart();
        let v = view(&cam);
        let all = chart.prepare_layers(&v).series.unwrap().len();
        let mut scene = SceneWorld::new();
        chart.set_series_visible(1, false, &mut scene);
        let one = chart.prepare_layers(&v).series.unwrap().len();
        assert!(one * 2 <= all + 2 && one > 0);
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (c.x, c.y)).unwrap();
        assert!(hit.items.iter().all(|i| i.series == 0));

        chart.set_series_visible(1, true, &mut scene);
        chart.set_emphasis(Some(1));
        let segs = chart.prepare_layers(&v).series.unwrap().to_vec();
        assert!(segs.iter().any(|s| s.color[3] < 0.5), "series 0 faded");
        assert_eq!(segs.last().unwrap().color[3], 1.0, "emphasized series drawn last at full alpha");
    }
}
