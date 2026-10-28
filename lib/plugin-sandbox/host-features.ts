// What the host tells plugins about its own features (`api.host.features`),
// so a plugin can step back where Bulwark now does the job itself. Sent with
// every frame's init and again whenever it changes (the admin's policy, an
// account switch to another scope).
//
// And the other half of that hand-over: copies of a plugin core replaced
// that are older than the release which knows the flag keep running their
// hooks. While core does the job, the host skips those hooks by plugin id.

import { usePolicyStore } from '@/stores/policy-store';
import type { HostFeaturesView } from '../plugin-types';
import type { OrganisationPolicy } from '@/lib/admin/organisation-policy';

/**
 * Either external-mail switch is on. The same rule as coreExternalWarningsOn
 * (lib/external-mail.ts), kept apart so the sandbox doesn't pull in the
 * account and contact stores.
 */
export function externalWarningsOn(externalMail: OrganisationPolicy['externalMail'] | undefined): boolean {
  return !!externalMail && (externalMail.senderLabel || externalMail.recipientWarning);
}

export function snapshotHostFeatures(): HostFeaturesView {
  return { externalMailWarnings: externalWarningsOn(usePolicyStore.getState().getOrganisation().externalMail) };
}

/** The external-mail-warning plugin, retired in favour of organisation.externalMail. */
export const EXTERNAL_MAIL_WARNING_PLUGIN_ID = 'external-mail-warning';

/** Its send check and its new-mail toast; its banner is the email-banner slot. */
const EXTERNAL_MAIL_WARNING_HOOKS = new Set(['onBeforeEmailSend', 'onNewEmailReceived']);
const EXTERNAL_MAIL_WARNING_SLOTS = new Set(['email-banner']);

/** True when core does this plugin hook's job right now, so the host skips it. */
export function isHookHandedOver(pluginId: string, hookName: string): boolean {
  return pluginId === EXTERNAL_MAIL_WARNING_PLUGIN_ID
    && EXTERNAL_MAIL_WARNING_HOOKS.has(hookName)
    && snapshotHostFeatures().externalMailWarnings;
}

/** True when core does this plugin slot's job right now, so the host doesn't show it. */
export function isSlotHandedOver(pluginId: string, slot: string, features: HostFeaturesView = snapshotHostFeatures()): boolean {
  return pluginId === EXTERNAL_MAIL_WARNING_PLUGIN_ID
    && EXTERNAL_MAIL_WARNING_SLOTS.has(slot)
    && features.externalMailWarnings;
}

// ─── Change watch ────────────────────────────────────────────

let watching = false;
let lastKey = '';

/** Calls `onChange` with the new features whenever they change; set up once. */
export function watchHostFeatures(onChange: (features: HostFeaturesView) => void): void {
  if (watching) return;
  watching = true;
  lastKey = JSON.stringify(snapshotHostFeatures());
  usePolicyStore.subscribe(() => {
    const features = snapshotHostFeatures();
    const key = JSON.stringify(features);
    if (key === lastKey) return;
    lastKey = key;
    onChange(features);
  });
}
