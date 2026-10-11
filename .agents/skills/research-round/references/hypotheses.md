# Hypotheses and opening

Every research idea, yours or the user's, enters the knowledge list ([knowledge.md](knowledge.md))
as a hypothesis card. A card moves through four states:

- **draft**: the card and one coarse replay;
- **open**: refinement, any number of explorations;
- **frozen**: a candidate freeze ([feasibility.md](feasibility.md));
- **excluded**: its coarse replay or a later failure excluded the class the card named.

The opening criterion below governs only draft → open. Never write detailed rules, check sources
or screen with a proxy (price response, touch rates, event counts) before a draft has passed it.

## The card

Write four things before any replay:

1. **Economic rationale**: where the edge comes from and who pays for it (a forced or constrained
   counterparty, a risk premium, a behavioral pattern with a mechanism). "Price tends to respect
   levels" or "the source made money" is not a rationale.
2. **Falsifiable prediction**: a consequence of the rationale, other than "it makes money", that
   the same coarse replay can check, with the reading that refutes it.
3. **Frontier gap**: which gap of the current frontier it targets (plan win rate, return to
   drawdown, or both) and why the rationale should reach it. When the user chose to complement
   finished strategies, name them: the coarse replay still reads the card alone, but its frontier
   point and its freeze read one strategy file that trades it together with them on one account.
4. **Excluded class on failure**: the class of strategies the failure would exclude, defined by
   the rationale and the signal, never by this card's parameters, window or coins. A class that
   only contains this card excludes nothing.

Mark a card the user proposed `"proposed_by": "user"`; it takes the same review, the same replay
and its place in your order of priors. If the user's idea has no rationale you can state, tell
the user once and ask them to supply one; a low rank is reported at the next progress check, not
separately. Order drafts yourself by prior (the gap they target, prior evidence from
`research-sources`, distance from excluded classes); no approval is needed.

## Review before the coarse replay

Give the card to an independent sub-agent with a clean context and nothing but the card, the
frontier and the knowledge list; it sees no replay result of this card. It rejects the card
when:

- the rationale is boilerplate or reads as written after the fact;
- the prediction cannot be checked by the coarse replay;
- the excluded class is so narrow that it excludes only this card;
- the class duplicates an excluded class (a reopening follows the rule below).

Record its verdict and reasons in the card. A rejected card is closed and never replayed; a
rewritten card is a new card with a new review.

## Coarse replay

One exploration (`artifacts run --explore`, [runs.md](runs.md)) with simple sizing over the
knowledge list's whole window and whole coin pool. Read from its readings, cite its trial ID:
closed price PnL before fees, commissions, funding, closed plans, plan win rate and
`closed_by_year`. The card passes when all three hold:

1. closed price PnL before fees is above zero;
2. it stays above zero after removing the year with the largest price PnL;
3. the prediction held.

Costs are a refinement problem and do not decide this step. A null reading is an integrity problem:
fix the code, it is not an economic failure. Otherwise a card that fails any condition is
excluded: record its class with the scope the card wrote, the failed condition and the readings.

## Exclusion and reopening

The scope of an exclusion is the one the card wrote before its replay; it is never narrowed
afterwards. Reopening an excluded class takes a new card stating why the earlier failure does not
apply to it, reviewed like any card; its replays count as trials like any other.
