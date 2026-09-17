import { FilesApp } from "@/components/files/files-app";
import { generateLiteSegmentParams } from "@/lib/lite-static-params";

// Files permalinks (#733): /files/<folder>/<subfolder>, one path segment per
// level, with ?preview=<name> to open a file straight into the preview modal.
// Static Lite export: only the bare surface is prerendered; deep-link segments
// are read from the address bar in the browser (hooks/use-lite-link-segments.ts).
// `undefined` in the server build keeps the route dynamic (lib/lite-static-params.ts).
export const generateStaticParams = generateLiteSegmentParams;

export default async function FilesRoute({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  return <FilesApp linkSegments={segments ?? []} />;
}
