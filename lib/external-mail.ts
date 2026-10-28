/**
 * Who is outside the organisation, for the "External" sender chip and the
 * confirm before sending outside it (policy.json organisation.externalMail).
 *
 * Internal are the domains of the user's own identities plus the domains
 * the admin lists; a listed domain covers its subdomains (example.com
 * covers eu.example.com). With no internal domain known at all nobody can
 * be told apart, so nothing counts as external.
 *
 * Domains are compared in ASCII (punycode) form on both sides, so an IDN
 * the admin typed in Unicode matches the xn-- form a server delivers.
 *
 * The pure functions take everything as arguments; the `current*` helpers
 * read the active account's effective policy and identities.
 */

import { DEFAULT_ORGANISATION_POLICY, normalizeDomainList, type OrganisationPolicy } from '@/lib/admin/organisation-policy';
import { toAsciiDomain, toAsciiEmail } from '@/lib/idn';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';

export type ExternalMailPolicy = OrganisationPolicy['externalMail'];

/** The bare address of "Name <a@b>" or "a@b". */
function bareAddress(address: string | null | undefined): string {
  const raw = String(address ?? '').trim();
  const bracket = raw.match(/<([^<>]*)>\s*$/);
  return (bracket ? bracket[1] : raw).trim();
}

/** The domain of an address in lowercased ASCII form; '' without a usable one. */
export function addressDomain(address: string | null | undefined): string {
  const bare = bareAddress(address);
  const at = bare.lastIndexOf('@');
  if (at < 0) return '';
  const domain = bare.slice(at + 1).trim().replace(/\.+$/, '');
  return (domain && toAsciiDomain(domain)) || '';
}

/** The address as a lookup key: the domain in ASCII form, all lowercased. */
export function addressKey(address: string): string {
  return toAsciiEmail(bareAddress(address)).toLowerCase();
}

/** True when `domain` (ASCII) is one of `internal` or a subdomain of one. */
export function domainMatches(domain: string, internal: readonly string[]): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return internal.some((entry) => d === entry || d.endsWith(`.${entry}`));
}

/**
 * The domains of the user's identities, then the admin's, in ASCII form and
 * deduplicated. The identity domains come first so the list's size cap never
 * cuts them.
 */
export function internalDomains(identityEmails: readonly string[], policyDomains: readonly string[]): string[] {
  const own = identityEmails.map(addressDomain).filter(Boolean);
  return normalizeDomainList([...own, ...policyDomains]) ?? [];
}

/** Whether mail to this address leaves the organisation. An address without a domain isn't sendable and isn't counted. */
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
 * field it appears in). `trusted` is asked for the rest, with the address as
 * addressKey makes it: with "trust contacts" on, a contact doesn't count.
 */
export function externalRecipients(
  recipients: { to: readonly string[]; cc: readonly string[]; bcc: readonly string[] },
  internal: readonly string[],
  trusted?: (key: string) => boolean,
): ExternalRecipient[] {
  const out: ExternalRecipient[] = [];
  const seen = new Set<string>();
  for (const field of ['to', 'cc', 'bcc'] as const) {
    for (const raw of recipients[field]) {
      const address = String(raw ?? '').trim();
      const key = addressKey(address);
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
  return internalDomains(identities.map((identity) => identity.email), policy.domains);
}

/** The addresses of every loaded contact (all address books), as addressKey makes them. */
export function contactAddresses(): Set<string> {
  const out = new Set<string>();
  for (const contact of useContactStore.getState().contacts) {
    for (const entry of Object.values(contact.emails ?? {})) {
      const address = entry?.address?.trim();
      if (address) out.add(addressKey(address));
    }
  }
  return out;
}
