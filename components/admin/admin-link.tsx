'use client';

import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { withBasePath } from '@/lib/browser-navigation';
import { navigateAdmin } from '@/hooks/use-admin-navigation';

interface AdminLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** App-relative admin path, e.g. `/admin/plugins/jitsi-meet`. */
  href: string;
  replace?: boolean;
}

/**
 * A link between admin pages. A real anchor, so it can be opened in a new
 * tab and the unsaved-changes guard sees it like any other link; a plain
 * click moves within the panel through history.pushState instead of a
 * route transition.
 */
export const AdminLink = forwardRef<HTMLAnchorElement, AdminLinkProps>(function AdminLink(
  { href, replace, onClick, target, children, ...rest },
  ref,
) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== '_self') return;
    event.preventDefault();
    navigateAdmin(href, { replace });
  };
  return (
    <a ref={ref} href={withBasePath(href)} target={target} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
});
