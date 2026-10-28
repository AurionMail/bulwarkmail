/**
 * Every setting an admin can lock, hide or limit (SettingRestriction in
 * lib/admin/types.ts), with where the admin panel offers it. The User policy
 * page lists the ones with page `policy`; each Organisation page lists its
 * own next to the settings they belong to. New user-facing options add their
 * key here instead of a lock flag of their own.
 */

import type { AdminPageId } from './admin-nav';

export interface RestrictionKeyDef {
  key: string;
  label: string;
  /** One sentence for the admin: what locking or hiding it does for users. */
  description?: string;
  category: string;
  type: 'boolean' | 'number' | 'enum';
  allowedValues?: string[];
  /** The admin page that lists it. */
  page: AdminPageId;
  /** Which of locked, hidden and allowed values make sense for it. */
  modes?: ReadonlyArray<'locked' | 'hidden' | 'allowedValues'>;
}

export const RESTRICTION_KEYS: readonly RestrictionKeyDef[] = [
  { key: 'fontSize', label: 'Font Size', category: 'Appearance', type: 'enum', allowedValues: ['small', 'medium', 'large'], page: 'policy' },
  { key: 'density', label: 'Density', category: 'Appearance', type: 'enum', allowedValues: ['compact', 'regular', 'spacious'], page: 'policy' },
  { key: 'interfaceLayout', label: 'Interface Layout', category: 'Appearance', type: 'enum', allowedValues: ['default', 'mountain-view'], page: 'policy' },
  { key: 'animationsEnabled', label: 'Animations', category: 'Appearance', type: 'boolean', page: 'policy' },
  { key: 'markAsReadDelay', label: 'Mark as Read Delay', category: 'Email', type: 'number', page: 'policy' },
  { key: 'deleteAction', label: 'Delete Action', category: 'Email', type: 'enum', allowedValues: ['trash', 'trash-and-read', 'permanent'], page: 'policy' },
  { key: 'showPreview', label: 'Show Preview', category: 'Email', type: 'boolean', page: 'policy' },
  { key: 'mailLayout', label: 'Mail Layout', category: 'Email', type: 'enum', allowedValues: ['split', 'focus', 'horizontal'], page: 'policy' },
  { key: 'emailsPerPage', label: 'Emails Per Page', category: 'Email', type: 'number', page: 'policy' },
  { key: 'externalContentPolicy', label: 'External Content Policy', category: 'Email', type: 'enum', allowedValues: ['allow', 'block', 'ask'], page: 'policy' },
  { key: 'sendConfirmation', label: 'Send Confirmation', category: 'Composer', type: 'boolean', page: 'policy' },
  { key: 'defaultReplyMode', label: 'Default Reply Mode', category: 'Composer', type: 'enum', allowedValues: ['reply', 'reply-all'], page: 'policy' },
  { key: 'autoSelectReplyIdentity', label: 'Auto-select Reply Identity', category: 'Composer', type: 'boolean', page: 'policy' },
  { key: 'replyIdentityMatch', label: 'Reply Identity Matching', category: 'Composer', type: 'enum', allowedValues: ['exact', 'domain'], page: 'policy' },
  { key: 'plainTextMode', label: 'Plain Text Only', category: 'Composer', type: 'boolean', page: 'policy' },
  { key: 'emailNotificationsEnabled', label: 'Email Notifications', category: 'Notifications', type: 'boolean', page: 'policy' },
  { key: 'calendarNotificationsEnabled', label: 'Calendar Notifications', category: 'Notifications', type: 'boolean', page: 'policy' },
  { key: 'pushNotifyInboxOnly', label: 'Inbox-only Push Notifications', category: 'Notifications', type: 'boolean', page: 'policy' },
  { key: 'debugMode', label: 'Debug Mode', category: 'Advanced', type: 'boolean', page: 'policy' },
  {
    key: 'signature',
    label: 'Signatures',
    description: "Lock: users can't change signatures, and the organisation signature replaces their own. Hide: users get no signature editor at all.",
    category: 'Composer',
    type: 'boolean',
    page: 'org-signatures',
    modes: ['locked', 'hidden'],
  },
  { key: 'delegation', label: 'Delegates', description: 'Hide removes Settings > Sharing > Delegates, so users can no longer give someone access to mail, calendars and contacts in one step.', category: 'Sharing', type: 'boolean', page: 'org-sharing', modes: ['hidden'] },
  { key: 'sharingRights', label: 'Rights users can give', description: 'Untick "write" and every share dialog in Bulwark (folders, calendars, address books, files, Delegates) offers read access only.', category: 'Sharing', type: 'enum', allowedValues: ['read', 'write'], page: 'org-sharing', modes: ['allowedValues'] },
];

export function restrictionKeysForPage(page: AdminPageId): RestrictionKeyDef[] {
  return RESTRICTION_KEYS.filter((def) => def.page === page);
}
