# Portfolio

## Responsibility

Project current account, position, exposure, performance, and capacity facts from committed execution and market valuation inputs. Portfolio is account truth for product decisions; it does not allocate capital, permit trades, or own venue effects.

## Authoritative facts owned

- Account State: balances, positions, margin, equity, realized and unrealized PnL, bound to one Execution Scope and account namespace.
- Exposure by account, asset, strategy, direction, currency, and relevant risk dimension.
- Performance Receipt by strategy generation and governed time window, bound to its exact Execution Scope, Execution and account fact cut, valuation and methodology versions, capital at risk, and freshness.
- Exposure Receipt by strategy generation, bound to its exact Execution Scope, account and exposure fact cut, valuation and methodology versions, exposure dimensions, limit context, and freshness.
- Portfolio Lifecycle Evidence Receipt binding the target Execution Scope, exact Capacity View, and when required the Performance and Exposure Receipt identities. Every source field must equal its corresponding namespace; `INITIAL_ACTIVATION` needs compatible capacity but no invented performance history, while `PROMOTION` also requires exact fresh performance and exposure evidence under its `PROMOTION` transition-evidence key.
- Immutable Capacity Scope identity for one account, one `PAPER` or `LIVE` mode, and one economic pool. It never contains a strategy or generation. Every shared or indivisible gross constraint maps to one and only one such key; Paper and Live keys are distinct, and unknown overlap is unavailable rather than guessed disjoint.
- Capacity View bound to that Capacity Scope, exact account and collateral fact cut, valuation version, liquidity input cut, candidate-neutral pool methodology and assumption versions, gross ceilings by dimension and unit, measurement time, and validity deadline.
- Portfolio Risk Evidence Bundle binding the same Capacity Scope and one coherent cut of projected exposure,
  open orders, account state, valuation, and every incorporated Execution settlement lineage. It reports facts,
  never Risk commitment usage or remaining headroom.
- Portfolio Interaction Receipt for the exact complete contender set and common Capacity Scope, valuation,
  methodology, assumption, source, and Time Evidence cuts. Its receipt state is `CURRENT`, `INSUFFICIENT`, `STALE`,
  or `AMBIGUOUS`; under one versioned classification policy every contender receives exactly one
  `DIVERSIFYING`, `NEUTRAL`, `CONCENTRATING`, or `UNDETERMINED` class with decisive correlation, concentration,
  directional, tail, diversification, and marginal-value evidence. Portfolio reports facts without ranking
  contenders or allocating capital.
- The Portfolio Lifecycle Evidence Receipt is also Portfolio's sole degradation-attribution authority. Observed
  return decay, drawdown, exposure concentration, slippage, or valuation loss are symptoms, not root causes. An
  adverse receipt binds the exact generation, benchmark and measurement window, decisive Performance, Exposure,
  Capacity, market, valuation, Execution, fee, slippage, and capital-at-risk evidence cuts, methodology, policy,
  thresholds, and shared Time Evidence.
- Its attribution state is `RESOLVED_ONE` for exactly one separately supported named category, `RESOLVED_MANY` for
  at least two separately supported named categories, or `UNRESOLVED` with only `MULTI_CAUSE_UNRESOLVED` and the
  complete non-isolating evidence set. A non-adverse transition uses `NOT_APPLICABLE` with an explicit basis. The
  named categories are `STRATEGY_MECHANISM_DEGRADATION`, `MARKET_REGIME_CHANGE`,
  `EXECUTION_QUALITY_DEGRADATION`, `DATA_QUALITY_DEGRADATION`, `CAPACITY_OR_LIQUIDITY_COMPRESSION`,
  `PORTFOLIO_INTERACTION_DEGRADATION`, and `VALUATION_UNCERTAINTY`. Portfolio never discards a supported second
  cause or chooses a convenient strategy narrative.

Every named cause must be supported by its native source facts at one exact generation, Execution Scope,
Capacity Scope, account, valuation, source-frontier, and Time Evidence common cut:

| Cause                               | Required source authority and decisive evidence                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRATEGY_MECHANISM_DEGRADATION`    | R&D Research Intent plus Portfolio Performance Receipt: frozen prediction and falsifier versus performance deviation after separately supported regime, data, execution, capacity, interaction, and valuation alternatives are preserved. |
| `MARKET_REGIME_CHANGE`              | Market Data PIT Snapshot and Valuation Facts plus Portfolio Performance Receipt: versioned regime-boundary membership and matched response, not a later correction or execution-only symptom.                                             |
| `EXECUTION_QUALITY_DEGRADATION`     | Execution Account Fact plus Portfolio Performance Receipt: the complete non-`NONE_OBSERVED` category set, per-category decisive evidence, and performance impact at one effect frontier.                                                  |
| `DATA_QUALITY_DEGRADATION`          | Market Data PIT Snapshot plus Portfolio Performance Receipt: an Owner-owned gap, correction, rights, or PIT semantic defect and bounded affected performance lineage.                                                                     |
| `CAPACITY_OR_LIQUIDITY_COMPRESSION` | Portfolio Capacity View, Market Data Valuation Facts, Performance Receipt, and Exposure Receipt under one methodology, policy, and threshold version.                                                                                     |
| `PORTFOLIO_INTERACTION_DEGRADATION` | Current Portfolio Interaction, Performance, and Exposure Receipts for the complete contender set and its marginal impact.                                                                                                                 |
| `VALUATION_UNCERTAINTY`             | Market Data Valuation Facts plus Portfolio Performance and Exposure Receipts: explicit uncertainty state, methodology, source frontier, and bounded impact.                                                                               |

Missing, stale, mixed-cut, unsupported, or non-isolating evidence commits `UNRESOLVED`; it never selects the most
convenient named cause. Every independently supported simultaneous named cause remains in one unique supported
category set with its own evidence. `MULTI_CAUSE_UNRESOLVED` is exclusive and represents only the complete
non-isolating evidence set; it cannot coexist with a named cause.

- `PORTFOLIO_INTERACTION_DEGRADATION` additionally binds the exact `CURRENT` Portfolio Interaction Receipt for the
  same Capacity Scope, complete contender set, valuation and methodology cuts, and shared Time Evidence. Missing,
  stale, ambiguous, or mismatched interaction evidence can support only `UNRESOLVED`. When interaction is not
  decision-relevant, the lifecycle receipt records an explicit no-interaction-dependency basis that cannot coexist
  with a claimed interaction cause.
- `EXECUTION_QUALITY_DEGRADATION` additionally requires one exact current non-`NONE_OBSERVED` Execution Quality
  Observation for the same generation, Execution Scope, Capacity Scope, effect namespace, policy, source frontier,
  and Time Evidence cuts. A missing, stale, mismatched, unavailable, or `NONE_OBSERVED` observation can support only
  `UNRESOLVED`, never execution-quality attribution.

## Modules

- **Account State** — combine committed account and fill facts with current valuation inputs into positions, balances, margin, PnL, and equity.
- **Exposure** — project asset, strategy, directional, and currency exposure using current contract and valuation facts.
- **Performance** — derive a versioned Performance Receipt with strategy return, drawdown, stability, actual capital at risk, methodology, input cut, and freshness.
- **Capacity View** — project a candidate-neutral gross economic ceiling for the Capacity Scope. A separate
  Portfolio Risk Evidence Bundle carries one coherent source cut to Risk. Portfolio never subtracts Risk Reservation liability, computes remaining headroom, allocates
  capital, or authorizes deployment.

## Input handoffs

- [Execution](../execution/) supplies order, fill, fee, account, and reconciled venue readback facts.
- [Market Data](../market-data/) supplies prices, FX rates, contract specifications, valuation facts, and identified liquidity source cuts.

## Output handoffs

- To [Strategy Governance](../strategy-governance/) before any Paper or Live Execution Scope exists: one immutable
  `BOUND` Capacity Scope with exact account namespace, mode, economic pool, and disjoint shared-constraint proof.
  Missing, stale, overlapping, cross-mode, or unknown membership creates no Execution Scope or Capital Envelope.
- To [Risk](../risk/): one current gross-ceiling Capacity View plus one Portfolio Risk Evidence Bundle for the
  same Capacity Scope. The bundle carries coherent projected exposure, open orders, account/valuation cut, and
  incorporated Execution settlement lineages. Portfolio never reads Risk state or subtracts Reservation
  commitments; Risk alone combines the bundle with its liabilities and computes remaining headroom.
- To [Strategy Governance](../strategy-governance/): one Portfolio Lifecycle Evidence Receipt binding a compatible Capacity View and, for `PROMOTION`, exact fresh Performance and Exposure feedback under the `PROMOTION` transition-evidence key.
- To [Strategy Governance](../strategy-governance/): one Portfolio Interaction Receipt for every set-wide Capital
  Allocation Disposition and the same Portfolio Lifecycle Evidence Receipt for lifecycle attribution. Governance
  owns contender ranking and lifecycle action; Portfolio supplies only coherent source facts and attribution.
- To [Scanner](../scanner/): a bounded Capacity View used only as a proposal hint.
- To [Execution](../execution/) during recovery: the reconciled account closure projection for the Recovery Case.
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

- **Inputs** — committed Execution account, order, fill, fee, settlement and readback facts plus current Market
  Data valuation, FX, contract and liquidity facts on one coherent cut.
- **Diagnosis and decision** — project account, exposure, performance, capacity, interaction and degradation facts;
  Portfolio decides factual availability and attribution status, not capital or trading permission.
- **Conflict resolution** — source Owner facts and newest coherent cut outrank local projection; mixed cuts,
  unresolved overlap, and conflicting valuation stay unavailable.
- **Outputs and terminal negatives** — versioned receipts or `PARTIAL`, `STALE`, `UNAVAILABLE`,
  `INCOMPLETE_FAIL_CLOSED`, and unresolved attribution with exact missing causes.
- **Feedback and economic meaning** — reveal real PnL, exposure, marginal portfolio value, capacity compression and
  degradation so Governance can allocate and retire capital from economic facts.
- **Prohibitions** — no venue effect, allocation, remaining Risk headroom, permit, lifecycle transition, order, or
  Recovery closure.

## Subsequent implementation acceptance

- Every position, balance, and PnL value resolves to committed Execution facts and identified valuation inputs.
- Every Portfolio View resolves to one trusted principal, authorized account and Execution Scope, authorization-policy cut, and one coherent Portfolio snapshot
  cut and valid-through time. Missing or mixed source cuts remain `INCOMPLETE_FAIL_CLOSED` or `UNAVAILABLE`; a view cannot synthesize Risk headroom or
  authorization from Portfolio facts.
- Cross-principal, cross-account, cross-mode, stale-policy, or conflicting replay of a stable read request is rejected without returning a view.
- Every account, exposure, performance, and lifecycle receipt preserves the exact generation, mode, account namespace, and source effect namespace.
- Current exposure changes when price, FX, contract, or account facts change, with freshness visible.
- Capacity View is distinguishable from Governance's Capital Envelope chain and Risk's Aggregate Commitment Frontier and permission: it is a Portfolio-owned gross ceiling, not remaining headroom.
- Every Portfolio Risk Evidence Bundle is a coherent source cut for one Capacity Scope and repeats each
  incorporated Execution settlement lineage exactly once; delayed or partial bundles are unavailable for
  liability replacement rather than spliced with another cut.
- `AVAILABLE` Capacity View proves the immutable account-plus-mode economic-pool Capacity Scope, gross ceilings by dimension and unit, and every source input. A strategy- or generation-bearing scope, Paper/Live alias, unresolved shared-constraint overlap, or missing, partial, expired, unavailable, or mismatched input cannot support a required Scanner match, Governance add-risk transition, or Risk allow decision.
- Performance is explicitly `AVAILABLE`, `PARTIAL`, `UNAVAILABLE`, or `STALE`; only provenance-complete fresh receipts may support `PROMOTION`.
- `INITIAL_ACTIVATION` requires a fresh compatible Capacity View but no fabricated performance history. `PROMOTION` additionally requires fresh exact Performance and Exposure Receipts under its `PROMOTION` evidence key. `PAUSE`, `REDUCTION`, and `RETIREMENT` remain available when capacity evidence is absent.
- A Performance Receipt from another generation, Execution Scope, measurement window, execution or account cut, valuation version, or methodology version makes the lifecycle receipt non-`AVAILABLE`; facts from different frontiers or Paper and Live namespaces cannot be spliced.
- A Performance Receipt with mismatched capital at risk or freshness, or an Exposure Receipt with a mismatched generation, Execution Scope, fact cut, valuation or methodology version, exposure dimensions, limit context, or freshness, also makes the lifecycle receipt non-`AVAILABLE`.
- Recovery closure cannot proceed while affected account or valuation facts remain unknown.
- Every set-wide allocation reads one complete Portfolio Interaction Receipt with the same contender set and cut;
  a missing contender, mixed valuation frontier, or unresolved overlap cannot be treated as independent capacity.
- Every contender in a `CURRENT` Interaction Receipt has exactly one policy-versioned interaction class and
  decisive evidence cuts. Missing, duplicate, stale, mixed-cut, or non-isolating evidence is `UNDETERMINED`, never
  silently neutral; reordering the same set preserves identity, while membership change creates a successor.
- Every degradation conclusion is carried only by the Portfolio Lifecycle Evidence Receipt and remains traceable
  to exact source cuts and its attribution state. `RESOLVED_ONE` has one supported category, `RESOLVED_MANY` keeps
  every separately supported category, and `UNRESOLVED` cannot be converted into a deterministic Governance cause.
- Every named degradation category proves its category-specific source Owner objects and decisive evidence on the
  same generation/scope/account/valuation/frontier/time cut. A missing, mixed, or unsupported cause is
  `UNRESOLVED`, while simultaneous supported causes remain a set rather than being collapsed by precedence.
- The same performance symptom can map to different supported causes. Execution-quality deterioration requires
  one matching current non-none Execution observation, market-regime change requires identified Market Data facts, and mechanism degradation requires
  evidence that survives those alternatives; an observed drawdown alone proves none of them.

## Observability and persistence

Portfolio persists valuation-linked account state, Performance, Exposure, Capacity, Interaction, attribution, and lifecycle-evidence receipts under exact account/scope/mode/time cuts. Telemetry records projection latency, source freshness, valuation gaps, attribution completeness, and bounded degradation category. Dashboard PnL, drawdown, exposure, capacity, interaction, and strategy-duration views cite the underlying receipts and freshness; observed telemetry or a graph trend cannot create an attribution, capital decision, lifecycle change, or Risk capacity proof.
