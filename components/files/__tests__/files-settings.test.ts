import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_FILES_SETTINGS } from '@/lib/files-settings';
import { getFilesSettings, migrateLegacyFilesSettings } from '../files-settings';

describe('Files settings in the synced settings', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
    useSettingsStore.setState({ explicitSettings: [] });
  });

  it('are part of the settings export and import', () => {
    useSettingsStore.getState().updateSetting('filesSettings', { ...DEFAULT_FILES_SETTINGS, defaultViewMode: 'grid' });
    const exported = JSON.parse(useSettingsStore.getState().exportSettings());
    expect(exported.filesSettings.defaultViewMode).toBe('grid');

    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().filesSettings).toEqual(DEFAULT_FILES_SETTINGS);

    useSettingsStore.getState().importSettings(JSON.stringify({ filesSettings: { defaultViewMode: 'grid', showIcons: 'yes' } }));
    expect(useSettingsStore.getState().filesSettings).toEqual({ ...DEFAULT_FILES_SETTINGS, defaultViewMode: 'grid' });
  });

  it('take over what an older build kept on this device, once', () => {
    localStorage.setItem('files-settings', JSON.stringify({ ...DEFAULT_FILES_SETTINGS, showHiddenFiles: true }));
    expect(getFilesSettings().showHiddenFiles).toBe(true);
    expect(localStorage.getItem('files-settings')).toBeNull();
    expect(useSettingsStore.getState().explicitSettings).toContain('filesSettings');
  });

  it('keep a choice already synced over an old device copy', () => {
    useSettingsStore.getState().updateSetting('filesSettings', { ...DEFAULT_FILES_SETTINGS, defaultSortKey: 'size' });
    localStorage.setItem('files-settings', JSON.stringify({ ...DEFAULT_FILES_SETTINGS, defaultSortKey: 'modified' }));
    migrateLegacyFilesSettings();
    expect(useSettingsStore.getState().filesSettings.defaultSortKey).toBe('size');
    expect(localStorage.getItem('files-settings')).toBeNull();
  });
});
