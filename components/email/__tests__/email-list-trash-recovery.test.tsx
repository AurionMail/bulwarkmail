import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { JMAPClient } from '@/lib/jmap/client';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import { useRecoveryStore } from '@/stores/recovery-store';
import { usePolicyStore } from '@/stores/policy-store';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { EmailList } from '../email-list';

// The Trash folder's header links to Recover deleted items when the server
// offers it; other folders don't show the line.

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-email-drag', () => ({ useEmailDrag: () => ({ dragHandlers: {}, isDragging: false }) }));
vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ stalwartFeaturesEnabled: true, isLoading: false }) }));

const initialEmail = useEmailStore.getState();
const initialAuth = useAuthStore.getState();
const initialPolicy = usePolicyStore.getState();

function mailbox(id: string, role: string): Mailbox {
  return { id, name: id, role, accountId: 'c', totalEmails: 1, unreadEmails: 0, totalThreads: 1, unreadThreads: 0,
    myRights: { mayReadItems: true, mayAddItems: true, mayRemoveItems: true } } as Mailbox;
}

function show(selected: 'trash' | 'inbox') {
  const emails = [{ id: 'm1', threadId: 't1', blobId: 'b1', mailboxIds: { [selected]: true }, keywords: {}, subject: 'Hello',
    receivedAt: '2026-10-01T00:00:00Z', from: [{ email: 'org-bob@example.org' }], size: 1, hasAttachment: false } as Email];
  useEmailStore.setState({ emails, mailboxes: [mailbox('trash', 'trash'), mailbox('inbox', 'inbox')], selectedMailbox: selected, totalEmails: 1 });
  return render(<EmailList emails={emails} />);
}

beforeEach(() => {
  const client = JMAPClient.withBearer('https://list.example.invalid', 'synthetic', 'org-alice@example.org');
  Object.assign(client, { apiUrl: 'https://list.example.invalid/jmap', accountId: 'c' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ methodResponses: [] }))));
  useAuthStore.setState({ activeAccountId: 'acc-alice', client, getClientForAccount: () => client } as never);
  useEmailStore.setState(initialEmail, true);
  usePolicyStore.setState({ loaded: true, subject: { email: client.getUsername().toLowerCase(), groups: [] } });
  // Detection and the look for a recent message already answered for this account.
  useRecoveryStore.setState({
    checks: { 'acc-alice|c': { supported: true, retryAt: null } },
    recent: { 'acc-alice|c': { has: true, days: 0, checkedAt: Date.now() } },
  });
});

afterEach(() => {
  useRecoveryStore.getState().reset();
  usePolicyStore.setState(initialPolicy, true);
  useAuthStore.setState(initialAuth, true);
  vi.unstubAllGlobals();
});

describe('EmailList and Recover deleted items', () => {
  it('shows the link in Trash', async () => {
    show('trash');
    await waitFor(() => expect(screen.getByTestId('trash-recovery-link')).toBeTruthy());
  });

  it('leaves it out of other folders', async () => {
    show('inbox');
    await screen.findByText('no_more_emails');
    expect(screen.queryByTestId('trash-recovery-link')).toBeNull();
  });
});
