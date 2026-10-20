import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Flash } from '../flash-message';

describe('Flash', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing without a message', () => {
    const { container } = render(<Flash message={null} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows an error as an alert until dismissed', () => {
    const onDismiss = vi.fn();
    render(<Flash message={{ type: 'error', text: 'Save failed' }} onDismiss={onDismiss} />);
    expect(screen.getByRole('alert').textContent).toContain('Save failed');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lets a success go away by itself', () => {
    const onDismiss = vi.fn();
    render(<Flash message={{ type: 'success', text: 'Saved' }} onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain('Saved');
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
