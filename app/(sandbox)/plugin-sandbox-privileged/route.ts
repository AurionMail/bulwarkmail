import { sandboxDocument } from '@/lib/plugin-sandbox/sandbox-document';

// Privileged-tier sandbox document. Identical to /plugin-sandbox, but the
// host loads it into a same-origin (`allow-same-origin`) iframe so the bundle
// gets real `crypto.subtle` + IndexedDB. The trust gate (signature + admin
// approval) is enforced host-side before this route is ever framed; the
// document itself carries no extra privilege.
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return sandboxDocument(request);
}
