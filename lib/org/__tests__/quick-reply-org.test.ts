import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareQuickReply } from '@/lib/outgoing/quick-reply';
import { quickReplyEnvelope, saveQuickReplyDraft } from '@/lib/outgoing/quick-reply-envelope';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Email } from '@/lib/jmap/types';
import { resetSendPipeline } from '@/lib/outgoing/send-pipeline';
import { registerOrgOutgoing } from '@/lib/org/outgoing';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY, type OrganisationPolicy } from '@/lib/admin/organisation-policy';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useIdentityStore } from '@/stores/identity-store';
import type { Identity } from '@/lib/jmap/types';

vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));

// Quick reply (mail-app handleQuickReply → prepareQuickReply) must carry
// the organisation signature like the composer.

const ME = { id: 'id-me', name: 'Me', email: 'me@example.org', mayDelete: false, htmlSignature: '<b>Mine</b>', textSignature: 'Mine' } as Identity;
const TEAM = { id: 'id-team', name: 'Team', email: 'team@example.org', mayDelete: false } as Identity;

function setOrganisation(organisation: Partial<OrganisationPolicy>, locked = false) {
  const policy: SettingsPolicy = {
    ...DEFAULT_POLICY,
    restrictions: locked ? { signature: { locked: true } } : {},
    organisation: { ...DEFAULT_ORGANISATION_POLICY, ...organisation },
  };
  usePolicyStore.setState({ policy, rawPolicy: policy, subject: null });
}

const reply = (sendingIdentity: Identity, signatureIdentity: Identity) => prepareQuickReply({
  body: 'Thanks',
  signatureIdentity,
  sendingIdentity,
  separator: true,
  to: ['bob@example.com'],
  fromEmail: sendingIdentity.email,
  identityId: sendingIdentity.id,
});

const SIGNATURE = { html: '<p>{name} | ACME</p>', text: '', fields: [] };

describe('quick reply and the organisation', () => {
  beforeEach(() => {
    resetSendPipeline();
    registerOrgOutgoing();
    useIdentityStore.setState({ identities: [ME, TEAM] });
    useSettingsStore.setState({ signatureDetails: { title: '', department: '', phone: '', mobile: '' } });
  });
  afterEach(() => {
    resetSendPipeline();
    usePolicyStore.setState({ policy: DEFAULT_POLICY, rawPolicy: DEFAULT_POLICY });
  });

  it('signs with a locked organisation signature once, filled in for the sending identity', async () => {
    setOrganisation({ signature: SIGNATURE }, true);
    const out = await reply(TEAM, ME);
    expect(out?.html).toBe('<div>Thanks</div><br><br>-- <br><p>Team | ACME</p>');
    expect(out?.text).toBe('Thanks\n\n-- \nTeam | ACME');
  });

  it('uses it for an identity without a signature, and keeps an own one when not locked', async () => {
    setOrganisation({ signature: SIGNATURE });
    expect((await reply(TEAM, TEAM))?.text).toBe('Thanks\n\n-- \nTeam | ACME');
    expect((await reply(ME, ME))?.text).toBe('Thanks\n\n-- \nMine');
  });

  it('gets the disclaimer once, after the signature', async () => {
    setOrganisation({ signature: SIGNATURE, disclaimer: { html: '<p>Confidential</p>', text: '' } }, true);
    const out = await reply(TEAM, ME);
    expect(out?.html).toBe('<div>Thanks</div><br><br>-- <br><p>Team | ACME</p><hr><div data-org-disclaimer=""><p>Confidential</p></div>');
    expect(out?.text).toBe('Thanks\n\n-- \nTeam | ACME\n\nConfidential');
  });

  const TO_TEAM = {
    id: 'm1', subject: 'Question', messageId: ['<m1@example.org>'],
    from: [{ name: 'Bob', email: 'bob@example.com' }], to: [{ email: 'team@example.org' }],
  } as unknown as Email;

  it('signs a reply addressed through quickReplyEnvelope for the identity it goes out as', async () => {
    setOrganisation({ signature: SIGNATURE }, true);
    const { sendingIdentity, primaryIdentity } = quickReplyEnvelope(TO_TEAM, [ME, TEAM]);
    expect(sendingIdentity?.id).toBe('id-team');
    const out = await reply(sendingIdentity!, primaryIdentity!);
    expect(out?.text).toBe('Thanks\n\n-- \nTeam | ACME');
  });

  it('saves the quick-reply draft at sign-out without the disclaimer or a signature', async () => {
    setOrganisation({ signature: SIGNATURE, disclaimer: { html: '<p>Confidential</p>', text: '' } }, true);
    const createDraft = vi.fn().mockResolvedValue('d1');
    await saveQuickReplyDraft({ client: { createDraft } as unknown as IJMAPClient, email: TO_TEAM, identities: [ME, TEAM], body: 'Half a reply', replyPrefix: 'Re:' });
    expect(createDraft).toHaveBeenCalledTimes(1);
    const [, , body, , , , , , , , html] = createDraft.mock.calls[0];
    expect(body).toBe('Half a reply');
    expect(html).toBeUndefined();
  });
});
