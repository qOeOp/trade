# Agent Workspace Manager

## Owns

- Per-Agent-Run Git worktrees at one frozen source revision under `tmp/agent-workspaces/<run_id>`, plus an explicitly single-consumer fixed slot under `tmp/agent-workspace-slots/<slot>` for a separately mounted coding Agent.
- A canonical owner-issued execution scope binding one request hash and source revision to exact write prefixes and 1–8 bounded package checks; the Host cannot derive this scope from model prose.
- Optional successor seeding may reconstruct one exact prior Host-generated diff only when that diff ref is bound into the new request; reapplication must reproduce the same cumulative patch hash before the model starts.
- Closed write-prefix policy, bounded deterministic package checks, reviewable patch capture, explicit slot cleanup, and stale-workspace GC candidates.
- Host-owned finalization that rejects an empty patch, failed/timed-out checks, check-induced patch mutation, or artifact-writer hash drift, then emits patch plus JSON quality evidence with no domain authority.
- A container mount projection that exposes only the isolated worktree and an output directory to the Developer job.
- A checked container source mapping may bind an external release revision to the image's deterministic internal Git snapshot without pretending the two commit ids are equal.

## Boundaries

- Does not grant Host, model, research, Replay, Registry, merge, release, deploy, exchange, or production-workspace authority.
- Does not mount or copy `.git` credentials, `.secrets`, owner databases, Docker socket, host home, or the production repository into a Developer container.
- Local worktrees are implementation fixtures, not proof of read isolation: production Developer adoption requires the container mount projection and container fault tests.
- Checks use fixed executable/argument shapes, inherit no provider or exchange credentials, run with Bun auto-install disabled, and return bounded hashed evidence. The server composition executes them in a separate no-network/no-secret/no-owner-data checker; Host-side direct checks remain a local fixture, not server isolation evidence.
- Patch capture rejects files outside the run's frozen write prefixes. Cleanup and GC operate only on validated run or exact fixed-slot paths.
