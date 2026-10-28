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
import { subjectForAccount } from '@/lib/org/account-subjects';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';

export interface PolicyView {
  policy: SettingsPolicy;
  rawPolicy: SettingsPolicy;
  subject: PolicySubject | null;
  resolveFor: (subject: PolicySubject | null) => SettingsPolicy;
}

/**
 * The policy that decides the signature of mail sent from `email` by the
 * account `subject` (the active account's when left out). An identity of a
 * group the account is a member of gets the group's scopes when a group
 * scope names that group; everything else (personal identities, an alias in
 * another domain of the same account) gets the account's.
 */
export function policyForSender(
  view: PolicyView,
  email: string | undefined,
  subject: PolicySubject | null = view.subject,
): SettingsPolicy {
  const accountPolicy = subject === view.subject ? view.policy : view.resolveFor(subject);
  const address = email?.trim().toLowerCase();
  if (!address || !subject) return accountPolicy;
  const isGroup = subject.groups.some((group) => group.toLowerCase() === address);
  if (!isGroup) return accountPolicy;
  const named = (view.rawPolicy.scopes ?? []).some((scope) =>
    (scope.match.groups ?? []).some((group) => group.toLowerCase() === address));
  if (!named) return accountPolicy;
  return view.resolveFor({ email: subject.email, groups: [address] });
}

export interface OrgSignatureSetup {
  /** Filled for the sending identity; null when the admin set no signature. */
  signature: FilledSignature | null;
  /** The disclaimer, filled the same way; null when the admin set none. */
  disclaimer: FilledSignature | null;
  restriction: SignatureRestriction;
}

/** The organisation signature and disclaimer for mail from `sending`, from the given policy. */
export function orgSignatureSetup(
  policy: SettingsPolicy,
  sending: Pick<Identity, 'name' | 'email'> | null | undefined,
  details: SignatureDetails | null | undefined,
  company: string,
): OrgSignatureSetup {
  const organisation = policy.organisation ?? DEFAULT_ORGANISATION_POLICY;
  const values = signatureValuesFor(sending, details, company);
  return {
    signature: buildOrgSignature(organisation.signature, values),
    disclaimer: buildOrgSignature(organisation.disclaimer, values),
    restriction: signatureRestriction(policy.restrictions?.signature),
  };
}

export function companyName(): string {
  return getCachedConfig()?.loginCompanyName ?? '';
}

/**
 * The setup for an identity of the signed-in account `accountId` (the
 * active one when left out), read from the stores now.
 */
export function currentOrgSignatureSetup(
  sending: Pick<Identity, 'name' | 'email'> | null | undefined,
  accountId?: string | null,
): OrgSignatureSetup {
  const policy = policyForSender(usePolicyStore.getState(), sending?.email, subjectForAccount(accountId));
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
