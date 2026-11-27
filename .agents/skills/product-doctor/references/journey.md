# User-Journey & Gate-Satisfiability Proofs (`journey`)

Individual gate tests can pass while the combined user workflow is deadlocked, contains shadowed checks that can never fire, holds locks across background work blocking emergency controls, or prints a remedy that fails or breaks an earlier gate.

## Boundaries

- Run every dynamic journey in an isolated temporary environment: `ledger temp`, a temporary market directory, an isolated Paper database, and a temporary Live custody root with the loopback / fake venue fixture. Never touch the active ledger, active market, primary real account, or credentials (`AGENTS.md`).
- Never hand-forge internal database rows, manifests, journals, or state JSON files to bypass an upstream step. If a state cannot be reached through real CLI or IDE commands, that gap is itself the finding.

## General L4 User-Journey Invariants

Record each scenario with `doctor.py run DIR journey OBJECT:SCENARIO -- ...` (or `doctor.py probe` in focused diagnosis) using the three scenarios in [lenses.md](lenses.md): `satisfiability`, `independence`, and `remedy`.

### 1. Joint Cross-Step Gate Satisfiability & Lock Non-Contention (`satisfiability`: `A ∧ B ∧ C ∧ ...`)

Starting from an empty temporary environment, execute **only** real user-available CLI/IDE commands end-to-end across the target journey — including realistic production parameter differences (e.g., smaller live capital than research defaults, changed leverage, or post-closure state transitions):

- **Joint satisfiability**: every upstream output must satisfy downstream preconditions simultaneously without manual file or SQL edits, and read-ahead / preflight assumptions must match what prepare and execution actually consume.
- **Background-job vs emergency-control lock contention**: emergency stop, cancel, or maintenance controls must never block on locks held across slow background replays, network calls, or disk I/O.
- If no reachable sequence of real user commands can clear all gates together, or an emergency control blocks behind background work, file a **P0/P1 Unsatisfiable Deadlock / Lock Contention** finding backed by `doctor.py probe`.

### 2. Per-Gate Non-Redundancy / Independence (`independence`: `¬X ∧ ⋀(Y≠X)`)

For each precondition `X` in an admission or check chain:

1. Construct a **reachable** upstream state via real commands or fault fixtures where **only** `X` fails while every other precondition `Y ≠ X` holds.
2. Verify `X` itself fires with its documented refusal code (and that CLI flags/choices match the backend dispatcher).
3. If no reachable state can trigger `X` independently — because an earlier gate `A` always intercepts first (`¬X ⇒ ¬A`), or a CLI choice / refusal code has no live caller — file a **Redundant / Shadowed Gate** finding with exact `file:line`.

### 3. Refusal → Remedy → Re-Poll Clear Loop (`remedy`)

For every refusal encountered during `satisfiability` and `independence`:

1. Follow the refusal message and UI guidance literally via CLI/IDE without improvising unmentioned workarounds.
2. Verify the UI/CLI re-polls or refreshes state cleanly after the remedy (without requiring a hard page reload or silently reusing a stale prepared artifact across state changes).
3. Re-run the originally refused step and verify **both**:
   - **(a) Clear**: the refused gate now passes and UI/CLI surfaces the real refusal reason on failure; and
   - **(b) Non-regression**: applying the remedy did not break any previously satisfied gate ("fix C breaks E").
