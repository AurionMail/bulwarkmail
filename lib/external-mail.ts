/**
 * Who is outside the organisation, for the "External" sender chip and the
 * confirm before sending outside it (policy.json organisation.externalMail).
 *
 * Internal are the domains of the user's own identities plus the domains
 * the admin lists; a listed domain covers its subdomains (example.com
 * covers eu.example.com). With no internal domain known at all nobody can
 * be told apart, so nothing counts as external.
 *
 * The pure functions take everything as arguments; the `current*` helpers
 * read the active account's effective policy and identities.
 */

import { DEFAULT_ORGANISATION_POLICY, normalizeDomainList, type OrganisationPolicy } from '@/lib/admin/organisation-policy';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';

export type ExternalMailPolicy = OrganisationPolicy['externalMail'];

/** The lowercased domain of an address ("Name <a@b>" or "a@b"); '' without one. */
export function addressDomain(address: string | null | undefined): string {
  const raw = String(address ?? '').trim();
  const bracket = raw.match(/<([^<>]*)>\s*$/);
  const bare = (bracket ? bracket[1] : raw).trim();
  const at = bare.lastIndexOf('@');
  if (at < 0) return '';
  return bare.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '');
}

/** True when `domain` is one of `internal` or a subdomain of one. */
export function domainMatches(domain: string, internal: readonly string[]): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return internal.some((entry) => d === entry || d.endsWith(`.${entry}`));
}

/** The admin's domains plus the domains of the user's identities, normalised and deduplicated. */
export function internalDomains(policyDomains: readonly string[], identityEmails: readonly string[]): string[] {
  const own = identityEmails.map(addressDomain).filter(Boolean);
  return normalizeDomainList([...policyDomains, ...own]) ?? [];
}

/** Whether mail from or to this address leaves the organisation. */
export function isExternalAddress(address: string, internal: readonly string[]): boolean {
  if (internal.length === 0) return false;
  const domain = addressDomain(address);
  return !!domain && !domainMatches(domain, internal);
}

export type RecipientField = 'to' | 'cc' | 'bcc';

export interface ExternalRecipient {
  address: string;
  domain: string;
  field: RecipientField;
}

/**
 * The recipients outside the organisation, each address once (in the first
 * field it appears in). `trusted` is asked for the rest: with "trust
 * contacts" on, an address in the user's contacts doesn't count.
 */
export function externalRecipients(
  recipients: { to: readonly string[]; cc: readonly string[]; bcc: readonly string[] },
  internal: readonly string[],
  trusted?: (address: string) => boolean,
): ExternalRecipient[] {
  const out: ExternalRecipient[] = [];
  const seen = new Set<string>();
  for (const field of ['to', 'cc', 'bcc'] as const) {
    for (const raw of recipients[field]) {
      const address = String(raw ?? '').trim();
      const key = address.toLowerCase();
      if (!address || seen.has(key)) continue;
      seen.add(key);
      if (!isExternalAddress(address, internal)) continue;
      if (trusted?.(key)) continue;
      out.push({ address, domain: addressDomain(address), field });
    }
  }
  return out;
}

/** The sender's domain when it is outside the organisation, else null. */
export function externalSenderDomain(fromEmail: string | null | undefined, internal: readonly string[]): string | null {
  if (!fromEmail || !isExternalAddress(fromEmail, internal)) return null;
  return addressDomain(fromEmail);
}

// ─── The active account ──────────────────────────────────────

/** The externalMail settings of the active account's effective policy. */
export function currentExternalMailPolicy(): ExternalMailPolicy {
  return usePolicyStore.getState().getOrganisation().externalMail ?? DEFAULT_ORGANISATION_POLICY.externalMail;
}

/** Either core switch is on: the label or the recipient warning. */
export function coreExternalWarningsOn(policy: ExternalMailPolicy = currentExternalMailPolicy()): boolean {
  return policy.senderLabel || policy.recipientWarning;
}

/** The internal domains for the active account. */
export function currentInternalDomains(policy: ExternalMailPolicy = currentExternalMailPolicy()): string[] {
  const identities = useAuthStore.getState().identities ?? [];
  return internalDomains(policy.domains, identities.map((identity) => identity.email));
}

/** Lowercased addresses of every loaded contact (all address books). */
export function contactAddresses(): Set<string> {
  const out = new Set<string>();
  for (const contact of useContactStore.getState().contacts) {
    for (const entry of Object.values(contact.emails ?? {})) {
      const address = entry?.address?.trim().toLowerCase();
      if (address) out.add(address);
    }
  }
  return out;
}
