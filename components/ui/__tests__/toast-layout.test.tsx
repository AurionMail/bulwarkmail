import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContainer } from '../toast';
import { toast, useToastStore } from '@/stores/toast-store';
import { useBottomControls } from '@/hooks/use-bottom-controls';

function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  return <ToastContainer toasts={toasts} onClose={removeToast} />;
}

const card = (title: string) => screen.getByText(title).closest('.toast-item') as HTMLElement;

describe('toast layout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stacks the newest toast at the bottom, at the end corner', () => {
    render(<Toasts />);
    act(() => { toast.info('First'); });
    act(() => { toast.info('Second'); });
    const container = screen.getByRole('status');
    expect(container).toHaveClass('flex-col', 'end-5', 'max-sm:inset-x-3');
    expect(container).not.toHaveClass('flex-col-reverse');
    expect(container.className).not.toMatch(/\bright-5\b/);
    const titles = Array.from(container.querySelectorAll('.toast-item p:first-child')).map((p) => p.textContent);
    expect(titles).toEqual(['First', 'Second']);
  });

  it('sits above the bottom controls on a phone, and over an open composer', () => {
    render(<Toasts />);
    const container = screen.getByRole('status');
    expect(container.className).toContain('max-sm:bottom-[calc(var(--bottom-controls-height,3.75rem)+0.75rem)]');
    expect(container).toHaveClass('[html[data-composer-open]_&]:bottom-20');
  });

  it('names the close button and hides it on a phone', () => {
    render(<Toasts />);
    act(() => { toast.success('Saved'); });
    const close = screen.getByRole('button', { name: 'close' });
    expect(close).toHaveClass('max-sm:hidden');
  });

  it('is dismissed by a sideways swipe on a touch screen', () => {
    const onDismiss = vi.fn();
    render(<Toasts />);
    act(() => { useToastStore.getState().addToast({ type: 'info', title: 'Moved', onDismiss }); });
    const el = card('Moved');
    fireEvent.pointerDown(el, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(el, { pointerType: 'touch', pointerId: 1, clientX: 140, clientY: 12 });
    fireEvent.pointerMove(el, { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 12 });
    expect(el.style.transform).toBe('translateX(100px)');
    fireEvent.pointerUp(el, { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 12 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByText('Moved')).toBeNull();
  });

  it('snaps back after a short swipe, and ignores mouse drags and vertical moves', () => {
    render(<Toasts />);
    act(() => { toast.info('Stays'); });
    const el = card('Stays');
    fireEvent.pointerDown(el, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(el, { pointerType: 'touch', pointerId: 1, clientX: 130, clientY: 10 });
    fireEvent.pointerUp(el, { pointerType: 'touch', pointerId: 1, clientX: 130, clientY: 10 });
    expect(el.style.transform).toBe('');

    fireEvent.pointerDown(el, { pointerType: 'mouse', pointerId: 2, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(el, { pointerType: 'mouse', pointerId: 2, clientX: 300, clientY: 10 });
    fireEvent.pointerUp(el, { pointerType: 'mouse', pointerId: 2, clientX: 300, clientY: 10 });

    fireEvent.pointerDown(el, { pointerType: 'touch', pointerId: 3, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(el, { pointerType: 'touch', pointerId: 3, clientX: 110, clientY: 200 });
    fireEvent.pointerUp(el, { pointerType: 'touch', pointerId: 3, clientX: 190, clientY: 200 });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('Stays')).toBeInTheDocument();
  });
});

describe('useBottomControls', () => {
  afterEach(() => vi.restoreAllMocks());

  function Bar({ active = true }: { active?: boolean }) {
    const ref = useBottomControls(active);
    return <nav ref={ref}>tabs</nav>;
  }

  it('publishes how far the bar reaches from the bottom while it is mounted', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ left: 0, top: window.innerHeight - 64, width: 390, height: 64, right: 390, bottom: window.innerHeight, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    const { unmount } = render(<Bar />);
    expect(document.documentElement.style.getPropertyValue('--bottom-controls-height')).toBe('64px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--bottom-controls-height')).toBe('');
  });
});
