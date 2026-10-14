import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React, { useEffect } from 'react';
import type { Email, Mailbox } from '@/lib/jmap/types';

// The "more details" panel defined its plugin slot component inside render,
// so every re-render of the viewer was a new component type: React unmounted
// and remounted the plugin's iframe each time (and re-ran its shouldShow).

vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
}));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));

const mounts: Record<string, number> = {};
const propsSeen: Record<string, unknown[]> = {};
vi.mock('@/components/plugins/plugin-slot', () => ({
  PluginSlot: ({ name, extraProps }: { name: string; extraProps?: unknown }) => {
    (propsSeen[name] ??= []).push(extraProps);
    useEffect(() => {
      mounts[name] = (mounts[name] ?? 0) + 1;
      // Runs once per mount on purpose: that is what the test counts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-slot': name });
  },
}));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({
  usePluginSlotOffers: (slot: string) =>
    slot === 'email-details-section' || slot === 'email-banner' ? [{ pluginId: 'p', order: 100 }] : [],
}));

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

const email = {
  id: 'e1', blobId: 'b1', threadId: 't1', mailboxIds: { inbox: true }, keywords: { $seen: true },
  from: [{ name: 'Alice', email: 'alice@example.com' }], to: [{ name: 'Bob', email: 'bob@example.com' }],
  subject: 'Hello', receivedAt: '2026-01-01T00:00:00Z', preview: 'Hello', hasAttachment: false, size: 100,
  textBody: [], htmlBody: [], attachments: [], bodyValues: {},
} as unknown as Email;

describe('plugin slots in the message viewer', () => {
  it('keep their iframes and props across re-renders', () => {
    const view = (extra: Record<string, unknown>) => (
      <EmailViewer email={email} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" {...extra} />
    );
    const { rerender } = render(view({ isLoading: false }));
    act(() => { fireEvent.click(screen.getAllByText('show_details')[0]); });
    const detailMounts = mounts['email-details-section'];
    const bannerProps = propsSeen['email-banner'].at(-1);
    expect(detailMounts).toBeGreaterThan(0);

    rerender(view({ isLoading: false, onReply: () => {} }));
    rerender(view({ isLoading: false, onReply: () => {}, onForward: () => {} }));

    expect(mounts['email-details-section']).toBe(detailMounts);
    expect(propsSeen['email-banner'].at(-1)).toBe(bannerProps);
  });
});
