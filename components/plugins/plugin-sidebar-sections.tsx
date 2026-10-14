'use client';

import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight } from '@/components/icons';
import { get as getActivePlugin, offersForSlot, subscribe } from '@/lib/plugin-sandbox/registry';
import { PluginIframeSlot } from './plugin-iframe-slot';

const STORAGE_PREFIX = 'plugin-sidebar-section-collapsed:';

function readCollapsed(pluginId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + pluginId) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(pluginId: string, collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(STORAGE_PREFIX + pluginId, '1');
    else localStorage.removeItem(STORAGE_PREFIX + pluginId);
  } catch {
    // Storage may be blocked; the section just opens expanded next time.
  }
}

function PluginSidebarSection({ pluginId, extraProps }: { pluginId: string; extraProps: Record<string, unknown> }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(pluginId));
  const bodyId = useId();
  const name = getActivePlugin(pluginId)?.plugin.name || pluginId;

  const toggle = () => {
    setCollapsed((prev) => {
      writeCollapsed(pluginId, !prev);
      return !prev;
    });
  };

  return (
    <div data-plugin-sidebar-section={pluginId}>
      {/* Same look as the sidebar's own section headers (Folders, Tags). */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className="group w-full flex items-center pb-1 pt-5 px-3 select-none rounded-sm hover:bg-muted/40 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 rtl:-scale-x-100" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <span className="ms-1.5 text-sm font-semibold text-foreground truncate">{name}</span>
      </button>
      {/* A collapsed section has no iframe at all, so it costs nothing. */}
      <div id={bodyId} hidden={collapsed}>
        {!collapsed && <PluginIframeSlot pluginId={pluginId} slot="sidebar-section" extraProps={extraProps} />}
      </div>
    </div>
  );
}

/**
 * The `sidebar-section` slot: one collapsible section per plugin in the mail
 * sidebar, below the folders and tags. The header carries the plugin's name;
 * whether it is folded is remembered per plugin in this browser.
 */
export function PluginSidebarSections({ mailboxId }: { mailboxId: string | null }) {
  const getSnapshot = () => offersForSlot('sidebar-section');
  const offers = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const extraProps = useMemo(() => ({ mailboxId }), [mailboxId]);

  if (offers.length === 0) return null;

  return (
    <div data-plugin-slot="sidebar-section">
      {offers.map((offer) => (
        <PluginSidebarSection key={offer.pluginId} pluginId={offer.pluginId} extraProps={extraProps} />
      ))}
    </div>
  );
}
