# Requirements for an unsupervised production R&D loop, from the research/ronnie simulation

Research input for the main development flow, written on 2026-10-01. It is not an architecture decision. The
governing documents stay `docs/guide/product-loop.md` and `docs/owners/*.md`; adopting anything here means changing
them first, under the repository's architecture-authority rule. Nothing here widens a path to real money.

Sources: the simulation (`loop/PROTOCOL.md`, `loop/CRITERIA.md`, `loop/FORWARD_PLAN.md`, `loop/RETROSPECTIVE.md`,
`loop/WORKFLOW_NOTES.md`, `loop/*.py`) and a read-only mapping of the product docs and code against it (file:line
references below).

## 1. Verdict

- **As a method reference, the simulation is largely sufficient.** It specifies what the loop must do, with verified
  sources, and records 53 concrete failure modes. The product documents contain no statistical design at all.
- **As validated evidence for building an unsupervised loop, it is not sufficient, for four reasons:**
  1. **The product cannot run any part of the loop in deployment** (section 3).
  2. **The prototype has unfixed defects** that must not be copied (section 4).
  3. **It proved discipline, not discovery.** No strategy reached the "developed" gate, so the claim that this loop
     produces usable strategies is untested until the forward decisions of 2027.
  4. **The loop did not correct its own method.** Almost every methodological correction came from the user's
     questions (section 2).

## 2. The key lesson: method corrections came from the human, not the loop

| correction | how it arrived | where it is now |
| --- | --- | --- |
| Attribution as factor evaluation (IC, ICIR, buckets) | user: "the attribution has no system" | `loop/attrib.py`; notes 21-26 |
| Loop quality over loop count (diagnosis, competing explanations, predictions) | user: "the iteration slope is too low" | PROTOCOL amendment 4 |
| Context separation (gatekeeper, sealed results) | user: "the problem is the unclean context, not the holdout size" | amendment 5 |
| Test on the majors | user | amendment 7 |
| Trade-by-trade visual review | user | note 44, `loop/trade_cards.py` |
| External literature search in every loop | user: "do the loops search outside?" | amendment 8 |
| Acceptance and closure criteria, guards against wrongful closure | user | `loop/CRITERIA.md` A-B, amendment 9 |
| Data buckets (majors, alts, asset classes) | user | CRITERIA C |
| A usable-at-small-size gate, sequential tests | user: "three years means no strategy is ever used" | CRITERIA D |

- **What the loop caught by itself:** code bugs (key collisions, NaN, churn, a wrong Holm rank).
- **What it did not catch:** systematic methodological errors. The coin-clustered intervals were too narrow for
  dozens of loops, and a closure stated "resolved on wider data" when no such test had run (A8).

**Requirement:** an unsupervised loop must start with all of the above fixed as protocol. Humans review the protocol
on a schedule, not the results; the loop may propose protocol changes, but only a human approves them.

## 3. Module requirements, product state and prototype reference

| module | product state today | prototype reference | requirement |
| --- | --- | --- | --- |
| M1 Research intent and pre-registration | Types exist (`crates/strategy_factory/src/trial_family.rs:12-31`, `intent.rs:13-133`); narrow and pilot-shaped; V3 issuance has no production caller (`docs/owners/rd.md:1478`) | INTENT.md and LOG registrations | Registration is a gate, not a commit: mechanism, outside source, SESOI, falsifier, the credible-variant list, the computed variant count, buckets covered and predictions, frozen before any data is read |
| M2 Trial and data-read ledger | Census types exist; the append runs only in tests (`trial_family.rs:1362`); every production family stays at count 1 (`rd.md:1181`) | `loop/census.csv` | Every run, rerun and peek is counted. A data-read ledger records which instrument and period each trial and agent touched, and hands out untouched slices |
| M3 Exploratory backtest with controls | Replay exists only under an acceptance feature (`exploratory_replay.rs:555`); no bootstrap or interval code in `crates/` | `loop/engine.py` (20 matched random entries), `attrib.week_boot` | Matched random-entry control, date-clustered (weekly) intervals, costs and funding, the same order types the forward stage can hold |
| M4 Holdout partition and gatekeeper service | Holdout is a custody token (`candidate_intake.rs:535`); no data partition; no cross-family holdout count (`qualification.md:555`) | `loop/gatekeeper*.py`, coin and time tiers | A real partition behind access control; verdict-only answers (pass, equivalent-null, inconclusive); Holm or Romano-Wolf across each batch of reads; the evaluator is a deterministic service or a different model, and its ledger is not readable by the iterating agent |
| M5 Diagnosis package | None | `engine.decompose`, `attrib.py`, `beta_check`, `trade_cards.py` | Loss decomposition, beta check against random entries, ablation, factor-style attribution with a reliability flag, trade cards; any visual hypothesis quantified on all trades |
| M6 Acceptance ladder and closure statuses | Qualification compares point estimates (`protected_robustness_assessment.rs:882`); DSR/PBO code was deleted (commit 36fb944) | `loop/CRITERIA.md`, `closure_audit.py`, `bucket_audit.py`, `gatekeeper_pool.py` | SESOI and TOST; five family statuses (active, parked, absorbed, immaterial, closed); closure only on equivalence or a falsified mechanism; a closure audit and near-miss retests before any closure; bucket scope on every status |
| M7 External research step | Source Intake `resolve_policy` returns None (`source_intake/owner.rs:479`) | `loop/EXTERNAL_RESEARCH.md` | Live, failure-targeted search in every hypothesis step; each source with its rule, claimed result and evidence quality; citations verified against primary pages |
| M8 Portfolio and ensemble evaluation | Portfolio interaction classes are TARGET (`portfolio.md:122`) | `loop/ensemble.py`, `gatekeeper_book.py` | Return streams, effective N, an equal-risk book with no fitted weights, PBO over construction variants, DSR with N = the lineage trial count |
| M9 Forward incubation | Governance Lifecycle is TARGET (`strategy-governance.md:102`) | `loop/FORWARD_PLAN.md`, `trend/forward*.py`, `combo/forward.py`, `carry/forward.py` | Record-only stage with the backtest's order types (limit, stop, validity) and cadence; decision dates and kill lines fixed in advance; Wald's sequential test; every registered candidate reported (incubation bias) |
| M10 Orchestrator | The R&D Execution Agent and spend cap are TARGET (`rd.md:1220`); the only model call is a one-shot build (`artifact_build_v1.ts:64`) | this session, by hand | Scheduler, budgets and a spend cap; stop rules; the fixed protocol of section 5; scheduled human protocol reviews; it stops at a proposal |
| M11 Real-money boundary | Correctly closed: deployment admission disabled (`qualification.md:42`) | CRITERIA D gate U | Unchanged: any real-money step needs the user's explicit authority per strategy and size; the agent never uses exchange credentials |

## 4. Defects in the prototype that must not be copied

1. **The validation gatekeeper leaks the holdout.** `loop/gatekeeper.py:57` decides PASS from the raw holdout interval,
   bypassing Thresholdout's noise, so the PASS bit carries unprotected holdout information (workflow note 53).
2. **The gatekeeper still uses coin-clustered intervals,** which are too narrow (RETROSPECTIVE flaw 1).
3. **The sealed store is in git and readable,** so the boundary is enforced only by prose. The evaluator is the same
   model family as the iterator, and the model's memory of market history is itself a leak (RETROSPECTIVE flaws 5-6).
4. **Census rows can carry verdict bits** before the relay (note 49).
5. **Survivor universes** in most tiers; only T-2 used a point-in-time universe (RETROSPECTIVE flaw 2).
6. **Forward records are signal logs, not paper execution,** and cannot hold resting limit orders (note 43).
7. **Hand-stated variant counts** were wrong once (note 50).
8. **Slot logic in arming order, not fill order** (note 57): an order that filled later voided one that filled earlier,
   lifting R-1's development edge from +0.22 to +0.34; the forward harness had it right, so the two disagreed silently.
   Rules with resting orders need one event-driven simulator shared by backtest and forward.

## 5. Protocol rules to fix from day one (not negotiable by the loop)

1. Pre-registration before any data read, with predictions recorded and scored.
2. Every trial counted, including peeks, reruns and failed runs.
3. The holdout is read once, by an evaluator the iterator cannot read or instruct; answers are verdicts only.
4. Statuses are three-level; inconclusive never closes; closure requires equivalence on new data or a falsified mechanism
   with the variants exhausted.
5. Date-clustered intervals; deflation by Holm or Romano-Wolf; stage 4 at pooled t >= 3 or DSR >= 0.95.
6. A literature screen before a family; low-prior ideas get a cheap kill test.
7. Bucket scope on every status; untested buckets opened only with a registered prior.
8. No refit on data that has been read; decay is handled by kill rules and new research, not by refitting.
9. Portfolio-level evaluation next to the timing edge (return and drawdown against holding and cash).
10. The loop stops at a proposal; nothing reaches money without the user.

## 6. What is still unvalidated

- Whether the loop discovers usable strategies at all (first forward decisions: 2027-04-01 and 2027-10-01).
- Any domain beyond Binance spot and perpetuals at daily and 4h bars (no order-book or intraday execution model, note 48).
- Separation with a truly independent evaluator (a different model or a deterministic service).

## 7. Suggested build order

1. **M3 and M2:** a deployable exploratory replay with controls, clustered intervals and a real trial ledger. Nothing
   else can be verified without them.
2. **M4:** a holdout partition with a verdict-only gatekeeper service (fixing section 4, items 1-4).
3. **M6 and M5:** the acceptance and closure engine and the diagnosis package.
4. **M9:** the record-only forward stage with sequential tests.
5. **M8, M7, then M10:** the orchestrator comes last, once every gate it would call exists and is tested.

## 8. Order mechanics the validated rule needs, against the product (checked 2026-10-02)

The study's only stage-2 rule besides carry, R-1u (and its forward variants R-1x and R-1s), needs:
- a resting limit entry valid 10 days;
- a stop and a target on the position (OCO);
- a partial exit (half at 2R, half at a farther target);
- moving the remaining stop to breakeven after the first target;
- a 60-day time exit;
- one position per coin.

| layer | state |
| --- | --- |
| Generic engine (`crates/execution`, `crates/backtest`) | supports all of it: GTD expiry, brackets and OCO, modify, trailing orders |
| V1 raw-order program SDK (`programs/sdk`, e.g. `majors_trend`) | expressible by hand (GTC limits with manual expiry, reduce-only targets, `Action::Modify`), but Backtest does not admit raw-order programs (`docs/owners/backtest.md:139`), and such programs cannot be sealed or run |
| Product path (StrategyDesignV2 / BFP, ProgramHostV2, exploratory replay) | only one position per instrument and a single movable stop. Missing: limit-entry placement and an expiry field, take-profit orders (A2), a target ladder (A3), stop and target fill reconciliation (D1), multi-frame replay (T1, so no exit can be backtested yet), bars-held context (A1), the authoring language V1 implementation, and deployment enablement of exploratory replay (user authority) |

Requirement for M3 and M9: the product's exploratory replay and forward stage must carry these order mechanics
before any rule of this kind can be reproduced inside the product. Until then the research harness
(`loop/family_r.py`, `roleflip/forward.py`) is the only implementation, and the research crate `replay/` (generic
engine with non-default flags) is the reference for matching it to the engine.
