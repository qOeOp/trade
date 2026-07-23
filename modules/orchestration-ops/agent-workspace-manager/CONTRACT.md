# Agent Workspace Manager

## Owns

- Per-Agent-Run Git worktrees at one frozen source revision under `tmp/agent-workspaces/<run_id>`.
- Closed write-prefix policy, bounded deterministic package checks, reviewable patch capture, explicit cleanup, and stale-workspace GC candidates.
- A container mount projection that exposes only the isolated worktree and an output directory to the Developer job.

## Boundaries

- Does not grant Host, model, research, Replay, Registry, merge, release, deploy, exchange, or production-workspace authority.
- Does not mount or copy `.git` credentials, `.secrets`, owner databases, Docker socket, host home, or the production repository into a Developer container.
- Local worktrees are implementation fixtures, not proof of read isolation: production Developer adoption requires the container mount projection and container fault tests.
- Checks use fixed executable/argument shapes, inherit no provider or exchange credentials, run with Bun auto-install disabled, and return bounded hashed evidence.
- Patch capture rejects files outside the run's frozen write prefixes. Cleanup and GC operate only on validated `tmp/agent-workspaces/<run_id>` paths.
