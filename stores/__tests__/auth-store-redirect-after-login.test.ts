import { beforeEach, describe, expect, it } from 'vitest';
import { saveRedirectAfterLogin } from '../auth-store';

// Where login sends the user back to. The app's home is where a login lands
// anyway; saving it made the login page navigate a second time, to /en/en
// (the locale-aware router prefixes the locale again), racing the first.

describe('saveRedirectAfterLogin', () => {
  beforeEach(() => sessionStorage.clear());

  it('saves nothing on the home page, and drops an older target', () => {
    sessionStorage.setItem('redirect_after_login', '/en/settings');
    window.history.pushState({}, '', '/en');
    saveRedirectAfterLogin();
    expect(sessionStorage.getItem('redirect_after_login')).toBeNull();
  });

  it('keeps a deep link, query and hash included', () => {
    window.history.pushState({}, '', '/en/calendar?view=day#e1');
    saveRedirectAfterLogin();
    expect(sessionStorage.getItem('redirect_after_login')).toBe('/en/calendar?view=day#e1');
  });

  it('keeps the home page with a query, which carries a deep link', () => {
    window.history.pushState({}, '', '/en?email=abc');
    saveRedirectAfterLogin();
    expect(sessionStorage.getItem('redirect_after_login')).toBe('/en?email=abc');
  });
});
