import { PluginPageApp } from "@/components/plugins/plugin-page-app";
import { generateLiteSegmentParams } from "@/lib/lite-static-params";

// Pages plugins add with api.ui.setPages: /apps/<pluginId>/<pageId>[/<path>].
// Anything after the page id reaches the plugin's `app-page` slot as `path`.
// A catch-all rather than [pluginId]/[pageId] so the static Lite export can
// prerender the bare route; plugins never run in Lite, so it only ever shows
// the "not available" note there (lib/lite-static-params.ts).
export const generateStaticParams = generateLiteSegmentParams;

function decodeOnce(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default async function PluginPageRoute({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  return <PluginPageApp linkSegments={(segments ?? []).map(decodeOnce)} />;
}
