import { describe, it, expect, beforeEach } from 'vitest';
import {
  addressDomain,
  contactAddresses,
  coreExternalWarningsOn,
  currentInternalDomains,
  domainMatches,
  externalRecipients,
  externalSenderDomain,
  internalDomains,
  isExternalAddress,
} from '../external-mail';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import type { ContactCard, Identity } from '@/lib/jmap/types';

const identity = (email: string) => ({ id: email, name: '', email }) as unknown as Identity;

function setExternalMail(patch: Partial<typeof DEFAULT_ORGANISATION_POLICY.externalMail>) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, ...patch } },
    },
  });
}

describe('addressDomain', () => {
  it('takes the domain of bare and named addresses, lowercased', () => {
    expect(addressDomain('Bob@Example.COM')).toBe('example.com');
    expect(addressDomain('Bob <bob@eu.example.com>')).toBe('eu.example.com');
    expect(addressDomain('no-at-sign')).toBe('');
    expect(addressDomain(undefined)).toBe('');
  });
});

describe('domainMatches', () => {
  it('matches the domain itself and its subdomains, nothing else', () => {
    expect(domainMatches('example.com', ['example.com'])).toBe(true);
    expect(domainMatches('eu.example.com', ['example.com'])).toBe(true);
    expect(domainMatches('a.b.example.com', ['example.com'])).toBe(true);
    // A suffix that isn't a subdomain doesn't count.
    expect(domainMatches('badexample.com', ['example.com'])).toBe(false);
    expect(domainMatches('example.com.evil.net', ['example.com'])).toBe(false);
    // A subdomain in the list doesn't cover its parent.
    expect(domainMatches('example.com', ['eu.example.com'])).toBe(false);
  });
});

describe('internalDomains', () => {
  it('always counts the identity domains and adds the admin list', () => {
    expect(internalDomains([], ['me@example.org'])).toEqual(['example.org']);
    expect(internalDomains(['partner.com'], ['me@example.org', 'alias@Example.org'])).toEqual(['partner.com', 'example.org']);
  });
});

describe('isExternalAddress', () => {
  const internal = internalDomains(['partner.com'], ['me@example.org']);
  it('is external only outside the identity domains and the list, subdomains included', () => {
    expect(isExternalAddress('bob@example.org', internal)).toBe(false);
    expect(isExternalAddress('x@eu.partner.com', internal)).toBe(false);
    expect(isExternalAddress('dave@org-two.test', internal)).toBe(true);
  });
  it('calls nobody external when no internal domain is known', () => {
    expect(isExternalAddress('dave@org-two.test', [])).toBe(false);
  });
});

describe('externalRecipients', () => {
  const internal = ['example.org'];
  it('lists only the external recipients, each once, with the field it is in', () => {
    const result = externalRecipients(
      { to: ['bob@example.org', 'dave@org-two.test'], cc: ['DAVE@org-two.test', 'eve@other.net'], bcc: ['x@sub.example.org'] },
      internal,
    );
    expect(result).toEqual([
      { address: 'dave@org-two.test', domain: 'org-two.test', field: 'to' },
      { address: 'eve@other.net', domain: 'other.net', field: 'cc' },
    ]);
  });
  it('leaves out trusted addresses (contacts)', () => {
    const trusted = new Set(['dave@org-two.test']);
    const result = externalRecipients({ to: ['Dave@org-two.test', 'eve@other.net'], cc: [], bcc: [] }, internal, (a) => trusted.has(a));
    expect(result.map((r) => r.address)).toEqual(['eve@other.net']);
  });
});

describe('externalSenderDomain', () => {
  it('names the domain of an external sender and nothing for internal ones', () => {
    expect(externalSenderDomain('dave@org-two.test', ['example.org'])).toBe('org-two.test');
    expect(externalSenderDomain('bob@example.org', ['example.org'])).toBeNull();
    expect(externalSenderDomain(undefined, ['example.org'])).toBeNull();
  });
});

describe('the active account', () => {
  beforeEach(() => {
    setExternalMail({});
    useAuthStore.setState({ identities: [] });
    useContactStore.setState({ contacts: [] });
  });

  it('reads the switches from the effective policy', () => {
    expect(coreExternalWarningsOn()).toBe(false);
    setExternalMail({ senderLabel: true });
    expect(coreExternalWarningsOn()).toBe(true);
    setExternalMail({ recipientWarning: true });
    expect(coreExternalWarningsOn()).toBe(true);
  });

  it('combines the policy domains with the identity domains', () => {
    setExternalMail({ domains: ['partner.com'] });
    useAuthStore.setState({ identities: [identity('org-alice@example.org')] });
    expect(currentInternalDomains()).toEqual(['partner.com', 'example.org']);
  });

  it('collects the addresses of every contact', () => {
    useContactStore.setState({
      contacts: [
        { id: 'c1', emails: { e1: { address: 'Dave@org-two.test' }, e2: { address: 'second@x.test' } } },
        { id: 'c2' },
      ] as unknown as ContactCard[],
    });
    expect([...contactAddresses()].sort()).toEqual(['dave@org-two.test', 'second@x.test']);
  });
});
