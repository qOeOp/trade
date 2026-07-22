---
title: Product Vision
role: product-contract
status: active
owner: product
last_verified: 2026-07-22 CST
---

# Product Vision

## 1. 北极星

让 agent 在无人持续盯盘时，也能基于新鲜事实、已验证策略、明确风险和可恢复执行，克制地推进 Binance USDM 单账户 4H+ swing；该停时可靠地停，该做时留下完整证据。

系统的价值不是产生更多交易，而是提高每次判断和动作的可解释性、可重复性与可纠错性。

## 2. 产品形态

本项目是一组运行在 agent 工作区里的 domain-owned tools、contracts 和自动化入口，不是：

- SaaS、UI、看板或多终端产品。
- 多账户 / 多交易所平台。
- 高频、做市或通用回测平台。
- 让模型无界搜索并自动升格策略的系统。

用户负责配置边界、处理重大异常和审阅策略变化；automation 负责在授权范围内推进事实链与工作链。

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

agent 负责提出判断，tool 提供事实，确定性代码执行硬约束，交易所事实最终覆盖本地在线 projection。

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

如果关键问题只能靠聊天记忆回答，产品仍未达到目标。

## 8. 演进约束

先闭合真实使用中暴露的事实、权限、执行和证据缺口，再增加 family、tool 或模拟能力。不预先固定尚未决定的流程、记录模型和组织结构，也不把一次实验结论写成长期制度。
