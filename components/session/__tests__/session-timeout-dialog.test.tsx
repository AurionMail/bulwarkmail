import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionTimeoutDialog } from '../session-timeout-dialog';

const noop = () => {};

describe('session timeout dialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sits at the end of the body above plugin dialogs and the office editor', () => {
    const { container } = render(
      <div style={{ position: 'relative', zIndex: 1 }}>
        <SessionTimeoutDialog mode="idle" deadline={Date.now() + 30_000} onStay={noop} onDismiss={noop} onSignOut={noop} />
      </div>,
    );
    const overlay = screen.getByTestId('session-timeout-dialog');
    expect(container.contains(overlay)).toBe(false);
    expect(overlay.parentElement).toBe(document.body);
    const z = Number(/z-\[(\d+)\]/.exec(overlay.className)?.[1]);
    expect(z).toBeGreaterThan(100000);
  });

  it('does not read out every second, only the 30 and 10 second marks', () => {
    render(<SessionTimeoutDialog mode="idle" deadline={Date.now() + 35_000} onStay={noop} onDismiss={noop} onSignOut={noop} />);
    const message = screen.getByText('idle_message');
    expect(message.closest('[aria-live]')).toBeNull();
    const live = document.querySelector('[aria-live]')!;
    expect(live.textContent).toBe('');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(live.textContent).toBe('seconds_left');
  });

  it('points aria-describedby only at a message that is there', () => {
    const { rerender } = render(<SessionTimeoutDialog mode="idle" deadline={Date.now() + 30_000} onStay={noop} onDismiss={noop} onSignOut={noop} />);
    const dialog = screen.getByRole('alertdialog');
    const described = dialog.getAttribute('aria-describedby');
    expect(described && document.getElementById(described)).toBeTruthy();

    rerender(<SessionTimeoutDialog mode="ending" deadline={null} onStay={noop} onDismiss={noop} onSignOut={noop} />);
    expect(screen.getByRole('alertdialog').hasAttribute('aria-describedby')).toBe(false);
  });
});
