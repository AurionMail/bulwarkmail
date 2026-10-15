import { beforeEach, describe, expect, it } from 'vitest';
import { useEmailStore } from '@/stores/email-store';

// On a first load the folders arrive before the first page of mail. If the
// folder fetch turned isLoading off, the list showed "No emails" until the
// page fetch turned it on again, then a fresh skeleton.

const initialState = useEmailStore.getState();

const clientWith = (mailboxes: unknown[]) => ({
  getAllMailboxesWithState: async () => ({ mailboxes, states: {} }),
});

beforeEach(() => {
  useEmailStore.setState(initialState, true);
});

describe('fetchMailboxes on a first load', () => {
  it('leaves the list loading for the page fetch that follows', async () => {
    const inbox = { id: 'inbox', name: 'Inbox', role: 'inbox', totalEmails: 3, unreadEmails: 0, sortOrder: 0 };
    await useEmailStore.getState().fetchMailboxes(clientWith([inbox]) as never);

    expect(useEmailStore.getState().selectedMailbox).toBe('inbox');
    expect(useEmailStore.getState().isLoading).toBe(true);
  });

  it('stops loading when the server has no folders', async () => {
    await useEmailStore.getState().fetchMailboxes(clientWith([]) as never);

    expect(useEmailStore.getState().isLoading).toBe(false);
  });
});
