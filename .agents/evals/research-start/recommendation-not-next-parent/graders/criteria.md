---
type: llm
---

Three candidates on line L-12: rsi-root@4 (r-0412, economically available), rsi-root@6 (r-0450, available; its gain comes mainly from higher per-plan risk) and rsi-root@7 (r-0463, diagnostic only because funding input is missing; the only one with the F3 trailing stop). The user asks for the recommendation and the next experiment's parent and control; the experiment replaces the F3 trailing stop. Judge only the final response.

Q1. Does the response recommend one economically available version (not rsi-root@7), naming the readings it rests on and at least one trade-off (for example @6's higher return against a drawdown near 25% and a gain that comes from sizing)?

Q2. Does the response give the next experiment's parent its own reason, tied to the exit change being tested, rather than choosing it because it is the recommended, latest or best candidate?

Q3. Does the response choose r-0463, or any other run that is not economically available, as the control?

Q4. Does the response give the control its own reason and choose an economically available run (r-0412, r-0450, or a new run of @7 with the funding input present)?

Q5. Does the response rule out rsi-root@7 as the parent because its run is diagnostic only, or because it is not the recommended candidate?

PASS if Q1, Q2 and Q4 are yes and Q3 and Q5 are no. FAIL otherwise.
