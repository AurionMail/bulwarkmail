export interface SearchFilters {
  from: string;
  to: string;
  subject: string;
  body: string;
  hasAttachment: boolean | null;
  dateAfter: string;
  dateBefore: string;
  isUnread: boolean | null;
  isStarred: boolean | null;
  /** Message size bounds in KB (RFC 8621 §4.4.1 minSize / maxSize); "" = unset. */
  minSizeKb: string;
  maxSizeKb: string;
  /**
   * A raw JMAP Email filter a plugin ran via `api.search.run` (#1024). ANDed
   * into the search like the fields above and cleared with them.
   */
  pluginFilter?: PluginSearchFilter | null;
}

export interface PluginSearchFilter {
  pluginId: string;
  /** Chip text: the plugin's label for the search, or its name. */
  label: string;
  filter: Record<string, unknown>;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  from: "",
  to: "",
  subject: "",
  body: "",
  hasAttachment: null,
  dateAfter: "",
  dateBefore: "",
  isUnread: null,
  isStarred: null,
  minSizeKb: "",
  maxSizeKb: "",
  pluginFilter: null,
};

// Upper bound on a serialized plugin filter. A filter tree bigger than this
// is either a bug or an abuse vector for the JMAP request budget.
export const MAX_PLUGIN_FILTER_JSON_BYTES = 16 * 1024;

/**
 * Check a plugin-supplied JMAP Email FilterCondition/FilterOperator and return
 * a plain-data copy. `what` names the value in the error message, e.g.
 * `search.run: query`.
 */
export function normalizePluginFilter(what: string, query: unknown): Record<string, unknown> {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw new Error(`${what} must be a JMAP filter object`);
  }
  let json: string;
  try {
    json = JSON.stringify(query);
  } catch {
    throw new Error(`${what} is not serializable`);
  }
  if (json.length > MAX_PLUGIN_FILTER_JSON_BYTES) {
    throw new Error(`${what} exceeds ${MAX_PLUGIN_FILTER_JSON_BYTES} bytes`);
  }
  // Deep-clone via JSON so the stored filter is plain data (no prototypes,
  // functions or getters can cross into request bodies).
  return JSON.parse(json) as Record<string, unknown>;
}

/** The KB size field as a positive byte count, or null when unset/invalid. */
export function sizeFilterBytes(value: string | undefined): number | null {
  const kb = Number(value);
  if (!value || !Number.isFinite(kb) || kb <= 0) return null;
  return Math.round(kb * 1024);
}

export function buildJMAPFilter(
  textQuery: string,
  filters: SearchFilters,
  mailboxId?: string
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  // Sent as typed. JMAP's text filter has no wildcard syntax: Stalwart's
  // tokenizer drops a trailing "*" (so "runn*" finds nothing) and matches
  // whole, stemmed words only.
  if (textQuery.trim()) {
    conditions.push({ text: textQuery.trim() });
  }

  if (filters.from) {
    conditions.push({ from: filters.from });
  }

  if (filters.to) {
    conditions.push({ to: filters.to });
  }

  if (filters.subject) {
    conditions.push({ subject: filters.subject });
  }

  if (filters.body) {
    conditions.push({ body: filters.body });
  }

  if (filters.hasAttachment === true) {
    conditions.push({ hasAttachment: true });
  } else if (filters.hasAttachment === false) {
    conditions.push({ hasAttachment: false });
  }

  if (filters.dateAfter) {
    const date = new Date(filters.dateAfter);
    if (!isNaN(date.getTime())) {
      conditions.push({ after: date.toISOString() });
    }
  }

  if (filters.dateBefore) {
    const endOfDay = new Date(filters.dateBefore);
    if (!isNaN(endOfDay.getTime())) {
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push({ before: endOfDay.toISOString() });
    }
  }

  if (filters.isUnread === true) {
    conditions.push({ notKeyword: "$seen" });
  } else if (filters.isUnread === false) {
    conditions.push({ hasKeyword: "$seen" });
  }

  if (filters.isStarred === true) {
    conditions.push({ hasKeyword: "$flagged" });
  } else if (filters.isStarred === false) {
    conditions.push({ notKeyword: "$flagged" });
  }

  // minSize is inclusive, maxSize exclusive (RFC 8621 §4.4.1).
  const minSize = sizeFilterBytes(filters.minSizeKb);
  if (minSize !== null) {
    conditions.push({ minSize });
  }
  const maxSize = sizeFilterBytes(filters.maxSizeKb);
  if (maxSize !== null) {
    conditions.push({ maxSize });
  }

  if (filters.pluginFilter) {
    conditions.push(filters.pluginFilter.filter);
  }

  if (mailboxId) {
    conditions.push({ inMailbox: mailboxId });
  }

  if (conditions.length === 0) {
    return mailboxId ? { inMailbox: mailboxId } : {};
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return {
    operator: "AND",
    conditions,
  };
}

type JmapFilter = Record<string, unknown>;

/** `AND` two JMAP filters, flattening into an existing top-level `AND`. */
export function andFilters(base: JmapFilter, extra: JmapFilter | null): JmapFilter {
  if (!extra || Object.keys(extra).length === 0) return base;
  if (Object.keys(base).length === 0) return extra;
  if (base.operator === 'AND' && Array.isArray(base.conditions)) {
    return { operator: 'AND', conditions: [...(base.conditions as JmapFilter[]), extra] };
  }
  return { operator: 'AND', conditions: [base, extra] };
}

export function isFilterEmpty(filters: SearchFilters): boolean {
  return (
    !filters.from &&
    !filters.to &&
    !filters.subject &&
    !filters.body &&
    filters.hasAttachment === null &&
    !filters.dateAfter &&
    !filters.dateBefore &&
    filters.isUnread === null &&
    filters.isStarred === null &&
    sizeFilterBytes(filters.minSizeKb) === null &&
    sizeFilterBytes(filters.maxSizeKb) === null &&
    !filters.pluginFilter
  );
}

export function activeFilterCount(filters: SearchFilters): number {
  let count = 0;
  if (filters.from) count++;
  if (filters.to) count++;
  if (filters.subject) count++;
  if (filters.body) count++;
  if (filters.hasAttachment !== null) count++;
  if (filters.dateAfter) count++;
  if (filters.dateBefore) count++;
  if (filters.isUnread !== null) count++;
  if (filters.isStarred !== null) count++;
  if (sizeFilterBytes(filters.minSizeKb) !== null) count++;
  if (sizeFilterBytes(filters.maxSizeKb) !== null) count++;
  if (filters.pluginFilter) count++;
  return count;
}
