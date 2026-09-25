import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContactDetail } from '../contact-detail';
import type { ContactCard } from '@/lib/jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';

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

  describe('photo', () => {
    const fetchBlob = vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));

    beforeEach(() => {
      clearContactPhotoCache();
      fetchBlob.mockClear();
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:photo');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      // ContactActivity asks the same client for mail and events.
      useAuthStore.setState({
        client: {
          fetchBlob,
          advancedSearchEmails: vi.fn(async () => ({ emails: [] })),
          queryAllCalendarEvents: vi.fn(async () => []),
        } as never,
      });
    });

    afterEach(() => {
      useAuthStore.setState({ client: null });
      useContactStore.setState({ contacts: [] });
      clearContactPhotoCache();
      vi.restoreAllMocks();
    });

    it('shows the photo of a Stalwart 1.0 card', async () => {
      const { container } = render(
        <ContactDetail
          contact={{ ...contact, accountId: 'a', media: { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } } }}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      );

      await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:photo'));
      expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', 'a');
    });

    it('does not show another card\'s photo for the same address', () => {
      useContactStore.setState({
        contacts: [{ ...contact, id: '2', media: { photo: { kind: 'photo', blobId: 'dbcOther' } } }],
      });
      const { container } = render(<ContactDetail contact={contact} onEdit={vi.fn()} onDelete={vi.fn()} />);
      expect(container.querySelector('img')).toBeNull();
      expect(fetchBlob).not.toHaveBeenCalled();
    });
  });
});
