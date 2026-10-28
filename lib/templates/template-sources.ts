/**
 * Where the templates a user can pick come from: their own (personal), a
 * group mailbox they are a member of (team), and the admin's library
 * (organisation). The picker shows each under its own heading; the template
 * manager edits the ones the user may change.
 */

import type { EmailTemplate } from '@/lib/template-types';

export type TemplateSourceKind = 'personal' | 'team' | 'organisation';

export interface TemplateSource {
  /** 'personal', 'organisation' or `team:<JMAP account id>`. */
  key: string;
  kind: TemplateSourceKind;
  /** A team's name (the group's address); personal and organisation are named by the UI. */
  name?: string;
  templates: EmailTemplate[];
  /** The user may add, change and delete templates here. */
  editable: boolean;
  /** Read-only because the admin locked it: "Set by your organisation". */
  locked: boolean;
}

export const PERSONAL_SOURCE = 'personal';
export const ORGANISATION_SOURCE = 'organisation';
export const teamSourceKey = (accountId: string) => `team:${accountId}`;

/** Sorted by name, the way the picker and the manager list a source. */
export function byName(templates: EmailTemplate[]): EmailTemplate[] {
  return [...templates].sort((a, b) => a.name.localeCompare(b.name));
}
