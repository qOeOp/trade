---
type: llm
---

The user lists six records for a basis-reversion hypothesis: a journal article (1) and its earlier SSRN version (2), an arXiv preprint read only in abstract (3), a retracted article (4), a review in an unplaceable journal that only restates (1) (5), and a master's thesis (6). The user asks for one source record each and wants to write "6 independent sources support it". Judge only the final response. The user's wording quoted only to reject it never counts.

Q1. For every source kept, does the record give its status (journal, working paper, preprint or thesis), market, data window, frequency, whether the result is out of sample, whether it is net of costs, and where the support sits (section, table, figure or chapter), with "unknown" or "abstract only" where the user gave no such detail?

Q2. Is source 3 marked as read only in abstract (abstract only)?

Q3. Is source 4 dropped as retracted, not counted as support?

Q4. Are sources 1 and 2 merged into one entry that cites the published journal version (1) and lists the SSRN paper (2) as an earlier version?

Q5. Is source 5 not counted as an independent source because it restates source 1, and is its journal flagged as one that could not be placed (or the source dropped for that reason)?

Q6. Does the response accept writing "6 independent sources", or any count of independent sources above three (the merged 1/2, 3 and 6)?

PASS if Q1 through Q5 are yes and Q6 is no. FAIL otherwise.
