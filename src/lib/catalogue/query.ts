import { codeKey, type Product } from "./schema";

export interface CatalogueQuery {
  q?: string;
  category?: string[];
  colourFamily?: string[];
  finish?: string[];
  brand?: string[];
  board?: string[];
  codes?: string[];
  page?: number;
  pageSize?: number;
  includeUnpublished?: boolean;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface CataloguePage {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  facets: Record<FacetKey, FacetCount[]>;
}

export const MAX_PAGE_SIZE = 60;

export const FACET_KEYS = ["brand", "board", "category", "colourFamily", "finish"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** True when every whitespace-separated term matches the code, name, category, colour or finish. */
export function matchesSearch(p: Product, q: string): boolean {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(
    [p.panelCode, p.panelCode.replace(/[-_\s]/g, ""), p.decorCode ?? "", p.productName, p.category, p.colourFamily, p.finish, p.brand ?? "", p.board ?? ""].join(" "),
  );
  return terms.every((t) => hay.includes(t));
}

function facet(items: Product[], key: FacetKey): FacetCount[] {
  const counts = new Map<string, number>();
  for (const p of items) {
    const v = p[key];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * Filters, searches and paginates the catalogue. Runs on the server so the browser only
 * ever receives one page of lightweight records (thumbnails are lazy-loaded separately).
 */
export function queryCatalogue(all: Product[], query: CatalogueQuery): CataloguePage {
  const visible = all.filter((p) => query.includeUnpublished || (p.isPublished && p.isActive));
  let items = visible;
  if (query.codes?.length) {
    const wanted = new Set(query.codes.map(codeKey));
    items = items.filter((p) => wanted.has(codeKey(p.panelCode)));
  }
  if (query.q) items = items.filter((p) => matchesSearch(p, query.q!));

  // Facet counts reflect the search text but not the facet's own filter, so users can widen a filter.
  const filterBy = (list: Product[], skip?: FacetKey) =>
    list.filter((p) =>
      FACET_KEYS.every((k) => k === skip || !query[k]?.length || query[k]!.includes(p[k] ?? "")),
    );
  const facets = Object.fromEntries(FACET_KEYS.map((k) => [k, facet(filterBy(items, k), k)])) as Record<FacetKey, FacetCount[]>;
  items = filterBy(items);
  items = [...items].sort((a, b) => a.panelCode.localeCompare(b.panelCode, undefined, { numeric: true }));

  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 24)), MAX_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pageCount);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    pageCount,
    facets,
  };
}

/** Parses URLSearchParams from the catalogue API into a CatalogueQuery. */
export function parseCatalogueParams(params: URLSearchParams): CatalogueQuery {
  const list = (k: string) =>
    params
      .getAll(k)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 50);
  const num = (k: string) => {
    const n = Number(params.get(k));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return {
    q: params.get("q")?.slice(0, 100) || undefined,
    category: list("category"),
    colourFamily: list("colourFamily"),
    finish: list("finish"),
    brand: list("brand"),
    board: list("board"),
    codes: list("codes"),
    page: num("page"),
    pageSize: num("pageSize"),
  };
}
