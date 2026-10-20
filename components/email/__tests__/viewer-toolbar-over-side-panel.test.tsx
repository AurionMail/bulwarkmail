import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { cleanup } from '@testing-library/react';
import type { Email, Mailbox } from '@/lib/jmap/types';

// On a desktop the reader's top toolbar runs over the plugin side panel to
// the right edge; the panel starts below it. On a phone the toolbar stays in
// the message column. Its menus close when a click goes into a frame.

const device = { isMobile: false };
vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: device.isMobile, isTablet: false, isDesktop: !device.isMobile }),
  useMediaQuery: () => false,
}));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/components/plugins/plugin-slot', () => ({
  PluginSlot: ({ name }: { name: string }) => React.createElement('div', { 'data-slot': name }),
}));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({
  usePluginSlotOffers: (slot: string) => (slot === 'email-detail-sidebar' ? [{ pluginId: 'p', order: 100 }] : []),
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

const show = () => render(
  <EmailViewer email={email} isLoading={false} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" onDelete={() => {}} />,
);

/** The plugin panel, open or folded to its toggle. */
const sidePanel = () =>
  (document.querySelector('[data-plugin-detail-panel]') as HTMLElement | null)
  ?? (screen.getByLabelText('plugin_panel_show').closest('div') as HTMLElement);

/** An item of the top toolbar. */
const toolbarItem = () => document.querySelector('[data-overflow-item]') as HTMLElement;

afterEach(() => {
  cleanup();
  device.isMobile = false;
});

describe('the reader toolbar and the plugin side panel', () => {
  it('runs the toolbar over the side panel on a desktop', () => {
    show();
    const panel = sidePanel();
    const item = toolbarItem();
    expect(item).toBeTruthy();
    // The box that holds the panel does not hold the toolbar...
    expect(panel.parentElement!.contains(item)).toBe(false);
    // ...and the toolbar comes before it, at the top of the reader.
    expect(item.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const root = document.querySelector('[data-tour="email-viewer"]')!;
    expect(root.firstElementChild!.contains(item)).toBe(true);
    expect(root.firstElementChild!.contains(panel)).toBe(false);
  });

  it('closes the More menu when a click goes into a frame', () => {
    show();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'more_actions' })); });
    expect(screen.getByRole('menu', { name: 'more_actions' })).toBeTruthy();
    // A click in the message body or a plugin panel moves focus into that
    // frame: this document sees no mousedown, only the window losing focus.
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(screen.queryByRole('menu', { name: 'more_actions' })).toBeNull();
  });

  it('keeps the toolbar in the message column on a phone', () => {
    device.isMobile = true;
    show();
    expect(document.querySelector('[data-viewer-top-toolbar="full-width"]')).toBeNull();
    expect(document.querySelector('[data-viewer-top-toolbar="column"]')).toBeTruthy();
  });
});
