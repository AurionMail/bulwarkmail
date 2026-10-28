import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { useTemplateStore } from '../template-store';
import { emptyPartition, useAccountTemplatesStore } from '../account-templates-store';
import { mergeStoredTemplates } from '@/lib/template-merge';
import type { EmailTemplate } from '@/lib/template-types';

// An account that keeps its templates in its own Inbox metadata (Stalwart
// 1.0) takes them out of the settings-sync blob; accounts without keep
// syncing the browser's list as before.

const tpl = (id: string, name = id, updatedAt = '2026-10-01T00:00:00.000Z'): EmailTemplate => ({
  id, name, subject: '', body: '', isHTML: false, category: '', isFavorite: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt,
});

beforeEach(() => {
  useTemplateStore.setState({ templates: [tpl('browser-1', 'Browser')], recentTemplateIds: [], deletedTemplateIds: {} });
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null });
});

describe('the settings blob', () => {
  it('carries the browser\'s templates for an account without its own copy, as before', () => {
    useAccountTemplatesStore.setState({ active: 'old@server' });
    const blob = JSON.parse(useSettingsStore.getState().exportSettings({ forSync: true }));
    expect(blob.templates.map((t: EmailTemplate) => t.name)).toEqual(['Browser']);
    expect(blob.templatesInMetadata).toBeUndefined();
  });

  it('leaves the templates out of a push for an account that keeps them, and the stored blob drops its copy', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': { ...emptyPartition(), templates: [tpl('acc-1', 'In the account')] } } });
    const blob = JSON.parse(useSettingsStore.getState().exportSettings({ forSync: true }));
    expect(blob.templates).toBeUndefined();
    expect(blob.templatesInMetadata).toBe(true);

    const stored = { theme: 'dark', templates: [tpl('old', 'Old copy')], deletedTemplateIds: {} };
    const saved = mergeStoredTemplates(stored, blob);
    expect(saved.templates).toBeUndefined();
    expect(saved.deletedTemplateIds).toBeUndefined();
    expect(saved.templatesInMetadata).toBe(true);
  });

  it('exports the account\'s own templates to a settings file', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': { ...emptyPartition(), templates: [tpl('acc-1', 'In the account')] } } });
    const file = JSON.parse(useSettingsStore.getState().exportSettings());
    expect(file.templates.map((t: EmailTemplate) => t.name)).toEqual(['In the account']);
  });

  it('doesn\'t touch the browser\'s list when a blob loads for an account that keeps its own', () => {
    useAccountTemplatesStore.setState({ personal: { 'new@server': { ...emptyPartition(), templates: [tpl('acc-1')] } } });
    useSettingsStore.getState().importSettings(JSON.stringify({ templates: [tpl('blob-1', 'From the blob')], deletedTemplateIds: { 'browser-1': '2026-10-09T00:00:00.000Z' } }), { serverAccountId: 'new@server' });
    expect(useTemplateStore.getState().templates.map((t) => t.name)).toEqual(['Browser']);
    expect(useAccountTemplatesStore.getState().personal['new@server'].templates.map((t) => t.id)).toEqual(['acc-1']);
  });

  it('merges a blob into the browser\'s list for an account without, as before', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({ templates: [tpl('blob-1', 'From the blob')], deletedTemplateIds: {} }), { serverAccountId: 'old@server' });
    expect(useTemplateStore.getState().templates.map((t) => t.name).sort()).toEqual(['Browser', 'From the blob']);
  });

  it('adds the templates of an imported settings file to the active account\'s copy, never replacing it', () => {
    useAccountTemplatesStore.setState({ active: 'new@server', personal: { 'new@server': { ...emptyPartition(), templates: [tpl('acc-1', 'Kept')] } } });
    useSettingsStore.getState().importSettings(JSON.stringify({ templates: [tpl('file-1', 'From the file')], deletedTemplateIds: {} }));
    const names = useAccountTemplatesStore.getState().personal['new@server'].templates.map((t) => t.name).sort();
    expect(names).toEqual(['From the file', 'Kept']);
    expect(useTemplateStore.getState().templates.map((t) => t.name)).toEqual(['Browser']);
  });
});
