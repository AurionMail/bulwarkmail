import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const pro = vi.hoisted(() => ({ active: false }));
vi.mock('@/components/pro/pro-interface-redirect', () => ({ useProInterfaceActive: () => pro.active }));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ startTour: vi.fn() }) }));

const { KeyboardShortcutsModal } = await import('../keyboard-shortcuts-modal');

describe('keyboard shortcuts help', () => {
  it('lists Ctrl+K as the command palette outside the Pro shell', () => {
    pro.active = false;
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    expect(screen.getByText('command_palette.open')).toBeInTheDocument();
    expect(screen.queryByText('shortcuts.global.global_search')).toBeNull();
  });

  it('lists Ctrl+K as global search in the Pro shell', () => {
    pro.active = true;
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    expect(screen.getByText('shortcuts.global.global_search')).toBeInTheDocument();
    expect(screen.queryByText('command_palette.open')).toBeNull();
  });
});
