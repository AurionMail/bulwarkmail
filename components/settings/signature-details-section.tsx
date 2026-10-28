'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { SettingsSection, SettingItem } from './settings-section';
import { DEFAULT_ORGANISATION_POLICY, SIGNATURE_FIELDS, type SignatureField } from '@/lib/admin/organisation-policy';
import { effectiveSignatureIdentity, signatureFieldsToAsk, signatureFieldsUsed } from '@/lib/org-signature';
import { policyForSender } from '@/lib/org/signature-state';
import { sanitizeSignatureHtmlForDisplay } from '@/lib/email-sanitization';
import { getPlainTextSignature } from '@/lib/signature-utils';
import { useOrgSignatureSetup } from '@/hooks/use-org-signature';
import { useIdentityStore } from '@/stores/identity-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';

const INPUT_PROPS: Record<SignatureField, { type: string; autoComplete: string }> = {
  title: { type: 'text', autoComplete: 'organization-title' },
  department: { type: 'text', autoComplete: 'off' },
  phone: { type: 'tel', autoComplete: 'tel' },
  mobile: { type: 'tel', autoComplete: 'tel' },
};

/** The details the organisation's signatures and disclaimers ask for, over every address the user sends from. */
function useFieldsToAsk(): SignatureField[] {
  const identities = useIdentityStore((s) => s.identities);
  const policy = usePolicyStore((s) => s.policy);
  const rawPolicy = usePolicyStore((s) => s.rawPolicy);
  const subject = usePolicyStore((s) => s.subject);
  const resolveFor = usePolicyStore((s) => s.resolveFor);
  return useMemo(() => {
    const view = { policy, rawPolicy, subject, resolveFor };
    // Every identity's policy (a group address may have its group's), and
    // the account's own for an account without identities yet.
    const policies = [policy, ...identities.map((identity) => policyForSender(view, identity.email))];
    const used = new Set<SignatureField>();
    for (const each of policies) {
      const organisation = each.organisation ?? DEFAULT_ORGANISATION_POLICY;
      for (const field of [...signatureFieldsToAsk(organisation.signature), ...signatureFieldsUsed(organisation.disclaimer)]) {
        used.add(field);
      }
    }
    return SIGNATURE_FIELDS.filter((field) => used.has(field));
  }, [identities, policy, rawPolicy, subject, resolveFor]);
}

/**
 * "Your details": what the organisation signature asks each user for
 * (title, department, phone, mobile), filled in once and used for every
 * address. Shows the fields the signatures of any of the user's addresses
 * use, and nothing when none does. The preview is the signature the
 * primary address sends: the user's own where it still applies. Synced
 * with the other settings; in Lite it stays in this browser.
 */
export function SignatureDetailsSection() {
  const t = useTranslations('org_signature.details');
  const details = useSettingsStore((s) => s.signatureDetails);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const primary = useIdentityStore((s) => s.identities[0]);
  const setup = useOrgSignatureSetup(primary);
  const fields = useFieldsToAsk();
  if (fields.length === 0) return null;

  const sent = effectiveSignatureIdentity(primary, primary, setup.signature, setup.restriction);
  const preview = sent?.htmlSignature?.trim()
    ? { html: sanitizeSignatureHtmlForDisplay(sent.htmlSignature) }
    : sent?.textSignature?.trim()
      ? { text: getPlainTextSignature(sent) }
      : null;

  return (
    <SettingsSection id="signature-details" title={t('title')} description={t('description')}>
      {fields.map((field) => (
        <SettingItem key={field} label={t(`fields.${field}`)}>
          <Input
            {...INPUT_PROPS[field]}
            aria-label={t(`fields.${field}`)}
            data-testid={`signature-detail-${field}`}
            className="w-full sm:w-64"
            maxLength={200}
            value={details[field] ?? ''}
            onChange={(e) => updateSetting('signatureDetails', { ...details, [field]: e.target.value })}
          />
        </SettingItem>
      ))}
      {preview && (
        <div data-testid="signature-details-preview">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('preview')}</p>
          <div className="p-3 border border-border rounded-md bg-muted/40 text-sm break-words min-w-0">
            {'html' in preview
              ? <div dangerouslySetInnerHTML={{ __html: preview.html ?? '' }} />
              : <div className="whitespace-pre-wrap">{preview.text}</div>}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
