import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactStore } from '../contact-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Email } from '@/lib/jmap/types';

// Compose autocomplete learns recent recipients from the Sent folder. The
// mail view asks again whenever the folder list changes, which it does
// several times while signing in; the folder is read once.

describe('loadRecentRecipients', () => {
  beforeEach(() => {
    useContactStore.setState({ recentRecipients: [], recentRecipientsLoaded: false, sentMailboxId: null } as never);
  });

  it('reads the Sent folder once while a read is in flight, and keeps what it found', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sent = { id: 's1', to: [{ name: 'Bob', email: 'bob@example.com' }], cc: [] } as unknown as Email;
    const client = {
      getEmails: vi.fn(async () => { await gate; return { emails: [sent], hasMore: false, total: 1 }; }),
    } as unknown as IJMAPClient;

    const first = useContactStore.getState().loadRecentRecipients(client, 'sent');
    const second = useContactStore.getState().loadRecentRecipients(client, 'sent');
    release();
    await Promise.all([first, second]);
    await useContactStore.getState().loadRecentRecipients(client, 'sent');

    expect(client.getEmails).toHaveBeenCalledTimes(1);
    expect(useContactStore.getState().recentRecipients).toEqual([{ name: 'Bob', email: 'bob@example.com' }]);
  });
});
