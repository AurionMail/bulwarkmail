'use client';

import React, { useMemo, useSyncExternalStore } from 'react';
import type { SlotName } from '@/lib/plugin-types';
import { offersForSlot, subscribe } from '@/lib/plugin-sandbox/registry';
import { PluginIframeSlot } from './plugin-iframe-slot';
import { isInlineSlot } from '@/lib/plugin-sandbox/slot-layout';
import { externalWarningsOn, isSlotHandedOver } from '@/lib/plugin-sandbox/host-features';
import { usePolicyStore } from '@/stores/policy-store';
import { cn } from '@/lib/utils';

interface PluginSlotProps {
  name: SlotName;
  className?: string;
  extraProps?: Record<string, unknown>;
}

export function PluginSlot({ name, className, extraProps }: PluginSlotProps) {
  const getSnapshot = () => offersForSlot(name);
  const allOffers = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // A retired plugin's banner stays away while Bulwark shows its own (host-features.ts).
  const externalMailWarnings = usePolicyStore((s) => externalWarningsOn(s.policy.organisation?.externalMail));
  const offers = useMemo(
    () => allOffers.filter((offer) => !isSlotHandedOver(offer.pluginId, name, { externalMailWarnings })),
    [allOffers, name, externalMailWarnings],
  );

  if (offers.length === 0) return null;

  // Inline slots line up next to each other in a toolbar row. A panel slot
  // with a frame that fills the panel takes the panel's height and shares
  // it between such frames.
  const fills = offers.some((offer) => offer.fill);
  return (
    <div
      className={isInlineSlot(name)
        ? cn('inline-flex flex-wrap items-center gap-1', className)
        : cn(className, fills && 'h-full flex flex-col min-h-0')}
      data-plugin-slot={name}
    >
      {offers.map((offer) => (
        <PluginIframeSlot
          key={offer.pluginId}
          pluginId={offer.pluginId}
          slot={name}
          extraProps={extraProps}
          fill={offer.fill}
        />
      ))}
    </div>
  );
}
