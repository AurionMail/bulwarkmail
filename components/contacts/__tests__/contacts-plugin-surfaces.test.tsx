import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ContactDetail } from '../contact-detail';
import { ContactList } from '../contact-list';
import { resetActions, setActionDispatcher, setPluginActions } from '@/lib/plugin-sandbox/actions';
import { clearSlotOffers, framePropsOf, offerSlots } from '@/components/plugins/__tests__/fake-slot-offer';
import type { ContactCard } from '@/lib/jmap/types';

// Plugin surfaces in contacts: a section in a contact's details and buttons
// in the list's selection toolbar.

vi.mock('@/components/plugins/plugin-iframe-slot', () => import('@/components/plugins/__tests__/fake-slot-offer'));

const alice: ContactCard = {
  id: '1',
  uid: 'uid-alice',
  addressBookIds: { ab1: true },
  name: { components: [{ kind: 'given', value: 'Alice' }, { kind: 'surname', value: 'Smith' }], isOrdered: true },
  emails: { e0: { address: 'alice@example.com' } },
  notes: { n0: { note: 'VIP customer' } },
};
const bob: ContactCard = {
  id: '2',
  addressBookIds: { ab1: true },
  name: { components: [{ kind: 'given', value: 'Bob' }, { kind: 'surname', value: 'Jones' }], isOrdered: true },
};

const dispatch = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  dispatch.mockClear();
  setActionDispatcher(dispatch);
});

afterEach(() => {
  cleanup();
  clearSlotOffers();
  resetActions();
  setActionDispatcher(null);
});

describe('contact-detail-section', () => {
  it('shows the contact to the plugin in its details', () => {
    offerSlots('p1', ['contact-detail-section']);
    render(<ContactDetail contact={alice} onEdit={vi.fn()} onDelete={vi.fn()} />);

    const frame = screen.getByTestId('plugin-frame-contact-detail-section');
    expect(framePropsOf(frame).contact).toMatchObject({
      id: '1', uid: 'uid-alice', addressBookId: 'ab1', firstName: 'Alice', lastName: 'Smith', emails: ['alice@example.com'],
    });
    // Below the contact's own fields.
    expect(screen.getByText('VIP customer').compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders nothing without a plugin or without a contact', () => {
    const { unmount } = render(<ContactDetail contact={alice} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(document.querySelector('[data-plugin-slot]')).toBeNull();
    unmount();

    offerSlots('p1', ['contact-detail-section']);
    render(<ContactDetail contact={null} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(document.querySelector('[data-plugin-slot]')).toBeNull();
  });
});

describe('contact-list-actions', () => {
  const props = {
    contacts: [alice, bob],
    selectedContactId: null,
    searchQuery: '',
    onSearchChange: vi.fn(),
    onSelectContact: vi.fn(),
    onCreateNew: vi.fn(),
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

  it('puts plugin buttons in the selection toolbar and sends the selected ids', async () => {
    act(() => setPluginActions('crm', 'CRM', 'contact-list-actions', [{ id: 'sync', label: 'Sync to CRM' }]));
    render(<ContactList {...props} selectedContactIds={new Set(['1', '2'])} />);

    const button = screen.getByRole('button', { name: 'Sync to CRM' });
    // Next to the app's own bulk buttons.
    expect(button.closest('div.flex-wrap')?.parentElement).toContainElement(screen.getByText('bulk.delete'));

    await act(async () => { fireEvent.click(button); });
    expect(dispatch).toHaveBeenCalledWith('crm', 'contact-list-actions', 'sync', { contactIds: ['1', '2'] });
  });

  it('shows no plugin buttons without a selection or without a plugin', () => {
    act(() => setPluginActions('crm', 'CRM', 'contact-list-actions', [{ id: 'sync', label: 'Sync to CRM' }]));
    const { unmount } = render(<ContactList {...props} selectedContactIds={new Set()} />);
    expect(screen.queryByRole('button', { name: 'Sync to CRM' })).toBeNull();
    unmount();

    resetActions();
    render(<ContactList {...props} selectedContactIds={new Set(['1'])} />);
    expect(document.querySelector('[data-plugin-actions]')).toBeNull();
  });
});
