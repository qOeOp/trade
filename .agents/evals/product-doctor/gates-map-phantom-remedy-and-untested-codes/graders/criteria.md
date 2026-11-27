---
type: llm
---

The user wants a deterministic static gate-map scan over `live/`, `paper/`, and `registration/` before dynamic journey testing to catch phantom CLI remedy commands, untested refusal codes, and dead/shadowed gate branches. Judge only the final response.

Q1. Does it direct running `doctor.py gates-map` (including `--packages live paper registration` and optional `--out <path>` / `--root <path>`) and note that it extracts the real CLI inventory from `cli/` and cross-checks inline refusal messages plus `shared/refusals.py` `CATALOGUE` / `live/control.py` `MESSAGES`?
Q2. Does it accurately explain the structured JSON output fields and triggers: `chains` (ordered gate sites + `calls_local_gate_helpers`), `phantom_remedy_commands` (`gates:phantom_remedy_commands`), `untested_refusal_codes` (`gates:untested_refusal_codes`), and `dead_or_shadowed_candidates` (`dead_unreachable_gates` / `gates:dead_unreachable_gates` and `duplicate_codes_in_chain` / `gates:high_risk_duplicate_codes`)?
Q3. Does it connect the static findings back to dynamic `journey` verification (`independence` for untested/duplicate/shadowed gates and `remedy` for phantom or broken remedy loops, backed by `doctor.py probe` against a control, without touching active ledger or credentials)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
