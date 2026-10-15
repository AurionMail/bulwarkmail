import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'de' }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ demoMode: false }) }));

import { PluginsSettings } from '../plugins-settings';
import { usePluginStore } from '@/stores/plugin-store';
import { usePolicyStore } from '@/stores/policy-store';
import type { InstalledPlugin } from '@/lib/plugin-types';

const PLUGIN = {
  id: 'p', name: 'P', version: '1.0.0', author: 'a', description: 'd', type: 'hook', permissions: [], entrypoint: 'index.js',
  enabled: true, status: 'running', managed: true, settings: {},
  settingsSchema: {
    mode: { type: 'select', label: 'settings.mode', description: 'settings.mode_help', default: 'fast', options: ['fast', 'careful'] },
    plain: { type: 'boolean', label: 'Plain label', default: false },
  },
  locales: { de: { 'settings.mode': 'Modus', 'settings.mode_help': 'Wie gearbeitet wird', fast: 'Schnell' } },
} as unknown as InstalledPlugin;

describe('plugin settings labels', () => {
  it('shows labels, descriptions and options from the plugin\'s own translations', () => {
    usePolicyStore.setState({ loaded: true, isFeatureEnabled: () => true, isPluginForceEnabled: () => false } as never);
    usePluginStore.setState({ plugins: [PLUGIN], initialized: true, initializePlugins: vi.fn() } as never);

    render(<PluginsSettings />);
    fireEvent.click(screen.getByText('P'));

    expect(screen.getByText('Modus')).toBeInTheDocument();
    expect(screen.getByText('Wie gearbeitet wird')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Schnell' })).toBeInTheDocument();
    // No translation: shown as written.
    expect(screen.getByRole('option', { name: 'careful' })).toBeInTheDocument();
    expect(screen.getByText('Plain label')).toBeInTheDocument();
  });
});
