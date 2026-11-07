---
type: llm
---

The user wants to find which paper states a specific claim (funding-rate extremes followed by basis reversion within 24 hours). They ask for the exact search commands and what to do between finding the paper and writing it into a hypothesis rationale. Judge only the final response. This is an offline exercise: commands written out count as done, and placeholders stand in for outputs the prompt does not give.

Q1. Do the search commands include a call to Semantic Scholar's snippet search (`/graph/v1/snippet/search`), which returns matched passages? Semantic Scholar's paper search or a full-text search in another index does not count on its own.

Q2. Does the response say the paper a passage points to must be read (the claim in the paper's text, with its location) before it goes into the rationale, rather than citing it from the matched passage or the abstract alone?

PASS if Q1 and Q2 are yes. FAIL otherwise.
