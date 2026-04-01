# ADR 0001: Keep The Workspace Skills-First

日期：2026-04-01

## Status

Accepted

## Context

这个仓库是 Codex-native BTC 交易工作仓库，不是独立应用，也不是自动化数据平台。

当前已经稳定存在的资产只有三类：

- operator 入口与规则文档
- repo-local skills
- append-only records 与模板

与此同时，未来很可能出现更重的上下文，例如市场数据采集、新闻链路、研究实验、回测和评测基准。

风险在于：如果现在就把这些未来上下文都落成真实目录，仓库会先得到“完整感”，但失去低 churn 和真实边界。

## Considered Options

### Option A: 继续平面化，不新增架构文档

- 优点：最轻。
- 缺点：一旦 future contexts 进入讨论，边界会迅速漂移。

### Option B: 保持单 operator，先把 active / latent 边界写成稳定合同

- 优点：最符合当前事实；能吸收未来复杂度；不会过早模块化。
- 缺点：需要维护 outline 文档与 schema。

### Option C: 现在就创建所有候选 bounded contexts 的目录骨架

- 优点：目录提前就位。
- 缺点：空模块会制造假复杂度；边界在真实 artifacts 出现前就被冻结。

## Decision

采用 Option B。

具体决策：

1. 继续保持单个 Codex operator 作为入口。
2. 把 `risk-guard`、`research-synthesis`、`scenario-planning`、`decision-chain` 定义为 active modules。
3. 把 `rd-lab`、`market-ingest`、`market-cleanroom`、`market-catalog`、`news-ingest`、`news-chain`、`backtest-lab`、`eval-bench`、`operator-playbooks` 保持为 latent contracts。
4. 只有满足至少两个 promotion triggers 时，latent contract 才能变成真实目录。
5. 记录模型继续坚持 append-only，并补充 lineage 字段，而不是引入更重的数据库或 pipeline runtime。

## Consequences

### Positive

- 文档就能表达清晰边界，不必引入运行时复杂度。
- 未来如果加数据平台或研究栈，可以沿已有 contracts 平滑扩展。
- `decision-chain` 的持久化职责更稳定，避免 records 漂成万能目录。

### Negative

- 一些未来模块暂时只存在于文档里，短期看起来“不完整”。
- 需要在后续 run 中持续维护 architecture docs 与 record schema 的一致性。

## Revisit When

- market / news 数据被重复手工采集并且已经出现清晰 schema。
- 回测结果开始成为高频决策输入。
- 一个 skill 同时承担两个以上互不相关的变更原因。
- daily notes 与 trade cases 的 schema 已经明显分叉。
