import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuItem } from '../context-menu';

// A menu that grows after it opened (a plugin frame in it reports its
// height late) must be moved up again so it stays inside the window.

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

let resize: (() => void) | null = null;
class ManualResizeObserver {
  constructor(cb: () => void) { resize = cb; }
  observe() {}
  unobserve() {}
  disconnect() { resize = null; }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resize = null;
});

describe('ContextMenu fit', () => {
  it('moves up when its content grows past the bottom of the window', () => {
    vi.stubGlobal('ResizeObserver', ManualResizeObserver);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    let height = 200;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? rect(0, 0, 220, height) : rect(0, 0, 0, 0);
    });

    render(
      <ContextMenu isOpen position={{ x: 400, y: 500 }} onClose={() => {}}>
        <ContextMenuItem label="Reply" onClick={() => {}} />
      </ContextMenu>,
    );
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('500px');

    height = 624;
    act(() => resize?.());
    expect(menu.style.top).toBe(`${800 - 624 - 10}px`);
  });

  it('scrolls inside instead of running off a short window', () => {
    render(
      <ContextMenu isOpen position={{ x: 10, y: 10 }} onClose={() => {}}>
        <ContextMenuItem label="Reply" onClick={() => {}} />
      </ContextMenu>,
    );
    const inner = screen.getByRole('menu').firstElementChild as HTMLElement;
    expect(inner.className).toContain('overflow-y-auto');
    expect(inner.style.maxHeight).toMatch(/100vh/);
  });
});
