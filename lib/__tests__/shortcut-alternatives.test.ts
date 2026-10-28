import { describe, expect, it } from 'vitest';
import { SHORTCUT_APPS } from '@/lib/keyboard-shortcuts';
import { shortcutAlternatives } from '@/lib/shortcut-keys';

// The shortcuts help shows " / " as "or" between whole keys. "Shift + ↓ / ↑"
// read as "Shift + ↓ or ↑", which says plain ↑ also extends the selection.
// Unrelated keys may mix ("F5 / Mod + R", "/ / Mod + F"); arrows may not.

const ARROWS = ['↑', '↓', '←', '→'];
const isArrow = (key: string) => ARROWS.includes(key);
const endsInArrow = (key: string) => ARROWS.some((arrow) => key.endsWith(` + ${arrow}`));

describe('shortcut alternatives', () => {
  it('spell out the modifier in every alternative', () => {
    const bad: string[] = [];
    for (const app of SHORTCUT_APPS) {
      for (const section of app.sections) {
        for (const entry of section.entries) {
          const alternatives = shortcutAlternatives(entry.key);
          if (alternatives.some(endsInArrow) && alternatives.some(isArrow)) bad.push(`${app.id}: ${entry.key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
