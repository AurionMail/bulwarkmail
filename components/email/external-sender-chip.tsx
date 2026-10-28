'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Building } from '@/components/icons';
import { cn } from '@/lib/utils';
import { externalSenderDomain, internalDomains } from '@/lib/external-mail';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';

/**
 * The sender's domain when the admin turned the "External" label on and the
 * sender is outside the organisation (lib/external-mail.ts), else null.
 */
export function useExternalSenderDomain(fromEmail: string | null | undefined): string | null {
  const externalMail = usePolicyStore((s) => s.policy.organisation?.externalMail);
  const identities = useAuthStore((s) => s.identities);
  return useMemo(() => {
    if (!externalMail?.senderLabel) return null;
    const internal = internalDomains((identities ?? []).map((identity) => identity.email), externalMail.domains);
    return externalSenderDomain(fromEmail, internal);
  }, [externalMail, identities, fromEmail]);
}

/**
 * "External" next to the sender's name. A chip and not a banner, so it sits
 * beside the unverified-sender warning without adding a second banner, and
 * it keeps to one short word so the narrow phone header doesn't wrap more.
 */
export function ExternalSenderChip({ fromEmail, className }: { fromEmail: string | null | undefined; className?: string }) {
  const t = useTranslations('external_mail');
  const domain = useExternalSenderDomain(fromEmail);
  if (!domain) return null;
  const tooltip = t('sender_tooltip', { domain });
  return (
    <span
      data-external-sender-chip=""
      title={tooltip}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none cursor-help',
        'border-warning/30 bg-warning/10 text-warning',
        className,
      )}
    >
      <Building className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {t('sender_label')}
      <span className="sr-only">{` (${tooltip})`}</span>
    </span>
  );
}
