'use client';

import type { AnchorHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { AdminLink } from './admin-link';

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
} as const;

interface AdminButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: keyof typeof VARIANTS;
  /** A link out of the panel (a hard navigation) rather than to another admin page. */
  external?: boolean;
}

/** A link that looks like a small Button, for actions that open a page. */
export function AdminButtonLink({ href, variant = 'outline', external, className, children, ...rest }: AdminButtonLinkProps) {
  const classes = cn(
    'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-all duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    VARIANTS[variant],
    className,
  );
  if (external) {
    return <a href={href} className={classes} {...rest}>{children}</a>;
  }
  return <AdminLink href={href} className={classes} {...rest}>{children}</AdminLink>;
}
