// Every place a plugin can put UI, in one table. The docs and the tests are
// generated from it, the same way as the hook catalogue (plugin-hook-catalog.ts).
//
// Two kinds of surface:
// - `frame`: the plugin renders its own React component into a sandboxed
//   iframe (`exports.slots[name]`). For panels, sections and pages.
// - `action`: the plugin declares buttons or menu entries as data
//   (`api.ui.setActions(surface, [...])`) and the host draws them in its own
//   style; a click reaches the plugin as `onAction`. For surfaces that repeat
//   per row or item, where an iframe each would be far too heavy, and for
//   menus that must look like the rest of the app.
// - `data`: the plugin hands the host plain data to draw, such as labels on
//   calendar days (`api.ui.setDayLabels`).
// Badges on list rows are data too (the onEmailListItemRender hook).

import type { Permission } from './plugin-types';

export type SlotArea =
  | 'app' | 'mail-list' | 'reader' | 'composer' | 'navigation'
  | 'calendar' | 'contacts' | 'tasks' | 'files' | 'settings' | 'admin' | 'dialog';

export interface SlotSpec {
  area: SlotArea;
  kind: 'frame' | 'action' | 'data';
  /** Any one of these lets a plugin use the slot. */
  permissions: readonly Permission[];
  /** Props (frame) or click context (action) and the permission each needs; null = none. */
  props: Record<string, Permission | null> | '*';
  /** Sits in a row of buttons and sizes to its content. */
  inline?: boolean;
  /** Where it appears. */
  where: string;
}

const S = (
  area: SlotArea,
  kind: SlotSpec['kind'],
  permissions: readonly Permission[],
  props: SlotSpec['props'],
  where: string,
  inline = false,
): SlotSpec => ({ area, kind, permissions, props, where, ...(inline ? { inline } : {}) });

export const SLOT_CATALOG = {
  // ─── App ───────────────────────────────────────────────────
  'app-top-banner': S('app', 'frame', ['ui:app-top-banner'], { username: 'account:read', serverUrl: 'account:read' }, 'a banner across the top of every page'),
  'plugin-dialog': S('dialog', 'frame', ['ui:observe'], '*', 'inside a dialog the plugin opened with api.ui.openDialog'),
  'command-palette': S('app', 'action', ['ui:commands'], {}, 'entries in the command palette (Ctrl+K)'),

  // ─── Navigation ────────────────────────────────────────────
  'navigation-rail-bottom': S('navigation', 'frame', ['ui:navigation-rail'], {}, 'the bottom of the navigation rail'),
  'sidebar-widget': S('navigation', 'frame', ['ui:sidebar-widget'], {}, 'a widget at the bottom of the mail sidebar'),
  'sidebar-section': S('navigation', 'frame', ['ui:sidebar-widget'], { mailboxId: null }, 'a collapsible section in the mail sidebar, below the folders'),
  'top-bar-actions': S('navigation', 'action', ['ui:toolbar'], {}, 'buttons in the top bar, next to search', true),
  'app-page': S('navigation', 'frame', ['ui:app-page'], { pageId: null, path: null }, 'a full page of its own, with an entry in the navigation rail (api.ui.setPages)'),

  // ─── Message list ──────────────────────────────────────────
  'message-list-header': S('mail-list', 'frame', ['ui:message-list'], { mailboxId: null, mailboxRole: null }, 'above the message list'),
  'message-list-empty': S('mail-list', 'frame', ['ui:message-list'], { mailboxId: null, mailboxRole: null, searching: null }, 'in an empty message list, below the "no messages" text'),
  'message-row-actions': S('mail-list', 'action', ['ui:message-list'], { emailId: 'email:read' }, 'hover buttons on a message row, and the row menu on phones', true),
  'message-bulk-actions': S('mail-list', 'action', ['ui:message-list'], { emailIds: 'email:read' }, 'buttons in the toolbar shown while messages are selected', true),
  'context-menu-email': S('mail-list', 'frame', ['ui:context-menu'], {}, 'the right-click menu of a message'),
  'toolbar-actions': S('mail-list', 'frame', ['ui:toolbar'], {}, 'the message toolbar', true),

  // ─── Reader ────────────────────────────────────────────────
  'reader-header': S('reader', 'frame', ['ui:email-banner'], { email: 'email:read' }, 'at the top of the open message, above the subject'),
  'reader-below-subject': S('reader', 'frame', ['ui:email-banner'], { email: 'email:read' }, 'right under the subject and sender of the open message'),
  'email-banner': S('reader', 'frame', ['ui:email-banner'], { email: 'email:read' }, 'a banner above the message body'),
  'reader-above-quote': S('reader', 'frame', ['ui:email-banner'], { email: 'email:read' }, 'between the new text of a message and the quoted text below it'),
  'email-footer': S('reader', 'frame', ['ui:email-footer'], { emailId: 'email:read' }, 'below the message body'),
  'thread-summary': S('reader', 'frame', ['ui:email-banner'], { threadId: 'email:read', emailIds: 'email:read' }, 'above the messages of an open conversation'),
  'reader-actions': S('reader', 'action', ['ui:toolbar'], { emailId: 'email:read' }, 'buttons in the open message\'s toolbar', true),
  'email-detail-sidebar': S('reader', 'frame', ['ui:email-details'], { email: 'email:read' }, 'a side panel next to the open message'),
  'email-details-section': S('reader', 'frame', ['ui:email-details'], { email: 'email:read', category: null }, 'a section in the message details'),
  'attachment-actions': S('reader', 'frame', ['email:read'], { attachment: null }, 'buttons on each attachment', true),
  'attachment-menu': S('reader', 'action', ['email:read'], { emailId: 'email:read', blobId: 'email:read', name: 'email:read', type: 'email:read', size: 'email:read' }, 'entries in each attachment\'s menu (for example "Save to Nextcloud")'),

  // ─── Composer ──────────────────────────────────────────────
  'composer-toolbar': S('composer', 'frame', ['ui:composer-toolbar'], { insertText: 'compose:open', getSelectedText: 'email:send' }, 'the composer\'s plugin button row', true),
  'composer-above-body': S('composer', 'frame', ['ui:composer-toolbar', 'ui:composer-sidebar'], { draft: 'email:send', insertText: 'compose:open', getSelectedText: 'email:send' }, 'between the subject and the message text'),
  'composer-below-body': S('composer', 'frame', ['ui:composer-toolbar', 'ui:composer-sidebar'], { draft: 'email:send', insertText: 'compose:open', getSelectedText: 'email:send' }, 'below the message text, above the attachments'),
  'composer-sidebar': S('composer', 'frame', ['ui:composer-sidebar'], {}, 'a panel left of the composer'),
  'composer-sidebar-right': S('composer', 'frame', ['ui:composer-sidebar'], {}, 'a panel right of the composer'),
  'composer-attachment-source': S('composer', 'frame', ['ui:composer-toolbar', 'ui:composer-sidebar'], { onAttach: null, insertText: 'compose:open' }, 'the composer\'s plugin button row, next to composer-toolbar, as a source of files (for an entry in the Attach menu itself, use composer-attach-menu)', true),
  'composer-send-menu': S('composer', 'action', ['ui:composer-toolbar'], { draft: 'email:send' }, 'entries in the menu next to Send'),
  'composer-attach-menu': S('composer', 'action', ['ui:composer-toolbar'], {}, 'entries in the attach menu (for example "From Nextcloud")'),

  // ─── Calendar ──────────────────────────────────────────────
  'calendar-event-actions': S('calendar', 'frame', ['ui:calendar-action'], { eventData: 'calendar:read', setVirtualLocation: null }, 'buttons in the event form', true),
  'calendar-event-detail': S('calendar', 'frame', ['ui:calendar-action'], { event: 'calendar:read' }, 'a section in an event\'s details'),
  'calendar-event-form': S('calendar', 'frame', ['ui:calendar-action'], { event: 'calendar:read' }, 'a section in the form for a new or edited event'),
  'calendar-day-header': S('calendar', 'data', ['ui:calendar-action'], { date: null }, 'a short label under a day\'s name in the day and week views (api.ui.setDayLabels)'),
  'mini-calendar-marks': S('calendar', 'data', ['ui:calendar-action'], { date: null }, 'dots on days in the small month calendar (api.ui.setDayLabels)'),

  // ─── Contacts ──────────────────────────────────────────────
  'contact-cryptokeys': S('contacts', 'frame', ['ui:contact-cryptokeys'], { cryptoKeys: 'contacts:read' }, 'the encryption keys section of a contact'),
  'contact-detail-section': S('contacts', 'frame', ['ui:contacts'], { contact: 'contacts:read' }, 'a section in a contact\'s details'),
  'contact-list-actions': S('contacts', 'action', ['ui:contacts'], { contactIds: 'contacts:read' }, 'buttons in the contact list toolbar', true),

  // ─── Tasks ─────────────────────────────────────────────────
  'task-detail-section': S('tasks', 'frame', ['ui:tasks'], { task: 'tasks:read' }, 'a section in a task\'s details'),
  'task-list-actions': S('tasks', 'action', ['ui:tasks'], { taskIds: 'tasks:read' }, 'buttons in the task list toolbar', true),

  // ─── Files ─────────────────────────────────────────────────
  'file-actions': S('files', 'action', ['ui:files'], { files: 'files:read' }, 'entries in a file\'s menu and the selection toolbar'),
  'file-preview-section': S('files', 'frame', ['ui:files'], { file: 'files:read' }, 'a section in the file preview'),

  // ─── Settings and admin ────────────────────────────────────
  'settings-section': S('settings', 'frame', ['ui:settings-section'], {}, 'a section on the plugin\'s own page in Settings'),
  'settings-page': S('settings', 'frame', ['ui:settings-section'], {}, 'a page of its own in Settings, listed under the plugin\'s name'),
  'admin-plugin-page': S('admin', 'frame', ['ui:admin-page', 'admin:config'], {}, 'the plugin\'s page in the admin dashboard'),
} as const satisfies Record<string, SlotSpec>;

export type CatalogSlotName = keyof typeof SLOT_CATALOG;

export function slotSpec(name: string): SlotSpec | null {
  return Object.prototype.hasOwnProperty.call(SLOT_CATALOG, name)
    ? SLOT_CATALOG[name as CatalogSlotName]
    : null;
}
