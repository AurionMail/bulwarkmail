import { render, act } from '@testing-library/react';
import { Profiler } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { clearAllHooks } from '@/lib/plugin-hooks';

// Opening a message renders the reading pane twice: the row's header with the
// body loading, then the fetched body. Each further pass is a full render of
// a very large component on the click's critical path, so the count is pinned
// here: resets to values the pane already holds, and readiness flags reset in
// a layout effect, used to add passes on every open.

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

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

const row = (id: string) => ({
  id, blobId: `b-${id}`, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: { $seen: true },
  from: [{ name: 'Alice', email: 'alice@example.com' }], to: [{ name: 'Bob', email: 'bob@example.com' }],
  subject: `Subject ${id}`, receivedAt: '2026-01-01T00:00:00Z', preview: 'Hello', hasAttachment: false, size: 100,
}) as unknown as Email;
const full = (id: string) => ({
  ...row(id),
  textBody: [{ partId: '1', type: 'text/html' }], htmlBody: [{ partId: '1', type: 'text/html' }], attachments: [],
  bodyValues: { '1': { value: `<p>Body of ${id}</p>` } },
}) as unknown as Email;

beforeEach(() => clearAllHooks());

describe('reading pane renders per open', () => {
  it('renders the pane a bounded number of times from click to body', async () => {
    let commits = 0;
    const pane = (email: Email, isLoading: boolean) => (
      <Profiler id="viewer" onRender={() => { commits++; }}>
        <EmailViewer email={email} isLoading={isLoading} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" />
      </Profiler>
    );
    const { rerender } = render(pane(full('a'), false));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    commits = 0;
    // The click: the row with the body loading ...
    rerender(pane(row('b'), true));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // ... then the fetched message.
    rerender(pane(full('b'), false));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    // 13 before shared empty values and the derived iframe readiness.
    expect(commits).toBeLessThanOrEqual(6);
  });
});
