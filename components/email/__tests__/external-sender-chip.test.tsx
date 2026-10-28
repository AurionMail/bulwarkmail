import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Email, Identity, Mailbox } from '@/lib/jmap/types';
import { clearAllHooks } from '@/lib/plugin-hooks';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
}));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

const { EmailViewer } = await import('../email-viewer');
const { ExternalSenderChip } = await import('../external-sender-chip');

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

const message = (from: string) => ({
  id: 'm1', blobId: 'b1', threadId: 't1', mailboxIds: { inbox: true }, keywords: { $seen: true },
  from: [{ name: 'Sender', email: from }], to: [{ name: 'Org Alice', email: 'org-alice@example.org' }],
  subject: 'Hello', receivedAt: '2026-01-01T00:00:00Z', preview: 'Hello', hasAttachment: false, size: 100,
  textBody: [{ partId: '1', type: 'text/html' }], htmlBody: [{ partId: '1', type: 'text/html' }], attachments: [],
  bodyValues: { '1': { value: '<p>Body</p>' } },
}) as unknown as Email;

function setExternalMail(patch: Partial<typeof DEFAULT_ORGANISATION_POLICY.externalMail>) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, ...patch } },
    },
  });
}

async function openMessage(from: string) {
  const view = render(<EmailViewer email={message(from)} isLoading={false} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" />);
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return view;
}

beforeEach(() => {
  clearAllHooks();
  setExternalMail({});
  useAuthStore.setState({ identities: [{ id: 'i1', name: 'Org Alice', email: 'org-alice@example.org' } as unknown as Identity] });
});

describe('External sender chip', () => {
  it('names the sender domain in its tooltip when the label is on', () => {
    setExternalMail({ senderLabel: true });
    const { container } = render(<ExternalSenderChip from={[{ email: "org-dave@org-two.test" }]} />);
    const chip = container.querySelector('[data-external-sender-chip]');
    expect(chip?.textContent).toContain('sender_label');
    expect(chip?.getAttribute('title')).toBe('sender_tooltip');
  });

  it('shows in the reader header for a sender outside the organisation', async () => {
    setExternalMail({ senderLabel: true });
    const { container } = await openMessage('org-dave@org-two.test');
    expect(container.querySelectorAll('[data-external-sender-chip]').length).toBeGreaterThan(0);
  });

  it('stays away for a sender in an identity domain or its subdomain', async () => {
    setExternalMail({ senderLabel: true });
    const { container } = await openMessage('org-bob@example.org');
    expect(container.querySelector('[data-external-sender-chip]')).toBeNull();
    const sub = render(<ExternalSenderChip from={[{ email: "someone@eu.example.org" }]} />);
    expect(sub.container.querySelector('[data-external-sender-chip]')).toBeNull();
  });

  it('stays away for a domain the admin listed', async () => {
    setExternalMail({ senderLabel: true, domains: ['org-two.test'] });
    const { container } = await openMessage('org-dave@org-two.test');
    expect(container.querySelector('[data-external-sender-chip]')).toBeNull();
  });

  it('stays away while the label is off, even with the recipient warning on', async () => {
    setExternalMail({ senderLabel: false, recipientWarning: true });
    const { container } = await openMessage('org-dave@org-two.test');
    expect(container.querySelector('[data-external-sender-chip]')).toBeNull();
  });
});
