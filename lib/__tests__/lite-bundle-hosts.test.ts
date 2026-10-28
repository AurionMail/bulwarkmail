// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NON_REQUEST_HOSTS, isPlaceholderHost, registeredLiterals } from '@/lib/outgoing-hosts';

// The built Lite bundle (#903): every http(s) host literal in out/ must be a
// registered outside host, a known non-request, or one of the strings the
// bundled libraries, the demo data and the translations carry. Run after
// `npm run build:lite` with LITE_OUT_DIR pointing at its out/ folder:
//
//   LITE_OUT_DIR=/path/to/out npx vitest run lib/__tests__/lite-bundle-hosts.test.ts
//
// Without LITE_OUT_DIR the scan is skipped (the unit test run has no build).

const OUT = process.env.LITE_OUT_DIR ?? '';

/** Strings in the bundle that are never requested, by why they are there. */
const BUNDLE_NON_REQUEST: Record<string, string[]> = {
  'error and docs links of bundled libraries': [
    'nextjs.org', 'react.dev', 'stuk.github.io', 'prosemirror.net', 'github.com', 'foo.bar',
  ],
  // Translators localise the example addresses of the login form.
  'example domains in translations': ['eksempel.dk', 'mail.eksempel.dk', 'piemers.lv', 'pasts.piemers.lv', 'mail.ornek.com', 'ornek.com'],
  // lib/demo/fixtures: links inside the sample mail of the demo mode.
  'demo mail content': [
    'zoom.us', 'notion.so', 'www.figma.com', 'vercel.com', 'i.scdn.co', 'cf.bstatic.com', 'open.spotify.com',
    'linear.app', 'sentry.io', 'app.docusign.com',
  ],
};

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(js|html|css|json|txt|webmanifest)$/.test(name)) out.push(full);
  }
  return out;
}

describe.skipIf(!OUT)('Lite bundle outgoing hosts (LITE_OUT_DIR)', () => {
  it('holds no host that is neither registered nor a known non-request', () => {
    const config = JSON.parse(readFileSync(path.join(OUT, 'config.json'), 'utf8')) as { jmapServerUrl?: string };
    const allowed = new Set<string>([
      ...registeredLiterals(),
      ...NON_REQUEST_HOSTS.map((h) => h.host),
      ...Object.values(BUNDLE_NON_REQUEST).flat(),
    ]);
    if (config.jmapServerUrl) allowed.add(new URL(config.jmapServerUrl).host);

    const unknown = new Map<string, string>();
    const all = files(OUT);
    expect(all.length).toBeGreaterThan(50);
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.*_-]+)/g)) {
        const raw = m[1].toLowerCase();
        const host = raw.replace(/\.{2,}$/, '');
        if (allowed.has(raw) || allowed.has(host) || isPlaceholderHost(host)) continue;
        if (!unknown.has(host)) unknown.set(host, path.relative(OUT, file));
      }
    }
    expect([...unknown].map(([host, file]) => `${file}: ${host}`)).toEqual([]);
  });

  it('ships config.json with the switch', () => {
    const config = JSON.parse(readFileSync(path.join(OUT, 'config.json'), 'utf8'));
    expect(config).toHaveProperty('noThirdPartyTraffic');
  });
});
