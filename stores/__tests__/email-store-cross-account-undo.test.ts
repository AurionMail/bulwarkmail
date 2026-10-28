import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore, type CrossAccountMoveReceipt, type EmailRestoreBatch } from '../email-store';
import { useAuthStore } from '../auth-store';
import type { Email } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

type Store = ReturnType<typeof useEmailStore.getState>;

// Undo after a move to another account: the message moves back the way it
// went (copy back, delete the copy) and gets its folders and read state back.

function makeEmail(id: string, mailboxServerId: string): Email {
  return {
    id, threadId: `t-${id}`, mailboxIds: { [mailboxServerId]: true }, keywords: {},
    size: 100, receivedAt: '2026-10-01T08:00:00Z',
    from: [{ name: 'X', email: 'x@example.com' }], to: [{ name: 'Y', email: 'y@example.com' }],
    subject: id, preview: '', hasAttachment: false, textBody: [], htmlBody: [], bodyValues: {},
  };
}

describe('Undo of a move to another account (two servers)', () => {
  const blob = new Blob(['From: x@example.com\r\n\r\nhi']);
  let source: Record<string, ReturnType<typeof vi.fn>>;
  let dest: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    source = {
      getAccountId: vi.fn(() => 'acct-A'),
      getEmail: vi.fn().mockResolvedValue({ id: 'e1', blobId: 'blob-1', keywords: { $seen: true }, receivedAt: '2026-10-01T08:00:00Z' }),
      fetchBlob: vi.fn().mockResolvedValue(blob),
      deleteEmail: vi.fn().mockResolvedValue(undefined),
      importRawEmail: vi.fn().mockResolvedValue('back-1'),
      restoreEmails: vi.fn().mockResolvedValue(undefined),
    };
    dest = {
      getAccountId: vi.fn(() => 'acct-B'),
      importRawEmail: vi.fn().mockResolvedValue('copy-1'),
      getEmail: vi.fn().mockResolvedValue({ id: 'copy-1', blobId: 'blob-2', keywords: { $seen: true }, receivedAt: '2026-10-01T08:00:00Z' }),
      fetchBlob: vi.fn().mockResolvedValue(blob),
      deleteEmail: vi.fn().mockResolvedValue(undefined),
    };
    useAuthStore.setState({
      activeAccountId: 'login-A',
      getClientForAccount: ((id: string) => (id === 'login-A' ? source : id === 'login-B' ? dest : undefined)) as never,
    } as never);
    useEmailStore.setState({
      emails: [makeEmail('e1', 'srv-inbox-A')],
      fetchMailboxes: vi.fn().mockResolvedValue(undefined) as unknown as Store['fetchMailboxes'],
      fetchAccountMailboxes: vi.fn().mockResolvedValue(undefined) as unknown as Store['fetchAccountMailboxes'],
      refreshCurrentMailbox: vi.fn().mockResolvedValue(undefined) as unknown as Store['refreshCurrentMailbox'],
    });
  });

  it('notes where each moved message went', async () => {
    const receipts: CrossAccountMoveReceipt[] = [];
    await useEmailStore.getState().crossAccountMoveEmails(new Map([['login-A', ['e1']]]), 'login-B', 'inbox-B', undefined, undefined, { receipts });
    expect(receipts).toEqual([{
      sourceLogin: 'login-A', sourceJmapAccountId: 'acct-A', sourceEmailId: 'e1',
      destLogin: 'login-B', destJmapAccountId: 'acct-B', destEmailId: 'copy-1',
    }]);
  });

  it('notes nothing for a copy, which keeps the original', async () => {
    const receipts: CrossAccountMoveReceipt[] = [];
    await useEmailStore.getState().crossAccountMoveEmails(new Map([['login-A', ['e1']]]), 'login-B', 'inbox-B', undefined, undefined, { keepOriginal: true, receipts });
    expect(receipts).toEqual([]);
  });

  it('moves the message back into its folders, read state included, and deletes the copy', async () => {
    const receipts: CrossAccountMoveReceipt[] = [{
      sourceLogin: 'login-A', sourceJmapAccountId: 'acct-A', sourceEmailId: 'e1',
      destLogin: 'login-B', destJmapAccountId: 'acct-B', destEmailId: 'copy-1',
    }];
    // Taken before the move: in two folders, unread. Plus a message that
    // stayed in its account.
    const batches: EmailRestoreBatch[] = [{
      client: source as unknown as IJMAPClient,
      points: [
        { id: 'e1', mailboxIds: { 'srv-inbox-A': true, 'srv-work-A': true }, seen: false },
        { id: 'e2', mailboxIds: { 'srv-inbox-A': true }, seen: true },
      ],
    }];

    await useEmailStore.getState().undoMove({} as IJMAPClient, batches, receipts);

    // Back the way it came: out of B, into A's first folder, the copy gone.
    expect(dest.fetchBlob).toHaveBeenCalledWith('blob-2', undefined, undefined, undefined);
    expect(source.importRawEmail).toHaveBeenCalledWith(blob, { 'srv-inbox-A': true }, { $seen: true }, undefined, '2026-10-01T08:00:00Z');
    expect(dest.deleteEmail).toHaveBeenCalledWith('copy-1', undefined);
    // Its folders and read state as they were, under its new id; the other
    // message is restored in place, under its own.
    expect(source.restoreEmails).toHaveBeenCalledWith([{ id: 'e2', mailboxIds: { 'srv-inbox-A': true }, seen: true }], undefined);
    expect(source.restoreEmails).toHaveBeenCalledWith([{ id: 'back-1', mailboxIds: { 'srv-inbox-A': true, 'srv-work-A': true }, seen: false }], undefined);
    expect(source.restoreEmails).not.toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'e1' })]), undefined);
  });

  it('does not take an id of another account for the moved message', async () => {
    // Account B's own `e1` stayed put; only account A's `e1` moved.
    const receipts: CrossAccountMoveReceipt[] = [{
      sourceLogin: 'login-A', sourceJmapAccountId: 'acct-A', sourceEmailId: 'e1',
      destLogin: 'login-B', destJmapAccountId: 'acct-B', destEmailId: 'copy-1',
    }];
    const batches: EmailRestoreBatch[] = [
      { client: source as unknown as IJMAPClient, points: [{ id: 'e1', mailboxIds: { 'srv-inbox-A': true }, seen: true }] },
      { client: dest as unknown as IJMAPClient, points: [{ id: 'e1', mailboxIds: { 'srv-inbox-B': true }, seen: true }] },
    ];
    (dest as Record<string, unknown>).restoreEmails = vi.fn().mockResolvedValue(undefined);

    await useEmailStore.getState().undoMove({} as IJMAPClient, batches, receipts);

    expect((dest as Record<string, ReturnType<typeof vi.fn>>).restoreEmails).toHaveBeenCalledWith([{ id: 'e1', mailboxIds: { 'srv-inbox-B': true }, seen: true }], undefined);
    expect(source.importRawEmail).toHaveBeenCalledWith(blob, { 'srv-inbox-A': true }, { $seen: true }, undefined, '2026-10-01T08:00:00Z');
  });
});
