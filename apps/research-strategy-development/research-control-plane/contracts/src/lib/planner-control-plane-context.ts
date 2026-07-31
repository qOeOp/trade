import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"

export const PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION =
  "trade.rd-planner-control-plane-context-snapshot.v1" as const

export const canonicalPlannerControlPlaneHash = canonicalControlPlaneHash

export type PlannerCoverageStatus = "missing" | "partial" | "ready" | "blocked" | "out_of_scope"

export interface PlannerUniverseCoverage {
  coverage_type: "data" | "family" | "replay" | "panel" | "forward" | "governance"
  scope_ref: string
  coverage_status: PlannerCoverageStatus
}

export interface PlannerCanonicalDataSurfaceRequirement {
  surface_id: string
  requirement_type: "required" | "optional" | "enhancement"
  coverage_status: PlannerCoverageStatus
}

export interface PlannerActiveCanonical {
  node_id: string
  path: string
  name: string
  research_scope_status: "active"
  implementation_scope_status: "ready" | "backlog" | "data_blocked" | "tool_blocked"
  coverage: PlannerUniverseCoverage[]
  data_surface_requirements: PlannerCanonicalDataSurfaceRequirement[]
}

export interface PlannerDataSurface {
  surface_id: string
  slug: string
  coverage_status: PlannerCoverageStatus
  owner_module: string | null
  evidence_ref: string | null
}

export interface PlannerCapability {
  item_id: string
  registry_type: "feature" | "forecast_model" | "portfolio" | "risk_rule" | "execution_rule"
  slug: string
  version: string
  status: "active" | "experimental"
  owner_module: string | null
  capability_tags: string[]
}

export interface PlannerLessonRef {
  kg_node_id: string
  ref_id: string | null
  slug: string
  name: string
  metadata: JSONRecord | null
  updated_at: string
}

export interface PlannerControlPlaneContextSnapshotBody extends JSONRecord {
  schema_version: typeof PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION
  active_canonicals: PlannerActiveCanonical[]
  data_surfaces: PlannerDataSurface[]
  capabilities: PlannerCapability[]
  lessons: PlannerLessonRef[]
}

export interface PlannerControlPlaneContextSnapshot extends PlannerControlPlaneContextSnapshotBody {
  context_hash: string
}

export function createPlannerControlPlaneContextSnapshot(
  input: PlannerControlPlaneContextSnapshotBody,
): PlannerControlPlaneContextSnapshot {
  if (input.schema_version !== PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("unsupported Planner Control Plane context snapshot schema")
  }
  const body: PlannerControlPlaneContextSnapshotBody = {
    schema_version: PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    active_canonicals: input.active_canonicals.map(normalizeCanonical)
      .sort((left, right) => left.path.localeCompare(right.path) || left.node_id.localeCompare(right.node_id)),
    data_surfaces: input.data_surfaces.map(normalizeDataSurface)
      .sort((left, right) => left.slug.localeCompare(right.slug) || left.surface_id.localeCompare(right.surface_id)),
    capabilities: input.capabilities.map(normalizeCapability)
      .sort((left, right) => left.registry_type.localeCompare(right.registry_type)
        || left.slug.localeCompare(right.slug) || left.version.localeCompare(right.version)),
    lessons: input.lessons.map(normalizeLesson)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at)
        || left.kg_node_id.localeCompare(right.kg_node_id)),
  }
  assertUnique(body.active_canonicals.map((item) => item.node_id), "active canonical node_id")
  assertUnique(body.active_canonicals.map((item) => item.path), "active canonical path")
  assertUnique(body.data_surfaces.map((item) => item.surface_id), "data surface id")
  assertUnique(body.data_surfaces.map((item) => item.slug), "data surface slug")
  assertUnique(body.capabilities.map((item) => item.item_id), "capability item_id")
  assertUnique(body.lessons.map((item) => item.kg_node_id), "lesson kg_node_id")
  return { ...body, context_hash: canonicalControlPlaneHash(body) }
}

export function assertPlannerControlPlaneContextSnapshot(
  value: PlannerControlPlaneContextSnapshot,
): void {
  const { context_hash: _contextHash, ...body } = value
  const expected = createPlannerControlPlaneContextSnapshot(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Planner Control Plane context snapshot is non-canonical or hash-drifted")
  }
}

function normalizeCanonical(value: PlannerActiveCanonical): PlannerActiveCanonical {
  if (value.research_scope_status !== "active") throw new Error("Planner context may contain only active canonicals")
  if (!["ready", "backlog", "data_blocked", "tool_blocked"].includes(value.implementation_scope_status)) {
    throw new Error("Planner context canonical implementation status is unsupported")
  }
  const coverage = value.coverage.map((item) => ({
    coverage_type: enumValue(item.coverage_type, ["data", "family", "replay", "panel", "forward", "governance"], "coverage_type"),
    scope_ref: required(item.scope_ref, "coverage scope_ref"),
    coverage_status: coverageStatus(item.coverage_status),
  })).sort((left, right) => left.coverage_type.localeCompare(right.coverage_type)
    || left.scope_ref.localeCompare(right.scope_ref))
  assertUnique(coverage.map((item) => `${item.coverage_type}\u0000${item.scope_ref}`), "canonical coverage")
  const dataSurfaceRequirements = value.data_surface_requirements.map((item) => ({
    surface_id: required(item.surface_id, "canonical data surface id"),
    requirement_type: enumValue(item.requirement_type, ["required", "optional", "enhancement"], "data surface requirement type"),
    coverage_status: coverageStatus(item.coverage_status),
  })).sort((left, right) => left.surface_id.localeCompare(right.surface_id))
  assertUnique(dataSurfaceRequirements.map((item) => item.surface_id), "canonical data surface requirement")
  return {
    node_id: required(value.node_id, "canonical node_id"),
    path: required(value.path, "canonical path"),
    name: required(value.name, "canonical name"),
    research_scope_status: "active",
    implementation_scope_status: value.implementation_scope_status,
    coverage,
    data_surface_requirements: dataSurfaceRequirements,
  }
}

function normalizeDataSurface(value: PlannerDataSurface): PlannerDataSurface {
  return {
    surface_id: required(value.surface_id, "data surface id"),
    slug: required(value.slug, "data surface slug"),
    coverage_status: coverageStatus(value.coverage_status),
    owner_module: nullableString(value.owner_module),
    evidence_ref: nullableString(value.evidence_ref),
  }
}

function normalizeCapability(value: PlannerCapability): PlannerCapability {
  const capabilityTags = value.capability_tags.map((item) => required(item, "capability tag")).sort()
  assertUnique(capabilityTags, "capability tag")
  return {
    item_id: required(value.item_id, "capability item_id"),
    registry_type: enumValue(value.registry_type, ["feature", "forecast_model", "portfolio", "risk_rule", "execution_rule"], "registry_type"),
    slug: required(value.slug, "capability slug"),
    version: required(value.version, "capability version"),
    status: enumValue(value.status, ["active", "experimental"], "capability status"),
    owner_module: nullableString(value.owner_module),
    capability_tags: capabilityTags,
  }
}

function normalizeLesson(value: PlannerLessonRef): PlannerLessonRef {
  if (!isUtc(value.updated_at)) throw new Error("Planner lesson updated_at must be RFC 3339 UTC")
  if (value.metadata !== null && (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))) {
    throw new Error("Planner lesson metadata must be an object or null")
  }
  return {
    kg_node_id: required(value.kg_node_id, "lesson kg_node_id"),
    ref_id: nullableString(value.ref_id),
    slug: required(value.slug, "lesson slug"),
    name: required(value.name, "lesson name"),
    metadata: value.metadata,
    updated_at: value.updated_at,
  }
}

function coverageStatus(value: string): PlannerCoverageStatus {
  return enumValue(value, ["missing", "partial", "ready", "blocked", "out_of_scope"], "coverage status")
}

function enumValue<const T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${field} is unsupported`)
  return value as T
}

function required(value: string, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function nullableString(value: string | null): string | null {
  if (value === null) return null
  return required(value, "nullable string")
}

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} must be unique`)
}

function isUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
}
