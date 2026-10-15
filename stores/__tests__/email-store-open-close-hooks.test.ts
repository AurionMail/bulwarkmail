import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import type { Email } from '@/lib/jmap/types';

const email = (id: string) => ({
  id, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: {}, subject: `Subject ${id}`,
  from: [{ name: 'Bob', email: 'bob@example.org' }], to: [], receivedAt: '2026-10-01T00:00:00Z',
  preview: 'p', size: 1, hasAttachment: false, blobId: 'raw-blob',
} as unknown as Email);

beforeEach(() => {
  clearAllHooks();
  useEmailStore.setState({ selectedEmail: null });
});

describe('message open and close hooks', () => {
  it('hands plugins plain views, not the store object', () => {
    const opened = vi.fn();
    const closed = vi.fn();
    emailHooks.onEmailOpen.register('t', opened);
    emailHooks.onEmailClose.register('t', closed);

    useEmailStore.getState().selectEmail(email('a'));
    useEmailStore.getState().selectEmail(email('b'));

    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened.mock.calls[0][0]).toMatchObject({ id: 'a', subject: 'Subject a', from: [{ name: 'Bob', email: 'bob@example.org' }] });
    expect(opened.mock.calls[0][0]).not.toHaveProperty('blobId');
    expect(closed).toHaveBeenCalledWith({ emailId: 'a' });
  });
});
