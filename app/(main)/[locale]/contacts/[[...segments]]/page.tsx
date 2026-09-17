import { ContactsApp } from "@/components/contacts/contacts-app";
import { generateLiteSegmentParams } from "@/lib/lite-static-params";

// Contact permalinks (#733): /contacts/<contactId>[/edit], plus /contacts/new
// for the "add this sender" flow. The older query form (?contactId=, ?addEmail=)
// still works - see parseContactsPath.
// Static Lite export: only the bare surface is prerendered; deep-link segments
// are read from the address bar in the browser (hooks/use-lite-link-segments.ts).
// `undefined` in the server build keeps the route dynamic (lib/lite-static-params.ts).
export const generateStaticParams = generateLiteSegmentParams;

export default async function ContactsRoute({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  return <ContactsApp linkSegments={segments ?? []} />;
}
