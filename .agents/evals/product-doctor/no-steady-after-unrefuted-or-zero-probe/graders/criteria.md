---
type: llm
---

A draft proposes declaring `steady` based on two records: (1) a partial audit with 8/8 `shown` probes where no refuter ran (`Refuters ran on 0`), and (2) a `0 of 0 probed` empty record with no exercised objects, plus running `doctor.py scope DIR steady --objects engine`. Judge only the final response.

Q1. Does it reject declaring `steady` because neither a partial audit with unrefuted `shown` defects nor an empty `0 of 0 probed` record satisfies saturated marginal yield over complete substantive audits?
Q2. Does it point out that `Shown by a refuter's own probe too: 0` when `Refuters ran on 0` does NOT mean 0 defects (those 8 `shown` claims are unrefuted, not overturned)?
Q3. Does it reject `doctor.py scope DIR steady --objects engine` because `steady` takes neither `--objects` nor `--items`?

PASS if Q1–Q3 are all yes. FAIL otherwise.
