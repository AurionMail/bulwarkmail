import { describe, expect, it } from 'vitest';
import en from '@/locales/en/common.json';
import { getByPath } from '../settings-search';

// SET-23 / R10: one verb per action ("New …" creates, "Save" saves) and
// sentence case for labels in Settings.

const text = (key: string) => getByPath(en, key) as string;

// Words that keep their capital inside a sentence-case label.
const PROPER = /^(ASCII-armored|JMAP|Sieve|HTML|PGP|S\/MIME|TOTP|API|IPs|ASCII|BCC|Pro|Junk|Trash|Bulwark|Webmail|Siege|Spam|ID|URL|OAuth\/OIDC\)|\(OAuth\/OIDC\)|Mountain|View|Cc|To|ALL|ANY|Z|→|&)$/;

function titleCaseWords(value: string): string[] {
  return value.split(/\s+/).slice(1).filter((w) => /^[A-Z]/.test(w) && !PROPER.test(w.replace(/[(),.]/g, '')));
}

describe('settings wording', () => {
  it('names creating "New …" and saving "Save"', () => {
    expect(text('settings.keywords.add_keyword')).toBe('New tag');
    expect(text('settings.folders.create_folder')).toBe('New folder');
    expect(text('settings.folders.create_subfolder')).toBe('New subfolder');
    expect(text('settings.filters.add_rule')).toBe('New rule');
    expect(text('identities.create_new')).toBe('New identity');
    expect(text('settings.vacation.save')).toBe('Save');
    expect(text('settings.filters.save')).toBe('Save');
    expect(text('identities.form.save')).toBe('Save');
  });

  it('uses sentence case for labels and titles', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        const last = path.split('.').pop() ?? '';
        if (!/(^|_)(label|title)$/.test(last) || node.includes('{')) return;
        if (path.startsWith('settings.files.')) return; // moved by the Files work
        if (titleCaseWords(node).length > 0) offenders.push(`${path}: ${node}`);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
      }
    };
    walk((en as Record<string, unknown>).settings, 'settings');
    walk((en as Record<string, unknown>).identities, 'identities');
    expect(offenders).toEqual([]);
  });

  // R9: a success toast states the result, without "successfully".
  it('reports Settings saves without "successfully"', () => {
    for (const key of [
      'notifications.filters_saved',
      'settings.filters.saved',
      'notifications.identity_created',
      'notifications.identity_updated',
      'notifications.templates_exported',
    ]) {
      expect(text(key), key).not.toMatch(/successful|!/i);
    }
    expect(text('notifications.filters_saved')).toBe('Filters saved');
  });

  it('does not repeat the debug section title as its only row', () => {
    expect(text('settings.advanced.debug_mode.toggle')).not.toBe(text('settings.advanced.debug_mode.label'));
  });
});
