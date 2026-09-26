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
 * - `source` when the caller knows it: a send undone or a scheduled send
 *   cancelled for editing is back in the account it was sent from;
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
  const mailbox = context.aggregate ? undefined : context.mailbox;
  return {
    localAccountId: context.source?.localAccountId
      ?? draft.sourceClientAccountId
      ?? context.viewingAccountId
      ?? context.activeAccountId
      ?? undefined,
    accountId: context.source?.accountId
      ?? draft.sourceAccountId
      ?? (mailbox?.isShared ? mailbox.accountId : undefined),
  };
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
