import type { AdminProduct } from "./edits";
import { matchesSearch } from "./query";
import { productTaxonomyId, TAXONOMY_KINDS, type TaxonomyKind } from "./taxonomy";

export const ADMIN_STATUSES = ["all", "live", "unpublished", "inactive", "edited", "added", "deleted"] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export interface AdminProductQuery {
  q?: string;
  status?: AdminStatus;
  /** List filters by entry id (slug of the name, or size id). */
  filters?: Partial<Record<TaxonomyKind, string>>;
  page?: number;
  pageSize?: number;
}

export function statusMatches(p: AdminProduct, status: AdminStatus): boolean {
  switch (status) {
    case "all":
      return p.origin !== "deleted";
    case "live":
      return p.origin !== "deleted" && p.isActive && p.isPublished;
    case "unpublished":
      return p.origin !== "deleted" && !p.isPublished;
    case "inactive":
      return p.origin !== "deleted" && !p.isActive;
    default:
      return p.origin === status;
  }
}

export function queryAdminProducts(all: AdminProduct[], query: AdminProductQuery) {
  const status = query.status ?? "all";
  let items = all.filter((p) => statusMatches(p, status));
  if (query.q) items = items.filter((p) => matchesSearch(p, query.q!) || p.id.includes(query.q!.toLowerCase()));
  for (const kind of TAXONOMY_KINDS) {
    const want = query.filters?.[kind];
    if (want) items = items.filter((p) => (productTaxonomyId(p, kind) ?? "") === want);
  }
  items = [...items].sort((a, b) => (a.brand ?? "").localeCompare(b.brand ?? "") || a.panelCode.localeCompare(b.panelCode, undefined, { numeric: true }));
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 50)), 200);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pageCount);
  const counts = Object.fromEntries(ADMIN_STATUSES.map((s) => [s, all.filter((p) => statusMatches(p, s)).length])) as Record<AdminStatus, number>;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, pageCount, counts, ids: items.map((p) => p.id) };
}

export function parseAdminProductParams(params: URLSearchParams): AdminProductQuery {
  const status = params.get("status") as AdminStatus | null;
  const filters: AdminProductQuery["filters"] = {};
  for (const k of TAXONOMY_KINDS) {
    const v = params.get(k);
    if (v) filters[k] = v.slice(0, 80);
  }
  const num = (k: string) => {
    const n = Number(params.get(k));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return {
    q: params.get("q")?.trim().slice(0, 100) || undefined,
    status: status && (ADMIN_STATUSES as readonly string[]).includes(status) ? status : "all",
    filters,
    page: num("page"),
    pageSize: num("pageSize"),
  };
}
