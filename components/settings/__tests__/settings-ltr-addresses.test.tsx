import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores/settings-store';
import { SidebarAppsSettings } from '../sidebar-apps-settings';

// Addresses read left to right in an Arabic layout too; in a right-to-left
// box a cut address lost its start ("https://") instead of its end.

const initial = useSettingsStore.getState();
afterEach(() => { useSettingsStore.setState(initial, true); });

describe('addresses in Settings', () => {
  it('shows a sidebar app address left to right', () => {
    useSettingsStore.setState({
      sidebarApps: [{ id: 'a', name: 'Wiki', url: 'https://wiki.example.com/start', icon: 'globe', openMode: 'inline' }],
    } as never);
    render(<SidebarAppsSettings />);
    expect(screen.getByText('https://wiki.example.com/start')).toHaveAttribute('dir', 'ltr');
  });
});
