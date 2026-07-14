---
title: RD Architecture Migration Plan
updated_at: 2026-07-14 CST
status: physical-root-converged
---

# RD Architecture Migration Plan

## 1. 结论

`modules/research-strategy-development/` 的目标直接责任子树固定为：

```text
research-control-plane/
replay-execution-plane/
forward-evidence-plane/
agent-roles/
```

目录平级只表达 owner boundary，不表达权力对等。Research Control Plane 是 RD 事实单写者；Replay 与 Forward 是受 Reservation 约束的证据执行面；Agent Role 只提交 Proposal、Candidate 或 Decision，不直接写权威事实。项目级 `strategies/` 是 Draft Strategy Source 的唯一落盘面，不是第五个 RD 子树。

迁移采用 `contract -> owner -> adapter -> cutover -> retire`，禁止把移动、拆分、语义增强和删除混成一次不可审计重写。机器清单见 `docs/rd-module-disposition.json`。

## 2. 迁移不变量

- Strategy Universe taxonomy 不变。
- 现有已测试行为在 parity fixture 建立前不得被静默改写。
- 临时 conservative behavior 只能标为 legacy/limitation，不能自动升级为长期 simulator policy。
- Control Plane 的 Contract、Trial、Result、Review、Lifecycle 与 KG 仍由同一 `research_state_store` 事务边界维护。
- Replay/Forward 只返回 Result、Artifact、Fingerprint 与运行状态。
- `accept_for_draft` 是 Draft Strategy 物化的唯一授权；物化失败不得进入 Forward。
- Forward 必须绑定落盘策略的 `strategy_ref + policy_hash + frozen_at`，不能只绑定裸 Candidate。
- 正式 Shadow、Live-small、交易订单和账户事实不迁入 RD。

## 3. 切换顺序

1. 将 Research State Store 移到 `research-control-plane/state-store/`，切换调用方后删除旧路径。
2. 建立 Replay Request/Result、Forward Session/Result 与 Draft Strategy Registry 合同。
3. 在新 Replay owner 中落第一条 certified vertical slice，并让旧 runner 逐步转为 adapter。
4. 由 Strategy Registry 完成 `accept_for_draft -> render -> lint -> hash -> atomic write -> registry`。
5. Forward 只消费已 ready 的 Draft Strategy binding，并复用 Replay 的公开 simulator semantics。
6. 建立 Planner、Developer、Reviewer 角色入口；从 Supervisor/Campaign/Evaluator 中逐步抽离角色逻辑。
7. manifest、tool registry、automation 与测试切到新 owner；只删除满足零调用方和 parity 认证的旧入口。

## 4. 完成定义

- 新路径是 manifest、tool registry、源码 import 与文档的 canonical owner。
- 根级旧路径不得存在；尚未完成语义替换的实现只能位于目标子树的 `compatibility/` 或明确 migration-source 位置。
- 至少一条 `Contract -> Trial -> Replay -> Result -> Review -> Draft Strategy -> Forward Result` 纵切由测试锁定。
- 新旧 Replay 正式重叠能力通过 parity；不重叠能力必须显式拒绝或输出 limitation。
- 完整质量检查通过，生成架构投影无 orphan package。

## 5. 当前执行状态

本轮已按上述顺序执行到安全切换点，而不是把尚未达到 parity 的旧实现强删：

| 阶段 | 状态 | 当前结果 |
|---|---|---|
| owner 建立 | 已完成 | RD 根仅剩四个目标直接子树；State Store 已迁至 `research-control-plane/state-store/`，旧目录与兼容链接均已删除 |
| 合同冻结 | 已完成首版 | Control Plane、Replay、Forward、Draft Strategy binding 均有 typed contract 与测试 |
| Replay 纵切 | 已完成受限认证 | single-asset、closed-candle、next-open、stop/target、fee/slippage/funding、ledger、fingerprint、artifact commit 已锁定；复杂订单/portfolio 不冒充已支持 |
| Draft 落盘 | 已完成 | `accept_for_draft -> render -> lint -> hash -> atomic write -> registry` 已由 Control Plane owner 实现 |
| Forward 纵切 | 已完成受限认证 | 只消费 ready Draft，执行 post-freeze/no-backfill admission，并复用 Replay semantics |
| Agent Role 边界 | 已完成首版 | Planner、Developer、Reviewer 只生成提交物，不取得 Plane 写权限 |
| manifest/tool/test 切换 | 已完成物理路径切换 | tool、job、manifest、imports、tests 均引用四子树内路径；布局门禁拒绝任何第五个根节点 |
| legacy retire | 根级路径已完成，语义淘汰继续 | J04/J05 的 legacy job shell 已迁入 Control/Forward 子树；Replay/benchmark/panel 等旧实现已进入 `compatibility/`，达到 parity 前保留但不得扩张权威语义 |

因此 `physical-root-converged` 表示物理目录、注册表和调用路径已经收敛，不表示所有 legacy 语义已经被新内核替换，也不表示 Replay 的 order state machine、portfolio、margin/liquidation 或 fast parity 已完成。后续演进必须在四个目标子树内进行，并按 `docs/rd-module-disposition.json` 逐项消除 compatibility 实现。
