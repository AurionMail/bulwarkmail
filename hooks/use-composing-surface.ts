import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';

/**
 * Marks a composer or an expanded quick reply as open while `active` is true,
 * so floating cards (PWA install, push) hide and toasts lift clear of its
 * Send button.
 */
export function useComposingSurface(active = true): void {
  useEffect(() => {
    if (!active) return;
    const { beginComposing, endComposing } = useUIStore.getState();
    beginComposing();
    return endComposing;
  }, [active]);
}
