import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useHoverPreviewGate } from '../use-hover-preview-gate';

// The hover preview opened on top of the open editor, and by itself after
// a dialog closed with the pointer resting on an event.

function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
}

describe('useHoverPreviewGate', () => {
  it('lets a preview open when nothing is open', () => {
    const { result } = renderHook(() => useHoverPreviewGate(false));
    expect(result.current()).toBe(true);
  });

  it('holds previews back while an editor is open, and after it closed until the pointer moves', () => {
    const { result, rerender } = renderHook(({ open }) => useHoverPreviewGate(open), { initialProps: { open: true } });
    move(100, 100);
    expect(result.current()).toBe(false);
    rerender({ open: false });
    expect(result.current()).toBe(false);
    move(101, 101);
    expect(result.current()).toBe(false);
    move(140, 120);
    expect(result.current()).toBe(true);
  });

  it('holds previews back while a modal dialog is on the page, and after it closed', async () => {
    const { result } = renderHook(() => useHoverPreviewGate(false));
    move(10, 10);
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    expect(result.current()).toBe(false);
    dialog.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current()).toBe(false);
    move(60, 60);
    expect(result.current()).toBe(true);
  });
});
