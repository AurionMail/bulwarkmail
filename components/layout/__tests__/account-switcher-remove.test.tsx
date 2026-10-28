import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Removing an account from the popover: the app's confirm dialog instead of
// the browser's, a control a touch screen can reach, and sign-out rows in
// the menu's plain text colour.

const { AccountSwitcher } = await import('../account-switcher');
const { useAccountStore } = await import('@/stores/account-store');
const { useAuthStore } = await import('@/stores/auth-store');
const { useSettingsStore } = await import('@/stores/settings-store');

function account(id: string) {
  return {
    id, label: `${id}@example.com`, email: `${id}@example.com`, username: `${id}@example.com`,
    displayName: id.toUpperCase(), serverUrl: 'https://mail.example.com', avatarColor: '#336699',
    cookieSlot: 0, isConnected: true, isDefault: id === 'a',
  };
}

const removeAccount = vi.fn();

beforeEach(() => {
  removeAccount.mockClear();
  useAccountStore.setState({ accounts: [account('a'), account('b')] } as never);
  useAuthStore.setState({ activeAccountId: 'a', removeAccount } as never);
  useSettingsStore.setState({ interfaceLayout: 'default' } as never);
});

describe('removing an account from the popover', () => {
  it('asks with the app dialog, not the browser, and removes on confirm', async () => {
    const browserConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'remove_account' }));

    expect(browserConfirm).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog', { name: 'remove_account_title' });
    expect(removeAccount).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'remove_account' })); });
    expect(removeAccount).toHaveBeenCalledWith('b');
    expect(dialog).not.toBeInTheDocument();
    browserConfirm.mockRestore();
  });

  it('keeps the remove control visible on a touch screen', () => {
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    expect(screen.getByRole('menuitem', { name: 'remove_account' }).className).toContain('pointer-coarse:opacity-100');
  });

  it('draws "sign out of all accounts" like the other rows, start-aligned', () => {
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    const all = screen.getByRole('menuitem', { name: 'sign_out_all' });
    expect(all.className).not.toContain('text-destructive');
    expect(all.className).toContain('text-start');
  });
});
