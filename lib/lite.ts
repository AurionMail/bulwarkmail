/**
 * Bulwark Lite: the static build of this repo (`npm run build:lite`).
 *
 * Lite is the same client shell exported with `output: "export"`: mail,
 * calendar, contacts and files talk to the JMAP server straight from the
 * browser, so nothing here needs the Next.js server. What the server used to
 * provide is either replaced by a static file next to `index.html`
 * (`config.json`, `policy.json`), done in the browser against Stalwart's own
 * endpoints (token login, "remember me"), or switched off (admin console,
 * plugins, settings sync, cookie-backed features).
 *
 * `IS_LITE` is a build-time constant (`NEXT_PUBLIC_BULWARK_LITE=1`), so the
 * bundler can drop the server-only branches from the Lite bundle and the
 * Lite-only branches from the regular one. Keep the checks cheap and boolean:
 * `if (IS_LITE) ...` next to the existing feature gates.
 */
export const IS_LITE = process.env.NEXT_PUBLIC_BULWARK_LITE === '1';

/** Runtime config file a deployer edits after unzipping (relative to the mount prefix). */
export const LITE_CONFIG_PATH = '/config.json';

/** Optional admin policy file next to `config.json`; missing means defaults. */
export const LITE_POLICY_PATH = '/policy.json';

/** sessionStorage key the 404 shim parks a deep link under (see not-found.tsx). */
export const LITE_PENDING_PATH_KEY = 'bulwark-lite:pending-path';
