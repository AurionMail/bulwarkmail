/**
 * What the sign-in routes answer (`error`) when they refuse a session that
 * reached the organisation's maximum length. The server (lib/auth/session-age.ts)
 * and the browser (stores/auth-store.ts) both read it from here.
 */
export const SESSION_TOO_OLD = 'session_expired';
