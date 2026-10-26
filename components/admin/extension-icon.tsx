import type { AppIcon } from '@/components/icons';

interface ExtensionIconProps {
  /** The brand icon the extension directory serves, when known. */
  url: string | null | undefined;
  /** What to draw without one. */
  fallback: AppIcon;
  className?: string;
}

/** A plugin's or theme's icon, or the generic one when the directory has none. */
export function ExtensionIcon({ url, fallback: Fallback, className }: ExtensionIconProps) {
  if (url) {
    return <img src={url} alt="" loading="lazy" className={className ?? 'h-full w-full rounded-md object-cover'} />;
  }
  return <Fallback className={className} />;
}
