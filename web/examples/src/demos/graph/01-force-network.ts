import { VizEngineSDK, type NodeMetadata, type RawGraphData } from 'viz-engine-sdk';

export const meta = {
  title: 'Force-directed service network',
  description:
    'Barnes-Hut force layout in Rust (octree, O(n log n)). Hover a node for its metadata, click to highlight its 1-hop neighbors, double-click to focus. Drag orbits, Shift + drag pans, wheel zooms.',
  height: 460,
};

const SERVICES = ['API Gateway', 'Auth', 'Payments', 'Search', 'Inventory', 'Notifications', 'Analytics', 'Storage'];
const REGIONS = ['ap-northeast-2', 'us-east-1', 'eu-central-1'];

/** Clustered network: a random tree per service plus extra intra-service links and a few cross-service calls. */
function serviceNetwork(n: number): { graph: RawGraphData; metadata: NodeMetadata[] } {
  const k = SERVICES.length;
  const positions = new Float32Array(n * 3);
  const clusters = new Uint16Array(n);
  const edges: number[] = [];
  const metadata: NodeMetadata[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < n; i++) {
    const c = i % k;
    clusters[i] = c;
    // Start near the service's anchor on a sphere: the force layout refines it
    const a = (c / k) * Math.PI * 2;
    positions.set([Math.cos(a) * 45 + (rand() - 0.5) * 30, (c % 2 ? 20 : -20) + (rand() - 0.5) * 30, Math.sin(a) * 45 + (rand() - 0.5) * 30], i * 3);
    if (i >= k) {
      const sameService = () => c + k * Math.floor(rand() * Math.floor(i / k));
      edges.push(i, sameService());
      if (rand() < 0.45) edges.push(i, sameService());
      if (rand() < 0.03) edges.push(i, Math.floor(rand() * i)); // cross-service call
    }
    metadata.push({
      label: `${SERVICES[c].toLowerCase().replace(' ', '-')}-${String(i).padStart(5, '0')}`,
      category: SERVICES[c],
      tags: [REGIONS[i % 3], i % 17 === 0 ? 'degraded' : 'healthy'],
      attributes: { region: REGIONS[i % 3], p99Ms: Math.round(4 + rand() * 60), rps: Math.round(50 + rand() * 4000) },
    });
  }
  return { graph: { positions, clusters, edges: Uint32Array.from(edges) }, metadata };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const status = document.createElement('span');
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { nodeCount: 0, edgeCount: 0, locale: 'en-US' });

  const load = (n: number) => {
    const { graph, metadata } = serviceNetwork(n);
    sdk.loadDataset(graph);
    sdk.setNodeMetadata(metadata);
    // Stop simulating once the layout is at rest (threshold = total kinetic energy)
    sdk.setAutoSleep(true, n * 0.5);
    sdk.warmup(40); // settle the layout a bit before the first frame
    sdk.fitToView();
    sdk.wakeUp();
    status.textContent = `${sdk.nodeCount().toLocaleString()} nodes · ${sdk.edgeCount().toLocaleString()} edges`;
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.n === String(n)));
  };
  for (const n of [2_000, 5_000, 20_000]) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = `${n / 1000}k nodes`;
    button.dataset.n = String(n);
    button.onclick = () => load(n);
  }
  toolbar.appendChild(status);

  const detach = sdk.enableNodeInteractions(canvas, {
    builtInTooltip: true,
    highlightNeighborsOnClick: 1,
    focusOnDoubleClick: true,
    autoRender: true,
    formatTooltip: (d) => {
      const rows = Object.entries(d.metadata.attributes ?? {}).map(([k, v]) => `<div>${k}: <b>${v}</b></div>`);
      return `<b>${escapeHtml(d.label)}</b><div style="color:#38bdf8">${escapeHtml(d.metadata.category ?? '')} · ${d.degree} links</div>${rows.join('')}`;
    },
    onNodeClick: (node) => {
      status.textContent = node
        ? `${node.label} (${node.metadata.category}): ${node.neighbors.length} neighbors highlighted`
        : `${sdk.nodeCount().toLocaleString()} nodes · ${sdk.edgeCount().toLocaleString()} edges`;
      if (!node) sdk.clearSelection();
    },
  });

  // Mouse orbit / pan / zoom (touch gestures are built into enableNodeInteractions)
  const events = new AbortController();
  const signal = events.signal;
  let last: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && (last = { x: e.clientX, y: e.clientY }), { signal });
  canvas.addEventListener('pointerup', () => (last = null), { signal });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || e.buttons === 0) return;
    const [dx, dy] = [e.clientX - last.x, e.clientY - last.y];
    last = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) sdk.panCamera(-dx * 0.25, dy * 0.25);
    else sdk.rotateCamera(-dx * 0.006, dy * 0.006);
    sdk.render();
  }, { signal });
  canvas.addEventListener('wheel', (e) => (e.preventDefault(), sdk.zoomCamera(e.deltaY * 0.18), sdk.render()), { passive: false, signal });

  // Simulation loop: steps the forces until the layout sleeps, then only renders on input
  let frame = 0;
  const tick = () => {
    if (!sdk.isSleeping()) {
      sdk.stepPhysics();
      sdk.render();
    }
    frame = requestAnimationFrame(tick);
  };
  load(5_000);
  tick();
  return { sdk, dispose: () => (cancelAnimationFrame(frame), events.abort(), detach(), sdk.dispose()) };
}
