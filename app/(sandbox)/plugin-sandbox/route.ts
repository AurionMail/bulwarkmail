import { sandboxDocument } from '@/lib/plugin-sandbox/sandbox-document';

// The untrusted plugin iframe document (sandbox="allow-scripts", opaque
// origin). Dynamic: the CSP nonce from proxy.ts is per request.
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return sandboxDocument(request);
}
