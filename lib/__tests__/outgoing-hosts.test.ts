// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  NON_REQUEST_HOSTS,
  NON_REQUEST_PATHS,
  OUTGOING_HOSTS,
  isPlaceholderHost,
  registeredLiterals,
} from '@/lib/outgoing-hosts';

// Every http(s) host literal in the shipped source must be a built-in
// outside host in lib/outgoing-hosts.ts (with a switch that turns it off) or
// a known non-request (docs link, namespace, sample text). A new outside
// host fails here until someone decides which it is (#903).

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['app', 'lib', 'stores', 'hooks', 'components', 'contexts'];
const FILES = ['public/sw.js', 'proxy.ts', 'instrumentation.ts', 'instrumentation.node.ts'];
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const HOST_LITERAL = /https?:\/\/([A-Za-z0-9.*_-]+)/g;

function isTestPath(rel: string): boolean {
  return /(^|\/)(__tests__|__mocks__|node_modules)\//.test(rel) || /\.(test|spec)\.[a-z]+$/.test(rel);
}

function walk(rel: string, out: string[]) {
  const abs = path.join(ROOT, rel);
  for (const name of readdirSync(abs)) {
    const child = `${rel}/${name}`;
    if (isTestPath(`${child}/`) || name === 'node_modules') continue;
    if (statSync(path.join(abs, name)).isDirectory()) walk(child, out);
    else if (EXTENSIONS.test(name) && !isTestPath(child)) out.push(child);
  }
}

export function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of DIRS) walk(dir, out);
  for (const file of FILES) {
    try { statSync(path.join(ROOT, file)); out.push(file); } catch { /* not in this checkout */ }
  }
  return out.filter((file) => !NON_REQUEST_PATHS.some((prefix) => file.startsWith(prefix)));
}

/** Host literals in a source text, as written (lower case, port dropped). */
export function hostLiterals(text: string): string[] {
  return [...text.matchAll(HOST_LITERAL)].map((m) => m[1].toLowerCase());
}

/** Why a host literal in `file` is fine, or null when it isn't accounted for. */
export function classify(host: string, file: string, registered = registeredLiterals()): string | null {
  if (registered.has(host)) return 'registry';
  const trimmed = host.replace(/\.+$/, '');
  if (registered.has(trimmed)) return 'registry';
  const allowed = NON_REQUEST_HOSTS.find((entry) => entry.host === trimmed);
  if (allowed && allowed.files.includes(file)) return 'non-request';
  if (isPlaceholderHost(host)) return 'placeholder';
  return null;
}

describe('outgoing host literals', () => {
  const files = sourceFiles();

  it('scans the shipped source, service worker included, and leaves the tests out', () => {
    expect(files).toContain('public/sw.js');
    expect(files).toContain('app/api/favicon/route.ts');
    expect(files.some((f) => f.includes('__tests__'))).toBe(false);
    expect(files.some((f) => f.startsWith('lib/demo/fixtures/'))).toBe(false);
    expect(files.length).toBeGreaterThan(500);
  });

  it('finds no host that is neither registered nor a known non-request', () => {
    const registered = registeredLiterals();
    const unknown: string[] = [];
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const host of hostLiterals(text)) {
        if (!classify(host, file, registered)) unknown.push(`${file}: ${host}`);
      }
    }
    expect(unknown, 'Add the host to OUTGOING_HOSTS with a switch, or to NON_REQUEST_HOSTS if Bulwark never connects to it').toEqual([]);
  });

  it('lists only hosts that are still in the source', () => {
    const all = files.map((file) => ({ file, text: readFileSync(path.join(ROOT, file), 'utf8') }));
    const literals = new Set(all.flatMap(({ text }) => hostLiterals(text)));
    for (const entry of OUTGOING_HOSTS) {
      for (const literal of entry.literals ?? [entry.host]) {
        expect(literals.has(literal), `${entry.id}: ${literal}`).toBe(true);
      }
    }
    for (const entry of NON_REQUEST_HOSTS) {
      for (const file of entry.files) {
        const text = all.find((f) => f.file === file)?.text ?? '';
        expect(hostLiterals(text).some((h) => h.replace(/\.+$/, '') === entry.host), `${entry.host} in ${file}`).toBe(true);
      }
    }
  });

  it('classifies the way the registry says', () => {
    expect(classify('icons.duckduckgo.com', 'app/api/favicon/route.ts')).toBe('registry');
    expect(classify('openpgpkey.', 'lib/plugin-sandbox/host-api.ts')).toBe('registry');
    expect(classify('github.com', 'components/settings/about-data-settings.tsx')).toBe('non-request');
    expect(classify('github.com', 'lib/some-new-file.ts')).toBeNull();
    expect(classify('mail.example.com', 'anywhere.ts')).toBe('placeholder');
    expect(classify('cdn.unpkg.com', 'lib/x.ts')).toBeNull();
  });
});
