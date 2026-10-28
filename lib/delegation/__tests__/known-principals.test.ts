import { beforeEach, describe, expect, it } from 'vitest';
import { forgetPrincipals, rememberPrincipals, rememberedPrincipals } from '../known-principals';
import type { Principal } from '@/lib/jmap/types';

const person = (id: string): Principal => ({ id, type: 'individual', name: `${id}@example.org`, email: `${id}@example.org` });

beforeEach(() => localStorage.clear());

describe('known principals', () => {
  it('keeps names per account', () => {
    rememberPrincipals('acc-1', [person('ck')]);
    rememberPrincipals('acc-2', [person('cj')]);
    expect([...rememberedPrincipals('acc-1').keys()]).toEqual(['ck']);
    expect([...rememberedPrincipals('acc-2').keys()]).toEqual(['cj']);
  });

  it('forgets one account and leaves the others', () => {
    rememberPrincipals('acc-1', [person('ck')]);
    rememberPrincipals('acc-2', [person('cj')]);
    forgetPrincipals('acc-1');
    expect(rememberedPrincipals('acc-1').size).toBe(0);
    expect([...rememberedPrincipals('acc-2').keys()]).toEqual(['cj']);
  });

  it('leaves no key behind when the last account goes', () => {
    rememberPrincipals('acc-1', [person('ck')]);
    forgetPrincipals('acc-1');
    expect(localStorage.getItem('bulwark-delegate-names')).toBeNull();
  });

  it('keeps at most 200 per account, dropping the oldest', () => {
    rememberPrincipals('acc-1', Array.from({ length: 205 }, (_, i) => person(`p${i}`)));
    const ids = [...rememberedPrincipals('acc-1').keys()];
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('p5');
  });
});
