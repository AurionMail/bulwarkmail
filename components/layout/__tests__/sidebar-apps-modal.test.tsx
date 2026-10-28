import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The "Apps" modal on the shared dialog shell: a named close button, a
// backdrop that closes it, Escape from anywhere inside, named row buttons.

vi.mock('@/hooks/use-resolved-sidebar-apps', () => ({ useManagedSidebarApps: () => [] }));

const { SidebarAppsModal } = await import('../sidebar-apps-modal');
const { useSettingsStore } = await import('@/stores/settings-store');

describe('apps modal', () => {
  it('closes from its named X and from the backdrop', () => {
    const onClose = vi.fn();
    render(<SidebarAppsModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape after a click on its heading', () => {
    const onClose = vi.fn();
    render(<SidebarAppsModal isOpen onClose={onClose} />);
    const heading = screen.getByRole('heading', { name: 'modal_title' });
    fireEvent.mouseDown(heading);
    fireEvent.keyDown(heading, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('names the edit and delete buttons of each app', () => {
    useSettingsStore.setState({ sidebarApps: [{ id: 'a', name: 'Wiki', url: 'https://wiki.example', icon: 'Globe', openMode: 'tab' }] } as never);
    render(<SidebarAppsModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'edit_app' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument();
  });
});
