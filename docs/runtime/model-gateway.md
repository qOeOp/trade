---
title: Model Gateway Runtime
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Model Gateway Runtime

## 1. 当前纵切

`ops.model-gateway` 将一个 provider-neutral `trade.model-task-request.v1` 交给固定 SiliconFlow profile，返回 typed `trade.model-task-result.v1`。当前只采用 `research_hypothesis`：研究 owner 编译 prompt/request，网关调用模型，研究 owner 再验证 hypothesis contract 并投影 queue item；任何一步都不写 RD state。

```text
R&D brief/context
  -> strategy-hypothesis-designer model_task
  -> ops.model-gateway / SiliconFlow JSON Object
  -> strategy-hypothesis-designer assess_model_result
  -> validated ready|blocked queue proposal
  -> explicit Control Plane submission (not part of this chain)
```

## 2. Authority

| Owner | 负责 | 不负责 |
| --- | --- | --- |
| `model-task-contract` | request/result shape、canonical hash、identity、budget、failure 与 `execution_authority=none` | provider IO、领域 schema |
| `strategy-hypothesis-designer` | context/prompt version、hypothesis lint、ready/blocked queue projection | provider/key、RD state 写入 |
| `model-gateway` | 固定 endpoint/model/capability、credential lookup、timeout、限次重试、JSON parse、usage 与脱敏结果 | hypothesis 判断、工具调用、DB/exchange/event write |
| Research Control Plane | 显式接收 validated ready queue item | 信任未验证模型输出 |

request 不携带 provider、model、credential、路径、命令或 tool choice。result 不返回 prompt、key、Authorization、raw body 或 reasoning；`raw_response_ref` 只是由 provider id/model/usage/output hash 形成的脱敏相关性引用，不是原文存储。

## 3. 失败语义

- 仅 network/timeout 与 HTTP `429/503/504` 在 `max_attempts<=3` 内重试；耗尽返回 `retryable`，其他 provider HTTP 失败返回 `blocked`。
- credential 缺失、envelope/usage 异常、JSON 非对象、`finish_reason=length`、output hash/identity 漂移、token 超限与领域 schema 失败均 fail closed。
- JSON Object capability 只约束传输形态，不证明 hypothesis 合法；只有 designer lint 与 data/family binding 都通过才产生 `ready=true` proposal。
- provider failure 或无效 proposal 不推进 RD program、Trial、策略、交易或任何 owner store。

## 4. Secret 与配置

版本化 [model-gateway profile](../../profile/model-gateway.json) 固定 endpoint、model 和 `json_object` capability；密钥只从进程环境 `SILICONFLOW_API_KEY` 读取。仓库文件、CLI payload、artifact、trace、incident 与测试 fixture 不得包含真实 key。服务器部署应通过 credential facility 注入，不把 `.env` 当长期 authority。

## 5. 当前证据与采用门

当前 typecheck 与编译后离线测试覆盖 canonical request/result、secret-like prompt、hash/authority/identity 漂移、credential 缺失、限次恢复、429/503、截断、无效 JSON/usage、token 超限、有效 hypothesis、领域 schema 失败及 provider failure；全链 authority 始终为 `none`。

仍未完成：真实 credential 下的单次 capability smoke、固定 dataset 的 Agent/API quality/cost/latency 对比、持久化脱敏 usage/trace、rate-limit backoff/circuit breaker、server secret 注入与有界 soak。因此本合同保持 `active-partial`，当前 server profile 不依赖模型，J01/J02/preflight/execution/reconcile 也不得接入模型。
