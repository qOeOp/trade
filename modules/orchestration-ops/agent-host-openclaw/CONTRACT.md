# OpenClaw Agent Host Adapter Contract

## Responsibility

- Execute one provider-neutral Agent Run through an explicitly selected OpenClaw Gateway agent and session.
- Use the Agent Run id as OpenClaw idempotency/session identity, persist normalized lifecycle in the ops-owned registry, and store only the final typed text through the shared artifact sink.
- Distinguish Gateway execution from OpenClaw embedded fallback; embedded fallback is a named alternate profile and is never silently counted as Gateway evidence.
- Re-read instruction and input refs from the content-addressed Agent Artifact Store, digest-check them, and wrap them in one canonical untrusted-data envelope before execution.
- Require exactly one JSON object on success and canonicalize it into the immutable Agent Artifact Store before closing the Run.

## Boundaries

- The adapter does not own Program cadence, R&D state, MCP tools, workspace mutation, provider credentials, OpenClaw state, strategy materialization, promotion, deployment, or trading.
- Prompts use a mode-`600` temporary message file and are removed after the CLI exits; prompt, stderr, transcript, reasoning, credentials, and raw OpenClaw responses are not persisted.
- Planner and Reviewer are proposal-only. Developer requires a separately isolated workspace and any ambiguous interrupted effect terminates as `tool_effect_uncertain`.
- OpenClaw CLI/Gateway version and container image are external pinned dependencies. A result from an unexpected transport, multiple visible payloads, malformed JSON, timeout, or output-budget breach fails closed.
