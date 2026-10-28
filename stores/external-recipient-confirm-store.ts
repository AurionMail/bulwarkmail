import { create } from 'zustand';
import type { ExternalRecipient } from '@/lib/external-mail';

interface Question {
  recipients: ExternalRecipient[];
  resolve: (send: boolean) => void;
}

/**
 * The "Send outside your organisation?" questions. The pre-send check asks,
 * the dialog (components/email/external-recipient-confirm.tsx) shows the
 * first and answers it. A question asked while another is open waits its
 * turn: two sends at once (a quick reply and the composer) each get their
 * own answer.
 */
interface ExternalRecipientConfirmState {
  /** The question on screen, the first in line. */
  pending: Question | null;
  /** The ones waiting behind it. */
  queue: Question[];
  /** Resolves true for "Send anyway", false for "Back". */
  ask: (recipients: ExternalRecipient[]) => Promise<boolean>;
  /** Answers the question on screen and shows the next. */
  answer: (send: boolean) => void;
  /** Answers every question with "Back" (the dialog went away). */
  cancelAll: () => void;
}

export const useExternalRecipientConfirmStore = create<ExternalRecipientConfirmState>()((set, get) => ({
  pending: null,
  queue: [],
  ask: (recipients) => new Promise<boolean>((resolve) => {
    const question = { recipients, resolve };
    if (get().pending) set((state) => ({ queue: [...state.queue, question] }));
    else set({ pending: question });
  }),
  answer: (send) => {
    const { pending, queue } = get();
    if (!pending) return;
    const [next = null, ...rest] = queue;
    set({ pending: next, queue: rest });
    pending.resolve(send);
  },
  cancelAll: () => {
    const { pending, queue } = get();
    set({ pending: null, queue: [] });
    for (const question of [pending, ...queue]) question?.resolve(false);
  },
}));
