import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { fetchJmapSession, type JmapSessionDocument } from '@/lib/stalwart/jmap-api';
import { getWopiActions, buildWopiActionUrl } from '@/lib/wopi/discovery';
import { getWopiFileNode, probeBlob, shareeSavesNeedRename } from '@/lib/wopi/files';
import { mintWopiToken, wopiDocumentId, type WopiTokenPayload } from '@/lib/wopi/token';

/**
 * POST /api/wopi/launch
 *   { fileId: string, accountId?: string }                          - a Files node
 *   { blobId: string, name: string, type?: string, accountId?: string } - a mail attachment
 *
 * Mints a WOPI access token scoped to one document and returns the editor
 * URL to POST it to (#425). Attachments always open read-only (#1047). A
 * node in a shared drive is named by its owner's accountId and its own id.
 * Session-authenticated - this is the only WOPI route the browser calls;
 * everything under /api/wopi/files is called by the editor server-to-server
 * with the token minted here.
 */
export async function POST(request: NextRequest) {
  try {
    const creds = await getStalwartCredentials(request);
    if (!creds) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const str = (key: string): string => (typeof body?.[key] === 'string' ? (body[key] as string) : '');
    const fileId = str('fileId');
    const blobId = str('blobId');
    const attachmentName = str('name').trim();
    if (!fileId && !blobId) {
      return NextResponse.json({ error: 'fileId or blobId is required' }, { status: 400 });
    }
    if (blobId && !attachmentName) {
      return NextResponse.json({ error: 'name is required for attachments' }, { status: 400 });
    }

    const actions = await getWopiActions();
    if (!actions) {
      return NextResponse.json({ error: 'No document editor is configured' }, { status: 503 });
    }

    // The dev mock stores a relative serverUrl (/api/dev-jmap); resolve it
    // against this request's origin so server-side calls can reach it. A
    // same-origin server (the mock) is this process itself - the public-URL
    // guard would refuse localhost, so it counts as trusted.
    const serverUrl = new URL(creds.serverUrl, request.nextUrl.origin).toString().replace(/\/+$/, '');
    const trusted = creds.trusted || new URL(serverUrl).origin === request.nextUrl.origin;
    const ctx = { serverUrl, authHeader: creds.authHeader, trusted };

    // The account holding the document: the one the client names (a shared
    // drive's owner, a shared mailbox), else the user's own. A file also
    // needs the user's own account, where PutFile uploads (uploadAccountId).
    let accountId = str('accountId');
    let ownAccountId = '';
    let session: JmapSessionDocument | null = null;
    if (!accountId || !blobId) {
      session = await fetchJmapSession(serverUrl, creds.authHeader, { trusted });
      const capability = blobId ? 'urn:ietf:params:jmap:mail' : 'urn:ietf:params:jmap:filenode';
      ownAccountId =
        session?.primaryAccounts?.[capability] ||
        Object.keys(session?.accounts ?? {})[0] ||
        '';
      accountId ||= ownAccountId;
    }
    if (!accountId) {
      return NextResponse.json({ error: blobId ? 'No mail account' : 'No files account' }, { status: 404 });
    }

    let document: Pick<WopiTokenPayload, 'kind' | 'fileId' | 'name' | 'type' | 'size'>;
    let name: string;
    let canWrite: boolean;
    if (blobId) {
      const type = str('type');
      // Confirms the blob is readable with these credentials before the
      // editor is pointed at it, and reads its size for CheckFileInfo.
      const probe = await probeBlob(ctx, accountId, blobId, attachmentName, type);
      if (!probe) {
        return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
      }
      const clientSize = typeof body?.size === 'number' && body.size >= 0 ? body.size : 0;
      name = attachmentName;
      canWrite = false;
      document = { kind: 'attachment', fileId: blobId, name, type, size: probe.size ?? clientSize };
    } else {
      const node = await getWopiFileNode(ctx, accountId, fileId);
      if (!node || !node.blobId) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      name = node.name;
      // Editable only with the rights a save needs, or every save fails:
      // Stalwart 0.16 also wants the Modify right (mayRename) from a sharee.
      const rights = node.myRights;
      const needsRename = accountId !== ownAccountId && shareeSavesNeedRename(session, accountId, ownAccountId);
      canWrite = !rights || (!!rights.mayModifyContent && (!needsRename || !!rights.mayRename));
      document = { kind: 'file', fileId };
    }

    const ext = name.split('.').pop()?.toLowerCase() || '';
    const urlsrc = (canWrite && actions.edit[ext]) || actions.view[ext] || actions.edit[ext];
    if (!urlsrc) {
      return NextResponse.json({ error: 'File type not supported by the editor' }, { status: 415 });
    }
    const editable = canWrite && !!actions.edit[ext];

    // Where the editor reaches this webmail. Deployments where the editor
    // sees a different host than the browser (docker networks, split DNS)
    // override it via wopiHostUrl.
    const hostBase =
      configManager.get<string>('wopiHostUrl', '').trim().replace(/\/+$/, '') ||
      request.nextUrl.origin;
    const tokenPayload = {
      serverUrl,
      authHeader: creds.authHeader,
      username: creds.username,
      accountId,
      ...(blobId ? {} : { uploadAccountId: ownAccountId || accountId }),
      ...document,
      canWrite: editable,
      origin: request.nextUrl.origin,
    };
    const wopiSrc = `${hostBase}/api/wopi/files/${wopiDocumentId(tokenPayload)}`;
    const { token, expiresAt } = mintWopiToken(tokenPayload);

    return NextResponse.json({
      url: buildWopiActionUrl(urlsrc, wopiSrc),
      accessToken: token,
      accessTokenTtl: expiresAt,
      readOnly: !editable,
    });
  } catch (error) {
    logger.error('WOPI launch failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
