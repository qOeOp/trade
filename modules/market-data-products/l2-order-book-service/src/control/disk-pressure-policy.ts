import type { RuntimeState } from "./runtime-contract"

export interface L2DiskPressurePlan {
  action: "run" | "wait"
  reason: "disk_ready" | "disk_hard_limit" | "disk_status_unavailable"
  recheck_delay_ms: number
}

export function planL2DiskPressure(
  status: RuntimeState["disk_status"],
  checkIntervalMs: number,
): L2DiskPressurePlan {
  if (!Number.isSafeInteger(checkIntervalMs) || checkIntervalMs < 1_000 || checkIntervalMs > 3_600_000) {
    throw new Error("disk check interval is invalid")
  }
  if (status === "healthy" || status === "soft_limit") {
    return { action: "run", reason: "disk_ready", recheck_delay_ms: 0 }
  }
  const recheckDelayMs = Math.max(5_000, checkIntervalMs)
  return {
    action: "wait",
    reason: status === "hard_limit" ? "disk_hard_limit" : "disk_status_unavailable",
    recheck_delay_ms: recheckDelayMs,
  }
}
