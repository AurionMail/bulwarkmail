import { describe, it, expect } from 'vitest';
import { effectiveSettings } from '../plugin-settings';
import type { SettingFieldSchema } from '../plugin-types';

const schema: Record<string, SettingFieldSchema> = {
  size: { type: 'number', label: 'Size', default: 160, min: 16, max: 512 },
  mode: { type: 'select', label: 'Mode', default: 'auto', options: ['auto', 'manual'] },
  on: { type: 'boolean', label: 'On', default: true },
};

describe('effectiveSettings', () => {
  it('gives the plugin its defaults before the user saved anything', () => {
    // Plugins used to get {} and had to repeat every default in code.
    expect(effectiveSettings({ settings: {}, settingsSchema: schema })).toEqual({ size: 160, mode: 'auto', on: true });
  });

  it('keeps valid saved values', () => {
    expect(effectiveSettings({ settings: { size: 64, mode: 'manual', on: false }, settingsSchema: schema }))
      .toEqual({ size: 64, mode: 'manual', on: false });
  });

  it('replaces values the schema no longer accepts', () => {
    const result = effectiveSettings({ settings: { size: 9999, mode: 'removed-option', on: 'yes', old: 1 }, settingsSchema: schema });
    expect(result).toEqual({ size: 512, mode: 'auto', on: true });
  });

  it('passes settings through for a plugin without a schema', () => {
    expect(effectiveSettings({ settings: { anything: 1 } })).toEqual({ anything: 1 });
  });
});
