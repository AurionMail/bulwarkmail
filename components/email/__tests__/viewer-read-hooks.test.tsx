import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { emailHooks, clearAllHooks } from '@/lib/plugin-hooks';

// mail-read hooks fired by the reading pane: onEmailContentRender once the
// body is on screen and onThreadExpand for the conversation cards. (The link
// hook runs inside the body iframe, which jsdom doesn't load; its decision is
// covered in lib/__tests__/plugin-hook-result.test.ts.)

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
const { ThreadConversationView } = await import('../thread-conversation-view');

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

const textEmail = (id = 'e1') => ({
  id, blobId: 'b1', threadId: 't1', mailboxIds: { inbox: true }, keywords: { $seen: true },
  from: [{ name: 'Alice', email: 'alice@example.com' }], to: [{ name: 'Bob', email: 'bob@example.com' }],
  subject: 'Hello', receivedAt: '2026-01-01T00:00:00Z', preview: 'Hello', hasAttachment: false, size: 100,
  textBody: [{ partId: '1', type: 'text/plain' }], htmlBody: [{ partId: '1', type: 'text/plain' }], attachments: [],
  bodyValues: { '1': { value: 'Hello there' } },
}) as unknown as Email;

const viewer = (email: Email, extra: Record<string, unknown> = {}) => (
  <EmailViewer email={email} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" {...extra} />
);

beforeEach(() => clearAllHooks());

describe('onEmailContentRender', () => {
  it('fires once the body is on screen, once per message', async () => {
    const handler = vi.fn();
    emailHooks.onEmailContentRender.register('test', handler);

    const { rerender } = render(viewer(textEmail(), { isLoading: true }));
    await act(async () => {});
    expect(handler).not.toHaveBeenCalled();

    rerender(viewer(textEmail(), { isLoading: false }));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler).toHaveBeenCalledWith({ emailId: 'e1', hasHtml: false, hasExternalContent: false });

    rerender(viewer(textEmail(), { isLoading: false, onReply: () => {} }));
    await act(async () => {});
    expect(handler).toHaveBeenCalledTimes(1);

    rerender(viewer(textEmail('e2'), { isLoading: false }));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(handler).toHaveBeenLastCalledWith({ emailId: 'e2', hasHtml: false, hasExternalContent: false });
  });
});

describe('onThreadExpand in the conversation view', () => {
  it('reports a card being unfolded and folded', () => {
    const handler = vi.fn();
    emailHooks.onThreadExpand.register('test', handler);
    const older = { ...textEmail('old'), keywords: { $seen: true }, receivedAt: '2025-12-01T00:00:00Z' } as Email;
    const newer = textEmail('new');

    render(
      <ThreadConversationView
        thread={{ threadId: 't1', emails: [newer, older], latestEmail: newer } as never}
        emails={[newer, older]}
        onBack={() => {}}
      />,
    );
    // The newest card starts unfolded, the older read one folded.
    const olderHeader = screen.getAllByText('Alice').at(-1)!;
    fireEvent.click(olderHeader);
    expect(handler).toHaveBeenLastCalledWith({ threadId: 't1', emailIds: ['old'], expanded: true });
    fireEvent.click(screen.getAllByText('Alice').at(-1)!);
    expect(handler).toHaveBeenLastCalledWith({ threadId: 't1', emailIds: ['old'], expanded: false });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
