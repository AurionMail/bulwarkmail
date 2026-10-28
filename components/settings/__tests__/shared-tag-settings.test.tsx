import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedTagSettings, maySetSharedTags } from '../shared-tag-settings';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { resetSharedTags } from '@/stores/shared-tags-store';

// Settings > Folders & tags > Shared tags: the editor of each group
// mailbox's tags, read-only when the admin locked them, and a note instead of
// an editor where the server keeps no metadata.

const URGENT = { id: 'urgent', label: 'Urgent', color: 'red' };
const RIGHTS = { mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, mayCreateChild: true, mayRename: true, mayDelete: true, maySubmit: true };

let stored: Record<string, unknown>;
let keywords: Record<string, number>;
let metadata: boolean;
const client = {
  getAccountId: () => 'me',
  getAccountInfo: (id: string) => ({ isPersonal: id === 'me' }),
  getSharedAccounts: () => [
    { id: 'me', name: 'org-alice@example.org', isPrimary: true, capabilities: { mail: true } },
    { id: 'team', name: 'org-team@example.org', isPrimary: false, capabilities: { mail: true } },
  ],
  getPrincipalTypes: async () => ({ team: 'group' }),
  supportsBulwarkMetadata: () => metadata,
  getBulwarkMetadata: vi.fn(async () => stored),
  setBulwarkMetadata: vi.fn(async (_id: string | undefined, key: string, value: unknown) => { stored = { ...stored, [key]: value }; }),
  discoverKeywords: async () => ({ keywords, scanned: 0, total: 0, complete: true }),
  getMailboxes: async () => [],
};

function setRights(rights: Record<string, boolean>) {
  useEmailStore.setState({ mailboxes: [{ id: 'team:a', name: 'Inbox', role: 'inbox', accountId: 'team', isShared: true, myRights: rights } as never] });
}

function setLocked(locked: boolean) {
  usePolicyStore.setState({ policy: { ...DEFAULT_POLICY, restrictions: locked ? { sharedTags: { locked: true } } : {} } });
}

beforeEach(() => {
  resetSharedTags();
  stored = { tags: { list: [URGENT] } };
  keywords = {};
  metadata = true;
  client.getBulwarkMetadata.mockClear();
  client.setBulwarkMetadata.mockClear();
  useSettingsStore.setState({ emailKeywords: [], nestedTags: false });
  useAuthStore.setState({
    client: client as never,
    activeAccountId: 'login-1',
    getClientForAccount: ((id: string) => (id === 'login-1' ? client : undefined)) as never,
  });
  setLocked(false);
  setRights({ ...RIGHTS, maySetMetadata: true });
});
afterEach(() => resetSharedTags());

describe('SharedTagSettings', () => {
  it('lets a member who may change the Inbox add a shared tag', async () => {
    render(<SharedTagSettings />);
    expect(await screen.findByText('Urgent')).toBeInTheDocument();
    fireEvent.click(screen.getByText('add'));
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Waiting' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(client.setBulwarkMetadata).toHaveBeenCalledWith('team', 'tags', {
      list: [URGENT, { id: 'waiting', label: 'Waiting', color: 'blue' }],
    }));
    expect(await screen.findByText('Waiting')).toBeInTheDocument();
  });

  it('shows the tags read-only with "Set by your organisation" when the admin locked them', async () => {
    setLocked(true);
    const { container } = render(<SharedTagSettings />);
    expect(await screen.findByText('Urgent')).toBeInTheDocument();
    expect(container.querySelector('[data-org-locked]')).not.toBeNull();
    expect(screen.queryByText('add')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('delete')).not.toBeInTheDocument();
  });

  it('is read-only with a note for a member without the right to change the Inbox', async () => {
    setRights({ ...RIGHTS, maySetMetadata: false });
    render(<SharedTagSettings />);
    expect(await screen.findByTestId('shared-tags-no-rights')).toHaveTextContent('no_rights');
    expect(screen.queryByText('add')).not.toBeInTheDocument();
  });

  it('says in one line that the server keeps no shared tags, with no editor', async () => {
    metadata = false;
    render(<SharedTagSettings />);
    expect(await screen.findByTestId('shared-tags-unsupported')).toHaveTextContent('unsupported');
    expect(screen.queryByText('add')).not.toBeInTheDocument();
    expect(client.getBulwarkMetadata).not.toHaveBeenCalled();
  });

  it('offers to name a tag found on the messages, keeping its id', async () => {
    keywords = { '$label:waiting-for-customer': 2 };
    render(<SharedTagSettings />);
    fireEvent.click(await screen.findByLabelText('name_it'));
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Customer' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(client.setBulwarkMetadata).toHaveBeenCalledWith('team', 'tags', {
      list: [URGENT, { id: 'waiting-for-customer', label: 'Customer', color: expect.any(String) }],
    }));
  });
});

describe('maySetSharedTags', () => {
  it('follows maySetMetadata, and renaming where the server has no such right', () => {
    expect(maySetSharedTags({ maySetMetadata: true, mayRename: false })).toBe(true);
    expect(maySetSharedTags({ maySetMetadata: false, mayRename: true })).toBe(false);
    expect(maySetSharedTags({ mayRename: true })).toBe(true);
    expect(maySetSharedTags(null)).toBe(false);
  });
});
