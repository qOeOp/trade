---
title: RD Strategy Universe
role: research-feature-contract
status: active
owner: research-strategy-development
last_verified: 2026-07-23 CST
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

## 4. Universe、Family、策略与代码不是同一层

逻辑分类保持：

```text
Strategy Universe
  -> return-driver / portfolio / data 等 taxonomy 节点
  -> family（稳定机制身份）
  -> strategy version（该机制的一份具体政策与证据）
```

代码实现是与这棵分类树正交的绑定，不是 family 的定义：

| 层 | 回答的问题 | 当前载体 | 是否要求有代码 |
| --- | --- | --- | --- |
| Universe taxonomy | 研究空间有哪些机制、组合和数据方向 | 本文、machine backlog、Control Plane state | 否 |
| family | 一类可区分的 economic / behavioral mechanism 是什么 | stable `family_id`、certificate、coverage status | 否；可为 design / data backlog |
| family implementation | 某 engine / release 能否计算该 family | runner / scorer / family module 代码 | 是，但只实现 family 的一个可执行 surface |
| strategy version | 哪个具体 universe、参数、风险、执行、证据和权限组合被冻结 | `strategies/*.md` + compiled contract + hashes | 只有要运行的部分必须有可执行 binding |
| setup / flow | 该策略本次机会与暴露发生了什么 | online event / projection | 依赖已接纳策略版本 |

因此 `family_id=structure_breakout_retest_v1` 同时出现在 backlog、MD Trade Contract 和代码 registry 中，只表示它们引用同一机制身份；不能反推“family 就是那份代码”。同一 family 可先只有论文 / 设计，后有 panel scorer，再有 Replay 实现，最终才可能有 Runtime 实现；不同实现还必须显式区分 engine、release 和 semantic hash。

### 4.1 当前 MD → 代码链

`strategies/*.md` 是 literate strategy policy：自然语言解释供用户 / Agent 阅读，`## Trade Contract` 中的 YAML 是机器可编译部分。

```text
strategy.md
  -> strategy-contract compiler
  -> compiled Strategy Contract
  -> engine binding
     - rnd_family_v1 -> family id + params -> current R&D family implementation
     - manual_policy_v1 -> declared semantic lifecycle
```

当前真实边界：

- `rnd_family_v1` 文件可编译为 Candidate，并由 Signal / Replay 路径按 `family` 字符串找到静态注册的实现。
- `manual_policy_v1` 可被 compiler / lint 结构化，但当前 Signal Evaluator 明确拒绝；服务器 Runtime 也尚未实现对其 semantic lifecycle 的 Agent-assisted 执行。
- 当前慢轨只索引策略 MD 的 frontmatter / body 形成策略池摘要，并未证明完整 Trade Contract 已驱动在线 signal。
- `strategy-policy-writer` 可由结构化 R&D candidate 单向生成 MD；任意 MD、任意代码与自然语言之间都没有、也不应承诺无损双向转换。
- 当前 `family_id -> code` 主要依赖静态 registry 与 release 源码，尚缺显式 implementation version / semantic hash binding。

### 4.2 长期编译原则

MD 保留为人和 Agent 可审阅的策略源文档，但 Runtime 不直接“执行整篇 Markdown”：

1. compiler 只把声明为机器合同或 semantic policy input 的部分编译为 immutable Strategy IR。
2. family-backed 策略由 IR 绑定 `family_id + engine + implementation release/hash` 后确定性执行。
3. 仍需要语义判断的策略由 IR 形成有界 Agent task；Agent 只返回 typed proposal，随后仍经过 owner validation、preflight 和 execution。它不能冒充 deterministic Replay parity。
4. 纯研究 / catalog family 可以没有执行 binding，也不得物化为可运行策略。
5. 一个策略版本绑定 source document hash、compiled contract hash 和 implementation binding；修改 MD 机器语义、family code 或 Agent policy input 都形成新版本 / stale evidence。

不做 code → 完整 MD 的反编译。代码只提供 versioned capability manifest、输入输出和测试证明；renderer 可以据此生成可核对摘要，但 thesis、证据、失效条件与治理说明仍属于策略源文档。MD 叙事与机器合同矛盾时必须 review fail，不允许 Agent 选择更方便的一边。

## 5. Family 状态语义

| 状态 | 含义 |
| --- | --- |
| `implemented_single_asset_replay` | 可运行单资产 replay；仍需完整 evidence gate |
| `implemented_panel_research` | 可做 panel 研究；未必具备 portfolio / promotion contract |
| `implemented_panel_scorer` | 是 universe / quality gate，不等于 trading edge |
| `design_backlog` | 机制值得设计，但执行 / portfolio 语义不足 |
| `data_backlog` | 缺 point-in-time 数据或数据合同 |
| `out_of_scope_now` | 合法策略类别，但不属于当前 4H+ swing 产品 |

coverage 是能力盘点，不是优先级承诺。Planner 必须结合 evidence debt、失败记录、数据可用性和 trial budget 选题。

## 6. Hypothesis 准入

进入队列前必须形成结构化 hypothesis contract：

- mechanism 与 economic rationale。
- universe node / family / data surface。
- frozen candidate space 与 trial budget。
- discovery / validation / locked holdout split。
- cost、execution、liquidity 和 regime assumptions。
- negative controls、failure criteria、stop condition。
- 与既有 rejected mechanism / lesson 的差异。

“多试几个参数”“加一个过滤器”或重复已失败 family 不能单独构成新 hypothesis。

## 7. 研究生命周期

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

## 8. Evidence gate

候选至少需要：

- 无 lookahead 的 PIT 数据与冻结 split。
- 样本量、cost、regime、parameter robustness。
- family 合适的 negative controls 与 multiple-testing 约束。
- execution assumptions 与 live 路径可解释对齐。
- locked holdout 不被 discovery 消费。
- 失败和不可复现结果进入 lesson，不被摘要覆盖。

具体统计口径由 Research Survey 和 owner contracts 定义，本文不复制阈值。

## 9. 产品边界

- R&D 不写 `trade.db`，不调用 Binance write。
- marketability scorer、benchmark、calibration、funding governance 是研究能力，不自动成为 strategy。
- out-of-scope family 可留 taxonomy，不进入当前 backlog 执行。
- 新 data surface 必须先有 owner、lineage、freshness / completeness contract。
- 不根据当前工具数量冻结长期策略宇宙。

## 10. 变更合同

变更 taxonomy、family 状态或 lifecycle 必须同步 state-store contract / DDL、machine backlog、certificates、相关 runner tests 和本文。只改自然语言不改变机器事实。
