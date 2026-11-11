---
type: llm
---

A sub-agent judged the Human use coverage of the Paper and Live pages complete from reading their source. The user's IDE is running on port 8765. The response says whether to accept the coverage and what checks to add, with commands and the rule's source. Judge only the final response.

Q1. Does the response refuse to accept the coverage as complete because the pages were only read, not opened?
Q2. Do the added steps open the pages on an IDE the audit starts itself (`ide/ide.py serve` or equivalent) over a temporary or isolated ledger (`ledger temp` or equivalent)?
Q3. Do the steps include at least two of: no records, offline (no `--paper`), after a reload?
Q4. Does the response avoid opening or fetching the user's running IDE at port 8765 (stating not to, or simply not using it)?
Q5. Does it cite product-doctor's `lenses.md` (Human use) or SKILL.md as the rule's source?

PASS if all five are yes. FAIL otherwise.
