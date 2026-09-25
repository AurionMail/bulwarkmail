import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { SubmissionQuotaError } from '@/lib/jmap/client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';

// Sending from the viewer - quick reply, "Send now" / "Reschedule" of a
// scheduled message, and read receipts - used to fail silently or as an
// unhandled rejection. At a full Stalwart 1.0 submission quota every one of
// them fails, so each has to say so; the automatic read receipt must not
// retry on every refresh either.

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

const QUOTA = 'There are too many email submissions, please delete some before adding a new one.';

const mailboxes: Mailbox[] = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

function makeEmail(overrides: Record<string, unknown> = {}): Email {
  return {
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
    textBody: [{ partId: '1', type: 'text/plain' }],
    htmlBody: [],
    attachments: [],
    bodyValues: { '1': { value: 'Hello Bob', isTruncated: false } },
    ...overrides,
  } as unknown as Email;
}

let toastError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastError = vi.spyOn(toast, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('viewer send failures', () => {
  it('reports a failed quick reply and keeps the text on Stalwart 1.0', async () => {
    const onQuickReply = vi.fn().mockRejectedValue(new SubmissionQuotaError(QUOTA));
    render(
      <EmailViewer email={makeEmail()} mailboxes={mailboxes} selectedMailbox="inbox" currentMailboxRole="inbox" onQuickReply={onQuickReply} />,
    );

    const box = screen.getByPlaceholderText('quick_reply_placeholder');
    fireEvent.change(box, { target: { value: 'Thanks!' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('submission_quota'));
    expect(onQuickReply).toHaveBeenCalledWith('Thanks!');
    expect((box as HTMLTextAreaElement).value).toBe('Thanks!');
  });

  it('waits for "Send now" and reports its failure on Stalwart 1.0', async () => {
    const onRescheduleScheduled = vi.fn().mockRejectedValue(new SubmissionQuotaError(QUOTA));
    render(
      <EmailViewer
        email={makeEmail({
          isScheduled: true,
          scheduledUndoStatus: 'pending',
          scheduledSendAt: new Date(Date.now() + 3_600_000).toISOString(),
          emailSubmissionId: 'sub-1',
          scheduledIdentityId: 'identity-1',
          keywords: { $seen: true },
        })}
        mailboxes={mailboxes}
        selectedMailbox="inbox"
        currentMailboxRole="inbox"
        onRescheduleScheduled={onRescheduleScheduled}
      />,
    );

    fireEvent.click(screen.getAllByText('send_now').at(-1)!);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('submission_quota'));
    expect(onRescheduleScheduled).toHaveBeenCalledTimes(1);
  });

  describe('automatic read receipts', () => {
    const MDN_HEADERS = { 'Disposition-Notification-To': 'Alice <alice@example.com>' };
    let sendReadReceipt: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      sendReadReceipt = vi.fn().mockRejectedValue(new SubmissionQuotaError(QUOTA));
      useSettingsStore.setState({ readReceiptResponse: 'always' });
      useAuthStore.setState({
        client: { sendReadReceipt } as never,
        identities: [{ id: 'identity-1', email: 'bob@example.com', name: 'Bob', mayDelete: false }] as never,
      });
    });

    afterEach(() => {
      useSettingsStore.setState({ readReceiptResponse: 'ask' });
      useAuthStore.setState({ client: null, identities: [] } as never);
    });

    it('tries once per opening, not once per refresh, when the quota is full on Stalwart 1.0', async () => {
      const props = { mailboxes, selectedMailbox: 'inbox', currentMailboxRole: 'inbox' };
      const { rerender } = render(<EmailViewer email={makeEmail({ headers: MDN_HEADERS })} {...props} />);

      await waitFor(() => expect(sendReadReceipt).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith('read_receipt.send_failed', { message: 'submission_quota' }));

      // Refreshes hand the viewer new objects for the same message.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          rerender(<EmailViewer email={makeEmail({ headers: MDN_HEADERS, preview: `refresh ${i}` })} {...props} />);
        });
      }
      expect(sendReadReceipt).toHaveBeenCalledTimes(1);

      // Opening another message and coming back tries again.
      await act(async () => {
        rerender(<EmailViewer email={makeEmail({ id: 'e2' })} {...props} />);
      });
      await act(async () => {
        rerender(<EmailViewer email={makeEmail({ headers: MDN_HEADERS })} {...props} />);
      });
      await waitFor(() => expect(sendReadReceipt).toHaveBeenCalledTimes(2));
    });
  });
});
