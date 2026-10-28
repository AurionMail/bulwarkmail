import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';

vi.mock('@/components/plugins/plugin-slot', () => ({
  PluginSlot: () => null,
}));

import { EmailContextMenu } from '../email-context-menu';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { loadSharedTags, resetSharedTags, sharedTagsKey, useSharedTagsStore } from '@/stores/shared-tags-store';

// The context menu's tag list for a selection offers the tags of the
// selection's account (commonTagScope, like the toolbar), not those of the
// row that was right-clicked.

const TEAM = { loginId: 'login-1', accountId: 'team' };

// A message in the group account, right-clicked.
const email = {
  id: 'e1',
  threadId: 't1',
  mailboxIds: { 'team:inbox': true },
  keywords: { $seen: true },
  from: [{ email: 'alice@example.com' }],
  subject: 'Hello',
  receivedAt: '2026-01-01T00:00:00Z',
  size: 100,
  sourceClientAccountId: 'login-1',
  sourceAccountId: 'team',
} as unknown as Email;

const mailboxes = [{ id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } }] as unknown as Mailbox[];

function openTags(batchTagScope: typeof TEAM | null) {
  render(
    <EmailContextMenu
      email={email}
      position={{ x: 10, y: 10 }}
      isOpen
      onClose={vi.fn()}
      menuRef={{ current: null }}
      mailboxes={mailboxes}
      selectedMailbox="inbox"
      currentMailboxRole="inbox"
      isMultiSelect
      selectedCount={2}
      batchTagIds={[]}
      batchPartialTagIds={[]}
      batchTagScope={batchTagScope}
      onBatchToggleTag={vi.fn()}
    />,
  );
  act(() => { fireEvent.mouseEnter(screen.getByTestId('ctx-tag')); });
}

beforeEach(async () => {
  resetSharedTags();
  // The group's tags come through the real loading path.
  const client = {
    getAccountId: () => 'me',
    getSieveAccountId: () => 'me',
    supportsSieve: () => false,
    getSharedAccounts: () => [],
    getAccountInfo: () => ({ isPersonal: false }),
    getPrincipalTypes: async () => ({ team: 'group' }),
    advertisesBulwarkMetadata: () => true,
    supportsBulwarkMetadata: () => true,
    getBulwarkMetadata: async () => ({ tags: { tags: { urgent: { label: 'Team urgent', color: 'red' } } } }),
    discoverKeywords: async () => ({ keywords: {}, scanned: 0, total: 0, complete: true }),
  };
  useAuthStore.setState({
    client: client as never,
    activeAccountId: 'login-1',
    getClientForAccount: ((id: string) => (id === 'login-1' ? client : undefined)) as never,
  });
  useSettingsStore.setState({ emailKeywords: [{ id: 'mine', label: 'Mine', color: 'blue' }], nestedTags: false });
  await loadSharedTags(sharedTagsKey(TEAM.loginId, TEAM.accountId), TEAM.accountId, client);
  expect(useSharedTagsStore.getState().entries[sharedTagsKey(TEAM.loginId, TEAM.accountId)]?.status).toBe('ready');
});
afterEach(() => resetSharedTags());

describe('EmailContextMenu tags for a selection', () => {
  it('offers the group\'s shared tags when the whole selection is in the group', async () => {
    openTags(TEAM);
    expect(await screen.findByText('Team urgent')).toBeInTheDocument();
    expect(screen.queryByText('Mine')).not.toBeInTheDocument();
  });

  it('offers the own tags when the selection mixes accounts, even from a group row', async () => {
    openTags(null);
    expect(await screen.findByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText('Team urgent')).not.toBeInTheDocument();
  });
});
