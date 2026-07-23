import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  findToolsetEntry,
  resolveOwnerToolCommand,
  type ResolvedOwnerToolCommand,
  type ToolsetManifest,
} from "../../protocol-fabric/src/protocol-fabric"
import { repoRoot } from "./paths"

let cachedManifest: ToolsetManifest | undefined

function resolveRegisteredOwnerTool(
  toolId: string,
  args: string[],
  ownerRepoRoot: string = repoRoot(),
): ResolvedOwnerToolCommand {
  return resolveOwnerToolCommand({
    tool: findToolsetEntry(readToolsetManifest(), toolId),
    repoRoot: ownerRepoRoot,
    args,
  })
}

function readToolsetManifest(): ToolsetManifest {
  if (!cachedManifest) {
    cachedManifest = JSON.parse(readFileSync(join(repoRoot(), "toolset.json"), "utf8")) as ToolsetManifest
  }
  return cachedManifest
}

export {
  resolveRegisteredOwnerTool,
}
