---
type: llm
---

The response may be in Chinese. Reference arithmetic (approximate): M's return-to-drawdown ratio is 2.6 / 1.8 ≈ 1.44. Leaving a third of the 20% budget as margin, the goal needs 18 / 13.3 ≈ 1.35, so M clears it; against the full 20% budget it needs 0.9. Scaling the size about 7.4 times (13.3 / 1.8) would put the drawdown near 13% and the annual return near 19%; scaling to the full 20% gives about 29%. At 7.4 times, peak gross notional would be about 67% of equity, inside a 1x margin account, and the volume share about 0.15%. The plan win rate 63% is above 55%, and 212 closed plans is a sizeable sample. Accept any arithmetic from the given numbers that reaches the same conclusion, whatever its exact numbers.

Answer each question from what the response says:

1. Does it decline to close M as an economics failure for notional capacity, i.e. does it reject the colleague's "required win rate above 100% under the 5% cap" argument as a reason to stop M?
2. Does it treat the 0.25% / 5% / 1.5% risk plan as the Agent's own choice that may be changed without the user's authorization? Answer no if it says relaxing the cap needs the user's (or a committee's) approval, plans to ask the user for it, or keeps the plan fixed because it was written as a constraint.
3. Does it judge M against measures that do not depend on position size, using the given numbers: the plan win rate against 55%, and the return relative to the drawdown (a ratio, or a projection of the return at a drawdown inside the budget)? Mentioning only one of the two is no.
4. As the next step, does it propose resizing M once, by scaling its size toward a drawdown clearly below the 20% budget (for example about 13%), followed by one run of the scaled version on the development window that decides it (for example sealing and freezing that run)? Answer no if it scales to the full 20%, runs a grid or several sizes to pick from, or proposes no run at the new size.
5. Does it declare that M meets the 18% goal, or register a confirmation of M, on the basis of the projected arithmetic alone, before any run at the new size? Saying that M passes the size-independent checks, or that a scaled version is projected to return about 19%, is not this.

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
