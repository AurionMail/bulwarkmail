import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An editor with unsaved changes registers a leave guard; the rail and the
// phone tab bar ask it before they leave the app (R5).

vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/keyboard-shortcuts-modal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('@/components/search/search-box', () => ({ SearchBox: () => null }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-stalwart-admin', () => ({ useStalwartAdmin: () => false }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/contacts',
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { NavigationRail } = await import('../navigation-rail');
const { useUpdateStore } = await import('@/stores/update-store');
const { registerLeaveGuard } = await import('@/lib/leave-guard');

let off: (() => void) | null = null;
beforeEach(() => {
  useUpdateStore.setState({ startPolling: vi.fn() } as never);
});
afterEach(() => { off?.(); off = null; });

describe.each([
  ['desktop rail', { orientation: 'vertical', collapsed: true }],
  ['phone tab bar', { orientation: 'horizontal', collapsed: false }],
] as const)('%s', (_name, props) => {
  it('asks before leaving an editor with unsaved changes, and stays on "Keep editing"', async () => {
    const confirm = vi.fn(async () => false);
    off = registerLeaveGuard({ isDirty: () => true, confirm });
    render(<NavigationRail {...props} />);
    const mail = screen.getAllByRole('link', { name: 'mail' })[0];
    const click = fireEvent.click(mail);
    // fireEvent returns false when the default (navigating) was prevented.
    expect(click).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('leaves without asking when nothing is unsaved', () => {
    const confirm = vi.fn(async () => false);
    off = registerLeaveGuard({ isDirty: () => false, confirm });
    render(<NavigationRail {...props} />);
    fireEvent.click(screen.getAllByRole('link', { name: 'mail' })[0]);
    expect(confirm).not.toHaveBeenCalled();
  });
});
