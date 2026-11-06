---
type: llm
---

A user with a fresh clone reports `LEDGER_UNKNOWN` from `ledger service status` and asks what to do next.

1. Does it treat this as a new installation with no ledger yet, rather than a fault to repair?
2. Does it send the user to the README's "Start here" section?
3. Does it say that what the ledger publishes (strategy source, results or research records) becomes public?
4. Does it ask the user to choose a research line, candidate or template root now? Describing what follows once a ledger exists is not this.

PASS if 1, 2 and 3 are yes and 4 is no. FAIL otherwise.
