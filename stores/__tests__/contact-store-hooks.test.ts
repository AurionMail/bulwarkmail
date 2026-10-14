import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useContactStore } from '../contact-store';
import { contactHooks, clearAllHooks } from '@/lib/plugin-hooks';
import type { ContactCard } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

const card = (overrides: Partial<ContactCard> = {}): ContactCard => ({
  id: 'c1',
  addressBookIds: { 'ab-1': true },
  name: { full: 'Jane Doe', components: [{ kind: 'given', value: 'Jane' }, { kind: 'surname', value: 'Doe' }], isOrdered: true },
  emails: { e0: { address: 'jane@example.com' } },
  ...overrides,
});

const makeClient = (overrides: Record<string, unknown> = {}) => ({
  createContact: vi.fn(async (c: Partial<ContactCard>) => ({ ...c, id: 'srv-1' } as ContactCard)),
  updateContact: vi.fn(async () => undefined),
  deleteContact: vi.fn(async () => undefined),
  ...overrides,
}) as unknown as IJMAPClient & Record<string, ReturnType<typeof vi.fn>>;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('contact-store plugin hooks: contact CRUD', () => {
  beforeEach(() => {
    clearAllHooks();
    useContactStore.setState({
      contacts: [], addressBooks: [], selectedContactId: null, error: null,
      supportsSync: true, selectedContactIds: new Set<string>(), lastSelectedContactId: null,
    });
  });

  describe('createContact', () => {
    it('asks plugins first and tells them about the created contact', async () => {
      const client = makeClient();
      const before = vi.fn(() => {
        expect(client.createContact).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      contactHooks.onBeforeContactCreate.register('test', before);
      contactHooks.onAfterContactCreate.register('test', after);

      const { id: _id, ...draft } = card();
      void _id;
      expect(await useContactStore.getState().createContact(client, draft)).toBe(true);
      await flush();

      expect(before).toHaveBeenCalledOnce();
      expect(before).toHaveBeenCalledWith(expect.objectContaining({ id: '', fullName: 'Jane Doe', emails: ['jane@example.com'] }));
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0]).toMatchObject({ id: 'srv-1', fullName: 'Jane Doe', addressBookId: 'ab-1' });
    });

    it('creates nothing when a plugin says no', async () => {
      const client = makeClient();
      const after = vi.fn();
      contactHooks.onBeforeContactCreate.register('test', () => false);
      contactHooks.onAfterContactCreate.register('test', after);

      expect(await useContactStore.getState().createContact(client, card())).toBe(false);
      await flush();

      expect(client.createContact).not.toHaveBeenCalled();
      expect(useContactStore.getState().contacts).toEqual([]);
      expect(after).not.toHaveBeenCalled();
    });

    it('does not report a contact the server refused', async () => {
      const client = makeClient({ createContact: vi.fn().mockRejectedValue(new Error('nope')) });
      const after = vi.fn();
      contactHooks.onAfterContactCreate.register('test', after);

      await expect(useContactStore.getState().createContact(client, card())).rejects.toThrow('nope');
      await flush();
      expect(after).not.toHaveBeenCalled();
    });
  });

  describe('updateContact', () => {
    it('passes the id and patch first, then the changed contact', async () => {
      useContactStore.setState({ contacts: [card()] });
      const client = makeClient();
      const before = vi.fn(() => {
        expect(client.updateContact).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      contactHooks.onBeforeContactUpdate.register('test', before);
      contactHooks.onAfterContactUpdate.register('test', after);

      const patch = { emails: { e0: { address: 'new@example.com' } } };
      expect(await useContactStore.getState().updateContact(client, 'c1', patch)).toBe(true);
      await flush();

      expect(before).toHaveBeenCalledWith({ contactId: 'c1', patch });
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0]).toMatchObject({ id: 'c1', emails: ['new@example.com'] });
    });

    it('changes nothing when a plugin says no', async () => {
      useContactStore.setState({ contacts: [card()] });
      const client = makeClient();
      const after = vi.fn();
      contactHooks.onBeforeContactUpdate.register('test', () => false);
      contactHooks.onAfterContactUpdate.register('test', after);

      expect(await useContactStore.getState().updateContact(client, 'c1', { kind: 'org' })).toBe(false);
      await flush();

      expect(client.updateContact).not.toHaveBeenCalled();
      expect(useContactStore.getState().contacts[0].kind).toBeUndefined();
      expect(after).not.toHaveBeenCalled();
    });

    it('does not report an update the server refused', async () => {
      useContactStore.setState({ contacts: [card()] });
      const client = makeClient({ updateContact: vi.fn().mockRejectedValue(new Error('nope')) });
      const after = vi.fn();
      contactHooks.onAfterContactUpdate.register('test', after);

      await expect(useContactStore.getState().updateContact(client, 'c1', { kind: 'org' })).rejects.toThrow();
      await flush();
      expect(after).not.toHaveBeenCalled();
    });
  });

  describe('deleteContact', () => {
    it('asks plugins first and reports the deleted id', async () => {
      useContactStore.setState({ contacts: [card()] });
      const client = makeClient();
      const before = vi.fn(() => {
        expect(client.deleteContact).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      contactHooks.onBeforeContactDelete.register('test', before);
      contactHooks.onAfterContactDelete.register('test', after);

      expect(await useContactStore.getState().deleteContact(client, 'c1')).toBe(true);
      await flush();

      expect(before).toHaveBeenCalledWith({ contactIds: ['c1'] });
      expect(after).toHaveBeenCalledWith({ contactIds: ['c1'] });
      expect(useContactStore.getState().contacts).toEqual([]);
    });

    it('keeps the contact when a plugin says no', async () => {
      useContactStore.setState({ contacts: [card()], selectedContactId: 'c1' });
      const client = makeClient();
      const after = vi.fn();
      contactHooks.onBeforeContactDelete.register('test', () => false);
      contactHooks.onAfterContactDelete.register('test', after);

      expect(await useContactStore.getState().deleteContact(client, 'c1')).toBe(false);
      await flush();

      expect(client.deleteContact).not.toHaveBeenCalled();
      expect(useContactStore.getState().contacts).toHaveLength(1);
      expect(useContactStore.getState().selectedContactId).toBe('c1');
      expect(after).not.toHaveBeenCalled();
    });

    it('does not report a delete the server refused', async () => {
      useContactStore.setState({ contacts: [card()] });
      const client = makeClient({ deleteContact: vi.fn().mockRejectedValue(new Error('nope')) });
      const after = vi.fn();
      contactHooks.onAfterContactDelete.register('test', after);

      await expect(useContactStore.getState().deleteContact(client, 'c1')).rejects.toThrow();
      await flush();
      expect(after).not.toHaveBeenCalled();
    });
  });

  describe('local contacts (no server sync)', () => {
    beforeEach(() => useContactStore.setState({ supportsSync: false }));

    it('fires the same hooks for create, update and delete', async () => {
      const created = vi.fn();
      const updated = vi.fn();
      const deleted = vi.fn();
      contactHooks.onAfterContactCreate.register('test', created);
      contactHooks.onAfterContactUpdate.register('test', updated);
      contactHooks.onAfterContactDelete.register('test', deleted);

      await useContactStore.getState().addLocalContact(card({ id: 'local-1' }));
      await useContactStore.getState().updateLocalContact('local-1', { kind: 'org' });
      await useContactStore.getState().deleteLocalContact('local-1');
      await flush();

      expect(created.mock.calls[0][0]).toMatchObject({ id: 'local-1', fullName: 'Jane Doe' });
      expect(updated.mock.calls[0][0]).toMatchObject({ id: 'local-1', kind: 'org' });
      expect(deleted).toHaveBeenCalledWith({ contactIds: ['local-1'] });
    });

    it('leaves the list alone when plugins say no', async () => {
      useContactStore.setState({ contacts: [card({ id: 'local-1' })] });
      contactHooks.onBeforeContactCreate.register('test', () => false);
      contactHooks.onBeforeContactUpdate.register('test', () => false);
      contactHooks.onBeforeContactDelete.register('test', () => false);

      expect(await useContactStore.getState().addLocalContact(card({ id: 'local-2' }))).toBe(false);
      expect(await useContactStore.getState().updateLocalContact('local-1', { kind: 'org' })).toBe(false);
      expect(await useContactStore.getState().deleteLocalContact('local-1')).toBe(false);

      const { contacts } = useContactStore.getState();
      expect(contacts.map(c => c.id)).toEqual(['local-1']);
      expect(contacts[0].kind).toBeUndefined();
    });
  });

  describe('bulkDeleteContacts', () => {
    it('asks once with every id and reports only the ones that went', async () => {
      useContactStore.setState({ contacts: [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })] });
      const client = makeClient({
        deleteContact: vi.fn(async (id: string) => { if (id === 'b') throw new Error('locked'); }),
      });
      const before = vi.fn(() => {
        expect(client.deleteContact).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      contactHooks.onBeforeContactDelete.register('test', before);
      contactHooks.onAfterContactDelete.register('test', after);

      await useContactStore.getState().bulkDeleteContacts(client, ['a', 'b', 'c']);
      await flush();

      expect(before).toHaveBeenCalledOnce();
      expect(before).toHaveBeenCalledWith({ contactIds: ['a', 'b', 'c'] });
      expect(after).toHaveBeenCalledOnce();
      expect(after).toHaveBeenCalledWith({ contactIds: ['a', 'c'] });
    });

    it('deletes nothing when a plugin says no', async () => {
      useContactStore.setState({
        contacts: [card({ id: 'a' }), card({ id: 'b' })],
        selectedContactIds: new Set(['a', 'b']),
      });
      const client = makeClient();
      contactHooks.onBeforeContactDelete.register('test', () => false);

      await useContactStore.getState().bulkDeleteContacts(client, ['a', 'b']);

      expect(client.deleteContact).not.toHaveBeenCalled();
      expect(useContactStore.getState().contacts).toHaveLength(2);
      expect(useContactStore.getState().selectedContactIds.size).toBe(2);
    });
  });
});

describe('contact-store plugin hooks: groups, import, move, selection', () => {
  beforeEach(() => {
    clearAllHooks();
    useContactStore.setState({
      contacts: [], addressBooks: [], selectedContactId: null, error: null,
      supportsSync: true, selectedContactIds: new Set<string>(), lastSelectedContactId: null,
    });
  });

  it('reports created, renamed and deleted groups', async () => {
    const client = makeClient({
      createContact: vi.fn(async (c: Partial<ContactCard>) => ({ ...c, id: 'g1' } as ContactCard)),
    });
    const changes = vi.fn();
    contactHooks.onContactGroupChange.register('test', changes);

    await useContactStore.getState().createGroup(client, 'Team', []);
    await useContactStore.getState().updateGroup(client, 'g1', 'Crew');
    await useContactStore.getState().deleteGroup(client, 'g1');
    await flush();

    expect(changes.mock.calls.map(c => c[0])).toEqual([
      { groupId: 'g1', change: 'created' },
      { groupId: 'g1', change: 'updated' },
      { groupId: 'g1', change: 'deleted' },
    ]);
  });

  it('does not report a group change the server refused', async () => {
    useContactStore.setState({ contacts: [card({ id: 'g1', kind: 'group', members: {} })] });
    const client = makeClient({ deleteContact: vi.fn().mockRejectedValue(new Error('nope')) });
    const changes = vi.fn();
    contactHooks.onContactGroupChange.register('test', changes);

    await expect(useContactStore.getState().deleteGroup(client, 'g1')).rejects.toThrow();
    await flush();
    expect(changes).not.toHaveBeenCalled();
  });

  it('reports the members that were really added or removed, once per action', async () => {
    useContactStore.setState({
      contacts: [
        card({ id: 'a', uid: 'uid-a' }), card({ id: 'b', uid: 'uid-b' }),
        card({ id: 'g1', kind: 'group', members: { 'uid-a': true } }),
      ],
    });
    const client = makeClient();
    const members = vi.fn();
    contactHooks.onContactGroupMemberChange.register('test', members);

    // a is already in the group; only b is new. bulkAddToGroup goes through
    // addMembersToGroup and must not fire twice.
    await useContactStore.getState().bulkAddToGroup(client, 'g1', ['a', 'b']);
    await useContactStore.getState().removeMembersFromGroup(client, 'g1', ['a']);
    await flush();

    expect(members.mock.calls.map(c => c[0])).toEqual([
      { groupId: 'g1', added: ['b'], removed: [] },
      { groupId: 'g1', added: [], removed: ['a'] },
    ]);
  });

  it('does not report members the server refused', async () => {
    useContactStore.setState({ contacts: [card({ id: 'a' }), card({ id: 'g1', kind: 'group', members: {} })] });
    const client = makeClient({ updateContact: vi.fn().mockRejectedValue(new Error('nope')) });
    const members = vi.fn();
    contactHooks.onContactGroupMemberChange.register('test', members);

    await expect(useContactStore.getState().addMembersToGroup(client, 'g1', ['a'])).rejects.toThrow();
    await flush();
    expect(members).not.toHaveBeenCalled();
  });

  it('reports an import with the book and the count', async () => {
    let n = 0;
    const client = makeClient({
      createContact: vi.fn(async (c: Partial<ContactCard>) => ({ ...c, id: `srv-${++n}`, addressBookIds: { 'book-9': true } } as ContactCard)),
    });
    const imported = vi.fn();
    contactHooks.onContactsImport.register('test', imported);

    await useContactStore.getState().importContacts(client, [card({ id: 'x' }), card({ id: 'y' })]);
    await flush();

    expect(imported).toHaveBeenCalledOnce();
    expect(imported).toHaveBeenCalledWith({ addressBookId: 'book-9', imported: 2 });
  });

  it('does not report an import where nothing arrived', async () => {
    const client = makeClient({ createContact: vi.fn().mockRejectedValue(new Error('nope')) });
    const imported = vi.fn();
    contactHooks.onContactsImport.register('test', imported);

    await useContactStore.getState().importContacts(client, [card({ id: 'x' })]);
    await flush();
    expect(imported).not.toHaveBeenCalled();
  });

  it('reports each moved contact with the target book', async () => {
    useContactStore.setState({ contacts: [card({ id: 'a' }), card({ id: 'b' })] });
    const client = makeClient({ getContactsAccountId: () => 'acc' });
    const moved = vi.fn();
    contactHooks.onContactMove.register('test', moved);

    await useContactStore.getState().moveContactToAddressBook(client, ['a', 'b'], { id: 'book-2', name: 'Work' } as never);
    await flush();

    expect(moved.mock.calls.map(c => c[0])).toEqual([
      { contactId: 'a', toAddressBookId: 'book-2' },
      { contactId: 'b', toAddressBookId: 'book-2' },
    ]);
  });

  it('does not report a move the server refused', async () => {
    useContactStore.setState({ contacts: [card({ id: 'a' })] });
    const client = makeClient({ getContactsAccountId: () => 'acc', updateContact: vi.fn().mockRejectedValue(new Error('nope')) });
    const moved = vi.fn();
    contactHooks.onContactMove.register('test', moved);

    await expect(useContactStore.getState().moveContactToAddressBook(client, ['a'], { id: 'book-2', name: 'Work' } as never)).rejects.toThrow();
    await flush();
    expect(moved).not.toHaveBeenCalled();
  });

  it('reports selection changes, and only real ones', async () => {
    const selection = vi.fn();
    contactHooks.onContactSelectionChange.register('test', selection);
    const store = useContactStore.getState();

    store.toggleContactSelection('a');
    store.selectRangeContacts('c', ['a', 'b', 'c']);
    store.selectAllContacts(['a', 'b', 'c']); // same ids: no change
    store.clearSelection();
    store.clearSelection(); // already empty: no change
    await flush();

    expect(selection.mock.calls.map(c => c[0])).toEqual([
      { contactIds: ['a'] },
      { contactIds: ['a', 'b', 'c'] },
      { contactIds: [] },
    ]);
  });
});
