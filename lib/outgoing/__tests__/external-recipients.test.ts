import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { externalRecipientCheck, recipientsToConfirm, registerExternalRecipientCheck } from '../external-recipients';
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
  useExternalRecipientConfirmStore.setState({ pending: null, queue: [] });
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

describe('the From address', () => {
  it('counts the chosen identity as internal, but not a From typed over it', async () => {
    useAuthStore.setState({ identities: [] });
    const toPartner = { ...context(['bob@partner.example']), fromEmail: 'me@partner.example', identityEmail: 'org-alice@example.org' };
    // The typed From is on partner.example, the identity on example.org:
    // partner.example stays external.
    expect((await recipientsToConfirm(toPartner)).map((r) => r.address)).toEqual(['bob@partner.example']);
    // The identity's own domain is internal even before identities load.
    const toColleague = { ...context(['bob@example.org']), identityEmail: 'org-alice@example.org' };
    expect(await recipientsToConfirm(toColleague)).toEqual([]);
  });
});

describe('several questions at once', () => {
  it('asks the second after the first is answered, each with its own answer', async () => {
    const store = useExternalRecipientConfirmStore.getState();
    const first = store.ask([{ address: 'a@x.example', domain: 'x.example', field: 'to' }]);
    const second = store.ask([{ address: 'b@y.example', domain: 'y.example', field: 'to' }]);
    expect(useExternalRecipientConfirmStore.getState().pending?.recipients[0].address).toBe('a@x.example');
    useExternalRecipientConfirmStore.getState().answer(false);
    expect(await first).toBe(false);
    expect(useExternalRecipientConfirmStore.getState().pending?.recipients[0].address).toBe('b@y.example');
    useExternalRecipientConfirmStore.getState().answer(true);
    expect(await second).toBe(true);
    expect(useExternalRecipientConfirmStore.getState().pending).toBeNull();
  });

  it('answers every waiting question with Back when the dialog goes away', async () => {
    const store = useExternalRecipientConfirmStore.getState();
    const first = store.ask([{ address: 'a@x.example', domain: 'x.example', field: 'to' }]);
    const second = store.ask([{ address: 'b@y.example', domain: 'y.example', field: 'to' }]);
    useExternalRecipientConfirmStore.getState().cancelAll();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
  });
});

describe('contacts that are not loaded yet', () => {
  const dave = [{ id: 'c1', emails: { e: { address: 'org-dave@org-two.test' } } }] as unknown as ContactCard[];

  afterEach(() => { vi.useRealTimers(); });

  it('waits for them, so a contact loaded within the wait is trusted', async () => {
    vi.useFakeTimers();
    // Timers pending once the contacts are in: the wait's own and whatever the store started.
    let pendingAtLoad = -1;
    const fetchContacts = vi.fn(() => new Promise<void>((resolve) => {
      setTimeout(() => { useContactStore.setState({ contacts: dave, contactsLoaded: true }); pendingAtLoad = vi.getTimerCount(); resolve(); }, 1000);
    }));
    useContactStore.setState({ contacts: [], contactsLoaded: false, fetchContacts } as never);
    useAuthStore.setState({ client: {} as never });
    const result = recipientsToConfirm(context(['org-dave@org-two.test']));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual([]);
    expect(fetchContacts).toHaveBeenCalledTimes(1);
    // The wait's own timer is gone once the contacts are in.
    expect(vi.getTimerCount()).toBe(pendingAtLoad - 1);
  });

  it('gives up after three seconds and asks about the recipient', async () => {
    vi.useFakeTimers();
    const fetchContacts = vi.fn(() => new Promise<void>(() => {}));
    useContactStore.setState({ contacts: [], contactsLoaded: false, fetchContacts } as never);
    useAuthStore.setState({ client: {} as never });
    let done = false;
    const result = recipientsToConfirm(context(['org-dave@org-two.test'])).then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(2900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect((await result).map((r) => r.address)).toEqual(['org-dave@org-two.test']);
  });
});
