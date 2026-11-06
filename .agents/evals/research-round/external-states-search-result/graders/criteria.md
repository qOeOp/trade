---
type: llm
---

Context: a derived registration adds a per-order cap of 3% of the previous five minutes' volume. Local evidence is run `run-c09` (ledger commit `9f3e2aa`). OpenAlex and Crossref were searched on 2026-10-30 with three named queries and found nothing in records and abstracts; Semantic Scholar returned 429 and was not searched; the search log is bundle `src-search-c11`. The root's own source, bundle `src-rsi-tv-01` (a TradingView RSI script page), covers RSI threshold entries and exits and says nothing about order size. Judge only the final response's `rationale` and `sources`.

1. Does the `rationale` have a part named `external` that states prior work was not found by these queries, naming the queries or the indexes searched and the date (2026-10-30), rather than being empty or claiming that no prior work exists? A rationale without separate external and local parts is no.
2. Does `sources` include `src-search-c11`?
3. Does the response treat the Semantic Scholar 429 as an index not searched (a search limitation), never as that index having no results? Silence about Semantic Scholar counts as no only if `external` implies every index was searched.
4. Does a part named `local` cite `run-c09` and ledger commit `9f3e2aa`?
5. Does the `local` part carry a statement that literature or prior work is absent, or is `external` empty?
6. Does `external` rest on `src-rsi-tv-01` (or the RSI template) as its evidence for the cap, in place of the search result? Mentioning it only as not bearing on the cap, beside the search result, is no.

PASS if 1, 2, 3 and 4 are yes and 5 and 6 are no.
FAIL otherwise.
