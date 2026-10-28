import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { getWopiActions, getWopiClientUrl } from '@/lib/wopi/discovery';
import { getNewFileFormats } from '@/lib/wopi/new-file';

/**
 * GET /api/wopi/status
 *
 * Tells the Files UI whether a WOPI document editor is configured, which
 * file extensions it can edit/view (#425) and which ones "New file" can
 * create (#1393). Session-authenticated; the WOPI client URL itself stays
 * server-side.
 */
export async function GET(request: NextRequest) {
  const creds = await getStalwartCredentials(request);
  if (!creds) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const disabled = { enabled: false, editExtensions: [], viewExtensions: [], newExtensions: [] };
  const clientUrl = await getWopiClientUrl();
  if (!clientUrl) {
    return NextResponse.json(disabled);
  }

  const actions = await getWopiActions();
  if (!actions) {
    return NextResponse.json(disabled);
  }

  return NextResponse.json({
    enabled: true,
    editExtensions: Object.keys(actions.edit),
    viewExtensions: Object.keys(actions.view),
    newExtensions: await getNewFileFormats(actions),
  });
}
