import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';
import { decryptPayload } from '@/lib/auth/crypto';
import { exchangeCodeForTokens } from '@/lib/oauth/token-exchange';
import { setPairReauth } from '@/lib/auth/pair-reauth';
import { rejectCrossOriginRequest } from '@/lib/security/same-origin';

// Completes the step-up re-authentication for device pairing. The user was sent
// to the IdP with prompt=login (see /api/auth/sso/start with purpose=reauth);
// here we verify the returned code against the pending state and exchange it to
// confirm a fresh login actually happened, then set the short-lived pairing
// re-auth proof cookie. We deliberately do NOT issue a login session or write
// any refresh-token cookies — the user is already signed in; this only proves
// recency for the pairing action.

const SSO_PENDING_COOKIE = 'sso_pending';
const SSO_PENDING_MAX_AGE_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  // CSRF gate (GHSA-qvr9-m8cq-7wvg): cookies written here are SameSite=Lax,
  // so a cross-site top-level POST would otherwise reach this handler.
  const crossOrigin = rejectCrossOriginRequest(request);
  if (crossOrigin) return crossOrigin;
  const cookieStore = await cookies();
  try {
    const { code, state } = await request.json();
    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    const pendingCookie = cookieStore.get(SSO_PENDING_COOKIE)?.value;
    if (!pendingCookie) {
      return NextResponse.json({ error: 'No pending re-auth session' }, { status: 400 });
    }

    const pending = decryptPayload(pendingCookie);
    cookieStore.delete(SSO_PENDING_COOKIE);
    if (!pending) {
      return NextResponse.json({ error: 'Invalid re-auth session' }, { status: 400 });
    }

    // Only honor pending sessions that were started for the reauth purpose, so
    // a normal login code can't be redirected into setting a pairing proof.
    if (pending.purpose !== 'reauth') {
      return NextResponse.json({ error: 'Not a re-auth session' }, { status: 400 });
    }
    if (pending.state !== state) {
      return NextResponse.json({ error: 'State mismatch' }, { status: 400 });
    }
    const createdAt = pending.created_at as number;
    if (!createdAt || Date.now() - createdAt > SSO_PENDING_MAX_AGE_MS) {
      return NextResponse.json({ error: 'Re-auth session expired' }, { status: 400 });
    }

    const codeVerifier = pending.code_verifier as string;
    const redirectUri = pending.redirect_uri as string;
    const pendingServerId = typeof pending.server_id === 'string' ? pending.server_id : null;
    if (!codeVerifier || !redirectUri) {
      return NextResponse.json({ error: 'Invalid re-auth session data' }, { status: 400 });
    }

    // A successful exchange proves the user just authenticated at the IdP (the
    // freshness is enforced by prompt=login on the authorize request). We don't
    // keep the resulting tokens.
    await exchangeCodeForTokens(code, codeVerifier, redirectUri, pendingServerId);

    await setPairReauth();
    return NextResponse.json({ ok: true });
  } catch (error) {
    cookieStore.delete(SSO_PENDING_COOKIE);
    logger.error('Reauth complete error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Re-authentication failed' }, { status: 401 });
  }
}
