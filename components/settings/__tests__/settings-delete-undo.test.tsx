import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { useFilterStore } from '@/stores/filter-store';
import { useSettingsStore, DEFAULT_KEYWORDS } from '@/stores/settings-store';
import { FilterSettings } from '../filter-settings';
import { KeywordSettings } from '../keyword-settings';

// R3: a tag or a filter rule can be put back exactly as it was, so Delete
// removes it at once, without a question or an inline Delete/Cancel strip,
// and the toast offers Undo.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast }));
vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

type UndoOptions = { action: { label: string; onClick: () => void } };
const undo = () => (toast.success.mock.calls.at(-1)?.[1] as UndoOptions).action;

const initial = {
  auth: useAuthStore.getState(),
  email: useEmailStore.getState(),
  filter: useFilterStore.getState(),
  settings: useSettingsStore.getState(),
};
beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => {
  useAuthStore.setState(initial.auth, true);
  useEmailStore.setState(initial.email, true);
  useFilterStore.setState(initial.filter, true);
  useSettingsStore.setState(initial.settings, true);
});

describe('deleting a tag', () => {
  it('goes at once and Undo puts it back in its place', () => {
    useSettingsStore.setState({ emailKeywords: [...DEFAULT_KEYWORDS], nestedTags: false });
    render(<KeywordSettings />);
    const second = DEFAULT_KEYWORDS[1];

    // Each Delete is named after its tag (the mocked t returns the key).
    fireEvent.click(screen.getAllByRole('button', { name: 'delete_tag' })[1]);

    expect(useSettingsStore.getState().emailKeywords.map((k) => k.id)).not.toContain(second.id);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('deleted', expect.objectContaining({ action: expect.anything() }));
    expect(undo().label).toBe('rule_undo');

    undo().onClick();
    expect(useSettingsStore.getState().emailKeywords.map((k) => k.id)).toEqual(DEFAULT_KEYWORDS.map((k) => k.id));
  });
});

describe('deleting a filter rule', () => {
  const rule = (id: string): FilterRule => ({
    id, name: `Rule ${id}`, enabled: true, matchType: 'all',
    conditions: [{ field: 'from', comparator: 'contains', value: '@' }],
    actions: [{ type: 'star' }], stopProcessing: false,
  });

  it('goes at once, with Undo that saves it back in its place', async () => {
    const updateSieveScript = vi.fn(async () => {});
    useAuthStore.setState({ client: { updateSieveScript, getSieveAccountId: () => 'primary' } as never });
    useEmailStore.setState({ fetchMailboxes: vi.fn(async () => {}) as never });
    useFilterStore.setState({
      rules: [rule('a'), rule('b'), rule('c')],
      isSupported: true, isLoading: false, isOpaque: false, activeScriptId: 'script-1',
      selectedAccountId: 'primary', sieveCapabilities: null, selectAccount: vi.fn(async () => {}),
    });
    render(<FilterSettings />);

    fireEvent.click(screen.getAllByRole('button', { name: 'delete_rule' })[1]);

    // No inline Delete/Cancel strip: the rule is gone and saved without it.
    expect(screen.queryByText('confirm_delete')).toBeNull();
    await waitFor(() => expect(updateSieveScript).toHaveBeenCalledTimes(1));
    expect(useFilterStore.getState().rules.map((r) => r.id)).toEqual(['a', 'c']);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('filters_deleted', expect.anything()));

    undo().onClick();
    expect(useFilterStore.getState().rules.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    await waitFor(() => expect(updateSieveScript).toHaveBeenCalledTimes(2));
  });
});
