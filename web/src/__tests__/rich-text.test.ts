// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { measureRichText, parseRichText, renderRichText, richTextPlain, validateRichStyles } from '../sdk/chart-rich-text';
import { collectOverlayOps, type OverlayEnv } from '../sdk/chart-export';

const rich = {
  a: { color: '#ff0000', fontSize: 16, fontWeight: 700 },
  b: { backgroundColor: '#222222', padding: [2, 4] as [number, number], borderRadius: 3, fontStyle: 'italic' as const },
  c: { align: 'right' as const, lineHeight: 30 },
};

describe('parseRichText', () => {
  it('splits styled runs, plain text and lines', () => {
    expect(parseRichText('{a|Revenue} 42{b|k}\n{c|up}', rich)).toEqual([
      [
        { text: 'Revenue', style: 'a' },
        { text: ' 42' },
        { text: 'k', style: 'b' },
      ],
      [{ text: 'up', style: 'c' }],
    ]);
  });

  it('keeps unknown styles as plain text and unclosed / unnamed braces literal', () => {
    expect(parseRichText('{zz|plain}', rich)).toEqual([[{ text: 'plain' }]]);
    expect(parseRichText('{a|open', rich)).toEqual([[{ text: '{a|open' }]]);
    expect(parseRichText('{value} x', rich)).toEqual([[{ text: '{value} x' }]]);
  });

  it('unescapes \\{ \\} \\\\ and does not nest', () => {
    expect(parseRichText('\\{a|no\\}', rich)).toEqual([[{ text: '{a|no}' }]]);
    expect(parseRichText('{a|x\\}y}', rich)).toEqual([[{ text: 'x}y', style: 'a' }]]);
    // The inner `{` is text; the first `}` closes the run
    expect(parseRichText('{a|1{b|2}3}', rich)).toEqual([[{ text: '1{b|2', style: 'a' }, { text: '3}' }]]);
    expect(parseRichText('a\\\\b', rich)).toEqual([[{ text: 'a\\b' }]]);
  });

  it('splits a run that holds a newline across lines', () => {
    expect(parseRichText('{a|x\ny}', rich)).toEqual([[{ text: 'x', style: 'a' }], [{ text: 'y', style: 'a' }]]);
  });

  it('plain text of the parse (assistive tech, CSV)', () => {
    expect(richTextPlain(parseRichText('{a|Revenue} 42{b|k}\n{c|up}', rich))).toBe('Revenue 42k\nup');
  });
});

describe('validateRichStyles', () => {
  it('accepts the documented shape and rejects bad values', () => {
    expect(() => validateRichStyles(rich)).not.toThrow();
    expect(() => validateRichStyles(undefined)).not.toThrow();
    expect(() => validateRichStyles({ a: { fontSize: -1 } })).toThrow(/fontSize/);
    expect(() => validateRichStyles({ a: { padding: [1, 2, 3] as never } })).toThrow(/padding/);
    expect(() => validateRichStyles({ a: { align: 'middle' as never } })).toThrow(/align/);
    expect(() => validateRichStyles({ a: { color: 'nope' } })).toThrow(/color/);
    expect(() => validateRichStyles('x' as never)).toThrow(/rich/);
  });
});

describe('renderRichText', () => {
  it('builds styled spans with textContent only (no HTML parsing)', () => {
    const el = document.createElement('div');
    renderRichText(el, parseRichText('{a|<b>x</b>} <img src=x onerror=1>\n{c|r}', rich), rich);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    const lines = el.querySelectorAll<HTMLElement>(':scope > .charturbo-sdk-rich-line');
    expect(lines.length).toBe(2);
    const a = lines[0].children[0] as HTMLElement;
    expect(a.textContent).toBe('<b>x</b>');
    expect(a.style.color).toBe('rgb(255, 0, 0)');
    expect(a.style.fontSize).toBe('16px');
    expect(a.style.fontWeight).toBe('700');
    expect(lines[0].children[1].textContent).toBe(' <img src=x onerror=1>');
    expect(lines[1].style.textAlign).toBe('right');
    expect((lines[1].children[0] as HTMLElement).style.lineHeight).toBe('30px');
    expect(el.textContent).toBe('<b>x</b> <img src=x onerror=1>r');
  });

  it('boxes with background / padding / radius are inline blocks', () => {
    const el = document.createElement('div');
    renderRichText(el, parseRichText('{b|k}', rich), rich);
    const b = el.querySelector<HTMLElement>('span')!;
    expect(b.style.display).toBe('inline-block');
    expect(b.style.padding).toBe('2px 4px');
    expect(b.style.borderRadius).toBe('3px');
    expect(b.style.background).toContain('34, 34, 34');
    expect(b.style.fontStyle).toBe('italic');
  });
});

describe('measureRichText', () => {
  const base = { fontSize: 10, fontWeight: '400', fontFamily: 'sans-serif', lineHeight: 14 };
  // jsdom has no canvas: ~0.6 em per character
  it('sums runs per line and stacks lines (padding, line height, font size)', () => {
    const one = measureRichText(parseRichText('abcd', rich), rich, base);
    expect(one).toEqual({ width: 24, height: 14 });
    const styled = measureRichText(parseRichText('{a|ab}{b|cd}\n{c|x}', rich), rich, base);
    // a: 2 chars at 16px = 19.2; b: 2 at 10px = 12 + 8 padding; line 1 height: max(14, 16*1.2, 10*1.2 + 4)
    expect(styled.width).toBeCloseTo(19.2 + 12 + 8, 5);
    expect(styled.height).toBeCloseTo(19.2 + 30, 5);
  });
});

describe('image / SVG export of rich labels', () => {
  it('the overlay walk paints each run box and text with its own font', () => {
    const root = document.createElement('div');
    const label = document.createElement('div');
    root.appendChild(label);
    renderRichText(label, parseRichText('{a|Big}{b|tag}', rich), rich);
    let x = 0;
    const env: OverlayEnv = {
      style: (el) => {
        const s = (el as HTMLElement).style;
        return {
          display: s.display,
          visibility: '',
          opacity: '',
          color: s.color || 'rgb(0, 0, 0)',
          backgroundColor: s.backgroundColor || 'rgba(0, 0, 0, 0)',
          borderRadius: s.borderRadius,
          fontStyle: s.fontStyle || 'normal',
          fontWeight: s.fontWeight || '400',
          fontSize: s.fontSize || '11px',
          fontFamily: 'sans-serif',
          transform: 'none',
        };
      },
      rect: () => ({ left: (x += 10), top: 0, width: 20, height: 14 }),
      textRect: (_n, el) => ({ left: el.textContent === 'Big' ? 0 : 30, top: 0, width: 20, height: 14 }),
    };
    const ops = collectOverlayOps(root, { left: 0, top: 0 }, env);
    const texts = ops.filter((o) => o.kind === 'text');
    expect(texts.map((t) => t.kind === 'text' && t.text)).toEqual(['Big', 'tag']);
    expect(texts[0].kind === 'text' && texts[0].font).toBe('normal 700 16px sans-serif');
    expect(texts[0].kind === 'text' && texts[0].color).toBe('rgb(255, 0, 0)');
    expect(texts[1].kind === 'text' && texts[1].font).toContain('italic');
    const rects = ops.filter((o) => o.kind === 'rect');
    expect(rects.length).toBe(1);
    expect(rects[0].kind === 'rect' && rects[0].radius).toBe(3);
  });
});
