import { resolve } from "node:path"

export interface ReplayCertificationStep {
  id: string
  cwd: string
  command: readonly string[]
}

export type ReplayCertificationStepRunner = (
  step: ReplayCertificationStep,
  cwd: string,
) => Promise<number>

export const REPLAY_CERTIFICATION_STEPS: readonly ReplayCertificationStep[] = [
  packageCheck("contracts"),
  packageCheck("data-adapter"),
  packageCheck("engine"),
  packageCheck("accounting"),
  packageCheck("metrics"),
  packageCheck("runner"),
  packageCheck("tests"),
  packageCheck("compatibility/legacy-portfolio-cycle", "legacy-portfolio-cycle"),
  packageCheck(
    "certification/legacy-portfolio-cycle-certification",
    "legacy-portfolio-cycle-certification",
  ),
  repoCheck("maturity-gate", "scripts/check-rd-replay-maturity-gate.ts"),
  repoCheck("tool-boundaries", "scripts/check-ts-tool-boundaries.ts"),
]

export async function runReplayCertification(
  repoRoot: string,
  runStep: ReplayCertificationStepRunner = spawnStep,
): Promise<string[]> {
  const completed: string[] = []
  for (const step of REPLAY_CERTIFICATION_STEPS) {
    const exitCode = await runStep(step, resolve(repoRoot, step.cwd))
    if (exitCode !== 0) {
      throw new Error(`Replay certification failed at ${step.id} (exit ${exitCode})`)
    }
    completed.push(step.id)
  }
  return completed
}

async function spawnStep(step: ReplayCertificationStep, cwd: string): Promise<number> {
  const child = Bun.spawn([...step.command], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return child.exited
}

function packageCheck(path: string, id = path): ReplayCertificationStep {
  return {
    id,
    cwd: `modules/research-strategy-development/replay-execution-plane/${path}`,
    command: ["bun", "run", "check"],
  }
}

function repoCheck(id: string, script: string): ReplayCertificationStep {
  return { id, cwd: ".", command: ["bun", script] }
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, "../../../../../..")
  try {
    const completed = await runReplayCertification(repoRoot)
    console.log(`Replay certification passed: ${completed.join(", ")}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
