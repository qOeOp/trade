---
type: llm
---

Four fills are given with depth snapshots. O-1 (00:00:03) is before the day's first snapshot (00:00:12). O-3 (10:05:41) is 3m40s after the last snapshot before it (10:02:01). O-2 and O-4 have a snapshot seconds before them. O-4's 9.800 SELL exceeds the -1 band of 8.3; O-2's 2.400 BUY does not exceed the +1 band of 58.9. Judge only the final response.

Q1. Does it count O-1 and O-3 apart as unverified, without giving a verdict from comparing either with a band? Mentioning what a later snapshot would show, as an aside that does not count, is fine.

Q2. Does it report O-2 and O-4 as the fills checked, with O-4 exceeding the band and O-2 not?

Q3. Does it give the largest ratio of fill quantity to band depth among the checked fills as O-4's, about 1.18 (9.8 / 8.3)?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
