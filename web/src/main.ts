import { RustWgpuAdapter } from './adapters/rust-wgpu-adapter';
import { ThreeJsAdapter } from './adapters/three-js-adapter';
import { BenchmarkController, EngineTarget } from './benchmark/controller';
import { LayoutPresetMode, NodeDetails } from './sdk/charturbo';
import { CharturboShowcaseController } from './showcase/charturbo-showcase';

const SEED = 42;
const CLUSTERS = 8;
const BENCH_FRAMES = 30;

type RunTask =
  | { kind: 'idle' }
  | { kind: 'batch'; target: EngineTarget; remaining: number; nextTarget?: EngineTarget }
  | { kind: 'continuous'; target: EngineTarget };

async function bootstrap(): Promise<void> {
  const rustCanvas = document.getElementById('rust-canvas') as HTMLCanvasElement;
  const threeCanvas = document.getElementById('three-canvas') as HTMLCanvasElement;
  const rustPane = document.getElementById('rust-pane') as HTMLElement;
  const threePane = document.getElementById('three-pane') as HTMLElement;
  const statusBadge = document.getElementById('status-badge') as HTMLElement;

  // Data Volume Controls
  const sliderNodes = document.getElementById('slider-nodes') as HTMLInputElement;
  const inputNodes = document.getElementById('input-nodes') as HTMLInputElement;
  const sliderEdges = document.getElementById('slider-edges') as HTMLInputElement;
  const inputEdges = document.getElementById('input-edges') as HTMLInputElement;
  const presetBtns = document.querySelectorAll<HTMLButtonElement>('#preset-buttons button');
  const applyDataBtn = document.getElementById('btn-apply-data') as HTMLButtonElement;
  const datasetLabel = document.getElementById('current-dataset-label') as HTMLElement;

  // Execution Controls
  const btnBenchRust = document.getElementById('btn-bench-rust') as HTMLButtonElement;
  const btnBenchThree = document.getElementById('btn-bench-three') as HTMLButtonElement;
  const btnBenchSeq = document.getElementById('btn-bench-seq') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
  const btnStepRust = document.getElementById('btn-step-rust') as HTMLButtonElement;
  const btnLoopRust = document.getElementById('btn-loop-rust') as HTMLButtonElement;
  const btnStepThree = document.getElementById('btn-step-three') as HTMLButtonElement;
  const btnLoopThree = document.getElementById('btn-loop-three') as HTMLButtonElement;
  const physicsCheckbox = document.getElementById('toggle-physics') as HTMLInputElement;
  const cullingCheckbox = document.getElementById('toggle-culling') as HTMLInputElement;

  // SDK Feature Comparison Controls
  const btnSdkWarmup = document.getElementById('btn-sdk-warmup') as HTMLButtonElement;
  const btnSdkBox = document.getElementById('btn-sdk-box') as HTMLButtonElement;
  const btnSdkNeighbor = document.getElementById('btn-sdk-neighbor') as HTMLButtonElement;
  const btnSdkCluster = document.getElementById('btn-sdk-cluster') as HTMLButtonElement;
  const btnSdkFit = document.getElementById('btn-sdk-fit') as HTMLButtonElement;
  const btnSdkClear = document.getElementById('btn-sdk-clear') as HTMLButtonElement;

  // DOM Elements for Telemetry
  const rustSamplesEl = document.getElementById('rust-samples')!;
  const rustFpsEl = document.getElementById('rust-fps')!;
  const rustLowFpsEl = document.getElementById('rust-low-fps')!;
  const rustPhysicsEl = document.getElementById('rust-physics-ms')!;
  const rustRenderEl = document.getElementById('rust-render-ms')!;
  const rustTotalEl = document.getElementById('rust-total-ms')!;

  const threeSamplesEl = document.getElementById('three-samples')!;
  const threeFpsEl = document.getElementById('three-fps')!;
  const threeLowFpsEl = document.getElementById('three-low-fps')!;
  const threePhysicsEl = document.getElementById('three-physics-ms')!;
  const threeRenderEl = document.getElementById('three-render-ms')!;
  const threeTotalEl = document.getElementById('three-total-ms')!;

  const physicsSpeedupEl = document.getElementById('physics-speedup-val')!;
  const totalSpeedupEl = document.getElementById('total-speedup-val')!;
  const sdkFeatureSpeedupEl = document.getElementById('sdk-feature-speedup-val')!;

  let controller: BenchmarkController | null = null;
  let currentTask: RunTask = { kind: 'idle' };
  let rafId: number | null = null;

  const stopAll = (): void => {
    currentTask = { kind: 'idle' };
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    rustPane.classList.remove('active-running');
    threePane.classList.remove('active-running');
    btnLoopRust.classList.remove('active');
    btnLoopRust.textContent = '연속 실행 켜기';
    btnLoopThree.classList.remove('active');
    btnLoopThree.textContent = '연속 실행 켜기';
    btnStop.disabled = true;
    statusBadge.textContent = '대기 중 (버튼을 눌러 하나씩 측정하세요)';
  };

  const applyData = (nodes: number, edges: number): void => {
    stopAll();
    const cleanNodes = Math.max(10, Math.min(100000, Math.floor(nodes || 1000)));
    const cleanEdges = Math.max(0, Math.min(250000, Math.floor(edges ?? 2000)));

    inputNodes.value = String(cleanNodes);
    sliderNodes.value = String(Math.min(50000, cleanNodes));
    inputEdges.value = String(cleanEdges);
    sliderEdges.value = String(Math.min(100000, cleanEdges));
    datasetLabel.textContent = `노드 ${cleanNodes.toLocaleString()}개 / 엣지 ${cleanEdges.toLocaleString()}개 (클러스터 ${CLUSTERS}개)`;

    if (controller) {
      controller.applyCustomDataset({
        seed: SEED,
        nodeCount: cleanNodes,
        edgeCount: cleanEdges,
        clusterCount: CLUSTERS,
      });
      rustAdapter.sdk.generateDefaultMetadata('Service-Node');
      controller.renderStaticPreview();
      updateTelemetryUI();
      statusBadge.textContent = `데이터셋 적용 완료 (노드 ${cleanNodes.toLocaleString()}개 / 엣지 ${cleanEdges.toLocaleString()}개) — 노드를 클릭해 상세 데이터를 확인하거나 측정 버튼을 눌러주세요`;
    }
  };

  // Register UI input listeners IMMEDIATELY before async WASM/WebGPU initialization
  sliderNodes.addEventListener('input', () => {
    inputNodes.value = sliderNodes.value;
    presetBtns.forEach((b) => b.classList.remove('active'));
    datasetLabel.textContent = `노드 ${Number(sliderNodes.value).toLocaleString()}개 / 엣지 ${Number(inputEdges.value).toLocaleString()}개 (클러스터 ${CLUSTERS}개)`;
  });

  sliderNodes.addEventListener('change', () => {
    applyData(Number(sliderNodes.value), Number(inputEdges.value));
  });

  inputNodes.addEventListener('input', () => {
    sliderNodes.value = String(Math.min(50000, Number(inputNodes.value) || 100));
    presetBtns.forEach((b) => b.classList.remove('active'));
  });

  inputNodes.addEventListener('change', () => {
    applyData(Number(inputNodes.value), Number(inputEdges.value));
  });

  sliderEdges.addEventListener('input', () => {
    inputEdges.value = sliderEdges.value;
    presetBtns.forEach((b) => b.classList.remove('active'));
    datasetLabel.textContent = `노드 ${Number(inputNodes.value).toLocaleString()}개 / 엣지 ${Number(sliderEdges.value).toLocaleString()}개 (클러스터 ${CLUSTERS}개)`;
  });

  sliderEdges.addEventListener('change', () => {
    applyData(Number(inputNodes.value), Number(sliderEdges.value));
  });

  inputEdges.addEventListener('input', () => {
    sliderEdges.value = String(Math.min(100000, Number(inputEdges.value) || 0));
    presetBtns.forEach((b) => b.classList.remove('active'));
  });

  inputEdges.addEventListener('change', () => {
    applyData(Number(inputNodes.value), Number(inputEdges.value));
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyData(Number(btn.dataset.nodes), Number(btn.dataset.edges));
    });
  });

  applyDataBtn.addEventListener('click', () => {
    applyData(Number(inputNodes.value), Number(inputEdges.value));
  });

  // Now initialize Three.js and Rust + wgpu engines
  statusBadge.textContent = 'WASM 및 GPU 파이프라인 초기화 중...';
  syncCanvasPixelSize(rustCanvas);
  syncCanvasPixelSize(threeCanvas);

  const initialNodes = Number(inputNodes.value) || 1000;
  const initialEdges = Number(inputEdges.value) || 2000;

  const threeAdapter = new ThreeJsAdapter(
    threeCanvas,
    SEED,
    initialNodes,
    initialEdges,
    CLUSTERS
  );
  const rustAdapter = await RustWgpuAdapter.create(
    rustCanvas,
    SEED,
    initialNodes,
    initialEdges,
    CLUSTERS
  );

  controller = new BenchmarkController(rustAdapter, threeAdapter);

  const tabShowcase = document.getElementById('tab-showcase') as HTMLButtonElement | null;
  const tabBenchmark = document.getElementById('tab-benchmark') as HTMLButtonElement | null;
  const benchHeader = document.getElementById('benchmark-header-controls');
  const speedupBanner = document.getElementById('speedup-banner');
  const showcaseLeftPanel = document.getElementById('showcase-left-panel');
  const rustBenchCard = document.getElementById('rust-benchmark-card');
  const graphHintBadge = document.getElementById('graph-interaction-hint');
  const nodeInspectorCard = document.getElementById('node-inspector-card');

  let detachNodeInteractions: (() => void) | null = null;
  let inspectedNodeId: number | null = null;

  const renderNodeInspector = (details: NodeDetails | null): void => {
    if (!nodeInspectorCard) return;
    if (!details) {
      nodeInspectorCard.style.display = 'none';
      inspectedNodeId = null;
      return;
    }
    inspectedNodeId = details.id;
    nodeInspectorCard.style.display = 'flex';

    const catEl = document.getElementById('node-insp-category');
    const titleEl = document.getElementById('node-insp-title');
    const descEl = document.getElementById('node-insp-desc');
    const degreeEl = document.getElementById('node-insp-degree');
    const posEl = document.getElementById('node-insp-pos');
    const stateEl = document.getElementById('node-insp-state');
    const attrsEl = document.getElementById('node-insp-attrs');
    const neighborsLabelEl = document.getElementById('node-insp-neighbors-label');
    const neighborsEl = document.getElementById('node-insp-neighbors');
    const pinBtn = document.getElementById('btn-node-pin');

    if (catEl) {
      catEl.textContent = `${details.metadata.category ?? 'Node'} · Cluster ${details.clusterId}`;
    }
    if (titleEl) {
      titleEl.textContent = `${details.label} (#${details.id})`;
    }
    if (descEl) {
      descEl.textContent =
        details.metadata.description ?? `클러스터 #${details.clusterId}에 속한 3D 그래프 노드입니다.`;
    }
    if (degreeEl) {
      degreeEl.textContent = `${details.degree}개 엣지 (${details.neighbors.length}개 이웃)`;
    }
    if (posEl) {
      const [x, y, z] = details.position;
      posEl.textContent = `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
    }
    if (stateEl) {
      stateEl.textContent = `Mass ${details.mass.toFixed(2)} · ${details.pinned ? '📌 고정됨(Pinned)' : '자유 이동'}`;
    }
    if (pinBtn) {
      pinBtn.textContent = details.pinned ? '📌 고정 해제' : '📌 위치 고정';
    }

    if (attrsEl) {
      attrsEl.innerHTML = '';
      const attrs = details.metadata.attributes ?? {};
      for (const [k, v] of Object.entries(attrs)) {
        const pill = document.createElement('div');
        pill.className = 'node-attr-pill';
        const key = pill.appendChild(document.createElement('span'));
        key.textContent = k;
        const value = pill.appendChild(document.createElement('strong'));
        value.textContent = String(v);
        attrsEl.appendChild(pill);
      }
    }

    const activeDim = rustAdapter.sdk.embeddingDimension();
    const cosineMatches =
      activeDim > 0 ? rustAdapter.sdk.queryCosineSimilar(details.id, 10) : [];

    if (neighborsLabelEl) {
      if (activeDim > 0 && cosineMatches.length > 0) {
        neighborsLabelEl.textContent = `🔮 원본 ${activeDim}D 코사인 유사도 Top-${cosineMatches.length} (클릭 시 이동)`;
      } else {
        neighborsLabelEl.textContent = `🕸️ 1-Hop 연결 이웃 (${details.neighbors.length}개 · 클릭 시 이동)`;
      }
    }
    if (neighborsEl) {
      neighborsEl.innerHTML = '';
      if (activeDim > 0 && cosineMatches.length > 0) {
        for (const m of cosineMatches) {
          const chip = document.createElement('button');
          chip.className = 'neighbor-chip';
          chip.textContent = `#${m.nodeId} (${m.cosineSimilarity.toFixed(3)})`;
          chip.title = `${m.label} — ${activeDim}D Cosine Similarity: ${m.cosineSimilarity}`;
          chip.addEventListener('click', () => {
            rustAdapter.sdk.highlightNeighbors(m.nodeId, 1);
            rustAdapter.sdk.focusNode(m.nodeId);
            rustAdapter.sdk.render();
            const nextDetails = rustAdapter.sdk.getNodeDetails(m.nodeId);
            renderNodeInspector(nextDetails);
            statusBadge.textContent = `🔮 ${activeDim}D 코사인 유사 노드 #${m.nodeId} (유사도 ${m.cosineSimilarity.toFixed(3)})로 포커스 이동`;
          });
          neighborsEl.appendChild(chip);
        }
      } else if (details.neighbors.length === 0) {
        neighborsEl.innerHTML = `<span style="font-size:0.72rem;color:#64748b;">연결된 이웃 노드가 없습니다.</span>`;
      } else {
        for (const nId of details.neighbors.slice(0, 24)) {
          const chip = document.createElement('button');
          chip.className = 'neighbor-chip';
          chip.textContent = `#${nId}`;
          chip.addEventListener('click', () => {
            rustAdapter.sdk.highlightNeighbors(nId, 1);
            rustAdapter.sdk.focusNode(nId);
            if (!showcase.isActive()) {
              threeAdapter.highlightNeighbors(nId, 1);
              controller?.renderStaticPreview();
            } else {
              rustAdapter.sdk.render();
            }
            const nextDetails = rustAdapter.sdk.getNodeDetails(nId);
            renderNodeInspector(nextDetails);
            statusBadge.textContent = `이웃 노드 #${nId} (${nextDetails?.label ?? ''})로 포커스 이동 완료`;
          });
          neighborsEl.appendChild(chip);
        }
      }
    }
  };

  const showcase = new CharturboShowcaseController(
    rustAdapter.sdk,
    rustCanvas,
    (details) => renderNodeInspector(details),
    (msg) => {
      statusBadge.textContent = msg;
    }
  );

  const handleResize = (): void => {
    if (!controller) return;
    const rSize = syncCanvasPixelSize(rustCanvas);
    rustAdapter.resize(rSize.width, rSize.height);
    if (!showcase.isActive()) {
      const tSize = syncCanvasPixelSize(threeCanvas);
      threeAdapter.resize(tSize.width, tSize.height);
      controller.renderStaticPreview();
    } else {
      rustAdapter.sdk.render();
    }
  };
  window.addEventListener('resize', handleResize);
  // Layout changes (mode switch, panels) resize the canvases without a window resize event;
  // a stale backing store would squash the chart and misplace its DOM labels
  if (typeof ResizeObserver !== 'undefined') {
    let pending = false;
    const observer = new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        handleResize();
      });
    });
    observer.observe(rustCanvas);
    observer.observe(threeCanvas);
  }

  const switchToMode = (mode: 'showcase' | 'benchmark'): void => {
    stopAll();
    const isShowcase = mode === 'showcase';
    const isBench = mode === 'benchmark';

    if (!isShowcase && showcase.isActive()) showcase.deactivate();
    if (!isBench && detachNodeInteractions) {
      detachNodeInteractions();
      detachNodeInteractions = null;
    }
    renderNodeInspector(null);

    document.body.classList.toggle('showcase-mode', isShowcase);

    tabShowcase?.classList.toggle('active', isShowcase);
    tabBenchmark?.classList.toggle('active', isBench);

    if (benchHeader) benchHeader.style.display = isBench ? 'flex' : 'none';
    if (speedupBanner) speedupBanner.style.display = isBench ? 'flex' : 'none';
    if (showcaseLeftPanel) showcaseLeftPanel.style.display = isShowcase ? 'flex' : 'none';
    if (threePane) threePane.style.display = isBench ? 'block' : 'none';
    if (rustBenchCard) rustBenchCard.style.display = isBench ? 'block' : 'none';
    if (graphHintBadge) graphHintBadge.style.display = 'flex';

    handleResize();

    if (isShowcase) {
      showcase.activate();
      statusBadge.textContent =
        '🎨 Examples — 좌측에서 2D 대용량 차트 / 3D 시각화 예제를 선택하고, 데이터 포인트를 클릭해 상세 수치를 확인하세요!';
    } else {
      rustAdapter.reloadDataset(
        SEED,
        Number(inputNodes.value) || 1000,
        Number(inputEdges.value) || 2000,
        CLUSTERS
      );
      rustAdapter.sdk.generateDefaultMetadata('Service-Node');
      handleResize();

      if (!detachNodeInteractions) {
        detachNodeInteractions = rustAdapter.sdk.enableNodeInteractions(rustCanvas, {
          builtInTooltip: true,
          highlightNeighborsOnClick: 1,
          focusOnDoubleClick: true,
          autoRender: true,
          // Benchmark: attachPointerControls drives both engines' cameras in sync (touch included)
          touch: false,
          cameraControls: false,
          onNodeHover: () => {
            if (currentTask.kind === 'idle') {
              rustAdapter.sdk.render();
            }
          },
          onNodeClick: (details) => {
            if (details) {
              threeAdapter.highlightNeighbors(details.id, 1);
              controller?.renderStaticPreview();
              renderNodeInspector(details);
              statusBadge.textContent = `🔍 노드 선택: ${details.label} (#${details.id}) · 연결 이웃 ${details.neighbors.length}개 하이라이트`;
            } else {
              controller?.clearSelectionAll();
              renderNodeInspector(null);
              statusBadge.textContent = '배경 클릭 — 노드 선택 해제됨';
            }
          },
        });
      }

      statusBadge.textContent =
        '⚡ 성능 벤치마크 — Charturbo vs Three.js 측정 버튼을 눌러 비교하세요.';
    }
  };

  tabShowcase?.addEventListener('click', () => switchToMode('showcase'));
  tabBenchmark?.addEventListener('click', () => switchToMode('benchmark'));

  // Start in the Examples gallery by default
  switchToMode('showcase');

  const scheduleNextTick = (): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(processTick);
  };

  const processTick = (): void => {
    rafId = null;
    if (!controller || currentTask.kind === 'idle') return;

    const simulate = physicsCheckbox.checked;
    const target = currentTask.target;

    rustPane.classList.toggle('active-running', target === 'rust');
    threePane.classList.toggle('active-running', target === 'three');

    controller.rotateCameras(0.004, 0.0);
    controller.stepSingleEngine(target, 0.016, simulate);
    updateTelemetryUI();

    if (currentTask.kind === 'batch') {
      currentTask.remaining--;
      const doneCount = BENCH_FRAMES - currentTask.remaining;
      statusBadge.textContent = `${target === 'rust' ? 'Rust + wgpu' : 'Three.js'} 측정 중... (${doneCount}/${BENCH_FRAMES} 프레임)`;

      if (currentTask.remaining <= 0) {
        if (currentTask.nextTarget) {
          const next = currentTask.nextTarget;
          controller.resetMetrics(next);
          currentTask = { kind: 'batch', target: next, remaining: BENCH_FRAMES };
          scheduleNextTick();
        } else {
          stopAll();
          statusBadge.textContent = '측정 완료! 상단 배너와 각 카드에서 결과를 확인하세요.';
        }
        return;
      }
      scheduleNextTick();
    } else if (currentTask.kind === 'continuous') {
      scheduleNextTick();
    }
  };

  btnBenchRust.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    controller.resetMetrics('rust');
    currentTask = { kind: 'batch', target: 'rust', remaining: BENCH_FRAMES };
    btnStop.disabled = false;
    scheduleNextTick();
  });

  btnBenchThree.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    controller.resetMetrics('three');
    currentTask = { kind: 'batch', target: 'three', remaining: BENCH_FRAMES };
    btnStop.disabled = false;
    scheduleNextTick();
  });

  btnBenchSeq.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    controller.resetMetrics();
    currentTask = {
      kind: 'batch',
      target: 'rust',
      remaining: BENCH_FRAMES,
      nextTarget: 'three',
    };
    btnStop.disabled = false;
    scheduleNextTick();
  });

  btnStop.addEventListener('click', () => {
    stopAll();
  });

  btnStepRust.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    controller.stepSingleEngine('rust', 0.016, physicsCheckbox.checked);
    updateTelemetryUI();
    statusBadge.textContent = 'Rust + wgpu 1스텝 측정 완료';
  });

  btnStepThree.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    controller.stepSingleEngine('three', 0.016, physicsCheckbox.checked);
    updateTelemetryUI();
    statusBadge.textContent = 'Three.js 1스텝 측정 완료';
  });

  btnLoopRust.addEventListener('click', () => {
    if (!controller) return;
    if (currentTask.kind === 'continuous' && currentTask.target === 'rust') {
      stopAll();
      return;
    }
    stopAll();
    currentTask = { kind: 'continuous', target: 'rust' };
    btnLoopRust.classList.add('active');
    btnLoopRust.textContent = '연속 실행 중 (클릭 시 정지)';
    btnStop.disabled = false;
    statusBadge.textContent = 'Rust + wgpu 단독 연속 실행 중';
    scheduleNextTick();
  });

  btnLoopThree.addEventListener('click', () => {
    if (!controller) return;
    if (currentTask.kind === 'continuous' && currentTask.target === 'three') {
      stopAll();
      return;
    }
    stopAll();
    currentTask = { kind: 'continuous', target: 'three' };
    btnLoopThree.classList.add('active');
    btnLoopThree.textContent = '연속 실행 중 (클릭 시 정지)';
    btnStop.disabled = false;
    statusBadge.textContent = 'Three.js 단독 연속 실행 중';
    scheduleNextTick();
  });

  // SDK Module vs Three.js Feature Comparison Handlers
  let currentClusterIdx = 0;

  cullingCheckbox.addEventListener('change', () => {
    if (!controller) return;
    controller.setFrustumCullingAll(cullingCheckbox.checked);
    statusBadge.textContent = `Octree Frustum Culling ${cullingCheckbox.checked ? '활성화' : '비활성화'} 완료`;
  });

  btnSdkWarmup.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    const comp = controller.compareWarmup(40, 0.016);
    updateTelemetryUI();
    statusBadge.textContent = `[Warmup 40틱 완료] Charturbo: ${comp.rustMs.toFixed(2)}ms vs Three.js: ${comp.threeMs.toFixed(2)}ms (${comp.speedup.toFixed(2)}배 빠름)`;
  });

  btnSdkBox.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    const comp = controller.compareBoxSelect(-0.35, -0.35, 0.35, 0.35);
    updateTelemetryUI();
    statusBadge.textContent = `[Box 영역 선택 완료] ${comp.selectedCount.toLocaleString()}개 선택 — Charturbo: ${comp.rustMs.toFixed(2)}ms vs Three.js: ${comp.threeMs.toFixed(2)}ms`;
  });

  btnSdkNeighbor.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    const randomNode = Math.floor(Math.random() * Math.max(1, rustAdapter.nodeCount()));
    const comp = controller.compareNeighborHighlight(randomNode, 2);
    updateTelemetryUI();
    statusBadge.textContent = `[2-Hop 서브그래프 탐색] 노드 #${randomNode} (${comp.selectedCount}개 연결) — Charturbo: ${comp.rustMs.toFixed(2)}ms vs Three.js: ${comp.threeMs.toFixed(2)}ms`;
  });

  btnSdkCluster.addEventListener('click', () => {
    if (!controller) return;
    stopAll();
    const comp = controller.compareClusterSelect(currentClusterIdx);
    currentClusterIdx = (currentClusterIdx + 1) % CLUSTERS;
    updateTelemetryUI();
    statusBadge.textContent = `[클러스터 필터링] ${comp.operation} — Charturbo: ${comp.rustMs.toFixed(2)}ms vs Three.js: ${comp.threeMs.toFixed(2)}ms`;
  });

  btnSdkFit.addEventListener('click', () => {
    if (!controller) return;
    controller.fitToViewAll();
    statusBadge.textContent = '카메라 Fit to View (바운딩 스피어 자동 맞춤) 적용 완료';
  });

  btnSdkClear.addEventListener('click', () => {
    if (!controller) return;
    controller.clearSelectionAll();
    renderNodeInspector(null);
    statusBadge.textContent = '서브그래프 / 영역 선택 해제 완료';
  });

  // 3D Layout Presets, Shortest Path & Node Search Handlers
  const layoutPresetBtns = document.querySelectorAll<HTMLButtonElement>('[data-layout-preset]');
  layoutPresetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!controller) return;
      stopAll();
      const mode = btn.dataset.layoutPreset as LayoutPresetMode;
      const t0 = performance.now();
      rustAdapter.sdk.applyLayout(mode, 85);
      rustAdapter.sdk.fitToView();
      rustAdapter.sdk.render();
      const elapsed = performance.now() - t0;
      if (inspectedNodeId !== null) {
        renderNodeInspector(rustAdapter.sdk.getNodeDetails(inspectedNodeId));
      }
      statusBadge.textContent = `[3D 배치 프리셋 적용: ${btn.textContent?.trim()}] ${elapsed.toFixed(2)}ms 완료 — 노드를 클릭해 데이터를 확인하세요`;
    });
  });

  const runShortestPathDemo = (fromNode?: number): void => {
    if (!controller) return;
    stopAll();
    const total = Math.max(1, rustAdapter.nodeCount());
    const src = fromNode ?? (inspectedNodeId !== null ? inspectedNodeId : 0);
    let dst = Math.floor(Math.random() * total);
    if (dst === src && total > 1) dst = (src + Math.floor(total / 2)) % total;

    const t0 = performance.now();
    const path = rustAdapter.sdk.highlightShortestPath(src, dst);
    const elapsed = performance.now() - t0;
    rustAdapter.sdk.render();

    if (path.length > 0) {
      statusBadge.textContent = `⚡ [BFS 최단 경로 탐색] #${src} ➔ #${dst} (${path.length - 1} Hops: ${Array.from(path).join(' → ')}) — ${elapsed.toFixed(2)}ms`;
      renderNodeInspector(rustAdapter.sdk.getNodeDetails(src));
    } else {
      statusBadge.textContent = `⚡ [BFS 최단 경로 탐색] #${src} ➔ #${dst} 사이에 연결된 경로가 없습니다 (${elapsed.toFixed(2)}ms)`;
    }
  };

  document.getElementById('btn-sdk-shortest-path')?.addEventListener('click', () => {
    runShortestPathDemo();
  });

  const inputNodeSearch = document.getElementById('input-node-search') as HTMLInputElement | null;
  const executeNodeSearch = (): void => {
    if (!inputNodeSearch || !controller) return;
    const q = inputNodeSearch.value.trim();
    if (!q) return;
    const results = rustAdapter.sdk.searchNodes(q, 10);
    if (results.length > 0) {
      const top = results[0];
      rustAdapter.sdk.highlightNeighbors(top.id, 1);
      rustAdapter.sdk.focusNode(top.id);
      threeAdapter.highlightNeighbors(top.id, 1);
      controller.renderStaticPreview();
      renderNodeInspector(rustAdapter.sdk.getNodeDetails(top.id));
      statusBadge.textContent = `🔍 검색 결과 (${results.length}건): ${top.label} (#${top.id}) 포커스 및 상세 데이터 표시`;
    } else {
      statusBadge.textContent = `🔍 '${q}'에 해당하는 노드를 찾지 못했습니다.`;
    }
  };

  document.getElementById('btn-node-search')?.addEventListener('click', executeNodeSearch);
  inputNodeSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeNodeSearch();
  });

  // Node Inspector Card Action Buttons
  document.getElementById('btn-node-insp-close')?.addEventListener('click', () => {
    renderNodeInspector(null);
  });

  document.getElementById('btn-node-focus')?.addEventListener('click', () => {
    if (inspectedNodeId === null) return;
    rustAdapter.sdk.focusNode(inspectedNodeId);
    rustAdapter.sdk.render();
    statusBadge.textContent = `🎯 노드 #${inspectedNodeId} 중심으로 카메라 포커스 이동`;
  });

  document.getElementById('btn-node-pin')?.addEventListener('click', () => {
    if (inspectedNodeId === null) return;
    const cur = rustAdapter.sdk.getNodeDetails(inspectedNodeId);
    if (!cur) return;
    const nextPinned = !cur.pinned;
    rustAdapter.sdk.pinNode(inspectedNodeId, nextPinned);
    renderNodeInspector(rustAdapter.sdk.getNodeDetails(inspectedNodeId));
    statusBadge.textContent = `📌 노드 #${inspectedNodeId} 위치 고정 ${nextPinned ? '활성화' : '해제'}`;
  });

  document.getElementById('btn-node-hop2')?.addEventListener('click', () => {
    if (inspectedNodeId === null || !controller) return;
    const selected = rustAdapter.sdk.highlightNeighbors(inspectedNodeId, 2);
    threeAdapter.highlightNeighbors(inspectedNodeId, 2);
    controller.renderStaticPreview();
    statusBadge.textContent = `🕸️ 노드 #${inspectedNodeId} 기준 2-Hop 서브그래프 (${selected.length}개 노드) 하이라이트`;
  });

  document.getElementById('btn-node-path')?.addEventListener('click', () => {
    if (inspectedNodeId === null) return;
    runShortestPathDemo(inspectedNodeId);
  });

  // Mouse Orbit & Wheel Zoom
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const attachPointerControls = (canvas: HTMLCanvasElement): void => {
    canvas.addEventListener('pointerdown', (e) => {
      if (showcase.isActive() && canvas === rustCanvas) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || !controller) return;
      if (showcase.isActive() && canvas === rustCanvas) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      controller.rotateCameras(-dx * 0.006, dy * 0.006);
      if (currentTask.kind === 'idle') {
        controller.renderStaticPreview();
      }
    });

    canvas.addEventListener('pointerup', () => {
      dragging = false;
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (showcase.isActive() && canvas === rustCanvas) return;
        e.preventDefault();
        if (!controller) return;
        controller.zoomCameras(e.deltaY * 0.18);
        if (currentTask.kind === 'idle') {
          controller.renderStaticPreview();
        }
      },
      { passive: false }
    );
  };

  attachPointerControls(rustCanvas);
  attachPointerControls(threeCanvas);

  function updateTelemetryUI(): void {
    if (!controller) return;
    const report = controller.getReport();
    const r = report.rust;
    const t = report.three;

    rustSamplesEl.textContent = `${r.sampleCount} samples`;
    if (r.sampleCount > 0) {
      rustFpsEl.textContent = `${Math.min(9999, Math.round(r.avgFps))} FPS`;
      rustLowFpsEl.textContent = `${Math.min(9999, Math.round(r.onePercentLowFps))} FPS`;
      rustPhysicsEl.textContent = `${r.avgPhysicsTimeMs.toFixed(2)} ms`;
      rustRenderEl.textContent = `${r.avgRenderTimeMs.toFixed(2)} ms`;
      rustTotalEl.textContent = `${r.avgFrameTimeMs.toFixed(2)} ms`;
    } else {
      rustFpsEl.textContent = '--';
      rustLowFpsEl.textContent = '--';
      rustPhysicsEl.textContent = '-- ms';
      rustRenderEl.textContent = '-- ms';
      rustTotalEl.textContent = '-- ms';
    }

    threeSamplesEl.textContent = `${t.sampleCount} samples`;
    if (t.sampleCount > 0) {
      threeFpsEl.textContent = `${Math.min(9999, Math.round(t.avgFps))} FPS`;
      threeLowFpsEl.textContent = `${Math.min(9999, Math.round(t.onePercentLowFps))} FPS`;
      threePhysicsEl.textContent = `${t.avgPhysicsTimeMs.toFixed(2)} ms`;
      threeRenderEl.textContent = `${t.avgRenderTimeMs.toFixed(2)} ms`;
      threeTotalEl.textContent = `${t.avgFrameTimeMs.toFixed(2)} ms`;
    } else {
      threeFpsEl.textContent = '--';
      threeLowFpsEl.textContent = '--';
      threePhysicsEl.textContent = '-- ms';
      threeRenderEl.textContent = '-- ms';
      threeTotalEl.textContent = '-- ms';
    }

    if (r.sampleCount > 0 && t.sampleCount > 0) {
      physicsSpeedupEl.textContent = `Charturbo가 ${report.physicsSpeedup.toFixed(2)}배 빠름 (${t.avgPhysicsTimeMs.toFixed(2)}ms vs ${r.avgPhysicsTimeMs.toFixed(2)}ms)`;
      totalSpeedupEl.textContent = `Charturbo가 ${report.totalSpeedup.toFixed(2)}배 빠름 (${t.avgFrameTimeMs.toFixed(2)}ms vs ${r.avgFrameTimeMs.toFixed(2)}ms)`;
    } else {
      physicsSpeedupEl.textContent = '두 엔진을 각각 측정하면 배속이 표시됩니다';
      totalSpeedupEl.textContent = '측정 전';
    }

    if (report.lastFeatureComparison) {
      const fc = report.lastFeatureComparison;
      sdkFeatureSpeedupEl.textContent = `${fc.operation}: Charturbo ${fc.rustMs.toFixed(2)}ms vs Three.js ${fc.threeMs.toFixed(2)}ms (${fc.speedup.toFixed(2)}배 빠름)`;
    }
  }
}

function syncCanvasPixelSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

bootstrap().catch((err) => {
  console.error('Failed to initialize benchmark:', err);
  const statusBadge = document.getElementById('status-badge');
  if (statusBadge) {
    statusBadge.textContent = `초기화 오류: ${err instanceof Error ? err.message : String(err)}`;
    statusBadge.style.color = '#f87171';
  }
});
