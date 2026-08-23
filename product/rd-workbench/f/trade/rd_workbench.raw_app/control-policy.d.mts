import type { VerifiedS1ConsumerContextV1 } from "../product_edge/consumer_projection_v1.ts"

export type ActionControls = {
  canSubmit: boolean
  canResolve: boolean
  canCreateSuccessor: boolean
}

export type ArtifactActionControls = {
  canRun: boolean
  canResolve: boolean
  canCreateSuccessor: boolean
}

export function actionControls(result: unknown, requestIdentity: string): ActionControls
export function artifactBoundToS1Context(result: unknown, s1Context: unknown): boolean
export function artifactContextCurrentAt(result: unknown, s1Context: unknown, nowEpochMs: number): boolean
export function artifactActionControls(result: unknown, buildRequestIdentity: string, attemptIdentity: string, s1Context: unknown, nowEpochMs: number): ArtifactActionControls
export function artifactInvocationAdmission(input: {
  action: "RUN" | "RESOLVE"
  artifactResult: unknown | null
  buildRequestIdentity: string
  attemptIdentity: string
  liveS1Context: VerifiedS1ConsumerContextV1 | null
  frozenS1Context: VerifiedS1ConsumerContextV1 | null
  researchViewAvailable: boolean
  freshIdentityGenerated: boolean
  canResolveImportedArtifact: boolean
  nowEpochMs: number
}): {
  canInvoke: boolean
  context: VerifiedS1ConsumerContextV1 | null
  recovery: boolean
}
export function researchAvailableAt(result: unknown, s1Context: unknown, nowEpochMs: number): boolean
export function artifactAvailableAt(result: unknown, s1Context: unknown, nowEpochMs: number): boolean
export function resolveCurrentResearchThenRunArtifact(input: {
  requestIdentity: string
  intentIdentity: string
  artifactResult: unknown
  buildRequestIdentity: string
  attemptIdentity: string
  resolveResearch: () => Promise<unknown>
  projectResearch: (result: unknown, requestIdentity: string) => unknown
  runArtifact: () => Promise<unknown>
}): Promise<{
  research: unknown | null
  artifact: unknown | null
  artifactBackendStarted: boolean
  error: unknown | null
}>
