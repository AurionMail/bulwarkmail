// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAllHooks, uiHooks, pluginErrorTracker } from '../plugin-hooks';
import { interceptWithResult, acceptLinkRewrite, resolveExternalLink } from '../plugin-hook-result';


beforeEach(() => {
  clearAllHooks();
  pluginErrorTracker.resetAll();
});

describe('interceptWithResult', () => {
  it('lets the action through unchanged without handlers', async () => {
    const ctx = { href: 'https://a.example/' };
    expect(await interceptWithResult(uiHooks.onBeforeExternalLink, ctx, acceptLinkRewrite))
      .toEqual({ allowed: true, value: ctx });
  });

  it('stops on false and does not ask later handlers', async () => {
    const later = vi.fn();
    uiHooks.onBeforeExternalLink.register('a', () => false);
    uiHooks.onBeforeExternalLink.register('b', later);
    const out = await interceptWithResult(uiHooks.onBeforeExternalLink, { href: 'https://a.example/' }, acceptLinkRewrite);
    expect(out).toEqual({ allowed: false });
    expect(later).not.toHaveBeenCalled();
  });

  it('takes a returned { href } and hands it to the next handler', async () => {
    const second = vi.fn(() => undefined);
    uiHooks.onBeforeExternalLink.register('a', () => ({ href: 'https://proxy.example/?u=1' }));
    uiHooks.onBeforeExternalLink.register('b', second);
    const out = await interceptWithResult(uiHooks.onBeforeExternalLink, { href: 'https://a.example/', emailId: 'e1' }, acceptLinkRewrite);
    expect(out).toEqual({ allowed: true, value: { href: 'https://proxy.example/?u=1', emailId: 'e1' } });
    expect(second).toHaveBeenCalledWith({ href: 'https://proxy.example/?u=1', emailId: 'e1' });
  });

  it('calls every handler once', async () => {
    const handler = vi.fn(() => ({ href: 'https://b.example/' }));
    uiHooks.onBeforeExternalLink.register('a', handler);
    await interceptWithResult(uiHooks.onBeforeExternalLink, { href: 'https://a.example/' }, acceptLinkRewrite);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips a handler that throws (fails open)', async () => {
    uiHooks.onBeforeExternalLink.register('a', () => { throw new Error('boom'); });
    const out = await interceptWithResult(uiHooks.onBeforeExternalLink, { href: 'https://a.example/' }, acceptLinkRewrite);
    expect(out).toEqual({ allowed: true, value: { href: 'https://a.example/' } });
  });
});

describe('acceptLinkRewrite', () => {
  const cur = { href: 'https://a.example/' };
  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    '/settings',
    'mailto:x@example.com',
    'https://',
  ])('ignores %s', (href) => {
    expect(acceptLinkRewrite({ href }, cur)).toBeUndefined();
  });

  it('ignores anything but an object with a string href', () => {
    expect(acceptLinkRewrite('https://b.example/', cur)).toBeUndefined();
    expect(acceptLinkRewrite({ href: 42 }, cur)).toBeUndefined();
  });

  it('takes an http(s) address', () => {
    expect(acceptLinkRewrite({ href: ' HTTP://b.example/x ' }, cur)).toEqual({ href: 'HTTP://b.example/x' });
  });
});

describe('resolveExternalLink (a link clicked in a message)', () => {
  const ctx = { href: 'https://a.example/', emailId: 'e1' };

  it('opens the original address without plugins', async () => {
    expect(await resolveExternalLink(ctx)).toBe('https://a.example/');
  });

  it('opens the address a plugin returns', async () => {
    const handler = vi.fn(() => ({ href: 'https://proxy.example/?u=a' }));
    uiHooks.onBeforeExternalLink.register('p', handler);
    expect(await resolveExternalLink(ctx)).toBe('https://proxy.example/?u=a');
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  it('opens nothing when a plugin returns false', async () => {
    uiHooks.onBeforeExternalLink.register('p', () => false);
    expect(await resolveExternalLink(ctx)).toBeNull();
  });

  it('keeps the original when the rewrite is not a web address', async () => {
    uiHooks.onBeforeExternalLink.register('p', () => ({ href: 'javascript:alert(1)' }));
    expect(await resolveExternalLink(ctx)).toBe('https://a.example/');
  });
});
