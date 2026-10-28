import type { Principal } from "@/lib/jmap/types";

/** The line to show for a principal, and the smaller one under it. */
export function principalDisplay(principal: Pick<Principal, "id" | "name" | "email" | "description">): { name: string; detail: string | null } {
  const name = principal.name || principal.email || principal.id;
  const detail = principal.email && principal.email !== name
    ? principal.email
    : principal.description && principal.description !== name ? principal.description : null;
  return { name, detail };
}
