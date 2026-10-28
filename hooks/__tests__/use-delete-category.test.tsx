import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactCard } from '@/lib/jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { contactHooks, clearAllHooks } from '@/lib/plugin-hooks';
import { useDeleteCategory } from '../use-delete-category';

// One way to delete a contact category, used by the Contacts sidebar and by
// Settings: no question, a toast with Undo, through the normal contact update.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast }));

const contact = (id: string, keywords: Record<string, boolean>, extra: Partial<ContactCard> = {}) =>
  ({ id, kind: 'individual', keywords, addressBookIds: { home: true }, ...extra }) as unknown as ContactCard;

const initial = { auth: useAuthStore.getState(), contacts: useContactStore.getState() };
let updateContact: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearAllHooks();
  toast.success.mockClear();
  toast.error.mockClear();
  updateContact = vi.fn(async () => undefined);
  useAuthStore.setState({ client: { updateContact } } as never);
  useContactStore.setState({
    supportsSync: true,
    contacts: [
      contact('a', { friends: true, work: true }),
      contact('b', { friends: true }),
      contact('c', { work: true }),
      contact('s', { friends: true }, { isShared: true, accountId: 'other', originalId: 'srv-s' }),
    ],
  });
});
afterEach(() => {
  clearAllHooks();
  useAuthStore.setState(initial.auth, true);
  useContactStore.setState(initial.contacts, true);
});

const keywords = () => Object.fromEntries(useContactStore.getState().contacts.map((c) => [c.id, c.keywords]));
const undo = () => act(async () => { (toast.success.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick(); });

describe('useDeleteCategory', () => {
  it('takes the category off its contacts on the server, and Undo puts it back on the same ones', async () => {
    const { result } = renderHook(() => useDeleteCategory());
    await act(async () => { expect(await result.current('friends')).toBe(true); });

    expect(keywords()).toEqual({ a: { work: true }, b: {}, c: { work: true }, s: {} });
    // A shared contact is changed in the account it belongs to.
    expect(updateContact).toHaveBeenCalledWith('srv-s', { keywords: {} }, 'other');
    expect(toast.success).toHaveBeenCalledWith('category_deleted', { action: expect.objectContaining({ label: 'undo' }) });

    await undo();
    await waitFor(() => expect(keywords()).toEqual({
      a: { work: true, friends: true }, b: { friends: true }, c: { work: true }, s: { friends: true },
    }));
  });

  it('leaves the category on a contact a plugin keeps unchanged, and Undo leaves that contact alone', async () => {
    const before = vi.fn(({ contactId }: { contactId: string }) => contactId !== 'b');
    contactHooks.onBeforeContactUpdate.register('test', before);
    const { result } = renderHook(() => useDeleteCategory());
    await act(async () => { await result.current('friends'); });

    expect(before).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'b' }));
    expect(keywords()).toEqual({ a: { work: true }, b: { friends: true }, c: { work: true }, s: {} });

    before.mockClear();
    await undo();
    await waitFor(() => expect(keywords().a).toEqual({ work: true, friends: true }));
    expect(before.mock.calls.map(([p]) => p.contactId).sort()).toEqual(['a', 's']);
  });

  it('works on contacts kept in the browser when there is no server', async () => {
    useContactStore.setState({ supportsSync: false });
    const { result } = renderHook(() => useDeleteCategory());
    await act(async () => { await result.current('work'); });

    expect(updateContact).not.toHaveBeenCalled();
    expect(keywords()).toEqual({ a: { friends: true }, b: { friends: true }, c: {}, s: { friends: true } });
  });

  it('says so when the server refuses, without an Undo', async () => {
    updateContact.mockRejectedValue(new Error('forbidden'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useDeleteCategory());
    await act(async () => { expect(await result.current('friends')).toBe(false); });

    expect(toast.error).toHaveBeenCalledWith('category_delete_failed');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
