import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { setNoThirdPartyTraffic } from '@/lib/third-party-mode';
import { useSettingsStore } from '@/stores/settings-store';

// #903: with no third-party traffic, remote content in mail never loads, so
// nothing offers to load it or to trust the sender; the notice says the
// organisation blocks it. Without the mode the controls are as before.

vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
}));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));
vi.mock('@/hooks/use-wopi-status', () => ({ useWopiStatus: () => ({ enabled: false }), canWopiOpen: () => false }));
vi.mock('@/hooks/use-own-domain-address', () => ({ useOwnDomainAddress: () => () => false }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const { EmailViewer } = await import('../email-viewer');
const { ThreadConversationView } = await import('../thread-conversation-view');

const mailboxes = [{ id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } }] as unknown as Mailbox[];
const email = {
  id: 'e1', blobId: 'b-e1', threadId: 't1', mailboxIds: { inbox: true }, keywords: { $seen: true },
  from: [{ name: 'News', email: 'news@shop.example' }], to: [{ email: 'me@example.org' }],
  subject: 'Offer', receivedAt: '2026-10-01T10:00:00Z', preview: 'Hello', hasAttachment: false, size: 100,
  textBody: [], htmlBody: [{ partId: '1', type: 'text/html' }], attachments: [],
  bodyValues: { '1': { value: '<p>Hello</p><img src="https://track.shop.example/pixel.gif">' } },
} as unknown as Email;

afterEach(() => {
  setNoThirdPartyTraffic(false);
  useSettingsStore.setState({ externalContentPolicy: 'ask' });
});

async function renderViewer() {
  render(<EmailViewer email={email} isLoading={false} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" />);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return screen.findByTestId('external-content-notice');
}

async function renderConversation() {
  const view = render(
    <ThreadConversationView thread={{ threadId: 't1', emails: [email], latestEmail: email } as never} emails={[email] as never} onBack={() => {}} />,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view;
}

describe('reading pane', () => {
  it('offers to load remote content without the mode', async () => {
    const notice = await renderViewer();
    expect(notice.textContent).toContain('external_content_warning');
    expect(screen.queryByText('load_external_content')).not.toBeNull();
    expect(screen.queryByText('trust_sender')).not.toBeNull();
  });

  it('says the organisation blocks it, with no load or trust button, even when the policy allows', async () => {
    setNoThirdPartyTraffic(true);
    useSettingsStore.setState({ externalContentPolicy: 'allow' });
    const notice = await renderViewer();
    expect(notice.textContent).toContain('remote_content_blocked');
    expect(screen.queryByText('load_external_content')).toBeNull();
    expect(screen.queryByText('trust_sender')).toBeNull();
  });
});

describe('conversation view', () => {
  it('offers to load remote content without the mode', async () => {
    await renderConversation();
    expect(screen.getByTestId('external-content-notice').textContent).toContain('email_viewer.external_content_warning');
    expect(screen.queryByText('email_viewer.load_external_content')).not.toBeNull();
  });

  it('says the organisation blocks it, keeps it blocked and offers nothing in the mode', async () => {
    setNoThirdPartyTraffic(true);
    useSettingsStore.setState({ externalContentPolicy: 'allow' });
    const { container } = await renderConversation();
    expect(screen.getByTestId('external-content-notice').textContent).toContain('third_party.remote_content_blocked');
    expect(screen.queryByText('email_viewer.load_external_content')).toBeNull();
    expect(screen.queryByText('email_viewer.trust_sender')).toBeNull();
    const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
    expect(srcdoc).not.toMatch(/\ssrc="https:\/\/track\.shop\.example/);
  });
});
