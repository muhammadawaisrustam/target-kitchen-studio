/**
 * Framework-agnostic Babylon.js viewer for kitchen models.
 * React talks to it through this class only; nothing in here imports React.
 */
import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  HighlightLayer,
  ImageProcessingConfiguration,
  Mesh,
  PBRMaterial,
  PointerEventTypes,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  CreateScreenshotAsync,
  TransformNode,
  Vector3,
} from "./babylon";
import type { Product } from "@/lib/catalogue/schema";
import { mapMeshesToRegions } from "@/lib/models/mapping";
import { REGION_IDS, type RegionId } from "@/lib/models/regions";
import type { CameraState, GrainAxis, KitchenModelDefinition } from "@/lib/models/types";
import { MaterialService, type ApplyResult } from "./materialService";
import { applyWorldUVs, buildProceduralKitchen } from "./proceduralKitchen";
import { TextureManager } from "./textureManager";
import { stableOffset } from "./uv";

export type ViewPreset = "perspective" | "front" | "side" | "top";

export interface ViewerEvents {
  onRegionPicked?: (region: RegionId) => void;
  onContextLost?: () => void;
}

export interface LoadReport {
  modelId: string;
  meshCount: number;
  regionMeshCounts: Partial<Record<RegionId, number>>;
  unmappedCount: number;
  emptyRegions: RegionId[];
  loadMs: number;
}

export class WebGLUnavailableError extends Error {
  override name = "WebGLUnavailableError";
}

export class KitchenViewer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private textures: TextureManager;
  private materials: MaterialService;
  private highlight: HighlightLayer;
  private shadows: ShadowGenerator;
  private sun: DirectionalLight;
  private root?: TransformNode;
  private model?: KitchenModelDefinition;
  private regionMeshes = new Map<RegionId, AbstractMesh[]>();
  private bounds = { min: new Vector3(-1, 0, -5), max: new Vector3(5, 2.7, 0) };
  private lastActivity = 0;
  private highlightTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private resizeObserver?: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private events: ViewerEvents = {},
  ) {
    if (!Engine.isSupported()) throw new WebGLUnavailableError("WebGL is not available in this browser or device.");
    try {
      // stencil is required by the highlight layer; preserveDrawingBuffer lets us capture previews.
      this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, antialias: true }, true);
    } catch (err) {
      throw new WebGLUnavailableError(err instanceof Error ? err.message : "WebGL context could not be created.");
    }
    // Cap the pixel ratio: full 3x retina rendering costs a lot of battery for little gain.
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.engine.setHardwareScalingLevel(1 / Math.min(dpr, 2));

    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = new Color4(0.957, 0.949, 0.937, 1);
    scene.skipPointerMovePicking = true; // we only pick on tap
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.exposure = 1.05;

    const camera = (this.camera = new ArcRotateCamera("camera", -1, 1.2, 5.5, new Vector3(1.8, 1, -1.5), scene));
    camera.minZ = 0.05;
    camera.maxZ = 60;
    camera.fov = 0.9;
    camera.lowerRadiusLimit = 1.2;
    camera.upperRadiusLimit = 9;
    camera.lowerBetaLimit = 0.15;
    camera.upperBetaLimit = Math.PI / 2 - 0.04; // never below the floor
    camera.wheelDeltaPercentage = 0.01;
    camera.pinchDeltaPercentage = 0.004;
    camera.useNaturalPinchZoom = true;
    camera.panningSensibility = 900;
    camera.inertia = 0.85;
    camera.panningInertia = 0.8;
    camera.angularSensibilityX = camera.angularSensibilityY = 1600;
    camera.attachControl(true);

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.3), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.55, 0.52, 0.48);
    hemi.specular = new Color3(0.15, 0.15, 0.15);

    const sun = (this.sun = new DirectionalLight("sun", new Vector3(0.45, -0.8, 0.55), scene));
    sun.position = new Vector3(-2, 5, -5);
    sun.intensity = 1.6;
    const shadows = (this.shadows = new ShadowGenerator(2048, sun));
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.0008;
    shadows.normalBias = 0.01;
    shadows.darkness = 0.35;

    this.highlight = new HighlightLayer("highlight", scene, { blurHorizontalSize: 0.8, blurVerticalSize: 0.8 });
    this.highlight.innerGlow = false;

    this.textures = new TextureManager(scene);
    this.materials = new MaterialService(scene, this.textures);

    scene.onPointerObservable.add((info) => {
      this.touch();
      if (info.type !== PointerEventTypes.POINTERTAP) return;
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m.isPickable && m.isVisible);
      const region = pick?.pickedMesh?.metadata?.regionId as RegionId | undefined;
      if (region) this.events.onRegionPicked?.(region);
    });
    camera.onViewMatrixChangedObservable.add(() => this.touch());
    scene.onBeforeRenderObservable.add(() => this.clampTarget());

    this.engine.onContextLostObservable.add(() => this.events.onContextLost?.());

    // Render on demand: after ~1.5 s with no interaction or loading we stop drawing frames,
    // which keeps laptops and phones cool while the customer reads the catalogue.
    this.engine.runRenderLoop(() => {
      if (this.disposed) return;
      const busy = performance.now() - this.lastActivity < 1500 || !scene.isReady();
      if (busy) scene.render();
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.engine.resize();
      this.touch();
    });
    this.resizeObserver.observe(canvas);
    // Keyboard orbit (arrow keys) is processed during render, so wake the loop on key presses.
    canvas.addEventListener("keydown", () => this.touch());
    this.touch();
  }

  /** Marks the scene as changed so the next frames are rendered. */
  touch() {
    this.lastActivity = performance.now();
  }

  private clampTarget() {
    const t = this.camera.target;
    const { min, max } = this.bounds;
    const clamped = new Vector3(Math.min(max.x, Math.max(min.x, t.x)), Math.min(max.y, Math.max(min.y, t.y)), Math.min(max.z, Math.max(min.z, t.z)));
    // cloneAlphaBetaRadius=true: keep the angles; otherwise Babylon rebuilds them from a stale position.
    if (!clamped.equalsWithEpsilon(t, 1e-4)) this.camera.setTarget(clamped, false, false, true);
  }

  async loadModel(model: KitchenModelDefinition): Promise<LoadReport> {
    const t0 = performance.now();
    this.unloadModel();
    this.model = model;
    let meshes: AbstractMesh[];
    let casters: AbstractMesh[];

    if (model.source.type === "procedural") {
      const built = buildProceduralKitchen(this.scene, model.source.builder);
      this.root = built.root;
      meshes = built.meshes;
      casters = built.shadowCasters;
      this.bounds = { min: new Vector3(...built.bounds.min), max: new Vector3(...built.bounds.max) };
    } else {
      // glTF support is only downloaded when a GLB model is actually used.
      await import("@babylonjs/loaders/glTF/2.0");
      const { ImportMeshAsync } = await import("@babylonjs/core/Loading/sceneLoader");
      const result = await ImportMeshAsync(model.source.url, this.scene);
      this.root = new TransformNode(`kitchen_root_${model.id}`, this.scene);
      for (const m of result.meshes) if (!m.parent) m.parent = this.root;
      meshes = result.meshes.filter((m) => m.getTotalVertices() > 0);
      casters = meshes;
      const { min, max } = this.root.getHierarchyBoundingVectors(true);
      this.bounds = { min, max };
    }

    // Map meshes to logical regions using the registry rules.
    const descriptors = meshes.map((mesh) => ({ name: mesh.name, materialName: mesh.material?.name, mesh }));
    const mapping = mapMeshesToRegions(descriptors, model.regions);
    this.regionMeshes.clear();
    for (const [region, list] of mapping.byRegion) {
      const rule = model.regions[region]!;
      const regionMeshes = list.map((d) => d.mesh);
      for (const mesh of regionMeshes) {
        mesh.metadata = { ...(mesh.metadata ?? {}), regionId: region };
        // Mesh-level grain (set by the procedural builder) wins over the region default.
        const grain: GrainAxis = mesh.metadata.grainAxis ?? rule.grainAxis ?? "y";
        if (rule.uvMode === "box-projection" && mesh instanceof Mesh) applyWorldUVs(mesh, grain, stableOffset(mesh.name));
      }
      this.regionMeshes.set(region, regionMeshes);
    }

    for (const mesh of meshes) {
      mesh.isPickable = !!mesh.metadata?.regionId;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
    }
    for (const c of casters) this.shadows.addShadowCaster(c, false);
    // The kitchen is static, so the shadow map is rendered once instead of every frame.
    const map = this.shadows.getShadowMap();
    if (map) {
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.resetRefreshCounter();
    }
    this.setCameraState(model.camera, false);
    this.touch();
    await this.scene.whenReadyAsync();
    this.touch();

    const regionMeshCounts: Partial<Record<RegionId, number>> = {};
    for (const r of REGION_IDS) if (this.regionMeshes.has(r)) regionMeshCounts[r] = this.regionMeshes.get(r)!.length;
    return {
      modelId: model.id,
      meshCount: meshes.length,
      regionMeshCounts,
      unmappedCount: mapping.unmapped.length,
      emptyRegions: mapping.emptyRegions,
      loadMs: Math.round(performance.now() - t0),
    };
  }

  private unloadModel() {
    for (const [region, meshes] of this.regionMeshes) this.materials.resetRegion(region, meshes);
    this.regionMeshes.clear();
    this.highlight.removeAllMeshes();
    if (this.root) {
      const mats = new Set(this.root.getChildMeshes().map((m) => m.material).filter(Boolean));
      this.root.dispose(false, false);
      for (const m of mats) if (m && !m.name.startsWith("region:")) m.dispose(true, true);
    }
    this.root = undefined;
  }

  get regions(): RegionId[] {
    return [...this.regionMeshes.keys()];
  }

  async applyProduct(region: RegionId, product: Product): Promise<ApplyResult> {
    const meshes = this.regionMeshes.get(region);
    if (!meshes?.length) return { status: "stale", warning: `This kitchen has no ${region} region.` };
    this.touch();
    const result = await this.materials.applyProduct(region, meshes, product);
    // Shader recompilation happens over the next frames; keep rendering until it is ready.
    this.touch();
    await this.scene.whenReadyAsync();
    this.touch();
    return result;
  }

  resetRegion(region: RegionId) {
    const meshes = this.regionMeshes.get(region);
    if (meshes) this.materials.resetRegion(region, meshes);
    this.touch();
  }

  /** Briefly outlines the meshes of a region so the customer sees what they are editing. */
  flashRegion(region: RegionId, ms = 1400) {
    this.highlight.removeAllMeshes();
    clearTimeout(this.highlightTimer);
    for (const m of this.regionMeshes.get(region) ?? []) if (m instanceof Mesh) this.highlight.addMesh(m, Color3.FromHexString("#C08A3E"));
    const start = performance.now();
    const keepAlive = () => {
      this.touch();
      if (performance.now() - start < ms) requestAnimationFrame(keepAlive);
    };
    keepAlive();
    this.highlightTimer = setTimeout(() => {
      this.highlight.removeAllMeshes();
      this.touch();
    }, ms);
  }

  // ---------- camera ----------
  getCameraState(): CameraState {
    const c = this.camera;
    return { alpha: c.alpha, beta: c.beta, radius: c.radius, target: [c.target.x, c.target.y, c.target.z] };
  }

  setCameraState(state: CameraState, animate = true) {
    const c = this.camera;
    c.inertialAlphaOffset = c.inertialBetaOffset = c.inertialRadiusOffset = 0;
    c.inertialPanningX = c.inertialPanningY = 0;
    const to = { alpha: state.alpha, beta: state.beta, radius: state.radius, target: new Vector3(...state.target) };
    if (!animate) {
      c.setTarget(to.target, false, false, true);
      c.alpha = to.alpha;
      c.beta = to.beta;
      c.radius = to.radius;
      this.touch();
      return;
    }
    const from = { alpha: c.alpha, beta: c.beta, radius: c.radius, target: c.target.clone() };
    // Take the short way round when animating alpha.
    let dAlpha = (to.alpha - from.alpha) % (Math.PI * 2);
    if (dAlpha > Math.PI) dAlpha -= Math.PI * 2;
    if (dAlpha < -Math.PI) dAlpha += Math.PI * 2;
    const start = performance.now();
    const duration = 550;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      c.alpha = from.alpha + dAlpha * e;
      c.beta = from.beta + (to.beta - from.beta) * e;
      c.radius = from.radius + (to.radius - from.radius) * e;
      c.setTarget(Vector3.Lerp(from.target, to.target, e), false, false, true);
      this.touch();
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  resetCamera() {
    if (this.model) this.setCameraState(this.model.camera);
  }

  setView(preset: ViewPreset) {
    if (!this.model) return;
    const base = this.model.camera;
    const [cx, , cz] = [(this.bounds.min.x + this.bounds.max.x) / 2, 0, (this.bounds.min.z + this.bounds.max.z) / 2];
    const views: Record<ViewPreset, CameraState> = {
      perspective: base,
      front: { alpha: -Math.PI / 2, beta: 1.42, radius: 6.2, target: [cx, 1.15, cz * 0.6] },
      side: { alpha: -0.1, beta: 1.38, radius: 6, target: [cx, 1.1, cz] },
      top: { alpha: -Math.PI / 2, beta: 0.2, radius: 7.5, target: [cx, 0.5, cz] },
    };
    this.setCameraState(views[preset]);
  }

  /** factor < 1 zooms in, > 1 zooms out. */
  zoom(factor: number) {
    const c = this.camera;
    const target = Math.min(c.upperRadiusLimit ?? 20, Math.max(c.lowerRadiusLimit ?? 0.5, c.radius * factor));
    this.setCameraState({ ...this.getCameraState(), radius: target });
  }

  // ---------- misc ----------
  async captureImage(width = 640): Promise<string> {
    this.scene.render();
    const height = Math.round((width * this.canvas.height) / Math.max(1, this.canvas.width));
    return CreateScreenshotAsync(this.engine, this.camera, { width, height }, "image/jpeg", 0.82);
  }

  stats() {
    return {
      fps: Math.round(this.engine.getFps()),
      meshes: this.scene.meshes.length,
      textures: this.textures.stats(),
      drawCalls: (this.scene as unknown as { _activeMeshes?: { length: number } })._activeMeshes?.length ?? null,
    };
  }

  /** Read-only snapshot of what a region currently renders with. Used by tests and diagnostics. */
  inspectRegion(region: RegionId) {
    const meshes = this.regionMeshes.get(region) ?? [];
    const names = new Set(meshes.map((m) => m.material?.name ?? "none"));
    const mat = meshes[0]?.material as (PBRMaterial | null | undefined);
    return {
      meshCount: meshes.length,
      materialNames: [...names],
      textureName: mat?.albedoTexture?.name ?? null,
      albedoHex: mat?.albedoColor ? mat.albedoColor.toGammaSpace().toHexString() : null,
      roughness: mat?.roughness ?? null,
    };
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.highlightTimer);
    this.resizeObserver?.disconnect();
    this.materials.dispose();
    this.textures.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
