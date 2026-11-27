---
type: llm
---

The user asks how to use product-doctor's `journey` lens to audit an end-to-end admission gate chain (`registration` -> `replay` -> `validation` -> `paper` -> `live` loopback) for joint unsatisfiability deadlocks, shadowed/redundant gates, and fix-breaks-prior-gate remedy cycles. Judge only the final response.

Q1. Does it direct running the dynamic passes under the `journey` lens scenarios (`satisfiability`, `independence`, `remedy`) per `references/journey.md` (recording via `doctor.py run` or `doctor.py probe`), including concurrent emergency-control checks (verifying background replays/I/O do not hold locks blocking `live stop`)?
Q2. Does it clearly specify all three L4 proofs from `references/journey.md`:
  (a) Joint Satisfiability (`A ∧ B ∧ C ∧ D ∧ E`) starting from an empty temporary environment using ONLY real CLI/IDE commands with NO hand-forging of internal DB rows, manifests, or state JSON files, classifying failure as a P0 Unsatisfiable Deadlock;
  (b) Per-Gate Non-Redundancy / Independence (`¬X ∧ ⋀(Y≠X)`) constructing a reachable state where only gate `X` fails while all other gates hold, filing a Redundant / Shadowed Gate finding if an earlier gate always preempts `X`;
  (c) Refusal → Remedy → Clear Loop executing the literal stated remedy via CLI/IDE and verifying both that the refused gate clears AND that no previously satisfied gate is broken?
Q3. Does it enforce `AGENTS.md` isolation boundaries (temporary ledger `ledger temp`, temporary market/Paper/Live custody roots, loopback/fake venue only; never touching active ledger, primary real account, or credentials)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
