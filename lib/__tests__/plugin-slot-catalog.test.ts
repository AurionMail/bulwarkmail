// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { SLOT_CATALOG, type SlotArea } from '../plugin-slot-catalog';
import { ALL_PERMISSIONS } from '../plugin-types';

const root = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

const sources = ['app', 'components', 'hooks', 'lib'].flatMap((d) => sourceFiles(path.join(root, d)))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

/** A mount: `<PluginSlot name="x"`, `<PluginActions surface="x"`, or a slot passed as `slot="x"` / `slot: 'x'`. */
function isMounted(name: string): boolean {
  const n = name.replace(/[-]/g, '\\-');
  return new RegExp(`(?:name|surface|slot)\\s*[=:]\\s*\\{?\\s*["'\`]${n}["'\`]`).test(sources)
    // A fallback name: slot={(current.slot ?? 'plugin-dialog')}
    || new RegExp(`slot\\s*\\?\\?\\s*["']${n}["']`).test(sources);
}

// Areas whose surfaces are still being mounted on this branch. Each commit
// that finishes an area removes it here; the test then insists every
// surface in it has a mount site.
const NOT_YET_MOUNTED = new Set<SlotArea>([
  'app', 'navigation', 'mail-list', 'reader', 'composer', 'calendar', 'contacts', 'tasks', 'files', 'settings',
]);

describe('slot catalogue', () => {
  it('gates every surface behind permissions the host knows', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    const unknown: string[] = [];
    for (const [name, spec] of Object.entries(SLOT_CATALOG)) {
      for (const perm of spec.permissions) if (!known.has(perm)) unknown.push(`${name}: ${perm}`);
      if (spec.props !== '*') {
        for (const perm of Object.values(spec.props)) if (perm && !known.has(perm)) unknown.push(`${name} prop: ${perm}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  const areas = [...new Set(Object.values(SLOT_CATALOG).map((s) => s.area))];
  it.each(areas)('mounts every %s surface somewhere in the app', (area) => {
    const missing = Object.entries(SLOT_CATALOG)
      .filter(([name, spec]) => spec.area === area && !isMounted(name))
      .map(([name]) => name);
    if (NOT_YET_MOUNTED.has(area)) {
      expect(missing.length, `${area} is fully mounted; remove it from NOT_YET_MOUNTED`).toBeGreaterThan(0);
    } else {
      expect(missing).toEqual([]);
    }
  });
});
