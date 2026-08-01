import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { Database } from "bun:sqlite"
import {
  createServerContainerSourcePackageFromArchive,
} from "../../../trade-flow/src/scripts/lib/server-runtime-container-release-package"
import {
  readStrategySourceAdoption,
} from "../../../ops-runtime-store/src/lib/strategy-source-adoption-store"
export function createStrategyCandidateServerPackage(input: {
  db: Database
  repository_root: string
  adoption_id: string
  target_root: string
  created_at?: string
}): Record<string, unknown> {
  const root = realpathSync(resolve(input.repository_root))
  const record = readStrategySourceAdoption(input.db, input.adoption_id)
  if (!record?.result || record.status !== "candidate_certified") {
    throw new Error("Strategy source adoption is not candidate-certified")
  }
  const manifestPath = resolve(root, record.result.certified_manifest_ref)
  return {
    schema_version: "trade.rd-strategy-candidate-server-package-result.v1",
    adoption_id: record.adoption_id,
    candidate_source_revision: record.result.candidate_source_revision,
    ...createServerContainerSourcePackageFromArchive({
      repository_root: root,
      target_root: input.target_root,
      source_archive_path: resolve(root, record.result.source_archive_ref),
      source_archive_sha256: record.result.source_archive_hash,
      source_commit: record.result.candidate_source_revision,
      source_origin_manifest_path: manifestPath,
      source_origin: {
        kind: "certified_strategy_source_candidate",
        manifest_ref: record.result.certified_manifest_ref,
        manifest_sha256: record.result.certified_manifest_hash,
      },
      ...(input.created_at == null ? {} : { created_at: input.created_at }),
    }),
    deployment_authority: "none",
    trading_authority: false,
  }
}
