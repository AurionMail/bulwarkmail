import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { EmailIdentityBadge } from '../email-identity-badge';
import type { Email, Identity } from '@/lib/jmap/types';

// A draft or sent mail from "User A" showed "User A  via User A".

const identity = { id: 'id-1', name: 'User A', email: 'usera@example.org' } as Identity;
const fromUser = (name: string) => ({ from: [{ name, email: 'usera@example.org' }], to: [] }) as unknown as Email;

describe('EmailIdentityBadge', () => {
  it('shows nothing when the sender name already is the identity name', () => {
    const { container } = render(<EmailIdentityBadge email={fromUser('User A')} identities={[identity]} />);
    expect(container.textContent).toBe('');
  });

  it('names the identity when the sender name differs', () => {
    const { container } = render(<EmailIdentityBadge email={fromUser('Support Desk')} identities={[identity]} />);
    // The translation mock returns the key of the "via {name}" text.
    expect(container.textContent).toContain('identity_short');
  });
});
