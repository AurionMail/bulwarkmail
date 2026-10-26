import { render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { useSettingsStore } from '@/stores/settings-store';

// #1259: the Mountain View sender line shows only the time for today's mail
// and the date as well before that. "Today" is the day in the time zone
// setting, the zone the time and the "(… ago)" after it are shown in, not the
// browser's.

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

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

const { EmailViewer } = await import('../email-viewer');

const mailboxes: Mailbox[] = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

function mail(n: number, receivedAt: string, overrides: Partial<Email> = {}): Email {
  return {
    id: `m${n}`,
    blobId: `b${n}`,
    threadId: 't1',
    mailboxIds: { inbox: true },
    keywords: { $seen: true },
    from: [{ name: `Sender ${n}`, email: `s${n}@example.com` }],
    to: [{ name: 'Me', email: 'me@example.com' }],
    subject: 'Subject',
    receivedAt,
    preview: `Preview ${n}`,
    hasAttachment: false,
    size: 100,
    ...overrides,
  } as unknown as Email;
}

let originalTZ: string | undefined;

describe('Mountain View sender date (#1259)', () => {
  beforeAll(() => {
    // The browser's zone, a day ahead of Denver in the evening.
    originalTZ = process.env.TZ;
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  afterEach(() => {
    vi.useRealTimers();
    useSettingsStore.setState({ timeZone: 'auto' });
  });

  it("shows the date for yesterday's mail in the time zone setting", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 16 Oct, 10:00 in Denver.
    vi.setSystemTime(new Date('2026-10-16T16:00:00Z'));
    useSettingsStore.setState({
      interfaceLayout: 'mountain-view', markAsReadDelay: 0, timeZone: 'America/Denver', timeFormat: '24h',
    });
    // 15 Oct, 21:00 in Denver, which is already 16 Oct in UTC.
    const yesterday = mail(1, '2026-10-16T03:00:00Z');
    const open = {
      ...mail(2, '2026-10-16T15:00:00Z'),
      textBody: [{ partId: '1', type: 'text/plain' }],
      htmlBody: [],
      attachments: [],
      bodyValues: { '1': { value: 'Open body', isTruncated: false } },
    } as unknown as Email;
    const { container } = render(
      <EmailViewer
        email={open}
        mailboxes={mailboxes}
        selectedMailbox="inbox"
        currentMailboxRole="inbox"
        mvConversation={[yesterday, open]}
      />,
    );
    const card = container.querySelector('[data-mv-conversation-card][data-email-id="m1"]');
    expect(card?.textContent).toContain('21:00');
    expect(card?.textContent).toContain('2026');
  });
});
