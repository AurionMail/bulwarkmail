import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetActions, setActionDispatcher, setPluginActions } from '@/lib/plugin-sandbox/actions';

// The top bar's plugin buttons (top-bar-actions): next to the search field in
// Mountain View's bar, and in the phone header's overflow menu.

vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/components/search/search-box', () => ({ SearchBox: () => <input data-testid="search" /> }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-stalwart-admin', () => ({ useStalwartAdmin: () => false }));

const { MvTopBar } = await import('../mv-top-bar');
const { MobileHeader } = await import('../mobile-header');

const dispatch = vi.fn().mockResolvedValue(undefined);

const search = {
  query: '', onQueryChange: vi.fn(), onSubmit: vi.fn(), onClear: vi.fn(), onSelectContact: vi.fn(),
  onToggleFilters: vi.fn(), filtersOpen: false, activeFilterCount: 0,
};

beforeEach(() => {
  resetActions();
  dispatch.mockClear();
  setActionDispatcher(dispatch);
});

describe('Mountain View top bar', () => {
  it('has no plugin buttons when no plugin declared any', () => {
    const { container } = render(<MvTopBar search={search} />);
    expect(container.querySelector('[data-plugin-actions="top-bar-actions"]')).toBeNull();
  });

  it('puts plugin buttons right after the search field and sends the click', async () => {
    act(() => setPluginActions('tr', 'Translator', 'top-bar-actions', [{ id: 'go', label: 'Translate', icon: 'Languages' }]));
    const { container } = render(<MvTopBar search={search} />);

    const group = container.querySelector('[data-plugin-actions="top-bar-actions"]')!;
    expect(group).not.toBeNull();
    const searchField = screen.getByTestId('search');
    expect(searchField.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Translate' });
    // Compact: icon only, the label as tooltip.
    expect(button).toHaveAttribute('title', 'Translate (Translator)');
    await act(async () => { fireEvent.click(button); });
    expect(dispatch).toHaveBeenCalledWith('tr', 'top-bar-actions', 'go', {});
  });
});

describe('phone header', () => {
  it('has no overflow menu when no plugin declared buttons', () => {
    render(<MobileHeader title="Inbox" />);
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });

  it('lists plugin buttons in its overflow menu', async () => {
    act(() => setPluginActions('tr', 'Translator', 'top-bar-actions', [{ id: 'go', label: 'Translate' }]));
    render(<MobileHeader title="Inbox" />);

    const more = screen.getByRole('button', { name: 'more' });
    expect(screen.queryByRole('menuitem', { name: 'Translate' })).toBeNull();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');

    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Translate' })); });
    expect(dispatch).toHaveBeenCalledWith('tr', 'top-bar-actions', 'go', {});
    // The menu closes on the click.
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
