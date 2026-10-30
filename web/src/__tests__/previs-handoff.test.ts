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
