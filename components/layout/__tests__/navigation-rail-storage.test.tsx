import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The rail's storage ring opens a popover that Escape closes, like every
// other popover in the rail.

vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/keyboard-shortcuts-modal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-stalwart-admin', () => ({ useStalwartAdmin: () => false }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { NavigationRail } = await import('../navigation-rail');
const { useUpdateStore } = await import('@/stores/update-store');

beforeEach(() => {
  useUpdateStore.setState({ startPolling: vi.fn() } as never);
});

describe('storage popover', () => {
  it('closes on Escape and gives the focus back to the ring', () => {
    render(<NavigationRail collapsed quota={{ used: 50, total: 100 } as never} />);
    const ring = screen.getByRole('button', { name: 'storage' });
    fireEvent.click(ring);
    expect(ring).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('storage_total')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('storage_total')).toBeNull();
    expect(ring).toHaveFocus();
  });
});
