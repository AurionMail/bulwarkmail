import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { JmapAuthVerificationError, assertBasicAuthMatchesUsername, normalizeJmapServerUrl, validateProxyAuthHeader, verifyJmapAuth } from '@/lib/auth/verify-jmap-auth';
import { setStalwartAuthContext } from '@/lib/stalwart/auth-context';
import { configManager } from '@/lib/admin/config-manager';
import { isPublicHttpUrl } from '@/lib/security/url-guard';
import { recordLogin } from '@/lib/telemetry/login-tracker';
import { parseJmapServers, resolveTrustedJmapUrl } from '@/lib/admin/jmap-servers';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { rejectCrossOriginRequest } from '@/lib/security/same-origin';

function getSlot(request: NextRequest, bodySlot: unknown): number {
  if (typeof bodySlot === 'number' && bodySlot >= 0 && bodySlot < MAX_ACCOUNT_SLOTS) {
    return bodySlot;
  }

  const raw = request.nextUrl.searchParams.get('slot');
  if (raw === null) return 0;

  const slot = parseInt(raw, 10);
  return Number.isNaN(slot) || slot < 0 || slot >= MAX_ACCOUNT_SLOTS ? 0 : slot;
}

export async function POST(request: NextRequest) {
  // CSRF gate (GHSA-qvr9-m8cq-7wvg): cookies written here are SameSite=Lax,
  // so a cross-site top-level POST would otherwise reach this handler.
  const crossOrigin = rejectCrossOriginRequest(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { serverUrl, username, authHeader, slot: bodySlot } = await request.json();

    if (!serverUrl || !username || !authHeader) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Pin the upstream URL to a configured JMAP server (single `jmapServerUrl`
    // or any entry in `jmapServers`). Falls back to the request URL only when
    // `allowCustomJmapEndpoint` is enabled, and even then it must be public.
    await configManager.ensureLoaded();
    const configuredServerUrl =
      configManager.get<string>('jmapServerUrl', '') ||
      process.env.JMAP_SERVER_URL ||
      process.env.NEXT_PUBLIC_JMAP_SERVER_URL ||
      '';
    const allowCustomEndpoint = configManager.get<boolean>('allowCustomJmapEndpoint', false);
    const serverList = parseJmapServers(configManager.get<unknown>('jmapServers', []));
    const trustedUrl = resolveTrustedJmapUrl(serverUrl, configuredServerUrl, serverList);

    let upstreamUrl: string;
    let upstreamTrusted: boolean;
    if (trustedUrl) {
      upstreamUrl = trustedUrl;
      upstreamTrusted = true;
    } else if (allowCustomEndpoint) {
      if (!(await isPublicHttpUrl(serverUrl))) {
        return NextResponse.json({ error: 'Server URL is not allowed' }, { status: 400 });
      }
      upstreamUrl = serverUrl;
      upstreamTrusted = false;
    } else {
      return NextResponse.json({ error: 'JMAP server not configured' }, { status: 500 });
    }

    const slot = getSlot(request, bodySlot);
    // Trusted (admin-configured) URLs skip the upstream re-fetch, but we
    // still bind the cookie's `username` to the credential when we can verify
    // locally. Without this, a caller can POST username="admin@host" +
    // authHeader=<their own Basic creds>, and downstream consumers that read
    // the cookie-derived username (audit logs, login tracker) accept the
    // spoof. Bearer tokens are opaque so only the format check runs;
    // authorization sinks must key off the credential itself, not the
    // cookie's username claim (see admin/auth's authHeader-hashed cache key).
    let normalizedServerUrl: string;
    if (upstreamTrusted) {
      validateProxyAuthHeader(authHeader);
      assertBasicAuthMatchesUsername(authHeader, username);
      normalizedServerUrl = normalizeJmapServerUrl(upstreamUrl);
    } else {
      normalizedServerUrl = await verifyJmapAuth(upstreamUrl, authHeader, { trusted: false });
    }

    await setStalwartAuthContext(slot, {
      serverUrl: normalizedServerUrl,
      username,
      authHeader,
    });

    void recordLogin(username, normalizedServerUrl);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof JmapAuthVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logger.error('Failed to store Stalwart auth context', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}