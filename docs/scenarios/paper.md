# Paper trading scenario

Paper trading exercises the same automated control contracts as live trading while replacing the external
venue boundary with a simulated Execution adapter.

## Entry / 入口

Strategy Governance has authorized an eligible Strategy Artifact for a paper generation and assigned its
capital policy; it has not started Runtime. The decision binds a `PAPER` Execution Scope with isolated account
and effect namespaces and one pre-admitted simulated Adapter Binding.
`INITIAL_ACTIVATION` also binds a fresh Portfolio Lifecycle Evidence Receipt containing a Capacity View compatible
with that scope and the Eligibility economic condition; no historical performance is invented for a new generation.
Runtime has committed an `APPLIED` Generation Application Receipt that binds exactly one Strategy Instance and
checkpoint to that same decision, generation, scope, artifact, and fence epoch. The same Strategy Instance
semantics used by Live consume the Governance-owned `PAPER` scope; only Execution selects the pre-admitted
simulated adapter and isolated account and effect namespaces.
The application also binds the complete request Authorization Lineage and a `PAPER` Autonomous Policy
Authorization. Simulation changes the adapter, not the requirement for explicit unattended-trading authority.
`INITIAL_ACTIVATION`, `PROMOTION`, `APPLIED`, and normal automated Paper add-risk or simulated effects require
`UNATTENDED_REQUEST_WITH_POLICY`. `PROMOTION` binds fresh compatible Capacity View, Performance, and Exposure
evidence under its own transition-evidence key. An `ATTENDED_REQUEST` is non-running and decrease-only; it
cannot enter Paper unless a future separately specified attended-effect contract exists.

## Value path / 价值路径

Market Data streams facts to Strategy Instance and valuation facts to Portfolio. Strategy Instance is the
only normal Trade Intent writer. Risk returns a terminal decision and one-use Reservation. Strategy Instance
binds an allowed permit into an Authorized Order Command. Execution validates the binding and submits one stable
Reservation Claim Request. Only Risk `CONSUMED` permits Execution to journal one `PREPARED` attempt and send
`ADAPTER_ADMISSION_REQUEST`. Risk atomically commits its immutable admission result with the same frontier used by
recovery fence activation; only `ADMITTED_ONCE` permits `INVOCATION_STARTED` and reaches the simulated adapter.
Execution then journals effects, reconciles results, and reports settlement lineage to Risk and
order, fill, rejection, readback, and reconciliation facts to Runtime. It reports account, order, fill, fee, and
adapter facts to Portfolio. Risk alone transitions the Reservation; Portfolio alone updates its account projection.
Any paper `UNKNOWN_EFFECT` joins one stable Recovery Case for the same `PAPER` generation and effect namespace.
Risk activates the fence independently; Execution opens the case and binds that fence before its recovery commands run. The paper scope remains blocked
until that same case reaches `KNOWN_CLOSED`; closure may support a new Paper decision but can never support Live.

Normal decrease-only Paper work uses a separate exact path: Governance decision → Runtime local suppression →
Risk `PERMIT_DECREASE_ONLY` → a command with explicit-none Reservation/claim → Execution `PREPARED` →
`ADAPTER_ADMISSION_REQUEST` → Risk `ADMITTED_ONCE` or terminal suppression/rejection. Only
`ADMITTED_ONCE` permits `INVOCATION_STARTED` and the simulated adapter. No Reservation Claim Result or
`CONSUMED` exists on this path, but preparation and same-frontier fence arbitration remain mandatory.

## Owner handoffs / Owner 交接

Governance → Runtime authorizes the paper generation; Runtime → Governance and Product Edge returns the
Generation Application Receipt that alone proves whether it was applied. Governance → Risk supplies policy and capital ceilings.
Market Data → Runtime supplies live facts; Market Data and Execution → Portfolio supply valuation, liquidity,
and account facts. Portfolio → Governance binds capacity evidence for activation, and Portfolio → Risk supplies
the exact candidate-neutral gross Capacity View and coherent Portfolio Risk Evidence Bundle for each add-risk decision. Its immutable Capacity Scope is account plus
`PAPER` mode plus economic pool and contains no strategy or generation. Risk durably serializes the decision against
the one same-scope Aggregate Commitment Frontier whose usage combines that bundle with held Reservation liabilities
by economic lineage. Runtime → Risk sends intent, Risk → Runtime returns decision and reservation,
and Runtime → Execution sends the bound command. Execution → Risk requests the Reservation claim, then adapter admission, and reports settlement;
Risk → Execution returns the sole immutable claim and admission results. Execution → Runtime reports order, fill,
rejection, readback, and reconciliation; Execution → Portfolio reports account, order, fill, fee, and adapter facts.
Paper recovery uses the same branch contract as Live: Runtime `NOT_READY` independently causes a Risk fence and
case. `RUNTIME_INCIDENT` binds only its exact `runtime-incident-fact`; `RECONCILIATION_DRIFT` binds only its exact
`reconciliation-drift-fact`. Each first receives its own Execution-owned Recovery Admission Disposition,
and either singleton proceeds without the other source. Only `RECOVERY_ADMITTED` with a matching active fence
creates or joins a case; simultaneous admitted branches join that same case;
`NO_RECOVERY_REQUIRED` or `UNRESOLVED_NO_CASE` creates no case or command. Neither the simulated adapter nor a
local acknowledgement may fabricate or clear these facts.

## Proof / 证明

Proof begins with an `APPLIED` Generation Application Receipt for one Strategy Instance, then includes the canonical `PAPER` mode and namespace identities, every intent and risk terminal, the add-risk-only Risk-owned Reservation Claim Result, every Adapter Admission Result, `PREPARED` and when admitted `INVOCATION_STARTED` records, permit-bound order commands,
simulated order and fill facts, Effect Journal, settled reservations, completed reconciliation, and a Portfolio
projection that explains resulting balances, positions, exposure, and performance.
Every proof fact repeats the same `PAPER` scope; no paper namespace aliases or updates a live namespace.
Each `RUNTIME_INCIDENT` or `RECONCILIATION_DRIFT` additionally requires its own same-scope Recovery Admission
Disposition bound to its exact source fact, never the other branch's source. If it is
`RECOVERY_ADMITTED`, proof also requires the same-scope Recovery Case and `RecoveryCase.KNOWN_CLOSED`; a
no-case disposition cannot be replaced by a local acknowledgement.

## Development outcome / 开发结果

- **Beneficiary** — strategy developers and operators validating runtime, risk, execution, accounting, and recovery contracts without venue capital.
- **Observable outcome** — one Paper generation produces permit-bound simulated effects, reconciled Portfolio facts, settled Risk liability, and the same operational receipts required by Live.
- **Harm if unchanged** — a friendly simulator could hide risk bypass, invented fills, duplicate effects, or recovery gaps and create false confidence before Live deployment.
- **Terminal negative** — rejected risk creates no effect; unknown application or effect remains blocked or fenced, and no Paper result or closure authorizes Live.

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- Paper cannot skip Risk because the adapter is simulated.
- Runtime and Execution reject a missing, `LIVE`, or mismatched Governance scope and cannot reinterpret it as `PAPER`.
- An authorized decision without `APPLIED` does not run; `REJECTED_NO_INSTANCE` is terminal and `APPLICATION_UNKNOWN` blocks duplicate application.
- A bare decision or broken Authorization Lineage cannot produce automated paper intent. Application, intent,
  permit, Effect Journal, and readback preserve the same Autonomous Policy Authorization.
- `ATTENDED_REQUEST` cannot produce `ACTIVE`, `APPLIED`, normal Paper add-risk, or a simulated adapter effect;
  only decrease-only pause, reduction, retirement, and recovery remain available.
- Attended normal lifecycle de-risk reaches the simulated adapter only with exact current Risk
  `PERMIT_DECREASE_ONLY`. Recovery instead requires the exact current `ACTIVE` Risk Fence and one action from its
  bounded set. Neither authorizes simulated add-risk.
- Decrease-only creates no Reservation or claim, but must still produce `PREPARED`, one
  `ADAPTER_ADMISSION_REQUEST`, one immutable admission result, and at most one `INVOCATION_STARTED`.
- Eligibility loss or stale required retention evidence enters `DE_RISK_PENDING` and blocks new paper risk while
  leaving decrease-only pause, reduction, and retirement available.
- A rejected Risk decision creates no order command or Effect Journal.
- Missing, expired, cross-scope, or economic-condition-, methodology-, assumption-, or liquidity-mismatched Capacity View blocks `INITIAL_ACTIVATION` or returns terminal Risk `REJECT` with no Reservation.
- A missing or stale Aggregate Commitment Frontier, stale serialization attempt, or capacity exhausted after worst-case `UNKNOWN_EFFECT` liabilities returns terminal Risk `REJECT` with no Reservation.
- A non-`CONSUMED` claim creates no prepared attempt. `SUPPRESSED_BY_FENCE` or `REJECTED` admission creates no invocation. Response loss, restart, and replay join the same claim and prepared attempt and cannot invoke the simulated adapter twice.
- `SETTLED` retains held liability until one coherent Portfolio Risk Evidence Bundle covers the same settlement
  lineage and a serialized Risk transition replaces that liability; authoritative pre-claim `WITHDRAWN` or
  post-consumption `NO_EFFECT` may release directly.
- Runtime cannot invent fills or account state; simulated effects belong to Execution.
- Paper results are useful operational evidence but do not by themselves authorize live capital.
- Paper `UNKNOWN_EFFECT` cannot be cleared by retry, simulated fill, or local acknowledgement. It must enter the
  same Execution-owned Recovery Case, bind the active Risk fence, and remain blocked until `KNOWN_CLOSED`; even that closure
  cannot authorize or provide evidence for Live.
- A cross-mode, cross-generation, cross-account, or cross-effect-namespace fact is rejected before it can update Risk, Portfolio, or Governance feedback.
- Opposite-mode namespace aliases remain rejected after replay or restart.
