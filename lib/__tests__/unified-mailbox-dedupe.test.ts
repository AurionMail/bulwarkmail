import { describe, it, expect } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { dedupeUnifiedAccounts, getCrossUnreadTotal, type UnifiedAccountClient } from '@/lib/unified-mailbox';

const mb = (id: string, role: string | undefined, unread = 0, originalId?: string): Mailbox =>
  ({ id, name: id, role, unreadEmails: unread, totalEmails: 0, originalId } as unknown as Mailbox);

const makeAccount = (over: Partial<UnifiedAccountClient> & { accountId: string }): UnifiedAccountClient => ({
  accountLabel: over.accountId,
  mailboxes: [],
  client: {} as unknown as IJMAPClient,
  clientAccountId: over.accountId,
  jmapAccountId: over.accountId,
  ...over,
});

// A folder of JMAP account `owner`, as seen through the login `via`.
const sharedEntry = (owner: string, via: string, mailboxes: Mailbox[]) =>
  makeAccount({ accountId: owner, jmapAccountId: owner, clientAccountId: via, isShared: true, mailboxes });

describe('dedupeUnifiedAccounts', () => {
  it('drops a shared entry whose folders the owner login already covers', () => {
    const alice = makeAccount({ accountId: 'login-a', jmapAccountId: 'A', mailboxes: [mb('inbox', 'inbox'), mb('f1', undefined, 1)] });
    const carolSeesAlice = sharedEntry('A', 'login-c', [mb('A:f1', undefined, 1, 'f1')]);
    const carol = makeAccount({ accountId: 'login-c', jmapAccountId: 'C', mailboxes: [mb('inbox', 'inbox')] });

    // The grantee's login may come first - the owner's own entry still wins.
    const out = dedupeUnifiedAccounts([carol, carolSeesAlice, alice]);
    expect(out).toEqual([carol, alice]);
    expect(getCrossUnreadTotal(out)).toBe(1);
  });

  it('keeps one copy when two grantee logins reach the same shared folder', () => {
    const viaBob = sharedEntry('A', 'login-b', [mb('A:f1', undefined, 1, 'f1')]);
    const viaCarol = sharedEntry('A', 'login-c', [mb('A:f1', undefined, 1, 'f1')]);
    const out = dedupeUnifiedAccounts([viaBob, viaCarol]);
    expect(out).toEqual([viaBob]);
    expect(getCrossUnreadTotal(out)).toBe(1);
  });

  it('keeps folders only one of the grantees can reach', () => {
    const viaBob = sharedEntry('A', 'login-b', [mb('A:f1', undefined, 1, 'f1')]);
    const viaCarol = sharedEntry('A', 'login-c', [mb('A:f1', undefined, 1, 'f1'), mb('A:f2', undefined, 2, 'f2')]);
    const out = dedupeUnifiedAccounts([viaBob, viaCarol]);
    expect(out.map((a) => a.mailboxes.map((m) => m.id))).toEqual([['A:f1'], ['A:f2']]);
    expect(out[1].clientAccountId).toBe('login-c');
    expect(getCrossUnreadTotal(out)).toBe(3);
  });

  it('does not merge distinct owners or personal accounts with equal mailbox ids', () => {
    const a = makeAccount({ accountId: 'login-a', jmapAccountId: 'A', mailboxes: [mb('inbox', 'inbox', 1)] });
    const b = makeAccount({ accountId: 'login-b', jmapAccountId: 'B', mailboxes: [mb('inbox', 'inbox', 1)] });
    const group = sharedEntry('G', 'login-a', [mb('G:inbox', 'inbox', 1, 'inbox')]);
    expect(dedupeUnifiedAccounts([a, b, group])).toEqual([a, b, group]);
  });
  it('does not merge equal JMAP ids that live on different servers', () => {
    // Stalwart hands out the same short account and mailbox ids on every
    // server, so login A's own folder and a folder shared to login B on
    // another server can both be account "c", mailbox "f1".
    const server = (url: string) => ({ getServerUrl: () => url } as unknown as IJMAPClient);
    const own = makeAccount({ accountId: 'login-a', jmapAccountId: 'c', client: server('https://one.example'), mailboxes: [mb('f1', undefined, 1)] });
    const sharedElsewhere = sharedEntry('c', 'login-b', [mb('c:f1', undefined, 2, 'f1')]);
    sharedElsewhere.client = server('https://two.example');
    const out = dedupeUnifiedAccounts([own, sharedElsewhere]);
    expect(out).toEqual([own, sharedElsewhere]);
    expect(getCrossUnreadTotal(out)).toBe(3);
  });

  it('still merges the same folder reached through two logins of one server', () => {
    const server = (url: string) => ({ getServerUrl: () => url } as unknown as IJMAPClient);
    const own = makeAccount({ accountId: 'login-a', jmapAccountId: 'c', client: server('https://one.example'), mailboxes: [mb('f1', undefined, 1)] });
    const viaGrantee = sharedEntry('c', 'login-b', [mb('c:f1', undefined, 1, 'f1')]);
    viaGrantee.client = server('https://ONE.example/');
    expect(dedupeUnifiedAccounts([viaGrantee, own])).toEqual([own]);
  });
});
