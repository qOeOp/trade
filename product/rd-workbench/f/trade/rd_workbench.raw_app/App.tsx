import React, { useMemo, useState } from "react"
import { actionControls, artifactActionControls } from "./control-policy.mjs"
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
}

type ArtifactResult = {
  resolution: "SUCCESS" | "FAILED_NO_ARTIFACT" | "REJECTED_NO_WRITE" | "OUTCOME_UNKNOWN" | "SUBMITTED_OR_UNKNOWN" | "IDENTITY_CONFLICT"
  build_request_identity: string
  attempt_identity: string
  next_legal_action: string
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
}

function boundedOwnerResult<T>(operation: Promise<T>): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("OWNER_RESULT_TIMEOUT")), 5_000)
    }),
  ])
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
  const [busy, setBusy] = useState(false)
  const controls = actionControls(result?.next_legal_action ?? null)
  const artifactControls = artifactActionControls(artifactResult?.next_legal_action ?? null)
  const canResolveImportedRequest = result === null && requestIdentityImported && requestIdentity.trim() !== ""
  const canResolveImportedArtifact = artifactResult === null && buildRequestIdentityImported && attemptIdentityImported && buildRequestIdentity.trim() !== "" && attemptIdentity.trim() !== ""
  const intentIdentity = result?.owner_receipt?.resulting_research_intent_identity
  const reviewActions = artifactResult?.artifact_review?.allowed_next_actions ?? []
  const admittedReviewActions = reviewActions.filter((action) => !action.endsWith("_NOT_IMPLEMENTED_IN_S2"))
  const notAdmittedReviewActions = reviewActions.filter((action) => action.endsWith("_NOT_IMPLEMENTED_IN_S2"))
  const statusLabel = useMemo(() => {
    if (!result) return "尚未提交"
    if (result.resolution === "ACCEPTED" && result.owner_receipt) return "R&D Owner 已接纳"
    if (result.resolution === "REJECTED_NO_WRITE" && result.owner_receipt) return "R&D Owner 拒绝且未创建研究事实"
    if (result.resolution === "IDENTITY_CONFLICT") return "请求身份与既有语义冲突"
    if (result.resolution === "ACCEPTED" || result.resolution === "REJECTED_NO_WRITE") return "未收到 Owner 终态回执"
    return "已提交或结果未知"
  }, [result])

  function update(key: keyof typeof initial, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function invoke(action: "SUBMIT" | "RESOLVE") {
    if ((action === "SUBMIT" && !controls.canSubmit) || (action === "RESOLVE" && !controls.canResolve && !canResolveImportedRequest)) return
    setBusy(true)
    if (action === "SUBMIT") {
      setResult({ resolution: "SUBMITTED_OR_UNKNOWN", request_identity: requestIdentity, next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY" })
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
        protected_feedback_frontier: "qualification-frontier:none",
        sources: [{
          locator: form.locator,
          content_digest: form.digest,
          observed_at: form.observedAt,
          source_cut: form.sourceCut,
          license_basis: form.license,
          interpretation: form.interpretation,
        }],
      } : undefined
      const response = await boundedOwnerResult(backend.research_goal({
        action,
        request_identity: requestIdentity,
        channel: "APP",
        goal,
      }) as Promise<OwnerResult>)
      setResult(response)
    } catch {
      setResult({ resolution: "SUBMITTED_OR_UNKNOWN", request_identity: requestIdentity, next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY" })
    } finally {
      setBusy(false)
    }
  }

  function newRequest() {
    if (!controls.canCreateSuccessor) return
    setRequestIdentity(`research-request-${crypto.randomUUID()}`)
    setRequestIdentityImported(false)
    setResult(null)
  }

  async function invokeArtifact(action: "RUN" | "RESOLVE") {
    if (!intentIdentity) return
    if ((action === "RUN" && !artifactControls.canRun) || (action === "RESOLVE" && !artifactControls.canResolve && !canResolveImportedArtifact)) return
    setBusy(true)
    if (action === "RUN") {
      setArtifactResult({
        resolution: "SUBMITTED_OR_UNKNOWN",
        build_request_identity: buildRequestIdentity,
        attempt_identity: attemptIdentity,
        next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
      })
    }
    try {
      const response = await boundedOwnerResult(backend.artifact_build({
        action,
        build_request_identity: buildRequestIdentity,
        attempt_identity: attemptIdentity,
        intent_identity: intentIdentity,
        channel: "APP",
      }) as Promise<ArtifactResult>)
      setArtifactResult(response)
    } catch {
      setArtifactResult({
        resolution: "SUBMITTED_OR_UNKNOWN",
        build_request_identity: buildRequestIdentity,
        attempt_identity: attemptIdentity,
        next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
      })
    } finally {
      setBusy(false)
    }
  }

  function newArtifactRequest() {
    if (!artifactControls.canCreateSuccessor) return
    setBuildRequestIdentity(`artifact-build-request-${crypto.randomUUID()}`)
    setBuildRequestIdentityImported(false)
    setAttemptIdentity(`artifact-build-attempt-${crypto.randomUUID()}`)
    setAttemptIdentityImported(false)
    setArtifactResult(null)
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
      {result && <dl><dt>唯一下一合法动作</dt><dd className="next">{result.next_legal_action}</dd></dl>}
      {result?.resolution === "SUBMITTED_OR_UNKNOWN" && <p className="unknown">结果仍未知。唯一合法动作是使用上方同一请求身份解析；不要创建裸重试或新身份。</p>}
      {result?.resolution === "REJECTED_NO_WRITE" && result.owner_receipt && <p className="rejected">该请求没有创建 Research Intent。修正输入需要显式创建一个后继请求身份。</p>}
      {result?.resolution === "IDENTITY_CONFLICT" && <p className="conflict">既有请求身份不会被新语义覆盖。唯一合法动作是用同一身份解析原始 Owner 回执；不要声称既有 Research Intent 不存在。</p>}
      {(result?.resolution === "ACCEPTED" || result?.resolution === "REJECTED_NO_WRITE") && !result.owner_receipt && <p className="unknown">缺少原生 Owner 回执，因此不能呈现业务终态。请停止并检查 Product Edge 边界。</p>}
    </section>

    <section className={`card result ${artifactResult?.resolution ?? "EMPTY"}`}>
      <div className="section-title"><span>03</span><div><h2>Strategy Artifact Formation</h2><p>Execution Agent 输出不受信任；只有 Owner 原子提交的 Artifact、Build Receipt 与 Review 是业务事实。</p></div></div>
      <div className="request-id"><span>Frozen Intent</span><code>{intentIdentity ?? "先完成 S1 Frozen Research Intent"}</code></div>
      <label className="request-id"><span>Build request</span><input aria-label="Artifact build request identity" value={buildRequestIdentity} disabled={busy || artifactResult !== null} onChange={(e) => { setBuildRequestIdentity(e.target.value); setBuildRequestIdentityImported(true) }} /></label>
      <label className="request-id"><span>Attempt</span><input aria-label="Artifact build attempt identity" value={attemptIdentity} disabled={busy || artifactResult !== null} onChange={(e) => { setAttemptIdentity(e.target.value); setAttemptIdentityImported(true) }} /></label>
      <div className="actions">
        <button disabled={busy || !intentIdentity || !artifactControls.canRun} onClick={() => invokeArtifact("RUN")}>启动有界 Agent 与隔离构建</button>
        <button className="secondary" disabled={busy || !intentIdentity || (!artifactControls.canResolve && !canResolveImportedArtifact)} onClick={() => invokeArtifact("RESOLVE")}>从 Owner 解析同一 attempt</button>
        <button className="quiet" disabled={busy || !artifactControls.canCreateSuccessor} onClick={newArtifactRequest}>创建后继 build request</button>
      </div>
      <div className="status-row"><strong>{artifactResult?.resolution === "SUCCESS" ? "Artifact 已由 R&D Owner 原子提交" : artifactResult ? "以 Owner resolution 为准" : "尚未启动"}</strong><code>{artifactResult?.resolution ?? "NOT_SUBMITTED"}</code></div>
      {artifactResult?.owner_receipt && <dl>
        <dt>Owner Formation 回执</dt><dd>{artifactResult.owner_receipt.receipt_identity}</dd>
        <dt>处置 / 失败码</dt><dd>{artifactResult.owner_receipt.disposition} / {artifactResult.owner_receipt.failure_code ?? "无"}</dd>
        <dt>Artifact / Build Receipt</dt><dd>{artifactResult.owner_receipt.artifact_identity ?? "无 Artifact"} / {artifactResult.owner_receipt.build_receipt_identity ?? "无"}</dd>
      </dl>}
      {artifactResult?.research_view && <dl>
        <dt>Research View</dt><dd>{artifactResult.research_view.phase} · {artifactResult.research_view.availability}</dd>
        <dt>权威 identities</dt><dd>{artifactResult.research_view.artifact_identity} / {artifactResult.research_view.build_receipt_identity} / {artifactResult.research_view.artifact_review_identity}</dd>
      </dl>}
      {artifactResult?.artifact_review && <dl>
        <dt>Artifact identity</dt><dd>{artifactResult.artifact_review.artifact_identity.artifact_digest}</dd>
        <dt>S1 Intent / semantic digest</dt><dd>{artifactResult.artifact_review.intent_identity} / {artifactResult.artifact_review.intent_semantic_digest}</dd>
        <dt>S1 request / source lineage</dt><dd>{artifactResult.artifact_review.request_identity}<br />{artifactResult.artifact_review.source_lineage.join(" · ")}</dd>
        <dt>Source / Wasm / recipe</dt><dd>{artifactResult.artifact_review.artifact_identity.guest_source_digest} / {artifactResult.artifact_review.artifact_identity.wasm_digest} / {artifactResult.artifact_review.artifact_identity.build_recipe_digest}</dd>
        <dt>结构化逻辑</dt><dd><code>{JSON.stringify(artifactResult.artifact_review.structured_logic)}</code><br />{artifactResult.artifact_review.structured_logic_summary}</dd>
        <dt>参数 / 依赖 identity</dt><dd>{artifactResult.artifact_review.parameters_identity} / {artifactResult.artifact_review.dependency_identity}</dd>
        <dt>Build / Security</dt><dd>{artifactResult.artifact_review.build_security_state} · double-build={String(artifactResult.artifact_review.build_receipt.deterministic_double_build)} · {artifactResult.artifact_review.build_receipt.sandbox_policy}</dd>
        <dt>Toolchain / target</dt><dd>{artifactResult.artifact_review.artifact_identity.rustc_release} / {artifactResult.artifact_review.artifact_identity.rustc_commit} / {artifactResult.artifact_review.artifact_identity.target}</dd>
        <dt>Agent 变更说明</dt><dd>{artifactResult.artifact_review.agent_change_explanation}<br /><strong>{artifactResult.artifact_review.agent_change_explanation_authority}</strong></dd>
        <dt>允许的下一动作</dt><dd className="next">{admittedReviewActions.join(" · ")}</dd>
        {notAdmittedReviewActions.length > 0 && <><dt>S2 NOT_ADMITTED</dt><dd>{notAdmittedReviewActions.join(" · ")}</dd></>}
      </dl>}
      {artifactResult && <dl><dt>唯一下一合法动作</dt><dd className="next">{artifactResult.next_legal_action}</dd></dl>}
      {["FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN"].includes(artifactResult?.resolution ?? "") && <p className="rejected">该终态没有 canonical Artifact；不得把 Windmill job green 或 Agent 文本解释为成功。</p>}
      {artifactResult?.resolution === "SUBMITTED_OR_UNKNOWN" && <p className="unknown">结果未知。只允许用同一 build request / attempt 从 Owner 解析。</p>}
    </section>

    <footer>非 live 产品切片 · 不构成 Alpha、Qualification、部署、资本、Risk、Execution 或交易授权</footer>
  </main>
}
