import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings-store';

// #1228: hidden shared mail accounts are keyed per login, because JMAP
// accountIds are only unique on one server.
describe('settings-store hiddenSharedMailAccounts', () => {
  beforeEach(() => {
    useSettingsStore.setState({ hiddenSharedMailAccounts: { 'a@h': ['g1'] } });
  });

  it('is synced', () => {
    const exported = JSON.parse(useSettingsStore.getState().exportSettings());
    expect(exported.hiddenSharedMailAccounts).toEqual({ 'a@h': ['g1'] });
    expect(exported.showSharedMailAccounts).toBe(true);
  });

  it('a server load only takes that login\'s entry', () => {
    useSettingsStore.getState().importSettings(
      JSON.stringify({ hiddenSharedMailAccounts: { 'a@h': ['stale'], 'b@h': ['g2'] } }),
      { serverAccountId: 'b@h' },
    );
    expect(useSettingsStore.getState().hiddenSharedMailAccounts).toEqual({ 'a@h': ['g1'], 'b@h': ['g2'] });
  });

  it('ignores a value that is not a per-login record', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({ hiddenSharedMailAccounts: ['g2'] }));
    expect(useSettingsStore.getState().hiddenSharedMailAccounts).toEqual({ 'a@h': ['g1'] });
  });
});
