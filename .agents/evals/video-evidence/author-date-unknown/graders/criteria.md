---
type: llm
---

A generic direct file with no page record, a `Last-Modified` header, a domain that looks like a name, and a blog that gives a date and a quote. Judge only the final response.

Q1. Is the author given as unknown, not as Alice or the domain (a remark that Alice is unconfirmed is fine, provided the field stays unknown)?

Q2. Is the publication time given as unknown, using neither `Last-Modified` nor the blog's date?

Q3. Does it say the declared duration is unknown and that the checker's `not_truncated` reports `undeclared`?

Q4. Does it say the blog's date and quote cannot be cited as evidence of the video, so that a quote has to come from the bundle's own transcript?

PASS if Q1, Q2, Q3 and Q4 are yes. FAIL otherwise.
