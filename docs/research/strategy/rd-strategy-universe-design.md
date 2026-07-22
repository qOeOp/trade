---
title: RD Strategy Universe
role: research-feature-contract
status: active
owner: research-strategy-development
last_verified: 2026-07-22 CST
---

# RD Strategy Universe

## 1. 定位

Strategy Universe 防止 R&D 把“当前能跑的几种价格形态”误当成全部策略空间。它定义稳定 taxonomy、family coverage、研究准入和 promotion boundary；不规定每轮必须研究多少 family，也不授权自动搜索或实盘。

## 2. Authority

| 内容 | 权威 |
| --- | --- |
| taxonomy / identity / lifecycle schema | Research Control Plane state-store contracts 与 DDL |
| family 当前覆盖、known lessons、next actions | [strategy-universe-family-backlog.json](./strategy-universe-family-backlog.json) |
| P0 family 证明 | [strategy-universe-p0-family-certificates.json](./strategy-universe-p0-family-certificates.json) |
| 研究方法与统计证明 | [R&D Research Survey](../sources/rd-research-survey.md) |
| 历史设计与完整 DDL 推导 | [Legacy RD Strategy Universe Design](../../history/legacy-rd-strategy-universe-design.md) |

机器 backlog 的 `implemented_*` 只表示对应 runner / scorer 可运行，不代表有 edge、可 promotion 或可 live。

## 3. Taxonomy 原则

每个研究节点至少由以下轴解释：

- return driver：trend / momentum、mean reversion、carry、relative value、volatility、liquidity / marketability 等。
- portfolio shape：single asset、cross-sectional、long-short、relative / spread、universe gate。
- data surface：OHLCV、funding、OI、aggregate trade、panel、instrument status、外部 cited source 等。
- execution dependence：bar-close、next-open、limit / stop、portfolio accounting、liquidity requirement。
- product scope：active、catalog only、data/tool blocked、out of scope、deprecated。

节点身份与路径稳定；新增或删除 taxonomy 节点必须说明无法由现有轴表达的机制差异，不得因新建一个 tool 就增加策略大类。

## 4. Family 状态语义

| 状态 | 含义 |
| --- | --- |
| `implemented_single_asset_replay` | 可运行单资产 replay；仍需完整 evidence gate |
| `implemented_panel_research` | 可做 panel 研究；未必具备 portfolio / promotion contract |
| `implemented_panel_scorer` | 是 universe / quality gate，不等于 trading edge |
| `design_backlog` | 机制值得设计，但执行 / portfolio 语义不足 |
| `data_backlog` | 缺 point-in-time 数据或数据合同 |
| `out_of_scope_now` | 合法策略类别，但不属于当前 4H+ swing 产品 |

coverage 是能力盘点，不是优先级承诺。Planner 必须结合 evidence debt、失败记录、数据可用性和 trial budget 选题。

## 5. Hypothesis 准入

进入队列前必须形成结构化 hypothesis contract：

- mechanism 与 economic rationale。
- universe node / family / data surface。
- frozen candidate space 与 trial budget。
- discovery / validation / locked holdout split。
- cost、execution、liquidity 和 regime assumptions。
- negative controls、failure criteria、stop condition。
- 与既有 rejected mechanism / lesson 的差异。

“多试几个参数”“加一个过滤器”或重复已失败 family 不能单独构成新 hypothesis。

## 6. 研究生命周期

```text
proposal
  -> validated hypothesis
  -> frozen experiment contract
  -> registered / reserved Trial
  -> Replay / Forward Result
  -> research review
  -> rejected / needs_evidence / accept_for_draft
  -> governance intake
```

- lifecycle event append-only；projection 可重建。
- agent 只能提交 proposal / decision，不直接写权威状态。
- selection、budget usage、failure 和 negative control 必须留存。
- `accept_for_draft` 只允许物化 draft，不等于 shadow 或 live-small。

## 7. Evidence gate

候选至少需要：

- 无 lookahead 的 PIT 数据与冻结 split。
- 样本量、cost、regime、parameter robustness。
- family 合适的 negative controls 与 multiple-testing 约束。
- execution assumptions 与 live 路径可解释对齐。
- locked holdout 不被 discovery 消费。
- 失败和不可复现结果进入 lesson，不被摘要覆盖。

具体统计口径由 Research Survey 和 owner contracts 定义，本文不复制阈值。

## 8. 产品边界

- R&D 不写 `trade.db`，不调用 Binance write。
- marketability scorer、benchmark、calibration、funding governance 是研究能力，不自动成为 strategy。
- out-of-scope family 可留 taxonomy，不进入当前 backlog 执行。
- 新 data surface 必须先有 owner、lineage、freshness / completeness contract。
- 不根据当前工具数量冻结长期策略宇宙。

## 9. 变更合同

变更 taxonomy、family 状态或 lifecycle 必须同步 state-store contract / DDL、machine backlog、certificates、相关 runner tests 和本文。只改自然语言不改变机器事实。
