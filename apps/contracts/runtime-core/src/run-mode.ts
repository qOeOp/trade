export const RUN_MODES = ["dry-run", "shadow"] as const
export type RunMode = typeof RUN_MODES[number]
