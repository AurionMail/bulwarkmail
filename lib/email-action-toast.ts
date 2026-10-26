import { toast } from "@/stores/toast-store";
import { useEmailStore } from "@/stores/email-store";

/**
 * Runs a bulk email-store action and toasts the outcome: a failure always, a
 * success when there is a message for it. Most batch actions report failure
 * through `state.error` instead of throwing (batchArchive does both), so a
 * resolved promise alone does not mean the mail moved. An action that
 * resolves `false` did nothing: a plugin vetoed it (and told the user why) or
 * there was nothing to act on, so there is no success to report.
 */
export async function runBatchEmailAction(
  run: () => Promise<boolean | void>,
  messages: { success?: string; error: string; describeError?: (error: unknown) => string | undefined },
): Promise<void> {
  // An error left over from an earlier action is not this action's outcome.
  useEmailStore.setState({ error: null });
  let ran: boolean | void;
  try {
    ran = await run();
  } catch (error) {
    console.error(messages.error, error);
    const detail = messages.describeError?.(error) ?? (error instanceof Error ? error.message : undefined);
    toast.error(messages.error, detail);
    return;
  }
  const storeError = useEmailStore.getState().error;
  if (storeError) {
    toast.error(messages.error, storeError);
  } else if (ran !== false && messages.success) {
    toast.success(messages.success);
  }
}
