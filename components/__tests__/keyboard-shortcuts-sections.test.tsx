import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/components/pro/pro-interface-redirect', () => ({ useProInterfaceActive: () => false }));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ startTour: vi.fn() }) }));
vi.mock('@/lib/keyboard-shortcuts/calendar', () => ({
  CALENDAR_SECTIONS: [{ id: 'views', title: 'calendar.views', entries: [{ key: 'd', description: 'calendar.day_view' }] }],
}));

const { KeyboardShortcutsModal } = await import('../keyboard-shortcuts-modal');

describe('keyboard shortcuts help per app', () => {
  it("opens on the current app's tab and lists the general keys there too", () => {
    nav.pathname = '/calendar';
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    // Contacts, Files and Settings have no keys yet: no tabs.
    expect(tabs.map((tab) => tab.textContent)).toEqual(['sidebar.mail', 'sidebar.calendar']);
    expect(screen.getByRole('tab', { name: 'sidebar.calendar' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('calendar.day_view')).toBeInTheDocument();
    expect(screen.getByText('shortcuts.global.help')).toBeInTheDocument();
    expect(screen.queryByText('shortcuts.actions.reply')).toBeNull();

    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'sidebar.mail' })); });
    expect(screen.getByText('shortcuts.actions.reply')).toBeInTheDocument();
    expect(screen.getAllByText('shortcuts.global.help')).toHaveLength(1);
  });

  it('translates "or" between alternatives and uses Ctrl off Apple devices', () => {
    nav.pathname = '/';
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    expect(screen.getAllByText('or').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ctrl + K').length).toBe(1);
  });
});
