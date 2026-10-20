'use client';

import React, { useSyncExternalStore } from 'react';
import type { SlotName } from '@/lib/plugin-types';
import { offersForSlot, subscribe } from '@/lib/plugin-sandbox/registry';
import { PluginIframeSlot } from './plugin-iframe-slot';
import { isInlineSlot } from '@/lib/plugin-sandbox/slot-layout';
import { cn } from '@/lib/utils';

interface PluginSlotProps {
  name: SlotName;
  className?: string;
  extraProps?: Record<string, unknown>;
}

export function PluginSlot({ name, className, extraProps }: PluginSlotProps) {
  const getSnapshot = () => offersForSlot(name);
  const offers = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

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
