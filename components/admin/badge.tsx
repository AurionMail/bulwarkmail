import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
  muted: 'bg-muted text-muted-foreground',
  accent: 'bg-primary/10 text-primary',
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  className?: string;
}

/** A small label next to a name: a state, a source, a count. */
export function Badge({ tone = 'muted', icon, children, title, className }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap', TONES[tone], className)}
    >
      {icon}
      {children}
    </span>
  );
}
