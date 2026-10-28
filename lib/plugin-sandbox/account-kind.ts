// What kind of mail account a message or folder belongs to, for plugins: the
// user's own, a group account (a team mailbox the user is a member of) or a
// mailbox another user shared. Stalwart names a group account by the group's
// address, and the policy subject already lists the addresses of the user's
// group accounts, checked against the principal type (lib/admin/policy-subject.ts).

import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { subjectForAccount } from '@/lib/org/account-subjects';

export type MailAccountKind = 'personal' | 'group' | 'shared';

export const MAIL_ACCOUNT_KINDS: readonly MailAccountKind[] = ['personal', 'group', 'shared'];

type KindClient = Pick<IJMAPClient, 'getAccountId'> & Partial<Pick<IJMAPClient, 'getAccountInfo'>>;

/**
 * The kind of the JMAP account `accountId` reached through `client`, the
 * client of the login `loginId` (the active login when not given). No
 * account, or the login's own, is personal. Until the login's group list has
 * loaded, a group account counts as shared.
 */
export function mailAccountKind(client: KindClient | null | undefined, accountId: string | null | undefined, loginId?: string | null): MailAccountKind {
  if (!client || !accountId || accountId === client.getAccountId()) return 'personal';
  const info = typeof client.getAccountInfo === 'function' ? client.getAccountInfo(accountId) : null;
  if (!info) return 'shared';
  if (info.isPersonal) return 'personal';
  const name = info.name.trim().toLowerCase();
  const groups = subjectForAccount(loginId)?.groups ?? [];
  return name && groups.includes(name) ? 'group' : 'shared';
}
