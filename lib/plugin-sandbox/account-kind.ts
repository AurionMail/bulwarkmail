// What kind of mail account a message or folder belongs to, for plugins: the
// user's own, a group account (a team mailbox the user is a member of) or a
// mailbox another user shared.
//
// Plugins only hear "group" for accounts the server confirmed are group
// principals (Principal/get type "group"; Stalwart uses the account id as
// the principal id and answers for the user's own groups even with
// directory queries off). The policy subject also counts every non-personal
// account as a group when the server won't say, which is right for the
// admin's group scopes but would let a plugin treat a mailbox one person
// shared like a team mailbox. So the confirmed list is kept here, apart,
// and an account whose type isn't known is "shared".

import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

export type MailAccountKind = 'personal' | 'group' | 'shared';

export const MAIL_ACCOUNT_KINDS: readonly MailAccountKind[] = ['personal', 'group', 'shared'];

type KindClient = Pick<IJMAPClient, 'getAccountId'>
  & Partial<Pick<IJMAPClient, 'getAccountInfo' | 'getSharedAccounts' | 'getPrincipalTypes'>>;

interface ConfirmedGroupsState {
  /** Per client: the ids of its accounts the server confirmed are groups. */
  groups: WeakMap<object, ReadonlySet<string>>;
  /** Moves on whenever a client's list arrives, for subscribers. */
  revision: number;
}

export const useConfirmedGroups = create<ConfirmedGroupsState>()(() => ({ groups: new WeakMap(), revision: 0 }));

const pending = new WeakMap<object, Promise<ReadonlySet<string>>>();
const failedAt = new WeakMap<object, number>();
/** A failed lookup is tried again after this long, not on every render. */
export const CONFIRM_RETRY_MS = 60_000;

/** The non-personal accounts of a client's session. */
function sharedAccountIds(client: KindClient): string[] {
  const own = client.getAccountId();
  const accounts = typeof client.getSharedAccounts === 'function' ? client.getSharedAccounts() : [];
  return accounts
    .filter((a) => a.id !== own && client.getAccountInfo?.(a.id)?.isPersonal !== true)
    .map((a) => a.id);
}

/**
 * Asks the server once per client which of its accounts are groups. A
 * failed or missing lookup confirms none, and is asked again a minute later.
 */
export function confirmGroups(client: KindClient): Promise<ReadonlySet<string>> {
  const known = useConfirmedGroups.getState().groups.get(client);
  if (known) return Promise.resolve(known);
  const running = pending.get(client);
  if (running) return running;
  const failed = failedAt.get(client);
  if (failed !== undefined && Date.now() - failed < CONFIRM_RETRY_MS) return Promise.resolve(new Set());
  const ids = sharedAccountIds(client);
  const lookup = (async () => {
    let confirmed: ReadonlySet<string> = new Set();
    let answered = ids.length === 0;
    if (ids.length > 0 && typeof client.getPrincipalTypes === 'function') {
      const types = await client.getPrincipalTypes(ids).catch(() => null);
      if (types) {
        answered = true;
        confirmed = new Set(ids.filter((id) => types[id] === 'group'));
      }
    }
    if (!answered) failedAt.set(client, Date.now());
    if (answered) {
      useConfirmedGroups.setState((state) => {
        state.groups.set(client, confirmed);
        return { groups: state.groups, revision: state.revision + 1 };
      });
    }
    return confirmed;
  })().finally(() => pending.delete(client));
  pending.set(client, lookup);
  return lookup;
}

/**
 * The kind of the JMAP account `accountId` reached through `client`. No
 * account, or the client's own, is personal. A group needs the server's
 * word; until it is in (this starts the lookup), or when the lookup
 * failed, the account is shared.
 */
export function mailAccountKind(client: KindClient | null | undefined, accountId: string | null | undefined): MailAccountKind {
  if (!client || !accountId || accountId === client.getAccountId()) return 'personal';
  const info = typeof client.getAccountInfo === 'function' ? client.getAccountInfo(accountId) : null;
  if (info?.isPersonal) return 'personal';
  const confirmed = useConfirmedGroups.getState().groups.get(client);
  if (!confirmed) {
    void confirmGroups(client);
    return 'shared';
  }
  return confirmed.has(accountId) ? 'group' : 'shared';
}

/** For tests: forget every confirmed list. */
export function resetConfirmedGroups(): void {
  useConfirmedGroups.setState({ groups: new WeakMap(), revision: 0 });
}
