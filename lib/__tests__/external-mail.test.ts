import { describe, it, expect, beforeEach } from 'vitest';
import {
  addressDomain,
  addressKey,
  contactAddresses,
  coreExternalWarningsOn,
  currentInternalDomains,
  domainMatches,
  externalRecipients,
  externalSenders,
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
    expect(internalDomains(['me@example.org'], [])).toEqual(['example.org']);
    expect(internalDomains(['me@example.org', 'alias@Example.org'], ['partner.com'])).toEqual(['example.org', 'partner.com']);
  });

  it('keeps the identity domains when the admin list fills the cap', () => {
    const full = Array.from({ length: 500 }, (_, i) => `partner${i}.example`);
    const internal = internalDomains(['me@own.example'], full);
    expect(internal).toHaveLength(500);
    expect(internal[0]).toBe('own.example');
  });
});

describe('IDN domains', () => {
  it('compares Unicode and xn-- forms as the same domain, on both sides', () => {
    // The admin typed it in Unicode, the server delivers xn--.
    const internal = internalDomains([], ['bücher.de']);
    expect(internal).toEqual(['xn--bcher-kva.de']);
    expect(isExternalAddress('anna@xn--bcher-kva.de', internal)).toBe(false);
    expect(isExternalAddress('anna@bücher.de', internal)).toBe(false);
    expect(isExternalAddress('anna@eu.bücher.de', internal)).toBe(false);
    expect(isExternalAddress('anna@buecher.de', internal)).toBe(true);
    // An identity on an IDN domain counts in whichever form the address has.
    expect(isExternalAddress('x@münchen.example', internalDomains(['me@xn--mnchen-3ya.example'], []))).toBe(false);
  });

  it('matches a contact written in Unicode against an xn-- recipient', () => {
    expect(addressKey('Anna@Bücher.de')).toBe(addressKey('anna@xn--bcher-kva.de'));
  });
});

describe('isExternalAddress', () => {
  const internal = internalDomains(['me@example.org'], ['partner.com']);
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

describe('externalSenders', () => {
  const internal = ['example.org'];
  it('names the external senders and nothing for internal ones', () => {
    expect(externalSenders([{ email: 'dave@org-two.test' }], internal)).toEqual([{ address: 'dave@org-two.test', domain: 'org-two.test' }]);
    expect(externalSenders([{ email: 'bob@example.org' }], internal)).toEqual([]);
    expect(externalSenders(undefined, internal)).toEqual([]);
  });

  it('counts a message as external when any of several From addresses is', () => {
    expect(externalSenders([{ email: 'bob@example.org' }, { email: 'eve@evil.example' }], internal))
      .toEqual([{ address: 'eve@evil.example', domain: 'evil.example' }]);
  });

  it('counts a From without a domain as external', () => {
    expect(externalSenders([{ email: 'ceo' }], internal)).toEqual([{ address: 'ceo', domain: '' }]);
  });

  it('calls nobody external when no internal domain is known', () => {
    expect(externalSenders([{ email: 'ceo' }, { email: 'dave@org-two.test' }], [])).toEqual([]);
  });
});

describe('the active account', () => {
  beforeEach(() => {
    setExternalMail({});
    useAuthStore.setState({ identities: [] });
    useContactStore.setState({ contacts: [], addressBooks: [], trustedSendersBookId: null });
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
    expect(currentInternalDomains()).toEqual(['example.org', 'partner.com']);
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

  it('leaves out cards that are only in the Trusted Senders book', () => {
    useContactStore.setState({
      addressBooks: [
        { id: 'book-main', name: 'Contacts' },
        { id: 'acc1::book-trusted', name: 'Trusted Senders' },
      ] as never,
      trustedSendersBookId: 'book-trusted-raw',
      contacts: [
        // Only "always load images" for this sender: not a contact.
        { id: 'c1', addressBookIds: { 'acc1::book-trusted': true }, emails: { e: { address: 'newsletter@shop.example' } } },
        { id: 'c2', addressBookIds: { 'book-trusted-raw': true }, emails: { e: { address: 'promo@shop.example' } } },
        // In a real book too: a contact.
        { id: 'c3', addressBookIds: { 'book-main': true, 'acc1::book-trusted': true }, emails: { e: { address: 'dave@org-two.test' } } },
        { id: 'c4', addressBookIds: { 'book-main': true }, emails: { e: { address: 'carol@partner.example' } } },
      ] as unknown as ContactCard[],
    });
    expect([...contactAddresses()].sort()).toEqual(['carol@partner.example', 'dave@org-two.test']);
  });
});
