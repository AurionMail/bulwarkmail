import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TagBadge } from '@/components/email/tag-badge';
import { TagPicker } from '@/components/email/tag-picker';
import { TagScopeContext, tagScopeOf, type TagScope } from '../use-account-tags';
import { useAuthStore } from '@/stores/auth-store';
import { KEYWORD_PALETTE, useSettingsStore } from '@/stores/settings-store';
import { resetSharedTags, sharedTagsKey, useSharedTagsStore, type SharedTagsEntry } from '@/stores/shared-tags-store';

// A message in a group account shows the group's shared tag names and
// colours; everywhere else, and wherever the shared ones aren't known, the
// user's own tags apply as before.

const TEAM: TagScope = { loginId: 'login-1', accountId: 'team' };
const OTHER_TEAM: TagScope = { loginId: 'login-1', accountId: 'other-team' };

function setEntry(scope: TagScope, entry: Partial<SharedTagsEntry>) {
  useSharedTagsStore.setState((state) => ({
    entries: {
      ...state.entries,
      [sharedTagsKey(scope.loginId, scope.accountId)]: { status: 'ready', tags: [], stored: null, pending: [], discovered: {}, loadedAt: 1, discoveredAt: 1, readFailedAt: null, ...entry },
    },
  }));
}

function badge(tagId: string, scope?: TagScope | null) {
  return render(<TagBadge tagId={tagId} variant="badge" scope={scope} />);
}

beforeEach(() => {
  resetSharedTags();
  // No signed-in client: the entries below stay what the test sets.
  useAuthStore.setState({ client: null, activeAccountId: null, getClientForAccount: (() => undefined) as never });
  useSettingsStore.setState({ emailKeywords: [{ id: 'urgent', label: 'My urgent', color: 'blue' }], nestedTags: false });
});
afterEach(() => resetSharedTags());

describe('tag names and colours per account', () => {
  it('uses the shared definition in a group account and the own one elsewhere', () => {
    setEntry(TEAM, { tags: [{ id: 'urgent', label: 'Urgent', color: 'red' }] });
    badge('urgent', TEAM);
    expect(screen.getByTitle('Urgent')).toHaveClass(KEYWORD_PALETTE.red.fill);
    badge('urgent', null);
    expect(screen.getByText('My urgent')).toBeInTheDocument();
  });

  it('keeps the own tags in a group account whose server keeps no metadata', () => {
    setEntry(TEAM, { status: 'unsupported' });
    badge('urgent', TEAM);
    expect(screen.getByText('My urgent')).toBeInTheDocument();
  });

  it('keeps the own tags while the shared ones couldn\'t be read', () => {
    setEntry(TEAM, { status: 'unavailable', tags: [{ id: 'urgent', label: 'Stale', color: 'red' }] });
    badge('urgent', TEAM);
    expect(screen.getByText('My urgent')).toBeInTheDocument();
  });

  it('keeps the own tags in a mailbox a person shared', () => {
    setEntry(TEAM, { status: 'personal' });
    badge('urgent', TEAM);
    expect(screen.getByText('My urgent')).toBeInTheDocument();
  });

  it('applies definitions that arrive after the message was drawn', () => {
    setEntry(TEAM, { status: 'loading' });
    badge('urgent', TEAM);
    expect(screen.getByText('My urgent')).toBeInTheDocument();
    act(() => setEntry(TEAM, { status: 'ready', tags: [{ id: 'urgent', label: 'Urgent', color: 'red' }] }));
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.queryByText('My urgent')).not.toBeInTheDocument();
  });

  it('names each message by its own account in a mixed list', () => {
    setEntry(TEAM, { tags: [{ id: 'urgent', label: 'Team urgent', color: 'red' }] });
    setEntry(OTHER_TEAM, { tags: [{ id: 'urgent', label: 'Sales urgent', color: 'green' }] });
    render(
      <>
        <TagScopeContext.Provider value={TEAM}><TagBadge tagId="urgent" variant="badge" /></TagScopeContext.Provider>
        <TagScopeContext.Provider value={OTHER_TEAM}><TagBadge tagId="urgent" variant="badge" /></TagScopeContext.Provider>
        <TagBadge tagId="urgent" variant="badge" />
      </>,
    );
    expect(screen.getByText('Team urgent')).toBeInTheDocument();
    expect(screen.getByText('Sales urgent')).toBeInTheDocument();
    expect(screen.getByText('My urgent')).toBeInTheDocument();
  });
});

describe('the tag picker in a group account', () => {
  it('offers the shared tags and every tag found on the messages, not the own ones', () => {
    setEntry(TEAM, {
      tags: [{ id: 'urgent', label: 'Urgent', color: 'red' }],
      discovered: { '$label:waiting-for-customer': 2 },
    });
    useSettingsStore.setState({ emailKeywords: [{ id: 'private', label: 'Private', color: 'blue' }] });
    render(<TagPicker selectedIds={['only-on-this-one']} onToggle={() => {}} scope={TEAM} />);
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('Waiting For Customer')).toBeInTheDocument();
    // A keyword on the message is never hidden, named or not.
    expect(screen.getByText('only-on-this-one')).toBeInTheDocument();
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
    expect(screen.getByTestId('tag-picker-shared')).toHaveTextContent('picker_heading');
  });

  it('offers the own tags without a scope', () => {
    setEntry(TEAM, { tags: [{ id: 'urgent', label: 'Urgent', color: 'red' }] });
    render(<TagPicker selectedIds={[]} onToggle={() => {}} scope={null} />);
    expect(screen.getByText('My urgent')).toBeInTheDocument();
    expect(screen.queryByTestId('tag-picker-shared')).not.toBeInTheDocument();
  });
});

describe('tagScopeOf', () => {
  beforeEach(() => {
    const client = { getAccountId: () => 'me' };
    useAuthStore.setState({
      client: client as never,
      activeAccountId: 'login-1',
      getClientForAccount: ((id: string) => (id === 'login-1' ? client : undefined)) as never,
    });
  });

  it('names the group account of a message reached through a login', () => {
    expect(tagScopeOf({ sourceClientAccountId: 'login-1', sourceAccountId: 'team' })).toEqual(TEAM);
  });

  it('is null for a message in the login\'s own account', () => {
    expect(tagScopeOf({ sourceClientAccountId: 'login-1', sourceAccountId: 'me' })).toBeNull();
    expect(tagScopeOf(null)).toBeNull();
  });
});
