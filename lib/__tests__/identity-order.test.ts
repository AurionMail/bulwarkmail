import { describe, it, expect } from 'vitest';
import { emailMatchesLogin, sortIdentities } from '@/lib/identity-order';
import type { Identity } from '@/lib/jmap/types';

const identity = (id: string, email: string, mayDelete = false): Identity => ({ id, name: id, email, mayDelete });

describe('sortIdentities', () => {
  // Seen on a live 1.0 server: for a member of team@example.org, Identity/get
  // lists the group's identity first.
  it("puts the login's own identity ahead of the group's on Stalwart 1.0, whatever the login's case", () => {
    const fromServer = [identity('team', 'team@example.org'), identity('usera', 'usera@example.org')];

    expect(sortIdentities(fromServer, 'UserA@Example.ORG').map((i) => i.id)).toEqual(['usera', 'team']);
    expect(sortIdentities(fromServer, 'usera@example.org').map((i) => i.id)).toEqual(['usera', 'team']);
  });

  it('keeps the order Stalwart 0.16 sends, which already has the own identity first', () => {
    const fromServer = [identity('usera', 'usera@example.org'), identity('team', 'team@example.org')];
    expect(sortIdentities(fromServer, 'USERA@example.org').map((i) => i.id)).toEqual(['usera', 'team']);
  });

  it('prefers the canonical identity over an alias of the same address', () => {
    const fromServer = [identity('alias', 'UserA@example.org', true), identity('canonical', 'usera@example.org')];
    expect(sortIdentities(fromServer, 'usera@example.org').map((i) => i.id)).toEqual(['canonical', 'alias']);
  });

  it('leaves the rest in server order', () => {
    const fromServer = [identity('b', 'b@example.org'), identity('me', 'me@example.org'), identity('a', 'a@example.org')];
    expect(sortIdentities(fromServer, 'me@example.org').map((i) => i.id)).toEqual(['me', 'b', 'a']);
  });
});

describe('emailMatchesLogin', () => {
  it('ignores case in the local part and the domain', () => {
    expect(emailMatchesLogin('usera@example.org', 'UserA@EXAMPLE.org')).toBe(true);
    expect(emailMatchesLogin('usera@example.org', 'userb@example.org')).toBe(false);
  });

  it('matches a bare login name against the local part', () => {
    expect(emailMatchesLogin('usera@example.org', 'UserA')).toBe(true);
    expect(emailMatchesLogin('team@example.org', 'usera')).toBe(false);
  });

  it('matches an internationalized domain in either form', () => {
    // Stalwart stores the ASCII form; the login may have been typed in Unicode.
    expect(emailMatchesLogin('anna@xn--bcher-kva.de', 'Anna@Bücher.de')).toBe(true);
    expect(emailMatchesLogin('anna@bücher.de', 'anna@xn--bcher-kva.de')).toBe(true);
    expect(emailMatchesLogin('anna@xn--bcher-kva.de', 'anna@bucher.de')).toBe(false);
  });
});
