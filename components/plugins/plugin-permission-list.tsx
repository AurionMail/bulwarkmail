'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from '@/components/icons';
import { cn } from '@/lib/utils';
import { HIGH_RISK_PERMISSIONS, permissionKey, visiblePermissions } from '@/lib/plugin-sandbox/permission-text';

interface PluginPermissionListProps {
  permissions: readonly string[];
  /** Sites the plugin may send requests to (manifest httpOrigins). */
  httpOrigins?: readonly string[];
  /** Server endpoints it may call with the user's login (apiPostPaths). */
  apiPostPaths?: readonly string[];
  compact?: boolean;
}

/** Plain-language list of what a plugin may do, high-risk items first. */
export function PluginPermissionList({ permissions, httpOrigins, apiPostPaths, compact }: PluginPermissionListProps) {
  const t = useTranslations('plugins.permissions');
  const perms = visiblePermissions(permissions);
  if (perms.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('none')}</p>;
  }
  return (
    <ul className={cn('space-y-1.5', compact && 'space-y-1')}>
      {perms.map((perm) => {
        const key = permissionKey(perm);
        const risky = HIGH_RISK_PERMISSIONS.has(perm);
        const targets = perm === 'http:fetch' ? httpOrigins : perm === 'http:post' ? apiPostPaths : undefined;
        return (
          <li
            key={perm}
            className={cn(
              'rounded-md border px-3 py-2',
              risky ? 'border-warning/40 bg-warning/10' : 'border-border bg-muted/40',
            )}
          >
            <div className="flex items-start gap-2">
              {risky && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" aria-label={t('high_risk')} />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{t(`${key}.title`)}</div>
                {!compact && <div className="text-xs text-muted-foreground">{t(`${key}.body`)}</div>}
                {targets && targets.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {targets.map((target) => (
                      <li key={target} className="break-all font-mono text-[11px] text-foreground">{target}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
