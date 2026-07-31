import { Database } from "bun:sqlite"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import {
  ensureOpsRuntimeSchema,
  readIncidents,
  readJobRuns,
  readNotifyAttempts,
  recordControlReview,
  type ControlReview,
  type Incident,
  type JobRun,
  type NotifyAttempt,
} from "../../../ops-runtime-store/src/lib/ops-runtime-store"

export type ImprovementCategory = "code" | "architecture" | "process" | "runtime"
export type ImprovementSeverity = "low" | "medium" | "high" | "critical"

export interface ControlImprovementItem extends JSONRecord {
  item_id: string
  category: ImprovementCategory
  severity: ImprovementSeverity
  problem: string
  suspected_owner: string
  recommendation: string
  source_refs: string[]
  next_cycle_constraint?: JSONRecord
}

export interface ControlEffectivenessReviewResult extends JSONRecord {
  ok: boolean
  processor_id: "control_effectiveness_review"
  lifecycle_phase: "post_cycle"
  review: ControlReview
  items: ControlImprovementItem[]
  next_cycle_constraints: JSONRecord[]
  refs: string[]
}

export function runControlEffectivenessReview(db: Database, input: JSONRecord = {}): ControlEffectivenessReviewResult {
  ensureOpsRuntimeSchema(db)
  const now = stringField(input.now) || new Date().toISOString()
  const cycleId = stringField(input.cycle_id) || undefined
  const repeatedThreshold = positiveNumber(input.repeated_threshold) || 2
  const ackStaleHours = positiveNumber(input.ack_stale_hours) || 24
  const incidents = readIncidents(db, cycleId ? { cycle_id: cycleId } : {})
  const jobs = readJobRuns(db, cycleId ? { cycle_id: cycleId } : {})
  const notifyAttempts = readNotifyAttempts(db, cycleId ? { cycle_id: cycleId } : {})
  const items = [
    ...criticalIncidentItems(incidents),
    ...staleAcknowledgedIncidentItems(incidents, now, ackStaleHours),
    ...repeatedIncidentItems(incidents, repeatedThreshold),
    ...repeatedJobFailureItems(jobs, repeatedThreshold),
    ...notifyFailureItems(notifyAttempts),
  ]
  const dedupedItems = dedupeItems(items)
  const constraints = dedupedItems.map((item) => asRecord(item.next_cycle_constraint)).filter((constraint) => Object.keys(constraint).length > 0)
  const review: ControlReview = {
    review_id: stringField(input.review_id) || `control-review-${cycleId || "all"}-${now.replace(/[^A-Za-z0-9_-]/g, "")}`,
    cycle_id: cycleId,
    status: dedupedItems.length > 0 ? "needs_attention" : "ok",
    summary_json: {
      cycle_id: cycleId,
      generated_at: now,
      incidents: incidents.length,
      jobs: jobs.length,
      notify_attempts: notifyAttempts.length,
      improvement_items: dedupedItems.length,
    },
    items_json: dedupedItems,
    constraints_json: constraints,
    created_at: now,
  }
  recordControlReview(db, review)
  return {
    ok: true,
    processor_id: "control_effectiveness_review",
    lifecycle_phase: "post_cycle",
    review,
    items: dedupedItems,
    next_cycle_constraints: constraints,
    refs: [`ops_runtime_store:control_review/${review.review_id}`],
  }
}

function criticalIncidentItems(incidents: Incident[]): ControlImprovementItem[] {
  return incidents
    .filter((incident) => incident.severity === "critical" && (incident.status === "open" || incident.status === "acknowledged"))
    .map((incident) => ({
      item_id: `control-item-critical-${incident.incident_id}`,
      category: categoryForIncident(incident),
      severity: "critical",
      problem: `critical incident still active: ${incident.title}`,
      suspected_owner: ownerForIncident(incident),
      recommendation: "Resolve the underlying system failure or explicitly ignore it with operator rationale before trusting the next cycle.",
      source_refs: incidentRefs(incident),
      next_cycle_constraint: {
        type: "require_incident_resolution",
        incident_id: incident.incident_id,
        severity: incident.severity,
      },
    }))
}

function staleAcknowledgedIncidentItems(incidents: Incident[], now: string, staleHours: number): ControlImprovementItem[] {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) {
    return []
  }
  return incidents
    .filter((incident) => incident.status === "acknowledged")
    .filter((incident) => {
      const lastSeenMs = Date.parse(incident.last_seen_at)
      return Number.isFinite(lastSeenMs) && nowMs - lastSeenMs >= staleHours * 60 * 60 * 1000
    })
    .map((incident) => ({
      item_id: `control-item-stale-ack-${incident.incident_id}`,
      category: "process",
      severity: incident.severity === "critical" ? "high" : "medium",
      problem: `acknowledged incident has not been resolved: ${incident.title}`,
      suspected_owner: ownerForIncident(incident),
      recommendation: "Either resolve the incident with evidence, ignore it with rationale, or reopen the operational investigation.",
      source_refs: incidentRefs(incident),
      next_cycle_constraint: {
        type: "operator_follow_up_required",
        incident_id: incident.incident_id,
      },
    }))
}

function repeatedIncidentItems(incidents: Incident[], threshold: number): ControlImprovementItem[] {
  const groups = groupBy(incidents, (incident) => `${incident.source}:${incident.title}`)
  return Object.entries(groups)
    .filter(([, group]) => group.length >= threshold)
    .map(([key, group]) => {
      const first = group[0]
      return {
        item_id: `control-item-repeated-incident-${stableId(key)}`,
        category: categoryForIncident(first),
        severity: group.some((incident) => incident.severity === "critical") ? "high" : "medium",
        problem: `repeated incident pattern: ${first.source} / ${first.title}`,
        suspected_owner: ownerForIncident(first),
        recommendation: "Fix the repeated root cause in code, config, contract, or runbook instead of handling each occurrence manually.",
        source_refs: group.map((incident) => `ops_runtime_store:incident/${incident.incident_id}`),
        next_cycle_constraint: {
          type: "repeated_incident_guard",
          source: first.source,
          title: first.title,
          count: group.length,
        },
      }
    })
}

function repeatedJobFailureItems(jobs: JobRun[], threshold: number): ControlImprovementItem[] {
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "blocked")
  const groups = groupBy(failed, (job) => job.job_id)
  return Object.entries(groups)
    .filter(([, group]) => group.length >= threshold)
    .map(([jobId, group]) => ({
      item_id: `control-item-repeated-job-${stableId(jobId)}`,
      category: "code",
      severity: group.some((job) => job.status === "failed") ? "high" : "medium",
      problem: `job repeatedly ${group.some((job) => job.status === "failed") ? "failed" : "blocked"}: ${jobId}`,
      suspected_owner: group[0].target_domain,
      recommendation: "Review the job adapter, input refs, command contract, and write-scope assumptions before allowing repeated dispatch.",
      source_refs: group.map((job) => `ops_runtime_store:job_run/${job.job_run_id}`),
      next_cycle_constraint: {
        type: "review_repeated_job_before_dispatch",
        job_id: jobId,
        count: group.length,
      },
    }))
}

function notifyFailureItems(attempts: NotifyAttempt[]): ControlImprovementItem[] {
  return attempts
    .filter((attempt) => attempt.status === "failed")
    .map((attempt) => ({
      item_id: `control-item-notify-${attempt.notify_id}`,
      category: "process",
      severity: "medium",
      problem: `ops notification failed on channel: ${attempt.channel}`,
      suspected_owner: "orchestration-ops/ops-notify-dispatch",
      recommendation: "Fix or disable the notification channel so human takeover signals are not silently missed.",
      source_refs: [`ops_runtime_store:notify_attempt/${attempt.notify_id}`],
      next_cycle_constraint: {
        type: "verify_notify_channel",
        channel: attempt.channel,
      },
    }))
}

function ownerForIncident(incident: Incident): string {
  if (incident.source === "domain_bus") {
    return "protocol-fabric/domain-bus"
  }
  if (incident.source === "job_run") {
    return stringField(incident.detail_json?.target_domain) || stringField(incident.detail_json?.job_id) || "domain-job-owner"
  }
  if (incident.source === "lifecycle_processor" || incident.source === "post_processor" || incident.source === "runtime_health") {
    return "orchestration-ops"
  }
  return "operator-process"
}

function categoryForIncident(incident: Incident): ImprovementCategory {
  if (incident.source === "domain_bus") {
    return "architecture"
  }
  if (incident.source === "job_run") {
    return "code"
  }
  if (incident.source === "manual") {
    return "process"
  }
  return "runtime"
}

function incidentRefs(incident: Incident): string[] {
  return [`ops_runtime_store:incident/${incident.incident_id}`, ...(incident.refs_json ?? [])]
}

function dedupeItems(items: ControlImprovementItem[]): ControlImprovementItem[] {
  const seen = new Set<string>()
  const result: ControlImprovementItem[] = []
  for (const item of items) {
    if (seen.has(item.item_id)) {
      continue
    }
    seen.add(item.item_id)
    result.push(item)
  }
  return result
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {}
  for (const item of items) {
    const key = keyOf(item)
    groups[key] = groups[key] ?? []
    groups[key].push(item)
  }
  return groups
}

function stableId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"
}

function positiveNumber(value: unknown): number {
  const number = numberField(value)
  return number > 0 ? number : 0
}
