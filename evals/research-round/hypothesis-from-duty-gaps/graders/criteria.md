---
type: llm
---

Context: three candidates on one line have the given header stances; in @3 the duties marked 缺省 are A3, B2, C2, E3, F2, G2, G3, H1, I1, I2 and those marked 不适用 are A2, B3, D2, E2, F1, H3. The latest comparison's `profit_bridge` attribution says the difference comes mainly from funding (duties H1, B1). The user proposed changing the Keltner multiplier from 2.0 to 2.5 (an adopted entry rule). Judge only the final response.

1. Before choosing, does the response summarize the duty stances in the line's candidate headers (a table or grouped overview across the headers, or the latest header with the differences), rather than mentioning a single duty?
2. Does it list the duties marked 缺省 or 不适用 as the pool to pick from — at least eight of the sixteen named above?
3. Does it choose the next change by combining that list with the latest attribution, that is, tie the choice to the funding finding in `profit_bridge` and pick a duty that is 缺省 / 不适用 or that this attribution points to (for example H1)?
4. Does the proposed hypothesis write the duty id(s) in `changed_duties`?
5. Does the response make the Keltner multiplier change the next hypothesis? Mentioning it only as a later option, or declining it, is no.

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
