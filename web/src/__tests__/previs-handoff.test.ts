import { describe, expect, it } from 'vitest';
import { buildHandoff, colorName, suggestRoleColors } from '../previs/handoff';
import type { PrevisDoc, Rgb } from '../previs/types';

function dist(a: Rgb, b: Rgb): number {
  // coarse rgb distance is enough to check distinctness here
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const doc: PrevisDoc = {
  version: 1,
  fps: 30,
  size: { width: 1280, height: 720 },
  background: [0.5, 0.5, 0.5],
  roles: [
    { id: 'hero', label: '주인공 여자', color: [0.5, 0, 1], reference: 'face.png' },
    { id: 'foe', label: 'defender', color: [1, 0.88, 0] },
  ],
  nodes: [],
  shots: [],
};

describe('suggestRoleColors', () => {
  it('returns requested count, distinct, deterministic', () => {
    const a = suggestRoleColors(5);
    const b = suggestRoleColors(5);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(dist(a[i], a[j])).toBeGreaterThan(0.3);
  });

  it('avoids given colors', () => {
    const purple: Rgb = [0.5, 0, 1];
    const withAvoid = suggestRoleColors(3, [purple]);
    for (const c of withAvoid) expect(dist(c, purple)).toBeGreaterThan(0.3);
    expect(suggestRoleColors(3)).not.toEqual(withAvoid);
  });

  it('count 0 and over-large count', () => {
    expect(suggestRoleColors(0)).toEqual([]);
    expect(suggestRoleColors(100).length).toBeLessThanOrEqual(100);
  });
});

describe('colorName', () => {
  it('names in both languages', () => {
    expect(colorName([0.5, 0, 1], 'ko')).toBe('보라');
    expect(colorName([0.5, 0, 1], 'en')).toBe('purple');
    expect(colorName([1, 0.9, 0.05], 'en')).toBe('yellow');
    expect(colorName([1, 0.5, 0], 'ko')).toBe('주황');
  });
});

describe('buildHandoff', () => {
  const refs = [{ name: 'body.png' }, { name: 'face.png', role: 'face sheet', note: 'front' }];

  it('ko with references', () => {
    const r = buildHandoff(doc, { references: refs, textOnly: ['손동작: 천천히 흔든다'] });
    expect(r.uploadOrder).toEqual(['previs video', 'body.png', 'face.png']);
    expect(r.prompt).toContain('보라색 = 주인공 여자 (이미지2의 얼굴/착장 적용)');
    expect(r.prompt).toContain('camera and motion: follow the previs exactly; take appearance only from reference images, not from previs');
    expect(r.prompt).toContain('- 손동작: 천천히 흔든다');
    expect(r.prompt).toContain('이미지1: body.png');
  });

  it('en with references', () => {
    const r = buildHandoff(doc, { references: refs, lang: 'en', textOnly: ['hand motion: wave'] });
    expect(r.prompt).toContain('purple = 주인공 여자 (apply face/outfit from image 2)');
    expect(r.prompt).toContain('image 1: body.png');
    expect(r.prompt).toContain('- hand motion: wave');
    expect(r.prompt).not.toContain('이미지');
  });

  it('roles without references and no options', () => {
    const r = buildHandoff(doc);
    expect(r.uploadOrder).toEqual(['previs video']);
    expect(r.prompt).toContain('노랑색 = defender');
    expect(r.prompt).not.toContain('적용');
    expect(r.prompt).not.toContain('텍스트로만');
  });

  it('no roles', () => {
    const r = buildHandoff({ ...doc, roles: [] }, { lang: 'en' });
    expect(r.prompt).not.toContain('Color = role');
    expect(r.prompt).toContain('follow the previs exactly');
  });
});

describe('buildHandoff shot list and markers', () => {
  const cam = { position: [{ t: 0, v: [0, 0, 5] }], target: { track: [{ t: 0, v: [0, 0, 0] }] } } as never;
  const multi: PrevisDoc = {
    ...doc,
    shots: [
      { id: 's1', start: 0, end: 1.5, note: 'wide, slow push-in', camera: cam },
      { id: 's2', start: 1.5, end: 4, camera: cam },
    ],
    markers: [
      { t: 3.8, label: 'bottle hits the wall' },
      { t: 1.5, label: 'cut on the door slam' },
    ],
  };

  it('en: shot lines, notes, sorted markers, intentional-cut sentence', () => {
    const p = buildHandoff(multi, { lang: 'en' }).prompt;
    expect(p).toContain('the cuts are intentional; keep them exactly at these times');
    expect(p).toContain('- s1: 0.00 s–1.50 s (frames 0–44) — wide, slow push-in');
    expect(p).toContain('- s2: 1.50 s–4.00 s (frames 45–119)\n');
    expect(p.indexOf('1.50 s (frame 45): cut on the door slam')).toBeLessThan(p.indexOf('3.80 s (frame 114): bottle hits the wall'));
    expect(p.indexOf('Color = role')).toBeLessThan(p.indexOf('Shot list'));
  });

  it('ko', () => {
    const p = buildHandoff(multi, { lang: 'ko' }).prompt;
    expect(p).toContain('컷은 의도된 것');
    expect(p).toContain('- s1: 0.00 s–1.50 s (프레임 0–44) — wide, slow push-in');
    expect(p).toContain('시간별 사건:');
    expect(p).toContain('- 3.80 s (프레임 114): bottle hits the wall');
  });

  it('24 fps: exact seconds with 2 decimals and frame ranges at 35/24 boundaries', () => {
    const d24: PrevisDoc = {
      ...multi,
      fps: 24,
      shots: [
        { id: 's1-establish', start: 0, end: 35 / 24, camera: cam },
        { id: 's2', start: 35 / 24, end: 70.1 / 24, camera: cam },
        { id: 'blip', start: 70.1 / 24, end: 70.5 / 24, camera: cam },
        { id: 's4', start: 70.5 / 24, end: 4, camera: cam },
      ],
      markers: [{ t: 91 / 24, label: 'hit' }],
    };
    const en = buildHandoff(d24, { lang: 'en' }).prompt;
    expect(en).toContain('- s1-establish: 0.00 s–1.46 s (frames 0–34)\n');
    expect(en).toContain('- s2: 1.46 s–2.92 s (frames 35–70)\n');
    expect(en).toContain('- blip: 2.92 s–2.94 s (no frames)\n');
    expect(en).toContain('- 3.79 s (frame 91): hit');
    const ko = buildHandoff(d24, { lang: 'ko' }).prompt;
    expect(ko).toContain('- s1-establish: 0.00 s–1.46 s (프레임 0–34)');
    expect(ko).toContain('- blip: 2.92 s–2.94 s (프레임 없음)');
  });

  it('omits both sections for a single shot without markers', () => {
    const one = { ...multi, shots: [multi.shots[0]], markers: undefined };
    for (const lang of ['ko', 'en'] as const) {
      const p = buildHandoff(one, { lang }).prompt;
      expect(p).not.toContain('intentional');
      expect(p).not.toContain('의도된');
      expect(p).not.toContain('0.00 s');
    }
  });

  it('single shot with markers keeps only events', () => {
    const p = buildHandoff({ ...multi, shots: [multi.shots[0]] }, { lang: 'en' }).prompt;
    expect(p).toContain('Timed events:');
    expect(p).not.toContain('Shot list');
  });
});
