import { readFileSync } from "node:fs"
import { errorResponse, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { runModelTask } from "./model-gateway"

export async function runModelGatewayCli(argv: string[], printHelp: () => void): Promise<Record<string, unknown>> {
  try {
    const profileIndex = argv.indexOf("--profile")
    if (profileIndex < 0 || !argv[profileIndex + 1]) throw new Error("--profile is required")
    const profilePath = argv[profileIndex + 1]
    if (profilePath !== "profile/model-gateway.json") throw new Error("--profile must be profile/model-gateway.json")
    const requestArgs = [...argv.slice(0, profileIndex), ...argv.slice(profileIndex + 2)]
    const request = readJsonObjectFlag(requestArgs, printHelp)
    const profile = JSON.parse(readFileSync(resolveRepoPath(profilePath), "utf8"))
    return successResponse("model-gateway.result.v1", await runModelTask(request, profile))
  } catch (error) {
    return errorResponse("model-gateway.result.v1", error)
  }
}
