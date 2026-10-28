import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEmailStore, annotateScheduledEmail, annotateScheduledEmails } from '../email-store';
import type { Email } from '@/lib/jmap/types';

function makeEmail(id: string, threadId = `thread-${id}`): Email {
  return {
    id,
    threadId,
    mailboxIds: { inbox: true },
    keywords: {},
    size: 100,
    receivedAt: new Date().toISOString(),
    from: [{ name: 'Test', email: 'test@example.com' }],
    to: [{ name: 'User', email: 'user@example.com' }],
    subject: `Email ${id}`,
    preview: 'preview',
    hasAttachment: false,
    textBody: [],
    htmlBody: [],
    bodyValues: {},
    sourceClientAccountId: 'login-1',
    sourceAccountId: 'acc-1',
  };
}

describe('scheduled email annotation in email-store', () => {
  // Keyed like the store's map: login, account, then the message id.
  const metadataMap = new Map([
    ['login-1|acc-1|email-scheduled', {
      submissionId: 'sub-1',
      sendAt: '2026-10-30T10:00:00Z',
      identityId: 'id-1',
      undoStatus: 'pending' as const,
      accountId: 'acc-1',
    }],
  ]);

  beforeEach(() => {
    vi.restoreAllMocks();
    useEmailStore.setState({
      emails: [makeEmail('email-1'), makeEmail('email-scheduled')],
      selectedEmail: null,
      scheduledSubmissionByEmailId: metadataMap,
      scheduledEmailIds: new Set(['email-scheduled']),
    });
  });

  it('annotates email with scheduled properties when present in scheduledSubmissionByEmailId', () => {
    const email = makeEmail('email-scheduled');
    const annotated = annotateScheduledEmail(email, metadataMap);

    expect(annotated.isScheduled).toBe(true);
    expect(annotated.scheduledSendAt).toBe('2026-10-30T10:00:00Z');
    expect(annotated.emailSubmissionId).toBe('sub-1');
    expect(annotated.scheduledUndoStatus).toBe('pending');
    expect(annotated.scheduledAccountId).toBe('acc-1');
  });

  it('returns identical reference when email is not scheduled and not in metadata', () => {
    const email = makeEmail('email-1');
    const annotated = annotateScheduledEmail(email, metadataMap);

    expect(annotated).toBe(email);
    expect(annotated.isScheduled).toBeUndefined();
  });

  it('removes scheduled properties when email is no longer in scheduled metadata', () => {
    const previouslyScheduled: Email = {
      ...makeEmail('email-no-longer-scheduled'),
      isScheduled: true,
      scheduledSendAt: '2026-10-30T10:00:00Z',
      emailSubmissionId: 'sub-old',
    };
    const cleaned = annotateScheduledEmail(previouslyScheduled, new Map());

    expect(cleaned.isScheduled).toBeUndefined();
    expect(cleaned.scheduledSendAt).toBeUndefined();
    expect(cleaned.emailSubmissionId).toBeUndefined();
  });

  it('annotates a list of emails in annotateScheduledEmails', () => {
    const emails = [makeEmail('email-1'), makeEmail('email-scheduled')];
    const annotatedList = annotateScheduledEmails(emails, metadataMap);

    expect(annotatedList[0].isScheduled).toBeUndefined();
    expect(annotatedList[0]).toBe(emails[0]);
    expect(annotatedList[1].isScheduled).toBe(true);
    expect(annotatedList[1].scheduledSendAt).toBe('2026-10-30T10:00:00Z');
  });

  it('returns original array reference if scheduledSubmissionByEmailId is empty', () => {
    const emails = [makeEmail('email-1')];
    const result = annotateScheduledEmails(emails, new Map());
    expect(result).toBe(emails);
  });

  it('preserves email object reference across selectEmail, beginOpenEmail, and finishOpenEmail', () => {
    // Ensuring reference identity is preserved for plugin open/close hooks
    const email = makeEmail('email-1');
    useEmailStore.getState().selectEmail(email);
    expect(useEmailStore.getState().selectedEmail).toBe(email);

    useEmailStore.getState().beginOpenEmail(email);
    expect(useEmailStore.getState().selectedEmail).toBe(email);

    useEmailStore.getState().finishOpenEmail(email);
    expect(useEmailStore.getState().selectedEmail).toBe(email);
  });
});
