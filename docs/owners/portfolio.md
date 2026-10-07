# Portfolio

## Responsibility

Project current account, position, exposure, performance, and capacity facts from committed execution and market valuation inputs. Portfolio is account truth for product decisions; it does not allocate capital, permit trades, or own venue effects.

## TARGET - Account facts for dynamic allocation

The target trading account is dedicated to product-managed orders and positions. Deposits and withdrawals are
account funding events, not strategy trades. Unexpected orders/positions or missing ownership are reconciliation
evidence; Portfolio includes their actual account exposure without inventing strategy attribution. Reconciliation
and effect custody use native account/Execution paths; this does not establish a parallel ledger or manual-trading
management capability.

Valuation and margin reads first reuse `crates/portfolio/src/portfolio.rs`, native account models and cache.
The current target-set Host manually totals snapshot equity under one Margin account/currency; this does not
prove general multi-currency valuation integration. Extend via native accounts/Portfolio with explicit missing
price, FX and margin-model refusals, without promoting that local formula into another ledger.

Reuse native accounts, cache, events and valuation for one fresh account view. Net equity supplies Governance
allocation inputs; account free margin and actual usage constrain Risk admission. Do not interchange these values.
Execution adapters and reconciliation admit account updates. Funding decisions read exact versions, times and scopes;
stale or conflicting facts restrict new risk under existing rules. Each strategy or module need not query the exchange
independently; refresh through the common adapter path when needed. Portfolio neither computes strategy headroom
nor duplicates deductions for accounted orders or Risk reservations, and adds no second account ledger.

## Authoritative facts owned

- Account State: balances, positions, margin, equity and realized/unrealized PnL, bound to the exact account namespace and Execution Scope.
- Exposure and Performance: projections by account, asset, strategy generation, direction, currency and window, bound to native Execution facts, valuation/FX, instrument precision, actual capital at risk, deterministic method version and freshness. Definition changes create successor versions; old receipts and mixed method/source cuts are not rewritten or combined.
- Capacity Scope: immutable account, PAPER/LIVE mode and economic-pool identity, without strategy/generation. Indivisible gross constraints share one key; modes are isolated and unknown overlap remains unavailable.
- Capacity View: candidate-independent gross ceilings bound to account/collateral, valuation, liquidity, methods/assumptions, dimensions/units, measurement time and validity.
- Portfolio Risk Evidence Bundle: one Capacity Scope's consistent projected exposure, open order, account valuation and incorporated settlement lineage, without Risk commitment usage or remaining headroom.
- Exact Capacity/Performance/Exposure references needed by lifecycle conditions. INITIAL_ACTIVATION invents no performance history; PROMOTION consumes exact fresh performance/exposure.

Portfolio supplies reproducible facts and explicit availability. Scientific causes, mechanism degradation and marginal-value explanations belong to the Agent. Governance executes user-frozen numerical or state conditions. Default equal shares among actually running members do not require an Interaction Receipt.
Old `PortfolioInteractionReceipt` / degradation classes have no types or custody and are not target authorities. An explicitly approved condition requiring interaction measures consumes deterministic calculations with complete members, methods and source cuts; missing evidence cannot imply NEUTRAL, independence or mechanism failure.

## Modules

- **Account State** - combine committed account and fill facts with current valuation inputs into positions, balances, margin, PnL, and equity.
- **Exposure** - project asset, strategy, directional, and currency exposure using current contract and valuation facts.
- **Performance** - derive a versioned Performance Receipt with strategy return, drawdown, stability, actual capital at risk, methodology, input cut, and freshness.
- **Capacity View** - project a candidate-neutral gross economic ceiling for the Capacity Scope. A separate
  Portfolio Risk Evidence Bundle carries one coherent source cut to Risk. Portfolio never subtracts Risk Reservation liability, computes remaining headroom, allocates
  capital, or authorizes deployment.

## Implementation status ledger

This ledger records only what the repository has reached at this cut. It uses the status vocabulary of the
[Market Data](./market-data/) ledger, with `CURRENT_PARTIAL` as the merged-but-unreachable form, and grants no
permission by itself. The rows marked `IMPLEMENTATION_ADMITTED` below are the only admitted slices, each admitted as bounded, separately reviewable work whose acceptance is an isolated PostgreSQL proof, its ordered-chain
entries passing on Linux, and a production path that depends on no testkit or acceptance feature; every other row
grants nothing, and widening the admitted set requires changing this document first.

- **CURRENT_PARTIAL / IMPLEMENTATION_ADMITTED - Capacity Scope contract:**
  `crates/portfolio_owner/src/capacity_scope.rs` owns the untrusted request vocabulary, the complete-registry
  resolution rule, and the sealed `BoundCapacityScopeReadback` that only that rule can mint; the public
  `resolve_capacity_scope` stays the fail-closed `Discovery` boundary.
  `crates/portfolio_owner/src/capacity_scope_postgres.rs` is the production Owner store: PostgreSQL custody under
  `portfolio_private` holding the append-only registry of complete membership censuses, its head, the sealed
  readbacks, and the read-only `portfolio_api` function Strategy Governance resolves a `BOUND` scope through. A cut
  is immutable once committed and recommitting the same census joins the current head. Its `#[ignore]` proof runs
  against the canonical Owner PostgreSQL topology. No deployed binary composes it yet, so it holds no production
  composition root or reachable consumer.
- **CURRENT_PARTIAL - Portfolio View R0 contract:** `crates/portfolio_owner/src/portfolio_view.rs` owns the request
  fingerprint, replay classification, per-source-Owner dependency kinds, and the fail-closed `resolve_portfolio_view`
  that returns an `UnavailablePortfolioView`; no positive source resolver exists.
  `crates/portfolio_owner/tests/portfolio_view_contract.rs` proves it. The `portfolio:view` resource grant in
  `crates/operator_authorization` resolves through the Operator Authorization Issuer PostgreSQL custody, but no
  Product Edge route serves a Portfolio View.
- **TARGET - Account State, Exposure, Performance Receipt, and Exposure Receipt:** the inherited `Portfolio` in
  `crates/portfolio/src/portfolio.rs` and `crates/portfolio/src/manager.rs` computes positions, balances, margin,
  and PnL from engine cache events for the inherited kernel, Backtest, and live-node compositions; it is the
  adoption source and binds no Execution Scope, receipt, valuation version, or freshness.
- **CURRENT_PARTIAL / IMPLEMENTATION_ADMITTED - Capacity View:** `crates/portfolio_owner/src/capacity_view.rs` owns
  the sealed view and the one methodology this slice admits, `paper-collateral-gross-ceiling.v1`: for a simulated
  `PAPER` pool denominated in the same currency as the account's collateral, the gross ceiling is that collateral
  and no liquidity constraint compresses it. Valuation is the identity map because the two currencies are the same,
  and the view binds an explicit identity for that declared absence of a liquidity input rather than an empty field.
  A pool in any other currency fails closed until a Market Data valuation fact exists. The ceiling comes from
  Execution's own committed opening account fact, read inside the commit transaction through the Execution Owner's
  read-only API, never from a caller assertion. `crates/portfolio_owner/src/capacity_scope_postgres.rs` stores the
  views and exposes the `portfolio_api` function Strategy Governance rereads the current ceiling through. Portfolio
  subtracts no Reservation liability and computes no remaining headroom here.
- **TARGET - Portfolio Risk Evidence Bundle:** no coherent source cut of projected exposure, open orders, account
  state, and incorporated settlement lineages exists, so Risk has no bundle to combine with its liabilities.
- **Unimplemented:** Portfolio Lifecycle Evidence Receipt has no type or custody. Old Portfolio Interaction Receipt and degradation attribution also have no types/custody and are not default allocation targets.
- **CURRENT_PARTIAL - read port to Governance:** the Owner's own migration in
  `crates/portfolio_owner/src/capacity_scope_postgres.rs` creates `portfolio_api.read_bound_capacity_scope_v1` and
  `portfolio_api.read_current_capacity_view_v1` and grants both to `governance_writer`, which is also the only role
  granted `USAGE` on the schema, in `database/postgres-init/10-migrate-authority-custody.sh`. A second
  consumer therefore needs two grants in two places, neither of which is a function that has still to be written.
- **TARGET - remaining handoffs and persistence:** no port to Risk, Scanner, Execution, or Product Edge, and no
  durable relation for any Portfolio fact outside the Capacity Scope registry and PAPER Capacity View custody above.

## Input handoffs

- [Execution](./execution/) supplies order, fill, fee, account, and reconciled venue readback facts.
- [Market Data](./market-data/) supplies prices, FX rates, contract specifications, valuation facts, and identified liquidity source cuts.

## Output handoffs

- To [Strategy Governance](./strategy-governance/) before any Paper or Live Execution Scope exists: one immutable
  `BOUND` Capacity Scope with exact account namespace, mode, economic pool, and disjoint shared-constraint proof.
  Missing, stale, overlapping, cross-mode, or unknown membership creates no Execution Scope or Capital Envelope.
- To [Risk](./risk/): one current gross-ceiling Capacity View plus one Portfolio Risk Evidence Bundle for the
  same Capacity Scope. The bundle carries coherent projected exposure, open orders, account/valuation cut, and
  incorporated Execution settlement lineages. Portfolio never reads Risk state or subtracts Reservation
  commitments; Risk alone combines the bundle with its liabilities and computes remaining headroom.
- To [Strategy Governance](./strategy-governance/): one Portfolio Lifecycle Evidence Receipt binding a compatible Capacity View and, for `PROMOTION`, exact fresh Performance and Exposure feedback under the `PROMOTION` transition-evidence key.
- To [Strategy Governance](./strategy-governance/): account net equity, exact Capacity View, actually running member occupancy and fresh Performance/Exposure for approved pool ratios and equal shares. A joining member waits until all existing occupancy fits the reduced share; Governance commits allocation atomically. Only an explicitly approved interaction-sensitive condition needs deterministic interaction measures, without scientific classification receipts.
- Legacy handoff to [Scanner](./scanner/): a bounded Capacity View used only as a proposal hint. This preserves old receipts, not a new scheduled discovery or deployment path.
- To [Execution](./execution/) during recovery: the reconciled account closure projection for the Recovery Case.
- To Product Edge: one bounded Portfolio View keyed by stable request, trusted principal, authorized account and Execution Scope, authorization-policy cut, and Portfolio
  snapshot cut plus projection and valid-through times. It reports `AVAILABLE`, `INCOMPLETE_FAIL_CLOSED`, `STALE`, or `UNAVAILABLE` account, exposure, performance, and
  capacity projections with source-fact references and freshness. It never reports Risk Reservation state,
  remaining headroom, a Risk Decision, or permission to deploy or trade.

## Rejections and prohibitions

- Never manufacture valuation when required prices, FX rates, or contract terms are unavailable.
- Never allocate capital, maintain the Aggregate Commitment Frontier, subtract open orders or Reservation liabilities from Capacity View, activate a strategy, issue a Risk Decision, or create an order command.
- Never treat local order intent as an account effect before committed Execution facts arrive.
- Never join Paper and Live account or effect namespaces, or use a cross-scope fact in Risk or Governance feedback.
- Never choose a generation or strategy-specific economic condition for a pool. Deployment configuration first
  admits an immutable account, mode, economic-pool, source, and adapter binding; Portfolio derives the
  candidate-neutral Capacity Scope and publishes its gross ceiling before Governance may bind a generation to it.
  Generation-specific economics remain in Qualification evidence and Governance Capital Envelopes.
- Never declare Recovery Case closure; it supplies one required closure projection.
- Never infer one strategy's marginal value from isolated performance when contender interaction facts are
  unavailable, and never collapse unresolved degradation into a mechanism failure. Missing or conflicting source
  cuts yield unavailable or unresolved receipts.
- Never turn missing or ambiguous interaction evidence into `NEUTRAL`, or an incomplete execution observation into
  `NONE_OBSERVED` or `EXECUTION_QUALITY_DEGRADATION`.

## Failure and recovery

Missing or stale valuation inputs make affected measures explicitly unavailable rather than silently carrying a misleading value. Divergence between projected account state and venue readback is a reconciliation drift. During recovery, Portfolio recomputes from reconciled Execution facts and current valuation inputs, then returns a closure projection without resuming trading.

## Decision contract

- **Input:** consistent Execution account/order/fill/fee/settlement/readback facts and Market Data valuation, FX, terms and liquidity.
- **Calculation:** reuse native Portfolio/cache for versioned accounts, performance, exposure and gross capacity. Portfolio decides availability, not scientific causes, capital or trading authority.
- **Conflict:** source facts outrank local projections; mixed cuts, stale input, unresolved overlap or valuation conflicts return PARTIAL/STALE/UNAVAILABLE/INCOMPLETE_FAIL_CLOSED.
- **Consumers:** the Agent interprets research, Governance executes approved conditions, and Risk combines its actual liability to compute headroom. A recovery projection does not close a Recovery Case.

## Subsequent implementation acceptance

- Positions, balances, PnL and metrics are reproducible from exact Execution, Market Data, valuation and method versions, without mixing accounts, generations, windows or PAPER/LIVE namespaces.
- Portfolio View binds trusted principal, authorization scope, consistent source cut and valid-through. Cross-account, expired, conflicting or missing-source reads refuse, without synthesizing authority or Risk headroom.
- Capacity Scope preserves account/mode/pool, shared constraints, dimensions and units. Capacity View is a gross ceiling; the Risk bundle incorporates each settlement lineage once without subtracting Risk liability.
- INITIAL_ACTIVATION needs compatible fresh capacity; PROMOTION additionally needs exact fresh performance/exposure. Missing capacity cannot prevent PAUSE/REDUCTION/RETIREMENT or protection of real positions.
- Default equal shares consume approved pool ratios, actually running members and occupancy. Before joining, every existing occupancy must fit the reduced share; Governance commits allocation atomically. Interaction classification and degradation root causes are not mandatory.
- Explicit interaction conditions consume their declared deterministic measures and complete sources only. Missing, ambiguous or mixed evidence cannot mean neutral/independent, and explanations create no capital/trading authority.
- Unknown account/valuation sources keep recovery projections unavailable and do not close real liability.

## Observability and persistence

Retain native account facts and valuation/method-bound Performance, Exposure, Capacity and condition-measure references at the exact account/scope/mode/time cut. Telemetry records projection delay, freshness and gaps; charts reference source facts and create no scientific attribution, allocation, lifecycle authority or Risk capacity proof.
