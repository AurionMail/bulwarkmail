import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { finalizeOutgoing, resetSendPipeline, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { registerOrgOutgoing } from '@/lib/org/outgoing';
import { policyForSender } from '@/lib/org/signature-state';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useIdentityStore } from '@/stores/identity-store';
import type { Identity } from '@/lib/jmap/types';

const CONTEXT: OutgoingContext = {
  surface: 'composer',
  to: ['bob@example.com'],
  cc: [],
  bcc: [],
  fromEmail: 'alice@example.org',
  identityId: 'id-alice',
  mode: 'reply',
  plainText: false,
};

const SIGNATURE = { html: '<p><b>{name}</b><br>Phone: {phone}</p>', text: '{name}\nPhone: {phone}', fields: ['phone' as const] };

function setPolicy(options: { locked?: boolean; signature?: typeof SIGNATURE } = {}) {
  const policy: SettingsPolicy = {
    ...DEFAULT_POLICY,
    restrictions: options.locked ? { signature: { locked: true } } : {},
    organisation: { ...DEFAULT_ORGANISATION_POLICY, signature: options.signature ?? SIGNATURE },
  };
  usePolicyStore.setState({ policy, rawPolicy: policy, subject: null });
}

describe('locked organisation signature on send', () => {
  beforeEach(() => {
    resetSendPipeline();
    registerOrgOutgoing();
    useIdentityStore.setState({ identities: [{ id: 'id-alice', name: 'Alice', email: 'alice@example.org', mayDelete: false } as Identity] });
    useSettingsStore.setState({ signatureDetails: { title: '', department: '', phone: '+49 1', mobile: '' }, signatureSeparatorEnabled: true });
    setPolicy({ locked: true });
  });
  afterEach(() => {
    resetSendPipeline();
    usePolicyStore.setState({ policy: DEFAULT_POLICY, rawPolicy: DEFAULT_POLICY });
  });

  it('puts it back once when the user deleted it from an HTML mail', () => {
    const out = finalizeOutgoing({ html: '<div><p>Hi</p></div>', text: 'Hi' }, CONTEXT);
    expect(out.html).toBe('<div><p>Hi</p></div><br><br>-- <br><p><b>Alice</b><br>Phone: +49 1</p>');
    expect(out.text).toBe('Hi\n\n-- \nAlice\nPhone: +49 1');
    // A second pass finds it and adds nothing.
    expect(finalizeOutgoing(out, CONTEXT)).toEqual(out);
  });

  it('puts it back in a plain-text mail', () => {
    const out = finalizeOutgoing({ text: 'Hi' }, { ...CONTEXT, plainText: true });
    expect(out).toEqual({ html: undefined, text: 'Hi\n\n-- \nAlice\nPhone: +49 1' });
  });

  it('leaves a mail that carries it alone', () => {
    const html = '<div><p>Hi</p></div><p data-signature-block="separator">-- </p><div data-signature-block-node=""><p><b>Alice</b><br>Phone: +49 1</p></div>';
    const bodies = { html, text: 'Hi\n\n-- \nAlice\nPhone: +49 1' };
    expect(finalizeOutgoing(bodies, CONTEXT)).toEqual(bodies);
    const text = { text: 'Hi\n\n-- \nAlice\nPhone: +49 1\n\nOn Monday Bob wrote:\n> question' };
    expect(finalizeOutgoing(text, { ...CONTEXT, plainText: true })).toEqual(text);
  });

  it('does not count the copy in the quoted message', () => {
    const html = '<div><p>Hi</p><blockquote><p><b>Alice</b><br>Phone: +49 1</p></blockquote></div>';
    const out = finalizeOutgoing({ html, text: 'Hi\n\n> Alice\n> Phone: +49 1' }, CONTEXT);
    expect(out.html!.split('Phone: +49 1').length - 1).toBe(2);
    expect(out.text.endsWith('-- \nAlice\nPhone: +49 1')).toBe(true);
  });

  it('does nothing when the signature is not locked', () => {
    setPolicy();
    const bodies = { html: '<div><p>Hi</p></div>', text: 'Hi' };
    expect(finalizeOutgoing(bodies, CONTEXT)).toEqual(bodies);
  });
});

describe('policyForSender', () => {
  const raw: SettingsPolicy = {
    ...DEFAULT_POLICY,
    scopes: [
      { id: 'team', label: 'Team', match: { groups: ['team@example.org'] }, policy: { organisation: { signature: { html: 'Team signature' } } } },
      { id: 'sales', label: 'Sales', match: { groups: ['sales@example.org'] }, policy: { organisation: { signature: { html: 'Sales signature' } } } },
    ],
  };
  const subject = { email: 'alice@example.org', groups: ['team@example.org', 'sales@example.org'] };
  const view = {
    policy: resolvePolicy(raw, subject).policy,
    rawPolicy: raw,
    subject,
    resolveFor: (s: typeof subject | null) => resolvePolicy(raw, s).policy,
  };

  it("gives a group's identity that group's scopes, and the user's own identities the account's", () => {
    expect(policyForSender(view, 'TEAM@example.org').organisation?.signature.html).toBe('Team signature');
    expect(policyForSender(view, 'sales@example.org').organisation?.signature.html).toBe('Sales signature');
    // The account matches both groups; the later scope wins for its own addresses.
    expect(policyForSender(view, 'alice@example.org').organisation?.signature.html).toBe('Sales signature');
    expect(policyForSender(view, 'alias@other.test')).toBe(view.policy);
  });
});
