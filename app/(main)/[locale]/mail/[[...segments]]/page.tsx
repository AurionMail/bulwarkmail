import { MailApp } from "@/components/mail/mail-app";
import { generateLiteSegmentParams } from "@/lib/lite-static-params";

// Permalinks into the mail client (#733):
//   /mail                        the list
//   /mail/folder/<role|id>       a mailbox
//   /mail/message/<emailId>      one message
//   /mail/thread/<threadId>      a conversation
//
// Every one of them renders the same client shell as "/" - the segments are
// an intent the shell applies once its JMAP session is up, not a different
// page. Unknown segments are ignored and the shell falls back to the list, so
// stale links degrade instead of 404ing.
// Static Lite export: only the bare surface is prerendered; deep-link segments
// are read from the address bar in the browser (hooks/use-lite-link-segments.ts).
// `undefined` in the server build keeps the route dynamic (lib/lite-static-params.ts).
export const generateStaticParams = generateLiteSegmentParams;

export default async function MailDeepLinkRoute({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  return <MailApp linkSegments={segments ?? []} />;
}
