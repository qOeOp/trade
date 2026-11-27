# User-Journey & Gate-Satisfiability Proofs (`journey`)

An individual gate test can pass while the combined user workflow is impossible to complete, contains
shadowed checks that can never fire, or prints a remedy that fails or breaks an earlier gate. The
`journey` lens audits the real end-to-end gate chain across `Correctness`, backed by the static AST
analyzer `doctor.py gates-map`.

## Boundaries

- Run every dynamic journey in an isolated temporary environment: `ledger temp`, a temporary market
  directory, an isolated Paper database, and a temporary Live custody root with the loopback / fake
  venue fixture. Never touch the active ledger, active market, primary real account, or credentials
  (`AGENTS.md`).
- Never hand-forge internal database rows, manifests, journals, or state JSON files to bypass an
  upstream step. If a state cannot be reached through real CLI or IDE commands, that gap is itself
  the finding.

## Step 0: Static Gate & Refusal Map (`doctor.py gates-map`)

Before running dynamic probes, generate the deterministic gate inventory:

```bash
uv run --frozen python .agents/skills/product-doctor/assets/doctor.py gates-map \
  --out /tmp/gates-map.json
```

Use `--packages live paper registration` to narrow to one admission surface when doing a focused
diagnosis. Review four outputs from `gates-map`:

1. `chains`: ordered gate sites (`order`, `line`, `code`, `guard`, `message_template`) and
   `calls_local_gate_helpers` per admission/check function — the exact check sequence to prove.
2. `phantom_remedy_commands`: CLI command snippets inside refusal messages, `shared/refusals.py`
   `CATALOGUE`, or `live/control.py` `MESSAGES` that do not exist in `cli/`'s real command inventory
   (for example, naming "live prepare" instead of `live web-command --configuration PATH --action prepare`,
   or "paper run" instead of `paper start`).
3. `untested_refusal_codes`: refusal codes raised in product packages with zero references in `tests/`.
4. `dead_or_shadowed_candidates`:
   - `dead_unreachable_gates`: AST-provable unreachable gates (post-terminator, always-false branch,
     always-true shadowing, duplicate `elif` condition, or shadowed identical guard).
   - `duplicate_codes_in_chain`: same code raised multiple times in one function (`severity: "high"`
     when guard or message repeats), flagging priority candidates for dynamic independence proofs.

## The Three Mandatory L4 Proofs

Record each scenario with `doctor.py run DIR journey OBJECT:SCENARIO -- ...` using the three
scenarios declared in [lenses.md](lenses.md): `satisfiability`, `independence`, and `remedy`.

### 1. Joint Satisfiability (`satisfiability`: `A ∧ B ∧ C ∧ D ∧ E`)

Starting from an empty temporary environment, execute **only** real user-available CLI/IDE commands
end-to-end across the target journey — for example:

- Research: `ledger temp` → `line select` → `candidate publish` → `replay precheck` → `source review`
  → `registration add` → `replay run` → `judgment add` → `line history` → `line close`
- Validation & Paper: `validation registration` → `paper start` → `paper stop` → `paper compare`
- Live (loopback / fake venue only): `live web-command` (`prepare` → `preflight` → `start`) →
  `live stop` → reconcile / seal

Prove that every precondition in the chain clears simultaneously without manual file or SQL edits.
If no reachable sequence of real user commands can satisfy all gates together (contradictory
preconditions, cyclic ordering, or an unproducible artifact), file a **P0 Unsatisfiable Deadlock**
finding backed by a `doctor.py probe` against a clean control.

### 2. Per-Gate Non-Redundancy / Independence (`independence`: `¬X ∧ ⋀(Y≠X)`)

Using the ordered `chains` from `doctor.py gates-map`, for every gate precondition `X` in the chain:

1. Construct a **reachable** upstream state via real commands or fault fixtures where **only** `X`
   fails while every other precondition `Y ≠ X` holds.
2. Invoke the target command and verify that `X` itself fires with its expected refusal code.
3. If no reachable user or system state can trigger `X` independently — because an earlier gate `A`
   always fires whenever `X` would fail (`¬X ⇒ ¬A`), or because `X` is statically unreachable — file
   a **Redundant / Shadowed Gate** finding showing the preempting gate and exact file/line from
   `gates-map`.

Prioritize every code in `untested_refusal_codes`, `dead_unreachable_gates`, and high-risk
`duplicate_codes_in_chain` first.

### 3. Refusal → Remedy → Clear Loop (`remedy`)

For every refusal encountered during `satisfiability` and `independence` (plus any
`phantom_remedy_commands` flagged by `gates-map`):

1. Follow the refusal message and catalogue `next_actions` literally via CLI/IDE without improvising
   unmentioned workarounds.
2. Re-run the originally refused command and verify **both**:
   - **(a) Clear**: the refused gate now passes; and
   - **(b) Non-regression**: applying the remedy did not invalidate any previously satisfied gate
     (catching "fix C breaks E" oscillations, stale commit/manifest drift, or dead-end error copy).

Any phantom remedy command, non-clearing remedy, or fix-breaks-prior-gate cycle is a confirmed
`journey` finding recorded with its probe and control per [record.md](record.md).
