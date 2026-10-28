import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '../settings-store';
import type { Mailbox, StateChange } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Every open tab gets every push. A hidden tab used to recount every tag on
// each one - two queries per tag - for badges nobody was looking at.

const inbox = { id: 'inbox', role: 'inbox', isShared: false } as Mailbox;

function makeClient() {
  return {
    getEmails: vi.fn(async () => ({ emails: [], total: 0, hasMore: false, state: 'email-state' })),
    getThreads: vi.fn(async () => []),
    getTagCounts: vi.fn(async () => ({ work: { total: 1, unread: 1 } })),
    getAccountId: () => 'account-a',
  } as unknown as IJMAPClient & { getTagCounts: ReturnType<typeof vi.fn> };
}

const push = (state: string): StateChange => ({ '@type': 'StateChange', changed: { 'account-a': { Email: state } } });

let hidden = false;
function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('tag counts on pushes in a hidden tab', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    hidden = false;
    client = makeClient();
    useAuthStore.setState(useAuthStore.getInitialState());
    useSettingsStore.setState({ emailKeywords: [{ id: 'work', label: 'Work', color: 'blue' }] } as never);
    useEmailStore.setState({ ...useEmailStore.getInitialState(), selectedMailbox: 'inbox', mailboxes: [inbox] });
  });

  afterEach(() => {
    hidden = false;
  });

  it('recounts on every push in a visible tab', async () => {
    await useEmailStore.getState().handleStateChange(push('1'), client);
    await useEmailStore.getState().handleStateChange(push('2'), client);

    await vi.waitFor(() => expect(client.getTagCounts).toHaveBeenCalledTimes(2));
  });

  it('waits until the tab is shown, then recounts once', async () => {
    setHidden(true);
    await useEmailStore.getState().handleStateChange(push('1'), client);
    await useEmailStore.getState().handleStateChange(push('2'), client);
    expect(client.getTagCounts).not.toHaveBeenCalled();

    setHidden(false);
    await vi.waitFor(() => expect(client.getTagCounts).toHaveBeenCalledTimes(1));

    setHidden(true);
    setHidden(false);
    await Promise.resolve();
    expect(client.getTagCounts).toHaveBeenCalledTimes(1);
  });

  it("does not recount again for the client's replay of the same states on return", async () => {
    setHidden(true);
    await useEmailStore.getState().handleStateChange(push('2'), client);
    setHidden(false);
    await vi.waitFor(() => expect(client.getTagCounts).toHaveBeenCalledTimes(1));

    await useEmailStore.getState().handleStateChange(push('2'), client);
    expect(client.getTagCounts).toHaveBeenCalledTimes(1);

    await useEmailStore.getState().handleStateChange(push('3'), client);
    await vi.waitFor(() => expect(client.getTagCounts).toHaveBeenCalledTimes(2));
  });
});
