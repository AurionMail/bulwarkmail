import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExternalRecipientConfirmHost } from '../external-recipient-confirm';
import { useExternalRecipientConfirmStore } from '@/stores/external-recipient-confirm-store';
import { resetSendPipeline } from '@/lib/outgoing/send-pipeline';

// The confirm dialog keeps its keys: the mail view's shortcuts listen on the
// window, and must not see Escape (close the message), j/k (move the list)
// or Enter (open a message) while the question is open. Real focus trap.

const RECIPIENTS = [{ address: 'org-dave@org-two.test', domain: 'org-two.test', field: 'to' as const }];
const pageKeys = vi.fn();

beforeEach(() => {
  useExternalRecipientConfirmStore.setState({ pending: null, queue: [] });
  window.addEventListener('keydown', pageKeys);
});
afterEach(() => {
  window.removeEventListener('keydown', pageKeys);
  pageKeys.mockReset();
  cleanup();
  resetSendPipeline();
});

function open() {
  const view = render(<ExternalRecipientConfirmHost />);
  let answer!: Promise<boolean>;
  act(() => { answer = useExternalRecipientConfirmStore.getState().ask(RECIPIENTS); });
  const back = view.container.querySelector('[data-external-recipient-back]') as HTMLButtonElement;
  const send = view.container.querySelector('[data-external-recipient-send]') as HTMLButtonElement;
  return { answer, back, send };
}

describe('keys in the external recipient confirm', () => {
  it('puts the focus on Back and keeps shortcut keys from the page', () => {
    const { back } = open();
    expect(document.activeElement).toBe(back);
    for (const key of ['j', 'k', 'Enter', 'Escape']) {
      act(() => { fireEvent.keyDown(document.activeElement!, { key }); });
      // Re-open after Escape and Enter answered it.
      if (!useExternalRecipientConfirmStore.getState().pending) act(() => { void useExternalRecipientConfirmStore.getState().ask(RECIPIENTS); });
    }
    expect(pageKeys).not.toHaveBeenCalled();
  });

  it('answers Back on Escape', async () => {
    const { answer } = open();
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(await answer).toBe(false);
  });

  it('presses the focused button on Enter and on Space', async () => {
    const first = open();
    first.send.focus();
    act(() => { fireEvent.keyDown(first.send, { key: 'Enter' }); });
    expect(await first.answer).toBe(true);

    let second!: Promise<boolean>;
    act(() => { second = useExternalRecipientConfirmStore.getState().ask(RECIPIENTS); });
    act(() => { fireEvent.keyDown(document.activeElement!, { key: ' ' }); });
    // The focus went back to the first button, Back.
    expect(await second).toBe(false);
  });
});
