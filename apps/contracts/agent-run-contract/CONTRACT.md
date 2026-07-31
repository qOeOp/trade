# Agent Run Contract

## Responsibility

- Freeze one bounded, provider- and Host-neutral Planner, Developer, Reviewer, or explanation run.
- Bind immutable input/output refs, capability profile, source revision, budgets, idempotency, trace identity, ordered lifecycle events, and one terminal result.
- Keep Direct Codex, OpenClaw-managed Codex, and future adapters comparable without making any Host a domain owner.

## Boundaries

- Requests carry refs and a bounded objective, never credentials, provider endpoints, model IDs, arbitrary commands, owner database paths, or production repository write authority.
- Planner, Reviewer, and explanation profiles are read-only. Developer writes only inside an isolated workspace and returns a patch/evidence ref; it cannot apply, merge, deploy, promote, trade, or write owner stores.
- Events contain operational summaries only. Raw chain-of-thought/reasoning, raw provider payloads, secrets, and unbounded tool output are forbidden.
- Results have `domain_authority=none`; an existing deterministic owner must validate every proposal or patch before state changes.
