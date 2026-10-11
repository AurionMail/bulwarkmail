import { describe, it, expect } from 'vitest';
import {
  applyEmailDarkMode,
  contrastRatio,
  darkenBackground,
  DARK_PENDING_CLASS,
  emailColorScheme,
  ensureContrast,
  parseComputedColor,
  resolveColorSchemeMedia,
  type Rgba,
} from '../email-dark-mode';
import { sanitizeEmailBodyForIframe } from '../email-sanitization';

const c = (value: string): Rgba => parseComputedColor(value)!;
const lightness = ({ r, g, b }: Rgba) => (r + g + b) / 3;

describe('darkenBackground', () => {
  it('turns white into a dark canvas', () => {
    expect(lightness(darkenBackground(c('rgb(255, 255, 255)')))).toBeLessThan(40);
  });

  it('keeps a light grey canvas lighter than a white card on it', () => {
    const card = darkenBackground(c('rgb(255, 255, 255)'));
    const canvas = darkenBackground(c('rgb(244, 244, 244)'));
    expect(lightness(canvas)).toBeGreaterThan(lightness(card));
  });

  it('keeps the hue of a light tint', () => {
    const out = darkenBackground(c('rgb(214, 233, 248)'));
    expect(lightness(out)).toBeLessThan(80);
    expect(out.b).toBeGreaterThan(out.r);
  });

  it('leaves vivid brand colours and dark fills as sent', () => {
    const red = c('rgb(227, 6, 19)');
    const green = c('rgb(115, 215, 0)');
    const navy = c('rgb(0, 32, 91)');
    expect(darkenBackground(red)).toBe(red);
    expect(darkenBackground(green)).toBe(green);
    expect(darkenBackground(navy)).toBe(navy);
  });

  it('keeps alpha', () => {
    expect(darkenBackground(c('rgba(255, 255, 255, 0.5)')).a).toBe(0.5);
  });
});

describe('ensureContrast', () => {
  const dark = c('rgb(20, 20, 20)');

  it('keeps text that already reads', () => {
    const white = c('rgb(255, 255, 255)');
    expect(ensureContrast(white, dark, 4.5)).toBe(white);
  });

  it('lifts dark text above 4.5:1 on a dark background', () => {
    const out = ensureContrast(c('rgb(51, 51, 51)'), dark, 4.5);
    expect(contrastRatio(out, dark)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the order of text greys', () => {
    const black = ensureContrast(c('rgb(0, 0, 0)'), dark, 4.5);
    const grey = ensureContrast(c('rgb(102, 102, 102)'), dark, 4.5);
    expect(lightness(black)).toBeGreaterThan(lightness(grey));
  });

  it('keeps a red link red', () => {
    const out = ensureContrast(c('rgb(200, 0, 0)'), dark, 4.5);
    expect(out.r).toBeGreaterThan(out.g + 60);
  });
});

describe('resolveColorSchemeMedia', () => {
  const html = '<style>@media (prefers-color-scheme: dark) { .a { color: white } } @media (prefers-color-scheme:light) { .b {} }</style><p>(prefers-color-scheme: dark)</p>';

  it('turns the dark query on and the light one off in dark mode', () => {
    const out = resolveColorSchemeMedia(html, true);
    expect(out).toContain('@media (min-width: 0px) { .a');
    expect(out).toContain('@media (max-width: 0.001px) { .b');
  });

  it('turns the dark query off in light mode', () => {
    const out = resolveColorSchemeMedia(html, false);
    expect(out).toContain('@media (max-width: 0.001px) { .a');
    expect(out).toContain('@media (min-width: 0px) { .b');
  });

  it('leaves text outside <style> alone', () => {
    expect(resolveColorSchemeMedia(html, true)).toContain('<p>(prefers-color-scheme: dark)</p>');
  });
});

describe('emailColorScheme', () => {
  it('is dark only for a mail with its own dark styles shown dark', () => {
    expect(emailColorScheme(true, true)).toBe('dark');
    expect(emailColorScheme(true, false)).toBe('light');
    expect(emailColorScheme(false, true)).toBe('light');
  });
});

describe('applyEmailDarkMode', () => {
  const render = (body: string) => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.documentElement.className = DARK_PENDING_CLASS;
    doc.documentElement.style.backgroundColor = 'rgb(20, 20, 20)';
    doc.body.innerHTML = body;
    applyEmailDarkMode(doc);
    return doc;
  };

  // jsdom doesn't map presentational attributes (bgcolor) into computed
  // style, so these use inline styles; browsers treat both the same.
  it('darkens a white cell', () => {
    const doc = render('<table><tr><td id="a" style="background-color:#fff">y</td></tr></table>');
    const bg = c(doc.getElementById('a')!.style.getPropertyValue('background-color'));
    expect(lightness(bg)).toBeLessThan(40);
  });

  it('makes dark text on a darkened cell readable', () => {
    const doc = render('<div style="background-color:#fff"><p id="p" style="color:#222">text</p></div>');
    const color = c(doc.getElementById('p')!.style.getPropertyValue('color'));
    expect(contrastRatio(color, c('rgb(30, 30, 30)'))).toBeGreaterThan(4.5);
  });

  it('keeps a brand button and its label as sent', () => {
    const doc = render('<a id="btn" style="background-color:#e30613;color:#ffffff">Buy</a>');
    const btn = doc.getElementById('btn')!;
    expect(btn.style.getPropertyPriority('background-color')).toBe('');
    expect(btn.style.getPropertyPriority('color')).toBe('');
  });

  it('leaves text on a background image as sent', () => {
    const doc = render('<div style="background-image:url(data:image/png;base64,AAAA);background-color:#ffffff"><p id="p" style="color:#111">On the photo</p></div>');
    expect(doc.getElementById('p')!.style.getPropertyPriority('color')).toBe('');
  });

  it('converts a cell whose remote background the blocker stripped', () => {
    const { html } = sanitizeEmailBodyForIframe(
      '<table><tr><td id="hero" background="https://example.com/hero.jpg" style="background-color:#ffffff;background-image:url(https://example.com/hero.jpg)"><p id="p" style="color:#111">Headline</p></td></tr></table>',
      true,
    );
    const doc = render(html);
    expect(lightness(c(doc.getElementById('hero')!.style.getPropertyValue('background-color')))).toBeLessThan(40);
    expect(doc.getElementById('p')!.style.getPropertyPriority('color')).toBe('important');
  });

  it('un-hides the body', () => {
    const doc = render('<p>hi</p>');
    expect(doc.documentElement.classList.contains(DARK_PENDING_CLASS)).toBe(false);
  });
});
