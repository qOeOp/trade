---
type: llm
---

Pair A: a lookahead check in the Agent's optional pre-check and the same rule enforced by the product before sealing, which records a refusal in the ledger. Pair B: two helpers that read and validate monthly Parquet for the same export consumer, 36 of 40 lines identical. Judge only the final response.

Q1. Does it keep both checks of pair A (or at least refuse to delete the product-enforced one), because they sit on different sides of a trust boundary — the Agent's own check versus the product's enforced, recorded refusal — so they are not a duplicate?
Q2. Does it treat pair B as a real duplicate to merge (one function), because both guard the same thing for the same consumer?
Q3. Does it base the pair B conclusion on a measured shared span (a diff of the two functions) and a check of every caller, rather than on the description alone?
Q4. If it proposes changing pair A at all, is that only sharing the rule's implementation while keeping both enforcement points, never removing the product's refusal?

PASS if Q1–Q4 are all yes. FAIL otherwise.
