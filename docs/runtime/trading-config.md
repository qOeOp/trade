---
title: Trading Config
role: runtime-feature-contract
status: active-partial
owner: policy-risk
last_verified: 2026-07-23 CST
---

# Trading Config

## 1. 当前合同

`profile/trading-config.json` 是唯一人工维护的项目级交易配置入口。`modules/policy-risk/runtime-policy-compiler` 负责读取、归一化、限幅、hash 并生成 `runtime-policy.v1`；`policy-registry` 记录 snapshot 并签发短期 `runtime-authorization.v1`。二者都不读取 live facts，也不做 preflight 或执行判断。

配置已统一，consumer 尚未全部统一，因此状态是 `active-partial`。

## 2. 配置拥有与不拥有

| 配置拥有 | 其他 owner 拥有 |
| --- | --- |
| mode、permissions、risk / exposure caps | equity、position、order、mark、funding、spread、depth |
| execution defaults、cost assumptions | strategy entry / stop / thesis |
| R&D budget defaults | Trial / Result / evidence |
| lane enable 与更严格 override | flow、event、review |
| notification policy（无凭证） | API key、token、chat id |

凭证只走环境变量；live facts、运行状态和证据不得回写配置。

## 3. 合成语义

```text
global trading config
  -> strategy / setup policy
  -> lane override
  -> current plan
  -> compiled runtime policy
  -> registered snapshot + short-lived authorization
  -> live account + market facts + portfolio projection
```

- 权限：explicit deny wins。
- 风险 / 暴露 cap：most restrictive wins。
- 成本假设：more conservative wins。
- strategy owns entry / stop / thesis；config 只能进一步限制。
- facts 参与计算，不覆盖 policy。

## 4. 当前配置段

| 段 | 用途 |
| --- | --- |
| `schema_version / profile_id / account_ref / account_scope / mode` | profile 身份、非敏感 venue account 绑定、风险聚合范围与运行模式 |
| `permissions` | `live-small` 和最高阶段许可 |
| `risk` | 单笔、总 open risk、日损、并发 risk flow |
| `exposure` | entry / symbol / gross notional、leverage、beta-equivalent caps |
| `execution` | market、margin、order preference、slippage / funding assumptions |
| `research` | trial / parameter budget、成本默认值、禁止自动 promotion |
| `lanes` | 启用范围与更严格 lane override |
| `notifications` | 开关和最低 severity；凭证不在此处 |

字段的实际 shape 以 `profile/trading-config.json` 与 compiler tests 为准，不在本文复制一份易漂移 JSON。

## 5. Runtime Policy Snapshot

执行与复盘消费 compiler 输出，而不是各自解释原始 JSON。compact snapshot 至少保留：

- `source_hash`
- `mode / permissions`
- `effective_limits`
- `cost_model`
- `applied_overrides`
- `warnings`

snapshot 是当时 policy 的可追溯证据，不是账户或行情快照。

`account_ref` 只绑定稳定 venue account identity，`account_scope` 只声明风险聚合范围；二者都不是 credential、余额或授权。运行时必须校验 policy、exchange facts 与 portfolio projection 的 scope 一致。

新增风险还必须持有 registry 签发的短期 authorization：它绑定当前 policy ref/hash 与 account scope，并携带 `issued_at / expires_at / authorization_ref`。authorization 不是 durable balance、capital reservation 或 exchange capability；Execution 仍需最新 facts、projection 和 intent 才能生成受限 capability。

## 6. 当前已生效与未生效

已生效：

- canonical config load 与 legacy config adaptation。
- normalize、hard-limit clamp、source hash、registered snapshot 与短期 authorization。
- preflight 已消费的 risk / notional / leverage / concurrency 等限制，具体见 [Risk Control Contract](./risk-control-contract.md)。

尚未形成统一强制链：

- BTC beta-equivalent 集中度。
- funding erosion / spike。
- spread、order-book depth 与 market impact。
- 所有 R&D / benchmark consumer 统一从 runtime policy 取成本默认值。

字段出现在 config 不等于已执行；只有 compiler 输出、owner consumer、preflight contract 和测试同时存在时才能声明 enforced。

## 7. Legacy 输入

- `profile/account_config.json` 与 `profile/notify_config.json` 只用于兼容读取；新配置不得继续写入它们。
- loader 适配 legacy 输入时必须产生 warning。
- legacy support 只能缩减，删除前需确认没有调用方。

## 8. 变更合同

新增或修改字段必须同步 compiler schema/tests、实际 consumer、本文和必要的 risk contract。不得用 config 字段预先固定尚未决定的策略流程、tool 数量或研究模型。
