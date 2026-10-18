import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { RecipientCardPopover, RecipientPopover } from '../recipient-popover';
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

describe('RecipientCardPopover', () => {
  const anchor = { top: 10, bottom: 30, left: 10 };

  it('offers copy, email and view details, and extra actions', () => {
    const onViewContact = vi.fn();
    render(
      <RecipientCardPopover
        anchor={anchor}
        email={address}
        name="WordPress"
        onViewContact={onViewContact}
        onClose={() => {}}
        actions={<button type="button">extra</button>}
      />,
    );
    const card = screen.getByRole('dialog', { name: 'WordPress' });
    expect(card).toHaveTextContent('action_copy');
    expect(card).toHaveTextContent('action_email');
    fireEvent.click(screen.getByRole('button', { name: /view_details/ }));
    expect(onViewContact).toHaveBeenCalledWith(null, address);
    expect(screen.getByRole('button', { name: 'extra' })).toBeTruthy();
  });

  it('closes on a press outside, Escape, and the window losing focus', () => {
    const onClose = vi.fn();
    render(<RecipientCardPopover anchor={anchor} email={address} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    // A click into a message body's iframe.
    fireEvent.blur(window);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
