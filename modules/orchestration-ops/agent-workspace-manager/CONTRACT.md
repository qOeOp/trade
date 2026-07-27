# Agent Workspace Manager

## Owns

- Per-Agent-Run Git worktrees at one frozen source revision under `tmp/agent-workspaces/<run_id>`, plus an explicitly single-consumer fixed slot under `tmp/agent-workspace-slots/<slot>` for a separately mounted coding Agent.
- A canonical owner-issued execution scope binding one request hash and source revision to exact write prefixes and 1–8 bounded package checks; the Host cannot derive this scope from model prose.
- Optional successor seeding may reconstruct one exact prior Host-generated diff only when that diff ref is bound into the new request; reapplication must reproduce the same cumulative patch hash before the model starts.
- Closed write-prefix policy, bounded deterministic package checks, reviewable patch capture, explicit slot cleanup, and stale-workspace GC candidates.
- Host-owned finalization that rejects an empty patch, failed/timed-out checks, check-induced patch mutation, or artifact-writer hash drift, then emits patch plus JSON quality evidence with no domain authority.
- Candidate adoption may reconstruct that exact cumulative patch in a separate fixed slot and ask the isolated checker to run package checks, repository quality, and the independent Replay release audit. The checker returns only bounded hashes/exit metadata; passing it certifies a source candidate, not a deployment.
- GitHub lifecycle worktrees outside the managed run/slot roots may be removed only through the immutable, owner-receipted `worktree-cleanup.ts` operation. It binds an admitted generation, exact HEAD and nullable ref, preserves ambiguity, and removes non-force without widening the manager's run/slot GC.
- A container mount projection that exposes only the isolated worktree and an output directory to the Developer job.
- A checked container source mapping may bind an external release revision to the image's deterministic internal Git snapshot without pretending the two commit ids are equal.

## Boundaries

- Does not grant Host, model, research, Replay, Registry, merge, release, deploy, exchange, or production-workspace authority.
- Does not mount or copy `.git` credentials, `.secrets`, owner databases, Docker socket, host home, or the production repository into a Developer container.
- Local worktrees are implementation fixtures, not proof of read isolation: production Developer adoption requires the container mount projection and container fault tests.
- Checks use fixed executable/argument shapes, inherit no provider or exchange credentials, run with Bun auto-install disabled, and return bounded hashed evidence. The server composition uses separate no-network/no-secret/no-owner-data package and release checker processes; Host-side direct checks remain a local fixture, not server isolation evidence.
- Patch capture rejects files outside the run's frozen write prefixes. Run cleanup and GC operate only on validated run or exact fixed-slot paths; the separate GitHub lifecycle operation accepts only its exact admitted worktree identity.
