// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailHooks, clearAllHooks } from '../plugin-hooks';
import { emitThreadExpand } from '../plugin-thread-expand';

beforeEach(() => clearAllHooks());

describe('emitThreadExpand', () => {
  it('reports the thread id and its messages', () => {
    const handler = vi.fn();
    emailHooks.onThreadExpand.register('test', handler);
    emitThreadExpand('acct/x:T1', [{ id: 'a', threadId: 'T1' }, { id: 'b', threadId: 'T1' }], true);
    expect(handler).toHaveBeenCalledWith({ threadId: 'T1', emailIds: ['a', 'b'], expanded: true });
  });

  it('falls back to the id inside an account-scoped thread key', () => {
    const handler = vi.fn();
    emailHooks.onThreadExpand.register('test', handler);
    emitThreadExpand('acct/x:T1', [], false);
    expect(handler).toHaveBeenCalledWith({ threadId: 'T1', emailIds: [], expanded: false });
  });
});
