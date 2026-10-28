import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { finalizeOutgoing, resetSendPipeline, type OutgoingBodies, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { registerOrgOutgoing } from '@/lib/org/outgoing';
import { policyForSender } from '@/lib/org/signature-state';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useIdentityStore } from '@/stores/identity-store';
import type { Identity } from '@/lib/jmap/types';

/** Both finaliser stages, as a send without plugins runs them. */
const finalizeAll = (bodies: OutgoingBodies, context: OutgoingContext) =>
  finalizeOutgoing(finalizeOutgoing(bodies, context), context, 'last');

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
    const out = finalizeAll({ html: '<div><p>Hi</p></div>', text: 'Hi' }, CONTEXT);
    expect(out.html).toBe('<div><p>Hi</p></div><br><br>-- <br><p><b>Alice</b><br>Phone: +49 1</p>');
    expect(out.text).toBe('Hi\n\n-- \nAlice\nPhone: +49 1');
    // A second pass finds it and adds nothing.
    expect(finalizeAll(out, CONTEXT)).toEqual(out);
  });

  it('puts it back in a plain-text mail', () => {
    const out = finalizeAll({ text: 'Hi' }, { ...CONTEXT, plainText: true });
    expect(out).toEqual({ html: undefined, text: 'Hi\n\n-- \nAlice\nPhone: +49 1' });
  });

  it('leaves a mail that carries it alone', () => {
    const html = '<div><p>Hi</p></div><p data-signature-block="separator">-- </p><div data-signature-block-node=""><p><b>Alice</b><br>Phone: +49 1</p></div>';
    const bodies = { html, text: 'Hi\n\n-- \nAlice\nPhone: +49 1' };
    expect(finalizeAll(bodies, CONTEXT)).toEqual(bodies);
    const text = { text: 'Hi\n\n-- \nAlice\nPhone: +49 1\n\nOn Monday Bob wrote:\n> question' };
    expect(finalizeAll(text, { ...CONTEXT, plainText: true })).toEqual(text);
  });

  it('does not count the copy in the quoted message', () => {
    const html = '<div><p>Hi</p><blockquote><p><b>Alice</b><br>Phone: +49 1</p></blockquote></div>';
    const out = finalizeAll({ html, text: 'Hi\n\n> Alice\n> Phone: +49 1' }, CONTEXT);
    expect(out.html!.split('Phone: +49 1').length - 1).toBe(2);
    expect(out.text.endsWith('-- \nAlice\nPhone: +49 1')).toBe(true);
  });

  it('does nothing when the signature is not locked', () => {
    setPolicy();
    const bodies = { html: '<div><p>Hi</p></div>', text: 'Hi' };
    expect(finalizeAll(bodies, CONTEXT)).toEqual(bodies);
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

describe('disclaimer on send', () => {
  function setDisclaimer(disclaimer: { html: string; text: string }) {
    const policy: SettingsPolicy = { ...DEFAULT_POLICY, organisation: { ...DEFAULT_ORGANISATION_POLICY, disclaimer } };
    usePolicyStore.setState({ policy, rawPolicy: policy, subject: null });
  }

  beforeEach(() => {
    resetSendPipeline();
    registerOrgOutgoing();
    useIdentityStore.setState({ identities: [{ id: 'id-alice', name: 'Alice', email: 'alice@example.org', mayDelete: false } as Identity] });
  });
  afterEach(() => {
    resetSendPipeline();
    usePolicyStore.setState({ policy: DEFAULT_POLICY, rawPolicy: DEFAULT_POLICY });
  });

  it('goes below everything: a line and the HTML, a blank line and the text', () => {
    setDisclaimer({ html: '<p>Confidential <b>{domain}</b></p>', text: 'Confidential {domain}' });
    const out = finalizeAll({ html: '<div><p>Hi</p><blockquote>quote</blockquote></div>', text: 'Hi\n\n> quote\n' }, CONTEXT);
    expect(out.html).toBe('<div><p>Hi</p><blockquote>quote</blockquote></div><hr><div data-org-disclaimer=""><p>Confidential <b>example.org</b></p></div>');
    expect(out.text).toBe('Hi\n\n> quote\n\nConfidential example.org');
  });

  it('makes the text from the HTML when there is none, and only text for a plain-text mail', () => {
    setDisclaimer({ html: '<p>Line one</p><p>Line two</p>', text: '' });
    expect(finalizeAll({ html: '<div>Hi</div>', text: 'Hi' }, CONTEXT).text).toBe('Hi\n\nLine one\nLine two');
    expect(finalizeAll({ text: 'Hi' }, { ...CONTEXT, plainText: true })).toEqual({ html: undefined, text: 'Hi\n\nLine one\nLine two' });
  });

  it('is added once: not again to a body that ends with it, but also to a reply quoting it', () => {
    setDisclaimer({ html: '', text: 'Confidential.' });
    const once = finalizeAll({ html: '<div>Hi</div>', text: 'Hi' }, CONTEXT);
    expect(once.html).toBe('<div>Hi</div><hr><div data-org-disclaimer="">Confidential.</div>');
    expect(finalizeAll(once, CONTEXT)).toEqual(once);
    const reply = finalizeAll({ text: 'Thanks\n\n> Hi\n>\n> Confidential.' }, { ...CONTEXT, plainText: true });
    expect(reply.text).toBe('Thanks\n\n> Hi\n>\n> Confidential.\n\nConfidential.');
    // An HTML reply's text part carries the quote without "> ".
    const htmlReply = finalizeAll({ html: '<div><p>Thanks</p><blockquote><p>Hi</p><p>Confidential.</p></blockquote></div>', text: 'Thanks\n\nHi\n\nConfidential.' }, CONTEXT);
    expect(htmlReply.html!.split('Confidential.').length - 1).toBe(2);
    expect(htmlReply.text).toBe('Thanks\n\nHi\n\nConfidential.\n\nConfidential.');
  });

  it('comes after a locked signature that was put back', () => {
    const policy: SettingsPolicy = {
      ...DEFAULT_POLICY,
      restrictions: { signature: { locked: true } },
      organisation: { ...DEFAULT_ORGANISATION_POLICY, signature: { html: '', text: 'Sig {name}', fields: [] }, disclaimer: { html: '', text: 'Disclaimer' } },
    };
    usePolicyStore.setState({ policy, rawPolicy: policy, subject: null });
    const out = finalizeAll({ text: 'Hi' }, { ...CONTEXT, plainText: true });
    expect(out.text).toBe('Hi\n\n-- \nSig Alice\n\nDisclaimer');
  });
});
