import { NextResponse } from 'next/server';
import { ConfigReadOnlyError } from './paths';

/**
 * The 409 an admin route answers when a write hit ADMIN_CONFIG_READONLY,
 * carrying the ConfigReadOnlyError message so the panel can show why
 * nothing was saved (#1249). Returns null for any other error, which the
 * route keeps reporting as a 500.
 */
export function configReadOnlyResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ConfigReadOnlyError)) return null;
  return NextResponse.json({ error: error.message }, { status: 409 });
}
