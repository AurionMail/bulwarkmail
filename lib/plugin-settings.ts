// What a plugin's settings actually are: the manifest defaults, overlaid
// with what the user saved, each value checked against the schema. Used by
// the settings page and by everything that hands settings to the plugin,
// so the two can't disagree.

import type { InstalledPlugin, SettingFieldSchema } from './plugin-types';

function coerce(field: SettingFieldSchema, value: unknown): unknown {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : field.default;
    case 'string':
      return typeof value === 'string' ? value : field.default;
    case 'select':
      return typeof value === 'string' && Array.isArray(field.options) && field.options.includes(value)
        ? value
        : field.default;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return field.default;
      if (field.min !== undefined && value < field.min) return field.min;
      if (field.max !== undefined && value > field.max) return field.max;
      return value;
    }
    default:
      return field.default;
  }
}

/**
 * Settings as the plugin should see them. Without a schema the stored
 * values pass through unchanged (older plugins read free-form settings).
 * With one, every declared field has a valid value and nothing else is kept,
 * so a field removed in an update or an option that no longer exists can't
 * linger.
 */
export function effectiveSettings(plugin: Pick<InstalledPlugin, 'settings' | 'settingsSchema'>): Record<string, unknown> {
  const stored = plugin.settings ?? {};
  const schema = plugin.settingsSchema;
  if (!schema || Object.keys(schema).length === 0) return { ...stored };
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    out[key] = key in stored ? coerce(field, stored[key]) : field.default;
  }
  return out;
}

/** A single value as it will be stored, or the field's default if invalid. */
export function coerceSetting(field: SettingFieldSchema, value: unknown): unknown {
  return coerce(field, value);
}
