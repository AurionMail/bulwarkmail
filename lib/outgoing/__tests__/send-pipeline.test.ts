import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  finalizeOutgoing,
  registerOutgoingFinalizer,
  registerPreSendCheck,
  resetSendPipeline,
  runPreSendChecks,
  type OutgoingContext,
} from '@/lib/outgoing/send-pipeline';

vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));

const CONTEXT: OutgoingContext = {
  surface: 'composer', to: ['a@example.com'], cc: [], bcc: [], mode: 'compose', plainText: false,
};

afterEach(() => resetSendPipeline());

describe('finalizeOutgoing', () => {
  it('runs finalisers in order and leaves the bodies alone without any', () => {
    expect(finalizeOutgoing({ html: '<p>x</p>', text: 'x' }, CONTEXT)).toEqual({ html: '<p>x</p>', text: 'x' });
    registerOutgoingFinalizer('second', 20, (b) => ({ ...b, text: `${b.text}2` }));
    registerOutgoingFinalizer('first', 10, (b) => ({ ...b, text: `${b.text}1` }));
    expect(finalizeOutgoing({ text: 'x' }, CONTEXT).text).toBe('x12');
  });

  it('replaces a finaliser registered again under the same id, and unregisters', () => {
    registerOutgoingFinalizer('f', 10, (b) => ({ ...b, text: 'old' }));
    const off = registerOutgoingFinalizer('f', 10, (b) => ({ ...b, text: 'new' }));
    expect(finalizeOutgoing({ text: 'x' }, CONTEXT).text).toBe('new');
    off();
    expect(finalizeOutgoing({ text: 'x' }, CONTEXT).text).toBe('x');
  });

  it('skips a finaliser that throws', () => {
    registerOutgoingFinalizer('broken', 10, () => { throw new Error('boom'); });
    registerOutgoingFinalizer('ok', 20, (b) => ({ ...b, text: `${b.text}!` }));
    expect(finalizeOutgoing({ text: 'x' }, CONTEXT).text).toBe('x!');
  });
});

describe('runPreSendChecks', () => {
  it('stops at the first check that says no', async () => {
    const later = vi.fn(() => true);
    registerPreSendCheck('no', 10, async () => false);
    registerPreSendCheck('later', 20, later);
    expect(await runPreSendChecks(CONTEXT)).toBe(false);
    expect(later).not.toHaveBeenCalled();
  });

  it('sends when every check agrees or there are none, and skips one that throws', async () => {
    expect(await runPreSendChecks(CONTEXT)).toBe(true);
    registerPreSendCheck('broken', 10, () => { throw new Error('boom'); });
    registerPreSendCheck('yes', 20, () => true);
    expect(await runPreSendChecks(CONTEXT)).toBe(true);
  });
});
