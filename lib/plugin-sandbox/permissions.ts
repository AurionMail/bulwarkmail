import type { InstalledPlugin, Permission, SlotName } from '../plugin-types';
import { IMPLICIT_PERMISSIONS } from '../plugin-types';
import { hookSpec } from '../plugin-hook-catalog';

/**
 * Whether `plugin` may use `perm`: the manifest must declare it, and an
 * admin must have installed the plugin (managed) or the user must have
 * granted it in the consent dialog. Implicit permissions always pass.
 */
export function pluginHasPermission(plugin: InstalledPlugin, perm: Permission): boolean {
  if ((IMPLICIT_PERMISSIONS as readonly string[]).includes(perm)) return true;
  if (!plugin.permissions.includes(perm)) return false;
  // Defense-in-depth: even if the manifest declares a permission, the host
  // refuses it unless an admin has marked the plugin as managed, or the user
  // has explicitly granted it via the consent dialog.
  if (plugin.managed) return true;
  return (plugin.grantedPermissions ?? []).includes(perm);
}

// ─── Hooks ────────────────────────────────────────────────────

// The permission each hook needs comes from the hook catalogue
// (lib/plugin-hook-catalog.ts). A hook hands the plugin data (an opened
// message, the outgoing mail) or lets it change what the host does with it,
// so registering one is as much an API call as `email.get` and is gated the
// same way. A hook missing from the catalogue is refused.

export function hookPermission(hookName: string): Permission | null {
  return hookSpec(hookName)?.permission ?? null;
}

export function mayRegisterHook(plugin: InstalledPlugin, hookName: string): boolean {
  const perm = hookPermission(hookName);
  return perm !== null && pluginHasPermission(plugin, perm);
}

// ─── Slots ────────────────────────────────────────────────────

/**
 * Permissions that allow rendering into each slot (any one suffices). Slot
 * components receive the data of the surface they sit on (the open message,
 * the draft), so they are gated like hooks.
 */
const SLOT_PERMISSIONS: Record<SlotName, readonly Permission[]> = {
  'toolbar-actions': ['ui:toolbar'],
  'app-top-banner': ['ui:app-top-banner'],
  'email-banner': ['ui:email-banner'],
  'email-footer': ['ui:email-footer'],
  'composer-toolbar': ['ui:composer-toolbar'],
  'composer-sidebar': ['ui:composer-sidebar'],
  'composer-sidebar-right': ['ui:composer-sidebar'],
  'composer-attachment-source': ['ui:composer-toolbar', 'ui:composer-sidebar'],
  'sidebar-widget': ['ui:sidebar-widget'],
  'email-detail-sidebar': ['ui:email-details'],
  'email-details-section': ['ui:email-details'],
  'settings-section': ['ui:settings-section'],
  'context-menu-email': ['ui:context-menu'],
  'navigation-rail-bottom': ['ui:navigation-rail'],
  'calendar-event-actions': ['ui:calendar-action'],
  'admin-plugin-page': ['ui:admin-page', 'admin:config'],
  'contact-cryptokeys': ['ui:contact-cryptokeys'],
  'attachment-actions': ['email:read'],
  // Only shown inside a dialog the plugin opened through the host API.
  'plugin-dialog': ['ui:observe'],
};

/**
 * The props each slot may hand its plugin, and the permission each needs
 * (null: none beyond the slot's own). A ui:* permission only lets a plugin
 * draw somewhere; the message, event, contact or account the slot sits on is
 * data, and stays behind the matching read permission. Props not listed here
 * are dropped, so a new prop at a call site is withheld until it is added.
 */
const SLOT_PROPS: Record<SlotName, Record<string, Permission | null> | '*'> = {
  'toolbar-actions': {},
  'app-top-banner': { username: 'account:read', serverUrl: 'account:read' },
  'email-banner': { email: 'email:read' },
  'email-footer': {},
  'composer-toolbar': {},
  'composer-sidebar': {},
  'composer-sidebar-right': {},
  'composer-attachment-source': { onAttach: null },
  'sidebar-widget': {},
  'email-detail-sidebar': { email: 'email:read' },
  'email-details-section': { email: 'email:read', category: null },
  'settings-section': {},
  'context-menu-email': {},
  'navigation-rail-bottom': {},
  'calendar-event-actions': { eventData: 'calendar:read', setVirtualLocation: null },
  'admin-plugin-page': {},
  'contact-cryptokeys': { cryptoKeys: 'contacts:read' },
  'attachment-actions': { attachment: null },
  // The plugin chose these props itself when it opened the dialog.
  'plugin-dialog': '*',
};

export function slotPropsFor(
  plugin: InstalledPlugin,
  slot: SlotName,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = SLOT_PROPS[slot];
  if (allowed === '*') return props;
  if (!allowed) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!Object.prototype.hasOwnProperty.call(allowed, key)) continue;
    const perm = allowed[key];
    if (perm && !pluginHasPermission(plugin, perm)) continue;
    out[key] = value;
  }
  return out;
}

export function mayOfferSlot(plugin: InstalledPlugin, slot: string): boolean {
  const perms = Object.prototype.hasOwnProperty.call(SLOT_PERMISSIONS, slot)
    ? SLOT_PERMISSIONS[slot as SlotName]
    : null;
  return !!perms && perms.some((perm) => pluginHasPermission(plugin, perm));
}
