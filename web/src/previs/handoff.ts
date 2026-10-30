import type { PrevisDoc, Rgb } from './types';

type Lab = [number, number, number];

function lin(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toLab(c: Rgb): Lab {
  const r = lin(c[0]);
  const g = lin(c[1]);
  const b = lin(c[2]);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const labDist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

/** Saturated, mutually distinct candidates (order is the deterministic tie-break). */
const CANDIDATES: Rgb[] = [
  '#8000ff', // purple
  '#ffe000', // yellow
  '#00b3a4', // teal
  '#ff7a00', // orange
  '#ff00aa', // magenta
  '#80ff00', // lime
  '#ff0000', // red
  '#0040ff', // blue
  '#00ffff', // cyan
  '#00c030', // green
  '#a0522d', // brown
  '#ffffff', // white
  '#000000', // black
].map(hex);

/** Pick `count` role colors maximizing the minimum Lab distance to `avoid` and to each other. Deterministic. */
export function suggestRoleColors(count: number, avoid: Rgb[] = []): Rgb[] {
  const picked: Rgb[] = [];
  const taken = new Set<number>();
  const fixed = avoid.map(toLab);
  const labs = CANDIDATES.map(toLab);
  const n = Math.max(0, Math.floor(count));
  for (let k = 0; k < n; k++) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < CANDIDATES.length; i++) {
      if (taken.has(i)) continue;
      let score = Infinity;
      for (const f of fixed) score = Math.min(score, labDist(labs[i], f));
      for (const j of taken) score = Math.min(score, labDist(labs[i], labs[j]));
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break; // palette exhausted
    taken.add(best);
    picked.push([...CANDIDATES[best]] as Rgb);
  }
  return picked;
}

const NAME_DEFS: { ko: string; en: string; c: Rgb }[] = [
  { ko: '보라', en: 'purple', c: hex('#8000ff') },
  { ko: '노랑', en: 'yellow', c: hex('#ffe000') },
  { ko: '청록', en: 'teal', c: hex('#00b3a4') },
  { ko: '주황', en: 'orange', c: hex('#ff7a00') },
  { ko: '자홍', en: 'magenta', c: hex('#ff00aa') },
  { ko: '연두', en: 'lime', c: hex('#80ff00') },
  { ko: '빨강', en: 'red', c: hex('#ff0000') },
  { ko: '파랑', en: 'blue', c: hex('#0040ff') },
  { ko: '하늘', en: 'cyan', c: hex('#00ffff') },
  { ko: '초록', en: 'green', c: hex('#00c030') },
  { ko: '갈색', en: 'brown', c: hex('#a0522d') },
  { ko: '분홍', en: 'pink', c: hex('#ff99cc') },
  { ko: '흰', en: 'white', c: hex('#ffffff') },
  { ko: '회', en: 'gray', c: hex('#808080') },
  { ko: '검정', en: 'black', c: hex('#000000') },
];
const NAMES = NAME_DEFS.map((e) => ({ ko: e.ko, en: e.en, lab: toLab(e.c) }));

export function colorName(c: Rgb, lang: 'ko' | 'en'): string {
  const lab = toLab(c);
  let best = NAMES[0];
  let bd = Infinity;
  for (const e of NAMES) {
    const d = labDist(lab, e.lab);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return lang === 'ko' ? best.ko : best.en;
}

export function buildHandoff(
  doc: PrevisDoc,
  opts: {
    references?: { name: string; role?: string; note?: string }[];
    textOnly?: string[];
    lang?: 'ko' | 'en';
  } = {},
): { uploadOrder: string[]; prompt: string } {
  const lang = opts.lang ?? 'ko';
  const ko = lang === 'ko';
  const refs = opts.references ?? [];
  const uploadOrder = ['previs video', ...refs.map((r) => r.name)];
  const lines: string[] = [];

  lines.push(ko ? '첨부 순서:' : 'Attachments in order:');
  lines.push(ko ? '- 영상1: previs (카메라·동선·타이밍만 담김)' : '- video 1: previs (carries camera, movement and timing only)');
  refs.forEach((r, i) => {
    const extra = [r.role, r.note].filter(Boolean).join(', ');
    lines.push(ko ? `- 이미지${i + 1}: ${r.name}${extra ? ` (${extra})` : ''}` : `- image ${i + 1}: ${r.name}${extra ? ` (${extra})` : ''}`);
  });

  if (doc.roles.length > 0) {
    lines.push('');
    lines.push(ko ? '색상 = 역할:' : 'Color = role:');
    for (const role of doc.roles) {
      const color = colorName(role.color, lang);
      const ri = role.reference !== undefined ? refs.findIndex((r) => r.name === role.reference) : -1;
      if (ko) {
        const tail = ri >= 0 ? ` (이미지${ri + 1}의 얼굴/착장 적용)` : '';
        lines.push(`${color}색 = ${role.label}${tail}`);
      } else {
        const tail = ri >= 0 ? ` (apply face/outfit from image ${ri + 1})` : '';
        lines.push(`${color} = ${role.label}${tail}`);
      }
    }
  }

  lines.push('');
  lines.push(
    ko
      ? '카메라와 동작은 previs를 그대로 따를 것. 외형은 참조 이미지에서만 가져오고 previs에서는 가져오지 말 것. (camera and motion: follow the previs exactly; take appearance only from reference images, not from previs)'
      : 'camera and motion: follow the previs exactly; take appearance only from reference images, not from previs',
  );

  const text = opts.textOnly ?? [];
  if (text.length > 0) {
    lines.push('');
    lines.push(ko ? '텍스트로만 지시 (previs로 전달 불가):' : 'Text-only direction (previs cannot carry these):');
    for (const t of text) lines.push(`- ${t}`);
  }

  return { uploadOrder, prompt: lines.join('\n') };
}
