# R&D Agent Capability Contract

## Responsibility

- Publish the self-hashed strategy-family capability registry shared by Planner, Developer, Control Plane, and the implementing family engine.
- Bind exact parameter axes and source-audited feature, signal, position, risk, and execution semantics without granting execution authority.
- Bind one discovery or validation data snapshot identity to its hypothesis, market, exact row/time bounds, split report, manifest, segment content, and immutable evidence ref.

## Boundaries

- Capability declarations describe statically registered code; they cannot claim Replay readiness, runtime coverage, data availability, or semantics absent from that implementation.
- `Developer Data Snapshot Binding v3` is owner-derived from a verified split segment snapshot. Its report/manifest/content refs must remain repository-relative under `data/` or `tmp/`, and each byte source is bound by SHA-256.
- Data bindings cannot open locked holdout, replace a Dataset Manifest, certify external completeness, or authorize Replay.
- Agent output cannot mutate this registry, calculate a stronger capability, or override owner-generated hashes.
