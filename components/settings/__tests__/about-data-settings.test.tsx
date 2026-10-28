import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings-store';
import { AboutDataSettings } from '../about-data-settings';

// Backup & reset: Reset asks in a ConfirmDialog (no button that turns into
// a red "Yes"), and every result is a toast, never a browser alert().

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast }));
vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../debug-settings', () => ({ DebugSettings: () => null }));

const initial = useSettingsStore.getState();
let alertSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  useSettingsStore.setState(initial, true);
  alertSpy.mockRestore();
});

describe('Backup & reset', () => {
  it('resets only after the dialog is confirmed, then says so in a toast', () => {
    const resetToDefaults = vi.fn();
    useSettingsStore.setState({ resetToDefaults });
    render(<AboutDataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'reset_settings.button' }));
    expect(resetToDefaults).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('alertdialog'));
    expect(dialog.getByText('reset_settings.confirm_title')).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: 'reset_settings.button' }));
    expect(resetToDefaults).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('reset_settings.done');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('reports an import that fails in an error toast', async () => {
    useSettingsStore.setState({ importSettings: vi.fn(() => false) });
    const { container } = render(<AboutDataSettings />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['not json'], 'settings.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('import_error'));
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
