import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// German addresses the user formally ("Sie") throughout (R10). Informal
// pronouns and du-imperatives slipped into some strings.

const INFORMAL = /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|deines)\b|(^|[.!?]\s+|\()(Klicke|Tippe|Wähle|Prüfe|Melde|Lege|Entferne|Frag|Öffne|drücke)\b/i;

function strings(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => strings(value, [...path, key]));
  }
  return [];
}

describe('German translations', () => {
  it('use the formal "Sie" everywhere', () => {
    const de = JSON.parse(readFileSync('locales/de/common.json', 'utf8'));
    const informal = strings(de)
      // Words the composer looks for in "[Dein Name]"-style fill-ins, not UI text.
      .filter(([key]) => !key.includes('placeholder_words'))
      .filter(([, text]) => INFORMAL.test(text))
      .map(([key]) => key);
    expect(informal).toEqual([]);
  });
});
