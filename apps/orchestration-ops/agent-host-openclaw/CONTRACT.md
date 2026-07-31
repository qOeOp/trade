# OpenClaw Agent Host Adapter Contract

## Responsibility

- Execute one provider-neutral Agent Run through an explicitly selected OpenClaw Gateway agent and session.
- Use the Agent Run id as OpenClaw idempotency/session identity and persist normalized lifecycle in the ops-owned registry.
- Distinguish Gateway execution from OpenClaw embedded fallback; embedded fallback is a named alternate profile and is never silently counted as Gateway evidence.
- Re-read instruction and input refs from the content-addressed Agent Artifact Store, digest-check them, and wrap them in one canonical untrusted-data envelope before execution.
- Require exactly one JSON object on success and canonicalize it into the immutable Agent Artifact Store before closing the Run. A single `json` Markdown fence with no surrounding prose is treated only as a presentation wrapper and deterministically removed; prose-plus-JSON and multiple payloads still fail closed.
- The server adapter calls the Gateway's private OpenResponses endpoint with an explicit Agent id and Run-scoped session key; response bodies and bearer credentials are not retained.
- Its bearer-authenticated Agent Run HTTP surface is private-network only; Program callers receive normalized acceptance, status, events, cancellation, and terminal results, never provider credentials or raw Gateway payloads.
- A distinct `openclaw-workspace-gateway` profile serializes Developer code runs through one fixed mounted worktree slot. Its model can only read/write/edit/apply-patch inside that slot; the Host ignores completion prose, captures the cumulative diff, delegates package checks to the no-network checker, stores typed submission + patch + check refs, then cleans the slot after the durable Result.
- Accepted-but-not-started runs may resume after Host restart. An interrupted started Developer effect still closes as `tool_effect_uncertain`; profile-scoped recovery cannot consume semantic Gateway runs.

## Boundaries

- The adapter does not own Program cadence, R&D state, MCP tools, workspace scope, provider credentials, OpenClaw state, strategy materialization, promotion, deployment, or trading.
- Prompts use a mode-`600` temporary message file and are removed after the CLI exits; prompt, stderr, transcript, reasoning, credentials, and raw OpenClaw responses are not persisted.
- Planner and Reviewer are proposal-only. Semantic Developer remains owner-tool-only; code Developer requires an immutable owner-issued scope and separately isolated workspace/checker.
- The server code Host mounts only the ops store, Agent artifacts, checker control socket, and its candidate-workspace volume. It does not mount Trade/R&D/Catalog DBs, exchange credentials, Docker socket, provider key, or production checkout.
- OpenClaw CLI/Gateway version and container image are external pinned dependencies. A result from an unexpected transport, multiple visible payloads, malformed JSON, timeout, or output-budget breach fails closed.
