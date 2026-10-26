import * as THREE from 'three';
import { GraphDatasetTS } from '../domain/dataset';
import { RawGraphData } from '../sdk/viz-engine-sdk';
import { ForceDirectedSimulatorTS, OctreeSpatialIndexTS } from '../three-engine/octree-physics';
import {
  EngineAdapter,
  EngineStepTiming,
  SpatialQueryTiming,
  WarmupTiming,
} from './engine-adapter';

export class ThreeJsAdapter implements EngineAdapter {
  readonly name = 'Three.js (InstancedMesh + WebGL2)';
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly simulator: ForceDirectedSimulatorTS;
  private dataset: GraphDatasetTS;

  private nodeMesh: THREE.InstancedMesh | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private edgePositions: Float32Array = new Float32Array(0);
  private edgeColors: Float32Array = new Float32Array(0);

  private yaw = 0.4;
  private pitch = 0.3;
  private distance = 220.0;
  private readonly target = new THREE.Vector3(0, 0, 0);
  private hasSelection = false;
  private frustumCulling = false;
  private readonly dummyMatrix = new THREE.Matrix4();
  private readonly tempColor = new THREE.Color();
  private readonly tempVec = new THREE.Vector3();
  private readonly projScreenMatrix = new THREE.Matrix4();
  private readonly threeFrustum = new THREE.Frustum();

  constructor(
    canvas: HTMLCanvasElement,
    seed: number,
    nodeCount: number,
    edgeCount: number,
    clusterCount: number
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(new THREE.Color(0.035, 0.045, 0.08), 1.0);

    this.scene = new THREE.Scene();
    const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(60, 90, 110);
    this.scene.add(ambLight, dirLight);

    const aspect = Math.max(1, canvas.width) / Math.max(1, canvas.height);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 2000);
    this.updateCameraTransform();

    this.simulator = new ForceDirectedSimulatorTS(new OctreeSpatialIndexTS(10));
    this.dataset = GraphDatasetTS.generateSeeded({
      seed,
      nodeCount,
      edgeCount,
      clusterCount,
      spaceRadius: 100.0,
    });

    this.rebuildSceneObjects();
  }

  private updateCameraTransform(): void {
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);

    this.camera.position.set(
      this.target.x + this.distance * cosP * sinY,
      this.target.y + this.distance * sinP,
      this.target.z + this.distance * cosP * cosY
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private rebuildSceneObjects(): void {
    if (this.nodeMesh) {
      this.scene.remove(this.nodeMesh);
      this.nodeMesh.geometry.dispose();
      (this.nodeMesh.material as THREE.Material).dispose();
    }
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      (this.edgeLines.material as THREE.Material).dispose();
    }

    const nCount = this.dataset.nodes.length;
    const eCount = this.dataset.edges.length;

    const sphereGeo = new THREE.SphereGeometry(1.0, 8, 6);
    const sphereMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.nodeMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, nCount);
    this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < nCount; i++) {
      const c = this.dataset.nodes[i].color;
      this.tempColor.setRGB(c[0], c[1], c[2]);
      this.nodeMesh.setColorAt(i, this.tempColor);
    }
    if (this.nodeMesh.instanceColor) {
      this.nodeMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.nodeMesh);

    this.edgePositions = new Float32Array(eCount * 6);
    this.edgeColors = new Float32Array(eCount * 6);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(this.edgePositions, 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(this.edgeColors, 3));

    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    this.scene.add(this.edgeLines);

    this.syncBuffers();
  }

  private syncBuffers(): void {
    if (!this.nodeMesh || !this.edgeLines) return;

    const nodes = this.dataset.nodes;
    const hasSel = this.hasSelection;

    if (this.frustumCulling) {
      this.projScreenMatrix.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this.threeFrustum.setFromProjectionMatrix(this.projScreenMatrix);
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (this.frustumCulling) {
        this.tempVec.set(n.px, n.py, n.pz);
        if (!this.threeFrustum.containsPoint(this.tempVec)) {
          this.dummyMatrix.makeScale(0, 0, 0);
          this.nodeMesh.setMatrixAt(i, this.dummyMatrix);
          continue;
        }
      }

      const isSelected = Boolean(n.selected);
      const r = hasSel && isSelected ? n.mass * 1.25 : n.mass * 0.95;
      this.dummyMatrix.makeScale(r, r, r);
      this.dummyMatrix.setPosition(n.px, n.py, n.pz);
      this.nodeMesh.setMatrixAt(i, this.dummyMatrix);

      const c = n.color;
      if (hasSel && !isSelected) {
        this.tempColor.setRGB(c[0] * 0.25, c[1] * 0.25, c[2] * 0.25);
      } else {
        this.tempColor.setRGB(c[0], c[1], c[2]);
      }
      this.nodeMesh.setColorAt(i, this.tempColor);
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    if (this.nodeMesh.instanceColor) {
      this.nodeMesh.instanceColor.needsUpdate = true;
    }

    const edges = this.dataset.edges;
    const posArr = this.edgePositions;
    const colArr = this.edgeColors;
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e];
      const s = nodes[edge.source];
      const d = nodes[edge.target];
      const base = e * 6;

      posArr[base] = s.px;
      posArr[base + 1] = s.py;
      posArr[base + 2] = s.pz;
      posArr[base + 3] = d.px;
      posArr[base + 4] = d.py;
      posArr[base + 5] = d.pz;

      const dimScale = hasSel ? (s.selected && d.selected ? 1.0 : 0.15) : 1.0;
      colArr[base] = s.color[0] * dimScale;
      colArr[base + 1] = s.color[1] * dimScale;
      colArr[base + 2] = s.color[2] * dimScale;
      colArr[base + 3] = d.color[0] * dimScale;
      colArr[base + 4] = d.color[1] * dimScale;
      colArr[base + 5] = d.color[2] * dimScale;
    }

    const posAttr = this.edgeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    const colAttr = this.edgeLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    colAttr.needsUpdate = true;
  }

  reloadDataset(seed: number, nodeCount: number, edgeCount: number, clusterCount: number): void {
    this.hasSelection = false;
    this.dataset = GraphDatasetTS.generateSeeded({
      seed,
      nodeCount,
      edgeCount,
      clusterCount,
      spaceRadius: 100.0,
    });
    this.rebuildSceneObjects();
  }

  loadRawDataset(data: RawGraphData): number {
    const t0 = performance.now();
    this.hasSelection = false;
    this.dataset = GraphDatasetTS.fromRawBuffers(data);
    this.rebuildSceneObjects();
    this.renderer.render(this.scene, this.camera);
    return performance.now() - t0;
  }

  warmup(ticks: number, dt: number): WarmupTiming {
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      this.simulator.step(this.dataset, dt);
    }
    const kineticEnergy = this.dataset.totalKineticEnergy();
    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
    return {
      elapsedMs: performance.now() - t0,
      kineticEnergy,
    };
  }

  boxSelect(
    minNdcX: number,
    minNdcY: number,
    maxNdcX: number,
    maxNdcY: number
  ): SpatialQueryTiming {
    const t0 = performance.now();
    const x0 = Math.min(minNdcX, maxNdcX);
    const x1 = Math.max(minNdcX, maxNdcX);
    const y0 = Math.min(minNdcY, maxNdcY);
    const y1 = Math.max(minNdcY, maxNdcY);

    let selectedCount = 0;
    const nodes = this.dataset.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      this.tempVec.set(n.px, n.py, n.pz).project(this.camera);
      const inside =
        this.tempVec.z >= -1.0 &&
        this.tempVec.z <= 1.0 &&
        this.tempVec.x >= x0 &&
        this.tempVec.x <= x1 &&
        this.tempVec.y >= y0 &&
        this.tempVec.y <= y1;
      n.selected = inside;
      if (inside) selectedCount++;
    }
    this.hasSelection = selectedCount > 0;
    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
    return {
      elapsedMs: performance.now() - t0,
      selectedCount,
    };
  }

  highlightNeighbors(nodeId: number, hops: number): SpatialQueryTiming {
    const t0 = performance.now();
    const nodes = this.dataset.nodes;
    const edges = this.dataset.edges;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].selected = false;
    }

    if (nodeId < 0 || nodeId >= nodes.length) {
      this.hasSelection = false;
      this.syncBuffers();
      this.renderer.render(this.scene, this.camera);
      return { elapsedMs: performance.now() - t0, selectedCount: 0 };
    }

    const visited = new Uint8Array(nodes.length);
    visited[nodeId] = 1;
    nodes[nodeId].selected = true;
    let frontier = [nodeId];
    let selectedCount = 1;

    for (let h = 0; h < hops; h++) {
      if (frontier.length === 0) break;
      const frontierSet = new Set(frontier);
      const nextFrontier: number[] = [];
      for (let e = 0; e < edges.length; e++) {
        const u = edges[e].source;
        const v = edges[e].target;
        if (visited[u] && !visited[v] && frontierSet.has(u)) {
          visited[v] = 1;
          nodes[v].selected = true;
          nextFrontier.push(v);
          selectedCount++;
        } else if (visited[v] && !visited[u] && frontierSet.has(v)) {
          visited[u] = 1;
          nodes[u].selected = true;
          nextFrontier.push(u);
          selectedCount++;
        }
      }
      frontier = nextFrontier;
    }

    this.hasSelection = selectedCount > 0;
    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
    return {
      elapsedMs: performance.now() - t0,
      selectedCount,
    };
  }

  selectCluster(clusterId: number): SpatialQueryTiming {
    const t0 = performance.now();
    let selectedCount = 0;
    const nodes = this.dataset.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const matched = nodes[i].clusterId === clusterId;
      nodes[i].selected = matched;
      if (matched) selectedCount++;
    }
    this.hasSelection = selectedCount > 0;
    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
    return {
      elapsedMs: performance.now() - t0,
      selectedCount,
    };
  }

  clearSelection(): void {
    this.hasSelection = false;
    for (let i = 0; i < this.dataset.nodes.length; i++) {
      this.dataset.nodes[i].selected = false;
    }
    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
  }

  fitToView(): void {
    const nodes = this.dataset.nodes;
    if (nodes.length === 0) return;
    let minX = nodes[0].px;
    let minY = nodes[0].py;
    let minZ = nodes[0].pz;
    let maxX = minX;
    let maxY = minY;
    let maxZ = minZ;
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
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
    let maxDistSq = 1.0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = n.px - cx;
      const dy = n.py - cy;
      const dz = n.pz - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > maxDistSq) maxDistSq = dSq;
    }
    const radius = Math.sqrt(maxDistSq);
    this.target.set(cx, cy, cz);
    const halfFov = (45.0 * Math.PI) / 360.0;
    this.distance = Math.max(5.0, Math.min(5000.0, (radius / Math.sin(halfFov)) * 1.18));
    this.updateCameraTransform();
    this.renderer.render(this.scene, this.camera);
  }

  setFrustumCulling(enabled: boolean): void {
    this.frustumCulling = enabled;
    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
  }

  tick(dt: number, simulatePhysics: boolean): EngineStepTiming {
    const t0 = performance.now();
    if (simulatePhysics) {
      this.simulator.step(this.dataset, dt);
    }
    const kineticEnergy = this.dataset.totalKineticEnergy();
    const t1 = performance.now();

    this.syncBuffers();
    this.renderer.render(this.scene, this.camera);
    const t2 = performance.now();

    return {
      physicsTimeMs: t1 - t0,
      renderTimeMs: t2 - t1,
      totalTimeMs: t2 - t0,
      kineticEnergy,
    };
  }

  rotateCamera(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    const limit = Math.PI * 0.5 - 0.05;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch + deltaPitch));
    this.updateCameraTransform();
  }

  zoomCamera(delta: number): void {
    this.distance = Math.max(5.0, Math.min(1500.0, this.distance + delta));
    this.updateCameraTransform();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  nodeCount(): number {
    return this.dataset.nodes.length;
  }

  edgeCount(): number {
    return this.dataset.edges.length;
  }
}
