import { describe, expect, it } from 'vitest';
import { MOBILE_HANDOFF_REDIRECT_URI, buildMobileHandoffUrl, mobileHandoffTarget } from '@/lib/auth/mobile-handoff';

// The login page handed the typed password (and the SSO callback the tokens)
// to any `bulwarkmobile://` URL named in the query string, with nothing on
// screen to tell the page apart from a normal sign-in. The target is now the
// app's one callback link, and the pages confirm with the user before they
// navigate (components/auth/mobile-handoff-consent.tsx).

describe('mobileHandoffTarget', () => {
  it('accepts only the mobile app callback link', () => {
    expect(mobileHandoffTarget('bulwarkmobile://auth/callback')).toBe(MOBILE_HANDOFF_REDIRECT_URI);
    expect(mobileHandoffTarget(' bulwarkmobile://auth/callback/ ')).toBe(MOBILE_HANDOFF_REDIRECT_URI);
  });

  it.each([
    'bulwarkmobile://x',
    'bulwarkmobile://auth/callback?x=1',
    'bulwarkmobile://auth/callback#frag',
    'bulwarkmobile://evil.example/auth/callback',
    'https://evil.example/',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ])('refuses %s', (raw) => {
    expect(mobileHandoffTarget(raw)).toBe('');
  });
});

describe('buildMobileHandoffUrl', () => {
  it('puts the material in the fragment, encoded', () => {
    const url = buildMobileHandoffUrl(MOBILE_HANDOFF_REDIRECT_URI, { flow: 'password', password: 'p&ss#1', state: 's' });
    expect(url.startsWith('bulwarkmobile://auth/callback#')).toBe(true);
    expect(url).toContain('password=p%26ss%231');
    expect(url.split('#')).toHaveLength(2);
  });
});
