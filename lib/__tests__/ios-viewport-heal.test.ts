import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIosViewportHeal } from '../ios-viewport-heal';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function setStandalone(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'standalone', { configurable: true, value });
}

/** Records every display value the body is given. Hiding the body resets
 * scroll offsets, as a real browser does when it drops the layout boxes. */
function watchBodyDisplay(): string[] {
  const seen: string[] = [];
  const style = document.body.style;
  let current = style.display;
  Object.defineProperty(style, 'display', {
    configurable: true,
    get: () => current,
    set: (v: string) => {
      current = v;
      seen.push(v);
      if (v === 'none') document.body.querySelectorAll('*').forEach((el) => { el.scrollTop = 0; });
    },
  });
  return seen;
}

function resume() {
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(200);
}

describe('startIosViewportHeal', () => {
  let stop: () => void = () => {};
  let displays: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    setViewport(390, 844);
    setStandalone(true);
    displays = watchBodyDisplay();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    setStandalone(undefined);
    delete (document.body.style as unknown as Record<string, unknown>).display;
    document.body.innerHTML = '';
  });

  it('re-lays out the body when the app resumes with a shrunken viewport', () => {
    stop = startIosViewportHeal();
    setViewport(390, 786);
    resume();
    expect(displays).toEqual(['none', '']);
  });

  it('keeps scroll offsets across the re-layout', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    list.scrollTop = 420;
    stop = startIosViewportHeal();
    setViewport(390, 786);
    resume();
    expect(displays).toEqual(['none', '']);
    expect(list.scrollTop).toBe(420);
  });

  it('leaves the page alone when the viewport is full height', () => {
    stop = startIosViewportHeal();
    resume();
    expect(displays).toEqual([]);
  });

  it('does not treat rotation as shrinking', () => {
    stop = startIosViewportHeal();
    setViewport(844, 390);
    resume();
    expect(displays).toEqual([]);
  });

  it('waits while a text field has focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    stop = startIosViewportHeal();
    setViewport(390, 786);
    resume();
    expect(displays).toEqual([]);
  });

  it('does nothing outside an iOS home-screen app', () => {
    setStandalone(undefined);
    stop = startIosViewportHeal();
    setViewport(390, 786);
    resume();
    expect(displays).toEqual([]);
  });
});
