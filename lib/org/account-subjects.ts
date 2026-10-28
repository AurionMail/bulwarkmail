/**
 * Who each signed-in account is for the domain and group scopes, so a
 * message written from another account than the active one (the composer
 * of an account the user switched away from, an identity of another
 * account in the From list) gets that account's organisation signature and
 * disclaimer. The active account's subject is the policy store's; the
 * others are worked out here once per account, the same way
 * (policySubjectForClient), and kept until the account's client changes.
 */

import { create } from 'zustand';
import type { PolicySubject } from '@/lib/admin/policy-scopes';
import { policySubjectForClient } from '@/lib/admin/policy-subject';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';

interface AccountSubjectsState {
  /** Resolved subjects by local account id. */
  subjects: Record<string, PolicySubject>;
}

export const useAccountSubjects = create<AccountSubjectsState>()(() => ({ subjects: {} }));

const pending = new Map<string, unknown>();

type SubjectSource = Parameters<typeof policySubjectForClient>[0];

/** Starts working out an account's subject, once per client. */
function resolveSubject(accountId: string, client: NonNullable<SubjectSource>): void {
  if (pending.get(accountId) === client) return;
  pending.set(accountId, client);
  void policySubjectForClient(client).then((subject) => {
    if (pending.get(accountId) !== client || !subject) return;
    useAccountSubjects.setState((state) => ({ subjects: { ...state.subjects, [accountId]: subject } }));
  }).catch(() => {});
}

/**
 * The subject of a signed-in account: the policy store's for the active
 * account (or when no account is named), otherwise the one worked out
 * here. Until that is done, the account's address with no groups, so its
 * domain scopes apply at once and group scopes follow.
 */
export function subjectForAccount(accountId: string | null | undefined): PolicySubject | null {
  const auth = useAuthStore.getState();
  const policySubject = usePolicyStore.getState().subject;
  if (!accountId || accountId === auth.activeAccountId) return policySubject;
  const client = auth.getClientForAccount?.(accountId);
  if (!client) return policySubject;
  const known = useAccountSubjects.getState().subjects[accountId];
  resolveSubject(accountId, client as unknown as NonNullable<SubjectSource>);
  if (known) return known;
  const email = typeof client.getUsername === 'function' ? client.getUsername()?.trim().toLowerCase() : '';
  return email ? { email, groups: [] } : policySubject;
}

/** For tests: forget every subject worked out. */
export function resetAccountSubjects(): void {
  pending.clear();
  useAccountSubjects.setState({ subjects: {} });
}
