# Trade Flow Contract

## Owns

- Automation cycle planning and job-graph routing
- One-shot program wakeups with a durable ops lease and terminal-cycle idempotency: `shadow_program` enables no domain job and keeps the 30-second ops command bound; `catalog_hygiene_canary` enables only J06 and `full_shadow` enables the fixed J01–J07 graph under a fixed 90-second domain command bound, while every profile permanently denies exchange live writes and real notifications.
- `outcome` reports lease/invocation handling; `business_status` separately reports whether the graph completed, failed, blocked, or was skipped, so an executed wakeup cannot masquerade as a successful graph.
- The foreground supervisor accepts the same three closed-world profiles; J06 can therefore run on a fenced daily interval up to 86,400 seconds without broadening its one-job/write scope, and shared-input parity replays the same captured canary result rather than scanning twice.
- Foreground resident `shadow_program` or `full_shadow` cadence with heartbeat-renewed fenced ownership, stable time-slot cycle ids, asynchronously bounded planning-owner reads and child commands, and drain-on-signal shutdown.
- Bounded SQLite busy handling, explicit stale-lease recovery evidence, and cycle-independent parity projections for Agent/program ticket, processor, and incident comparison.
- Opt-in resident Agent/program parity observation: each eligible program cycle samples owner commands once, independently builds the legacy Agent shadow graph by replaying those exact results, compares canonical projections, and records immutable evidence in the existing ops store.
- macOS launchd rendering/install lifecycle with restart ownership outside the runtime and no PID file; installation fails closed for protected Desktop/Documents/Downloads source paths unless the operator confirms the OS privacy grant.
- Closed-world no-live server profile validation and deterministic Linux systemd unit rendering; rendering writes only repository `tmp/`, never installs or starts units, and exposes no arbitrary command/environment surface.
- Linux container foreground composition over the same closed-world profile: dependency-ordered owner readiness, reverse signal drain, group failure on any unexpected top-level component exit, and owner-level aggregate health without live-write authority.
- Read-only server preflight/status aggregation over fixed owner health, cross-owner L2 epoch identity, fenced control lease, and systemd unit state; unavailable process-manager state degrades rather than inventing readiness.
- Bounded synthetic process-manager lifecycle fixture proving dependency-gated start order, consumer restart isolation, reverse drain, and no surviving managed child without touching real runtime owners or systemd.
- Read-only bounded public-market smoke requires two distinct healthy control cycles with stable L2 epoch/fenced lease and no new comparable parity mismatch; real systemd fault injection remains an explicit server gate.
- Synthetic recovery closure rehearses SQLite `VACUUM INTO`, raw/artifact/profile hashing, restore integrity, and durable ref resolution without copying or mutating active owner data; real volume recovery remains a server gate.
- Suite CLI parameter, response, permission, and owner-handoff semantics
- Thin observe, execution, recovery, and runtime façades
- Executable job dependencies and business-result policies: unresolved account reconciliation blocks dependent fast/new-risk stages even when the owner command exits successfully.
- Exact per-job runtime-health dependencies, including service-owner and resident-consumer L2 readiness: only jobs declaring `required_health_checks` are blocked by a failed check; reconciliation remains an explicit defense bypass.
- Lifecycle processor DB arguments are resolved relative to each registered tool cwd while retaining one repository-owned ops store.

## Delegates

- `trade.db` event ownership and flow projections to `modules/portfolio-execution-state/*`
- Observe building and market/account projection to `modules/live-decision-planning/*`
- Dry-run, shadow, live-small, execution recording, reconcile, and recovery behavior to `modules/live-execution-control/*`
- Strategy R&D, replay, panel, benchmark, and RD memory work to atomic `modules/research-strategy-development/*` tools
- Strategy evidence, review, and promotion gates to `modules/governance-review-compliance/strategy-review`
- Artifact catalog, query, stale scan, and GC work to `modules/artifact-knowledge/artifact-catalog`
- Exchange private account/order reads and authorized writes to `modules/exchange-gateway/*` tools
- Market data reads to `modules/market-data-products/*` tools
- Deterministic hard guards to `modules/live-execution-control/plan-preflight`
- Runtime check semantics to `modules/orchestration-ops/runtime-health-guard`; trade-flow consumes only named check status and never reimplements L2 health.
- Program shadow wakeups reuse the existing job graph and ops store; they do not establish a second scheduler, job catalog, or incident authority.
- The J06 canary reuses the registered artifact-catalog owner command, forces exactly `catalog_hygiene_scan`, and cannot select GC, `--yes`, arbitrary roots, another job, or a broader write surface.
- The full-shadow profile forces all seven cadence gates but preserves each job's owner-defined active/work checks and write scope; it cannot select another job, pass arbitrary commands, enable live exchange writes, or emit real notifications.
- Runtime parity tests implementation semantics under shared captured owner results; sequential reads of changing live health are retained as legacy observations but are not comparable-input evidence.
- Automation planning uses the registered flow-projector owner port through a bounded asynchronous child; a blocked owner read fails the cycle instead of trapping the supervisor in synchronous process wait.
- The resident supervisor delegates restart/backoff and OS process lifetime to an external process manager; the container composition only owns its exact foreground children and delegates group restart to Docker, with no PID file or detached-process authority.
- Bounded migration observation may be hosted by an operator-owned terminal multiplexer when local launchd cannot read a macOS-protected repository path; this is observation evidence, not the production restart contract.

## Forbidden

- Owning Binance endpoint details
- Owning `trade.db` schema, projection, execution, or recovery algorithms
- Owning new R&D experiment logic
- Owning strategy review / promotion implementation
- Owning catalog / GC implementation
- Letting `shadow_program` callers enable domain jobs, or letting any program profile enable live writes, real notifications, arbitrary domain jobs, GC, or weaker L2 owner/consumer health checks.
