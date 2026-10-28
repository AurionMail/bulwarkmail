import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressBook, ContactCard } from '@/lib/jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { AddressBookManagementSettings } from '../address-book-management-settings';

// Settings > Contacts: an address book can be deleted here as in the
// Contacts sidebar (after a ConfirmDialog), and a category can be deleted,
// with Undo.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast }));
vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const rights = { mayRead: true, mayWrite: true, mayShare: true, mayDelete: true };
const book = (id: string, extra: Partial<AddressBook> = {}) =>
  ({ id, name: id === 'home' ? 'Home' : 'Club', isDefault: false, isShared: false, myRights: rights, shareWith: null, ...extra }) as unknown as AddressBook;
const contact = (id: string, keywords: Record<string, boolean>) =>
  ({ id, kind: 'individual', keywords, addressBookIds: { home: true } }) as unknown as ContactCard;

const initial = { auth: useAuthStore.getState(), contacts: useContactStore.getState() };
let removeAddressBook: ReturnType<typeof vi.fn>;
let updateContact: ReturnType<typeof vi.fn>;
beforeEach(() => {
  toast.success.mockClear();
  removeAddressBook = vi.fn(async () => {});
  updateContact = vi.fn(async (_client: unknown, id: string, updates: Partial<ContactCard>) => {
    useContactStore.setState((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...updates } : c)) }));
    return true;
  });
  useAuthStore.setState({ client: { getAccountId: () => 'acc' } } as never);
  useContactStore.setState({
    addressBooks: [book('home', { isDefault: true }), book('club')],
    contacts: [contact('a', { friends: true }), contact('b', { friends: true, work: true }), contact('c', { work: true })],
    supportsSync: true,
    fetchAddressBooks: vi.fn(async () => {}),
    removeAddressBook,
    updateContact,
  } as never);
});
afterEach(() => {
  useAuthStore.setState(initial.auth, true);
  useContactStore.setState(initial.contacts, true);
});

describe('address books in Settings', () => {
  it('deletes an address book after the confirm dialog, and never the default one', async () => {
    render(<AddressBookManagementSettings />);
    // Only "Club" can go: "Home" is the default.
    const deletes = screen.getAllByRole('button', { name: 'delete' });
    expect(deletes).toHaveLength(1);

    fireEvent.click(deletes[0]);
    const dialog = within(screen.getByRole('alertdialog', { name: 'delete_title' }));
    expect(removeAddressBook).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(removeAddressBook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'club' })));
  });
});

describe('categories in Settings', () => {
  it('deletes a category from its contacts, and Undo puts it back on the same ones', async () => {
    render(<AddressBookManagementSettings />);
    fireEvent.click(screen.getAllByRole('button', { name: 'delete_category' })[0]); // "friends" sorts first

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('category_deleted', expect.anything()));
    const keywords = () => Object.fromEntries(useContactStore.getState().contacts.map((c) => [c.id, c.keywords]));
    expect(keywords()).toEqual({ a: {}, b: { work: true }, c: { work: true } });

    (toast.success.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick();
    await waitFor(() => expect(keywords()).toEqual({ a: { friends: true }, b: { work: true, friends: true }, c: { work: true } }));
  });
});
