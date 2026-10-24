# Duty directory

Read when unsure which stance a duty should take in a strategy header (strategy-header.md). Each
duty gives its question, then I (inputs), S (state), O (output) and clock, and its boundary.
The four hard contracts (E1, E4, F5, H2) can never be `not applicable`.

Duties locate policy responsibilities, not independent factors or implementation proofs. A stance
names an explicit economic rule (`adopted`), a relevant baseline choice (`default`), or a structural reason
the economic question does not arise (`not applicable`). Distinguish strategy decisions from engine
guarantees, and apply the boundary of each duty when one action affects several responsibilities.

## Contents

- A Instruments and applicability: A1–A3
- B Forecasting and learning: B1–B3
- C First action and memory: C1–C2
- D Economic structure: D1–D2
- E Risk and allocation: E1–E4
- F Position path: F1–F5
- G Implementation: G1–G3
- H Capital: H1–H3
- I Lifecycle and feasibility: I1–I2

### A Instruments and applicability

#### A1 Investable instruments and eligibility: which assets, contracts or venues are eligible to carry the opportunity?

I=listing status at the time, prices, trades, borrow availability and history length; S=current eligible set; O=set allowed for research/trading; clock=membership/contract events or review date.

**Boundary** The common set the data can supply is not a result of strategy selection; eligibility is not a return ranking. Affects B, D, H.

#### A2 Dynamic selection and replacement: among eligible instruments, which to pick, which to drop, and which expiry month to choose?

I=cross-sectional rank/distance/relative strength and liquidity; S=existing members, intents selected but not yet filled; O=new members and the reasons for changes; clock=formation period/rebalance/simultaneous signals.

**Boundary** A single-asset directional signal is not automatically coin selection; exiting old members is decided separately by F. Affects E competition for capital.

#### A3 Market-structure / condition filter for the mechanism: does the current market suit this kind of return mechanism?

I=trend structure, residual reversion speed, volume, spread/depth; S=currently active model/condition; O=enable, down-weight, pause new risk; clock=new observation/structure confirmation.

**Boundary** An economic filter is different from a network not being connected or an indicator not yet warmed up. State whether existing positions are handled separately.

### B Forecasting and learning

#### B1 Expected return / relative mispricing: which future return or convergence is worth bearing?

I=available prices/financials/contract terms; S=estimation model; O=direction, strength, expected magnitude and the premises of confidence; clock=signal data update.

**Boundary** This is not order placement; time-series direction, cross-sectional relative rank and returns conditional on an event completing cannot substitute for one another.

#### B2 Forecast horizon and decay: how long does the return persist, and does waiting consume the opportunity?

I=forecasting factors and their reversion speed; S=signal age, expected future path; O=horizon-dependent target and urgency; clock=factor/time update.

**Boundary** A maximum holding time is only one method; the horizon changes the speed of adding and reducing and the tolerance for trading costs.

#### B3 Signal combination and estimate updating: how are multiple forecasts and hedge relationships combined, and when are they re-estimated?

I=individual factors, regression residuals, covariance; S=rolling window/fitted coefficients; O=combined forecast, updated beta/risk model; clock=estimation date.

**Boundary** Combining alpha is different from allocating capital across strategies; model failure cannot be absorbed by enlarging "other".

### C First action and memory

#### C1 First entry and trigger: when is an opportunity turned into new risk?

I=signal, threshold and price; S=flat/awaiting entry; O=initial target risk/trigger intent; clock=close, quote, breakout or event.

**Boundary** "Having a signal" does not mean being filled; keep trigger price and fill price separate.

#### C2 Inaction, re-entry and path dependence: should the strategy still wait when an opportunity exists, and when may it trade again after exiting?

I=costs, deviation from target, outcome of the last breakout; S=no-trade band/stopped-out units/skipped breakouts; O=hold, reactivate; clock=price crossing a boundary/outcome confirmation.

**Boundary** Not trading is an observable decision; historical trade state is not a research-history veto gate.

### D Economic structure

#### D1 Single-leg / multi-leg structure: which contracts, in what quantity ratios, realize the required return?

I=beta, pairs, exchange ratio/rights terms; S=target leg combination and native actual legs; O=joint target vector, tolerated imbalance; clock=construction and terms/model update.

**Boundary** Running several assets in parallel is not necessarily multi-leg; a native partial fill is only an execution fact, to be handled by F/H.

#### D2 Hedging and nonlinear exposure: whether, when and how much to hedge risk, and whether to retain some risks?

I=price/time/portfolio delta gamma, factor beta, cost; S=existing risk; O=target hedge leg or tolerance band; clock=price/time/risk change.

**Boundary** A single notional amount cannot summarize nonlinear risk; when all contracts are linear perpetuals, option-type methods do not apply, but a hedging frequency set jointly by cost and position still applies.

### E Risk and allocation

#### E1 Per-opportunity risk and size (hard contract): how much size / stop risk does one opportunity bear?

I=equity, N/volatility, multiplier, protection distance; S=committed units; O=unit size and risk budget; clock=before opening/before an active add.

**Boundary** Stop distance and size are coupled and cannot be computed separately; distinct from the native margin balance.

#### E2 Portfolio exposure, concentration and common risk: how much gross, net, directional, correlated-group or factor risk does the whole account bear?

I=risk of candidates and positions; S=whole-portfolio exposure; O=combined target and available risk budget; clock=any candidate/position change.

**Boundary** Several individually valid opportunities do not make a valid combination; interacts with H capital and D leg vectors.

#### E3 Risk budget after equity changes: after losses/gains, does the scale of future risk change?

I=native equity history and initial baseline; S=effective notional account size; O=new sizing baseline; clock=equity threshold/review date.

**Boundary** The user's research targets do not change because of this; linked with E1 and H reserves.

#### E4 Allocation across opportunities / strategies (hard contract): among candidates competing at the same time for the same risk, capital or liquidity, which gets how much first?

I=value/cost/correlation of all candidates; S=resources already occupied and committed by others; O=joint allocation, opportunities that received no resources; clock=same decision batch.

**Boundary** Cannot be replaced by loop order or engine order rejection.

### F Position path

#### F1 Active scaling in and adding: reach the target at once, or add unit by unit after market confirmation?

I=price path, actual previous fill price, remaining budget; S=filled batches/pending batches; O=new batch target; clock=new threshold/native fill confirmation.

**Boundary** Passive partial fills do not count as active scaling; state explicitly that adds are keyed to the previous actual fill.

#### F2 Active reduction and position path: how much should be reduced now, and how fast should the position move toward the new target?

I=changing alpha/cost/risk; S=native current position and existing commitments; O=target change, executing only the current step; clock=each re-evaluation.

**Boundary** Different from a one-off exit; costs can make the position lag the forecast.

#### F3 Dynamic protective / profit boundaries: once in a position, how do loss or profit boundaries adjust with the path, volatility, adds or new structure?

I=market path, unit fills, N; S=protection per batch, native net position; O=new exit boundaries and the quantity they must cover; clock=new structure/add confirmation.

**Boundary** This is a choice of economic boundary; actual order coverage/replacement is an engineering and execution obligation.

#### F4 Full exit, timed exit and post-exit cleanup: when the return logic ends, converges, reaches its deadline or an event fails, is everything closed?

I=opposite structure, equilibrium, deadline/event outcome; S=all legs, intents and orders; O=flatten target, termination criterion; clock=structure/time/event.

**Boundary** Exiting all units, exiting on portfolio convergence and exiting on delisting are different methods; cleaning up leftover orders after a native close cannot pass for economic coverage.

#### F5 Handling existing holdings on membership / model change (hard contract): after a new coin selection or loss of model eligibility, are old positions/orders kept, reduced or exited?

I=A/B changes; S=positions and open orders of old members; O=release of old resources/transition target; clock=membership/estimate update.

**Boundary** An A selection only decides the future set and cannot silently remove existing holdings.

### G Implementation

#### G1 Execution style and price: take or make, how far to quote, which side and how much, how many price levels?

I=alpha urgency, inventory, volatility, depth and cost; S=native open orders; O=quote/size/level targets; clock=market data/execution cycle.

**Boundary** The two-sided quotes of inventory market making are not traditional independent buy and sell signals.

#### G2 Waiting, refreshing and post-fill feedback: is the original quote still worth waiting on, when to cancel/amend, and after a fill whether to cool down / keep the other side?

I=new quotes, order age, fills; S=pending cancels and paired open orders; O=keep/replace/delay intent; clock=timer/fill/quote change.

**Boundary** Economic refresh tolerance and cooldown differ from the state safety of having to wait for an ack.

#### G3 Impact, capacity and implementation speed: how fast is it worth building/exiting, and does the strategy's own not-yet-decayed impact change the target?

I=cost matrix, market volume, impact decay; S=existing/expected impact; O=trade quantity for the current period and future plan; clock=each re-evaluation.

**Boundary** This is not rebuilding matching or privately computing actual fills.

### H Capital

#### H1 Cash, financing and carry costs: after costs, is the opportunity still worth holding, and how much cash to keep?

I=native cash, borrowing/stock-borrow rates, carry fees; S=all capital usage and unsettled fees; O=cost-adjusted target and cash reserve; clock=decision/financing settlement.

**Boundary** "Zero cost / zero net notional" does not mean zero capital usage.

#### H2 Margin, collateral and buffers (hard contract): how much available capital to use for future new risk, and how to keep a buffer for losses/higher margin?

I=native account, margin terms, stress changes; S=occupied capital/order commitments; O=available capital allocation and deleveraging target; clock=candidate/equity/margin change.

**Boundary** Engine order rejection is a consequence, not an allocation rule; financing constraints are independent of gross notional.

#### H3 Short availability and financing disruption: can the asset be borrowed, and how to respond when a borrow is recalled / financing is disrupted?

I=available borrow and financing terms; S=affected legs; O=stop adding/replace hedge/exit target; clock=availability/recall event.

**Boundary** The facts of financing events belong to the engine/data; the economic response needs a strategy rule. Borrow recall does not apply to linear perpetual candidates; financing disruption and insufficient margin still apply.

### I Lifecycle and feasibility

#### I1 Contract / event lifecycle: how do expiry, rolls, merger completion/cancellation and delisting change the opportunity and the contract?

I=known terms, trading/expiry dates, event outcomes; S=corresponding legs/opportunities; O=roll/convert/terminate target; clock=announcement/event/review.

**Boundary** Forced settlement is an engine fact; choosing to exit early or to roll is the economic duty. Having no fixed expiry only rules out expiry, exercise and delivery methods; trading status and delisting still apply to perpetuals.

#### I2 Exit feasibility and future resources: can a position that looks favourable now be closed in the future, and will it crowd out later opportunities?

I=forecast cost/liquidity/target; S=positions and planning horizon; O=limits on current trading/terminal target; clock=plan update.

**Boundary** A terminal plan does not mean actually liquidating at horizon H.
