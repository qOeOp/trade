import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { Database } from "bun:sqlite"
import {
  createServerContainerSourcePackageFromArchive,
} from "../../modules/orchestration-ops/trade-flow/src/scripts/lib/server-runtime-container-release-package"
import {
  readAgentPatchAdoption,
} from "../../modules/orchestration-ops/ops-runtime-store/src/lib/agent-patch-adoption-store"
import {
  readCertifiedDeveloperPatchAdoption,
} from "./rd-developer-patch-adoption"

export function createDeveloperCandidateServerPackage(input: {
  db: Database
  repository_root: string
  adoption_id: string
  target_root: string
  created_at?: string
}): Record<string, unknown> {
  const root = realpathSync(resolve(input.repository_root))
  const record = readAgentPatchAdoption(input.db, input.adoption_id)
  if (!record?.result || record.status !== "candidate_certified") {
    throw new Error("Developer patch adoption is not candidate-certified")
  }
  const certified = readCertifiedDeveloperPatchAdoption(root, record.result)
  const packaged = createServerContainerSourcePackageFromArchive({
    repository_root: root,
    target_root: input.target_root,
    source_archive_path: resolve(
      root,
      certified.manifest.source_archive.ref,
    ),
    source_archive_sha256: certified.manifest.source_archive.sha256,
    source_commit: certified.candidate_source_revision,
    source_origin_manifest_path: resolve(
      root,
      certified.manifest_ref,
    ),
    source_origin: {
      kind: "certified_agent_patch_candidate",
      manifest_ref: certified.manifest_ref,
      manifest_sha256: certified.manifest_sha256,
    },
    ...(input.created_at == null ? {} : { created_at: input.created_at }),
  })
  return {
    schema_version:
      "trade.rd-developer-candidate-server-package-result.v1",
    adoption_id: record.adoption_id,
    candidate_source_revision: certified.candidate_source_revision,
    ...packaged,
    deployment_authority: "none",
    trading_authority: false,
  }
}
