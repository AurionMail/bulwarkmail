import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactDetail } from '../contact-detail';
import type { ContactCard } from '@/lib/jmap/types';
import { contactHooks, clearAllHooks } from '@/lib/plugin-hooks';

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

const contact: ContactCard = {
  id: '1',
  addressBookIds: {},
  name: { components: [{ kind: 'given', value: 'Alice' }, { kind: 'surname', value: 'Smith' }], isOrdered: true },
  emails: { e0: { address: 'alice@example.com' } },
  phones: { p0: { number: '+33612345678' } },
  organizations: { o0: { name: 'Acme Corp' } },
  addresses: { a0: { street: '123 Main St', locality: 'Paris', country: 'France' } },
  notes: { n0: { note: 'VIP customer' } },
};

describe('ContactDetail', () => {
  it('shows empty state when contact is null', () => {
    render(<ContactDetail contact={null} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('detail.no_contact_selected')).toBeInTheDocument();
  });

  it('displays the contact name', () => {
    render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('displays email addresses as mailto links', () => {
    render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const link = screen.getByText('alice@example.com');
    expect(link.closest('a')).toHaveAttribute('href', 'mailto:alice@example.com');
  });

  it('displays phone numbers', () => {
    render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('+33612345678')).toBeInTheDocument();
  });

  it('labels phones, emails and addresses with translated contexts and phone types', () => {
    const typed: ContactCard = {
      ...contact,
      emails: { e0: { address: 'alice@work.example', contexts: { work: true } } },
      phones: { p0: { number: '+4930123', contexts: { private: true }, features: { cell: true, 'x-sat': true } } },
      addresses: { a0: { street: '1 Office Rd', contexts: { work: true, 'x-hq': true } } },
    };
    render(<ContactDetail contact={typed} onEdit={vi.fn()} onDelete={vi.fn()} />);
    // The test translator returns the key, so a translated label shows up as its key.
    expect(screen.getByText('form.context_work')).toBeInTheDocument();
    expect(screen.getByText('form.context_private · form.phone_cell, x-sat')).toBeInTheDocument();
    // Custom vCard types are shown as stored.
    expect(screen.getByText('form.context_work, x-hq')).toBeInTheDocument();
  });

  it('displays organization name', () => {
    render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const matches = screen.getAllByText('Acme Corp');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<ContactDetail contact={contact} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('form.edit_title'));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('detail.more_actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: /context_menu\.delete/ }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

describe('ContactDetail plugin hooks', () => {
  beforeEach(() => clearAllHooks());

  it('tells plugins once when a contact is opened, again for another one', async () => {
    const opened = vi.fn();
    contactHooks.onContactOpen.register('test', opened);

    const { rerender } = render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={vi.fn()} />);
    // Same contact with changed data: still the same open contact.
    rerender(<ContactDetail contact={{ ...contact, notes: {} }} onEdit={vi.fn()} onDelete={vi.fn()} />);
    rerender(<ContactDetail contact={{ ...contact, id: '2' }} onEdit={vi.fn()} onDelete={vi.fn()} />);
    rerender(<ContactDetail contact={null} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await Promise.resolve();

    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened.mock.calls[0][0]).toMatchObject({ id: '1', fullName: 'Alice Smith', emails: ['alice@example.com'] });
    expect(opened.mock.calls[1][0]).toMatchObject({ id: '2' });
  });
});
