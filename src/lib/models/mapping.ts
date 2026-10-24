import { REGION_IDS, type RegionId } from "./regions";
import type { RegionMappingRule } from "./types";

export interface MeshDescriptor {
  name: string;
  materialName?: string;
}

export interface MappingResult<T extends MeshDescriptor> {
  byRegion: Map<RegionId, T[]>;
  regionOf: Map<T, RegionId>;
  unmapped: T[];
  /** Regions declared by the model whose rules matched no mesh (likely a naming mismatch). */
  emptyRegions: RegionId[];
}

function compile(rule: RegionMappingRule) {
  const names = new Set(rule.meshNames ?? []);
  const patterns = (rule.meshNamePatterns ?? []).map((p) => new RegExp(p, "i"));
  const materials = new Set((rule.materialNames ?? []).map((m) => m.toLowerCase()));
  return (m: MeshDescriptor) =>
    names.has(m.name) ||
    patterns.some((re) => re.test(m.name)) ||
    (m.materialName !== undefined && materials.has(m.materialName.toLowerCase()));
}

/**
 * Assigns meshes to logical regions using a model's mapping rules.
 * A mesh belongs to the first region (in REGION_IDS order) whose rule matches; meshes that
 * match nothing stay unmapped and keep their original material.
 */
export function mapMeshesToRegions<T extends MeshDescriptor>(
  meshes: T[],
  rules: Partial<Record<RegionId, RegionMappingRule>>,
): MappingResult<T> {
  const byRegion = new Map<RegionId, T[]>();
  const regionOf = new Map<T, RegionId>();
  const matchers = REGION_IDS.filter((r) => rules[r]).map((r) => [r, compile(rules[r]!)] as const);
  const unmapped: T[] = [];
  for (const mesh of meshes) {
    const hit = matchers.find(([, match]) => match(mesh));
    if (!hit) {
      unmapped.push(mesh);
      continue;
    }
    const [region] = hit;
    regionOf.set(mesh, region);
    byRegion.set(region, [...(byRegion.get(region) ?? []), mesh]);
  }
  const emptyRegions = matchers.map(([r]) => r).filter((r) => !byRegion.has(r));
  return { byRegion, regionOf, unmapped, emptyRegions };
}

/** Builds an exact-name mapping (as produced by the admin model inspector) for export. */
export function buildExplicitMapping(
  assignments: Record<string, RegionId | "">,
  options: Pick<RegionMappingRule, "uvMode" | "grainAxis"> = {},
): Partial<Record<RegionId, RegionMappingRule>> {
  const out: Partial<Record<RegionId, RegionMappingRule>> = {};
  for (const [meshName, region] of Object.entries(assignments)) {
    if (!region) continue;
    const rule = (out[region] ??= { meshNames: [], ...options });
    rule.meshNames = [...(rule.meshNames ?? []), meshName].sort();
  }
  return out;
}
