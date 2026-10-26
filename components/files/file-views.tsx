"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, ArrowDown, MoreHorizontal, Download, Share2, Star, Check } from "@/components/icons";
import { cn, formatFileSize } from "@/lib/utils";
import type { FileResource } from "@/stores/file-store";
import {
  ResourceIcon, ShareBadge, Thumbnail, canShowThumbnail, formatFullDate, formatShortDate,
  type IconOptions,
} from "@/components/files/file-item-parts";
import type { SortDir, SortKey } from "@/components/files/files-header";

export interface FileItemHandlers {
  /** Selection click (plain, Ctrl/Cmd, Shift) on the item body. */
  onSelectClick: (resource: FileResource, e: React.MouseEvent) => void;
  onToggleSelect: (resource: FileResource) => void;
  onOpen: (resource: FileResource) => void;
  onContextMenu: (e: React.MouseEvent, resource: FileResource) => void;
  onDownload: (resource: FileResource) => void;
  onShare: (resource: FileResource) => void;
  canShare: (resource: FileResource) => boolean;
  dragProps: (resource: FileResource) => React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
}

export interface FileViewProps {
  resources: FileResource[];
  selected: Set<string>;
  focusedName: string | null;
  dropTarget: string | null;
  cutNames: Set<string>;
  starredPaths: Set<string>;
  pathOf: (resource: FileResource) => string;
  /** Touch layout: tap opens, long-press selects, checkboxes appear once selecting. */
  touch: boolean;
  iconOptions: IconOptions;
  getImageUrl: (name: string) => Promise<string>;
  handlers: FileItemHandlers;
}

const LONG_PRESS_MS = 450;

/**
 * Touch handling shared by rows and tiles: a tap opens the item (or toggles
 * it while selecting), a long press selects it.
 */
function useTouchPress(touch: boolean, selecting: boolean, resource: FileResource, handlers: FileItemHandlers) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  if (!touch) return {};
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      longPressed.current = false;
      cancel();
      timer.current = setTimeout(() => {
        longPressed.current = true;
        handlers.onToggleSelect(resource);
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onPointerMove: (e: React.PointerEvent) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 4) cancel(); },
    onClickCapture: (e: React.MouseEvent) => {
      if (longPressed.current) {
        longPressed.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.target as HTMLElement).closest("[data-item-action]")) return;
      e.preventDefault();
      e.stopPropagation();
      if (selecting) handlers.onToggleSelect(resource);
      else handlers.onOpen(resource);
    },
    // A long press also fires contextmenu on Android; it already selected.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

function SelectBox({ checked, visible, onToggle, label }: {
  checked: boolean;
  visible: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      data-item-action
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-opacity",
        checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50 bg-background",
        visible || checked ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      {checked && <Check className="w-3 h-3" strokeWidth={3} />}
    </button>
  );
}

function SortHeader({ label, column, sortKey, sortDir, onSort, className }: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === column;
  return (
    <div role="columnheader" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors", active && "text-foreground")}
      >
        {label}
        {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </div>
  );
}

const LIST_COLUMNS = "grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_5.5rem_auto] md:grid-cols-[auto_minmax(0,1fr)_9rem_5.5rem_auto] items-center gap-x-3";

export function FileListView({
  resources, selected, focusedName, dropTarget, cutNames, starredPaths, pathOf, touch, iconOptions, getImageUrl, handlers,
  sortKey, sortDir, onSort, allSelected, someSelected, onToggleAll,
}: FileViewProps & {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
}) {
  const t = useTranslations("files");
  const selecting = selected.size > 0;
  return (
    <div role="grid" aria-label={t("file_list")} aria-multiselectable className="text-sm">
      <div
        role="row"
        className={cn(LIST_COLUMNS, "sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 h-9 text-xs font-medium text-muted-foreground")}
      >
        <div role="columnheader" className="flex items-center">
          <SelectBox
            checked={allSelected}
            visible={selecting || !touch}
            onToggle={onToggleAll}
            label={allSelected ? t("clear_selection") : t("select_all")}
          />
          {someSelected && !allSelected && <span className="sr-only">{t("selected_count", { count: selected.size })}</span>}
        </div>
        <SortHeader label={t("name")} column="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("modified")} column="modified" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hidden md:block" />
        <SortHeader label={t("size")} column="size" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hidden sm:block text-end" />
        <div role="columnheader" className="w-[4.75rem]"><span className="sr-only">{t("context_menu")}</span></div>
      </div>
      {resources.map((resource) => (
        <FileListRow
          key={resource.id}
          resource={resource}
          isSelected={selected.has(resource.name)}
          isFocused={focusedName === resource.name}
          isDropTarget={dropTarget === resource.name}
          isCut={cutNames.has(resource.name)}
          isStarred={resource.isDirectory && starredPaths.has(pathOf(resource))}
          selecting={selecting}
          touch={touch}
          iconOptions={iconOptions}
          getImageUrl={getImageUrl}
          handlers={handlers}
        />
      ))}
    </div>
  );
}

function FileListRow({ resource, isSelected, isFocused, isDropTarget, isCut, isStarred, selecting, touch, iconOptions, getImageUrl, handlers }: {
  resource: FileResource;
  isSelected: boolean;
  isFocused: boolean;
  isDropTarget: boolean;
  isCut: boolean;
  isStarred: boolean;
  selecting: boolean;
  touch: boolean;
  iconOptions: IconOptions;
  getImageUrl: (name: string) => Promise<string>;
  handlers: FileItemHandlers;
}) {
  const t = useTranslations("files");
  const touchProps = useTouchPress(touch, selecting, resource, handlers);
  const icon = <ResourceIcon resource={resource} size="sm" options={iconOptions} />;
  return (
    <div
      role="row"
      aria-selected={isSelected}
      data-resource={resource.name}
      tabIndex={-1}
      {...handlers.dragProps(resource)}
      onClick={(e) => handlers.onSelectClick(resource, e)}
      onDoubleClick={() => handlers.onOpen(resource)}
      onContextMenu={(e) => handlers.onContextMenu(e, resource)}
      {...touchProps}
      className={cn(
        LIST_COLUMNS,
        "group px-4 border-b border-border/60 cursor-default select-none transition-colors outline-none",
        touch ? "min-h-[52px] py-1.5" : "h-10",
        isSelected ? "bg-primary/10" : isDropTarget ? "bg-primary/10 ring-1 ring-inset ring-primary/50" : "hover:bg-muted/60",
        isFocused && "ring-1 ring-inset ring-ring/60",
        isCut && "opacity-50",
      )}
    >
      <div role="gridcell" className={cn("flex items-center", touch && !selecting && "hidden")}>
        <SelectBox checked={isSelected} visible={selecting} onToggle={() => handlers.onToggleSelect(resource)} label={t("select_item", { name: resource.name })} />
      </div>
      <div role="gridcell" className={cn("flex items-center gap-3 min-w-0", touch && !selecting && "col-span-2")}>
        {canShowThumbnail(resource, iconOptions) ? (
          <Thumbnail
            resource={resource}
            getImageUrl={getImageUrl}
            wrapperClassName="w-6 h-6"
            className="w-6 h-6 rounded object-cover"
            fallback={icon}
          />
        ) : icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              data-item-action
              onClick={(e) => {
                e.stopPropagation();
                if (touch && selecting) handlers.onToggleSelect(resource);
                else if (e.ctrlKey || e.metaKey || e.shiftKey) handlers.onSelectClick(resource, e);
                else handlers.onOpen(resource);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={cn("truncate text-start hover:underline underline-offset-2 decoration-muted-foreground/50", resource.isDirectory && "font-medium")}
              title={resource.name}
            >
              {resource.name}
            </button>
            {isStarred && <Star className="w-3.5 h-3.5 shrink-0 text-amber-500 fill-current" aria-label={t("favorites")} />}
            <ShareBadge resource={resource} t={t} />
          </div>
          {touch && (
            <div className="text-xs text-muted-foreground truncate">
              {formatShortDate(resource.lastModified)}
              {!resource.isDirectory && !resource.isSymlink && <> · {formatFileSize(resource.contentLength)}</>}
            </div>
          )}
        </div>
      </div>
      <div role="gridcell" className="hidden md:block text-muted-foreground tabular-nums truncate" title={formatFullDate(resource.lastModified)}>
        {!touch && formatShortDate(resource.lastModified)}
      </div>
      <div role="gridcell" className="hidden sm:block text-muted-foreground tabular-nums text-end">
        {!touch && (resource.isDirectory || resource.isSymlink ? "—" : formatFileSize(resource.contentLength))}
      </div>
      <div role="gridcell" className="flex items-center justify-end gap-0.5 w-[4.75rem]">
        {!touch && !resource.isDirectory && !resource.isSymlink && (
          <RowAction icon={Download} label={t("download")} onClick={() => handlers.onDownload(resource)} />
        )}
        {!touch && handlers.canShare(resource) && (
          <RowAction icon={Share2} label={t("share")} onClick={() => handlers.onShare(resource)} />
        )}
        <button
          type="button"
          data-item-action
          aria-label={t("more_actions", { name: resource.name })}
          title={t("context_menu")}
          onClick={(e) => { e.stopPropagation(); handlers.onContextMenu(e, resource); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function RowAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-item-action
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

export function FileGridView({
  resources, selected, focusedName, dropTarget, cutNames, starredPaths, pathOf, touch, iconOptions, getImageUrl, handlers,
}: FileViewProps) {
  const t = useTranslations("files");
  const folders = resources.filter((r) => r.isDirectory);
  const files = resources.filter((r) => !r.isDirectory);
  const selecting = selected.size > 0;
  const common = { touch, iconOptions, getImageUrl, handlers, selecting };
  return (
    <div role="grid" aria-label={t("file_list")} aria-multiselectable className="p-4 space-y-5">
      {folders.length > 0 && (
        <section aria-label={t("folders")}>
          <h3 className="text-xs font-medium text-muted-foreground mb-2 px-0.5">{t("folders")}</h3>
          <div role="row" className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {folders.map((resource) => (
              <FolderTile
                key={resource.id}
                resource={resource}
                isSelected={selected.has(resource.name)}
                isFocused={focusedName === resource.name}
                isDropTarget={dropTarget === resource.name}
                isCut={cutNames.has(resource.name)}
                isStarred={starredPaths.has(pathOf(resource))}
                {...common}
              />
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section aria-label={t("files_heading")}>
          {folders.length > 0 && <h3 className="text-xs font-medium text-muted-foreground mb-2 px-0.5">{t("files_heading")}</h3>}
          <div role="row" className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {files.map((resource) => (
              <FileTile
                key={resource.id}
                resource={resource}
                isSelected={selected.has(resource.name)}
                isFocused={focusedName === resource.name}
                isCut={cutNames.has(resource.name)}
                {...common}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface TileProps {
  resource: FileResource;
  isSelected: boolean;
  isFocused: boolean;
  isCut: boolean;
  selecting: boolean;
  touch: boolean;
  iconOptions: IconOptions;
  getImageUrl: (name: string) => Promise<string>;
  handlers: FileItemHandlers;
}

function FolderTile({ resource, isSelected, isFocused, isDropTarget, isCut, isStarred, selecting, touch, iconOptions, handlers }: TileProps & { isDropTarget: boolean; isStarred: boolean }) {
  const t = useTranslations("files");
  const touchProps = useTouchPress(touch, selecting, resource, handlers);
  return (
    <div
      role="gridcell"
      aria-selected={isSelected}
      data-resource={resource.name}
      {...handlers.dragProps(resource)}
      onClick={(e) => handlers.onSelectClick(resource, e)}
      onDoubleClick={() => handlers.onOpen(resource)}
      onContextMenu={(e) => handlers.onContextMenu(e, resource)}
      {...touchProps}
      className={cn(
        "group relative flex items-center gap-2.5 h-11 ps-3 pe-1 rounded-lg border cursor-default select-none transition-colors",
        isSelected ? "border-primary/60 bg-primary/10" : isDropTarget ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/60",
        isFocused && "ring-2 ring-ring/50",
        isCut && "opacity-50",
      )}
    >
      {(selecting || !touch) && (
        <span className={cn("absolute -top-1.5 -start-1.5", !(selecting || isSelected) && "opacity-0 group-hover:opacity-100")}>
          <SelectBox checked={isSelected} visible onToggle={() => handlers.onToggleSelect(resource)} label={t("select_item", { name: resource.name })} />
        </span>
      )}
      <ResourceIcon resource={resource} size="sm" options={iconOptions} />
      <button
        type="button"
        data-item-action
        onClick={(e) => { e.stopPropagation(); if (touch && selecting) handlers.onToggleSelect(resource); else handlers.onOpen(resource); }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 truncate text-start text-sm font-medium"
        title={resource.name}
      >
        {resource.name}
      </button>
      {isStarred && <Star className="w-3.5 h-3.5 shrink-0 text-amber-500 fill-current" aria-label={t("favorites")} />}
      <ShareBadge resource={resource} t={t} />
      <button
        type="button"
        data-item-action
        aria-label={t("more_actions", { name: resource.name })}
        onClick={(e) => { e.stopPropagation(); handlers.onContextMenu(e, resource); }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn("p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10", !touch && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  );
}

function FileTile({ resource, isSelected, isFocused, isCut, selecting, touch, iconOptions, getImageUrl, handlers }: TileProps) {
  const t = useTranslations("files");
  const touchProps = useTouchPress(touch, selecting, resource, handlers);
  const bigIcon = <ResourceIcon resource={resource} size="xl" options={iconOptions} />;
  return (
    <div
      role="gridcell"
      aria-selected={isSelected}
      data-resource={resource.name}
      {...handlers.dragProps(resource)}
      onClick={(e) => handlers.onSelectClick(resource, e)}
      onDoubleClick={() => handlers.onOpen(resource)}
      onContextMenu={(e) => handlers.onContextMenu(e, resource)}
      {...touchProps}
      className={cn(
        "group relative flex flex-col rounded-lg border overflow-hidden cursor-default select-none transition-colors",
        isSelected ? "border-primary/60 bg-primary/10" : "border-border bg-background hover:bg-muted/60",
        isFocused && "ring-2 ring-ring/50",
        isCut && "opacity-50",
      )}
    >
      <div className="aspect-[4/3] bg-muted/50 flex items-center justify-center overflow-hidden border-b border-border/60">
        {canShowThumbnail(resource, iconOptions) ? (
          <Thumbnail
            resource={resource}
            getImageUrl={getImageUrl}
            wrapperClassName="w-full h-full"
            className="w-full h-full object-cover"
            fallback={bigIcon}
          />
        ) : bigIcon}
      </div>
      {(selecting || !touch) && (
        <span className={cn("absolute top-2 start-2", !(selecting || isSelected) && "opacity-0 group-hover:opacity-100")}>
          <SelectBox checked={isSelected} visible onToggle={() => handlers.onToggleSelect(resource)} label={t("select_item", { name: resource.name })} />
        </span>
      )}
      <div className="flex items-center gap-1 ps-2.5 pe-1 py-1.5 min-w-0">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-item-action
            onClick={(e) => { e.stopPropagation(); if (touch && selecting) handlers.onToggleSelect(resource); else handlers.onOpen(resource); }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="block w-full truncate text-start text-sm"
            title={resource.name}
          >
            {resource.name}
          </button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <span className="truncate">
              {resource.isSymlink ? "" : `${formatFileSize(resource.contentLength)} · `}{formatShortDate(resource.lastModified)}
            </span>
            <ShareBadge resource={resource} t={t} className="w-3 h-3" />
          </div>
        </div>
        <button
          type="button"
          data-item-action
          aria-label={t("more_actions", { name: resource.name })}
          onClick={(e) => { e.stopPropagation(); handlers.onContextMenu(e, resource); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn("p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10 shrink-0", !touch && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
