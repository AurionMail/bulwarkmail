import { useMemo } from 'react';
import type { SettingsPolicy } from '@/lib/admin/types';
import { subjectForAccount, useAccountSubjects } from '@/lib/org/account-subjects';
import { usePolicyStore } from '@/stores/policy-store';

/**
 * The effective policy of a signed-in account: the active account's from
 * the policy store, another account's resolved for its own domain and group
 * scopes (a composer sending from that account). Follows the policy and the
 * account's subject as they load.
 */
export function useAccountPolicy(accountId: string | null | undefined): SettingsPolicy {
  const policy = usePolicyStore((s) => s.policy);
  const rawPolicy = usePolicyStore((s) => s.rawPolicy);
  const subject = usePolicyStore((s) => s.subject);
  const resolveFor = usePolicyStore((s) => s.resolveFor);
  // Re-read when another account's subject has been worked out.
  const accountSubjects = useAccountSubjects((s) => s.subjects);
  return useMemo(() => {
    const accountSubject = subjectForAccount(accountId);
    return accountSubject === subject ? policy : resolveFor(accountSubject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy, rawPolicy, subject, resolveFor, accountId, accountSubjects]);
}
