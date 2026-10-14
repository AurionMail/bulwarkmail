import { describe, it, expect, beforeEach } from 'vitest';
import {
  awaitDialog,
  awaitCustomDialog,
  cancelForPlugin,
  head,
  resolveDialog,
  resolveHead,
  resetDialogLimits,
  MAX_DIALOGS_PER_MINUTE,
} from '../plugin-sandbox/host-dialog';

function confirm(pluginId: string) {
  return awaitDialog({ pluginId, kind: 'confirm', title: 't', message: 'm' });
}

beforeEach(() => {
  while (head()) resolveHead(false);
  resetDialogLimits();
});

describe('plugin dialog queue', () => {
  it('lets a plugin have one dialog open at a time', async () => {
    // A plugin opening dialogs in a loop used to cover the whole app; the
    // user could not reach Settings to turn it off.
    const first = confirm('looper');
    await expect(confirm('looper')).rejects.toThrow(/already has a dialog open/);
    resolveHead(true);
    expect(await first).toBe(true);
  });

  it('does not let one plugin block dialogs of another', async () => {
    const a = confirm('a');
    const b = confirm('b');
    resolveHead(true);
    resolveHead(false);
    expect(await a).toBe(true);
    expect(await b).toBe(false);
  });

  it('limits how many dialogs a plugin opens per minute', async () => {
    for (let i = 0; i < MAX_DIALOGS_PER_MINUTE; i++) {
      const p = confirm('chatty');
      resolveHead(true);
      await p;
    }
    await expect(confirm('chatty')).rejects.toThrow(/too many dialogs/);
  });

  it("resolves a custom dialog's own entry, not the next one in the queue", async () => {
    const custom = awaitCustomDialog({ pluginId: 'a', title: 't', message: '', slot: 'plugin-dialog' });
    const id = head()!.id;
    const other = confirm('b');

    resolveDialog(id, 'picked');
    resolveDialog(id, 'again'); // a second onResult call after the dialog closed

    expect(await custom).toBe('picked');
    expect(head()?.pluginId).toBe('b');
    resolveHead(false);
    expect(await other).toBe(false);
  });

  it('cancels a plugin\'s dialogs when it is turned off', async () => {
    const p = confirm('gone');
    cancelForPlugin('gone');
    expect(await p).toBe(false);
    expect(head()).toBeNull();
  });
});
