import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { useTemplateStore } from '../template-store';
import { emptyPartition, useAccountTemplatesStore, type PersonalPartition } from '../account-templates-store';
import { mergeStoredTemplates } from '@/lib/template-merge';
import { parseSyncedTemplates } from '@/lib/template-utils';
import type { EmailTemplate } from '@/lib/template-types';

// An account that keeps its templates in its own Inbox metadata (Stalwart
// 1.0) takes them out of the settings-sync blob once its marker entry is on
// the server; until then, and for accounts without, the blob syncs the
// browser's list as before.

const tpl = (id: string, name = id, updatedAt = '2026-10-01T00:00:00.000Z'): EmailTemplate => ({
  id, name, subject: '', body: '', isHTML: false, category: '', isFavorite: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt,
});

const copy = (templates: EmailTemplate[], extra: Partial<PersonalPartition> = {}): PersonalPartition => ({ ...emptyPartition(), templates, ...extra });

beforeEach(() => {
  useTemplateStore.setState({ templates: [tpl('browser-1', 'Browser')], recentTemplateIds: [], deletedTemplateIds: {} });
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null, browserListOwner: null });
});

const push = () => JSON.parse(useSettingsStore.getState().exportSettings({ forSync: true }));

describe('the settings blob', () => {
  it('carries the browser\'s templates for an account without its own copy, as before', () => {
    useAccountTemplatesStore.setState({ active: 'old@server' });
    expect(push().templates.map((t: EmailTemplate) => t.name)).toEqual(['Browser']);
    expect(push().templatesInMetadata).toBeUndefined();
  });

  it('keeps carrying them until the account\'s marker is on the server', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': copy([tpl('acc-1', 'In the account')]) } });
    expect(push().templates.map((t: EmailTemplate) => t.name)).toEqual(['Browser']);
    expect(push().templatesInMetadata).toBeUndefined();
  });

  it('leaves them out once the marker is on the server, and the stored blob drops its copy', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': copy([tpl('acc-1', 'In the account')], { markerOnServer: true }) } });
    const blob = push();
    expect(blob.templates).toBeUndefined();
    expect(blob.templatesInMetadata).toBe(true);

    const stored = { theme: 'dark', templates: [tpl('old', 'Old copy')], deletedTemplateIds: {} };
    const saved = mergeStoredTemplates(stored, blob);
    expect(saved.templates).toBeUndefined();
    expect(saved.deletedTemplateIds).toBeUndefined();
    expect(saved.templatesInMetadata).toBe(true);
  });

  it('exports the account\'s own templates to a settings file', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': copy([tpl('acc-1', 'In the account')], { markerOnServer: true }) } });
    const file = JSON.parse(useSettingsStore.getState().exportSettings());
    expect(file.templates.map((t: EmailTemplate) => t.name)).toEqual(['In the account']);
  });

  it('merges a blob loaded for an account with its own copy into that copy too, tombstones applied', () => {
    useAccountTemplatesStore.setState({
      personal: { 'new@server': copy([tpl('acc-1', 'In the account'), tpl('gone', 'Deleted elsewhere')]) },
    });
    useSettingsStore.getState().importSettings(JSON.stringify({
      templates: [tpl('blob-1', 'From the blob'), tpl('blob-dead', 'Deleted later')],
      deletedTemplateIds: { gone: '2026-10-09T00:00:00.000Z', 'blob-dead': '2026-10-09T00:00:00.000Z' },
    }), { serverAccountId: 'new@server' });
    expect(useAccountTemplatesStore.getState().personal['new@server'].templates.map((t) => t.id).sort()).toEqual(['acc-1', 'blob-1']);
    // The browser's list merges it as before.
    expect(useTemplateStore.getState().templates.map((t) => t.name).sort()).toEqual(['Browser', 'From the blob']);
  });

  it('merges a blob into the browser\'s list for an account without, as before', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({ templates: [tpl('blob-1', 'From the blob')], deletedTemplateIds: {} }), { serverAccountId: 'old@server' });
    expect(useTemplateStore.getState().templates.map((t) => t.name).sort()).toEqual(['Browser', 'From the blob']);
  });

  it('adds the templates of an imported settings file to the active account\'s copy, never replacing it', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': copy([tpl('acc-1', 'Kept')]) } });
    useSettingsStore.getState().importSettings(JSON.stringify({ templates: [tpl('file-1', 'From the file')], deletedTemplateIds: {} }));
    const names = useAccountTemplatesStore.getState().personal['new@server'].templates.map((t) => t.name).sort();
    expect(names).toEqual(['From the file', 'Kept']);
    expect(useTemplateStore.getState().templates.map((t) => t.name)).toEqual(['Browser']);
  });
});

describe('changes', () => {
  it('move updatedAt past the previous value when this clock is behind', () => {
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    useTemplateStore.setState({ templates: [tpl('a', 'A', ahead)] });
    useTemplateStore.getState().updateTemplate('a', { name: 'Edited' });
    expect(Date.parse(useTemplateStore.getState().templates[0].updatedAt)).toBe(Date.parse(ahead) + 1);
    useTemplateStore.getState().deleteTemplate('a');
    expect(Date.parse(useTemplateStore.getState().deletedTemplateIds.a)).toBe(Date.parse(ahead) + 2);
  });

  it('date a synced template without updatedAt at a fixed early time, so it never beats a dated copy', () => {
    const [parsed] = parseSyncedTemplates([{ id: 'x', name: 'No date' }])!;
    expect(parsed.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });
});
