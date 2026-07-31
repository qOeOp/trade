import type { Database } from "bun:sqlite"
import {
  admitAgentPatchAdoption,
  readAgentPatchAdoption,
} from "../../apps/orchestration-ops/ops-runtime-store/src/lib/agent-patch-adoption-store"
import {
  readAgentRun,
} from "../../apps/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"

export interface PatchReadyDeveloperCycleProjection {
  run_id: string
  request_hash: string
  result_hash: string
  scope_hash: string | null
  admission: {
    status: string
  }
}

export function queueDeveloperPatchAdoption(
  opsDb: Database,
  result: PatchReadyDeveloperCycleProjection,
  acceptedAt = new Date().toISOString(),
): { adoption_id: string; status: string } {
  if (result.admission.status !== "patch_ready" || !result.scope_hash) {
    throw new Error("Developer patch adoption requires a patch-ready scoped Run")
  }
  const run = readAgentRun(opsDb, result.run_id)
  if (!run?.result
    || run.request.request_hash !== result.request_hash
    || run.result.result_hash !== result.result_hash) {
    throw new Error("Patch-ready Developer Run is absent from Ops")
  }
  const patches = run.result.output_refs.filter(
    (ref) => ref.media_type === "text/x-diff",
  )
  if (patches.length !== 1) {
    throw new Error("Patch-ready Developer Run has ambiguous patch evidence")
  }
  const adoptionId = `${result.run_id}:candidate`
  const existing = readAgentPatchAdoption(opsDb, adoptionId)
  const record = admitAgentPatchAdoption(opsDb, {
    adoption_id: adoptionId,
    run_id: result.run_id,
    request_hash: result.request_hash,
    scope_hash: result.scope_hash,
    patch: patches[0]!,
    accepted_at: existing?.accepted_at ?? acceptedAt,
  })
  return {
    adoption_id: record.adoption_id,
    status: record.status,
  }
}
