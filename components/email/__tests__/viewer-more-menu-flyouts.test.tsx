import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';

// #1261: the Move, Tag and Rules flyouts of the reader's More menu ran past
// the reading pane when there was no room on their side. The ⋮ menu is now
// the row's context menu (R6), whose submenus open on the end side when it
// has room and on the other side when it hasn't.

vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
}));

vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));

vi.mock('@/components/plugins/plugin-slot', () => ({
  PluginSlot: () => null,
}));

vi.mock('@/hooks/use-plugin-slot-offers', () => ({
  usePluginSlotOffers: () => [],
}));

vi.mock('../rules-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rules-menu')>()),
  useRulesAvailability: () => ({ availability: 'available', target: {} }),
  RulesPanel: () => <div>rules panel</div>,
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

const { EmailViewer } = await import('../email-viewer');

const email = {
  id: 'e1',
  blobId: 'b1',
  threadId: 't1',
  mailboxIds: { inbox: true },
  keywords: { $seen: true },
  from: [{ name: 'Alice', email: 'alice@example.com' }],
  to: [{ name: 'Bob', email: 'bob@example.com' }],
  subject: 'Hello',
  receivedAt: '2026-01-01T00:00:00Z',
  preview: 'Hello',
  hasAttachment: false,
  size: 100,
  textBody: [],
  htmlBody: [],
  attachments: [],
  bodyValues: {},
} as unknown as Email;

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => vi.restoreAllMocks());

/** Opens the Tag submenu with its entry at `entryLeft` (192 px wide) in a 1280 px window; returns the flyout. */
function openTagFlyout(entryLeft: number, direction = 'ltr'): HTMLElement {
  render(<EmailViewer email={email} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" />);
  fireEvent.click(screen.getByRole('button', { name: 'more_actions' }));
  const entry = screen.getByTestId('ctx-tag').parentElement!;
  // jsdom doesn't inherit `direction` from <html dir>, so set it where it is read.
  entry.style.direction = direction;
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === entry) return rect(entryLeft, 120, 192, 32);
    if (this.getAttribute('aria-label') === 'tag') return rect(0, 0, 288, 200);
    return rect(0, 0, 0, 0);
  });
  fireEvent.click(screen.getByTestId('ctx-tag'));
  return screen.getByRole('menu', { name: 'tag' });
}

describe('reader More menu flyouts (#1261)', () => {
  it('opens on the right when there is no room on the left', () => {
    const flyout = openTagFlyout(100);
    expect(flyout.style.left).toBe('292px');
    expect(flyout.style.top).toBe('120px');
  });

  it('opens on the right when both sides have room', () => {
    const flyout = openTagFlyout(600);
    expect(flyout.style.left).toBe('792px');
  });

  it('opens on the left when both sides have room in a right-to-left layout', () => {
    const flyout = openTagFlyout(600, 'rtl');
    expect(flyout.style.left).toBe('312px');
  });

  it('opens on the left when there is no room on the right', () => {
    const flyout = openTagFlyout(1000);
    expect(flyout.style.left).toBe('712px');
  });
});
