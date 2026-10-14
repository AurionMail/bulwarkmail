// Test helpers: pretend a running plugin offers a frame slot, without booting
// a sandbox. Pair with a vi.mock of '@/components/plugins/plugin-iframe-slot'
// (FakeIframeSlot below) so the "iframe" shows the props it would receive.

import React from 'react';
import { register, deregister } from '@/lib/plugin-sandbox/registry';
import type { ActivePlugin } from '@/lib/plugin-sandbox/registry';
import type { SlotName } from '@/lib/plugin-types';

const offered = new Set<string>();

/** Registers a fake plugin that offers the given slots. */
export function offerSlots(pluginId: string, slots: string[]): void {
  register({
    plugin: { id: pluginId, name: pluginId },
    code: '',
    tier: 'untrusted',
    background: {},
    slotOffers: slots.map((name) => ({ name: name as SlotName, order: 100, hasShouldShow: false })),
    hookDisposables: [],
  } as unknown as ActivePlugin);
  offered.add(pluginId);
}

/** Removes every fake plugin registered with offerSlots. */
export function clearOffers(): void {
  for (const id of offered) deregister(id);
  offered.clear();
}

/** Stand-in for PluginIframeSlot: a div carrying the slot name and its props as JSON. */
export function FakeIframeSlot({ pluginId, slot, extraProps }: { pluginId: string; slot: string; extraProps?: Record<string, unknown> }) {
  return React.createElement('div', {
    'data-testid': `slot-${slot}`,
    'data-plugin': pluginId,
    'data-props': JSON.stringify(extraProps ?? {}),
  });
}

/** The props the fake iframe of a slot received. */
export function slotProps(el: HTMLElement): Record<string, unknown> {
  return JSON.parse(el.getAttribute('data-props') ?? '{}');
}
