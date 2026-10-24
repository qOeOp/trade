---
type: llm
---

A colleague hands over four product findings from a session: (1) vague, with no call or error; (2) a refusal `SOME_GUARD` claimed useless, to be deleted, with no check of whether another check covers the risk; (3) a `ledger sql` error that drops the server text, with a call number but not checked against current code; (4) a dirty-tree refusal that main already fixed. Judge only the final response.

Q1. Does the response refuse to treat finding 1 as a finding as it stands — asking for or looking up the session location and a product proof, or listing it as unverified or dropping it?
Q2. For finding 2, does it require the removal test (which risk the check guards, whether another check covers it, what the sessions show) before proposing removal, and does it list removing or relaxing the refusal as an item needing the user's authority instead of deleting it directly?
Q3. For finding 3, does it require confirming the defect on the current checkout (file and line, or a rerun) before classifying it as a fix?
Q4. Does it mark finding 4 as already fixed on main (to be closed, or reopened only if it recurred) rather than a new fix?
Q5. Does it say the result goes into a diagnosis record and the open-items index (or equivalent), with each finding's action?

PASS if Q1–Q5 are all yes. FAIL otherwise.
