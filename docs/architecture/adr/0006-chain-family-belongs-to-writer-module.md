# ADR 0006: Keep Chain Families Under Writer Modules Until Contracts Diverge

日期：2026-04-01

## Status

Accepted

## Context

当前仓库已经明确：

- `docs/architecture/modular-outline.md` 负责 canonical module map
- `docs/architecture/dependency-rules.md` 负责 coupling truth、writer ownership 与 promotion truth
- `decision-chain` 是唯一 active records writer

但还有一个容易诱发未来 churn 的隐性歧义没有被显式钉死：

- 仓库里已经同时存在 `records/daily/` 和 `records/trades/` 两条 append-only chains
- active writer module 的名字叫 `decision-chain`
- 如果不额外澄清，维护者很容易把“出现新 chain”误判成“应该立刻新增一个 peer writer module”

这个误判会把 storage truth 的数量，错误升级成 bounded context 的数量，最终导致：

- 为了路径对称而拆 writer modules
- 在还没有独立 schema owner / review cadence 之前提前 split
- 把 chain path、module boundary、skill boundary 三件事绑死在一起

外部参考给出的信号是一致的：

- LangChain 把可靠性的重点放在 context engineering，并显式区分 model context、tool context、life-cycle context；这说明不同持久化 surface 不应因为数量增加就自动变成新 agent/module。
- Dagster 把 asset definitions 与 materializations / observations 分开，说明“定义资产”与“记录资产实例事件”不是同一层对象。
- OpenLineage 把 Job / Dataset / Run 分开，说明 design-time owner 与 per-run event surface 需要分层。
- Qlib 把 Experiment 与 Recorder 分开，一个 experiment 可以拥有多个 recorder；run surface 数量不自动等于顶层边界数量。

## Considered Options

### Option A: 一条 chain 对应一个 writer module

- 优点：表面上最对称。
- 缺点：会过早放大模块数量；路径一变就想拆边界；非常容易制造 rename / move / split churn。

### Option B: 允许一个 writer module 拥有 chain family，直到合同真正分叉

- 优点：最符合当前仓库事实；让模块数量跟着 ownership 走，而不是跟着路径数量走。
- 缺点：需要额外写清“什么时候只是新增 chain，什么时候才是新增 writer module”。

### Option C: 把所有 records surface 合并成一条大链

- 优点：最少命名。
- 缺点：会把 daily 与 trade case 的使用方式、查询方式和未来 schema 演进揉成一团，损失清晰度。

## Decision

采用 Option B。

具体决策：

1. `module` 是边界 owner；`chain` 是 append-only storage truth surface。
2. chain 数量本身不驱动 module 数量。
3. 一个 writer module 可以拥有多条同族 chains，只要它们仍共享 schema owner、核心 invariants 与 review cadence。
4. 新增 chain 时，先判断能否继续挂在现有 writer module 下；只有现有 writer 已经过载或合同已分叉，才考虑新 writer module。
5. `decision-chain` 当前拥有一个 decision-record family：`records/daily/` 与 `records/trades/`。
6. 未来如果 `daily` 与 `trade-case` 同时出现独立 schema owner、独立 invariants 或独立 review cadence，再考虑把它们拆成 `daily-chain` 与 `trade-chain` writer modules。

## Consequences

### Positive

- 降低“因为链变多了就要拆模块”的误判。
- 让 promotion gate 更贴近 ownership、schema 与 cadence，而不是路径外观。
- 让 `trade-record-chain` skill 与 canonical docs 的 split logic 更稳定。

### Negative

- 维护者需要先区分“新增 chain”与“新增 writer module”，不能偷懒按命名对称决策。
- 某些 future module proposal 会因此被延后，需要更多证据才能 promotion。

## Revisit When

- `records/daily/` 与 `records/trades/` 分别出现独立 schema owner。
- 两条链的 invariants 或 review cadence 已经长期不同步。
- 某条 append-only chain 继续挂在现有 writer module 下，会明显引入循环依赖或 contract 漂移。
