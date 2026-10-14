// Test helpers for mount-site tests: a plugin that offers a slot, and a
// stand-in for the sandboxed iframe that shows which props it was handed.
//
// Use with:
//   vi.mock('@/components/plugins/plugin-iframe-slot', () => import('@/components/plugins/__tests__/fake-slot-offer'));
import { deregister, register, type ActivePlugin } from '@/lib/plugin-sandbox/registry';
import type { SlotName } from '@/lib/plugin-types';

const registered = new Set<string>();

/** Registers an active plugin that offers these slots. */
export function offerSlots(pluginId: string, slots: SlotName[]): void {
  register({
    plugin: { id: pluginId, name: pluginId },
    code: '',
    tier: 'untrusted',
    background: {},
    slotOffers: slots.map((name) => ({ name, order: 100, hasShouldShow: false })),
    hookDisposables: [],
  } as unknown as ActivePlugin);
  registered.add(pluginId);
}

export function clearSlotOffers(): void {
  for (const id of registered) deregister(id);
  registered.clear();
}

/** Drop-in for PluginIframeSlot: no iframe, the props as JSON. */
export function PluginIframeSlot({ pluginId, slot, extraProps }: { pluginId: string; slot: string; extraProps?: Record<string, unknown> }) {
  return <div data-testid={`plugin-frame-${slot}`} data-plugin-id={pluginId} data-props={JSON.stringify(extraProps ?? {})} />;
}

/** The props the fake iframe for this slot received. */
export function framePropsOf(el: HTMLElement): Record<string, unknown> {
  return JSON.parse(el.getAttribute('data-props') || '{}') as Record<string, unknown>;
}
