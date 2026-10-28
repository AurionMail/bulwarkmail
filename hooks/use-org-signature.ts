import { useMemo } from 'react';
import type { Identity } from '@/lib/jmap/types';
import { effectiveSignatureIdentity, isSignatureEnforced, type FilledSignature } from '@/lib/org-signature';
import { companyName, orgSignatureSetup, policyForSender, type OrgSignatureSetup } from '@/lib/org/signature-state';
import { subjectForAccount, useAccountSubjects } from '@/lib/org/account-subjects';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';

type Sender = Pick<Identity, 'name' | 'email'> | null | undefined;

function useSenderPolicy(email: string | undefined, accountId: string | null | undefined) {
  const policy = usePolicyStore((s) => s.policy);
  const rawPolicy = usePolicyStore((s) => s.rawPolicy);
  const subject = usePolicyStore((s) => s.subject);
  const resolveFor = usePolicyStore((s) => s.resolveFor);
  // Re-read when another account's subject has been worked out.
  const accountSubjects = useAccountSubjects((s) => s.subjects);
  return useMemo(
    () => policyForSender({ policy, rawPolicy, subject, resolveFor }, email, subjectForAccount(accountId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [policy, rawPolicy, subject, resolveFor, email, accountId, accountSubjects],
  );
}

/**
 * The organisation signature and disclaimer filled in for mail from
 * `sending`, an identity of the signed-in account `accountId` (the active
 * one when left out), and how the signature is restricted.
 */
export function useOrgSignatureSetup(sending: Sender, accountId?: string | null): OrgSignatureSetup {
  const policy = useSenderPolicy(sending?.email, accountId);
  const details = useSettingsStore((s) => s.signatureDetails);
  const company = companyName();
  const name = sending?.name;
  const email = sending?.email;
  return useMemo(
    () => orgSignatureSetup(policy, { name: name ?? '', email: email ?? '' }, details, company),
    [policy, name, email, details, company],
  );
}

/**
 * The composer's signature identity with the organisation signature
 * applied (see effectiveSignatureIdentity), and whether that signature is
 * the admin's locked or hidden one. Plugins come after this
 * (usePluginSignature) and may change an unlocked organisation signature,
 * not a locked one.
 */
export function useOrgSignature<T extends Identity>(
  own: T | null | undefined,
  sending: T | null | undefined,
  accountId?: string | null,
): { identity: T | null | undefined; enforced: boolean } {
  const setup = useOrgSignatureSetup(sending ?? own, accountId);
  return useMemo(() => ({
    identity: effectiveSignatureIdentity(own, sending, setup.signature, setup.restriction),
    enforced: !!setup.signature && isSignatureEnforced(setup.restriction),
  }), [own, sending, setup]);
}

/** useOrgSignature's identity alone. */
export function useOrgSignatureIdentity<T extends Identity>(
  own: T | null | undefined,
  sending: T | null | undefined,
  accountId?: string | null,
): T | null | undefined {
  return useOrgSignature(own, sending, accountId).identity;
}

/** The disclaimer added on send, filled in for mail from `sending`; null when there is none. */
export function useOrgDisclaimer(sending: Sender, accountId?: string | null): FilledSignature | null {
  return useOrgSignatureSetup(sending, accountId).disclaimer;
}
