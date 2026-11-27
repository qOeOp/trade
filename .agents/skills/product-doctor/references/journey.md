# User-Journey & Gate-Satisfiability Proofs (`journey`)

Individual gate tests can pass while the combined user workflow is deadlocked, contains shadowed checks that can never fire, holds locks across background work blocking emergency controls, or prints a remedy that fails or breaks an earlier gate.

## Boundaries

- Run every dynamic journey in an isolated temporary environment: `ledger temp`, a temporary market directory, an isolated Paper database, and a temporary Live custody root with the loopback / fake venue fixture. Never touch the active ledger, active market, primary real account, or credentials (`AGENTS.md`).
- Never hand-forge internal database rows, manifests, journals, or state JSON files to bypass an upstream step. If a state cannot be reached through real CLI or IDE commands, that gap is itself the finding.

## The Three Mandatory L4 Proofs

Record each scenario with `doctor.py run DIR journey OBJECT:SCENARIO -- ...` (or `doctor.py probe` in focused diagnosis) using the three scenarios in [lenses.md](lenses.md): `satisfiability`, `independence`, and `remedy`.

### 1. Joint Satisfiability (`satisfiability`: `A ∧ B ∧ C ∧ D ∧ E`)

Starting from an empty temporary environment, execute **only** real user-available CLI/IDE commands end-to-end across the target journey — including realistic production differences (e.g., research default balance `100,000 USDT` vs a `200–500 USDT` Live wallet, changed leverage, closed research line):

- Research: `ledger temp` → `line select` → `candidate publish` → `replay precheck` → `source review` → `registration add` → `replay run` → `judgment add` → `line history` → `line close`
- Validation & Paper: `validation registration` → `paper start` → `paper stop` → `paper compare`
- Live (loopback / fake venue only): `live web-command` (`prepare` → `preflight` → `start`) → concurrent background `paper-compare` + emergency `live stop` → reconcile / seal

Prove that every precondition clears simultaneously without manual file or SQL edits, and that emergency controls (`live stop`, `paper stop`) are never blocked by locks held across slow background replays or I/O. If no reachable sequence of real user commands can satisfy all gates together, file a **P0/P1 Unsatisfiable Deadlock** finding backed by `doctor.py probe`.

### 2. Per-Gate Non-Redundancy / Independence (`independence`: `¬X ∧ ⋀(Y≠X)`)

For each precondition `X` in an admission or check chain:

1. Construct a **reachable** upstream state via real commands or fault fixtures where **only** `X` fails while every other precondition `Y ≠ X` holds.
2. Verify `X` itself fires with its documented refusal code (and that CLI flags/choices match the backend dispatcher).
3. If no reachable state can trigger `X` independently — because an earlier gate `A` always intercepts first (`¬X ⇒ ¬A`), or a CLI choice / refusal code has no live caller — file a **Redundant / Shadowed Gate** finding with exact `file:line`.

### 3. Refusal → Remedy → Clear Loop (`remedy`)

For every refusal encountered during `satisfiability` and `independence`:

1. Follow the refusal message and UI guidance literally via CLI/IDE without improvising unmentioned workarounds (including refreshing or re-checking in the UI without a hard page reload).
2. Re-run the originally refused command and verify **both**:
   - **(a) Clear**: the refused gate now passes and UI/CLI surfaces the real refusal reason on failure; and
   - **(b) Non-regression**: applying the remedy did not break any previously satisfied gate (e.g., `line close` blocking `replay explore`, stale immutable `preparedId` reuse, or "fix C breaks E").
