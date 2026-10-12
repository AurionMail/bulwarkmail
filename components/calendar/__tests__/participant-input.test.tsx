import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
vi.mock('@/stores/contact-store', () => {
  const state = {
    contacts: [],
    getAutocomplete: () => [{ name: 'User B', email: 'userb@example.org' }],
  };
  const hook = (sel?: (s: typeof state) => unknown) => (typeof sel === 'function' ? sel(state) : state);
  hook.getState = () => state;
  return { useContactStore: hook };
});

const { ParticipantInput } = await import('../participant-input');

describe('ParticipantInput', () => {
  it('is a search field, which Bitwarden never offers to fill', () => {
    // Bitwarden offered saved logins for the e-mail placeholder.
    render(<ParticipantInput participants={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveAttribute('type', 'search');
  });

  it('shows its suggestions outside the scrolling event form', async () => {
    // The form scrolls, and its overflow cut off the left of the list, where
    // the avatars are.
    render(
      <div data-testid="form" style={{ overflowY: 'auto' }}>
        <ParticipantInput participants={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
      </div>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user' } });
    await act(() => new Promise((r) => setTimeout(r, 300)));

    const list = screen.getByRole('listbox');
    expect(screen.getByTestId('form').contains(list)).toBe(false);
    expect(list.parentElement).toBe(document.body);
  });
});
