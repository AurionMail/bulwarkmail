import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { AdvancedSettingsProvider, AdvancedSettingsSwitch, SettingItem, SettingsSection } from '../settings-section';
import { useSettingsStore } from '@/stores/settings-store';

function Page() {
  return (
    <AdvancedSettingsProvider>
      <SettingsSection title="Other apps">
        <SettingItem label="App passwords"><span>basic</span></SettingItem>
        <SettingItem label="API keys" advanced><span>adv</span></SettingItem>
      </SettingsSection>
      <SettingsSection title="Encryption" advanced>
        <SettingItem label="Public keys" advanced><span>adv</span></SettingItem>
      </SettingsSection>
    </AdvancedSettingsProvider>
  );
}

describe('Advanced settings switch', () => {
  beforeEach(() => {
    act(() => { useSettingsStore.setState({ showAdvancedSettings: false }); });
  });

  it('hides advanced rows and sections and counts them', () => {
    render(<Page />);
    expect(screen.getByText('App passwords')).toBeInTheDocument();
    expect(screen.queryByText('API keys')).toBeNull();
    expect(screen.queryByText('Encryption')).toBeNull();
    expect(screen.queryByText('Public keys')).toBeNull();
    // The hidden section counts once; its rows never mount, so they do not count twice.
    expect(screen.getByTestId('settings-hidden-advanced')).toHaveTextContent('hidden_count');
    expect(useSettingsStore.getState().showAdvancedSettings).toBe(false);
  });

  it('reveals them from the page footer link', () => {
    render(<Page />);
    fireEvent.click(screen.getByText('show'));
    expect(useSettingsStore.getState().showAdvancedSettings).toBe(true);
    expect(screen.getByText('API keys')).toBeInTheDocument();
    expect(screen.getByText('Encryption')).toBeInTheDocument();
    expect(screen.getByText('Public keys')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-hidden-advanced')).toBeNull();
  });

  it('toggles from the sidebar switch', () => {
    render(<><AdvancedSettingsSwitch /><Page /></>);
    const sw = screen.getByTestId('settings-advanced-switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('API keys')).toBeInTheDocument();
    fireEvent.click(sw);
    expect(screen.queryByText('API keys')).toBeNull();
  });

  it('shows advanced rows when no provider scopes a page', () => {
    render(<SettingItem label="API keys" advanced><span>adv</span></SettingItem>);
    expect(screen.getByText('API keys')).toBeInTheDocument();
  });
});
