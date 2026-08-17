# Live automated trading scenario

Live trading automatically converts governed strategy signals into venue effects. It does not request human
approval for every order. Pre-approved lifecycle policy, independent pre-trade risk, permit binding, execution
ownership, readback, reconciliation, and recovery govern exposure and make effects accountable; they do not
guarantee a maximum realized loss.

## Entry / 入口

Strategy Governance authorizes an eligible strategy generation for live mode with an effective capital policy;
it does not start Runtime.
The decision binds a `LIVE` Execution Scope with venue-backed account and effect namespaces. The required market,
account, risk, execution, reconciliation, and recovery facts are available. `INITIAL_ACTIVATION` also binds a fresh
Portfolio Lifecycle Evidence Receipt containing a candidate-neutral gross Capacity View
compatible with that pre-existing Capacity Scope; later `PROMOTION` also requires fresh exact Performance and
Exposure Receipts under the `PROMOTION` transition-evidence key. Runtime commits an `APPLIED`
Generation Application Receipt binding exactly one Strategy Instance and checkpoint to that decision, generation,
scope, artifact, fence epoch, complete request Authorization Lineage, and explicit Autonomous Policy Authorization
before automated intent production begins. This policy authorizes bounded unattended intent production; a bare
Governance decision does not.
`INITIAL_ACTIVATION`, `PROMOTION`, `APPLIED`, and normal automated Live add-risk or venue effects
require `UNATTENDED_REQUEST_WITH_POLICY`. An `ATTENDED_REQUEST` is non-running and decrease-only; it cannot enter
Live unless a future separately specified attended-effect contract exists.

## Value path / 价值路径

Strategy Instance consumes live Market Data and emits Trade Intents automatically when strategy conditions
hold. Risk evaluates every intent and returns either a terminal rejection or a decision plus one-use reservation.
Runtime binds an allowed permit into an order command. Execution validates the exact binding and submits one stable
Reservation Claim Request. Only Risk `CONSUMED` permits Execution to journal one `PREPARED` attempt and send
`ADAPTER_ADMISSION_REQUEST`. Risk commits one immutable admission result in the same frontier
mutation that orders recovery fence activation; only `ADMITTED_ONCE` permits `INVOCATION_STARTED` and reaches the venue adapter.
Execution then writes the order lifecycle, reads back effects, and reconciles them. Execution reports settlement
facts to Risk and account facts to Portfolio. Risk alone transitions the Reservation; Portfolio
alone updates its account projection.
The request, principal, scope, admitted shell binding and history head, Operator Authorization, operation manifest,
and Autonomous Policy Authorization remain identical through Governance decision, Runtime intent, Risk permit,
Execution Effect Journal, and venue readback.

Normal decrease-only Live work uses a separate exact path: Governance decision → Runtime local suppression → Risk
`PERMIT_DECREASE_ONLY` → a command with explicit-none Reservation/claim → Execution `PREPARED` →
`ADAPTER_ADMISSION_REQUEST` → Risk `ADMITTED_ONCE` or terminal suppression/rejection. Only
`ADMITTED_ONCE` permits `INVOCATION_STARTED` and the venue adapter. No Reservation Claim Result or `CONSUMED`
exists on this path, but preparation and same-frontier fence arbitration remain mandatory.

## Owner handoffs / Owner 交接

Governance authorizes activation and controls Risk policy; Portfolio supplies the required capacity and lifecycle
evidence to Governance. Runtime returns the Generation Application Receipt
that alone proves application to Governance and Product Edge. Market Data supplies Runtime and Portfolio. Portfolio supplies
the exact candidate-neutral gross Capacity View and coherent Portfolio Risk Evidence Bundle to Risk. Its immutable Capacity Scope is account plus `LIVE` mode plus economic
pool and contains no strategy or generation. Risk durably serializes each add-risk decision against the one same-scope
Aggregate Commitment Frontier whose usage combines that bundle with held Reservation liabilities by economic lineage.
Runtime → Risk → Runtime is the intent and permit exchange.
Runtime → Execution is the authorized command. Execution → Risk requests the Reservation claim, then adapter admission,
and reports settlement lineage; Risk → Execution returns the sole immutable claim and admission results. Execution → Runtime reports order, fill, rejection,
readback, and reconciliation facts. Execution →
Portfolio reports account, order, fill, fee, and venue facts. Risk closes Reservation state; Portfolio updates
its projection and → Governance closes feedback.

## Proof / 证明

Proof begins with an `APPLIED` Generation Application Receipt for one Strategy Instance, then includes the venue readback linked to the authorized command, add-risk-only Risk-owned Reservation Claim Result, every Adapter Admission Result, `PREPARED` and when admitted `INVOCATION_STARTED` records, Effect Journal, terminal order and reservation
states, completed reconciliation, consistent Portfolio account projection, and lifecycle feedback attributable
to the same strategy generation and exact `LIVE` account and effect namespaces.

## Development outcome / 开发结果

- **Beneficiary** — capital owners and operators who need unattended trading with bounded exposure, a governed risk budget, attributable effects, and auditable feedback.
- **Observable outcome** — each live signal either ends in a terminal Risk rejection or one permit-bound venue attempt whose readback, account projection, liability settlement, and lifecycle feedback share exact identities.
- **Harm if unchanged** — duplicate or unpermitted venue effects, stale capacity, unexplained PnL, and unsafe lifecycle promotion could accumulate without a single accountable writer.
- **Terminal negative** — missing or stale facts, Risk rejection, suppressed admission, unknown application, or unknown effect creates no new-risk success and remains blocked or enters Recovery.

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- Missing or stale market, account, eligibility, policy, Capacity View, or permit facts block the dependent order. A scope, economic-condition, methodology, assumption, liquidity, or validity mismatch returns terminal Risk `REJECT` and creates no Reservation.
- A missing or stale Aggregate Commitment Frontier, stale serialization attempt, or capacity exhausted after worst-case `UNKNOWN_EFFECT` liabilities returns terminal Risk `REJECT` and creates no Reservation.
- Governance authorization without Runtime `APPLIED` creates no running strategy; `APPLICATION_UNKNOWN` blocks duplicate application and automated intent.
- Eligibility expiry or revocation, or stale required Performance, Exposure, or degradation evidence, forces
  Governance to commit `DE_RISK_PENDING`. Runtime stops new intent and Risk rejects new risk immediately; missing
  capacity or performance evidence cannot block decrease-only pause, reduction, or retirement.
- A missing, expired, revoked, or mismatched Authorization Lineage or Autonomous Policy Authorization blocks the
  dependent intent before Reservation creation.
- `ATTENDED_REQUEST` cannot produce `ACTIVE`, `APPLIED`, normal Live add-risk, or a venue effect; only
  decrease-only pause, reduction, retirement, and recovery remain available.
- Attended normal lifecycle de-risk reaches the venue adapter only with exact current Risk
  `PERMIT_DECREASE_ONLY`. Recovery instead requires the exact current `ACTIVE` Risk Fence and one action from its
  bounded set. Neither authorizes venue add-risk.
- Decrease-only creates no Reservation or claim, but must still produce `PREPARED`, one
  `ADAPTER_ADMISSION_REQUEST`, one immutable admission result, and at most one `INVOCATION_STARTED`.
- Risk cannot place orders; Execution cannot accept an unbound, stale, mismatched, or consumed permit.
- A non-`CONSUMED` claim creates no prepared attempt. `SUPPRESSED_BY_FENCE` or `REJECTED` admission reaches no venue adapter. Response loss, restart, and replay join the same claim and prepared attempt and cannot invoke twice.
- `SETTLED` retains held liability until one coherent Portfolio Risk Evidence Bundle covers the same settlement
  lineage and a serialized Risk transition replaces it; authoritative pre-claim `WITHDRAWN` or post-consumption
  `NO_EFFECT` may release directly.
- Runtime cannot claim success from a send or local acknowledgement; the venue readback owns external fact.
- Runtime readiness loss publishes `NOT_READY` after local suppression and independently activates the Risk
  fence. `RUNTIME_INCIDENT` binds only its exact `runtime-incident-fact`; `RECONCILIATION_DRIFT` binds only its exact
  `reconciliation-drift-fact`. Each first receives its own Execution-owned Recovery Admission
  Disposition, either singleton requires no other source, and simultaneous admitted branches join the same case.
  Only `RECOVERY_ADMITTED` with a matching active fence permits Reconciler to open or join the case
  and record `FENCED_OPEN`, while `NO_RECOVERY_REQUIRED` and `UNRESOLVED_NO_CASE` create no case or command.
- A Paper or mismatched generation, account, effect, policy, or Portfolio fact cut cannot authorize or update Live state.
- Opposite-mode namespace aliases remain rejected after replay or restart.
