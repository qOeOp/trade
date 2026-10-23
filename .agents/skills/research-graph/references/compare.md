# Classify differences

`graph.py compare` lists differences; it does not judge them. Put each into one class, with the
evidence that decides it:

| Class | Meaning | Next step |
|---|---|---|
| ledger gap | A fact a later reader needs to understand or repeat the research, absent from the ledger and not derivable from it | Finding for `product-doctor`: its consumer, the decision it changes, the cost seen |
| not a record | Conversation, host state, retries, polling, drafts: AGENTS.md keeps these out of the ledger | None; a behaviour problem behind it goes to the skill that governs it |
| derivable | The ledger holds what is needed to compute it | Read-path work at most; state the derivation |
| extraction miss | One side's extractor missed or misread what its source holds | Fix the extractor or its reference; not a product finding |

Before calling something a ledger gap, check that no existing record carries it (candidate
description, line note, judgment, evidence bundle) and that a reader could not derive it. A
difference that only one source could ever hold is not a gap of the other. A reading difference
within rounding is not a difference. Report the classes with counts and the decisive examples.
