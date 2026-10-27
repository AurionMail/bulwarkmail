import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { PolicySubject } from './policy-scopes';

type SubjectClient = Pick<IJMAPClient, 'getUsername' | 'getSharedAccounts' | 'getAccountInfo' | 'getPrincipalTypes'>;

/**
 * Who a signed-in client is for the domain and group scopes: its login
 * address and the addresses of the group accounts in its session. Stalwart
 * names group accounts by their address (local-data/org-features-facts.md
 * §1). A mailbox another user shared is also a non-personal account, so the
 * principal type decides; when the server won't say, every non-personal
 * account counts, which only matters if an admin put a person's address in a
 * group scope.
 */
export async function policySubjectForClient(client: SubjectClient | null): Promise<PolicySubject | null> {
  if (!client) return null;
  const email = client.getUsername()?.trim().toLowerCase() ?? '';
  if (!email) return null;
  const shared = client.getSharedAccounts()
    .filter((account) => !account.isPrimary && client.getAccountInfo(account.id)?.isPersonal === false)
    .filter((account) => account.name.includes('@'));
  const types = shared.length > 0 && client.getPrincipalTypes
    ? await client.getPrincipalTypes(shared.map((account) => account.id))
    : null;
  const groups = shared
    .filter((account) => !types || types[account.id] === 'group')
    .map((account) => account.name.trim().toLowerCase())
    .sort();
  return { email, groups };
}
