import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminSaveBar } from '../save-bar';
import { AdminShellContext } from '../shell-context';

describe('AdminSaveBar', () => {
  it('shows nothing while there is nothing to save', () => {
    render(<AdminSaveBar dirty={false} onSave={() => {}} />);
    expect(screen.queryByTestId('admin-save-bar')).toBeNull();
  });

  it('offers Save and Discard once something changed', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<AdminSaveBar dirty onSave={onSave} onDiscard={onDiscard} saveLabel="Save policy" note="Users see it on login" />);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText(/Users see it on login/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('saves on Ctrl+S, but not while a save is running', () => {
    const onSave = vi.fn();
    const { rerender } = render(<AdminSaveBar dirty onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender(<AdminSaveBar dirty saving onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('ignores Ctrl+S when nothing is dirty', () => {
    const onSave = vi.fn();
    render(<AdminSaveBar dirty={false} onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders into the shell host when there is one', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      <AdminShellContext.Provider value={{ saveBarHost: host, refreshBadges: () => {} }}>
        <div data-testid="page"><AdminSaveBar dirty onSave={() => {}} /></div>
      </AdminShellContext.Provider>,
    );
    expect(host.querySelector('[data-testid="admin-save-bar"]')).not.toBeNull();
    expect(screen.getByTestId('page').querySelector('[data-testid="admin-save-bar"]')).toBeNull();
    host.remove();
  });
});
