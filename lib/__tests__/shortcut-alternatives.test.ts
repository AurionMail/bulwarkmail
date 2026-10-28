import { describe, expect, it } from 'vitest';
import { SHORTCUT_APPS } from '@/lib/keyboard-shortcuts';
import { shortcutAlternatives } from '@/lib/shortcut-keys';

// The shortcuts help shows " / " as "or" between whole keys. "Shift + ↓ / ↑"
// read as "Shift + ↓ or ↑", which says plain ↑ also extends the selection.

describe('shortcut alternatives', () => {
  it('spell out the modifier in every alternative', () => {
    const bad: string[] = [];
    for (const app of SHORTCUT_APPS) {
      for (const section of app.sections) {
        for (const entry of section.entries) {
          const alternatives = shortcutAlternatives(entry.key);
          const modified = alternatives.some((key) => key.includes(' + '));
          if (modified && alternatives.some((key) => !key.includes(' + '))) bad.push(`${app.id}: ${entry.key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
