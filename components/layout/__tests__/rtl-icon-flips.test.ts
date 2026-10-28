import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// globals.css already mirrors chevron and arrow icons under [dir=rtl]. An
// extra rtl:rotate-180 or rtl:-scale-x-100 on top cancels that out, and the
// icon points the left-to-right way again (R11). Checked in the shell's own
// folders.

const ROOTS = [
  'components/layout',
  'components/plugins',
  'components/tour',
  'components/notifications',
  'components/command-palette',
  'components/global-search',
  'components/auth',
  'components/error',
  'app/(main)/[locale]/login',
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('directional icons in right-to-left languages', () => {
  it('rely on the global mirror only', () => {
    const offenders = ROOTS.flatMap(sources).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => /<(Chevron|Arrow)\w*[^>]*\brtl:(rotate-180|-scale-x-100)/.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
