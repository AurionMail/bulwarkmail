import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './plugin-kit.css';

// The plugin sandbox iframe runs with an opaque origin (the `sandbox`
// attribute in production excludes `allow-same-origin` for isolation). Any
// asset request from this layout is then cross-origin from the "null" origin
// to the host origin. Fonts need CORS, so there are no font imports. The one
// stylesheet is plugin-kit.css, the styles of the plugin UI kit: Next serves
// it from /_next/static, which answers with Access-Control-Allow-Origin: *
// (next.config.ts), and the sandbox CSP allows styles from 'self'. Plugin
// bundles and host API calls travel over the postMessage RPC bridge.

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
