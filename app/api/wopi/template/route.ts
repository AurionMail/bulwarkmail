import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { getWopiActions } from '@/lib/wopi/discovery';
import { getBlankTemplate, getNewFileFormats } from '@/lib/wopi/new-file';

/**
 * GET /api/wopi/template?ext=docx
 *
 * The blank file "New file" uploads for a document format the editor can
 * create (#1393). Only formats /api/wopi/status lists under newExtensions.
 * Session-authenticated.
 */
export async function GET(request: NextRequest) {
  const creds = await getStalwartCredentials(request);
  if (!creds) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ext = (request.nextUrl.searchParams.get('ext') ?? '').toLowerCase();
  const actions = await getWopiActions();
  if (!actions || !(await getNewFileFormats(actions)).includes(ext)) {
    return NextResponse.json({ error: 'Unknown format' }, { status: 404 });
  }

  const template = await getBlankTemplate(ext);
  if (!template) {
    return NextResponse.json({ error: 'Unknown format' }, { status: 404 });
  }
  return new NextResponse(new Blob([template.data as BlobPart], { type: template.type }), {
    headers: {
      'Content-Type': template.type,
      'Cache-Control': 'private, no-cache',
    },
  });
}
