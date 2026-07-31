# Direct Codex Agent Host Adapter

## Owns

- A thin local adapter from `trade.agent-run-request.v1` to the pinned Codex App Server stable stdio protocol.
- Protocol capability probing, bounded JSONL request correlation, fail-closed server-request handling, task-profile sandbox mapping, and sanitized lifecycle normalization.
- Implement the provider-neutral Host port over the ops-owned durable registry: submit, events, status, bounded steer, deny-only approval, cancel/interrupt, and terminal result.
- Persist no raw prompts or responses. A completed final message is handed to exactly one external artifact strategy; Developer may return multiple Host-derived submission/patch/check refs under the same output budget. Interrupted Developer effects become `tool_effect_uncertain` rather than being replayed.
- Proactively close durable interrupted runs on daemon startup; output finalization failure is a terminal validation failure, and post-terminal cleanup runs only after the Result is durable.
- Compose Direct Codex with the artifact store and workspace manager only through an owner-issued, request-hash-bound execution scope. The composition ignores the model's completion prose as evidence, derives submission/patch/check refs after the turn, and removes the worktree only after durable completion.
- A successor Run may seed only a prior content-addressed diff that is also an immutable input ref; the Host reproduces its exact cumulative patch before starting Codex.
- Direct Codex as the attribution baseline for later OpenClaw-managed Codex comparison.

## Boundaries

- Does not copy or own the Codex protocol, model provider, Program cadence, R&D lifecycle, domain validation, workspace manager, MCP capability implementation, or owner stores.
- Never exposes raw reasoning, raw provider payloads, arbitrary App Server methods, production repository writes, live trading, deployment, promotion, or database authority.
- Planner, Reviewer, and explanation use read-only sandbox. Developer requires an externally created isolated workspace and is limited to workspace-write with no network.
- App Server server-initiated requests are denied unless a later reviewed adapter maps one exact operation to an Agent Run approval contract.
- The adapter does not own workspace creation, patch admission, artifact storage, or run scheduling. App Server process restart cannot infer a prior effect; recovery therefore closes uncertain runs and leaves retry policy to Program.
