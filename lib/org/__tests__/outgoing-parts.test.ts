import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { finalizeOutgoing, resetSendPipeline, type OutgoingBodies, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { registerOrgOutgoing } from '@/lib/org/outgoing';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY, type OrganisationPolicy } from '@/lib/admin/organisation-policy';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useIdentityStore } from '@/stores/identity-store';
import type { Identity } from '@/lib/jmap/types';

/** Both finaliser stages, as a send without plugins runs them. */
const finalizeAll = (bodies: OutgoingBodies, context: OutgoingContext) =>
  finalizeOutgoing(finalizeOutgoing(bodies, context), context, 'last');

// The finalisers check and fix the HTML and the text part each on its own,
// against the matching template, by whole lines. Running them twice (a
// message sent again after Undo) adds nothing.

const CONTEXT: OutgoingContext = {
  surface: 'composer',
  to: ['bob@example.com'],
  cc: [],
  bcc: [],
  fromEmail: 'alice@example.org',
  identityId: 'id-alice',
  mode: 'compose',
  plainText: false,
  forwardedSeparator: '---------- Forwarded message ----------',
};

const count = (haystack: string | undefined, needle: string) => (haystack ?? '').split(needle).length - 1;

function setOrganisation(organisation: Partial<OrganisationPolicy>, locked = true) {
  const policy: SettingsPolicy = {
    ...DEFAULT_POLICY,
    restrictions: locked ? { signature: { locked: true } } : {},
    organisation: { ...DEFAULT_ORGANISATION_POLICY, ...organisation },
  };
  usePolicyStore.setState({ policy, rawPolicy: policy, subject: null });
}

beforeEach(() => {
  resetSendPipeline();
  registerOrgOutgoing();
  useIdentityStore.setState({ identities: [{ id: 'id-alice', name: 'Alice', email: 'alice@example.org', mayDelete: false } as Identity] });
  useSettingsStore.setState({ signatureDetails: { title: '', department: '', phone: '+49 1', mobile: '' }, signatureSeparatorEnabled: true });
});
afterEach(() => {
  resetSendPipeline();
  usePolicyStore.setState({ policy: DEFAULT_POLICY, rawPolicy: DEFAULT_POLICY });
});

describe('locked signature, HTML and text templates that differ', () => {
  const signature = { html: '<table><tr><td>Phone</td><td>{phone}</td></tr></table>', text: 'Call us: {phone}', fields: [] };

  it('leaves a body that carries it alone, also when finalised twice', () => {
    setOrganisation({ signature });
    const html = '<div><p>Hi</p></div><br><br>-- <br><table><tr><td>Phone</td><td>+49 1</td></tr></table>';
    const bodies = { html, text: 'Hi\n\n-- \nPhone +49 1' };
    expect(finalizeAll(bodies, CONTEXT)).toEqual(bodies);
    const plain = { text: 'Hi\n\n-- \nCall us: +49 1' };
    expect(finalizeAll(finalizeOutgoing(plain, { ...CONTEXT, plainText: true }), { ...CONTEXT, plainText: true })).toEqual(plain);
  });

  it('puts it back in each part with that part\'s template, once', () => {
    setOrganisation({ signature });
    const once = finalizeAll({ html: '<div><p>Hi</p></div>', text: 'Hi' }, CONTEXT);
    expect(count(once.html, '<td>+49 1</td>')).toBe(1);
    expect(once.text).toBe('Hi\n\n-- \nCall us: +49 1');
    expect(finalizeAll(once, CONTEXT)).toEqual(once);
  });

  it('counts a signature with a link as there', () => {
    setOrganisation({ signature: { html: '<p>{name}<br><a href="https://acme.test">acme.test</a></p>', text: '', fields: [] } });
    const html = '<div><p>Hi</p></div><br><br>-- <br><p>Alice<br><a href="https://acme.test">acme.test</a></p>';
    expect(finalizeAll({ html, text: 'Hi\n\n-- \nAlice\nacme.test' }, CONTEXT).html).toBe(html);
  });

  it('matches whole lines: a word the user typed is not the signature', () => {
    setOrganisation({ signature: { html: '', text: 'ACME', fields: [] } });
    const out = finalizeAll({ text: 'ACME rocks' }, { ...CONTEXT, plainText: true });
    expect(out.text).toBe('ACME rocks\n\n-- \nACME');
  });

  it('does not count the copy in a forwarded message', () => {
    setOrganisation({ signature: { html: '', text: '{name}\nACME', fields: [] } });
    // (The very end counts: that is where the composer appends it below a forward.)
    const text = 'FYI\n\n---------- Forwarded message ----------\nFrom: Alice\n\nOld text\n\n-- \nAlice\nACME\n\nSent on the road';
    const out = finalizeAll({ text }, { ...CONTEXT, plainText: true, mode: 'forward' });
    expect(count(out.text, 'ACME')).toBe(2);
  });
});

describe('disclaimer, HTML and text templates that differ', () => {
  const disclaimer = { html: '<p>Confidential. <a href="https://x.test/imprint">Imprint</a></p>', text: 'Confidential. Imprint: https://x.test/imprint' };

  it('is added once to each part, also when finalised twice', () => {
    setOrganisation({ disclaimer }, false);
    const once = finalizeAll({ html: '<div>Hi</div>', text: 'Hi' }, CONTEXT);
    expect(count(once.html, 'Confidential.')).toBe(1);
    expect(once.text).toBe('Hi\n\nConfidential. Imprint: https://x.test/imprint');
    expect(finalizeAll(once, CONTEXT)).toEqual(once);
  });

  it('is not added again to a draft that came back from Undo through the editor', () => {
    setOrganisation({ disclaimer }, false);
    // The editor drops the wrapper's marker; the text part is made from the HTML.
    const html = '<div><p>Hi</p><hr><p>Confidential. <a href="https://x.test/imprint">Imprint</a></p></div>';
    const bodies = { html, text: 'Hi\n\nConfidential. Imprint <https://x.test/imprint>' };
    expect(finalizeAll(bodies, CONTEXT)).toEqual(bodies);
  });
});
