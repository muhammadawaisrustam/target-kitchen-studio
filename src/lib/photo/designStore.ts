/**
 * Browser-only storage for saved photo designs (IndexedDB). Photos stay on this device: nothing
 * here talks to a server. IndexedDB is used instead of localStorage because images are too large
 * for localStorage's few-megabyte limit.
 */
import { parsePhotoDesign, type PhotoDesignRecord } from "./design";

const DB_NAME = "tks-photo-designs";
const STORE = "designs";
export const MAX_PHOTO_DESIGNS = 30;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot store photo designs (IndexedDB is not available, e.g. in some private windows)."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Photo designs could not be opened in this browser (storage may be blocked)."));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        let result: T;
        req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        const fail = () => {
          db.close();
          const name = tx.error?.name ?? req.error?.name;
          reject(new Error(name === "QuotaExceededError" ? "This browser's storage is full. Delete some saved photo designs and try again." : "The photo design could not be saved in this browser."));
        };
        tx.onerror = fail;
        tx.onabort = fail;
      }),
  );
}

/** Lists saved designs, newest first. Damaged records are counted and skipped. */
export async function listPhotoDesigns(): Promise<{ designs: PhotoDesignRecord[]; skipped: number }> {
  const raw = await run<unknown[]>("readonly", (s) => s.getAll());
  const designs: PhotoDesignRecord[] = [];
  let skipped = 0;
  for (const r of raw) {
    const d = parsePhotoDesign(r);
    if (d) designs.push(d);
    else skipped++;
  }
  designs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { designs, skipped };
}

/** Saves and reads the record back, so the UI only reports success when it is really stored. */
export async function savePhotoDesign(record: PhotoDesignRecord, existingCount: number): Promise<void> {
  if (existingCount >= MAX_PHOTO_DESIGNS) throw new Error(`You can keep up to ${MAX_PHOTO_DESIGNS} photo designs in this browser. Delete some first.`);
  await run("readwrite", (s) => s.put(record));
  const check = await run<unknown>("readonly", (s) => s.get(record.id));
  if (!parsePhotoDesign(check)) throw new Error("The photo design could not be confirmed after saving.");
}

export async function deletePhotoDesign(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
