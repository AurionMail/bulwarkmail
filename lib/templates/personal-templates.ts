/**
 * A signed-in account's own templates, wherever they live: in the account
 * (account-templates-store, kept in the Inbox metadata on Stalwart v1.0.0
 * and later), or, for accounts without, the browser's list in
 * template-store as before. Everything that changes personal templates
 * (the template manager, the composer's "Save as template", plugins) goes
 * through here, so an account's templates stay that account's.
 */

import type { EmailTemplate } from '@/lib/template-types';
import { exportTemplates, filterTemplates, importTemplates as parseImport } from '@/lib/template-utils';
import { templateHooks } from '@/lib/plugin-hooks';
import { templateToView } from '@/lib/plugin-projection';
import { onBeforeSignOut, onFullSignOut } from '@/lib/sign-out-cleanup';
import { IS_LITE } from '@/lib/lite';
import { getCachedConfig } from '@/hooks/use-config';
import { useAuthStore } from '@/stores/auth-store';
import { useTemplateStore } from '@/stores/template-store';
import { isSettingsLoadSettled, readSettingsOwner, useSettingsStore } from '@/stores/settings-store';
import {
  notifyPersonalChange,
  onPersonalChange,
  useAccountTemplatesStore,
  type LocalOnlyReason,
  type PersonalPartition,
} from '@/stores/account-templates-store';
import * as reducer from './template-reducer';
import { clientFor } from './account-clients';
import { pendingRound, syncPersonalTemplates, type BrowserList, type SyncOutcome } from './account-template-sync';

export interface PersonalTemplateOps {
  /** The account keeps its templates (in the server's metadata), not just this browser. */
  storedInAccount: boolean;
  templates: () => EmailTemplate[];
  localOnly: () => Record<string, LocalOnlyReason>;
  add: (data: reducer.TemplateData) => EmailTemplate;
  update: (id: string, updates: reducer.TemplateUpdate) => void;
  remove: (id: string) => void;
  duplicate: (id: string, nameSuffix?: string) => EmailTemplate | null;
  toggleFavorite: (id: string) => void;
  search: (query: string) => EmailTemplate[];
  exportAll: () => string;
  importJson: (json: string) => { count: number; errors: string[] };
}

/** The account a call is about: the given one, or the active one. */
export function resolveAccountId(accountId?: string | null): string | null {
  return accountId || useAuthStore.getState().activeAccountId || null;
}

/** Whether the account's templates live in the account. */
export function isStoredInAccount(accountId?: string | null): boolean {
  const id = resolveAccountId(accountId);
  return !!id && !!useAccountTemplatesStore.getState().personal[id];
}

function legacyOps(): PersonalTemplateOps {
  const store = () => useTemplateStore.getState();
  return {
    storedInAccount: false,
    templates: () => store().templates,
    localOnly: () => ({}),
    add: (data) => store().addTemplate(data),
    update: (id, updates) => store().updateTemplate(id, updates),
    remove: (id) => store().deleteTemplate(id),
    duplicate: (id, suffix) => store().duplicateTemplate(id, suffix),
    toggleFavorite: (id) => store().toggleFavorite(id),
    search: (query) => store().searchTemplates(query),
    exportAll: () => store().exportAllTemplates(),
    importJson: (json) => store().importTemplates(json),
  };
}

function accountOps(accountId: string): PersonalTemplateOps {
  const partition = (): PersonalPartition | undefined => useAccountTemplatesStore.getState().personal[accountId];
  const templates = () => partition()?.templates ?? [];
  const change = (fn: (list: reducer.TemplateListState) => reducer.TemplateListState) => {
    useAccountTemplatesStore.getState().updatePersonal(accountId, (p) => ({ ...p, ...fn({ templates: p.templates, deletedTemplateIds: p.deletedTemplateIds }) }));
    notifyPersonalChange(accountId);
  };
  const find = (id: string) => templates().find((t) => t.id === id);
  const emitUpdate = (id: string) => {
    const template = find(id);
    if (template) void templateHooks.onTemplateUpdate.emit(templateToView(template));
  };
  const add = (data: reducer.TemplateData): EmailTemplate => {
    let created: EmailTemplate | null = null;
    change((list) => {
      const result = reducer.addTemplate(list, data);
      created = result.template;
      return result.state;
    });
    void templateHooks.onTemplateCreate.emit(templateToView(created!));
    return created!;
  };
  return {
    storedInAccount: true,
    templates,
    localOnly: () => partition()?.localOnly ?? {},
    add,
    update: (id, updates) => {
      if (!find(id)) return;
      change((list) => reducer.updateTemplate(list, id, updates));
      emitUpdate(id);
    },
    remove: (id) => {
      if (!find(id)) return;
      change((list) => reducer.deleteTemplate(list, id));
      void templateHooks.onTemplateDelete.emit({ templateId: id });
    },
    duplicate: (id, suffix) => {
      let created: EmailTemplate | null = null;
      change((list) => {
        const result = reducer.duplicateTemplate(list, id, suffix);
        if (!result) return list;
        created = result.template;
        return result.state;
      });
      if (created) void templateHooks.onTemplateCreate.emit(templateToView(created));
      return created;
    },
    toggleFavorite: (id) => {
      if (!find(id)) return;
      change((list) => reducer.toggleFavorite(list, id));
      emitUpdate(id);
    },
    search: (query) => filterTemplates(templates(), query),
    exportAll: () => exportTemplates(templates()),
    importJson: (json) => {
      const result = parseImport(json);
      if (result.templates.length > 0) {
        change((list) => reducer.appendTemplates(list, result.templates));
        void templateHooks.onTemplatesImport.emit({ count: result.templates.length });
      }
      return { count: result.templates.length, errors: result.errors };
    },
  };
}

/** The personal templates of the signed-in account `accountId` (the active one when left out). */
export function personalTemplatesFor(accountId?: string | null): PersonalTemplateOps {
  const id = resolveAccountId(accountId);
  return id && useAccountTemplatesStore.getState().personal[id] ? accountOps(id) : legacyOps();
}

// ─── Whose is the browser's list ──────────────────────────────

/**
 * The browser's template list as far as `accountId` is concerned.
 *
 * With settings sync, the list mirrors the settings of the account that
 * loaded last (settings-sync-owner): it is this account's once its settings
 * have loaded, and unknown before that; a load that ended without making
 * any account the owner (the server refused sync) leaves the list to no
 * one, as without sync.
 *
 * Without settings sync (Lite, sync off), the list belongs to no account:
 * it goes into the first account whose metadata answers, and only that
 * one, so one person's templates don't turn up in every mailbox signed in
 * in this browser.
 */
export function browserListFor(accountId: string): BrowserList {
  const templates = useTemplateStore.getState().templates;
  const config = getCachedConfig();
  if (!IS_LITE && !config) return { status: 'unknown' };
  const syncOn = !IS_LITE && config?.settingsSyncEnabled === true && !useSettingsStore.getState().settingsSyncDisabled;
  if (syncOn) {
    const owner = readSettingsOwner();
    const active = useAuthStore.getState().activeAccountId;
    if (owner !== null) {
      if (owner === accountId && accountId === active) return { status: 'list', templates };
      return accountId === active ? { status: 'unknown' } : { status: 'none' };
    }
    if (!isSettingsLoadSettled(accountId)) return accountId === active ? { status: 'unknown' } : { status: 'none' };
  }
  const given = useAccountTemplatesStore.getState().browserListOwner;
  if (given !== null && given !== accountId) return { status: 'none' };
  return {
    status: 'list',
    templates,
    claim: () => {
      if (useAccountTemplatesStore.getState().browserListOwner === null) useAccountTemplatesStore.setState({ browserListOwner: accountId });
    },
  };
}

// ─── Syncing ──────────────────────────────────────────────────

/** Sync the account's personal templates now. */
export function syncAccountTemplates(accountId: string): Promise<SyncOutcome> {
  const client = clientFor(accountId);
  if (!client) return Promise.resolve('unsupported');
  return syncPersonalTemplates(accountId, client, () => browserListFor(accountId));
}

const SYNC_DELAY_MS = 800;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Sync shortly after a change, once for a burst of changes. */
export function scheduleAccountSync(accountId: string): void {
  const pending = timers.get(accountId);
  if (pending) clearTimeout(pending);
  timers.set(accountId, setTimeout(() => {
    timers.delete(accountId);
    void syncAccountTemplates(accountId);
  }, SYNC_DELAY_MS));
}

onPersonalChange(scheduleAccountSync);

const lastSync = new Map<string, number>();

/** Sync when the last round is older than `maxAgeMs` (opening the picker or the manager, coming back to the tab). */
export function refreshAccountTemplates(accountId: string | null | undefined, maxAgeMs = 15_000): void {
  const id = resolveAccountId(accountId);
  if (!id) return;
  const last = lastSync.get(id) ?? 0;
  if (Date.now() - last < maxAgeMs) return;
  lastSync.set(id, Date.now());
  void syncAccountTemplates(id);
}

/**
 * Before an account signs out: send what is queued for it (above all
 * deletions, which otherwise come back from the server next time). The
 * auth store bounds the wait.
 */
export async function flushAccountTemplates(accountId: string): Promise<void> {
  const ids = accountId === 'all' ? Object.keys(useAccountTemplatesStore.getState().personal) : [accountId];
  await Promise.all(ids.map(async (id) => {
    if (!useAccountTemplatesStore.getState().personal[id]) return;
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    await pendingRound(id);
    await syncAccountTemplates(id);
  }));
}

onBeforeSignOut(flushAccountTemplates);

// At a full sign-out only what exists nowhere else stays in this browser:
// templates and deletions the server hasn't taken yet.
onFullSignOut(() => {
  lastSync.clear();
  useAccountTemplatesStore.getState().forgetServerCopies();
});
