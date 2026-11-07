---
type: llm
---

The user saw 42.5 on a contact sheet thumbnail and wants a claim and a one-sentence answer. The agent has no shell or files here, so a step it writes out counts as done and placeholders are fine. Judge only the final response.

Q1. Does it make opening the original PNG or a crop a step before the value is cited, rather than relying on the sheet?

Q2. Does the claim cite the frame as `{media_sha256, pts, decoded_sha256}` from a `grid.tsv` row, or a crop by its SHA-256, and not by a file name, the sheet or a rounded time?

Q3. Does the sentence to the user carry that same identity (placeholders are fine), not only the sheet or `t=180`?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
