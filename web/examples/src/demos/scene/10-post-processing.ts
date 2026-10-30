import { Charturbo, type Vec3Tuple } from 'charturbo';

export const meta = {
  title: 'Post-processing · setPostProcessing',
  description:
    'Bloom and auto exposure on the PBR scene. Glowing lamps (emissive colors far above white) pulse over a dark floor, and bloom spreads their light into a soft halo (13-tap downsample chain, tent upsample). Flip the room light: with auto exposure on, the view first blows out (or goes dark) and then adapts like an eye, faster when it brightens (speed up) than when it darkens (speed down). Adjust bloom intensity, threshold and radius and the exposure compensation, or switch to instant adaptation.',
  height: 440,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });
  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);

  sdk.addPlane({ position: [0, -1, 0], scale: [220, 2, 140], color: [0.35, 0.36, 0.4, 1], roughness: 0.8 });
  const glow: Vec3Tuple[] = [
    [8, 2.4, 0.5],
    [0.6, 3, 9],
    [1.2, 7, 1.4],
    [7, 1, 5],
  ];
  const lamps = glow.map((emissiveColor, i) => ({
    color: emissiveColor,
    id: sdk.addSphere({
      position: [-45 + i * 30, 8, 12],
      scale: [10, 10, 10],
      color: [0.08, 0.08, 0.08, 1],
      roughness: 0.6,
      emissiveColor,
      castShadow: false,
    }),
  }));
  [0.05, 0.25, 0.5].forEach((r, i) =>
    sdk.addSphere({ position: [-30 + i * 30, 26, -16], scale: [16, 16, 16], color: [0.95, 0.85, 0.7, 1], metallic: 1, roughness: r })
  );
  sdk.addBox({ position: [52, 10, -14], rotation: [0, 0.5, 0], scale: [14, 20, 14], color: [0.3, 0.45, 0.8, 1], roughness: 0.9 });
  sdk.addSphere({ position: [-56, 9, -12], scale: [16, 16, 16], color: [1, 1, 1, 0.45], roughness: 0.4 });

  const dim = { ambientIntensity: 0.05, directionalIntensity: 0.15, pointIntensity: 0 };
  const bright = { ambientIntensity: 1.6, directionalIntensity: 8, pointIntensity: 0 };
  let lightsOn = false;
  sdk.setLighting(dim);
  sdk.setShading({ model: 'pbr', toneMapping: 'aces', exposure: 1 });
  sdk.setPostProcessing({
    bloom: { enabled: true, intensity: 0.8, threshold: 1, knee: 0.5, radius: 0.7 },
    autoExposure: { enabled: true, minEv: -4, maxEv: 4, speedUp: 3, speedDown: 1, compensation: 0 },
  });
  sdk.setCameraPose([0, 34, 110], [0, 12, 0]);

  const button = (sync: (b: HTMLButtonElement) => void, click: () => void) => {
    const b = toolbar.appendChild(document.createElement('button'));
    b.onclick = () => {
      click();
      sync(b);
    };
    sync(b);
  };
  const toggleText = (b: HTMLButtonElement, name: string, on: boolean) => {
    b.textContent = `${name} ${on ? 'on' : 'off'}`;
    b.setAttribute('aria-pressed', String(on));
  };
  button(
    (b) => toggleText(b, 'bloom', sdk.getPostProcessing().bloom.enabled),
    () => sdk.setPostProcessing({ bloom: { enabled: !sdk.getPostProcessing().bloom.enabled } })
  );
  button(
    (b) => toggleText(b, 'auto exposure', sdk.getPostProcessing().autoExposure.enabled),
    () => sdk.setPostProcessing({ autoExposure: { enabled: !sdk.getPostProcessing().autoExposure.enabled } })
  );
  button(
    (b) => toggleText(b, 'room light', lightsOn),
    () => {
      lightsOn = !lightsOn;
      sdk.setLighting(lightsOn ? bright : dim);
    }
  );
  button(
    (b) => toggleText(b, 'instant', sdk.getPostProcessing().autoExposure.adaptation === 'instant'),
    () => {
      const instant = sdk.getPostProcessing().autoExposure.adaptation === 'instant';
      sdk.setPostProcessing({ autoExposure: { adaptation: instant ? 'smooth' : 'instant' } });
    }
  );

  const slider = (label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) => {
    const wrap = toolbar.appendChild(document.createElement('label'));
    wrap.textContent = `${label} `;
    const input = wrap.appendChild(document.createElement('input'));
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.oninput = () => set(Number(input.value));
  };
  slider('intensity', 0, 3, 0.05, 0.8, (intensity) => sdk.setPostProcessing({ bloom: { intensity } }));
  slider('threshold', 0, 4, 0.05, 1, (threshold) => sdk.setPostProcessing({ bloom: { threshold } }));
  slider('radius', 0, 1, 0.05, 0.7, (radius) => sdk.setPostProcessing({ bloom: { radius } }));
  slider('compensation', -3, 3, 0.1, 0, (compensation) => sdk.setPostProcessing({ autoExposure: { compensation } }));

  const state = sdk.getPostProcessing();
  if (!state.supported) {
    const note = toolbar.appendChild(document.createElement('span'));
    note.textContent = 'post-processing unsupported on this device (no float render targets)';
  }

  const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });
  let frame = 0;
  const started = performance.now();
  const tick = () => {
    // Lamps pulse out of phase between 40 % and 100 % of their emissive color
    const t = (performance.now() - started) / 1000;
    lamps.forEach(({ id, color }, i) => {
      const k = 0.7 + 0.3 * Math.sin(t * 1.6 + i * 1.7);
      sdk.setObjectMaterial(id, { emissiveColor: [color[0] * k, color[1] * k, color[2] * k] });
    });
    sdk.render();
    frame = requestAnimationFrame(tick);
  };
  tick();
  return {
    sdk,
    dispose: () => {
      cancelAnimationFrame(frame);
      detach();
      sdk.dispose();
    },
  };
}
