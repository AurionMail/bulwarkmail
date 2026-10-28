import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Email } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Save to Files for an attachment of a shared or group mailbox of the same
// login: its blob is copied into the Files account (Blob/copy). Another
// login's mail can't reach this login's Files, so it isn't offered there.

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
const { useAuthStore } = await import('@/stores/auth-store');
const { usePolicyStore } = await import('@/stores/policy-store');

const email = {
  id: 'e1',
  blobId: 'b1',
  threadId: 't1',
  mailboxIds: { inbox: true },
  keywords: { $seen: true },
  from: [{ name: 'Alice', email: 'alice@example.com' }],
  to: [{ name: 'Bob', email: 'bob@example.com' }],
  subject: 'Invoice',
  receivedAt: '2026-01-01T00:00:00Z',
  preview: 'See attached',
  hasAttachment: true,
  size: 100,
  textBody: [],
  htmlBody: [],
  attachments: [{ partId: '2', blobId: 'blob-pdf', name: 'invoice.pdf', type: 'application/pdf', size: 1234, disposition: 'attachment' }],
  bodyValues: {},
} as unknown as Email;

function makeClient(accountId: string) {
  return new Proxy({ getAccountId: () => accountId, getFilesAccountId: () => accountId, supportsFiles: () => true } as Record<string, unknown>, {
    get: (target, prop) => (prop in target ? target[prop as string] : prop === 'then' ? undefined : vi.fn().mockResolvedValue(null)),
  }) as unknown as IJMAPClient;
}

describe('Save to Files in the reader', () => {
  const own = makeClient('me');

  beforeEach(() => {
    useAuthStore.setState({ client: own } as never);
    usePolicyStore.setState({ isFeatureEnabled: () => true } as never);
  });

  it("is offered for a shared mailbox's attachment of the same login", () => {
    render(<EmailViewer email={email} blobSource={{ client: own, accountId: 'team' }} mailboxes={[]} selectedMailbox="inbox" />);
    expect(screen.getAllByRole('button', { name: 'save_to_files.title' }).length).toBeGreaterThan(0);
  });

  it("isn't offered for another login's mail", () => {
    render(<EmailViewer email={email} blobSource={{ client: makeClient('other'), accountId: 'other' }} mailboxes={[]} selectedMailbox="inbox" />);
    expect(screen.queryByRole('button', { name: 'save_to_files.title' })).toBeNull();
  });
});
