import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./dataDir";
import { StorageUnavailableError } from "./enquiryStore";

/**
 * Private storage for preview images that customers chose to attach to a quotation request.
 * These images show the inside of a customer's home, so they are never public:
 *  - "file": DATA_DIR/enquiry-previews/<enquiry id>.jpg, outside the public web folder.
 *  - "supabase": a PRIVATE Supabase Storage bucket ("enquiry-previews"), used when SUPABASE_URL and
 *    SUPABASE_SERVICE_ROLE_KEY are set. Create the bucket with supabase/schema.sql.
 * Either way they are only served through /api/admin/enquiries/<id>/preview to a signed-in admin.
 * The original uploaded photo is never sent to the server at all.
 */
export interface PreviewStore {
  kind: "file" | "supabase";
  save(enquiryId: string, jpeg: Buffer): Promise<void>;
  read(enquiryId: string): Promise<Buffer | null>;
  remove(enquiryId: string): Promise<void>;
}

const safeId = (id: string) => {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new StorageUnavailableError("Invalid enquiry id.");
  return id;
};

export class FilePreviewStore implements PreviewStore {
  kind = "file" as const;
  constructor(private readonly dir: string) {}
  private file(id: string) {
    return path.join(this.dir, `${safeId(id)}.jpg`);
  }
  async save(id: string, jpeg: Buffer) {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.file(id), jpeg, { mode: 0o600 });
      const check = await fs.stat(this.file(id));
      if (check.size !== jpeg.length) throw new Error("size mismatch");
    } catch (err) {
      throw new StorageUnavailableError("The preview image could not be stored on this server.", err);
    }
  }
  async read(id: string) {
    try {
      return await fs.readFile(this.file(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageUnavailableError("The preview image could not be read.", err);
    }
  }
  async remove(id: string) {
    await fs.rm(this.file(id), { force: true }).catch(() => undefined);
  }
}

export const PREVIEW_BUCKET = "enquiry-previews";

export class SupabasePreviewStore implements PreviewStore {
  kind = "supabase" as const;
  constructor(private readonly url: string, private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}
  private endpoint(id: string) {
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${PREVIEW_BUCKET}/${safeId(id)}.jpg`;
  }
  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }
  async save(id: string, jpeg: Buffer) {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint(id), { method: "POST", headers: this.headers({ "Content-Type": "image/jpeg", "x-upsert": "true" }), body: new Uint8Array(jpeg), cache: "no-store" });
    } catch (err) {
      throw new StorageUnavailableError("The preview storage could not be reached.", err);
    }
    if (!res.ok) throw new StorageUnavailableError(`The preview storage refused the image (HTTP ${res.status}).`, await res.text().catch(() => ""));
  }
  async read(id: string) {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint(id), { headers: this.headers(), cache: "no-store" });
    } catch (err) {
      throw new StorageUnavailableError("The preview storage could not be reached.", err);
    }
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new StorageUnavailableError(`The preview storage refused the request (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(id: string) {
    await this.fetchImpl(this.endpoint(id), { method: "DELETE", headers: this.headers(), cache: "no-store" }).catch(() => undefined);
  }
}

let store: PreviewStore | null = null;
export function getPreviewStore(): PreviewStore {
  if (store) return store;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  store = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? new SupabasePreviewStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : new FilePreviewStore(path.join(dataDir(), "enquiry-previews"));
  return store;
}
