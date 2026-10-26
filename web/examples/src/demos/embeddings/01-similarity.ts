import { VizEngineSDK, type EmbeddingProjectionMode, type NodeMetadata } from 'viz-engine-sdk';

export const meta = {
  title: '1536-dim embeddings → 3D with cosine k-NN',
  description:
    'Document embeddings (synthetic, 8 topics) are projected to 3D in Rust and linked to their nearest neighbors. Click a point: the top-5 most similar documents are computed with exact cosine similarity in the original 1536 dimensions.',
  height: 480,
};

const TOPICS = ['LLM architecture', 'Quant finance', 'Genomics', 'Rust systems', 'Security', 'Quantum physics', 'WebGPU', 'Patent law'];

/**
 * Stand-in for vectors from an embedding API: each document = its topic direction + one of 4
 * subtopic directions + noise, normalized (cosine ~0.55 within a subtopic, ~0.37 within a topic).
 */
function syntheticEmbeddings(n: number, dim: number) {
  let seed = 3;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()) / Math.sqrt(dim);
  const randomDirection = () => Float32Array.from({ length: dim }, gauss);
  const topics = TOPICS.map(randomDirection);
  const subtopics = TOPICS.map(() => [0, 1, 2, 3].map(randomDirection));
  const vectors = new Float32Array(n * dim);
  const clusters = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i % TOPICS.length;
    const sub = subtopics[t][Math.floor(rand() * 4)];
    const v = vectors.subarray(i * dim, (i + 1) * dim);
    for (let d = 0; d < dim; d++) v[d] = topics[t][d] + 0.7 * sub[d] + 1.1 * gauss();
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    for (let d = 0; d < dim; d++) v[d] /= norm;
    clusters[i] = t;
  }
  return { vectors, clusters };
}

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const status = document.createElement('span');
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const panel = chart.appendChild(document.createElement('div'));
  panel.className = 'side-panel';
  panel.textContent = 'Click a point to list its most similar documents.';
  const sdk = await VizEngineSDK.create(canvas, { nodeCount: 0, edgeCount: 0, locale: 'en-US' });

  const dimensions = 1536;
  const { vectors, clusters } = syntheticEmbeddings(1_000, dimensions); // 1,000 x 1536 floats
  const metadata: NodeMetadata[] = Array.from(clusters, (topic, i) => ({
    label: `doc-${String(i).padStart(4, '0')}`,
    category: TOPICS[topic],
  }));

  const project = (projection: EmbeddingProjectionMode) => {
    const stats = sdk.loadEmbeddings(vectors, {
      dimensions,
      projection,
      kNeighbors: 4, // k-NN edges per vector
      similarityThreshold: 0.3, // no edge below this cosine similarity
      clusters, // topic ids color the points (omit to cluster with spherical k-means)
    });
    sdk.setNodeMetadata(metadata);
    sdk.fitToView();
    sdk.zoomCamera(-30); // a little closer than the bounding-sphere fit
    sdk.render();
    status.textContent = `${stats.nodeCount.toLocaleString()} vectors · ${stats.edgeCount.toLocaleString()} k-NN edges · ${stats.elapsedMs.toFixed(0)} ms`;
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === projection));
  };
  for (const projection of ['pca', 'pca-umap', 'random-projection'] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = projection;
    button.onclick = () => project(projection);
  }
  toolbar.appendChild(status);

  const showSimilar = (id: number) => {
    const doc = sdk.getNodeMetadata(id);
    panel.replaceChildren();
    panel.appendChild(document.createElement('h3')).textContent = `Most similar to ${doc.label} (${doc.category})`;
    const list = panel.appendChild(document.createElement('ol'));
    for (const match of sdk.queryCosineSimilar(id, 5)) {
      const item = list.appendChild(document.createElement('li'));
      item.appendChild(document.createElement('b')).textContent = match.cosineSimilarity.toFixed(3);
      item.append(` ${match.label} · ${sdk.getNodeMetadata(match.nodeId).category}`);
    }
  };
  sdk.enableNodeInteractions(canvas, {
    autoRender: true,
    highlightNeighborsOnClick: 1, // its k-NN edges
    formatTooltip: (d) => `<b>${d.label}</b><div style="color:#38bdf8">${d.metadata.category}</div>`,
    onNodeClick: (node) => {
      if (node) showSimilar(node.id);
      else sdk.clearSelection();
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

  project('pca');
  showSimilar(0);
  return { sdk, dispose: () => (events.abort(), sdk.dispose()) };
}
