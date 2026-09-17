import { CalendarApp } from "@/components/calendar/calendar-app";
import { generateLiteSegmentParams } from "@/lib/lite-static-params";

// Calendar permalinks (#733):
//   /calendar                        the stored view, today
//   /calendar/<view>/<YYYY-MM-DD>    a view anchored on a date
//   /calendar/event/<eventId>        one event, with ?calendar=<id> to
//                                    disambiguate across accounts
// Static Lite export: only the bare surface is prerendered; deep-link segments
// are read from the address bar in the browser (hooks/use-lite-link-segments.ts).
// `undefined` in the server build keeps the route dynamic (lib/lite-static-params.ts).
export const generateStaticParams = generateLiteSegmentParams;

export default async function CalendarRoute({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  return <CalendarApp linkSegments={segments ?? []} />;
}
