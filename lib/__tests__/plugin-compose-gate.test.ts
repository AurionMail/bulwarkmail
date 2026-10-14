// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailHooks, clearAllHooks } from '../plugin-hooks';
import { runBeforeCompose, composeOptionsFor, acceptComposeOptions } from '../plugin-compose-gate';
import { formatMailto, parseMailto } from '../protocol-handlers/mailto';

beforeEach(() => clearAllHooks());

const blank = { mode: 'new' as const, to: [], cc: [], subject: '', body: '' };

describe('runBeforeCompose', () => {
  it('lets the composer open with no prefill when nobody listens', async () => {
    expect(await runBeforeCompose(blank)).toEqual({});
  });

  it('stops the composer when a plugin returns false', async () => {
    emailHooks.onBeforeCompose.register('p', () => false);
    expect(await runBeforeCompose(blank)).toBeNull();
  });

  it('returns only the fields a plugin changed', async () => {
    const handler = vi.fn((o: Record<string, unknown>) => ({ ...o, subject: 'Status', body: 'Hi team,\n' }));
    emailHooks.onBeforeCompose.register('p', handler);
    const opts = { mode: 'reply' as const, to: ['alice@example.com'], cc: [], subject: 'Re: Plans', body: '' };
    expect(await runBeforeCompose(opts)).toEqual({ subject: 'Status', body: 'Hi team,\n' });
    expect(handler).toHaveBeenCalledWith(opts);
  });
});

describe('acceptComposeOptions', () => {
  it('keeps clean strings and ignores the wrong types', () => {
    const out = acceptComposeOptions({
      to: ['a@example.com', 42, '  ', 'b@example.com\r\nBcc: evil@example.com'],
      cc: 'not a list',
      subject: 'Hello\nworld',
      body: 'Line 1\r\nLine 2\u0007',
      mode: 'forward',
    }, blank);
    expect(out).toEqual({
      mode: 'new',
      to: ['a@example.com', 'b@example.comBcc: evil@example.com'],
      cc: [],
      subject: 'Helloworld',
      body: 'Line 1\nLine 2',
    });
  });

  it('ignores anything but an object', () => {
    expect(acceptComposeOptions('x', blank)).toBeUndefined();
    expect(acceptComposeOptions([], blank)).toBeUndefined();
  });
});

describe('composeOptionsFor', () => {
  it('describes a reply the way the composer fills it in', () => {
    const source = {
      from: [{ name: 'Alice', email: 'alice@example.com' }],
      to: [{ email: 'me@example.com' }, { email: 'bob@example.com' }],
      cc: [{ email: 'carol@example.com' }],
      subject: 'Plans',
    };
    expect(composeOptionsFor('replyAll', { source, ownEmails: ['me@example.com'], replyPrefix: 'Re:' })).toEqual({
      mode: 'reply-all',
      to: ['Alice <alice@example.com>', 'bob@example.com'],
      cc: ['carol@example.com'],
      subject: 'Re: Plans',
      body: '',
    });
    expect(composeOptionsFor('forward', { source, forwardPrefix: 'Fwd:' })).toMatchObject({ mode: 'forward', to: [], subject: 'Fwd: Plans' });
  });
});

describe('formatMailto', () => {
  it('round-trips through parseMailto', () => {
    const fields = { to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'], bcc: [], subject: 'Hi & bye', body: 'Line\nnext' };
    expect(parseMailto(formatMailto(fields))).toEqual(fields);
  });
});
