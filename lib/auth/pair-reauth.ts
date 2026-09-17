import { cookies } from 'next/headers';
import { encryptPayload, decryptPayload } from '@/lib/auth/crypto';
import { getCookieOptions } from '@/lib/oauth/cookie-config';

// Step-up re-authentication proof for device pairing. Generating a pairing QR
// provisions a new long-lived login on another device, so we require the user
// to have re-authenticated at the IdP within a short window first (see the
// reauth SSO flow). This proof is a short-lived, encrypted, httpOnly cookie —
// it is set only after a fresh IdP login and checked by /api/auth/pair/create.

const PAIR_REAUTH_COOKIE = 'pair_reauth';
const PAIR_REAUTH_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to render the QR

export async function setPairReauth(): Promise<void> {
  const cookieStore = await cookies();
  const value = encryptPayload({ purpose: 'pair', created_at: Date.now() }, 'pair-reauth');
  cookieStore.set(PAIR_REAUTH_COOKIE, value, {
    ...getCookieOptions(),
    maxAge: Math.floor(PAIR_REAUTH_TTL_MS / 1000),
  });
}

export async function hasValidPairReauth(): Promise<boolean> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PAIR_REAUTH_COOKIE)?.value;
  if (!raw) return false;
  const data = decryptPayload(raw, 'pair-reauth');
  if (!data || data.purpose !== 'pair') return false;
  const createdAt = typeof data.created_at === 'number' ? data.created_at : 0;
  // Belt-and-suspenders alongside the cookie maxAge: a forged/old proof whose
  // timestamp is outside the window is rejected even if the cookie survived.
  return Date.now() - createdAt <= PAIR_REAUTH_TTL_MS;
}

export async function clearPairReauth(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PAIR_REAUTH_COOKIE);
}
