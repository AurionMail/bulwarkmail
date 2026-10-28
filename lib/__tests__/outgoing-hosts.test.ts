// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  BUILT_URL_FILES,
  NON_REQUEST_HOSTS,
  NON_REQUEST_PATHS,
  OUTGOING_HOSTS,
  isPlaceholderHost,
  registeredLiterals,
  registryHostnames,
} from '@/lib/admin/outgoing-hosts-registry';
import { BUILT_IN_HOSTNAMES } from '@/lib/outgoing-hosts';

// Every host literal in the shipped source must be a built-in outside host
// in lib/admin/outgoing-hosts-registry.ts (with a switch that turns it off)
// or a known non-request (docs link, namespace, sample text), in the file it
// is listed for. URLs built from a variable must be in a file listed with a
// reason. A new outside host fails here until someone decides which it is
// (#903).

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['app', 'lib', 'stores', 'hooks', 'components', 'contexts', 'i18n'];
const FILES = ['public/sw.js', 'proxy.ts', 'instrumentation.ts', 'instrumentation.node.ts', 'next.config.ts'];
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** scheme://host, for http(s) and ws(s), any case. */
const SCHEME_HOST = /\b(?:https?|wss?):\/\/([a-z0-9.*_-]+)/gi;
/** scheme:// followed by ${...} or the end of the string: a URL built from a variable, or the scheme alone. */
const BUILT_URL = /\b(?:https?|wss?):\/\/(?=\$\{|["'`])/gi;
/** A protocol-relative //host at the start of a string literal. */
const PROTOCOL_RELATIVE = /["'`]\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

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

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of DIRS) walk(dir, out);
  for (const file of FILES) {
    try { statSync(path.join(ROOT, file)); out.push(file); } catch { /* not in this checkout */ }
  }
  return out.filter((file) => !NON_REQUEST_PATHS.some((prefix) => file.startsWith(prefix)));
}

type Finding = { kind: 'host'; host: string } | { kind: 'built' };

/** Host literals (lower case) and built URLs in a source text. */
function findings(text: string): Finding[] {
  const out: Finding[] = [];
  for (const m of text.matchAll(SCHEME_HOST)) out.push({ kind: 'host', host: m[1].toLowerCase() });
  for (const m of text.matchAll(PROTOCOL_RELATIVE)) out.push({ kind: 'host', host: m[1].toLowerCase() });
  for (const _m of text.matchAll(BUILT_URL)) out.push({ kind: 'built' });
  return out;
}

const registered = registeredLiterals();

/** Why a finding in `file` is fine, or null when it isn't accounted for. */
function classify(finding: Finding, file: string): string | null {
  if (finding.kind === 'built') return BUILT_URL_FILES.some((b) => b.file === file) ? 'built' : null;
  const host = finding.host;
  const trimmed = host.replace(/\.{2,}$/, '');
  for (const literal of [host, trimmed]) {
    if (registered.get(literal)?.has(file)) return 'registry';
    if (NON_REQUEST_HOSTS.some((entry) => entry.host === literal && entry.files.includes(file))) return 'non-request';
  }
  // A registered or allowed host is only fine where it is listed.
  if (registered.has(trimmed) || NON_REQUEST_HOSTS.some((entry) => entry.host === trimmed)) return null;
  if (isPlaceholderHost(trimmed)) return 'placeholder';
  return null;
}

describe('outgoing host literals', () => {
  const files = sourceFiles();
  const texts = new Map(files.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]));

  it('scans the shipped source, service worker and config included, and leaves the tests out', () => {
    for (const file of ['public/sw.js', 'next.config.ts', 'app/api/favicon/route.ts', 'app/api/dev-jmap/[...path]/route.ts', 'i18n/request.ts']) {
      expect(files).toContain(file);
    }
    expect(files.some((f) => f.includes('__tests__'))).toBe(false);
    expect(files.some((f) => f.startsWith('lib/demo/fixtures/'))).toBe(false);
    expect(files.length).toBeGreaterThan(500);
  });

  it('finds no host or built URL that isn\'t accounted for', () => {
    const unknown: string[] = [];
    for (const [file, text] of texts) {
      for (const finding of findings(text)) {
        if (!classify(finding, file)) unknown.push(`${file}: ${finding.kind === 'host' ? finding.host : 'URL built from a variable'}`);
      }
    }
    expect([...new Set(unknown)], 'Add the host to OUTGOING_HOSTS with a switch, or to NON_REQUEST_HOSTS / BUILT_URL_FILES with the reason').toEqual([]);
  });

  it('lists only hosts and files that are still in the source', () => {
    const hostsIn = (file: string) => findings(texts.get(file) ?? '')
      .flatMap((f) => (f.kind === 'host' ? [f.host, f.host.replace(/\.{2,}$/, '')] : []));
    for (const entry of OUTGOING_HOSTS) {
      for (const file of entry.files) {
        const found = (entry.literals ?? [entry.host]).some((literal) => hostsIn(file).includes(literal));
        expect(found, `${entry.id} in ${file}`).toBe(true);
      }
    }
    for (const entry of NON_REQUEST_HOSTS) {
      for (const file of entry.files) expect(hostsIn(file).includes(entry.host), `${entry.host} in ${file}`).toBe(true);
    }
    for (const { file } of BUILT_URL_FILES) {
      expect(findings(texts.get(file) ?? '').some((f) => f.kind === 'built'), `built URL in ${file}`).toBe(true);
    }
  });

  it('keeps the browser\'s host list equal to the registry', () => {
    expect([...BUILT_IN_HOSTNAMES].sort()).toEqual(registryHostnames().sort());
  });
});

describe('the scan catches', () => {
  const unknownIn = (text: string, file = 'lib/new-module.ts') =>
    findings(text).filter((f) => !classify(f, file)).map((f) => (f.kind === 'host' ? f.host : 'built'));

  it('a new outside host, in any case', () => {
    expect(unknownIn(`fetch('https://tracker.fakecdn.io/pixel.gif')`)).toEqual(['tracker.fakecdn.io']);
    expect(unknownIn(`fetch("HTTPS://Tracker.FakeCDN.io/p")`)).toEqual(['tracker.fakecdn.io']);
    expect(unknownIn(`new WebSocket('wss://live.fakecdn.io/socket')`)).toEqual(['live.fakecdn.io']);
    expect(unknownIn(`new WebSocket("ws://live.fakecdn.io")`)).toEqual(['live.fakecdn.io']);
  });

  it('a protocol-relative host in a string', () => {
    expect(unknownIn(`script.src = '//cdn.fakecdn.io/lib.js'`)).toEqual(['cdn.fakecdn.io']);
    expect(unknownIn(`// a comment about //cdn.fakecdn.io`)).toEqual([]);
  });

  it('a URL built from a variable or the scheme alone, outside the listed files', () => {
    expect(unknownIn('fetch(`https://${host}/x`)')).toEqual(['built']);
    expect(unknownIn(`url.startsWith('https://')`)).toEqual(['built']);
    expect(unknownIn('fetch(`https://${host}/x`)', 'lib/validation.ts')).toEqual([]);
  });

  it('a public IP literal, but not a private or reserved one', () => {
    expect(unknownIn(`fetch('http://93.184.216.34/x')`)).toEqual(['93.184.216.34']);
    expect(unknownIn(`fetch('http://10.0.0.5:8080'); fetch('http://192.168.1.1'); fetch('http://127.0.0.1')`)).toEqual([]);
  });

  it('a registered or allowed host in a file it isn\'t listed for', () => {
    expect(unknownIn(`fetch('https://icons.duckduckgo.com/ip3/x.ico')`)).toEqual(['icons.duckduckgo.com']);
    expect(unknownIn(`<a href="https://github.com/x">`)).toEqual(['github.com']);
    expect(unknownIn(`fetch('https://icons.duckduckgo.com/ip3/x.ico')`, 'app/api/favicon/route.ts')).toEqual([]);
  });
});
