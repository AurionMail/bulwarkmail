import { describe, expect, it } from 'vitest';
import { formatShortcutCombo, shortcutAlternatives } from '../shortcut-keys';
import { GENERAL_SHORTCUTS, SHORTCUT_APPS, sectionsWithGeneral, shortcutAppForPath } from '../keyboard-shortcuts';

describe('shortcut notation', () => {
  it('writes Mod as ⌘ on Apple devices and Ctrl elsewhere, Alt as ⌥', () => {
    expect(formatShortcutCombo('Mod + K', true)).toBe('⌘ + K');
    expect(formatShortcutCombo('Mod + K', false)).toBe('Ctrl + K');
    expect(formatShortcutCombo('Ctrl/⌘ + K', false)).toBe('Ctrl + K');
    expect(formatShortcutCombo('Ctrl/Cmd + Enter', true)).toBe('⌘ + Enter');
    expect(formatShortcutCombo('Alt + ↑', true)).toBe('⌥ + ↑');
    expect(formatShortcutCombo('Ctrl+Shift+Y', false)).toBe('Ctrl+Shift+Y');
  });

  it('splits alternatives', () => {
    expect(shortcutAlternatives('j / ↓', false)).toEqual(['j', '↓']);
    expect(shortcutAlternatives('Mod + A', true)).toEqual(['⌘ + A']);
  });
});

describe('shortcut sections', () => {
  it('knows the app of a path', () => {
    expect(shortcutAppForPath('/')).toBe('mail');
    expect(shortcutAppForPath('/mail/folder/inbox')).toBe('mail');
    expect(shortcutAppForPath('/calendar')).toBe('calendar');
    expect(shortcutAppForPath('/files/a/b')).toBe('files');
    expect(shortcutAppForPath('/de/contacts')).toBe('contacts');
    expect(shortcutAppForPath('/settings/appearance')).toBe('settings');
  });

  it('adds the general keys to every app, once', () => {
    const mail = sectionsWithGeneral(SHORTCUT_APPS.find((a) => a.id === 'mail')!.sections);
    const global = mail.filter((s) => s.id === 'global');
    expect(global).toHaveLength(1);
    expect(global[0].entries).toEqual(expect.arrayContaining([...GENERAL_SHORTCUTS]));
    const empty = sectionsWithGeneral([]);
    expect(empty).toEqual([expect.objectContaining({ id: 'global', entries: GENERAL_SHORTCUTS })]);
  });
});
