import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// "Vacation responder is active" opens Settings > Out of Office, not
// whichever settings page was open last.

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: nav.push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ startTour: vi.fn(), resetTourCompletion: vi.fn(), activeTour: null, endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/contexts/drag-drop-context', () => ({ useDragDropContext: () => ({ isDragging: false }) }));
vi.mock('@/hooks/use-mailbox-drop', () => ({
  useMailboxDrop: () => ({ dropHandlers: {}, isValidDropTarget: false, isInvalidDropTarget: false }),
}));
vi.mock('@/hooks/use-tag-drop', () => ({ useTagDrop: () => ({ dropHandlers: {}, isValidDropTarget: false }) }));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));

const { Sidebar } = await import('../sidebar');
const { useVacationStore } = await import('@/stores/vacation-store');
const { buildSettingsPath } = await import('@/lib/deep-links');

describe('vacation banner', () => {
  it('opens the Out of Office settings', () => {
    useVacationStore.setState({ isEnabled: true, isSupported: true } as never);
    render(<Sidebar mailboxes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /vacation_active/ }));
    expect(nav.push).toHaveBeenCalledWith(buildSettingsPath('vacation'));
    expect(buildSettingsPath('vacation')).not.toBe('/settings');
  });
});
