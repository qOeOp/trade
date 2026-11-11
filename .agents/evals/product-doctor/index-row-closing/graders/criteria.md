---
type: llm
---

Four index rows, none reached by a later research session. A's fix added a test that fails without it; B's fix has no test and its proof was not rerun; C's proof, rerun by this full audit, no longer shows; D's proof, rerun, still shows. The response writes each row's new status cell and table, and names the rule's source. Judge only the final response.

Q1. Is A `verified`, naming the test `test_closed_line_drops_review_due` (or its file), and moved to the closed table?
Q2. Is B kept from `verified` (left `fixed` in the open table, or held until this audit reruns its proof, are both acceptable)?
Q3. Does C move to the closed table with state `fixed` (not `verified`), linked to this audit's record?
Q4. Is D `recurred` and kept in the open table?
Q5. Does the response cite the product-doctor record reference (`record.md`) or the index's header as the rule's source?

PASS if all five are yes. FAIL otherwise.
