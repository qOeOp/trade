import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  actionControls,
  artifactActionControls,
  artifactInvocationAdmission,
  freezeS1ContextForOwnedAttempt,
  artifactAvailableAt,
  artifactBoundToS1Context,
  artifactContextCurrentAt,
  researchAvailableAt,
  resolveCurrentResearchThenRunArtifact,
} from "./control-policy.mjs"
import {
  unknownArtifactProjectionV1,
  unknownResearchProjectionV1,
  deriveVerifiedArtifactS1ContextV1,
  deriveVerifiedS1ConsumerContextV1,
  verifyArtifactConsumerProjectionV1,
  verifyResearchConsumerProjectionV1,
} from "../product_edge/consumer_projection_v1.ts"
import type { VerifiedS1ConsumerContextV1 } from "../product_edge/consumer_projection_v1.ts"
import { backend } from "./wmill"
import "./index.css"

type OwnerResult = {
  resolution: "ACCEPTED" | "REJECTED_NO_WRITE" | "SUBMITTED_OR_UNKNOWN" | "IDENTITY_CONFLICT"
  request_identity: string
  next_legal_action: string
  owner_receipt?: {
    receipt_identity: string
    disposition: string
    resulting_research_intent_identity?: string
    rejection_code?: string
  }
  research_view?: {
    projection_identity: string
    request_identity: string
    intent_identity: string
    availability: string
    phase: string
    source_cut: string
    observed_at_epoch_ms: number
    projection_at_epoch_ms: number
    valid_through_epoch_ms: number
    next_legal_action: string
    artifact_identity?: string
    build_receipt_identity?: string
    artifact_review_identity?: string
  }
  independence_basis?: {
    basis_identity: string
    basis_digest: string
    receipt: { receipt_identity: string; committed_at_epoch_ms: number }
  }
  protected_feedback?: {
    projection_identity: string
    projection_digest: string
    resolution: "GENESIS_EMPTY" | "FRONTIER"
    source_cut: string
    receipt: { receipt_identity: string; committed_at_epoch_ms: number }
  }
  trial_family_resolution?: "AVAILABLE" | "TRIAL_FAMILY_UNAVAILABLE_LEGACY" | "UNAVAILABLE"
  trial_family?: {
    root: {
      trial_family_identity: string
      policy_digest: string
      root_digest: string
    }
    root_receipt: {
      receipt_identity: string
      intent_identity: string
      root_digest: string
    }
    initial_intent_member: {
      member_identity: string
      fact_identity: string
      member_digest: string
    }
    membership_receipt: {
      receipt_identity: string
      member_identity: string
      member_digest: string
    }
    census_frontier: {
      frontier_identity: string
      frontier_digest: string
      member_digests: string[]
      consumed_trial_budget: number
    }
  }
}

type ArtifactResult = {
  resolution: "SUCCESS" | "FAILED_NO_ARTIFACT" | "REJECTED_NO_WRITE" | "OUTCOME_UNKNOWN" | "SUBMITTED_OR_UNKNOWN" | "IDENTITY_CONFLICT" | "LEGACY_TERMINAL_QUARANTINED"
  build_request_identity: string
  attempt_identity: string
  next_legal_action: string
  provider_invocation?: {
    claim_identity: string
    claim_digest: string
    invocation_admission_receipt_identity: string
    invocation_admission_receipt_digest: string
    state_digest: string
    state: "CLAIMED" | "INVOCATION_STARTED"
    disposition: "CLAIMED_NEW" | "ALREADY_CLAIMED" | "OUTCOME_UNKNOWN"
    next_legal_action?: "RUN_BOUNDED_EXECUTION_AGENT" | "MANUALLY_RECONCILE_PROVIDER_INVOCATION"
    attempt_identity?: string
  } | null
  owner_receipt?: {
    receipt_identity: string
    disposition: string
    intent_identity?: string
    intent_semantic_digest?: string
    artifact_identity?: string
    build_receipt_identity?: string
    failure_code?: string
  }
  research_view?: OwnerResult["research_view"]
  artifact_review?: {
    review_identity: string
    artifact_identity: {
      artifact_digest: string
      intent_digest: string
      wasm_digest: string
      guest_source_digest: string
      build_recipe_digest: string
      rustc_release: string
      rustc_commit: string
      target: string
    }
    intent_identity: string
    intent_semantic_digest: string
    request_identity: string
    source_lineage: string[]
    structured_logic: Record<string, string | number>
    structured_logic_summary: string
    parameters_identity: string
    dependency_identity: string
    build_receipt: {
      build_receipt_identity: string
      deterministic_double_build: boolean
      sandbox_policy: string
      artifact_security_admission: string
    }
    build_security_state: string
    agent_change_explanation: string
    agent_change_explanation_authority: string
    allowed_next_actions: string[]
  }
  artifact_review_actions?: {
    schema_version: number
    actions: Array<{
      action: string
      admission: "ADMITTED" | "NOT_ADMITTED"
    }>
  }
  trial_family_resolution?: "AVAILABLE" | "TRIAL_FAMILY_UNAVAILABLE_LEGACY" | "UNAVAILABLE"
  artifact_trial_family?: {
    binding: {
      binding_identity: string
      artifact_identity: string
      build_receipt_identity: string
      trial_family_identity: string
      census_frontier_identity: string
      census_frontier_digest: string
      binding_digest: string
    }
    binding_receipt: {
      receipt_identity: string
      binding_identity: string
      binding_digest: string
    }
  }
}

const initial = {
  locator: "https://raw.githubusercontent.com/binance/binance-futures-connector-python/a6bfbbf10fe2c1b4eb76fc24ffb82eb94bf9df89/binance/um_futures/market.py",
  digest: "sha256:9e55db014233d92bad66a90ec36212f1fada7f1f93a092ec5d6bc9298988659f",
  observedAt: "2026-08-18T12:00:00Z",
  sourceCut: "binance-futures-connector-python@a6bfbbf10fe2c1b4eb76fc24ffb82eb94bf9df89:binance/um_futures/market.py",
  license: "Official Binance repository, MIT License; research citation only",
  interpretation: "The pinned official connector documents the USD-M /fapi/v1/klines observation surface used to frame, not prove, the hypothesis.",
  hypothesis: "BTC perpetual hourly momentum persists after explicit transaction costs.",
  mechanism: "Slow information diffusion may create short-lived continuation after a directional price move.",
  falsifier: "Does net continuation disappear out of sample after fees, spread, and funding?",
  expected: "Positive net continuation across preregistered hourly windows, otherwise reject the mechanism.",
  requiredData: "PIT hourly trades, mark price, funding, fee schedule, and spread",
  costs: "Maker/taker fees, observed spread, funding, and conservative slippage",
  capacity: "Single-user research scale only; no capital or live eligibility claim",
  trialBudget: "8",
  stopRule: "Stop on falsifier, exhausted budget, or unavailable PIT input.",
  pitRule: "pit-adjusted-bars-v1",
  costModel: "explicit-fees-funding-v1",
  slippageModel: "observed-spread-conservative-slippage-v1",
  capacityModel: "single-user-research-capacity-v1",
  independenceRationale: "No known local semantic predecessor before direct R&D lineage resolution.",
}

export default function App() {
  const [form, setForm] = useState(initial)
  const [requestIdentity, setRequestIdentity] = useState(() => `research-request-${crypto.randomUUID()}`)
  const [requestIdentityImported, setRequestIdentityImported] = useState(false)
  const [result, setResult] = useState<OwnerResult | null>(null)
  const [buildRequestIdentity, setBuildRequestIdentity] = useState(() => `artifact-build-request-${crypto.randomUUID()}`)
  const [buildRequestIdentityImported, setBuildRequestIdentityImported] = useState(false)
  const [attemptIdentity, setAttemptIdentity] = useState(() => `artifact-build-attempt-${crypto.randomUUID()}`)
  const [attemptIdentityImported, setAttemptIdentityImported] = useState(false)
  const [artifactResult, setArtifactResult] = useState<ArtifactResult | null>(null)
  const [s1Context, setS1Context] = useState<VerifiedS1ConsumerContextV1 | null>(null)
  const [artifactS1Context, setArtifactS1Context] = useState<VerifiedS1ConsumerContextV1 | null>(null)
  const [busy, setBusy] = useState(false)
  const ownerCallToken = useRef<symbol | null>(null)
  const [consumerClockEpochMs, setConsumerClockEpochMs] = useState(() => Date.now())
  const researchViewAvailable = researchAvailableAt(result, s1Context, consumerClockEpochMs)
  const artifactDisplayContext = s1Context ?? artifactS1Context
  const artifactViewAvailable = artifactAvailableAt(artifactResult, artifactDisplayContext, consumerClockEpochMs)
  const controls = actionControls(result, requestIdentity)
  const artifactControls = artifactActionControls(
    artifactResult, buildRequestIdentity, attemptIdentity, s1Context, consumerClockEpochMs,
  )
  const artifactEvidenceBound = artifactResult?.resolution === "LEGACY_TERMINAL_QUARANTINED"
    || !artifactResult?.owner_receipt
    || artifactBoundToS1Context(artifactResult, artifactDisplayContext)
  const artifactDisplayCurrent = artifactResult?.resolution === "LEGACY_TERMINAL_QUARANTINED"
    || !artifactResult?.owner_receipt
    || artifactContextCurrentAt(artifactResult, artifactDisplayContext, consumerClockEpochMs)
  const artifactDisplayResolution = artifactResult && (!artifactEvidenceBound || !artifactDisplayCurrent)
    ? "SUBMITTED_OR_UNKNOWN"
    : artifactResult?.resolution
  const canResolveImportedRequest = result === null && requestIdentityImported && requestIdentity.trim() !== ""
  const canResolveImportedArtifact = artifactResult === null && buildRequestIdentityImported && attemptIdentityImported && buildRequestIdentity.trim() !== "" && attemptIdentity.trim() !== ""
  const artifactRunAdmission = artifactInvocationAdmission({
    action: "RUN",
    artifactResult,
    buildRequestIdentity,
    attemptIdentity,
    liveS1Context: s1Context,
    frozenS1Context: artifactS1Context,
    researchViewAvailable,
    freshIdentityGenerated: !buildRequestIdentityImported && !attemptIdentityImported,
    canResolveImportedArtifact,
    nowEpochMs: consumerClockEpochMs,
  })
  const artifactResolveAdmission = artifactInvocationAdmission({
    action: "RESOLVE",
    artifactResult,
    buildRequestIdentity,
    attemptIdentity,
    liveS1Context: s1Context,
    frozenS1Context: artifactS1Context,
    researchViewAvailable,
    freshIdentityGenerated: !buildRequestIdentityImported && !attemptIdentityImported,
    canResolveImportedArtifact,
    nowEpochMs: consumerClockEpochMs,
  })
  const intentIdentity = s1Context?.intent_identity ?? artifactS1Context?.intent_identity
  const reviewActions = artifactViewAvailable ? artifactResult?.artifact_review_actions?.actions ?? [] : []
  const admittedReviewActions = reviewActions.filter((action) => action.admission === "ADMITTED").map((action) => action.action)
  const notAdmittedReviewActions = reviewActions.filter((action) => action.admission === "NOT_ADMITTED").map((action) => action.action)
  const statusLabel = useMemo(() => {
    if (!result) return "尚未提交"
    if (result.resolution === "ACCEPTED" && result.owner_receipt) return "R&D Owner 已接纳"
    if (result.resolution === "REJECTED_NO_WRITE" && result.owner_receipt) return "R&D Owner 拒绝且未创建研究事实"
    if (result.resolution === "IDENTITY_CONFLICT") return "请求身份与既有语义冲突"
    if (result.resolution === "ACCEPTED" || result.resolution === "REJECTED_NO_WRITE") return "未收到 Owner 终态回执"
    return "已提交或结果未知"
  }, [result])

  function acquireOwnerCall(): symbol | null {
    if (ownerCallToken.current !== null) return null
    const token = Symbol("owner-call")
    ownerCallToken.current = token
    setBusy(true)
    return token
  }

  function releaseOwnerCall(token: symbol) {
    if (ownerCallToken.current !== token) return
    ownerCallToken.current = null
    setBusy(false)
  }

  useEffect(() => {
    const cuts = [s1Context?.valid_through_epoch_ms, artifactResult?.research_view?.valid_through_epoch_ms]
      .filter((value): value is number => typeof value === "number" && value > consumerClockEpochMs)
    if (cuts.length === 0) return
    const nextCut = Math.min(...cuts)
    const timer = window.setTimeout(() => {
      const now = Date.now()
      setConsumerClockEpochMs(now)
      const token = acquireOwnerCall()
      if (token === null) return
      void (async () => {
        try {
          let refreshedContext = s1Context
          if (s1Context && now >= s1Context.valid_through_epoch_ms) {
            try {
              const refreshed = await (backend.research_goal({
                action: "RESOLVE",
                request_identity: requestIdentity,
              }) as Promise<OwnerResult>)
              const projected = await verifyResearchConsumerProjectionV1(refreshed, requestIdentity) as OwnerResult
              setResult(projected)
              refreshedContext = await deriveVerifiedS1ConsumerContextV1(projected, requestIdentity)
              setS1Context(refreshedContext)
            } catch {
              setResult(unknownResearchProjectionV1(requestIdentity) as OwnerResult)
              refreshedContext = null
              setS1Context(null)
            }
          }
          const artifactCut = artifactResult?.research_view?.valid_through_epoch_ms
          if (artifactResult && typeof artifactCut === "number" && now >= artifactCut) {
            try {
              const refreshed = await (backend.artifact_build({
                action: "RESOLVE",
                build_request_identity: buildRequestIdentity,
                attempt_identity: attemptIdentity,
                research_request_identity: requestIdentity,
                identity_mode: "EXACT",
              }) as Promise<ArtifactResult>)
              const terminalContext = await deriveVerifiedArtifactS1ContextV1(
                refreshed,
                buildRequestIdentity,
                attemptIdentity,
                requestIdentity,
              )
              const verificationContext = refreshedContext ?? terminalContext
              const projectedArtifact = await verifyArtifactConsumerProjectionV1(
                refreshed,
                buildRequestIdentity,
                attemptIdentity,
                verificationContext,
              ) as ArtifactResult
              setArtifactResult(projectedArtifact)
              setArtifactS1Context((current) => freezeS1ContextForOwnedAttempt(
                projectedArtifact,
                verificationContext,
                current,
              ))
            } catch {
              setArtifactResult(unknownArtifactProjectionV1(buildRequestIdentity, attemptIdentity) as ArtifactResult)
            }
          }
        } finally {
          releaseOwnerCall(token)
        }
      })()
    }, Math.max(0, nextCut - Date.now()) + 1)
    return () => window.clearTimeout(timer)
  }, [
    artifactResult,
    attemptIdentity,
    buildRequestIdentity,
    busy,
    consumerClockEpochMs,
    requestIdentity,
    s1Context,
  ])

  function update(key: keyof typeof initial, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function invoke(action: "SUBMIT" | "RESOLVE") {
    if ((action === "SUBMIT" && !controls.canSubmit) || (action === "RESOLVE" && !controls.canResolve && !canResolveImportedRequest)) return
    const token = acquireOwnerCall()
    if (token === null) return
    if (action === "SUBMIT") {
      setS1Context(null)
    }
    try {
      const goal = action === "SUBMIT" ? {
        hypothesis: form.hypothesis,
        mechanism: form.mechanism,
        falsification_question: form.falsifier,
        expected_observation: form.expected,
        required_data: [form.requiredData],
        cost_assumption: form.costs,
        capacity_assumption: form.capacity,
        sources: [{
          locator: form.locator,
          content_digest: form.digest,
          observed_at: form.observedAt,
          source_cut: form.sourceCut,
          license_basis: form.license,
          interpretation: form.interpretation,
        }],
      } : undefined
      const response = await (backend.research_goal({
        action,
        request_identity: requestIdentity,
        goal,
        trial_family_proposal: action === "SUBMIT" ? {
          trial_budget: Number(form.trialBudget),
          stop_rule: form.stopRule,
          pit_rule_identity: form.pitRule,
          cost_model_identity: form.costModel,
          slippage_model_identity: form.slippageModel,
          capacity_model_identity: form.capacityModel,
          independence_rationale: form.independenceRationale,
        } : undefined,
      }) as Promise<OwnerResult>)
      const projected = await verifyResearchConsumerProjectionV1(response, requestIdentity) as OwnerResult
      setResult(projected)
      setS1Context(await deriveVerifiedS1ConsumerContextV1(projected, requestIdentity))
      setConsumerClockEpochMs(Date.now())
    } catch {
      setResult(unknownResearchProjectionV1(requestIdentity) as OwnerResult)
      setS1Context(null)
    } finally {
      releaseOwnerCall(token)
    }
  }

  function newRequest() {
    if (!controls.canCreateSuccessor) return
    setRequestIdentity(`research-request-${crypto.randomUUID()}`)
    setRequestIdentityImported(false)
    setResult(null)
    setS1Context(null)
  }

  async function invokeArtifact(action: "RUN" | "RESOLVE") {
    const admission = artifactInvocationAdmission({
      action,
      artifactResult,
      buildRequestIdentity,
      attemptIdentity,
      liveS1Context: s1Context,
      frozenS1Context: artifactS1Context,
      researchViewAvailable,
      freshIdentityGenerated: !buildRequestIdentityImported && !attemptIdentityImported,
      canResolveImportedArtifact,
      nowEpochMs: consumerClockEpochMs,
    })
    if (!admission.canInvoke) return
    const token = acquireOwnerCall()
    if (token === null) return
    let artifactBackendStarted = false
    let expectedS1Context = admission.context
    try {
      const invokeBackend = () => {
        artifactBackendStarted = true
        if (action === "RUN") {
          setArtifactS1Context((current) => current ?? expectedS1Context)
        }
        setArtifactResult(unknownArtifactProjectionV1(buildRequestIdentity, attemptIdentity) as ArtifactResult)
        return backend.artifact_build({
          action,
          build_request_identity: buildRequestIdentity,
          attempt_identity: attemptIdentity,
          research_request_identity: requestIdentity,
          identity_mode: action === "RUN" && !admission.recovery ? "GENERATE" : "EXACT",
        }) as Promise<ArtifactResult>
      }
      let response: ArtifactResult
      if (action === "RUN") {
        const refreshed = await resolveCurrentResearchThenRunArtifact({
          requestIdentity,
          intentIdentity: admission.context?.intent_identity ?? "",
          artifactResult,
          buildRequestIdentity,
          attemptIdentity,
          resolveResearch: () => backend.research_goal({
            action: "RESOLVE",
            request_identity: requestIdentity,
          }) as Promise<OwnerResult>,
          projectResearch: async (value: unknown, identity: string) => {
            const projected = await verifyResearchConsumerProjectionV1(value, identity) as OwnerResult
            const refreshedContext = await deriveVerifiedS1ConsumerContextV1(projected, identity)
            expectedS1Context = refreshedContext ?? expectedS1Context
            setS1Context(refreshedContext)
            return projected
          },
          runArtifact: invokeBackend,
        }) as { research: OwnerResult | null; artifact: ArtifactResult | null; artifactBackendStarted: boolean; error: unknown | null }
        artifactBackendStarted = refreshed.artifactBackendStarted
        if (refreshed.research) {
          setResult(refreshed.research)
        } else if (!admission.recovery) {
          setResult(unknownResearchProjectionV1(requestIdentity) as OwnerResult)
          setS1Context(null)
        }
        if (refreshed.artifact === null) {
          if (!artifactBackendStarted) setArtifactResult(null)
          return
        }
        response = refreshed.artifact
      } else {
        response = await invokeBackend()
      }
      const responseBuildRequestIdentity = admission.recovery
        ? buildRequestIdentity
        : response.build_request_identity
      const responseAttemptIdentity = admission.recovery
        ? attemptIdentity
        : response.attempt_identity
      const terminalContext = expectedS1Context ?? await deriveVerifiedArtifactS1ContextV1(
        response,
        responseBuildRequestIdentity,
        responseAttemptIdentity,
        requestIdentity,
      )
      const projected = await verifyArtifactConsumerProjectionV1(
        response,
        responseBuildRequestIdentity,
        responseAttemptIdentity,
        terminalContext,
      ) as ArtifactResult
      setArtifactS1Context((current) => freezeS1ContextForOwnedAttempt(
        projected,
        terminalContext,
        current,
      ))
      if (!admission.recovery) {
        setBuildRequestIdentity(responseBuildRequestIdentity)
        setBuildRequestIdentityImported(false)
        setAttemptIdentity(responseAttemptIdentity)
        setAttemptIdentityImported(false)
      }
      setArtifactResult(projected)
      setConsumerClockEpochMs(Date.now())
    } catch {
      if (artifactBackendStarted && admission.recovery) {
        setArtifactResult(unknownArtifactProjectionV1(buildRequestIdentity, attemptIdentity) as ArtifactResult)
      } else {
        setArtifactResult(null)
      }
    } finally {
      releaseOwnerCall(token)
    }
  }

  function newArtifactRequest() {
    if (!artifactControls.canCreateSuccessor) return
    setBuildRequestIdentity(`artifact-build-request-${crypto.randomUUID()}`)
    setBuildRequestIdentityImported(false)
    setAttemptIdentity(`artifact-build-attempt-${crypto.randomUUID()}`)
    setAttemptIdentityImported(false)
    setArtifactResult(null)
    setArtifactS1Context(null)
  }

  return <main className="shell">
    <header>
      <p className="eyebrow">VibeTrader · R&amp;D Formation / S2</p>
      <h1>R&D 研究工作台</h1>
      <p className="lede">提交一个有来源、可证伪的研究目标。Windmill 只负责交互与投递；业务结论以 R&D Owner 回执为准。</p>
    </header>

    <section className="card form-card">
      <div className="section-title"><span>01</span><div><h2>来源与研究目标</h2><p>来源内容按不受信任证据处理，不授予交易或执行权限。</p></div></div>
      <div className="grid">
        <label className="wide">来源 URL<input value={form.locator} onChange={(e) => update("locator", e.target.value)} /></label>
        <label>来源切面<input value={form.sourceCut} onChange={(e) => update("sourceCut", e.target.value)} /></label>
        <label>观察时间<input value={form.observedAt} onChange={(e) => update("observedAt", e.target.value)} /></label>
        <label className="wide">内容摘要<input value={form.digest} onChange={(e) => update("digest", e.target.value)} /></label>
        <label>许可依据<input value={form.license} onChange={(e) => update("license", e.target.value)} /></label>
        <label>所需数据<input value={form.requiredData} onChange={(e) => update("requiredData", e.target.value)} /></label>
        <label className="wide">来源解释<textarea value={form.interpretation} onChange={(e) => update("interpretation", e.target.value)} /></label>
        <label className="wide">研究假设<textarea value={form.hypothesis} onChange={(e) => update("hypothesis", e.target.value)} /></label>
        <label className="wide">机制<textarea value={form.mechanism} onChange={(e) => update("mechanism", e.target.value)} /></label>
        <label className="wide">证伪问题<textarea value={form.falsifier} onChange={(e) => update("falsifier", e.target.value)} /></label>
        <label>预期观察<textarea value={form.expected} onChange={(e) => update("expected", e.target.value)} /></label>
        <label>成本假设<textarea value={form.costs} onChange={(e) => update("costs", e.target.value)} /></label>
        <label className="wide">容量边界<textarea value={form.capacity} onChange={(e) => update("capacity", e.target.value)} /></label>
        <label>Trial budget<input value={form.trialBudget} onChange={(e) => update("trialBudget", e.target.value)} /></label>
        <label className="wide">预提交停止规则<textarea value={form.stopRule} onChange={(e) => update("stopRule", e.target.value)} /></label>
        <label>PIT 规则 identity<input value={form.pitRule} onChange={(e) => update("pitRule", e.target.value)} /></label>
        <label>成本模型 identity<input value={form.costModel} onChange={(e) => update("costModel", e.target.value)} /></label>
        <label>滑点模型 identity<input value={form.slippageModel} onChange={(e) => update("slippageModel", e.target.value)} /></label>
        <label>容量模型 identity<input value={form.capacityModel} onChange={(e) => update("capacityModel", e.target.value)} /></label>
        <label className="wide">独立性提议说明（非权威）<textarea value={form.independenceRationale} onChange={(e) => update("independenceRationale", e.target.value)} /></label>
      </div>
      <label className="request-id"><span>稳定请求身份</span><input aria-label="稳定研究请求身份" value={requestIdentity} disabled={busy || result !== null} onChange={(e) => { setRequestIdentity(e.target.value); setRequestIdentityImported(true) }} /></label>
      <div className="actions">
        <button disabled={busy || !controls.canSubmit} onClick={() => invoke("SUBMIT")}>提交到 R&D Owner</button>
        <button className="secondary" disabled={busy || (!controls.canResolve && !canResolveImportedRequest)} onClick={() => invoke("RESOLVE")}>用同一身份解析</button>
        <button className="quiet" disabled={busy || !controls.canCreateSuccessor} onClick={newRequest}>创建后继请求身份</button>
      </div>
    </section>

    <section className={`card result ${result?.resolution ?? "EMPTY"}`}>
      <div className="section-title"><span>02</span><div><h2>Owner 回执与 Research View</h2><p>Windmill job 成功不会改变这里的业务状态。</p></div></div>
      <div className="status-row"><strong>{statusLabel}</strong><code>{result?.resolution ?? "NOT_SUBMITTED"}</code></div>
      {result?.owner_receipt && <dl>
        <dt>原生回执</dt><dd>{result.owner_receipt.receipt_identity}</dd>
        <dt>处置</dt><dd>{result.owner_receipt.disposition}</dd>
        <dt>Research Intent</dt><dd>{result.owner_receipt.resulting_research_intent_identity ?? "无"}</dd>
      </dl>}
      {result?.research_view && <dl>
        <dt>可用性 / 阶段</dt><dd>{result.research_view.availability} · {result.research_view.phase}</dd>
        <dt>来源切面</dt><dd>{result.research_view.source_cut}</dd>
        <dt>投影 / 有效至</dt><dd>{new Date(result.research_view.projection_at_epoch_ms).toISOString()} / {new Date(result.research_view.valid_through_epoch_ms).toISOString()}</dd>
      </dl>}
      {result?.independence_basis && <dl>
        <dt>R&amp;D Independence Basis receipt</dt><dd>{result.independence_basis.receipt.receipt_identity}</dd>
        <dt>Basis identity / digest</dt><dd>{result.independence_basis.basis_identity}<br />{result.independence_basis.basis_digest}</dd>
      </dl>}
      {result?.protected_feedback && <dl>
        <dt>Qualification protected-feedback receipt</dt><dd>{result.protected_feedback.receipt.receipt_identity}</dd>
        <dt>Opaque resolution / cut</dt><dd>{result.protected_feedback.resolution} · {result.protected_feedback.source_cut}</dd>
      </dl>}
      {result?.trial_family && <dl>
        <dt>TrialFamily root receipt</dt><dd>{result.trial_family.root_receipt.receipt_identity}</dd>
        <dt>TrialFamily / root digest</dt><dd>{result.trial_family.root.trial_family_identity}<br />{result.trial_family.root.root_digest}</dd>
        <dt>INTENT membership receipt</dt><dd>{result.trial_family.membership_receipt.receipt_identity}</dd>
        <dt>Census member / fact</dt><dd>{result.trial_family.initial_intent_member.member_identity}<br />{result.trial_family.initial_intent_member.fact_identity}</dd>
        <dt>Census head / frontier</dt><dd>{result.trial_family.census_frontier.frontier_identity}<br />{result.trial_family.census_frontier.frontier_digest}</dd>
      </dl>}
      {result?.resolution === "ACCEPTED" && (result.trial_family_resolution !== "AVAILABLE" || !result.trial_family) && <p className="unknown">缺少 R&amp;D Owner 的 TrialFamily root/member/frontier 直接回读，因此不能呈现 S1 V2 终态。</p>}
      {result && <dl><dt>唯一下一合法动作</dt><dd className="next">{result.research_view && !researchViewAvailable ? "RESOLVE_SAME_REQUEST_IDENTITY" : result.next_legal_action}</dd></dl>}
      {result?.resolution === "SUBMITTED_OR_UNKNOWN" && <p className="unknown">结果仍未知。唯一合法动作是使用上方同一请求身份解析；不要创建裸重试或新身份。</p>}
      {result?.resolution === "REJECTED_NO_WRITE" && result.owner_receipt && <p className="rejected">该请求没有创建 Research Intent。修正输入需要显式创建一个后继请求身份。</p>}
      {result?.resolution === "IDENTITY_CONFLICT" && <p className="conflict">既有请求身份不会被新语义覆盖。唯一合法动作是用同一身份解析原始 Owner 回执；不要声称既有 Research Intent 不存在。</p>}
      {(result?.resolution === "ACCEPTED" || result?.resolution === "REJECTED_NO_WRITE") && !result.owner_receipt && <p className="unknown">缺少原生 Owner 回执，因此不能呈现业务终态。请停止并检查 Product Edge 边界。</p>}
    </section>

    <section className={`card result ${artifactDisplayResolution ?? "EMPTY"}`}>
      <div className="section-title"><span>03</span><div><h2>Strategy Artifact Formation</h2><p>Execution Agent 输出不受信任；只有 Owner 原子提交的 Artifact、Build Receipt 与 Review 是业务事实。</p></div></div>
      <div className="request-id"><span>Frozen Intent</span><code>{intentIdentity ?? "先完成 S1 Frozen Research Intent"}</code></div>
      <label className="request-id"><span>Build request</span><input aria-label="Artifact build request identity" value={buildRequestIdentity} disabled={busy || artifactResult !== null} onChange={(e) => { setBuildRequestIdentity(e.target.value); setBuildRequestIdentityImported(true) }} /></label>
      <label className="request-id"><span>Attempt</span><input aria-label="Artifact build attempt identity" value={attemptIdentity} disabled={busy || artifactResult !== null} onChange={(e) => { setAttemptIdentity(e.target.value); setAttemptIdentityImported(true) }} /></label>
      <div className="actions">
        <button disabled={busy || !artifactRunAdmission.canInvoke} onClick={() => invokeArtifact("RUN")}>启动有界 Agent 与隔离构建</button>
        <button className="secondary" disabled={busy || !artifactResolveAdmission.canInvoke} onClick={() => invokeArtifact("RESOLVE")}>从 Owner 解析同一 attempt</button>
        <button className="quiet" disabled={busy || !artifactControls.canCreateSuccessor} onClick={newArtifactRequest}>创建后继 build request</button>
      </div>
      <div className="status-row"><strong>{artifactDisplayResolution === "SUCCESS" ? "Artifact 已由 R&D Owner 原子提交" : artifactResult ? "以 Owner resolution 为准" : "尚未启动"}</strong><code>{artifactDisplayResolution ?? "NOT_SUBMITTED"}</code></div>
      {artifactEvidenceBound && artifactResult?.owner_receipt && <dl>
        <dt>Owner Formation 回执</dt><dd>{artifactResult.owner_receipt.receipt_identity}</dd>
        <dt>处置 / 失败码</dt><dd>{artifactResult.owner_receipt.disposition} / {artifactResult.owner_receipt.failure_code ?? "无"}</dd>
        <dt>Artifact / Build Receipt</dt><dd>{artifactResult.owner_receipt.artifact_identity ?? "无 Artifact"} / {artifactResult.owner_receipt.build_receipt_identity ?? "无"}</dd>
      </dl>}
      {artifactEvidenceBound && artifactResult?.research_view && <dl>
        <dt>Research View</dt><dd>{artifactResult.research_view.phase} · {artifactResult.research_view.availability}</dd>
        <dt>权威 identities</dt><dd>{artifactResult.research_view.artifact_identity} / {artifactResult.research_view.build_receipt_identity} / {artifactResult.research_view.artifact_review_identity}</dd>
      </dl>}
      {artifactEvidenceBound && artifactResult?.artifact_review && <dl>
        <dt>Artifact identity</dt><dd>{artifactResult.artifact_review.artifact_identity.artifact_digest}</dd>
        <dt>S1 Intent / semantic digest</dt><dd>{artifactResult.artifact_review.intent_identity} / {artifactResult.artifact_review.intent_semantic_digest}</dd>
        <dt>S1 request / source lineage</dt><dd>{artifactResult.artifact_review.request_identity}<br />{artifactResult.artifact_review.source_lineage.join(" · ")}</dd>
        <dt>Source / Wasm / recipe</dt><dd>{artifactResult.artifact_review.artifact_identity.guest_source_digest} / {artifactResult.artifact_review.artifact_identity.wasm_digest} / {artifactResult.artifact_review.artifact_identity.build_recipe_digest}</dd>
        <dt>结构化逻辑</dt><dd><code>{JSON.stringify(artifactResult.artifact_review.structured_logic)}</code><br />{artifactResult.artifact_review.structured_logic_summary}</dd>
        <dt>参数 / 依赖 identity</dt><dd>{artifactResult.artifact_review.parameters_identity} / {artifactResult.artifact_review.dependency_identity}</dd>
        <dt>Build / Security</dt><dd>{artifactResult.artifact_review.build_security_state} · double-build={String(artifactResult.artifact_review.build_receipt.deterministic_double_build)} · {artifactResult.artifact_review.build_receipt.sandbox_policy}</dd>
        <dt>Toolchain / target</dt><dd>{artifactResult.artifact_review.artifact_identity.rustc_release} / {artifactResult.artifact_review.artifact_identity.rustc_commit} / {artifactResult.artifact_review.artifact_identity.target}</dd>
        <dt>Agent 变更说明</dt><dd>{artifactResult.artifact_review.agent_change_explanation}<br /><strong>{artifactResult.artifact_review.agent_change_explanation_authority}</strong></dd>
        {artifactViewAvailable && <><dt>允许的下一动作</dt><dd className="next">{admittedReviewActions.join(" · ")}</dd></>}
        {artifactViewAvailable && notAdmittedReviewActions.length > 0 && <><dt>S2 NOT_ADMITTED</dt><dd>{notAdmittedReviewActions.join(" · ")}</dd></>}
      </dl>}
      {artifactEvidenceBound && artifactResult?.artifact_trial_family && <dl>
        <dt>Artifact → TrialFamily binding</dt><dd>{artifactResult.artifact_trial_family.binding.binding_identity}</dd>
        <dt>Binding receipt</dt><dd>{artifactResult.artifact_trial_family.binding_receipt.receipt_identity}</dd>
        <dt>Bound family / frontier</dt><dd>{artifactResult.artifact_trial_family.binding.trial_family_identity}<br />{artifactResult.artifact_trial_family.binding.census_frontier_identity}</dd>
      </dl>}
      {artifactDisplayResolution === "SUCCESS" && artifactResult && (artifactResult.trial_family_resolution !== "AVAILABLE" || !artifactResult.artifact_trial_family) && <p className="unknown">缺少 Artifact-family binding 与回执的直接 Owner 回读，因此不能呈现 S2 终态。</p>}
      {artifactResult?.provider_invocation && <dl>
        <dt>Provider invocation fence</dt><dd>{artifactResult.provider_invocation.claim_identity}<br />claim={artifactResult.provider_invocation.claim_digest}<br />admission receipt={artifactResult.provider_invocation.invocation_admission_receipt_identity}<br />receipt digest={artifactResult.provider_invocation.invocation_admission_receipt_digest}<br />state={artifactResult.provider_invocation.state_digest}</dd>
        <dt>Provider outcome</dt><dd>{artifactResult.provider_invocation.disposition}</dd>
        {artifactResult.provider_invocation.next_legal_action && <><dt>人工恢复动作</dt><dd className="next">{artifactResult.provider_invocation.next_legal_action}</dd></>}
      </dl>}
      {artifactResult && <dl><dt>唯一下一合法动作</dt><dd className="next">{!artifactDisplayCurrent || (artifactResult.research_view && !artifactViewAvailable) ? "RESOLVE_SAME_ATTEMPT_IDENTITY" : artifactResult.next_legal_action}</dd></dl>}
      {["FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN"].includes(artifactDisplayResolution ?? "") && <p className="rejected">该终态没有 canonical Artifact；不得把 Windmill job green 或 Agent 文本解释为成功。</p>}
      {artifactDisplayResolution === "SUBMITTED_OR_UNKNOWN" && <p className="unknown">结果未知。只允许用同一 build request / attempt 从 Owner 解析；若 provider invocation fence 已开始但没有权威 provider 回读，只能人工对账，禁止盲目重调。</p>}
      {artifactResult?.resolution === "LEGACY_TERMINAL_QUARANTINED" && <p className="unknown">这是 Product Edge 准入之前的只读 terminal legacy custody。只显示经原始行验证的历史回执；不得启动 provider、创建 Artifact 后继、补写 TrialFamily 或把它提升为当前 authority。</p>}
    </section>

    <footer>非 live 产品切片 · 不构成 Alpha、Qualification、部署、资本、Risk、Execution 或交易授权</footer>
  </main>
}
