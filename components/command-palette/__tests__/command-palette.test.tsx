import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetActions, setActionDispatcher, setPluginActions } from '@/lib/plugin-sandbox/actions';

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key,
  useLocale: () => 'en',
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: nav.push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/keyboard-shortcuts-modal', () => ({
  KeyboardShortcutsModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>shortcuts help</div> : null),
}));

const { CommandPaletteHost } = await import('../command-palette');
const { useAuthStore } = await import('@/stores/auth-store');
const { useThemeStore } = await import('@/stores/theme-store');
const appCommands = await import('@/lib/app-commands');

const dispatch = vi.fn().mockResolvedValue(undefined);
const pressCtrlK = (target: Element = document.body) =>
  act(() => { fireEvent.keyDown(target, { key: 'k', code: 'KeyK', ctrlKey: true }); });

beforeEach(() => {
  nav.pathname = '/';
  nav.push.mockClear();
  resetActions();
  dispatch.mockClear();
  setActionDispatcher(dispatch);
  useAuthStore.setState({ isAuthenticated: true, client: null } as never);
});
afterEach(() => {
  appCommands.parkAppCommand(null as never);
});

describe('command palette', () => {
  it('opens on Ctrl+K with the search field focused, and closes on Escape', () => {
    render(<CommandPaletteHost />);
    expect(screen.queryByRole('dialog')).toBeNull();

    pressCtrlK();
    expect(screen.getByRole('dialog', { name: 'title' })).toBeInTheDocument();
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);

    act(() => { fireEvent.keyDown(input, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from a menu entry (phones)', () => {
    render(<CommandPaletteHost />);
    act(() => appCommands.openCommandPalette());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('leaves Ctrl+K alone while typing in a field', () => {
    render(<><input aria-label="other field" /><CommandPaletteHost /></>);
    pressCtrlK(screen.getByLabelText('other field'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves Ctrl+K to global search in the Pro shell, and does nothing signed out', () => {
    nav.pathname = '/pro';
    const { unmount } = render(<CommandPaletteHost />);
    pressCtrlK();
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    nav.pathname = '/';
    useAuthStore.setState({ isAuthenticated: false } as never);
    render(<CommandPaletteHost />);
    pressCtrlK();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the app commands and no plugin group without plugin entries', () => {
    render(<CommandPaletteHost />);
    pressCtrlK();

    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toContain('go_to(mail)');
    expect(labels).toContain('go_to(settings)');
    expect(labels).toContain('compose');
    expect(labels).toContain('shortcuts');
    expect(screen.queryByText('group_plugins')).toBeNull();
  });

  it('shows plugin entries with the plugin name and runs them with Enter', async () => {
    act(() => setPluginActions('jira', 'Jira', 'command-palette', [{ id: 'new-issue', label: 'Create issue' }]));
    render(<CommandPaletteHost />);
    pressCtrlK();

    expect(screen.getByText('group_plugins')).toBeInTheDocument();
    const option = screen.getByRole('option', { name: /Create issue/ });
    expect(option).toHaveTextContent('Jira');

    const input = screen.getByRole('combobox');
    act(() => { fireEvent.change(input, { target: { value: 'issue' } }); });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id);

    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(dispatch).toHaveBeenCalledWith('jira', 'command-palette', 'new-issue', {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('finds plugin entries by plugin name too', () => {
    act(() => setPluginActions('jira', 'Jira', 'command-palette', [{ id: 'new-issue', label: 'Create issue' }]));
    render(<CommandPaletteHost />);
    pressCtrlK();
    act(() => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jir' } }); });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-command-id'))).toEqual(['plugin:jira:new-issue']);
  });

  it('moves with the arrow keys and wraps around', () => {
    render(<CommandPaletteHost />);
    pressCtrlK();
    const input = screen.getByRole('combobox');
    const options = () => screen.getAllByRole('option');

    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    act(() => { fireEvent.keyDown(input, { key: 'ArrowDown' }); });
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    act(() => { fireEvent.keyDown(input, { key: 'ArrowUp' }); });
    act(() => { fireEvent.keyDown(input, { key: 'ArrowUp' }); });
    expect(options()[options().length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates with a go-to command', () => {
    render(<CommandPaletteHost />);
    pressCtrlK();
    act(() => { fireEvent.click(screen.getByRole('option', { name: 'go_to(settings)' })); });
    expect(nav.push).toHaveBeenCalledWith('/settings');
  });

  it('hands compose to the mail page, or opens mail first and parks it', () => {
    const taken = vi.fn((e: Event) => e.preventDefault());
    window.addEventListener('bulwark:app-command', taken);
    render(<CommandPaletteHost />);
    pressCtrlK();
    act(() => { fireEvent.click(screen.getByRole('option', { name: 'compose' })); });
    expect(taken).toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    window.removeEventListener('bulwark:app-command', taken);

    pressCtrlK();
    act(() => { fireEvent.click(screen.getByRole('option', { name: 'compose' })); });
    expect(nav.push).toHaveBeenCalledWith('/');
    expect(appCommands.peekParkedAppCommand()).toBe('compose');
  });

  it('switches the theme and shows the keyboard shortcuts', () => {
    useThemeStore.setState({ resolvedTheme: 'light' } as never);
    const setTheme = vi.fn();
    useThemeStore.setState({ setTheme } as never);
    render(<CommandPaletteHost />);
    pressCtrlK();
    act(() => { fireEvent.click(screen.getByRole('option', { name: 'theme_dark' })); });
    expect(setTheme).toHaveBeenCalledWith('dark');

    pressCtrlK();
    act(() => { fireEvent.click(screen.getByRole('option', { name: 'shortcuts' })); });
    expect(screen.getByText('shortcuts help')).toBeInTheDocument();
  });
});
