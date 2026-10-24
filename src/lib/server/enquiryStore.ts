import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./dataDir";
import type { Enquiry, EnquiryUpdate } from "@/lib/enquiries/schema";

/**
 * Where enquiries are kept. Two free options:
 *  - "file": a JSON file on the server's disk (DATA_DIR/enquiries.json). Works on any normal
 *    Node.js host or VPS. It does NOT work on serverless hosts (Vercel, Netlify), whose disk is
 *    read-only or wiped; there every submission fails with a clear error instead of pretending.
 *  - "supabase": a table in a Supabase project (free tier), used when SUPABASE_URL and
 *    SUPABASE_SERVICE_ROLE_KEY are set on the server. The key never reaches the browser.
 */
export interface EnquiryStore {
  kind: "file" | "supabase";
  description: string;
  create(e: Enquiry): Promise<Enquiry>;
  list(): Promise<Enquiry[]>;
  update(id: string, patch: EnquiryUpdate): Promise<Enquiry | null>;
}

export class StorageUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

// ---------- file store ----------
export class FileEnquiryStore implements EnquiryStore {
  kind = "file" as const;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  get description() {
    const rel = path.relative(process.cwd(), this.file);
    return `Server file ${rel && !rel.startsWith("..") ? rel : this.file}`;
  }

  /** Serialises reads and writes within this process so two submissions cannot overwrite each other. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<Enquiry[]> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8")) as { enquiries?: Enquiry[] };
      return Array.isArray(data.enquiries) ? data.enquiries : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new StorageUnavailableError("The enquiry file could not be read.", err);
    }
  }

  private async write(list: Enquiry[]) {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      const handle = await fs.open(tmp, "w");
      try {
        await handle.writeFile(JSON.stringify({ version: 1, enquiries: list }, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, this.file);
    } catch (err) {
      throw new StorageUnavailableError("Enquiries cannot be saved on this server (its disk is not writable).", err);
    }
  }

  create(e: Enquiry) {
    return this.exclusive(async () => {
      const list = await this.read();
      list.push(e);
      await this.write(list);
      // Confirm the record is really on disk before reporting success.
      const check = await this.read();
      if (!check.some((x) => x.id === e.id)) throw new StorageUnavailableError("The enquiry could not be confirmed after saving.");
      return e;
    });
  }

  list() {
    return this.exclusive(async () => (await this.read()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  update(id: string, patch: EnquiryUpdate) {
    return this.exclusive(async () => {
      const list = await this.read();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const next: Enquiry = { ...list[i]!, ...patch, updatedAt: new Date().toISOString() };
      list[i] = next;
      await this.write(list);
      return next;
    });
  }
}

// ---------- Supabase store (REST API, no SDK needed) ----------
type Row = { id: string; reference: string; created_at: string; updated_at: string; status: string; data: Enquiry };

export class SupabaseEnquiryStore implements EnquiryStore {
  kind = "supabase" as const;
  description = "Supabase table public.enquiries";
  constructor(private readonly url: string, private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call(pathAndQuery: string, init: RequestInit = {}): Promise<Row[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`, {
        ...init,
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch (err) {
      throw new StorageUnavailableError("The enquiry database could not be reached.", err);
    }
    if (!res.ok) throw new StorageUnavailableError(`The enquiry database refused the request (HTTP ${res.status}).`, await res.text().catch(() => ""));
    return (await res.json()) as Row[];
  }

  private toRow(e: Enquiry): Row {
    return { id: e.id, reference: e.reference, created_at: e.createdAt, updated_at: e.updatedAt, status: e.status, data: e };
  }

  async create(e: Enquiry) {
    const rows = await this.call("enquiries", { method: "POST", body: JSON.stringify(this.toRow(e)) });
    if (!rows[0] || rows[0].id !== e.id) throw new StorageUnavailableError("The enquiry could not be confirmed after saving.");
    return rows[0].data;
  }

  async list() {
    const rows = await this.call("enquiries?select=*&order=created_at.desc&limit=1000");
    return rows.map((r) => ({ ...r.data, status: r.status as Enquiry["status"], updatedAt: r.updated_at }));
  }

  async update(id: string, patch: EnquiryUpdate) {
    const current = (await this.call(`enquiries?id=eq.${encodeURIComponent(id)}&select=*`))[0];
    if (!current) return null;
    const next: Enquiry = { ...current.data, ...patch, updatedAt: new Date().toISOString() };
    const rows = await this.call(`enquiries?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: next.status, updated_at: next.updatedAt, data: next }) });
    return rows[0]?.data ?? null;
  }
}

let store: EnquiryStore | null = null;
export function getEnquiryStore(): EnquiryStore {
  if (store) return store;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  store =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseEnquiryStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : new FileEnquiryStore(path.join(dataDir(), "enquiries.json"));
  return store;
}
