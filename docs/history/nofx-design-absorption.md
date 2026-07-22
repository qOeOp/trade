---
title: NOFX Design Absorption
role: historical-research
status: completed-historical
owner: architecture
last_verified: 2026-07-22 CST
source_repo: https://github.com/NoFxAiOS/nofx
source_commit: d84e22ab82643fd50f0ad4706697fcb07fae52c4
---

# NOFX Design Absorption

> 本文是一次完成的外部设计吸收记录，不是当前架构入口；实际落地以 [Design Architecture](../architecture/design-architecture.md) 与模块 `CONTRACT.md` 为准。

结论：NOFX 可借鉴的是 runtime discipline，不是产品形态。它是多用户、多交易所、Web terminal + Autopilot；本项目仍是 agent 工作区内的 Binance USDM 单账户 4H+ swing 套件。

吸收原则：

- 吸收 hard clamp / throttle / health / memory boundary。
- 不吸收 Web UI、competition、多用户、多交易所 manager。
- 不把模型直出 `open_long / open_short` 的准入哲学搬进真钱链。
- 不降低 `setup -> replay -> shadow -> live-small -> review` gate。

## 1. 可吸收设计

| NOFX 设计 | 本项目吸收方式 | 优先级 |
| --- | --- | --- |
| Strategy config normalize + clamp | 强化 `trading-config -> runtime_policy`：输入归一化、数值限幅、hash、deprecated input adapter、测试 | P0 |
| Runtime hard risk limits | 继续把 notional / leverage / exposure / funding / freshness 收进 `plan-preflight`，不靠 prompt 自觉 | P0 |
| Trade throttle | 新增 churn guards：最短持仓、噪音平仓窗口、同 lane / symbol 再入冷却、单位时间开仓上限 | P0 |
| Safe mode / runtime health | 连续 AI / Binance / reconcile 失败只允许减风险；safe mode 状态进入 preflight | P1 |
| Memory layers | 明确 conversation context、research memory、execution projection 三层不可互相替代 | P1 |
| AI output fail-closed | 执行相关 JSON 解析失败默认 `no_action / wait`，不得补写成功事件 | P1 |

## 2. 不吸收

- Web dashboard / Strategy Studio / Competition。
- 多用户 auth、JWT、leaderboard、公共策略市场。
- 多交易所统一 Trader interface。
- x402 / Claw402 付费模型钱包。
- 模型每轮直接决定真钱 open / close 的主路径。
- full-size autopilot 仓位哲学。

这些会把项目从“安全推进少量 setup”推向“平台化自动交易产品”，与当前 vision 冲突。

## 3. 重构计划

### N1 Runtime Policy Compiler

目标：把配置归一化和限幅变成执行前唯一政策入口。

落点：

- `profile/trading-config.json` 仍是唯一人工维护入口。
- `flow/runtime-policy-compiler` 增加 normalize / clamp：mode、permission、risk、exposure、execution、research、lanes。
- lane override 合成时 explicit deny wins，数值 cap most restrictive wins，成本假设 more conservative wins。
- `compactPolicySnapshot` 写入 observe，review 可追溯当时底线。

验收：

- 缺 `trading-config.json` 时 deprecated fallback 仍不可 live-small。
- 超范围 leverage / notional / risk / candidate 参数被 clamp 或 warning。
- `source_hash` 对 canonical config 稳定。

### N2 Churn Guards

目标：把“少动、别噪音平仓、别刚平又进”从 prompt 习惯变成 hard guard。

新增 guard 候选：

- `G-OPEN-RATE-CAP`：单位时间 / 单轮新增风险次数上限。
- `G-REENTRY-COOLDOWN`：同 lane / symbol 平仓后冷却期内禁止新增风险。
- `G-MIN-HOLD-BEFORE-NOISE-CLOSE`：未触发 stop / invalidation / 明确 take-profit 前，短持仓禁止噪音平仓。
- `G-SAME-LANE-OPPOSITE-OPEN-CAP`：同 lane active flow 未闭合时禁止反向新开。

落点：

- `plan-preflight` 消费 `aggregate_view.recent_order_fills / flow_age / lane_state`。
- 防御性 `cancel_order / sync_protection / reduce / exit` 不被新增风险 throttle 阻断。
- guard 只阻断执行，不改写 thesis。

验收：

- 单测覆盖 early noise close、hard stop bypass、take-profit bypass、reentry cooldown、per-cycle cap。
- blocked observe 的 `decision_summary` 可读。

### N3 Runtime Health Safe Mode

目标：连续系统失败后自动降权为“只防御，不加风险”。

状态字段：

- `ai_failures_streak`
- `binance_api_failures_streak`
- `reconcile_mismatch_streak`
- `safe_mode_active`
- `safe_mode_reason`
- `last_recovered_at`

规则：

- 连续失败达到阈值后，preflight 对新增风险返回 `G-KILL-SWITCH`。
- safe mode 仍允许 `cancel_order / sync_protection / adjust_position reduce / exit`。
- 全量对账成功 + 新鲜事实恢复后才清除对应 streak。

验收：

- fast / slow 共用同一 runtime health 输入。
- safe mode 不写成 long-term memory，只是运行态投影。

### N4 Memory Boundary

目标：防止旧对话、研究状态、执行状态互相污染。

三层命名：

- `conversation_context`：用户接管语境，不是交易事实源。
- `research_memory`：`rd_program_state`、R&D artifact、catalog，不能写 `trade.db`。
- `execution_projection`：`plan_event` reducer、active flow、runtime health，是真钱链事实输入。

落点：

- `docs/architecture/design-architecture.md` 补一段 memory boundary。
- `docs/product/chat-history.md` 继续作为高价值素材，不作为 live evidence。

验收：

- 任意真钱动作只可引用 `execution_projection + fresh exchange facts + strategy evidence`。
- R&D state 不可直接产生 action_intent。

### N5 Parser / Envelope Fail-Closed

目标：执行路径遇到非结构化输出时默认无动作。

落点：

- 写 tool 输出仍使用 `ok / data / error` 外壳。
- `trade-flow` 只在 `ok=true` 且最低字段满足时写 `order_fill`。
- 非 JSON、缺字段、解析异常统一记录为 blocked / no_action artifact，不补本地成功事件。

验收：

- contract tests 覆盖 malformed JSON、ok=false、缺最低字段、执行 tool 成功但 normalized event 缺失。

## 4. 执行顺序

| Phase | 内容 | 状态 |
| --- | --- | --- |
| P0-A | N1 runtime policy normalize / clamp | 已实施 |
| P0-B | N2 churn guards 最小集 | 已实施 |
| P1-A | N3 runtime health safe mode | 已实施 |
| P1-B | N4 memory boundary 文档化 | 已实施 |
| P1-C | N5 parser fail-closed contract tests | 已实施 |

## 5. 红线

- 不把 NOFX 的 autopilot full-size / forced coverage 作为策略准入。
- 不因 NOFX 支持多交易所而扩展本项目范围。
- 不新增 UI / SaaS / leaderboard。
- 不把 prompt guard 当 hard guard。
- 不用 runtime health 替代 exchange reconciliation。
