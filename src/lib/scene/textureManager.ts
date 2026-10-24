import { Scene, Texture } from "./babylon";

interface Entry {
  promise: Promise<Texture>;
  texture?: Texture;
  users: Set<string>;
  lastUsed: number;
}

const LOAD_TIMEOUT_MS = 20_000;

/**
 * Loads full-resolution panel textures on demand and caches them.
 *
 * - Nothing is loaded at start-up; a texture is fetched only when a region uses it.
 * - Entries are reference-counted by "user" (a region id). Unused entries are kept for quick
 *   switching back, but the least recently used are disposed beyond `maxIdle` to bound GPU memory.
 * - A failed load rejects; callers must show a warning rather than substitute another texture.
 */
export class TextureManager {
  private cache = new Map<string, Entry>();

  constructor(
    private scene: Scene,
    private maxIdle = 6,
  ) {}

  /** Cache key includes repeat/rotation because those are stored on the Texture object. */
  static key(url: string, repeatsPerMetre: number, rotationRad: number) {
    return `${url}|${repeatsPerMetre.toFixed(4)}|${rotationRad.toFixed(4)}`;
  }

  acquire(url: string, repeatsPerMetre: number, rotationRad: number, user: string): Promise<Texture> {
    const key = TextureManager.key(url, repeatsPerMetre, rotationRad);
    let entry = this.cache.get(key);
    if (!entry) {
      const created: Entry = { users: new Set(), lastUsed: Date.now(), promise: Promise.resolve(null as never) };
      created.promise = new Promise<Texture>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          tex.dispose();
          this.cache.delete(key);
          reject(new Error("timed out"));
        }, LOAD_TIMEOUT_MS);
        const tex = new Texture(
          url,
          this.scene,
          false, // generate mipmaps: avoids shimmering on distant doors
          true,
          Texture.TRILINEAR_SAMPLINGMODE,
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            created.texture = tex;
            resolve(tex);
          },
          (message) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            tex.dispose();
            this.cache.delete(key);
            reject(new Error(message || "file could not be loaded"));
          },
        );
        tex.name = `panel:${url}`;
        tex.uScale = repeatsPerMetre;
        tex.vScale = repeatsPerMetre;
        tex.wAng = rotationRad;
        tex.anisotropicFilteringLevel = 8;
      });
      entry = created;
      this.cache.set(key, entry);
    }
    entry.users.add(user);
    entry.lastUsed = Date.now();
    return entry.promise;
  }

  release(url: string, repeatsPerMetre: number, rotationRad: number, user: string) {
    const entry = this.cache.get(TextureManager.key(url, repeatsPerMetre, rotationRad));
    if (!entry) return;
    entry.users.delete(user);
    entry.lastUsed = Date.now();
    this.evict();
  }

  private evict() {
    const idle = [...this.cache.entries()].filter(([, e]) => e.users.size === 0 && e.texture).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (idle.length > this.maxIdle) {
      const [key, e] = idle.shift()!;
      e.texture?.dispose();
      this.cache.delete(key);
    }
  }

  stats() {
    const entries = [...this.cache.values()];
    return { cached: entries.length, inUse: entries.filter((e) => e.users.size > 0).length };
  }

  dispose() {
    for (const e of this.cache.values()) e.texture?.dispose();
    this.cache.clear();
  }
}
