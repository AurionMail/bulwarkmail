import { SettingsApp } from "@/components/settings/settings-app";
import { generateLiteSegmentParams } from "@/lib/lite-static-params";

// Settings permalinks (#733): /settings/<tabId>. Without a tab the page falls
// back to the last tab the user had open, as before.
// Static Lite export: only the bare surface is prerendered; deep-link segments
// are read from the address bar in the browser (hooks/use-lite-link-segments.ts).
// `undefined` in the server build keeps the route dynamic (lib/lite-static-params.ts).
export const generateStaticParams = generateLiteSegmentParams;

export default async function SettingsRoute({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  return <SettingsApp linkSegments={segments ?? []} />;
}
