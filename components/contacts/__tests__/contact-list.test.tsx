import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContactList } from '../contact-list';
import { exportContacts } from '../contact-export';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import type { BlobBatch } from '@/lib/jmap/client-interface';
import type { ContactCard } from '@/lib/jmap/types';

function makeContact(overrides: Partial<ContactCard> & { id: string }): ContactCard {
  return {
    addressBookIds: {},
    ...overrides,
  };
}

const alice = makeContact({
  id: '1',
  name: { components: [{ kind: 'given', value: 'Alice' }, { kind: 'surname', value: 'Smith' }], isOrdered: true },
  emails: { e0: { address: 'alice@example.com' } },
});

const bob = makeContact({
  id: '2',
  name: { components: [{ kind: 'given', value: 'Bob' }, { kind: 'surname', value: 'Jones' }], isOrdered: true },
  emails: { e0: { address: 'bob@example.com' } },
});

const _group = makeContact({
  id: '3',
  kind: 'group',
  name: { components: [{ kind: 'given', value: 'Team' }], isOrdered: true },
  members: { '1': true },
});

const defaultProps = {
  contacts: [alice, bob],
  selectedContactId: null,
  searchQuery: '',
  onSearchChange: vi.fn(),
  onSelectContact: vi.fn(),
  onCreateNew: vi.fn(),
  selectedContactIds: new Set<string>(),
  onToggleSelection: vi.fn(),
  onSelectRangeContacts: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  onBulkDelete: vi.fn(),
  onBulkAddToGroup: vi.fn(),
  onBulkExport: vi.fn(),
  onEditContact: vi.fn(),
  onDeleteContact: vi.fn(),
  onAddContactToGroup: vi.fn(),
};

describe('ContactList', () => {
  it('renders contact names', () => {
    render(<ContactList {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('filters contacts by search query', () => {
    render(<ContactList {...defaultProps} searchQuery="alice" />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
  });

  it('shows empty state when no contacts match', () => {
    render(<ContactList {...defaultProps} contacts={[]} />);
    expect(screen.getByText('empty_state_title')).toBeInTheDocument();
  });

  it('shows placeholders instead of the empty state while contacts are loading', () => {
    render(<ContactList {...defaultProps} contacts={[]} isLoading />);
    expect(screen.queryByText('empty_state_title')).toBeNull();
    expect(screen.getByTestId('contact-list-skeleton')).toBeInTheDocument();
  });

  it('shows the contacts as soon as they are there, even while loading', () => {
    render(<ContactList {...defaultProps} isLoading />);
    expect(screen.queryByTestId('contact-list-skeleton')).toBeNull();
  });

  it('shows search empty state when search has no results', () => {
    render(<ContactList {...defaultProps} searchQuery="zzz" />);
    expect(screen.getByText('empty_search')).toBeInTheDocument();
  });

  it('shows bulk action bar when contacts are selected', () => {
    render(<ContactList {...defaultProps} selectedContactIds={new Set(['1'])} />);
    expect(screen.getByText('bulk.delete')).toBeInTheDocument();
    expect(screen.getByText('bulk.export')).toBeInTheDocument();
  });

  it('shows the bulk export as busy and takes no click while a vCard export runs', async () => {
    // On Stalwart 1.0 the export first fetches every photo.
    let deliver!: (batch: BlobBatch) => void;
    useAuthStore.setState({
      client: {
        getContactsAccountId: () => 'a',
        getBlobsAsBase64: () => new Promise<BlobBatch>((resolve) => { deliver = resolve; }),
      } as never,
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vcf');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const onBulkExport = vi.fn();
    try {
      render(<ContactList {...defaultProps} onBulkExport={onBulkExport} selectedContactIds={new Set(['1'])} />);
      let running!: Promise<boolean>;
      act(() => { running = exportContacts([{ ...alice, media: { photo: { kind: 'photo', blobId: 'dbcX' } } }]); });

      const busy = screen.getByText('export.exporting').closest('button')!;
      expect(busy).toBeDisabled();
      fireEvent.click(busy);
      expect(onBulkExport).not.toHaveBeenCalled();

      await act(async () => {
        deliver({ data: new Map([['dbcX', '/9j/']]), failed: [] });
        await running;
      });
      expect(screen.getByText('bulk.export').closest('button')).not.toBeDisabled();
    } finally {
      useAuthStore.setState({ client: null });
      vi.restoreAllMocks();
    }
  });

  it.each([
    ['1.0', { kind: 'photo' as const, blobId: 'dbcX', mediaType: 'image/jpeg' }],
    ['0.16', { kind: 'photo' as const, uri: 'data:image/jpeg;base64,/9j/', mediaType: 'image/jpeg' }],
  ])('counts a Stalwart %s photo for the "has photo" filter', (_version, photo) => {
    const carla = makeContact({
      id: '5',
      name: { components: [{ kind: 'given', value: 'Carla' }, { kind: 'surname', value: 'Diaz' }], isOrdered: true },
      media: { photo },
    });
    render(<ContactList {...defaultProps} contacts={[alice, carla]} />);

    fireEvent.click(screen.getByLabelText('filters.toggle'));
    fireEvent.click(screen.getByText('filters.has_photo'));

    expect(screen.getByText('Carla Diaz')).toBeInTheDocument();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  describe('sort order (#963)', () => {
    const carol = makeContact({
      id: '4',
      name: { components: [{ kind: 'given', value: 'Carol' }, { kind: 'surname', value: 'Smith' }], isOrdered: true },
    });
    const family = [alice, bob, carol];
    const NAME = /^(Alice Smith|Bob Jones|Carol Smith)$/;
    const renderedNames = () => screen.getAllByText(NAME).map((el) => el.textContent);

    afterEach(() => {
      useSettingsStore.setState({ sortContactsByLastName: false, groupContactsByLetter: true });
    });

    it('sorts by display name by default', () => {
      render(<ContactList {...defaultProps} contacts={family} />);
      expect(renderedNames()).toEqual(['Alice Smith', 'Bob Jones', 'Carol Smith']);
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('groups family members together when sorting by last name', () => {
      useSettingsStore.setState({ sortContactsByLastName: true });
      render(<ContactList {...defaultProps} contacts={family} />);
      expect(renderedNames()).toEqual(['Bob Jones', 'Alice Smith', 'Carol Smith']);
      // Letter headers follow the surname, not the given name.
      expect(screen.getByText('J')).toBeInTheDocument();
      expect(screen.getByText('S')).toBeInTheDocument();
      expect(screen.queryByText('A')).not.toBeInTheDocument();
    });

    it('still matches the search query against the display name', () => {
      useSettingsStore.setState({ sortContactsByLastName: true });
      render(<ContactList {...defaultProps} contacts={family} searchQuery="alice" />);
      expect(renderedNames()).toEqual(['Alice Smith']);
    });
  });

});
