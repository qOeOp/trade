# Duty directory

Each duty gives its question and its boundary.
The four hard contracts (E1, E4, F5, H2) can never be `not applicable`.

Duties locate policy responsibilities, not independent factors or implementation proofs. `adopted`:
the strategy has a rule that decides the question, whoever chose it. `default`: the question arises
and the strategy has no rule for it; say what happens instead, such as what the engine does on its
own. `not applicable`: no rule could decide it on this line's instruments; a method the strategy
leaves unused is `default`. A line without a rule still names in its source label who judged so.
Apply the boundary of each duty when one action affects several responsibilities.

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

**Boundary** The common set the data can supply is not a result of strategy selection; eligibility is not a return ranking. Affects B, D, H.

#### A2 Dynamic selection and replacement: among eligible instruments, which to pick and which to drop?

**Boundary** A single-asset directional signal is not automatically contract selection; exiting old members is decided separately by F. Affects E competition for capital.

#### A3 Market-structure / condition filter for the mechanism: does the current market suit this kind of return mechanism?

**Boundary** An economic filter is different from a network not being connected or an indicator not yet warmed up.

### B Forecasting and learning

#### B1 Expected return / relative mispricing: which future return or convergence is worth bearing?

**Boundary** This is not order placement; time-series direction, cross-sectional relative rank and returns conditional on an event completing cannot substitute for one another.

#### B2 Forecast horizon and decay: how long does the return persist, and does waiting consume the opportunity?

**Boundary** A maximum holding time is only one method; the horizon changes the speed of adding and reducing and the tolerance for trading costs.

#### B3 Signal combination and estimate updating: how are multiple forecasts and hedge relationships combined, and when are they re-estimated?

**Boundary** Combining alpha is different from allocating capital across strategies; model failure cannot be absorbed by enlarging "other".

### C First action and memory

#### C1 First entry and trigger: when is an opportunity turned into new risk?

**Boundary** "Having a signal" does not mean being filled; keep trigger price and fill price separate.

#### C2 Inaction, re-entry and path dependence: should the strategy still wait when an opportunity exists, and when may it trade again after exiting?

**Boundary** Not trading is an observable decision; historical trade state is not a research-history veto gate.

### D Economic structure

#### D1 Single-leg / multi-leg structure: which contracts, in what quantity ratios, realize the required return?

**Boundary** Running several assets in parallel is not necessarily multi-leg; a native partial fill is only an execution fact, to be handled by F/H.

#### D2 Hedging and nonlinear exposure: whether, when and how much to hedge risk, and whether to retain some risks?

**Boundary** A single notional amount cannot summarize nonlinear risk; when all contracts are linear perpetuals, option-type methods do not apply, but a hedging frequency set jointly by cost and position still applies.

### E Risk and allocation

#### E1 Per-opportunity risk and size (hard contract): how much size / stop risk does one opportunity bear?

**Boundary** Stop distance and size are coupled and cannot be computed separately; distinct from the native margin balance.

#### E2 Portfolio exposure, concentration and common risk: how much gross, net, directional, correlated-group or factor risk does the whole account bear?

**Boundary** Several individually valid opportunities do not make a valid combination; interacts with H capital and D leg vectors.

#### E3 Risk budget after equity changes: after losses/gains, does the scale of future risk change?

**Boundary** The user's research targets do not change because of this; linked with E1 and H reserves.

#### E4 Allocation across opportunities / strategies (hard contract): among candidates competing at the same time for the same risk, capital or liquidity, which gets how much first?

**Boundary** Cannot be replaced by loop order or engine order rejection.

### F Position path

#### F1 Active scaling in and adding: reach the target at once, or add unit by unit after market confirmation?

**Boundary** Passive partial fills do not count as active scaling; state explicitly that adds are keyed to the previous actual fill.

#### F2 Active reduction and position path: how much should be reduced now, and how fast should the position move toward the new target?

**Boundary** Different from a one-off exit; costs can make the position lag the forecast.

#### F3 Dynamic protective / profit boundaries: once in a position, how do loss or profit boundaries adjust with the path, volatility, adds or new structure?

**Boundary** This is a choice of economic boundary; actual order coverage/replacement is an engineering and execution obligation.

#### F4 Full exit, timed exit and post-exit cleanup: when the return logic ends, converges, reaches its deadline or an event fails, is everything closed?

**Boundary** Exiting all units, exiting on portfolio convergence and exiting on delisting are different methods; cleaning up leftover orders after a native close cannot pass for economic coverage.

#### F5 Handling existing holdings on membership / model change (hard contract): when a contract leaves the universe, or the conditions that admitted an entry stop holding, are old positions/orders kept, reduced or exited?

**Boundary** An A selection only decides the future set and cannot silently remove existing holdings. Answer both cases.

### G Implementation

#### G1 Execution style and price: take or make, how far to quote, which side and how much, how many price levels?

**Boundary** The two-sided quotes of inventory market making are not traditional independent buy and sell signals.

#### G2 Waiting, refreshing and post-fill feedback: is the original quote still worth waiting on, when to cancel/amend, and after a fill whether to cool down / keep the other side?

**Boundary** Economic refresh tolerance and cooldown differ from the state safety of having to wait for an ack.

#### G3 Impact, capacity and implementation speed: how fast is it worth building/exiting, and does the strategy's own not-yet-decayed impact change the target?

**Boundary** This is not rebuilding matching or privately computing actual fills.

### H Capital

#### H1 Cash, financing and carry costs: after costs, is the opportunity still worth holding, and how much cash to keep?

**Boundary** "Zero cost / zero net notional" does not mean zero capital usage.

#### H2 Margin, collateral and buffers (hard contract): how much available capital to use for future new risk, and how to keep a buffer for losses/higher margin?

**Boundary** Engine order rejection is a consequence, not an allocation rule; financing constraints are independent of gross notional.

#### H3 Short availability and financing disruption: how to respond when financing is disrupted?

**Boundary** The facts of financing events belong to the engine/data; the economic response needs a strategy rule. On linear perpetuals, financing disruption and insufficient margin still apply.

### I Lifecycle and feasibility

#### I1 Contract / event lifecycle: how do expiry, rolls and delisting change the opportunity and the contract?

**Boundary** Forced settlement is an engine fact; choosing to exit early or to roll is the economic duty. Having no fixed expiry only rules out expiry, exercise and delivery methods; trading status and delisting still apply to perpetuals.

#### I2 Exit feasibility and future resources: can a position that looks favourable now be closed in the future, and will it crowd out later opportunities?

**Boundary** A terminal plan does not mean actually liquidating at horizon H.
