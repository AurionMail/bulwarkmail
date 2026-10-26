import type { Email, Identity, Mailbox } from '@/lib/jmap/types';
import { findDraftIdentityId } from '@/lib/reply-identity';
import { stripCrossAccountIdentityPrefix } from '@/hooks/use-pro-multi-account-identities';

/**
 * Where a draft opened for editing lives: the connected account (login) that
 * reaches it, and the JMAP account there when it is not that login's own. The
 * composer removes the old version there when it saves, sends or discards the
 * draft. Email and account ids repeat across accounts and servers, so any
 * other login or account may hold an unrelated message under the same id.
 */
export interface DraftSource {
  localAccountId?: string;
  accountId?: string;
}

/**
 * The DraftSource of `draft`, a message of the list on screen:
 * - `source` as it is when the caller knows it: a send undone or a scheduled
 *   send cancelled for editing is back in the account it was sent from, put
 *   there through the login `source` names (none: the composing one). What is
 *   on screen says nothing about it: Scheduled lists the active login's mail
 *   while a login browsed before still counts as viewed;
 * - in a list that mixes accounts (the unified views, a tag view, an "All
 *   folders" search) the login and account the message is stamped with. The
 *   folder still selected underneath a tag view or a search says nothing
 *   about it;
 * - otherwise the list's: the viewed login (Pro multi-account sidebar) or the
 *   active one, and for a shared or group folder the folder's account.
 */
export function resolveDraftSource(
  draft: Pick<Email, 'sourceClientAccountId' | 'sourceAccountId'>,
  context: {
    source?: DraftSource;
    aggregate: boolean;
    mailbox?: Pick<Mailbox, 'isShared' | 'accountId'>;
    viewingAccountId?: string | null;
    activeAccountId?: string | null;
  },
): DraftSource {
  if (context.source) {
    return { localAccountId: context.source.localAccountId, accountId: context.source.accountId };
  }
  const mailbox = context.aggregate ? undefined : context.mailbox;
  return {
    localAccountId: draft.sourceClientAccountId
      ?? context.viewingAccountId
      ?? context.activeAccountId
      ?? undefined,
    accountId: draft.sourceAccountId
      ?? (mailbox?.isShared ? mailbox.accountId : undefined),
  };
}

/**
 * Where a row of the mail list was listed from, for a view that reads it
 * again on its own (a Pro email tab): the login and account the row is
 * stamped with in a list that mixes accounts, else the login browsed - the
 * active one when no other is - and `list.accountId`, the account the list
 * shows (a shared or group folder's). Nothing for a row of Scheduled: that
 * list is the active login's, whatever login was browsed before.
 */
export function listRowSource(
  row: Pick<Email, 'sourceClientAccountId' | 'sourceAccountId'>,
  list: {
    isScheduledView: boolean;
    viewingAccountId?: string | null;
    activeAccountId?: string | null;
    accountId?: string;
  },
): DraftSource {
  if (row.sourceClientAccountId && row.sourceAccountId) {
    return { localAccountId: row.sourceClientAccountId, accountId: row.sourceAccountId };
  }
  if (list.isScheduledView) return {};
  return { localAccountId: list.viewingAccountId ?? list.activeAccountId ?? undefined, accountId: list.accountId };
}

/**
 * The identity to reopen a draft with (findDraftIdentityId), taken from the
 * identities of the login the draft lives in first: two logins can share an
 * address - the same user on two servers - and the other one's identity
 * would move the draft to its server on the first save.
 */
export function findDraftIdentityIdForLogin(
  identities: Identity[],
  from: { email?: string | null; name?: string | null } | null | undefined,
  localAccountId: string | undefined,
): string | null {
  if (localAccountId) {
    const ofLogin = identities.filter((identity) => stripCrossAccountIdentityPrefix(identity.id).localAccountId === localAccountId);
    const match = findDraftIdentityId(ofLogin, from);
    if (match) return match;
  }
  return findDraftIdentityId(identities, from);
}
