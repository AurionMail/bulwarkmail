"use client";

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useConfig } from '@/hooks/use-config';
import { productName } from '@/lib/product-name';
import { toast } from '@/stores/toast-store';

type RateLimitBlockedDetail = {
  retryAfterMs?: number;
};

export function RateLimitToastProvider({ children }: { children: React.ReactNode }) {
  const tCommon = useTranslations('common');
  const appName = productName(useConfig().appName);

  useEffect(() => {
    const onRateLimitBlocked = (event: Event) => {
      const detail = (event as CustomEvent<RateLimitBlockedDetail>).detail;
      const seconds = Math.max(1, Math.ceil((detail?.retryAfterMs ?? 0) / 1000));

      toast.warning(
        tCommon('rate_limited_action_title'),
        tCommon('rate_limited_action_detail', { seconds, appName }),
      );
    };

    window.addEventListener('bulwark:rate-limit-blocked', onRateLimitBlocked);
    return () => window.removeEventListener('bulwark:rate-limit-blocked', onRateLimitBlocked);
  }, [tCommon, appName]);

  return <>{children}</>;
}