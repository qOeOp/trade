---
title: Model Gateway Runtime
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Model Gateway Runtime

## 1. 当前纵切

`ops.model-gateway` 将一个 provider-neutral `trade.model-task-request.v1` 交给固定 SiliconFlow profile，返回 typed `trade.model-task-result.v1`。当前只采用 `research_hypothesis`：研究 owner 编译 prompt/request，网关调用模型，研究 owner 再验证 hypothesis contract 并投影 queue item；只有后续 Research Control Plane `queue_proposal` CAS 能原子写入 validated ready proposal。

```text
R&D brief/context
  -> strategy-hypothesis-designer model_task
  -> ops.model-gateway / SiliconFlow JSON Object
  -> strategy-hypothesis-designer assess_model_result
  -> validated ready|blocked queue proposal
  -> Control Plane queue_proposal CAS
  -> existing RD supervisor
```

## 2. Authority

| Owner | 负责 | 不负责 |
| --- | --- | --- |
| `model-task-contract` | request/result shape、canonical hash、identity、budget、failure 与 `execution_authority=none` | provider IO、领域 schema |
| `strategy-hypothesis-designer` | context/prompt version、hypothesis lint、ready/blocked queue projection | provider/key、RD state 写入 |
| `model-gateway` | 固定 endpoint/model/capability、credential lookup、timeout、限次重试、JSON parse、usage 与脱敏结果 | hypothesis 判断、工具调用、DB/exchange/event write |
| Research Control Plane | CAS 接收 validated ready queue item；原 supervisor 消费并管理 Trial/Result | 信任未验证模型输出、自动 promotion |

request 不携带 provider、model、credential、路径、命令或 tool choice。result 不返回 prompt、key、Authorization、raw body 或 reasoning；`raw_response_ref` 只是由 provider id/model/usage/output hash 形成的脱敏相关性引用，不是原文存储。

## 3. 失败语义

- 仅 network/timeout 与 HTTP `429/503/504` 在 `max_attempts<=3` 内重试；耗尽返回 `retryable`，其他 provider HTTP 失败返回 `blocked`。
- credential 缺失、envelope/usage 异常、JSON 非对象、`finish_reason=length`、output hash/identity 漂移、token 超限与领域 schema 失败均 fail closed。
- JSON Object capability 只约束传输形态，不证明 hypothesis 合法；只有 designer lint 与 data/family binding 都通过才产生 `ready=true` proposal。
- provider failure 或无效 proposal 不推进 RD program、Trial、策略、交易或任何 owner store。

## 4. Secret 与配置

版本化 [model-gateway profile](../../profile/model-gateway.json) 固定国内站 `https://api.siliconflow.cn/v1`、model 和 `json_object` capability；密钥只从进程环境 `SILICONFLOW_API_KEY` 读取。Qwen JSON task 固定 `enable_thinking=false`，避免 reasoning 消耗有界 output budget 后留下空 content。仓库文件、CLI payload、artifact、trace、incident 与测试 fixture 不得包含真实 key。服务器部署应通过 credential facility 注入，不把 `.env` 当长期 authority。

2026-07-23 的真实 capability probe 使用同一 profile 验证 Chat JSON、SSE stream、single tool、同轮 multi-tool 与 tool-result continuation 均为 `200/passed`；`/responses` 明确返回 `404/unsupported_endpoint`。因此 SiliconFlow 当前可承载 Direct Model Task 与使用 Chat wire 的 Agent runtime 候选，但不能直接承载只接受 Responses custom provider 的 Codex `0.144.6`。该结论是 wire compatibility，不是模型质量或长期采用结论；probe 只持久化状态 / reason / HTTP code，不保存 raw response。

## 5. 当前证据与采用门

当前 typecheck 与编译后离线测试覆盖 canonical request/result、secret-like prompt、hash/authority/identity 漂移、credential 缺失、限次恢复、429/503、截断、无效 JSON/usage、token 超限、有效 hypothesis、领域 schema 失败及 provider failure；全链 authority 始终为 `none`。

已接入 J04 autonomy cycle 的 empty/unready queue 分支；ready/terminal plan 不调用模型，provider/schema/unready 失败不写状态。固定、无参数的 `bun run provider:smoke` 生成最小公开 JSON 请求，要求精确 semantic marker，只返回脱敏 task result，不写 owner state。2026-07-23 国内站真实调用一次完成，`passed=true`、marker 精确匹配，usage 为 prompt `48` / completion `16` / total `64`，provider capability smoke 已通过。固定 dataset 的 Agent/API quality/cost/latency 对比、持久化脱敏 usage/trace、rate-limit backoff/circuit breaker、server secret 注入与有界 soak仍未完成。因此本合同保持 `active-partial`；J01/J02/preflight/execution/reconcile 仍不得接入模型。

通用多轮 Agent Host 不属于本 feature：Host adapter 可以复用 provider capability 证据、统一 trace 语义和 owner MCP，但不得把 tool loop、session 或 code execution 塞入当前 `model-task-contract`，也不得扩大 `research_hypothesis` authority。可替换 Codex/OpenClaw/LangGraph 的 proposed 边界与同条件评测见 [Agent Host Runtime plan](../architecture/migrations/agent-host-runtime-integration-plan.md)。
