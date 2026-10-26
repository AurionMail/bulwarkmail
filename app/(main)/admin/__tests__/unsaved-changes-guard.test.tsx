import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesGuard } from '../_unsaved-changes-guard';
import { useAdminUnsavedChanges, useAdminUnsavedStore } from '@/stores/admin-unsaved-store';

function DirtySection({ id = 'settings', dirty }: { id?: string; dirty: boolean }) {
  useAdminUnsavedChanges(id, dirty);
  return null;
}

afterEach(() => {
  useAdminUnsavedStore.setState({ dirty: {}, pendingLeave: null, pendingScope: null });
});

describe('admin unsaved changes guard (#1255)', () => {
  it('runs the action straight away when nothing is unsaved', () => {
    render(<><UnsavedChangesGuard /><DirtySection dirty={false} /></>);
    const action = vi.fn();
    act(() => useAdminUnsavedStore.getState().requestLeave(action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before leaving with unsaved edits; Stay keeps the admin on the page', () => {
    render(<><UnsavedChangesGuard /><DirtySection dirty /></>);
    const action = vi.fn();
    act(() => useAdminUnsavedStore.getState().requestLeave(action));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useAdminUnsavedStore.getState().dirty).toEqual({ settings: true });
  });

  it('Leave runs the action and drops the unsaved flag', () => {
    render(<><UnsavedChangesGuard /><DirtySection dirty /></>);
    const action = vi.fn();
    act(() => useAdminUnsavedStore.getState().requestLeave(action));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(useAdminUnsavedStore.getState().dirty).toEqual({});
  });

  it('Escape closes the prompt like Stay', () => {
    render(<><UnsavedChangesGuard /><DirtySection dirty /></>);
    const action = vi.fn();
    act(() => useAdminUnsavedStore.getState().requestLeave(action));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it('a scoped leave only looks at, and only clears, its own section', () => {
    render(<><UnsavedChangesGuard /><DirtySection id="plugins" dirty /><DirtySection id="plugin-config" dirty={false} /></>);
    const back = vi.fn();
    act(() => useAdminUnsavedStore.getState().requestLeave(back, 'plugin-config'));
    expect(back).toHaveBeenCalledTimes(1);

    act(() => useAdminUnsavedStore.getState().setDirty('plugin-config', true));
    act(() => useAdminUnsavedStore.getState().requestLeave(back, 'plugin-config'));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(back).toHaveBeenCalledTimes(2);
    expect(useAdminUnsavedStore.getState().dirty).toEqual({ plugins: true });
  });

  it('holds a link click until the admin picks Leave', () => {
    const onLinkClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <>
        <UnsavedChangesGuard />
        <DirtySection dirty />
        <a href="/admin/change-password" onClick={onLinkClick}>Change Password</a>
      </>,
    );
    fireEvent.click(screen.getByText('Change Password'));
    expect(onLinkClick).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it('asks the browser to confirm closing the page only while edits are unsaved', () => {
    const { rerender } = render(<><UnsavedChangesGuard /><DirtySection dirty /></>);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender(<><UnsavedChangesGuard /><DirtySection dirty={false} /></>);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});
