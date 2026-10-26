import { RawGraphData } from '../sdk/viz-engine-sdk';

export interface NodeDataTS {
  id: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  clusterId: number;
  mass: number;
  color: [number, number, number, number];
  selected?: boolean;
}

export interface EdgeDataTS {
  source: number;
  target: number;
  weight: number;
}

export interface DatasetConfigTS {
  seed: number;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  spaceRadius: number;
}

const CLUSTER_PALETTE: [number, number, number, number][] = [
  [0.22, 0.74, 0.97, 1.0],
  [0.96, 0.45, 0.71, 1.0],
  [0.20, 0.83, 0.60, 1.0],
  [0.98, 0.75, 0.14, 1.0],
  [0.65, 0.55, 0.98, 1.0],
  [0.97, 0.44, 0.44, 1.0],
  [0.38, 0.65, 0.98, 1.0],
  [0.64, 0.90, 0.21, 1.0],
];

export class DeterministicRngTS {
  private state: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.state = s === 0 ? 0x9e3779b9 : s;
  }

  nextU32(): number {
    let x = this.state >>> 0;
    x = (x ^ ((x << 13) >>> 0)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    this.state = x;
    return x;
  }

  nextF32(): number {
    return Math.fround(this.nextU32() / 4294967296.0);
  }

  nextRange(min: number, max: number): number {
    return min + (max - min) * this.nextF32();
  }
}

export class GraphDatasetTS {
  readonly nodes: NodeDataTS[];
  readonly edges: EdgeDataTS[];

  constructor(nodes: NodeDataTS[], edges: EdgeDataTS[]) {
    this.nodes = nodes;
    this.edges = edges;
  }

  static generateSeeded(config: DatasetConfigTS): GraphDatasetTS {
    const rng = new DeterministicRngTS(config.seed);
    const clusterCount = Math.max(1, config.clusterCount);
    const nodeCount = config.nodeCount;
    const radius = config.spaceRadius;

    const clusterCenters: [number, number, number][] = [];
    for (let c = 0; c < clusterCount; c++) {
      clusterCenters.push([
        rng.nextRange(-radius * 0.65, radius * 0.65),
        rng.nextRange(-radius * 0.65, radius * 0.65),
        rng.nextRange(-radius * 0.65, radius * 0.65),
      ]);
    }

    const nodes: NodeDataTS[] = new Array(nodeCount);
    const spread = radius * 0.22;
    for (let id = 0; id < nodeCount; id++) {
      const clusterIdx = id % clusterCount;
      const center = clusterCenters[clusterIdx];
      const ox = rng.nextRange(-spread, spread);
      const oy = rng.nextRange(-spread, spread);
      const oz = rng.nextRange(-spread, spread);
      const mass = rng.nextRange(0.8, 1.5);
      const color = CLUSTER_PALETTE[clusterIdx % CLUSTER_PALETTE.length];

      nodes[id] = {
        id,
        px: center[0] + ox,
        py: center[1] + oy,
        pz: center[2] + oz,
        vx: 0,
        vy: 0,
        vz: 0,
        clusterId: clusterIdx,
        mass,
        color,
      };
    }

    const edges: EdgeDataTS[] = [];
    if (nodeCount >= 2) {
      const perCluster = Math.max(1, Math.floor(nodeCount / clusterCount));
      for (let e = 0; e < config.edgeCount; e++) {
        const src = rng.nextU32() % nodeCount;
        const sameCluster = rng.nextF32() < 0.8;
        let dst: number;
        if (sameCluster && nodeCount > clusterCount) {
          const clusterIdx = src % clusterCount;
          const step = Math.max(1, rng.nextU32() % perCluster);
          dst = (clusterIdx + step * clusterCount) % nodeCount;
        } else {
          dst = rng.nextU32() % nodeCount;
        }
        if (dst === src) {
          dst = (src + 1) % nodeCount;
        }
        const weight = rng.nextRange(0.5, 1.5);
        edges.push({ source: src, target: dst, weight });
      }
    }

    return new GraphDatasetTS(nodes, edges);
  }

  totalKineticEnergy(): number {
    let sum = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const v2 = n.vx * n.vx + n.vy * n.vy + n.vz * n.vz;
      sum += 0.5 * n.mass * v2;
    }
    return sum;
  }

  toRawBuffers(): RawGraphData {
    const nLen = this.nodes.length;
    const eLen = this.edges.length;
    const positions = new Float32Array(nLen * 3);
    const masses = new Float32Array(nLen);
    const colors = new Float32Array(nLen * 4);
    const clusters = new Uint16Array(nLen);
    const edges = new Uint32Array(eLen * 2);
    const edgeWeights = new Float32Array(eLen);

    for (let i = 0; i < nLen; i++) {
      const n = this.nodes[i];
      positions[i * 3] = n.px;
      positions[i * 3 + 1] = n.py;
      positions[i * 3 + 2] = n.pz;
      masses[i] = n.mass;
      colors[i * 4] = n.color[0];
      colors[i * 4 + 1] = n.color[1];
      colors[i * 4 + 2] = n.color[2];
      colors[i * 4 + 3] = n.color[3];
      clusters[i] = n.clusterId;
    }

    for (let e = 0; e < eLen; e++) {
      const edge = this.edges[e];
      edges[e * 2] = edge.source;
      edges[e * 2 + 1] = edge.target;
      edgeWeights[e] = edge.weight;
    }

    return { positions, masses, colors, clusters, edges, edgeWeights };
  }

  static fromRawBuffers(data: RawGraphData): GraphDatasetTS {
    const nLen = Math.floor(data.positions.length / 3);
    const eLen = data.edges ? Math.floor(data.edges.length / 2) : 0;
    const nodes: NodeDataTS[] = new Array(nLen);

    for (let i = 0; i < nLen; i++) {
      const clusterId = data.clusters ? data.clusters[i] : 0;
      const mass = data.masses ? data.masses[i] : 1.0;
      const color: [number, number, number, number] = data.colors
        ? [
            data.colors[i * 4],
            data.colors[i * 4 + 1],
            data.colors[i * 4 + 2],
            data.colors[i * 4 + 3],
          ]
        : CLUSTER_PALETTE[clusterId % CLUSTER_PALETTE.length];

      nodes[i] = {
        id: i,
        px: data.positions[i * 3],
        py: data.positions[i * 3 + 1],
        pz: data.positions[i * 3 + 2],
        vx: 0,
        vy: 0,
        vz: 0,
        clusterId,
        mass,
        color,
      };
    }

    const edges: EdgeDataTS[] = new Array(eLen);
    if (data.edges) {
      for (let e = 0; e < eLen; e++) {
        edges[e] = {
          source: data.edges[e * 2],
          target: data.edges[e * 2 + 1],
          weight: data.edgeWeights ? data.edgeWeights[e] : 1.0,
        };
      }
    }

    return new GraphDatasetTS(nodes, edges);
  }
}
