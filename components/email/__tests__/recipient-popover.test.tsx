import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { RecipientPopover } from '../recipient-popover';
import { useContactStore } from '@/stores/contact-store';
import type { ContactCard } from '@/lib/jmap/types';

// A saved contact without a name made the popover show only the address,
// even though the message header named the sender.

const address = 'wordpress@example.org';

function setContacts(contacts: ContactCard[]) {
  useContactStore.setState({ contacts });
}

function openPopover() {
  render(<RecipientPopover name="WordPress" email={address} />);
  fireEvent.click(screen.getByRole('button', { name: 'WordPress' }));
}

describe('RecipientPopover', () => {
  afterEach(() => setContacts([]));

  it('shows the header name and the address when a matching contact has no name', () => {
    setContacts([{ id: 'c1', emails: { e1: { address } } } as unknown as ContactCard]);
    openPopover();
    const header = screen.getAllByText('WordPress');
    expect(header.length).toBe(2);
    expect(screen.getByText(address)).toBeTruthy();
  });

  it('prefers the contact name over the header name', () => {
    setContacts([{ id: 'c1', name: { full: 'WP Blog' }, emails: { e1: { address } } } as unknown as ContactCard]);
    openPopover();
    expect(screen.getByText('WP Blog')).toBeTruthy();
    expect(screen.getByText(address)).toBeTruthy();
  });
});
