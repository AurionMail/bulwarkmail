/**
 * The rights Bulwark grants when it shares a folder, calendar, address book
 * or file (`shareWith/<principalId>`), as named presets, and the preset a
 * stored grant amounts to.
 */

import type { AddressBookRights, CalendarRights, FileNodeRights, MailboxRights } from './types';

export type ShareKind = 'calendar' | 'addressBook' | 'file' | 'mailbox';
export type AnyRights = CalendarRights | AddressBookRights | FileNodeRights | MailboxRights;
export type RolePreset = 'freeBusy' | 'read' | 'readWrite' | 'manager' | 'custom';
type NamedPreset = Exclude<RolePreset, 'custom' | 'freeBusy'>;

export const CALENDAR_PRESETS: Record<Exclude<RolePreset, 'custom'>, CalendarRights> = {
  freeBusy: {
    mayReadFreeBusy: true, mayReadItems: false, mayWriteAll: false, mayWriteOwn: false,
    mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false,
  },
  read: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: false, mayWriteOwn: false,
    mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false,
  },
  readWrite: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: false, mayDelete: false,
  },
  manager: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
  },
};

export const ADDRESS_BOOK_PRESETS: Record<NamedPreset, AddressBookRights> = {
  read: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
  readWrite: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
  manager: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: true },
};

export const FILE_PRESETS: Record<NamedPreset, FileNodeRights> = {
  read: {
    mayRead: true, mayAddChildren: false, mayRename: false,
    mayDelete: false, mayModifyContent: false, mayShare: false,
  },
  readWrite: {
    mayRead: true, mayAddChildren: true, mayRename: true,
    mayDelete: true, mayModifyContent: true, mayShare: false,
  },
  manager: {
    mayRead: true, mayAddChildren: true, mayRename: true,
    mayDelete: true, mayModifyContent: true, mayShare: true,
  },
};

// Mail folder rights (RFC 8621 §2 + mail:share). "Read & write" lets the
// grantee file, flag and remove mail; "Manager" additionally lets them
// rename/delete the folder, create subfolders, send as it and re-share.
export const MAILBOX_PRESETS: Record<NamedPreset, MailboxRights> = {
  read: {
    mayReadItems: true, mayAddItems: false, mayRemoveItems: false, maySetSeen: true,
    maySetKeywords: false, mayCreateChild: false, mayRename: false, mayDelete: false,
    maySubmit: false, mayShare: false,
  },
  readWrite: {
    mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true,
    maySetKeywords: true, mayCreateChild: false, mayRename: false, mayDelete: false,
    maySubmit: false, mayShare: false,
  },
  manager: {
    mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true,
    maySetKeywords: true, mayCreateChild: true, mayRename: true, mayDelete: true,
    maySubmit: true, mayShare: true,
  },
};

function presetsFor(kind: ShareKind): Partial<Record<RolePreset, AnyRights>> {
  if (kind === 'calendar') return CALENDAR_PRESETS;
  if (kind === 'file') return FILE_PRESETS;
  if (kind === 'mailbox') return MAILBOX_PRESETS;
  return ADDRESS_BOOK_PRESETS;
}

function matches(preset: AnyRights, rights: AnyRights): boolean {
  const have = rights as unknown as Record<string, boolean | undefined>;
  return Object.entries(preset).every(([key, want]) => {
    const got = have[key] ?? false;
    return got === want;
  });
}

/** The rights a preset grants; undefined for "custom". */
export function presetRights(kind: ShareKind, preset: RolePreset): AnyRights | undefined {
  if (preset === 'custom') return undefined;
  return presetsFor(kind)[preset];
}

/** The preset a stored grant amounts to, or "custom". */
export function detectPreset(kind: ShareKind, rights: AnyRights): RolePreset {
  for (const [name, preset] of Object.entries(presetsFor(kind)) as [RolePreset, AnyRights][]) {
    if (matches(preset, rights)) return name;
  }
  return 'custom';
}
