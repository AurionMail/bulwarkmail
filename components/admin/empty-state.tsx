import type { ReactNode } from 'react';
import type { AppIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: AppIcon;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A list with nothing in it, with what to do about that. */
export function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-lg border border-dashed border-border px-6 py-10 text-center', className)}>
      {Icon && <Icon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
