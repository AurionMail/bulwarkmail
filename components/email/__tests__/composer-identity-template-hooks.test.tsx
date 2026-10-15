import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { EmailComposer } from '../email-composer';
import { useIdentityStore } from '@/stores/identity-store';
import { clearAllHooks, identityHooks, templateHooks } from '@/lib/plugin-hooks';

const TEMPLATE = vi.hoisted(() => ({
  id: 'tpl-1',
  name: 'Greeting',
  category: '',
  subject: 'Hello',
  body: 'Dear reader',
  isHTML: false,
  isFavorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}));

// ─── Heavy component mocks (mirrors reply-addressing.test.tsx) ────────────────

const editorKeyDown = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/components/email/rich-text-editor', () => ({
  RichTextEditor: () => React.createElement('div', {
    'data-testid': 'rich-text-editor',
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!event.defaultPrevented) editorKeyDown();
    },
  }),
}));

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/identity/sub-address-helper', () => ({ SubAddressHelper: () => null }));
// The picker hands the composer a template, as choosing one does.
vi.mock('@/components/templates/template-picker', () => ({
  TemplatePicker: ({ onSelect }: { onSelect: (t: unknown, v: Record<string, string>) => void }) =>
    React.createElement('button', { 'data-testid': 'pick-template', onClick: () => onSelect(TEMPLATE, {}) }, 'pick'),
}));
vi.mock('@/components/templates/template-form', () => ({ TemplateForm: () => null }));
vi.mock('@/components/files/file-preview-modal', () => ({ FilePreviewModal: () => null }));
vi.mock('@/hooks/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}));
vi.mock('@/hooks/use-pro-multi-account-identities', () => ({
  useProMultiAccountIdentities: () => ({ enabled: false, groups: [], allIdentities: [] }),
  stripCrossAccountIdentityPrefix: (id: string) => ({ localAccountId: null, rawId: id }),
}));

// ─── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('@/stores/auth-store', () => {
  const state = {
    client: null,
    identities: [],
    primaryIdentity: null,
    isAuthenticated: false,
    isDemoMode: false,
    activeAccountId: null,
    connectionLost: false,
    getClientForAccount: () => undefined,
    getAllConnectedClients: () => new Map(),
    syncIdentities: () => {},
    refreshIdentities: async () => {},
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useAuthStore: hook };
});

vi.mock('@/stores/account-store', () => {
  const state = { accounts: [], getAccountById: () => undefined };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useAccountStore: hook };
});

vi.mock('@/stores/email-store', () => {
  const state = {
    draftSaveEnabled: false,
    sendRawEmail: async () => ({ sent: true }),
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useEmailStore: hook };
});

const updateSetting = vi.fn();

vi.mock('@/stores/settings-store', () => {
  const state = {
    timeFormat: '24h',
    plainTextMode: false,
    subAddressDelimiter: '+',
    autoSelectReplyIdentity: true,
    attachmentReminderEnabled: false,
    attachmentReminderKeywords: [],
    emptySubjectWarningEnabled: true,
    sendDelaySeconds: 0,
    signaturePosition: 'above_quote',
    signatureSeparatorEnabled: false,
    requestReadReceiptDefault: false,
    addTrustedSender: () => {},
    trustedSendersAddressBook: null,
    updateSetting: (...args: unknown[]) => updateSetting(...args),
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useSettingsStore: hook, registerTemplateSyncBridge: () => {} };
});

vi.mock('@/stores/contact-store', () => {
  const state = {
    contacts: [],
    getAutocomplete: async () => [],
    addToTrustedSendersBook: async () => {},
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useContactStore: hook };
});

// ─── Misc dependency mocks ────────────────────────────────────────────────────

vi.mock('@/stores/toast-store', () => ({
  toast: { info: () => {}, error: toastError, success: () => {} },
}));

vi.mock('@/lib/email-sanitization', () => ({
  sanitizeSignatureHtml: (v: string) => v,
  sanitizeEmailHtml: (v: string) => v,
  sanitizeSignatureHtmlForDisplay: (v: string) => v,
  sanitizePluginBodyHtml: (v: string) => v,
  escapeHtml: (v: string) => v,
  parseHtmlSafely: (html: string) => new DOMParser().parseFromString(html, 'text/html'),
}));

vi.mock('@/lib/email-threading', () => ({
  computeReplyThreadingHeaders: () => ({ inReplyTo: [], references: [] }),
}));
vi.mock('@/lib/signature-utils', () => ({
  appendPlainTextSignature: (body: string) => body,
  getPlainTextSignature: () => '',
}));
vi.mock('@/lib/sub-addressing', () => ({ generateSubAddress: () => '' }));
vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('@/components/email/quoted-html', () => ({
  buildQuotedHtmlBlock: () => '',
  serializeEditorContent: () => '',
}));
vi.mock('@/lib/template-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/template-utils')>()),
  substitutePlaceholders: (s: string) => s,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

const DATA = {
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  showCc: false,
  showBcc: false,
  selectedIdentityId: 'id-me',
  subAddressTag: '',
  draftId: null,
};

const ME = { id: 'id-me', email: 'me@example.com', name: 'Me', mayDelete: false };
const WORK = { id: 'id-work', email: 'work@example.com', name: 'Work', mayDelete: true, htmlSignature: '<b>W</b>' };

describe('composer plugin hooks for identities and templates', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: [ME, WORK] });
  });
  afterEach(() => clearAllHooks());

  it('tells plugins which From identity the user picked', () => {
    const selected = vi.fn();
    identityHooks.onIdentitySelect.register('test', selected);
    render(<EmailComposer initialData={{ ...DATA, mode: 'compose' }} />);

    fireEvent.change(screen.getByTestId('composer-from'), { target: { value: 'id-work' } });

    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-work', email: 'work@example.com', htmlSignature: '<b>W</b>' }));
  });

  it('inserts the template as a plugin rendered it and reports it applied', async () => {
    const render_ = vi.fn((value: { subject: string; html: string; text: string }, ctx: { templateId: string }) => {
      expect(ctx).toEqual({ templateId: 'tpl-1' });
      return { ...value, subject: `[Plugin] ${value.subject}` };
    });
    const applied = vi.fn();
    templateHooks.onTemplateRender.register('test', render_);
    templateHooks.onTemplateApply.register('test', applied);
    render(<EmailComposer initialData={{ ...DATA, mode: 'compose' }} />);

    act(() => { fireEvent.keyDown(window, { key: 't' }); });
    fireEvent.click(await screen.findByTestId('pick-template'));

    await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
    expect(render_).toHaveBeenCalledWith(
      { subject: 'Hello', html: '<p>Dear reader</p>', text: 'Dear reader' },
      { templateId: 'tpl-1' },
    );
    expect(applied).toHaveBeenCalledWith(expect.objectContaining({ id: 'tpl-1', name: 'Greeting' }));
    expect(screen.getByDisplayValue('[Plugin] Hello')).toBeInTheDocument();
  });
});
