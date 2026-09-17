import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { consumePairing } from '@/lib/auth/pairing-store';
import { rejectCrossOriginRequest } from '@/lib/security/same-origin';

// Phone side of the cross-device QR login. The app POSTs the pairing code it
// scanned; we hand back the OAuth token bundle the desktop stashed at
// /api/auth/pair/create. The code is the only credential required — it is
// high-entropy, single-use, and expires within ~2 minutes — so this route is
// intentionally unauthenticated (the scanning device has no webmail cookies).
export async function POST(request: NextRequest) {
  // CSRF gate (GHSA-qvr9-m8cq-7wvg): cookies written here are SameSite=Lax,
  // so a cross-site top-level POST would otherwise reach this handler.
  const crossOrigin = rejectCrossOriginRequest(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { pairing_code: pairingCode } = await request.json().catch(() => ({}));
    if (!pairingCode || typeof pairingCode !== 'string') {
      return NextResponse.json({ error: 'Missing pairing code' }, { status: 400 });
    }

    const tokens = consumePairing(pairingCode);
    if (!tokens) {
      // Unknown, expired, or already redeemed — do not distinguish.
      return NextResponse.json({ error: 'Invalid or expired pairing code' }, { status: 400 });
    }

    return NextResponse.json({
      flow: 'oauth',
      server_url: tokens.serverUrl,
      access_token: tokens.accessToken,
      ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
      ...(typeof tokens.expiresIn === 'number' ? { expires_in: tokens.expiresIn } : {}),
      token_endpoint: tokens.tokenEndpoint,
      client_id: tokens.clientId,
    });
  } catch (error) {
    logger.error('Pair redeem error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
