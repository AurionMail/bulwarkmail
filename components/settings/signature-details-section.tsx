'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { SettingsSection, SettingItem } from './settings-section';
import { DEFAULT_ORGANISATION_POLICY, type SignatureField } from '@/lib/admin/organisation-policy';
import { signatureFieldsToAsk, signatureFieldsUsed } from '@/lib/org-signature';
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

/**
 * "Your details": what the organisation signature asks each user for
 * (title, department, phone, mobile), filled in once and used for every
 * address. Shows only the fields the admin's templates use, and nothing
 * without an organisation signature. Synced with the other settings; in
 * Lite it stays in this browser.
 */
export function SignatureDetailsSection() {
  const t = useTranslations('org_signature.details');
  const organisation = usePolicyStore((s) => s.policy.organisation) ?? DEFAULT_ORGANISATION_POLICY;
  const details = useSettingsStore((s) => s.signatureDetails);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const primary = useIdentityStore((s) => s.identities[0]);
  const setup = useOrgSignatureSetup(primary);

  const used = new Set<SignatureField>([
    ...signatureFieldsToAsk(organisation.signature),
    ...signatureFieldsUsed(organisation.disclaimer),
  ]);
  const fields = (['title', 'department', 'phone', 'mobile'] as const).filter((field) => used.has(field));
  if (fields.length === 0) return null;

  const preview = setup.signature
    ? setup.signature.html
      ? { html: sanitizeSignatureHtmlForDisplay(setup.signature.html) }
      : { text: getPlainTextSignature({ textSignature: setup.signature.text }) }
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
