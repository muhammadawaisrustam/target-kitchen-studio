import { AbstractMesh, Color3, DynamicTexture, Material, PBRMaterial, Scene, Texture } from "./babylon";
import type { Product } from "@/lib/catalogue/schema";
import { missingTextureSpec, productToMaterialSpec, type MaterialSpec } from "@/lib/materials/materialSpec";
import type { RegionId } from "@/lib/models/regions";
import { TextureManager } from "./textureManager";

export type ApplyStatus = "applied" | "placeholder" | "stale" | "reset";

export interface ApplyResult {
  status: ApplyStatus;
  spec?: MaterialSpec;
  warning?: string;
}

/**
 * Applies product finishes to cabinet regions.
 *
 * Each region owns one PBR material, so changing a panel touches only that region's meshes.
 * The meshes' original materials are recorded the first time they are overridden so a region
 * can be restored exactly (important for imported GLB models with authored materials).
 */
export class MaterialService {
  private regionMaterials = new Map<RegionId, PBRMaterial>();
  private regionTextureKey = new Map<RegionId, [string, number, number]>();
  private originals = new Map<AbstractMesh, Material | null>();
  private tokens = new Map<RegionId, number>();
  private placeholder?: Texture;

  constructor(
    private scene: Scene,
    private textures: TextureManager,
  ) {}

  private materialFor(region: RegionId) {
    let mat = this.regionMaterials.get(region);
    if (!mat) {
      mat = new PBRMaterial(`region:${region}`, this.scene);
      mat.metallic = 0;
      this.regionMaterials.set(region, mat);
    }
    return mat;
  }

  /** Hatched "texture unavailable" pattern: clearly not a product finish. */
  private placeholderTexture() {
    if (this.placeholder) return this.placeholder;
    const size = 256;
    const tex = new DynamicTexture("placeholder:missing-texture", { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#C9C9C9";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#A9A9A9";
    ctx.lineWidth = 14;
    for (let i = -size; i < size * 2; i += 48) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
    }
    ctx.fillStyle = "#555";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TEXTURE", size / 2, size / 2 - 6);
    ctx.fillText("UNAVAILABLE", size / 2, size / 2 + 20);
    tex.update();
    tex.uScale = tex.vScale = 2; // one label every 0.5 m
    this.placeholder = tex;
    return tex;
  }

  private assign(region: RegionId, meshes: AbstractMesh[]) {
    const mat = this.materialFor(region);
    for (const mesh of meshes) {
      if (!this.originals.has(mesh)) this.originals.set(mesh, mesh.material);
      mesh.material = mat;
    }
  }

  private releaseRegionTexture(region: RegionId) {
    const prev = this.regionTextureKey.get(region);
    if (prev) this.textures.release(prev[0], prev[1], prev[2], region);
    this.regionTextureKey.delete(region);
  }

  private configure(mat: PBRMaterial, spec: MaterialSpec, texture: Texture | null) {
    mat.roughness = spec.roughness;
    mat.metallic = spec.metallic;
    if (spec.kind === "texture" && texture) {
      mat.albedoTexture = texture;
      mat.albedoColor = Color3.White();
    } else if (spec.kind === "colour" && spec.colourHex) {
      mat.albedoTexture = null;
      mat.albedoColor = Color3.FromHexString(spec.colourHex).toLinearSpace();
    } else {
      mat.albedoTexture = this.placeholderTexture();
      mat.albedoColor = Color3.White();
      mat.roughness = 0.9;
    }
  }

  /**
   * Applies a product to a region. Requests are versioned per region: if the user picks another
   * panel while a texture is still downloading, the older result is discarded ("stale").
   */
  async applyProduct(region: RegionId, meshes: AbstractMesh[], product: Product): Promise<ApplyResult> {
    const token = (this.tokens.get(region) ?? 0) + 1;
    this.tokens.set(region, token);
    let spec = productToMaterialSpec(product);
    let texture: Texture | null = null;

    if (spec.kind === "texture" && spec.textureUrl) {
      try {
        texture = await this.textures.acquire(spec.textureUrl, spec.repeatsPerMetre, spec.rotationRad, region);
      } catch (err) {
        if (this.tokens.get(region) !== token) return { status: "stale" };
        spec = missingTextureSpec(product, err instanceof Error ? err.message : undefined);
      }
      if (this.tokens.get(region) !== token) {
        if (texture) this.textures.release(spec.textureUrl!, spec.repeatsPerMetre, spec.rotationRad, region);
        return { status: "stale" };
      }
    }

    this.releaseRegionTexture(region);
    if (texture && spec.textureUrl) this.regionTextureKey.set(region, [spec.textureUrl, spec.repeatsPerMetre, spec.rotationRad]);
    this.configure(this.materialFor(region), spec, texture);
    this.assign(region, meshes);
    return { status: spec.kind === "placeholder" ? "placeholder" : "applied", spec, warning: spec.warning };
  }

  /** Restores the meshes' original materials. */
  resetRegion(region: RegionId, meshes: AbstractMesh[]): ApplyResult {
    this.tokens.set(region, (this.tokens.get(region) ?? 0) + 1);
    for (const mesh of meshes) {
      if (this.originals.has(mesh)) mesh.material = this.originals.get(mesh) ?? null;
    }
    this.releaseRegionTexture(region);
    return { status: "reset" };
  }

  dispose() {
    for (const m of this.regionMaterials.values()) m.dispose();
    this.placeholder?.dispose();
    this.regionMaterials.clear();
    this.originals.clear();
  }
}
