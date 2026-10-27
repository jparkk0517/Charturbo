// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../examples');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');

describe('public landing before JavaScript or GPU initialization', () => {
  it('contains a product message, description and working entry points without client rendering', () => {
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('h1')?.textContent).toMatch(/data/i);
    expect(page.querySelector('meta[name="description"]')?.getAttribute('content')?.length).toBeGreaterThan(50);
    for (const href of ['./gallery.html', './line.html', './benchmarks.html']) {
      expect(page.querySelector(`a[href="${href}"]`)).not.toBeNull();
      expect(existsSync(resolve(root, href))).toBe(true);
    }
  });

  it('keeps an accessible preview and controls when the renderer cannot load', () => {
    expect(page.querySelector('[data-demo-poster]')?.getAttribute('role')).toBe('img');
    expect(page.querySelector('[data-demo-poster]')?.getAttribute('aria-label')).toBeTruthy();
    expect(page.querySelector('button[data-demo-motion]')?.textContent).toMatch(/pause|play/i);
    expect(page.querySelector('[data-demo-status]')?.getAttribute('role')).toBe('status');
    expect(page.querySelector('a[href="#main"]')).not.toBeNull();
    expect(page.querySelector('#main')).not.toBeNull();
  });
});
