import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./dataDir";
import { StorageUnavailableError } from "./enquiryStore";

/**
 * Where admin catalogue edits are kept (panels, brands, categories, sizes and other lists).
 * Same two free options as enquiries:
 *  - "supabase": table public.catalogue_items, used when SUPABASE_URL and
 *    SUPABASE_SERVICE_ROLE_KEY are set. Needed on Netlify and Vercel, whose disks are not kept.
 *  - "file": DATA_DIR/catalogue-admin.json on a server with its own disk.
 *
 * Rows are small JSON documents keyed by (kind, id): kind "product" holds a ProductEdit, the
 * list kinds ("brand", "category", "size"...) hold a TaxonomyItem.
 */
export interface StoreRow {
  kind: string;
  id: string;
  data: unknown;
  updatedAt: string;
}
export type RowKey = Pick<StoreRow, "kind" | "id">;

export interface CatalogueStore {
  kind: "file" | "supabase";
  description: string;
  list(): Promise<StoreRow[]>;
  put(rows: StoreRow[]): Promise<void>;
  remove(keys: RowKey[]): Promise<void>;
}

const keyOf = (r: RowKey) => `${r.kind}\u0000${r.id}`;

// ---------- file store ----------
export class FileCatalogueStore implements CatalogueStore {
  kind = "file" as const;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  get description() {
    const rel = path.relative(process.cwd(), this.file);
    return `Server file ${rel && !rel.startsWith("..") ? rel : this.file}`;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<StoreRow[]> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8")) as { rows?: StoreRow[] };
      return Array.isArray(data.rows) ? data.rows : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new StorageUnavailableError("The catalogue edits file could not be read.", err);
    }
  }

  private async write(rows: StoreRow[]) {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ version: 1, rows }, null, 1));
      await fs.rename(tmp, this.file);
    } catch (err) {
      throw new StorageUnavailableError(
        "Catalogue changes cannot be saved on this server (its disk is not writable). On Netlify or Vercel, connect Supabase (see the README).",
        err,
      );
    }
  }

  list() {
    return this.exclusive(() => this.read());
  }

  put(rows: StoreRow[]) {
    return this.exclusive(async () => {
      const map = new Map((await this.read()).map((r) => [keyOf(r), r]));
      for (const r of rows) map.set(keyOf(r), r);
      await this.write([...map.values()]);
    });
  }

  remove(keys: RowKey[]) {
    return this.exclusive(async () => {
      const drop = new Set(keys.map(keyOf));
      const rows = await this.read();
      const next = rows.filter((r) => !drop.has(keyOf(r)));
      if (next.length !== rows.length) await this.write(next);
    });
  }
}

// ---------- Supabase store (REST API, no SDK) ----------
type DbRow = { kind: string; id: string; data: unknown; updated_at: string };
const PAGE = 1000;
const CHUNK = 500;

export class SupabaseCatalogueStore implements CatalogueStore {
  kind = "supabase" as const;
  description = "Supabase table public.catalogue_items";
  constructor(private readonly url: string, private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`, {
        ...init,
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch (err) {
      throw new StorageUnavailableError("The catalogue database could not be reached.", err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const hint = /catalogue_items/.test(text) && /does not exist|not find/i.test(text) ? " Run supabase/schema.sql in the Supabase SQL editor first." : "";
      throw new StorageUnavailableError(`The catalogue database refused the request (HTTP ${res.status}).${hint}`, text);
    }
    return res;
  }

  async list(): Promise<StoreRow[]> {
    const out: StoreRow[] = [];
    // Supabase returns at most 1000 rows per request, so read in pages.
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.call(`catalogue_items?select=kind,id,data,updated_at&order=kind.asc,id.asc&limit=${PAGE}&offset=${offset}`);
      const rows = (await res.json()) as DbRow[];
      out.push(...rows.map((r) => ({ kind: r.kind, id: r.id, data: r.data, updatedAt: r.updated_at })));
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async put(rows: StoreRow[]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const body = rows.slice(i, i + CHUNK).map((r) => ({ kind: r.kind, id: r.id, data: r.data, updated_at: r.updatedAt }));
      await this.call("catalogue_items?on_conflict=kind,id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(body),
      });
    }
  }

  async remove(keys: RowKey[]) {
    const byKind = new Map<string, string[]>();
    for (const k of keys) byKind.set(k.kind, [...(byKind.get(k.kind) ?? []), k.id]);
    for (const [kind, ids] of byKind) {
      for (let i = 0; i < ids.length; i += 100) {
        const list = ids.slice(i, i + 100).map((id) => `"${id.replace(/["\\]/g, "")}"`).join(",");
        await this.call(`catalogue_items?kind=eq.${encodeURIComponent(kind)}&id=in.(${encodeURIComponent(list)})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
    }
  }
}

let store: CatalogueStore | null = null;
export function getCatalogueStore(): CatalogueStore {
  if (store) return store;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  store =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseCatalogueStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : new FileCatalogueStore(path.join(dataDir(), "catalogue-admin.json"));
  return store;
}

/** For tests. */
export function setCatalogueStore(s: CatalogueStore | null) {
  store = s;
}
