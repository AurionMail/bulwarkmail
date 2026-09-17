import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';
import { refreshTokenCookieName, refreshTokenServerCookieName } from '@/lib/oauth/tokens';
import { buildOAuthParams, getRequiredConfig, getTokenEndpoint } from '@/lib/oauth/token-exchange';
import { getCookieOptions } from '@/lib/oauth/cookie-config';
import { createPairing } from '@/lib/auth/pairing-store';
import { hasValidPairReauth } from '@/lib/auth/pair-reauth';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { rejectCrossOriginRequest } from '@/lib/security/same-origin';

// Desktop side of the cross-device QR login. The caller must be a signed-in
// webmail session (its refresh token lives in the httpOnly jmap_rt cookie). We
// refresh that token to (a) prove the session is live and (b) obtain a fresh
// access token to hand the phone, then stash the bundle under a one-time
// pairing code. The desktop renders the returned code as a QR; the phone
// redeems it at /api/auth/pair/redeem.
//
// Token sharing note: the phone receives the SAME refresh token as the desktop.
// That is correct for OAuth servers (such as Stalwart in its default config)
// that do not rotate refresh tokens on use. If the server rotates refresh
// tokens, the two devices would fight over the latest token — such deployments
// should disable rotation for this client or use a token-exchange grant.
export async function POST(request: NextRequest) {
  // CSRF gate (GHSA-qvr9-m8cq-7wvg): cookies written here are SameSite=Lax,
  // so a cross-site top-level POST would otherwise reach this handler.
  const crossOrigin = rejectCrossOriginRequest(request);
  if (crossOrigin) return crossOrigin;
  const cookieStore = await cookies();
  try {
    // Step-up gate: minting a pairing code grants new-device access, so it
    // requires a recent fresh IdP re-authentication (see the reauth SSO flow).
    // The client turns this 401 into a re-auth redirect, then retries.
    if (!(await hasValidPairReauth())) {
      return NextResponse.json({ error: 'reauth_required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const slot =
      typeof body.slot === 'number' && body.slot >= 0 && body.slot < MAX_ACCOUNT_SLOTS
        ? body.slot
        : 0;

    const cookieName = refreshTokenCookieName(slot);
    const refreshToken = cookieStore.get(cookieName)?.value;
    if (!refreshToken) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const serverId = cookieStore.get(refreshTokenServerCookieName(slot))?.value || null;

    const tokenEndpoint = await getTokenEndpoint(serverId);
    const params = buildOAuthParams({ grant_type: 'refresh_token', refresh_token: refreshToken }, serverId);

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.warn('Pair create: refresh failed', { status: tokenResponse.status, error: errorText });
      // Stale session — clear the dead cookie so the user is prompted to log
      // back in, mirroring the token route's behaviour.
      cookieStore.delete(cookieName);
      cookieStore.delete(refreshTokenServerCookieName(slot));
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
      logger.error('Pair create: refresh response missing access_token');
      return NextResponse.json({ error: 'Invalid token response' }, { status: 502 });
    }

    // If the server rotated the refresh token, persist the new one back to the
    // desktop's cookie so this very session keeps working. The phone will get
    // the same (new) token below.
    const effectiveRefreshToken = tokens.refresh_token || refreshToken;
    if (tokens.refresh_token) {
      cookieStore.set(cookieName, tokens.refresh_token, getCookieOptions());
    }

    const { clientId, serverUrl } = getRequiredConfig(serverId);

    const { code, expiresIn } = createPairing({
      accessToken: tokens.access_token,
      refreshToken: effectiveRefreshToken,
      expiresIn: tokens.expires_in,
      tokenEndpoint,
      clientId,
      serverUrl,
      serverId,
    });

    return NextResponse.json({ pairing_code: code, server_url: serverUrl, expires_in: expiresIn });
  } catch (error) {
    logger.error('Pair create error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
