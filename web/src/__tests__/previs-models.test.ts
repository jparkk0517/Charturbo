import { describe, expect, it } from 'vitest';
import { modelSrcsToLoad } from '../previs/models';
import type { PrevisDoc } from '../previs/types';

const doc = (nodes: unknown[]): PrevisDoc => ({ nodes }) as unknown as PrevisDoc;
const model = (id: string, extra: object = {}) => ({ id, shape: 'model', model: { src: `${id}.glb` }, ...extra });

describe('modelSrcsToLoad', () => {
  it('visible model is loaded', () => {
    expect(modelSrcsToLoad(doc([model('a')]))).toEqual(['a.glb']);
  });
  it('pure pivot without sockets is not loaded', () => {
    expect(modelSrcsToLoad(doc([model('a', { visible: false }), { id: 'c', shape: 'box', parent: 'a' }]))).toEqual([]);
  });
  it('hidden with a parentJoint child is loaded', () => {
    expect(modelSrcsToLoad(doc([model('a', { visible: false }), { id: 'c', shape: 'box', parent: 'a', parentJoint: 'hand' }]))).toEqual(['a.glb']);
  });
  it('hidden with a visible key true later is loaded', () => {
    expect(modelSrcsToLoad(doc([model('a', { visible: false, tracks: { visible: [{ t: 0, v: false }, { t: 1, v: true }] } })]))).toEqual(['a.glb']);
  });
  it('a hidden model source loads when its retarget target loads (and not when the target never shows)', () => {
    const src = model('w', { visible: false });
    const tgt = (extra: object = {}) => ({ id: 's', shape: 'model', model: { src: 's.glb', retarget: { source: 'w', map: 'ue', sourceMap: 'walker' } }, ...extra });
    expect(modelSrcsToLoad(doc([src, tgt()]))).toEqual(['w.glb', 's.glb']);
    expect(modelSrcsToLoad(doc([src, tgt({ visible: false })]))).toEqual([]);
  });
  it('parentJoint child of a non-model parent does not load anything', () => {
    expect(modelSrcsToLoad(doc([{ id: 'p', shape: 'box', visible: false }, { id: 'c', shape: 'box', parent: 'p', parentJoint: 'j' }]))).toEqual([]);
  });
});
