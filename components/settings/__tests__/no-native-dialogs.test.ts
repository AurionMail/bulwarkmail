import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// R4: no window.confirm, alert() or prompt() in Settings and the admin
// panel. Questions go through ConfirmDialog (the useConfirmDialog hook's
// confirm({ ... }) is fine), results through toasts.

const ROOT = join(__dirname, '..', '..', '..');
const DIRS = ['components/settings', 'components/admin', 'components/filters', 'components/identity', 'app/(main)/admin'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const NATIVE = [
  /\bwindow\.(confirm|alert|prompt)\s*\(/,
  /(?<![.\w])(alert|prompt)\s*\(/,
  // A bare confirm(...) with a message, not the hook's confirm({ ... }).
  /(?<![.\w])confirm\s*\((?!\s*\{)/,
];

describe('native browser dialogs in Settings and Admin', () => {
  it('are not used', () => {
    const found: string[] = [];
    for (const dir of DIRS) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
          if (NATIVE.some((re) => re.test(line))) found.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(found).toEqual([]);
  });
});
