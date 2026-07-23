# Direct Codex Agent Host Adapter

## Owns

- A thin local adapter from `trade.agent-run-request.v1` to the pinned Codex App Server stable stdio protocol.
- Protocol capability probing, bounded JSONL request correlation, fail-closed server-request handling, task-profile sandbox mapping, and sanitized lifecycle normalization.
- Direct Codex as the attribution baseline for later OpenClaw-managed Codex comparison.

## Boundaries

- Does not copy or own the Codex protocol, model provider, Program cadence, R&D lifecycle, domain validation, workspace manager, MCP capability implementation, or owner stores.
- Never exposes raw reasoning, raw provider payloads, arbitrary App Server methods, production repository writes, live trading, deployment, promotion, or database authority.
- Planner, Reviewer, and explanation use read-only sandbox. Developer requires an externally created isolated workspace and is limited to workspace-write with no network.
- App Server server-initiated requests are denied unless a later reviewed adapter maps one exact operation to an Agent Run approval contract.
