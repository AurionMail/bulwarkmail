import { useEffect, useRef } from 'react';
import { registerComposeFlush, waitForComposeFlush } from '@/lib/compose-flush-registry';

/** How long an automatic sign-out waits for a minimised composer to open again and register. */
export const MINIMISED_COMPOSER_REOPEN_MS = 3000;

/**
 * A minimised composer's edits live only in its host's memory. While there
 * are unsaved ones, an automatic sign-out opens the composer again (`reopen`)
 * and lets it save itself (lib/compose-flush-registry.ts). A composer that
 * doesn't come back in time counts as a draft that wasn't saved.
 */
export function useMinimisedComposerFlush(minimisedUnsaved: boolean, reopen: () => void): void {
  const reopenRef = useRef(reopen);
  reopenRef.current = reopen;
  useEffect(() => {
    if (!minimisedUnsaved) return;
    return registerComposeFlush(async () => {
      const reopened = waitForComposeFlush(MINIMISED_COMPOSER_REOPEN_MS);
      reopenRef.current();
      const flush = await reopened;
      if (!flush) throw new Error('The minimised message did not open again');
      await flush();
    });
  }, [minimisedUnsaved]);
}
