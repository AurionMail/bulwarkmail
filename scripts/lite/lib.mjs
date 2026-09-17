// Shared, side-effect-free helpers for the Lite build scripts. Kept separate
// so lib/__tests__/lite-scripts.test.ts can exercise them without touching
// the filesystem or spawning `next build`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repository root for a script under scripts/lite/. Falls back to the current
 * directory when `import.meta.url` is not a file URL (vitest's transform).
 */
export function resolveRepoRoot(metaUrl) {
  try {
    return resolve(fileURLToPath(new URL("../..", metaUrl)));
  } catch {
    return process.cwd();
  }
}

/** True when the module was started directly (`node scripts/lite/x.mjs`). */
export function isMainModule(metaUrl) {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}

/** Server-only trees the static export cannot contain. */
export const LITE_REMOVED_PATHS = [
  "proxy.ts",
  "app/api",
  "app/(main)/admin",
  "app/(main)/setup",
  "app/(sandbox)",
  "app/manifest.ts",
  "instrumentation.ts",
  "instrumentation.node.ts",
  "app/(main)/[...rest]",
  "app/(main)/protocol",
  "e2e",
  "integration",
];

/** Test trees are pruned too: they import the routes removed above. */
export const LITE_TEST_DIR_NAME = "__tests__";
export const LITE_TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?$/;
export const LITE_PRUNE_SKIP_DIRS = new Set(["node_modules", ".git", ".next", "out", "repos", "scripts"]);

/** The client shells a deployer's host must SPA-fallback to. */
export const LITE_SURFACES = ["mail", "calendar", "contacts", "files", "settings"];

/** Locales written right-to-left; the root shim sets `dir` for them. */
export const RTL_LOCALES = ["ar", "fa", "he"];

/**
 * `/api/` strings that legitimately survive in the Lite client chunks. Each
 * one is either gated at call time (`IS_LITE`, a policy flag, a config flag
 * the Lite config pins off) or tolerates a 404 by design. Anything else is a
 * new server dependency and fails `verify.mjs`.
 */
export const LITE_API_STRING_ALLOWLIST = [
  // Path-independent generic prefix used by `apiFetch` docs/comments.
  "/api/",
  // stores/update-store.ts - startPolling() is a no-op in Lite.
  "/api/system/update-status",
  // stores/plugin-store.ts + theme-store.ts - initializePlugins()/syncServerThemes() return early in Lite.
  "/api/plugins",
  "/api/plugin-approval-status",
  "/api/plugin-signing-pubkey",
  "/api/admin/plugins",
  "/api/admin/themes",
  // stores/settings-store.ts - settingsSyncEnabled is pinned off.
  "/api/settings",
  // OAuth / SSO / pairing - oauthEnabled and stalwartFeaturesEnabled are pinned off.
  "/api/auth/token",
  "/api/auth/oauth/metadata",
  "/api/auth/sso/start",
  "/api/auth/sso/complete",
  "/api/auth/reauth/sso/complete",
  "/api/auth/pair/create",
  "/api/auth/totp-token-exchange",
  "/api/auth/session",
  "/api/auth/verify",
  "/api/auth/stalwart-context",
  "/api/account/stalwart/jmap",
  // Admin shield probe - skipped in Lite (components/layout/navigation-rail.tsx).
  "/api/admin/auth",
  // Settings/policy - replaced by config.json / policy.json.
  "/api/config",
  "/api/admin/policy",
  // WOPI (#425) - use-wopi-status returns disabled in Lite.
  "/api/wopi/status",
  "/api/wopi/launch",
  // Calendar: ICS URL import/subscriptions + CalDAV discovery are hidden in Lite.
  "/api/fetch-ical",
  "/api/caldav/discover",
  "/api/webdav",
  // Sender favicons - disabled in Lite (initials fallback).
  "/api/favicon",
  // Web push relay paths (relative to the *relay* origin, not this host).
  "/api/push/vapid-public-key",
  "/api/push/register",
  "/api/push/active",
  "/api/push/verify",
  "/api/push/jmap",
  // Dev-only JMAP mock.
  "/api/jmap",
  "/api/dev-jmap",
];

export function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function normalizeBasePath(raw) {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!trimmed.startsWith("/")) throw new Error(`base path must start with "/" (got ${JSON.stringify(raw)})`);
  return trimmed;
}

/** config.json contents from the LITE_* build inputs. */
export function buildLiteConfig(env = {}) {
  const jmapServerUrl = (env.LITE_JMAP_SERVER_URL ?? "").trim().replace(/\/+$/, "");
  return {
    _comment: "Bulwark Lite runtime configuration. Edit and re-upload; no rebuild needed. See LITE-README.md.",
    appName: (env.LITE_APP_NAME ?? "").trim() || "Bulwark Webmail",
    jmapServerUrl,
    allowCustomJmapEndpoint: parseBool(env.LITE_ALLOW_CUSTOM_ENDPOINT, jmapServerUrl === ""),
    rememberMeEnabled: parseBool(env.LITE_REMEMBER_ME, true),
    demoMode: parseBool(env.LITE_DEMO_MODE, false),
    loginShowTotp: true,
    loginShowVersion: true,
  };
}

/** policy.json: only the gates Lite must pin; the app merges the rest over its defaults. */
export function buildLitePolicy() {
  return {
    _comment: "Optional admin policy for Bulwark Lite (same shape as the admin dashboard's policy). Plugins and sidebar apps stay off in Lite.",
    features: {
      pluginsEnabled: false,
      sidebarAppsEnabled: false,
    },
  };
}

export function buildManifest({ appName, basePath = "" }) {
  const p = (path) => `${basePath}${path}`;
  return {
    name: appName,
    short_name: appName,
    description: `${appName} - webmail for JMAP servers`,
    start_url: p("/"),
    scope: p("/"),
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: p("/icon-192x192.png"), sizes: "192x192", type: "image/png" },
      { src: p("/icon-512x512.png"), sizes: "512x512", type: "image/png" },
      { src: p("/icon-maskable-light-192x192.png"), sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: p("/icon-maskable-light-512x512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** Root index.html: pick the visitor's locale in the browser and jump to it. */
export function buildRootRedirect({ basePath = "", locales, defaultLocale = "en" }) {
  const list = JSON.stringify(locales);
  const fallback = locales.includes(defaultLocale) ? defaultLocale : locales[0];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Loading</title>
<script>
(function () {
  var locales = ${list};
  var fallback = ${JSON.stringify(fallback)};
  var base = ${JSON.stringify(basePath)};
  function pick(tag) {
    if (!tag) return null;
    tag = String(tag);
    if (locales.indexOf(tag) !== -1) return tag;
    var lower = tag.toLowerCase();
    if (lower.indexOf("zh") === 0) {
      var traditional = /zh-(tw|hk|mo|hant)/.test(lower);
      if (traditional && locales.indexOf("zh-TW") !== -1) return "zh-TW";
      if (locales.indexOf("zh") !== -1) return "zh";
    }
    var short = lower.split("-")[0];
    for (var i = 0; i < locales.length; i++) if (locales[i].toLowerCase() === short) return locales[i];
    return null;
  }
  var chosen = null;
  try { chosen = pick(localStorage.getItem("NEXT_LOCALE")); } catch (e) {}
  var langs = navigator.languages || [navigator.language];
  for (var j = 0; !chosen && j < langs.length; j++) chosen = pick(langs[j]);
  location.replace(base + "/" + (chosen || fallback) + "/" + location.search + location.hash);
})();
</script>
</head>
<body><noscript>This app needs JavaScript. <a href="${basePath}/${fallback}/">Continue</a></noscript></body>
</html>
`;
}

/** Netlify / Cloudflare Pages rewrite rules. */
export function buildRedirects({ basePath = "", locales, surfaces = LITE_SURFACES }) {
  const lines = [
    "# Bulwark Lite SPA fallback (Netlify / Cloudflare Pages). Deep links below a",
    "# surface serve that surface's shell; everything else keeps its own file.",
  ];
  for (const locale of locales) {
    for (const surface of surfaces) {
      lines.push(`${basePath}/${locale}/${surface}/*  ${basePath}/${locale}/${surface}/index.html  200`);
    }
    // /<locale>/login etc. resolve directly; a bare locale root goes to mail.
  }
  return lines.join("\n") + "\n";
}

/** Security headers for hosts that read a `_headers` file. */
export function buildHeaders({ basePath = "", connectSrc = "*" }) {
  const csp = [
    "default-src 'self'",
    // The static export ships inline hydration scripts, so no nonce is possible.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' https: data:",
    `connect-src 'self' ${connectSrc}`,
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "media-src 'self' blob:",
  ].join("; ");
  return `${basePath || ""}/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Content-Security-Policy: ${csp}
${basePath || ""}/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
`;
}

export function buildNginxExample({ basePath = "", surfaces = LITE_SURFACES }) {
  const location = basePath ? `${basePath}/` : "/";
  const surfaceAlternation = surfaces.join("|");
  return `# Bulwark Lite - nginx example. Serve the unzipped folder at ${location}
# and rewrite deep links to the owning surface's shell.
server {
    listen 80;
    server_name webmail.example.com;
    root /var/www/bulwark-lite;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    # See _headers for a Content-Security-Policy that matches your JMAP server.

    location ${basePath}/_next/static/ {
        ${basePath ? `alias /var/www/bulwark-lite/_next/static/;\n        ` : ""}expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # /<locale>/<surface>/anything -> /<locale>/<surface>/index.html
    location ~ ^${basePath}/(?<locale>[a-zA-Z-]+)/(?<surface>${surfaceAlternation})(/.*)?$ {
        try_files $uri $uri/ $uri/index.html ${basePath}/$locale/$surface/index.html;
    }

    location ${location} {
        ${basePath ? `alias /var/www/bulwark-lite/;\n        ` : ""}try_files $uri $uri/ $uri/index.html =404;
        error_page 404 ${basePath}/404.html;
    }
}
`;
}

export function buildCaddyExample({ basePath = "", surfaces = LITE_SURFACES }) {
  const surfaceAlternation = surfaces.join("|");
  return `# Bulwark Lite - Caddy example.
webmail.example.com {
    root * /var/www/bulwark-lite
    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }

    @surface path_regexp surface ^${basePath}/([a-zA-Z-]+)/(${surfaceAlternation})(/.*)?$
    handle @surface {
        try_files {path} {path}/ {path}/index.html ${basePath}/{re.surface.1}/{re.surface.2}/index.html
    }

    handle {
        try_files {path} {path}/ {path}/index.html ${basePath}/404.html
    }

    file_server
}
`;
}

export function buildReadme({ version, commit, basePath = "", locales, jmapServerUrl = "", demoMode = false }) {
  return `# Bulwark Lite ${version} (${commit})

A static build of Bulwark Webmail: the same mail, calendar, contacts and files
client, without the Node.js server. Upload this folder to any static host and
point it at your Stalwart (or other JMAP) server.

Built for mount path: ${basePath || "/ (site root)"}
Locales included: ${locales.join(", ")}
${demoMode ? "Demo mode is ON: the login page offers a built-in demo account and no server is needed.\n" : ""}
## Three steps

1. Unzip this archive and upload the whole folder to your web host, so that
   \`${basePath || ""}/index.html\` and \`${basePath || ""}/config.json\` are served from the mount path above.
2. Edit \`config.json\`:
   - \`jmapServerUrl\`: your mail server, e.g. \`https://mail.example.com\`${jmapServerUrl ? ` (currently \`${jmapServerUrl}\`)` : ""}.
   - \`appName\`: the name shown in the tab and on the login page.
   - \`allowCustomJmapEndpoint\`: \`true\` shows a server field on the login page.
   - \`rememberMeEnabled\`: \`false\` hides "remember me" (sessions then end with the tab).
   Optional keys: \`demoMode\`, \`jmapServers\`, \`jmapServerAutoPickByDomain\`, the login logo/company/link keys and \`loginShow*\` toggles (same names as the Docker env vars, camelCased).
3. Allow the browser to talk to the mail server (CORS). In Stalwart:

   \`\`\`toml
   [http]
   permissive-cors = true
   \`\`\`

   or an equivalent reverse-proxy rule that allows your Lite origin with the
   \`Authorization\` and \`Content-Type\` headers on \`/.well-known/jmap\`, \`/jmap/*\`,
   \`/api/auth\` and \`/auth/token\`.

## Host configuration

Deep links such as \`${basePath}/en/mail/thread/abc\` are served by the shell at
\`${basePath}/en/mail/index.html\`. Configure your host to fall back to it:

- Netlify / Cloudflare Pages: the shipped \`_redirects\` and \`_headers\` files do this.
- nginx: see \`nginx.conf.example\`.
- Caddy: see \`Caddyfile.example\`.
- GitHub Pages and other hosts without rewrites: \`404.html\` replays the link
  in the browser. It works, with one extra page load.

\`_headers\` also carries the recommended security headers. Adjust
\`connect-src\` to your JMAP server's origin if you prefer a strict policy.

## What is different from the full Bulwark Webmail

Everything that runs in the browser works: mail, threads, search, compose,
multiple accounts, calendar, contacts, files, themes, settings export/import,
password and TOTP login, demo mode, deep links.

Not available in Lite (they need the Node.js server): the admin console and
setup wizard, plugins and sidebar apps, settings sync across devices, OAuth /
SSO login, the account security tab (app passwords, 2FA setup), ICS URL
subscriptions and CalDAV discovery, sender favicons, office (WOPI) editing,
web push notifications, the update banner, device pairing.

## Security notes

- No cookies and no server session. Requests to the mail server carry the
  token or credentials of the signed-in account only.
- "Remember me" keeps a Stalwart refresh token in the browser's localStorage
  (a plain token, never the password). Without "remember me" the token lives
  in sessionStorage and the session ends with the tab. Both are readable by
  any script running on your Lite origin, so serve Lite from an origin you
  control and keep the Content-Security-Policy from \`_headers\`.
- Servers without Stalwart's token login (\`/api/auth\`) fall back to Basic
  auth. "Remember me" is then hidden; the credentials stay in sessionStorage
  for the lifetime of the tab so a reload does not sign you out.
- Because the export contains inline scripts, \`script-src\` must allow
  \`'unsafe-inline'\`. Email HTML is still rendered sanitised in a sandboxed
  frame, exactly as in the full build.
`;
}

/** Locales actually present in the export (dirs that hold a mail shell). */
export function discoverBuiltLocales(outDir) {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((name) => {
      const dir = join(outDir, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, "mail", "index.html"));
    })
    .sort();
}

/** Every `"/api/...` string literal found in the client chunks, deduplicated. */
export function collectApiStrings(chunksDir) {
  const found = new Set();
  if (!existsSync(chunksDir)) return [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) {
        const text = readFileSync(full, "utf8");
        for (const match of text.matchAll(/["'`](\/api\/[A-Za-z0-9/_-]*)/g)) found.add(match[1]);
      }
    }
  };
  walk(chunksDir);
  return [...found].sort();
}

export function unexpectedApiStrings(strings, allowlist = LITE_API_STRING_ALLOWLIST) {
  return strings.filter((s) => !allowlist.some((allowed) => s === allowed || s.startsWith(`${allowed}/`) || (allowed.endsWith("/") && s === allowed.slice(0, -1))));
}
