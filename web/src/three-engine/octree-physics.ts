import { GraphDatasetTS, NodeDataTS } from '../domain/dataset';

export interface ForceConfigTS {
  repulsionStrength: number;
  springStiffness: number;
  springRestLength: number;
  centerGravity: number;
  damping: number;
  theta: number;
  softening: number;
  maxSpeed: number;
}

export const DEFAULT_FORCE_CONFIG: ForceConfigTS = {
  repulsionStrength: 25.0,
  springStiffness: 0.08,
  springRestLength: 8.0,
  centerGravity: 0.03,
  damping: 0.88,
  theta: 0.75,
  softening: 1.5,
  maxSpeed: 60.0,
};

interface OctreeCellTS {
  cx: number;
  cy: number;
  cz: number;
  halfSize: number;
  massWeightedX: number;
  massWeightedY: number;
  massWeightedZ: number;
  totalMass: number;
  bodyIndex: number;
  isInternal: boolean;
  children: Int32Array;
}

export class OctreeSpatialIndexTS {
  private readonly maxDepth: number;
  private cells: OctreeCellTS[] = [];
  private nodes: NodeDataTS[] = [];

  constructor(maxDepth = 10) {
    this.maxDepth = maxDepth;
  }

  private createCell(cx: number, cy: number, cz: number, halfSize: number): OctreeCellTS {
    return {
      cx,
      cy,
      cz,
      halfSize,
      massWeightedX: 0,
      massWeightedY: 0,
      massWeightedZ: 0,
      totalMass: 0,
      bodyIndex: -1,
      isInternal: false,
      children: new Int32Array(8),
    };
  }

  private octantFor(cell: OctreeCellTS, px: number, py: number, pz: number): number {
    let idx = 0;
    if (px >= cell.cx) idx |= 1;
    if (py >= cell.cy) idx |= 2;
    if (pz >= cell.cz) idx |= 4;
    return idx;
  }

  private ensureChild(cellIdx: number, octant: number): number {
    const cell = this.cells[cellIdx];
    const existing = cell.children[octant];
    if (existing !== 0) return existing;

    const step = cell.halfSize * 0.5;
    const ncx = cell.cx + ((octant & 1) !== 0 ? step : -step);
    const ncy = cell.cy + ((octant & 2) !== 0 ? step : -step);
    const ncz = cell.cz + ((octant & 4) !== 0 ? step : -step);
    const newIdx = this.cells.length;
    this.cells.push(this.createCell(ncx, ncy, ncz, step));
    cell.children[octant] = newIdx;
    return newIdx;
  }

  private insertBody(cellIdx: number, bodyIdx: number, depth: number): void {
    const body = this.nodes[bodyIdx];
    const cell = this.cells[cellIdx];
    cell.massWeightedX += body.px * body.mass;
    cell.massWeightedY += body.py * body.mass;
    cell.massWeightedZ += body.pz * body.mass;
    cell.totalMass += body.mass;

    if (!cell.isInternal) {
      if (cell.bodyIndex === -1) {
        cell.bodyIndex = bodyIdx;
        return;
      }
      if (depth >= this.maxDepth) {
        return;
      }
      const existingIdx = cell.bodyIndex;
      cell.bodyIndex = -1;
      cell.isInternal = true;
      const existingBody = this.nodes[existingIdx];
      const existingOct = this.octantFor(cell, existingBody.px, existingBody.py, existingBody.pz);
      const existingChild = this.ensureChild(cellIdx, existingOct);
      this.insertBody(existingChild, existingIdx, depth + 1);
    }

    const oct = this.octantFor(cell, body.px, body.py, body.pz);
    const childIdx = this.ensureChild(cellIdx, oct);
    this.insertBody(childIdx, bodyIdx, depth + 1);
  }

  rebuild(dataset: GraphDatasetTS): void {
    this.cells.length = 0;
    this.nodes = dataset.nodes;
    if (this.nodes.length === 0) return;

    let minX = this.nodes[0].px;
    let minY = this.nodes[0].py;
    let minZ = this.nodes[0].pz;
    let maxX = minX;
    let maxY = minY;
    let maxZ = minZ;

    for (let i = 1; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.px < minX) minX = n.px;
      if (n.py < minY) minY = n.py;
      if (n.pz < minZ) minZ = n.pz;
      if (n.px > maxX) maxX = n.px;
      if (n.py > maxY) maxY = n.py;
      if (n.pz > maxZ) maxZ = n.pz;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + 1.0;

    this.cells.push(this.createCell(cx, cy, cz, extent));
    for (let i = 0; i < this.nodes.length; i++) {
      this.insertBody(0, i, 0);
    }
  }

  computeRepulsion(
    targetId: number,
    tx: number,
    ty: number,
    tz: number,
    theta: number,
    repulsionStrength: number,
    softening: number
  ): [number, number, number] {
    if (this.cells.length === 0) return [0, 0, 0];

    const thetaSq = theta * theta;
    let fx = 0;
    let fy = 0;
    let fz = 0;

    const stack = [0];
    while (stack.length > 0) {
      const cellIdx = stack.pop()!;
      const cell = this.cells[cellIdx];
      if (cell.totalMass <= 0) continue;

      if (!cell.isInternal) {
        if (cell.bodyIndex !== -1) {
          const b = this.nodes[cell.bodyIndex];
          if (b.id === targetId) continue;
          const dx = tx - b.px;
          const dy = ty - b.py;
          const dz = tz - b.pz;
          const distSq = dx * dx + dy * dy + dz * dz + softening;
          const invDist = 1.0 / Math.sqrt(distSq);
          const mag = (repulsionStrength * b.mass) / distSq;
          const scale = invDist * mag;
          fx += dx * scale;
          fy += dy * scale;
          fz += dz * scale;
        }
        continue;
      }

      const comX = cell.massWeightedX / cell.totalMass;
      const comY = cell.massWeightedY / cell.totalMass;
      const comZ = cell.massWeightedZ / cell.totalMass;
      const dx = tx - comX;
      const dy = ty - comY;
      const dz = tz - comZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      const size = cell.halfSize * 2.0;

      if (size * size < thetaSq * distSq) {
        const effDistSq = distSq + softening;
        const invDist = 1.0 / Math.sqrt(effDistSq);
        const mag = (repulsionStrength * cell.totalMass) / effDistSq;
        const scale = invDist * mag;
        fx += dx * scale;
        fy += dy * scale;
        fz += dz * scale;
      } else {
        for (let c = 0; c < 8; c++) {
          const childIdx = cell.children[c];
          if (childIdx !== 0) stack.push(childIdx);
        }
      }
    }

    return [fx, fy, fz];
  }
}

export class ForceDirectedSimulatorTS {
  private readonly spatialIndex: OctreeSpatialIndexTS;
  private readonly config: ForceConfigTS;
  private forcesX: Float32Array = new Float32Array(0);
  private forcesY: Float32Array = new Float32Array(0);
  private forcesZ: Float32Array = new Float32Array(0);

  constructor(
    spatialIndex: OctreeSpatialIndexTS = new OctreeSpatialIndexTS(),
    config: ForceConfigTS = DEFAULT_FORCE_CONFIG
  ) {
    this.spatialIndex = spatialIndex;
    this.config = config;
  }

  step(dataset: GraphDatasetTS, dt: number): void {
    const nodes = dataset.nodes;
    const count = nodes.length;
    if (count === 0) return;

    if (this.forcesX.length < count) {
      this.forcesX = new Float32Array(count);
      this.forcesY = new Float32Array(count);
      this.forcesZ = new Float32Array(count);
    }

    this.spatialIndex.rebuild(dataset);

    const cfg = this.config;
    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      const [rx, ry, rz] = this.spatialIndex.computeRepulsion(
        n.id,
        n.px,
        n.py,
        n.pz,
        cfg.theta,
        cfg.repulsionStrength,
        cfg.softening
      );
      this.forcesX[i] = rx - n.px * cfg.centerGravity * n.mass;
      this.forcesY[i] = ry - n.py * cfg.centerGravity * n.mass;
      this.forcesZ[i] = rz - n.pz * cfg.centerGravity * n.mass;
    }

    const edges = dataset.edges;
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e];
      const src = nodes[edge.source];
      const dst = nodes[edge.target];
      const dx = dst.px - src.px;
      const dy = dst.py - src.py;
      const dz = dst.pz - src.pz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-5) {
        const displacement = dist - cfg.springRestLength;
        const mag = (cfg.springStiffness * displacement * edge.weight) / dist;
        const fx = dx * mag;
        const fy = dy * mag;
        const fz = dz * mag;
        this.forcesX[edge.source] += fx;
        this.forcesY[edge.source] += fy;
        this.forcesZ[edge.source] += fz;
        this.forcesX[edge.target] -= fx;
        this.forcesY[edge.target] -= fy;
        this.forcesZ[edge.target] -= fz;
      }
    }

    const maxSpeedSq = cfg.maxSpeed * cfg.maxSpeed;
    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      const invMass = 1.0 / Math.max(0.1, n.mass);
      let vx = (n.vx + this.forcesX[i] * invMass * dt) * cfg.damping;
      let vy = (n.vy + this.forcesY[i] * invMass * dt) * cfg.damping;
      let vz = (n.vz + this.forcesZ[i] * invMass * dt) * cfg.damping;

      const speedSq = vx * vx + vy * vy + vz * vz;
      if (speedSq > maxSpeedSq) {
        const scale = cfg.maxSpeed / Math.sqrt(speedSq);
        vx *= scale;
        vy *= scale;
        vz *= scale;
      }

      n.vx = vx;
      n.vy = vy;
      n.vz = vz;
      n.px += vx * dt;
      n.py += vy * dt;
      n.pz += vz * dt;
    }
  }
}
