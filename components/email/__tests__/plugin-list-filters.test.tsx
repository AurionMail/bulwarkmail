import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PluginListFilters } from '../plugin-list-filters';
import {
  activeListFilterCondition, clearPluginListFilters, resetListFilters, setPluginListFilters,
} from '@/lib/plugin-sandbox/list-filters';

// The chips plugins' list filters get in the list header (api.ui.setListFilters).
// The global next-intl mock returns the key, so labels read as keys.

const TEAM = { role: 'inbox', accountKind: 'group' as const };

beforeEach(() => {
  resetListFilters();
  setPluginListFilters('team-inbox', 'Team inbox', [
    { id: 'mine', label: 'Assigned to me', icon: 'user', hasKeyword: '$assigned:ci', accounts: ['group'], order: 1 },
    { id: 'open', label: 'Open', notKeyword: '$done', accounts: ['group'], order: 2 },
  ]);
});

describe('PluginListFilters', () => {
  it('shows the chips of a team folder, off at first', () => {
    render(<PluginListFilters mailboxRole="inbox" accountKind="group" onChange={() => {}} />);
    const chips = screen.getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Assigned to me', 'Open']);
    expect(chips.every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'filters');
  });

  it('shows nothing in the user\'s own folders', () => {
    const { container } = render(<PluginListFilters mailboxRole="inbox" accountKind="personal" onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('turns a filter on with a click, loads the list, and removes it with the next', () => {
    const onChange = vi.fn();
    render(<PluginListFilters mailboxRole="inbox" accountKind="group" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const active = screen.getByRole('button', { name: 'remove_filter' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active.querySelector('svg')).not.toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(activeListFilterCondition(TEAM)).toEqual({ notKeyword: '$done' });

    fireEvent.click(active);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'false');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(activeListFilterCondition(TEAM)).toBeNull();
  });

  it('loads the list again when the plugin that offered an active filter goes away', () => {
    const onChange = vi.fn();
    render(<PluginListFilters mailboxRole="inbox" accountKind="group" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    onChange.mockClear();

    act(() => clearPluginListFilters('team-inbox'));
    expect(screen.queryByRole('group')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
