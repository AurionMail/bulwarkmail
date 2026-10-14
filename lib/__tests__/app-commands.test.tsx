import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parkAppCommand, peekParkedAppCommand, requestAppCommand, useAppCommands } from '../app-commands';

function Surface({ compose, enabled = true }: { compose: () => void; enabled?: boolean }) {
  useAppCommands({ compose }, enabled);
  return null;
}

describe('palette commands for the mail page', () => {
  it('reports a command nobody took', () => {
    expect(requestAppCommand('compose')).toBe(false);
  });

  it('runs a command on the mounted surface', () => {
    const compose = vi.fn();
    render(<Surface compose={compose} />);
    expect(requestAppCommand('compose')).toBe(true);
    expect(compose).toHaveBeenCalledTimes(1);
    // A command the surface has no handler for stays untaken.
    expect(requestAppCommand('search')).toBe(false);
  });

  it('runs a parked command once the surface is ready, and only once', () => {
    const compose = vi.fn();
    parkAppCommand('compose');
    const { rerender } = render(<Surface compose={compose} enabled={false} />);
    expect(compose).not.toHaveBeenCalled();

    rerender(<Surface compose={compose} enabled />);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(peekParkedAppCommand()).toBeNull();

    rerender(<Surface compose={compose} enabled={false} />);
    rerender(<Surface compose={compose} enabled />);
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
