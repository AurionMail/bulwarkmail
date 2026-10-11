import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';

// A draft showed two Edit buttons side by side: in the toolbar and in the
// "This message is a draft" banner.

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
  { id: 'drafts', name: 'Drafts', role: 'drafts', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

const draft = {
  id: 'd1', blobId: 'b1', threadId: 't1', mailboxIds: { drafts: true },
  keywords: { $seen: true, $draft: true },
  from: [{ name: 'User A', email: 'usera@example.org' }], to: [{ email: 'userb@example.org' }],
  subject: 'Draft', receivedAt: '2026-01-01T00:00:00Z', preview: 'Draft', hasAttachment: false,
  size: 100, textBody: [], htmlBody: [], attachments: [], bodyValues: {},
} as unknown as Email;

describe('draft view', () => {
  it('offers Edit once', () => {
    render(
      <EmailViewer
        email={draft}
        mailboxes={mailboxes}
        selectedMailbox="drafts"
        currentMailboxRole="drafts"
        onEditDraft={vi.fn()}
      />,
    );

    expect(screen.getByText('draft_banner')).toBeInTheDocument();
    expect(screen.getAllByText('edit_draft')).toHaveLength(1);
  });
});
