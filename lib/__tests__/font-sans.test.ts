import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { AtRule, Root } from 'postcss';

/**
 * A theme's typography.fontSans compiles to --font-sans on :root (#1278).
 * Body has to read that variable, and the variable's default has to be the
 * app's own stack, not Tailwind's, so nothing changes without a theme.
 * Build globals.css with Tailwind to see the default it actually emits.
 */
let root: Root;

beforeAll(async () => {
  const postcss = (await import('postcss')).default;
  const tailwind = (await import('@tailwindcss/postcss')).default;
  const file = path.join(process.cwd(), 'app', 'globals.css');
  // Scan an empty folder: only the stylesheet's own rules matter here.
  const base = mkdtempSync(path.join(os.tmpdir(), 'font-sans-'));
  try {
    root = (await postcss([tailwind({ base })]).process(readFileSync(file, 'utf8'), { from: file })).root;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}, 60_000);

/**
 * The value of `prop` in the `selector` rule whose parent is `wrapper`
 * (`@layer theme`), or that sits at the top level when `wrapper` is null.
 */
function declValue(selector: string, prop: string, wrapper: string | null): string | undefined {
  let value: string | undefined;
  root.walkRules(selector, (rule) => {
    const at = rule.parent?.type === 'atrule' ? (rule.parent as AtRule) : null;
    if (value !== undefined || (at ? `@${at.name} ${at.params}` : null) !== wrapper) return;
    rule.walkDecls(prop, (decl) => {
      value ??= decl.value.replace(/\s+/g, ' ');
    });
  });
  return value;
}

describe('theme font (#1278)', () => {
  it('sets body in --font-sans', () => {
    expect(declValue('body', 'font-family', null)).toBe('var(--font-sans)');
  });

  it('defaults --font-sans to the app stack, Thai fallbacks included', () => {
    expect(declValue(':root, :host', '--font-sans', '@layer theme')).toBe(
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif',
    );
  });
});
