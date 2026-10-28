import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCloseOnBack } from '../use-calendar-close-on-back';

const entry = () => (window.history.state as Record<string, unknown> | null)?.__closeOnBack;

async function openOverlay(options: Partial<Parameters<typeof useCloseOnBack>[0]> = {}) {
  const before = entry();
  const onBack = vi.fn();
  const view = renderHook((props: { open: boolean }) => useCloseOnBack({ onBack, ...options, open: props.open }), {
    initialProps: { open: true },
  });
  await waitFor(() => expect(entry()).toBeTruthy());
  await waitFor(() => expect(entry()).not.toBe(before));
  return { ...view, onBack };
}

describe('useCloseOnBack (R5)', () => {
  it('calls onBack when Back leaves the overlay entry', async () => {
    const { onBack, unmount } = await openOverlay();
    window.history.back();
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(entry()).toBeUndefined();
    unmount();
  });

  it('puts the entry back while the overlay holds', async () => {
    const { onBack, unmount } = await openOverlay({ shouldHold: () => true });
    window.history.back();
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(entry()).toBeTruthy();
    unmount();
    await waitFor(() => expect(entry()).toBeUndefined());
  });

  it('removes its entry when the overlay closes another way, keeping the latest URL', async () => {
    const { rerender } = await openOverlay();
    // The page rewrites the URL while the overlay is open
    window.history.replaceState(window.history.state, '', '/calendar/week/2026-09-14');
    rerender({ open: false });
    await waitFor(() => expect(entry()).toBeUndefined());
    await waitFor(() => expect(window.location.pathname).toBe('/calendar/week/2026-09-14'));
  });

  it('does not undo a navigation that pushed its own entry', async () => {
    const { unmount } = await openOverlay();
    // The router pushes in the same commit that unmounts the overlay
    unmount();
    window.history.pushState({ other: true }, '', '/mail');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.history.state).toEqual({ other: true });
    expect(window.location.pathname).toBe('/mail');
  });
});
