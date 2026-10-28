import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { externalRecipientCheck, registerExternalRecipientCheck } from '../external-recipients';
import { resetSendPipeline, type OutgoingContext } from '../send-pipeline';
import { prepareQuickReply } from '../quick-reply';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { useExternalRecipientConfirmStore } from '@/stores/external-recipient-confirm-store';
import type { ContactCard, Identity } from '@/lib/jmap/types';

vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));

function setExternalMail(patch: Partial<typeof DEFAULT_ORGANISATION_POLICY.externalMail>) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, ...patch } },
    },
  });
}

const context = (to: string[], cc: string[] = [], bcc: string[] = []): OutgoingContext => ({
  surface: 'composer', to, cc, bcc, fromEmail: 'org-alice@example.org', identityId: 'i1', mode: 'compose', plainText: false,
});

beforeEach(() => {
  setExternalMail({ recipientWarning: true });
  useAuthStore.setState({ client: null, identities: [{ id: 'i1', name: 'Org Alice', email: 'org-alice@example.org' } as unknown as Identity] });
  useContactStore.setState({ contacts: [], contactsLoaded: true });
  useExternalRecipientConfirmStore.setState({ pending: null });
});
afterEach(() => resetSendPipeline());

describe('externalRecipientCheck', () => {
  it('does not ask while the warning is off', async () => {
    setExternalMail({ recipientWarning: false, senderLabel: true });
    const ask = vi.fn(async () => false);
    expect(await externalRecipientCheck(context(['org-dave@org-two.test']), ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('does not ask when every recipient is internal, subdomains included', async () => {
    const ask = vi.fn(async () => false);
    expect(await externalRecipientCheck(context(['org-bob@example.org'], ['x@eu.example.org']), ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks about the external recipients only and returns the answer', async () => {
    const ask = vi.fn(async () => false);
    const recipients = context(['org-bob@example.org', 'org-dave@org-two.test'], [], ['eve@other.net']);
    expect(await externalRecipientCheck(recipients, ask)).toBe(false);
    expect(ask).toHaveBeenCalledWith([
      { address: 'org-dave@org-two.test', domain: 'org-two.test', field: 'to' },
      { address: 'eve@other.net', domain: 'other.net', field: 'bcc' },
    ]);
    ask.mockResolvedValueOnce(true);
    expect(await externalRecipientCheck(recipients, ask)).toBe(true);
  });

  it('counts the admin domains as internal', async () => {
    setExternalMail({ recipientWarning: true, domains: ['org-two.test'] });
    const ask = vi.fn(async () => false);
    expect(await externalRecipientCheck(context(['org-dave@org-two.test']), ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('trusts contacts only while trustContacts is on', async () => {
    useContactStore.setState({
      contacts: [{ id: 'c1', emails: { e: { address: 'Org-Dave@org-two.test' } } }] as unknown as ContactCard[],
    });
    const ask = vi.fn(async () => false);
    expect(await externalRecipientCheck(context(['org-dave@org-two.test']), ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();

    setExternalMail({ recipientWarning: true, trustContacts: false });
    expect(await externalRecipientCheck(context(['org-dave@org-two.test']), ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('quick reply goes through the same confirm', () => {
  const input = { body: 'Thanks', signatureIdentity: null, separator: true, to: ['org-dave@org-two.test'], fromEmail: 'org-alice@example.org', identityId: 'i1' };

  async function answerWhenAsked(send: boolean) {
    await vi.waitFor(() => expect(useExternalRecipientConfirmStore.getState().pending).not.toBeNull());
    expect(useExternalRecipientConfirmStore.getState().pending?.recipients.map((r) => r.address)).toEqual(['org-dave@org-two.test']);
    useExternalRecipientConfirmStore.getState().answer(send);
  }

  it('sends nothing on Back', async () => {
    registerExternalRecipientCheck();
    const result = prepareQuickReply(input);
    await answerWhenAsked(false);
    expect(await result).toBeNull();
  });

  it('returns the bodies on Send anyway', async () => {
    registerExternalRecipientCheck();
    const result = prepareQuickReply(input);
    await answerWhenAsked(true);
    expect((await result)?.text).toContain('Thanks');
  });

  it('does not ask for a reply to an internal sender', async () => {
    registerExternalRecipientCheck();
    const result = await prepareQuickReply({ ...input, to: ['org-bob@example.org'] });
    expect(result?.text).toContain('Thanks');
    expect(useExternalRecipientConfirmStore.getState().pending).toBeNull();
  });
});
