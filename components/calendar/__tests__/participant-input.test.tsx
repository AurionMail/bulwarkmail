import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
vi.mock('@/stores/contact-store', () => {
  const state = { contacts: [], getAutocomplete: () => [] };
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
});
