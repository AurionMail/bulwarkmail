/**
 * The organisation signature and disclaimer for one identity, from the
 * stores: the effective policy, the user's signature details and the
 * company name of the config (per-domain branding applied by /api/config,
 * config.json in Lite). Used by the send finalisers and quick reply, which
 * run outside React; the composer reads the same through
 * hooks/use-org-signature.ts.
 */

import type { Identity } from '@/lib/jmap/types';
import type { SettingsPolicy } from '@/lib/admin/types';
import type { PolicySubject } from '@/lib/admin/policy-scopes';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import {
  buildOrgSignature,
  effectiveSignatureIdentity,
  signatureRestriction,
  signatureValuesFor,
  type FilledSignature,
  type SignatureDetails,
  type SignatureRestriction,
} from '@/lib/org-signature';
import { getCachedConfig } from '@/hooks/use-config';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';

interface PolicyView {
  policy: SettingsPolicy;
  rawPolicy: SettingsPolicy;
  subject: PolicySubject | null;
  resolveFor: (subject: PolicySubject | null) => SettingsPolicy;
}

/**
 * The policy that decides the signature of mail sent from `email`. An
 * identity of a group the user is a member of gets the group's scopes when
 * a group scope names that group; everything else (personal identities, an
 * alias in another domain of the same account) gets the account's.
 */
export function policyForSender(view: PolicyView, email: string | undefined): SettingsPolicy {
  const address = email?.trim().toLowerCase();
  const subject = view.subject;
  if (!address || !subject) return view.policy;
  const isGroup = subject.groups.some((group) => group.toLowerCase() === address);
  if (!isGroup) return view.policy;
  const named = (view.rawPolicy.scopes ?? []).some((scope) =>
    (scope.match.groups ?? []).some((group) => group.toLowerCase() === address));
  if (!named) return view.policy;
  return view.resolveFor({ email: subject.email, groups: [address] });
}

export interface OrgSignatureSetup {
  /** Filled for the sending identity; null when the admin set no signature. */
  signature: FilledSignature | null;
  restriction: SignatureRestriction;
}

/** The organisation signature for mail from `sending`, from the given policy. */
export function orgSignatureSetup(
  policy: SettingsPolicy,
  sending: Pick<Identity, 'name' | 'email'> | null | undefined,
  details: SignatureDetails,
  company: string,
): OrgSignatureSetup {
  const organisation = policy.organisation ?? DEFAULT_ORGANISATION_POLICY;
  return {
    signature: buildOrgSignature(organisation.signature, signatureValuesFor(sending, details, company)),
    restriction: signatureRestriction(policy.restrictions?.signature),
  };
}

export function companyName(): string {
  return getCachedConfig()?.loginCompanyName ?? '';
}

/** The setup for an identity, read from the stores now. */
export function currentOrgSignatureSetup(sending: Pick<Identity, 'name' | 'email'> | null | undefined): OrgSignatureSetup {
  const policy = policyForSender(usePolicyStore.getState(), sending?.email);
  return orgSignatureSetup(policy, sending, useSettingsStore.getState().signatureDetails, companyName());
}

/** effectiveSignatureIdentity with the setup read from the stores now. */
export function currentSignatureIdentity<T extends Identity>(
  own: T | null | undefined,
  sending: T | null | undefined,
): T | null | undefined {
  const setup = currentOrgSignatureSetup(sending ?? own);
  return effectiveSignatureIdentity(own, sending, setup.signature, setup.restriction);
}

/** The disclaimer, filled in for mail from `sending`; null when there is none. */
export function currentDisclaimer(sending: Pick<Identity, 'name' | 'email'> | null | undefined): FilledSignature | null {
  const policy = policyForSender(usePolicyStore.getState(), sending?.email);
  const organisation = policy.organisation ?? DEFAULT_ORGANISATION_POLICY;
  return buildOrgSignature(
    organisation.disclaimer,
    signatureValuesFor(sending, useSettingsStore.getState().signatureDetails, companyName()),
  );
}
