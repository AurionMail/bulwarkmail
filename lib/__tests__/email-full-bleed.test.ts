import { describe, expect, it } from 'vitest';
import { hasFullBleedCanvas } from '@/lib/email-full-bleed';

describe('hasFullBleedCanvas', () => {
  it('recognises a 100% wide element with a background, in either attribute order', () => {
    expect(hasFullBleedCanvas('<table width="100%" bgcolor="#f4f4f4"><tr><td>x</td></tr></table>')).toBe(true);
    expect(hasFullBleedCanvas('<div style="background-color:#eee;width:100%">x</div>')).toBe(true);
    expect(hasFullBleedCanvas('<body style="width: 100%; background: #fff">')).toBe(true);
  });

  it('does not take width and background from two different elements', () => {
    expect(hasFullBleedCanvas('<table width="100%"><tr><td bgcolor="#fff">x</td></tr></table>')).toBe(false);
    expect(hasFullBleedCanvas('<div style="width:100%"></div><div style="background:#fff"></div>')).toBe(false);
    expect(hasFullBleedCanvas('<p style="width:100%;background:#fff">not a canvas element</p>')).toBe(false);
  });

  it('answers a megabyte style attribute in milliseconds', () => {
    const html = `<div style="${'width:100%;'.repeat(100_000)}">x</div>`;
    const started = performance.now();
    expect(hasFullBleedCanvas(html)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
    const html2 = `<table style="${'background:red;'.repeat(70_000)}">x</table>`;
    const started2 = performance.now();
    expect(hasFullBleedCanvas(html2)).toBe(false);
    expect(performance.now() - started2).toBeLessThan(100);
  });
});
