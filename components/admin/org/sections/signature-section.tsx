'use client';

import { useId, useRef, useState } from 'react';
import { Check } from '@/components/icons';
import { SettingsSection } from '@/components/settings/settings-section';
import { SIGNATURE_FIELDS, type SignatureField } from '@/lib/admin/organisation-policy';
import { restrictionKeysForPage } from '@/lib/admin/restriction-keys';
import { sanitizeSignatureHtmlForDisplay } from '@/lib/email-sanitization';
import {
  SIGNATURE_PLACEHOLDERS,
  buildOrgSignature,
  signatureFieldsUsed,
  signatureValuesFor,
  type SignaturePlaceholder,
} from '@/lib/org-signature';
import { getPlainTextSignature } from '@/lib/signature-utils';
import { useConfig } from '@/hooks/use-config';
import { cn } from '@/lib/utils';
import { InheritNote, RestrictionRow } from '../org-page';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

const textareaClass =
  'block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground ' +
  'placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring focus-visible:border-ring';
const labelClass = 'mb-1 block text-sm font-medium text-foreground';
const hintClass = 'mt-1 text-xs text-muted-foreground';

const PLACEHOLDER_HELP: Record<SignaturePlaceholder, string> = {
  name: 'name of the address the mail is sent from',
  email: 'that address',
  identity: 'name and address, as in From',
  company: 'company name from Branding, for the web address Bulwark is opened on',
  domain: 'domain of the address',
  title: 'job title the user fills in',
  department: 'department the user fills in',
  phone: 'phone number the user fills in',
  mobile: 'mobile number the user fills in',
};

const FIELD_LABELS: Record<SignatureField, string> = {
  title: 'Job title',
  department: 'Department',
  phone: 'Phone',
  mobile: 'Mobile',
};

const SAMPLE_DETAILS = { title: 'Head of Sales', department: 'Sales', phone: '+49 30 1234567', mobile: '+49 170 1234567' };
const EMPTY_DETAILS = { title: '', department: '', phone: '', mobile: '' };

const describeText = (value: string) => {
  const first = value.trim().split('\n')[0] ?? '';
  return first ? (first.length > 60 ? `${first.slice(0, 60)}…` : first) : 'none';
};

export interface FocusedTemplate {
  el: HTMLTextAreaElement;
  apply: (value: string) => void;
}

/** A template field (HTML or plain text) at the selected scope. */
export function TemplateField({ label, hint, value, own, everyone, rows, testId, onChange, onReset, draft, onFocusField }: {
  label: string;
  hint: string;
  value: string;
  own: boolean;
  everyone: string;
  rows: number;
  testId: string;
  onChange: (value: string) => void;
  onReset: () => void;
  draft: OrgPolicyDraft;
  onFocusField: (el: HTMLTextAreaElement) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <textarea
        id={id}
        data-testid={testId}
        rows={rows}
        spellCheck={false}
        value={value}
        className={textareaClass}
        onFocus={(e) => onFocusField(e.currentTarget)}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={hintClass}>{hint}</p>
      <InheritNote draft={draft} own={own} everyone={describeText(everyone)} onReset={onReset} />
    </div>
  );
}

/** What a template looks like filled in with sample values: the HTML and the plain text. */
export function TemplatePreview({ html, text, testId }: { html: string; text: string; testId: string }) {
  const plain = getPlainTextSignature({ textSignature: text, htmlSignature: html });
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid={testId}>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-muted-foreground">HTML</p>
        <div className="min-h-[3rem] rounded-md border border-border bg-background p-3 text-sm break-words">
          {html
            ? <div dangerouslySetInnerHTML={{ __html: sanitizeSignatureHtmlForDisplay(html) }} />
            : <span className="text-muted-foreground">{plain ? 'Plain text only' : 'Nothing'}</span>}
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Plain text{!text && html ? ' (from the HTML)' : ''}</p>
        <pre className="min-h-[3rem] whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-sans text-sm">{plain || ' '}</pre>
      </div>
    </div>
  );
}

/** Inserts `{placeholder}` at the caret of the template field last focused. */
export function insertPlaceholder(target: FocusedTemplate | null, placeholder: SignaturePlaceholder): void {
  if (!target) return;
  const { el, apply } = target;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const token = `{${placeholder}}`;
  apply(`${el.value.slice(0, start)}${token}${el.value.slice(end)}`);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  });
}

/**
 * Organisation > Signatures (feature 1): the organisation signature as an
 * HTML and a plain-text template with placeholders, the user details it
 * asks for, the `signature` restriction, and the disclaimer. Everything per
 * scope through the draft hook; stored in policy.json
 * `organisation.signature` and `organisation.disclaimer`.
 */
export function SignatureSection({ draft }: { draft: OrgPolicyDraft }) {
  const config = useConfig();
  const focused = useRef<FocusedTemplate | null>(null);
  const [emptyDetails, setEmptyDetails] = useState(false);

  const html = draft.orgValue('signature', 'html');
  const text = draft.orgValue('signature', 'text');
  const fields = draft.orgValue('signature', 'fields');
  const disclaimerHtml = draft.orgValue('disclaimer', 'html');
  const disclaimerText = draft.orgValue('disclaimer', 'text');

  // Which details users are asked for follows the templates. It is stored
  // with them (`fields`), so a hand-written policy.json can say it too.
  const setTemplate = (key: 'html' | 'text', value: string) => {
    draft.setOrgValue('signature', key, value);
    const used = signatureFieldsUsed({ html: key === 'html' ? value : html.value, text: key === 'text' ? value : text.value });
    if (!fields.own || used.join() !== fields.value.join()) draft.setOrgValue('signature', 'fields', used);
  };
  const resetTemplate = (key: 'html' | 'text') => {
    draft.clearOrgValue('signature', key);
    const otherOwn = key === 'html' ? text.own : html.own;
    if (!otherOwn) {
      draft.clearOrgValue('signature', 'fields');
      return;
    }
    draft.setOrgValue('signature', 'fields', signatureFieldsUsed({
      html: key === 'html' ? html.everyone : html.value,
      text: key === 'text' ? text.everyone : text.value,
    }));
  };

  const domain = draft.scope?.match.domains?.[0]?.replace(/^\*\./, '') ?? 'example.com';
  const values = signatureValuesFor(
    { name: 'Alex Example', email: `alex@${domain}` },
    emptyDetails ? EMPTY_DETAILS : SAMPLE_DETAILS,
    config.loginCompanyName || 'Example Ltd',
  );
  const sample = buildOrgSignature({ html: html.value, text: text.value }, values);
  const sampleDisclaimer = buildOrgSignature({ html: disclaimerHtml.value, text: disclaimerText.value }, values);
  const usedFields = signatureFieldsUsed({ html: html.value, text: text.value });

  return (
    <>
      <SettingsSection
        id="signature"
        title="Signature"
        description="The signature at the end of every message, filled in for the address it is sent from. Users without a signature of their own get it; lock it to replace everyone's."
      >
        <div className="space-y-5">
          <TemplateField
            draft={draft}
            label="HTML signature"
            hint="Placeholders are filled in as text. A line whose placeholders are all empty is left out, so a user without a mobile number gets no “Mobile:” line."
            value={html.value}
            own={html.own}
            everyone={html.everyone}
            rows={6}
            testId="org-signature-html"
            onChange={(value) => setTemplate('html', value)}
            onReset={() => resetTemplate('html')}
            onFocusField={(el) => { focused.current = { el, apply: (value) => setTemplate('html', value) }; }}
          />
          <TemplateField
            draft={draft}
            label="Plain-text signature"
            hint="For plain-text mail. Leave it empty to send the HTML signature as text."
            value={text.value}
            own={text.own}
            everyone={text.everyone}
            rows={4}
            testId="org-signature-text"
            onChange={(value) => setTemplate('text', value)}
            onReset={() => resetTemplate('text')}
            onFocusField={(el) => { focused.current = { el, apply: (value) => setTemplate('text', value) }; }}
          />

          <div>
            <p className={labelClass}>Placeholders</p>
            <p className={hintClass}>Click one to insert it at the cursor of the template you last edited.</p>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-testid="org-signature-placeholders">
              {SIGNATURE_PLACEHOLDERS.map((placeholder) => (
                <li key={placeholder} className="flex min-w-0 items-baseline gap-2 text-xs">
                  <button
                    type="button"
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-foreground hover:bg-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertPlaceholder(focused.current, placeholder)}
                  >
                    {`{${placeholder}}`}
                  </button>
                  <span className="min-w-0 text-muted-foreground">{PLACEHOLDER_HELP[placeholder]}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className={labelClass}>Preview</p>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" className="rounded border-input" checked={emptyDetails} onChange={(e) => setEmptyDetails(e.target.checked)} />
                For a user who filled in no details
              </label>
            </div>
            {sample
              ? <TemplatePreview html={sample.html} text={sample.text} testId="org-signature-preview" />
              : <p className="text-sm text-muted-foreground">No organisation signature: users send their own.</p>}
          </div>

          {restrictionKeysForPage('org-signatures').map((def) => <RestrictionRow key={def.key} draft={draft} def={def} />)}
        </div>
      </SettingsSection>

      <SettingsSection
        id="details"
        title="User details"
        description="Users fill these in once, under Settings > Account. They are asked only for what the signature uses."
      >
        <ul className="space-y-1.5" data-testid="org-signature-fields">
          {SIGNATURE_FIELDS.map((field) => {
            const used = usedFields.includes(field);
            return (
              <li key={field} className={cn('flex flex-wrap items-center gap-x-2 text-sm', used ? 'text-foreground' : 'text-muted-foreground')} data-used={used || undefined}>
                <Check className={cn('h-4 w-4 shrink-0', used ? 'text-primary' : 'opacity-0')} aria-hidden="true" />
                <span>{FIELD_LABELS[field]}</span>
                <span className="text-xs text-muted-foreground">
                  {used ? 'asked for' : <>add <code className="font-mono">{`{${field}}`}</code> to ask for it</>}
                </span>
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      <SettingsSection
        id="disclaimer"
        title="Disclaimer"
        description="Added below everything, the quoted message included, when a message is sent. Never in drafts. Users see it under the editor and can't remove it."
      >
        <div className="space-y-5">
          <TemplateField
            draft={draft}
            label="HTML disclaimer"
            hint="Goes into the HTML part, below a line. The placeholders work here too."
            value={disclaimerHtml.value}
            own={disclaimerHtml.own}
            everyone={disclaimerHtml.everyone}
            rows={4}
            testId="org-disclaimer-html"
            onChange={(value) => draft.setOrgValue('disclaimer', 'html', value)}
            onReset={() => draft.clearOrgValue('disclaimer', 'html')}
            onFocusField={(el) => { focused.current = { el, apply: (value) => draft.setOrgValue('disclaimer', 'html', value) }; }}
          />
          <TemplateField
            draft={draft}
            label="Plain-text disclaimer"
            hint="Goes into the text part, after a blank line. Leave it empty to send the HTML disclaimer as text."
            value={disclaimerText.value}
            own={disclaimerText.own}
            everyone={disclaimerText.everyone}
            rows={3}
            testId="org-disclaimer-text"
            onChange={(value) => draft.setOrgValue('disclaimer', 'text', value)}
            onReset={() => draft.clearOrgValue('disclaimer', 'text')}
            onFocusField={(el) => { focused.current = { el, apply: (value) => draft.setOrgValue('disclaimer', 'text', value) }; }}
          />
          {sampleDisclaimer && <TemplatePreview html={sampleDisclaimer.html} text={sampleDisclaimer.text} testId="org-disclaimer-sample" />}
          <p className="text-xs text-muted-foreground">
            Bulwark adds the signature and the disclaimer in the browser. Mail sent from other apps over IMAP and SMTP gets neither.
          </p>
        </div>
      </SettingsSection>
    </>
  );
}
