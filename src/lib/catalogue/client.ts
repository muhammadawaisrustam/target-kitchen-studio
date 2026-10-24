import type { CataloguePage } from "./query";

export type CatalogueResponse = CataloguePage & { isDemo: boolean };

export interface CatalogueFilters {
  q: string;
  category: string[];
  colourFamily: string[];
  finish: string[];
  brand: string[];
  board: string[];
}

export async function fetchCatalogue(filters: Partial<CatalogueFilters> & { page?: number; pageSize?: number; codes?: string[] }, signal?: AbortSignal): Promise<CatalogueResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const key of ["category", "colourFamily", "finish", "brand", "board", "codes"] as const) {
    for (const v of filters[key] ?? []) params.append(key, v);
  }
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  const res = await fetch(`/api/catalogue?${params}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Catalogue request failed (${res.status})`);
  }
  return res.json();
}
