import { useMemo } from 'react';
import type { Identity } from '@/lib/jmap/types';
import { effectiveSignatureIdentity, type FilledSignature } from '@/lib/org-signature';
import { companyName, orgSignatureSetup, policyForSender, type OrgSignatureSetup } from '@/lib/org/signature-state';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';

type Sender = Pick<Identity, 'name' | 'email'> | null | undefined;

function useSenderPolicy(email: string | undefined) {
  const policy = usePolicyStore((s) => s.policy);
  const rawPolicy = usePolicyStore((s) => s.rawPolicy);
  const subject = usePolicyStore((s) => s.subject);
  const resolveFor = usePolicyStore((s) => s.resolveFor);
  return useMemo(
    () => policyForSender({ policy, rawPolicy, subject, resolveFor }, email),
    [policy, rawPolicy, subject, resolveFor, email],
  );
}

/** The organisation signature and disclaimer filled in for mail from `sending`, and how the signature is restricted. */
export function useOrgSignatureSetup(sending: Sender): OrgSignatureSetup {
  const policy = useSenderPolicy(sending?.email);
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
 * applied (see effectiveSignatureIdentity). Plugins come after this
 * (usePluginSignature), so they see the organisation signature too.
 */
export function useOrgSignatureIdentity<T extends Identity>(
  own: T | null | undefined,
  sending: T | null | undefined,
): T | null | undefined {
  const setup = useOrgSignatureSetup(sending ?? own);
  return useMemo(
    () => effectiveSignatureIdentity(own, sending, setup.signature, setup.restriction),
    [own, sending, setup],
  );
}

/** The disclaimer added on send, filled in for mail from `sending`; null when there is none. */
export function useOrgDisclaimer(sending: Sender): FilledSignature | null {
  return useOrgSignatureSetup(sending).disclaimer;
}
