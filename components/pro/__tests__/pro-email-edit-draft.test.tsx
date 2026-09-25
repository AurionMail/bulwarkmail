import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

/**
 * "Edit draft" on a message in a Pro folder or email tab. A draft in a group or
 * shared folder lives in that account - an undone send from the group's
 * identity goes back to the group's Drafts on Stalwart 1.0 and 0.16.23 - and
 * email ids repeat across accounts, so the composer has to know the account to
 * remove the old version there when it saves, sends or discards.
 */

const viewerProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@/components/email/email-viewer', () => ({
  EmailViewer: (props: Record<string, unknown>) => {
    viewerProps.current = props;
    return null;
  },
}));

vi.mock('@/components/error', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  EmailViewerErrorFallback: () => null,
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/stores/toast-store', () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock('@/hooks/use-pro-multi-account-identities', () => ({
  useProMultiAccountIdentities: () => ({ enabled: false, groups: [], allIdentities: [] }),
}));

const { openComposeTab } = vi.hoisted(() => ({ openComposeTab: vi.fn() }));

function selectorStore<T extends object>(state: T) {
  const hook = (sel?: (s: T) => unknown) => (typeof sel === 'function' ? sel(state) : state);
  hook.getState = () => state;
  return hook;
}

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: selectorStore({ client: null, getClientForAccount: () => undefined }),
}));
vi.mock('@/stores/email-store', () => ({
  useEmailStore: selectorStore({
    // An own-folder message is read through the store, not by account.
    fetchEmailContent: async (_client: unknown, id: string) => ({ ...DRAFT, id, mailboxIds: { d: true } }),
    deleteEmail: async () => {},
    markAsRead: async () => {},
    toggleStar: async () => {},
    moveToMailbox: async () => {},
    setEmailKeywordsLocal: () => {},
    mailboxes: [],
  }),
}));
vi.mock('@/stores/identity-store', () => ({
  useIdentityStore: selectorStore({ identities: [{ id: 'b', email: 'team@example.org', name: 'Team' }] }),
}));
vi.mock('@/stores/settings-store', () => ({ useSettingsStore: selectorStore({}) }));
vi.mock('@/stores/pro-tab-store', () => ({
  useProTabStore: selectorStore({ openComposeTab, closeTab: () => {}, updateTabTitle: () => {} }),
}));

import { ProEmailView } from '../pro-email-tab-body';

const DRAFT = {
  id: 'eaaaaab',
  threadId: 't1',
  mailboxIds: { 'c:d': true },
  keywords: { $draft: true, $seen: true },
  from: [{ email: 'team@example.org', name: 'Team' }],
  to: [{ email: 'bob@example.com' }],
  subject: 'Back from undo',
  bodyValues: { '1': { value: 'Hi' } },
  textBody: [{ partId: '1', type: 'text/plain' }],
  htmlBody: [{ partId: '1', type: 'text/plain' }],
  attachments: [],
};

describe('Pro email view - editing a draft', () => {
  beforeEach(() => {
    viewerProps.current = null;
    openComposeTab.mockClear();
  });

  async function openAndEdit(accountId?: string) {
    const client = { getEmail: vi.fn().mockResolvedValue(DRAFT), getUsername: () => 'userb@example.org' };
    render(<ProEmailView emailId="eaaaaab" client={client as never} accountId={accountId} onClose={vi.fn()} />);
    await waitFor(() => expect(viewerProps.current?.email).toBeTruthy());
    (viewerProps.current!.onEditDraft as () => void)();
    return openComposeTab.mock.calls[0][0].initialData as Record<string, unknown>;
  }

  it('opens a draft of a group folder with the group account', async () => {
    const initialData = await openAndEdit('c');

    expect(initialData).toMatchObject({ draftId: 'eaaaaab', draftAccountId: 'c' });
  });

  it('opens an own draft without an account, as before', async () => {
    const initialData = await openAndEdit(undefined);

    expect(initialData.draftId).toBe('eaaaaab');
    expect(initialData.draftAccountId).toBeUndefined();
  });
});
