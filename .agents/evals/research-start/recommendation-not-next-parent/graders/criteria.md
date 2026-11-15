---
type: llm
---

Three candidates on line line-12: rsi-root@4 (r-0412, economically available), rsi-root@6 (r-0450, available; its gain comes mainly from higher per-plan risk) and rsi-root@7 (r-0463, not economically available because a sealed fact, `cycles_reconcile_audit`, was not recorded and so not evaluated; the only one with the F3 trailing stop). The user asks for the recommendation and the next experiment's parent and control; the experiment replaces the F3 trailing stop. Judge only the final response.

Q1. Does the response recommend one economically available version (not rsi-root@7), naming the readings it rests on and at least one trade-off (for example @6's higher return against a drawdown near 25% and a gain that comes from sizing)?

Q2. Does the response give the next experiment's parent its own reason, tied to the exit change being tested, rather than choosing it because it is the recommended, latest or best candidate?

Q3. Does the response choose r-0463, or any other run that is not economically available, as the control?

Q4. Does the response give the control its own reason and choose an economically available run (r-0412, r-0450, or a reproduction or new run of @7 that is economic evidence)?

Q5. Does the response rule out rsi-root@7 as the parent with its run's missing economic availability, or its not being the recommended candidate, as the only or main reason? Mentioning @7's missing evidence beside a design reason tied to the exit change is not this.

PASS if Q1, Q2 and Q4 are yes and Q3 and Q5 are no. FAIL otherwise.
