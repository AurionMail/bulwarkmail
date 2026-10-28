import { create } from 'zustand';
import type { ExternalRecipient } from '@/lib/external-mail';

/**
 * The one open "Send outside your organisation?" question. The pre-send
 * check asks, the dialog (components/email/external-recipient-confirm.tsx)
 * shows it and answers. Asking again while a question is open answers the
 * old one with "Back", so no send waits forever.
 */
interface ExternalRecipientConfirmState {
  pending: { recipients: ExternalRecipient[]; resolve: (send: boolean) => void } | null;
  /** Resolves true for "Send anyway", false for "Back". */
  ask: (recipients: ExternalRecipient[]) => Promise<boolean>;
  answer: (send: boolean) => void;
}

export const useExternalRecipientConfirmStore = create<ExternalRecipientConfirmState>()((set, get) => ({
  pending: null,
  ask: (recipients) => {
    get().pending?.resolve(false);
    return new Promise<boolean>((resolve) => {
      set({ pending: { recipients, resolve } });
    });
  },
  answer: (send) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(send);
  },
}));
