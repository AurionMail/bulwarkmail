import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEmailStore } from '../email-store';
import { emailHooks } from '@/lib/plugin-hooks';
import type { Email } from '@/lib/jmap/types';

// Opening a message shows its list row at once (beginOpenEmail) and swaps in
// the fetched message when it lands (finishOpenEmail). Plugins hear the open
// once, with the full message, and the close of whatever was open before.

const row = (id: string): Email => ({
  id, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: {}, subject: `Subject ${id}`,
  receivedAt: '2026-10-01T00:00:00Z', from: [], to: [], preview: 'preview', size: 1, hasAttachment: false,
} as Email);
const full = (id: string): Email => ({
  ...row(id),
  textBody: [{ partId: '1', type: 'text/plain' }],
  bodyValues: { 1: { value: 'body text' } },
} as unknown as Email);

describe('opening a message from the list', () => {
  const opened: string[] = [];
  const closed: string[] = [];
  let offOpen: () => void;
  let offClose: () => void;

  beforeEach(() => {
    opened.length = 0;
    closed.length = 0;
    const openReg = emailHooks.onEmailOpen.register('test', ((view: { id: string; text?: string }) => { opened.push(`${view.id}:${view.text ?? ''}`); }) as never);
    const closeReg = emailHooks.onEmailClose.register('test', ((e: { emailId: string }) => { closed.push(e.emailId); }) as never);
    offOpen = () => openReg.dispose();
    offClose = () => closeReg.dispose();
    useEmailStore.setState({ selectedEmail: full('a'), isLoadingEmail: false });
  });
  afterEach(() => { offOpen(); offClose(); });

  it('shows the row and its loading state in one write, then the fetched message', () => {
    // Every state the subscribers see: never the row without its loading
    // state (that would be a render with an empty body), never two writes.
    const seen: string[] = [];
    const unsubscribe = useEmailStore.subscribe((state, prev) => {
      if (state.selectedEmail !== prev.selectedEmail || state.isLoadingEmail !== prev.isLoadingEmail) {
        seen.push(`${state.selectedEmail?.id}:${state.isLoadingEmail}`);
      }
    });
    useEmailStore.getState().beginOpenEmail(row('b'));
    unsubscribe();

    expect(seen).toEqual(['b:true']);
    expect(useEmailStore.getState()).toMatchObject({ selectedEmail: { id: 'b' }, isLoadingEmail: true });
    expect(closed).toEqual(['a']);
    // No open for the row: it has no body, headers or attachments yet.
    expect(opened).toEqual([]);

    useEmailStore.getState().finishOpenEmail(full('b'));
    expect(useEmailStore.getState()).toMatchObject({ selectedEmail: { id: 'b', bodyValues: { 1: { value: 'body text' } } }, isLoadingEmail: false });
    expect(opened).toEqual(['b:body text']);
    expect(closed).toEqual(['a']);
  });

  it('reopens what was open before when the fetch fails', () => {
    const previous = useEmailStore.getState().selectedEmail;
    useEmailStore.getState().beginOpenEmail(row('b'));
    useEmailStore.getState().abandonOpenEmail(previous);

    expect(useEmailStore.getState()).toMatchObject({ selectedEmail: previous, isLoadingEmail: false });
    expect(opened).toEqual(['a:body text']);
  });

  it('announces close and open when the message comes without a row shown first', () => {
    useEmailStore.getState().finishOpenEmail(full('c'));
    expect(closed).toEqual(['a']);
    expect(opened).toEqual(['c:body text']);
  });
});
