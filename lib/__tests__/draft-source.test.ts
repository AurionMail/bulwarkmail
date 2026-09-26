import { describe, expect, it } from 'vitest';
import { findDraftIdentityIdForLogin, listRowSource, resolveDraftSource } from '../draft-source';
import type { Identity } from '../jmap/types';

// userb is account `e` on the Stalwart 0.16.23 and the 1.0 test server alike,
// and the team group `c` on both; message ids repeat across all of them.
const teamInbox = { isShared: true, accountId: 'c' };

describe('resolveDraftSource', () => {
  it('takes an own draft found by an "All folders" search as own, with the team folder still selected', () => {
    expect(resolveDraftSource(
      { sourceClientAccountId: 'userb@v016', sourceAccountId: 'e' },
      { aggregate: true, mailbox: teamInbox, activeAccountId: 'userb@v016' },
    )).toEqual({ localAccountId: 'userb@v016', accountId: 'e' });
  });

  it('takes a draft of a tag view from the login and account it is stamped with', () => {
    expect(resolveDraftSource(
      { sourceClientAccountId: 'userb@v10', sourceAccountId: 'c' },
      { aggregate: true, mailbox: undefined, activeAccountId: 'userb@v016' },
    )).toEqual({ localAccountId: 'userb@v10', accountId: 'c' });
  });

  it('never takes the folder underneath for an unstamped row of a list that mixes accounts', () => {
    expect(resolveDraftSource({}, { aggregate: true, mailbox: teamInbox, activeAccountId: 'userb@v016' }))
      .toEqual({ localAccountId: 'userb@v016', accountId: undefined });
  });

  it('takes a draft of a group folder opened directly as the group\'s', () => {
    expect(resolveDraftSource({}, { aggregate: false, mailbox: teamInbox, activeAccountId: 'userb@v016' }))
      .toEqual({ localAccountId: 'userb@v016', accountId: 'c' });
  });

  it('takes an own folder\'s draft of the login viewed in the Pro sidebar as that login\'s', () => {
    expect(resolveDraftSource(
      {},
      { aggregate: false, mailbox: { isShared: false, accountId: 'e' }, viewingAccountId: 'userb@v10', activeAccountId: 'userb@v016' },
    )).toEqual({ localAccountId: 'userb@v10', accountId: undefined });
  });

  it('takes what the caller says for a send undone from the group identity', () => {
    expect(resolveDraftSource(
      { sourceClientAccountId: 'userb@v016', sourceAccountId: 'e' },
      { source: { accountId: 'c', localAccountId: 'userb@v10' }, aggregate: true, activeAccountId: 'userb@v016' },
    )).toEqual({ localAccountId: 'userb@v10', accountId: 'c' });
  });

  // Pro shell: the 1.0 login's folder was browsed, then Scheduled opened; it
  // lists the active 0.16.23 login's mail, and "Cancel and edit" restores the
  // message through that login's client. The browsed login stays "viewed".
  it('takes a scheduled send cancelled for editing from the login that restored it, not the one browsed before', () => {
    expect(resolveDraftSource({}, {
      source: { accountId: 'e', localAccountId: 'userb@v016' },
      aggregate: false,
      viewingAccountId: 'userb@v10',
      activeAccountId: 'userb@v016',
    })).toEqual({ localAccountId: 'userb@v016', accountId: 'e' });
  });

  it('leaves the login of a source that names none unset rather than take the login browsed before', () => {
    expect(resolveDraftSource({}, {
      source: { accountId: 'e' },
      aggregate: false,
      viewingAccountId: 'userb@v10',
      activeAccountId: 'userb@v016',
    })).toEqual({ localAccountId: undefined, accountId: 'e' });
  });

  it('never takes the folder selected underneath for a send undone from the own account', () => {
    expect(resolveDraftSource({}, {
      source: { localAccountId: 'userb@v016' },
      aggregate: false,
      mailbox: teamInbox,
      activeAccountId: 'userb@v016',
    })).toEqual({ localAccountId: 'userb@v016', accountId: undefined });
  });
});

describe('listRowSource', () => {
  it('takes a row of a list that mixes accounts from its stamps', () => {
    expect(listRowSource(
      { sourceClientAccountId: 'userb@v10', sourceAccountId: 'c' },
      { isScheduledView: false, viewingAccountId: null, activeAccountId: 'userb@v016', accountId: undefined },
    )).toEqual({ localAccountId: 'userb@v10', accountId: 'c' });
  });

  it('takes a row of another login\'s folder from the login browsed', () => {
    expect(listRowSource({}, { isScheduledView: false, viewingAccountId: 'userb@v10', activeAccountId: 'userb@v016' }))
      .toEqual({ localAccountId: 'userb@v10', accountId: undefined });
  });

  it('takes a row of the active login\'s group folder from the active login and the group account', () => {
    expect(listRowSource({}, { isScheduledView: false, viewingAccountId: null, activeAccountId: 'userb@v016', accountId: 'c' }))
      .toEqual({ localAccountId: 'userb@v016', accountId: 'c' });
  });

  it('names no login for a row of Scheduled, whatever login was browsed before', () => {
    expect(listRowSource({}, { isScheduledView: true, viewingAccountId: 'userb@v10', activeAccountId: 'userb@v016' }))
      .toEqual({});
  });
});

describe('findDraftIdentityIdForLogin', () => {
  const identities = [
    { id: 'userb@v016::b', email: 'userb@example.org', name: 'userb' },
    { id: 'userb@v10::c', email: 'userb@example.org', name: 'userb' },
    { id: 'userb@v10::b', email: 'team@example.org', name: 'Team' },
  ] as Identity[];

  it('picks the identity of the login the draft lives in when two logins share the address', () => {
    expect(findDraftIdentityIdForLogin(identities, { email: 'userb@example.org', name: 'userb' }, 'userb@v10')).toBe('userb@v10::c');
    expect(findDraftIdentityIdForLogin(identities, { email: 'userb@example.org', name: 'userb' }, 'userb@v016')).toBe('userb@v016::b');
  });

  it('falls back to every login\'s identities', () => {
    expect(findDraftIdentityIdForLogin(identities, { email: 'team@example.org', name: 'Team' }, 'userb@v016')).toBe('userb@v10::b');
    // One account's identities carry no login prefix.
    expect(findDraftIdentityIdForLogin([{ id: 'b', email: 'userb@example.org', name: 'userb' } as Identity], { email: 'userb@example.org' }, 'userb@v016')).toBe('b');
  });
});
