import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Shortest path · node search',
  description:
    'Click two nodes to highlight the shortest path between them (BFS in Rust). Search matches labels, categories and tags; picking a result focuses the camera on it.',
  height: 440,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const random = toolbar.appendChild(document.createElement('button'));
  random.textContent = 'Random path';
  const search = toolbar.appendChild(document.createElement('input'));
  search.type = 'search';
  search.placeholder = 'Search nodes (e.g. vector db, svc-0042, critical)';
  const results = toolbar.appendChild(document.createElement('span'));
  const status = host.appendChild(document.createElement('div'));
  status.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { seed: 7, nodeCount: 2_000, edgeCount: 2_600, clusterCount: 8, locale: 'en-US' });
  sdk.generateDefaultMetadata('svc'); // labels 'svc-0000'…, categories, tags, attributes
  sdk.warmup(150);
  sdk.fitToView();

  const name = (id: number) => sdk.getNodeMetadata(id).label ?? `#${id}`;
  let start: number | null = null;
  const tracePath = (from: number, to: number) => {
    const path = sdk.highlightShortestPath(from, to);
    status.textContent = path.length
      ? `${path.length - 1} hops: ${Array.from(path, name).join(' → ')}`
      : `${name(from)} and ${name(to)} are not connected`;
    sdk.render();
  };
  // Default tooltip; drag orbits, Shift / right drag pans, wheel zooms
  sdk.enableNodeInteractions(canvas, {
    autoRender: true,
    highlightNeighborsOnClick: 0, // clicks pick path endpoints instead
    onNodeClick: (node) => {
      if (!node) {
        start = null;
        sdk.clearSelection();
        status.textContent = 'Click a node to start a path.';
      } else if (start === null || start === node.id) {
        start = node.id;
        sdk.highlightNeighbors(node.id, 0); // marks just this node
        status.textContent = `From ${node.label}: click the destination node.`;
      } else {
        tracePath(start, node.id);
        start = null;
      }
    },
  });

  random.onclick = () => {
    start = null;
    tracePath(Math.floor(Math.random() * 2_000), Math.floor(Math.random() * 2_000));
  };

  search.oninput = () => {
    results.replaceChildren();
    for (const node of sdk.searchNodes(search.value, 4)) {
      const button = results.appendChild(document.createElement('button'));
      button.textContent = node.label;
      button.onclick = () => {
        sdk.focusNode(node.id); // centers on the node and moves the camera closer
        sdk.highlightNeighbors(node.id, 1);
        status.textContent = `${node.label} (${node.metadata.category}), neighbors: ${node.neighbors.length}`;
        sdk.render();
      };
    }
  };

  tracePath(0, 1_999);
  return { sdk, dispose: () => sdk.dispose() };
}
