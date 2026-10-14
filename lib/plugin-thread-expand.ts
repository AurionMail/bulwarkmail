// onThreadExpand: a conversation was expanded or collapsed, in the message
// list or in the reading pane. Shared by every place that folds a thread so
// they all report the same payload.

import type { Email } from './jmap/types';
import { emailHooks } from './plugin-hooks';
import { threadIdFromKey } from './thread-utils';

/**
 * Tell plugins a conversation was expanded or collapsed. `emails` are the
 * messages that were unfolded or folded: the whole thread for a list row, one
 * message for a card in the reading pane.
 */
export function emitThreadExpand(
  threadKey: string,
  emails: ReadonlyArray<Pick<Email, 'id' | 'threadId'>>,
  expanded: boolean,
): void {
  if (emailHooks.onThreadExpand.size === 0) return;
  const threadId = emails[0]?.threadId || threadIdFromKey(threadKey);
  void emailHooks.onThreadExpand.emit({ threadId, emailIds: emails.map((e) => e.id), expanded });
}
