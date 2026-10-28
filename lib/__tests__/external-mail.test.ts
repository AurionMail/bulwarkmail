import { describe, it, expect, beforeEach } from 'vitest';
import {
  addressDomain,
  addressKey,
  contactAddresses,
  activeExternalMailContext,
  contextInternalDomains,
  externalMailContextFor,
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
    useAuthStore.setState({ identities: [], activeAccountId: 'acc-alice' });
    useContactStore.setState({ contacts: [], addressBooks: [], trustedSendersBookId: null });
  });

  it('reads the switches from the effective policy', () => {
    expect(activeExternalMailContext().policy.senderLabel).toBe(false);
    setExternalMail({ senderLabel: true });
    expect(activeExternalMailContext().policy.senderLabel).toBe(true);
  });

  it('combines the policy domains with the identity domains', () => {
    setExternalMail({ domains: ['partner.com'] });
    useAuthStore.setState({ identities: [identity('org-alice@example.org')] });
    expect(contextInternalDomains(activeExternalMailContext())).toEqual(['example.org', 'partner.com']);
  });

  it('resolves another signed-in account with its own scopes and identities', async () => {
    // The raw policy: the label on for everyone, off for org-two.test.
    usePolicyStore.setState({
      rawPolicy: {
        ...DEFAULT_POLICY,
        organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, senderLabel: true } },
        scopes: [{ id: 'two', label: 'Two', match: { domains: ['org-two.test'] }, policy: { organisation: { externalMail: { senderLabel: false } } } }],
      },
    });
    setExternalMail({ senderLabel: true });
    const daveClient = {
      getUsername: () => 'org-dave@org-two.test',
      getSharedAccounts: () => [],
      getAccountInfo: () => null,
      getPrincipalTypes: async () => ({}),
      getIdentities: async () => [identity('org-dave@org-two.test')],
    };
    useAuthStore.setState({
      identities: [identity('org-alice@example.org')],
      getClientForAccount: (id: string) => (id === 'acc-dave' ? daveClient : undefined),
    } as never);
    const dave = await externalMailContextFor('acc-dave');
    expect(dave.policy.senderLabel).toBe(false);
    expect(dave.identityEmails).toEqual(['org-dave@org-two.test']);
    // The active account, and an unknown one, read the stores.
    expect((await externalMailContextFor('acc-alice')).identityEmails).toEqual(['org-alice@example.org']);
    expect((await externalMailContextFor(undefined)).policy.senderLabel).toBe(true);
  });

  it("looks another account up only when the switch can be on for it", async () => {
    const calls = { subject: 0, identities: 0 };
    const eveClient = {
      getUsername: () => { calls.subject++; return 'org-eve@org-three.test'; },
      getSharedAccounts: () => [],
      getAccountInfo: () => null,
      getPrincipalTypes: async () => ({}),
      getIdentities: async () => { calls.identities++; return [identity('org-eve@org-three.test')]; },
    };
    useAuthStore.setState({
      identities: [identity('org-alice@example.org')],
      getClientForAccount: (id: string) => (id === 'acc-eve' ? eveClient : undefined),
    } as never);
    const scope = (externalMail: Record<string, boolean>) => ({ id: 's', label: 'S', match: { domains: ['org-three.test'] }, policy: { organisation: { externalMail } } });

    // Off for Everyone and in every scope: no request at all.
    usePolicyStore.setState({ rawPolicy: { ...DEFAULT_POLICY, scopes: [scope({ recipientWarning: true })] } });
    expect((await externalMailContextFor('acc-eve', 'senderLabel')).policy.senderLabel).toBe(false);
    expect(calls).toEqual({ subject: 0, identities: 0 });

    // On in a scope that doesn't match eve: her subject is needed, her identities aren't.
    usePolicyStore.setState({ rawPolicy: { ...DEFAULT_POLICY, scopes: [{ ...scope({ senderLabel: true }), match: { domains: ['elsewhere.test'] } }] } });
    expect((await externalMailContextFor('acc-eve', 'senderLabel')).identityEmails).toEqual([]);
    expect(calls).toEqual({ subject: 1, identities: 0 });

    // On for her domain: her identities count.
    usePolicyStore.setState({ rawPolicy: { ...DEFAULT_POLICY, scopes: [scope({ senderLabel: true })] } });
    expect((await externalMailContextFor('acc-eve', 'senderLabel')).identityEmails).toEqual(['org-eve@org-three.test']);
    expect(calls.identities).toBe(1);
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
