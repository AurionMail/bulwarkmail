import type { Email } from "@/lib/jmap/types";

/**
 * Index of the first unread message after `currentId` in the loaded list, or
 * -1 when there is none below it. With nothing open (or the open message no
 * longer in the list) the search starts at the top. It does not wrap around:
 * unread mail above the current one is left for the user to scroll back to.
 * (#514)
 */
export function findNextUnreadIndex(
  emails: readonly Pick<Email, "id" | "keywords">[],
  currentId: string | null | undefined,
): number {
  const currentIndex = currentId ? emails.findIndex((e) => e.id === currentId) : -1;
  for (let i = currentIndex + 1; i < emails.length; i++) {
    if (!emails[i].keywords?.$seen) return i;
  }
  return -1;
}
