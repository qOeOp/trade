---
title: Product Vision
role: product-contract
status: active
owner: product
last_verified: 2026-07-23 CST
---

# Product Vision

## 1. 北极星

让程序在无人持续盯盘、Agent 暂时离线或模型不可用时，仍能基于新鲜事实、已验证策略、明确风险和可恢复执行，克制地推进 Binance USDM 单账户 4H+ swing；需要语义判断时再调用受约束的 Agent，该停时可靠地停，该做时留下完整证据。

系统的价值不是产生更多交易，而是提高每次判断和动作的可解释性、可重复性与可纠错性。

## 2. 产品形态

本项目是 **program-owned、agent-augmented、host-portable** 的长期运行交易与策略迭代系统：

- 常驻程序拥有 cadence、事实恢复、风险硬门和确定性执行。
- 领域 owner 拥有状态与写权限，MCP / HTTP 只暴露受控能力。
- Agent 负责有界语义任务与交互协作；Codex、OpenClaw 或其他 runtime 可以替换，但不能改变业务权限。
- 单次结构化模型任务、交互式 Agent 与确定性代码是三种执行形态，不互相伪装。

它不是：

- 通用 Agent 平台、聊天产品、SaaS、看板或多终端产品。
- 多账户 / 多交易所平台。
- 高频、做市或通用回测平台。
- 让模型无界搜索并自动升格策略的系统。

用户负责配置边界、选择 Agent Host、处理重大异常和审阅策略变化；program runtime 在授权范围内推进事实链与工作链。Agent Host 离线只会阻断依赖语义能力的任务，不得中断 L2、对账、风险守护或已授权的确定性 job。

## 3. 两条闭环

在线交易闭环：

```text
OBSERVE -> PLAN -> PREFLIGHT -> EXECUTE
  -> CONFIRM / RECONCILE -> REVIEW
```

策略验证闭环：

```text
hypothesis -> frozen experiment -> Replay evidence
  -> Forward / shadow evidence -> governance decision
  -> live-small evidence -> review -> next hypothesis / policy change
```

两条链通过 typed refs 和 governance 连接，不共享 authority：研究结果不能直接变成交易授权，在线盈亏也不能反向覆盖研究历史。

## 4. 核心原则

- No tested edge, no trade.
- No fresh facts, no trade.
- No executable contract, no trade.
- No stop / invalidation, no added risk.
- No reconciliation, no added risk.

Agent 负责提出判断，tool 提供事实，确定性代码执行硬约束，交易所事实最终覆盖本地在线 projection。Agent session、prompt、checkpoint 和自然语言 memory 都不是业务 authority。

## 5. 核心对象

| 对象 | 产品意义 |
| --- | --- |
| `strategy` | 可版本化规则模板，不等于实盘资格 |
| `setup` | strategy 下一个可证伪机会，live 动作必须绑定 |
| `lane` | `strategy_ref + symbol + side` 的运行槽位 |
| `flow` | 一笔机会 / 暴露从观察到闭合的生命周期 |
| `evidence` | 可回到数据、代码、成本、执行与裁决的证明链 |

在线 event、研究 state、governance decision 和 artifact lineage 是不同事实，不使用聊天记录或自然语言摘要互相替代。

## 6. 判断质量

市场分析只有能改变以下一项时才进入动作合同：

- `entry`
- `stop`
- `size`
- `no_action`

其余信息可以保留为 notes / refs，但不能靠叙事提高权限或覆盖 blocked verdict。

## 7. 成功标准

系统成熟度优先体现为：

- 不重复下单，不漏保护。
- 未验证 setup 不动真钱。
- 对账失败能停，状态能从交易所事实恢复。
- 每笔新增风险都有完整 plan、policy、preflight 与 execution trace。
- Replay / shadow / live-small 的差异可归因。
- 失败、no_action、no_promote 和 blocked 都能形成可复用信息。
- 策略或 policy 变化不会改写旧证据。
- 替换或关闭 Agent Host 不需要迁移领域状态，也不会停止不依赖模型的常驻能力。
- 每次模型或 Agent 参与都能回到输入 refs、能力边界、预算、版本、审批和结构化结果。

如果关键问题只能靠聊天记忆回答，产品仍未达到目标。

## 8. 演进约束

先闭合真实使用中暴露的事实、权限、执行和证据缺口，再增加 family、tool、Agent Host 或模拟能力。不预先固定尚未决定的流程、记录模型和组织结构，也不把一次实验结论写成长期制度。

Agent Host 的采用以同一模型、同一能力面、同一任务集下的质量、安全、恢复和成本证据为准；产品合同只固定可替换边界，不预先指定 Codex、OpenClaw、LangGraph 或单一 provider 为永久答案。
