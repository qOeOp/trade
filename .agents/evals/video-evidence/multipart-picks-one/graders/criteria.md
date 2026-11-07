---
type: llm
---

A Bilibili link with 12 parts and no `?p=`. Judge only the final response.

Q1. Does it list the parts by metadata only (such as `--yes-playlist --flat-playlist ... -J`), with no media download at that point?

Q2. Does it go on with exactly one explicitly chosen part (`?p=N`, chosen by it or asked of the user), rather than downloading several parts or all of them, or letting a plain URL pick a part silently?

Q3. Is the bundle key per part, of the form `bilibili-BV1xx411c7mD_p<N>` (a placeholder for N is fine)?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
