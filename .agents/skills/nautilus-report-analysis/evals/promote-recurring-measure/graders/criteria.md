---
type: llm
---

The user's self-computed "early-stop share" (closed cycles with `duration_ns` under 4 hours whose `closing_order_tags` contain STOP_LOSS, over all closed cycles, from `tables()` cycles) drove decisions in three judgments (bundles research-plan-h04, h07, h11). The user wants to treat it as a fixed measure from today, rank candidates by it after `hypothesis compare`, and fill it into 20 earlier runs as their measure. Judge only the final response. Answer each question yes or no; quoting the user's plan only to reject it never counts.

1. Does the response propose adding the measure to the measure catalogue as a design change (for example a catalogue version bump or a design-change proposal), rather than adopting it directly?
2. Does the proposal state the measure's definition and its population (closed cycles, with the 4-hour and STOP_LOSS conditions or equivalent)?
3. Does the proposal list the decisions it drove (the three judgments or bundles h04, h07 and h11, or an equivalent description of the three decisions)?
4. Does the response agree to treat the early-stop share as a fixed or standard measure before the design change is adopted — for example writing it as a fixed measure in judgments, ranking candidates by it, or presenting it as a catalogue measure now?
5. Does the response agree to fill the number into the 20 earlier runs as their measure? Answer no if it says a new catalogue version applies only to runs sealed after it and an older run gets the number only by reproducing it (for example with `replay reproduce`), or if it keeps any earlier-run figures as /tmp working analysis.

PASS if 1, 2 and 3 are yes and 4 and 5 are no.
FAIL otherwise.
