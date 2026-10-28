import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/components/pro/pro-interface-redirect', () => ({ useProInterfaceActive: () => false }));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ startTour: vi.fn() }) }));

const { KeyboardShortcutsModal } = await import('@/components/keyboard-shortcuts-modal');

describe('Contacts and Files keys in the shortcuts help', () => {
  it('lists the Contacts keys on the Contacts tab', () => {
    nav.pathname = '/contacts';
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: 'sidebar.contacts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('contacts.shortcuts.move')).toBeInTheDocument();
    expect(screen.getByText('contacts.shortcuts.search')).toBeInTheDocument();
  });

  it('lists the Files keys on the Files tab, with Backspace deleting and Alt+Up going up', () => {
    nav.pathname = '/files';
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: 'sidebar.files' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('files.shortcuts.up')).toBeInTheDocument();
    expect(screen.getByText('files.shortcuts.delete')).toBeInTheDocument();
  });
});
