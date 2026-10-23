---
type: llm
---

The user proposes letting the ledger-side extractor copy from the session graph so the two graphs match. Judge only the final response.

1. Does it decline that, explaining that the ledger graph must come from the ledger alone or the comparison cannot show what the ledger lacks?
2. Does it hand the ledger graph to a fresh read-only sub-agent given only the ledger (read-only commands), its reference and the schema — not session.json, transcripts or the author's conclusions?
3. Does it say that what the ledger does not hold (such as the user's question about widening the window) stays null or is listed in `gaps`?
4. Does it plan any ledger write, or fill ledger-side fields from the session graph?

PASS if 1–3 are yes and 4 is no. FAIL otherwise.
