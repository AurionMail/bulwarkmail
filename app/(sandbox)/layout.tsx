import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The plugin sandbox iframe runs with an opaque origin (the `sandbox`
// attribute in production excludes `allow-same-origin` for isolation). Any
// asset request from this layout - bundled fonts, globals.css, etc. - is then
// cross-origin from the "null" origin to the host origin and gets blocked
// (fonts in particular require CORS). So this layout is intentionally minimal:
// no font imports, no CSS imports. Plugins ship their own styles, and both the
// plugin bundle and all host API calls travel over the postMessage RPC bridge,
// so the sandbox never fetches same-origin assets itself.

export const metadata: Metadata = {
  title: 'Plugin sandbox',
  robots: { index: false, follow: false },
};

export default function PluginSandboxLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: 'transparent' }}>
        {/* next dev puts its indicator into every document, so each plugin
            slot showed its own badge. Plugins have no use for it. */}
        {process.env.NODE_ENV === 'development' && (
          <style>{'nextjs-portal{display:none!important}'}</style>
        )}
        {children}
      </body>
    </html>
  );
}
