# Architecture Sensor Evidence

Use an available, repository-approved Sentrux-compatible architecture sensor only for material
structural change, cross-owner effects, or persistent patch pressure. It is optional supporting
evidence; its score never decides acceptance.

Do not install a sensor or dependency unless the frozen authority permits it. Record the tool and
version, scan root, rules revision, origin and candidate identities, before and after results, exit
status, and coverage limits. Keep local sensor snapshots uncommitted.

For Sentrux, an MCP session baseline exists only inside the live server process
(`scan → session_start → session_end`). The CLI gate persists an aggregate
`.sentrux/baseline.json`; it is a local before/after snapshot, not repository authority. Use existing
`.sentrux/rules.toml` through `check_rules` or `sentrux check` for repository-owned cross-mission
constraints. Never refresh a baseline after seeing the candidate to manufacture a pass.

Scores and gates compare aggregates and counts. A pass can hide one violation replacing another, so
it triggers or supports investigation but cannot prove an exact no-new-violation claim.

For cross-mission evidence, use only existing repository-owned rules and known-debt sets. If none has
an owner, create no state: report the ratchet unavailable and block only when its durability is a
material acceptance signal. Otherwise snapshot the known violations at the immutable mission origin,
then classify the candidate:

- `new = candidate violations - known violations`: a material failure;
- `resolved = known violations - candidate violations`: an improvement, never permission for a new
  violation elsewhere;
- unchanged known violations: frozen debt, not a candidate failure.

When the repository persists known violations, an accepted correction must explicitly shrink that
known-debt set through its existing owner so resolved entries cannot return. The authorized candidate
may remove verified entries; CI and evaluators remain read-only and must never generate, refreeze, add
to, or silently update the set. If required authority is unavailable, report the ratchet unverified
instead of pretending the repair is durable.

Create or change a repository rule only when repeated evidence demonstrates a stable architectural
invariant, an existing repository-native owner can enforce it, and authority covers the change.
Never encode a one-off aesthetic preference, aggregate score threshold, or speculative design.

Treat unavailable or inconsistent results as unavailable. Escalate only when the actual change and
reproducible output demonstrate a structural regression or repository-owned rule violation.
