# Record Schema

更新时间：2026-04-01

这个文件定义 `records/` 的稳定接口。目标不是写成数据库规范，而是让 Codex 每次落盘都沿着同一条 append-only 审计链走。

## Design Rules

1. 只有用户明确要求 `记录 / 落盘 / 保存 / 归档 / 复盘` 时才写入。
2. `case_id` 与 `note_id` 一旦创建就不回改。
3. 事件文件只追加，不重写旧事件来伪造“最新真相”。
4. `events/` 是交易生命周期的权威真相；`meta.md` 只承载 case identity 与慢变化元数据。
5. `event_id` 必须四位数字、严格递增。
6. `source_refs` 必须指向上游事实来源，优先 repo path，其次外部链接加时间说明。
7. `derived_from` 只能引用更早的 event、daily note 或外部快照，不能前向引用。
8. `summary` 用一句话说明这条记录新增了什么事实或判断。

## Daily Note Schema

路径：

```text
records/daily/YYYY/YYYY-MM-DD.md
```

建议 frontmatter：

```yaml
---
schema_version: daily-note.v1
note_id: 2026-04-01-btc
date: 2026-04-01
recorded_at: 2026-04-01T09:00:00+08:00
timezone: Asia/Shanghai
focus: btc
source_refs: []
linked_case_ids: []
tags:
  - btc
  - daily
---
```

推荐正文块：

- `Snapshot`
- `Levels`
- `Plan`
- `Reflection`

## Trade Case Meta Schema

路径：

```text
records/trades/YYYY/YYYY-MM-DD-<slug>/meta.md
```

建议 frontmatter：

```yaml
---
schema_version: trade-case.v1
case_id: 2026-04-01-btc-breakout-long
symbol: BTC
created_at: 2026-04-01T09:30:00+08:00
timezone: Asia/Shanghai
timeframe: intraday
thesis_family: breakout
initial_bias: long
status: open
source_note_refs: []
tags:
  - btc
  - breakout
---
```

规则：

- `meta.md` 只放 case identity、timeframe、thesis family 等相对稳定的信息。
- 交易生命周期真相以 `events/` 为准；不要通过回改 `meta.md` 追记历史变化。
- `status` 是便捷快照字段，不是审计真相；如果与最新 event 短暂不一致，以最新 event 为准。
- `source_note_refs` 用来连接 daily note 或其他上游记录。

## Event Schema

路径：

```text
records/trades/YYYY/YYYY-MM-DD-<slug>/events/NNNN-<event-type>.md
```

建议 frontmatter：

```yaml
---
schema_version: trade-event.v1
case_id: 2026-04-01-btc-breakout-long
event_id: 0002
event_type: update
recorded_at: 2026-04-01T11:05:00+08:00
actor: codex
case_status_after: open
source_refs:
  - records/daily/2026/2026-04-01.md
derived_from:
  - 0001
summary: Narrowed long trigger after failed push
---
```

最小必填字段：

- `schema_version`
- `case_id`
- `event_id`
- `event_type`
- `recorded_at`
- `summary`

推荐字段：

- `actor`
- `case_status_after`
- `source_refs`
- `derived_from`

## Event Types

### `decision`

- 用途：初始 thesis、初始计划。
- 典型块：`Context`, `Levels`, `Risk`。

### `update`

- 用途：观点变化、计划调整、触发条件收窄或放宽。
- 典型块：`What Changed`, `Levels`, `Next Trigger`。

### `execution`

- 用途：真实成交、部分成交、减仓、加仓、取消挂单。
- 典型块：`Execution`, `State After`, `Notes`。

### `risk`

- 用途：只记录风险参数、暴露、无效条件或不交易原因的变化。
- 典型块：`Risk Change`, `Exposure`, `What Invalidates Action`。

### `close`

- 用途：平仓与结果归档。
- 典型块：`Result`, `Reflection`。

### `review`

- 用途：事后复盘、模式归因、流程修正。
- 典型块：`Outcome`, `Pattern`, `Next Time`。

## Lineage Conventions

- `source_refs` 优先引用：
  - repo 内 daily note 路径
  - 同 case 之前的 event id
  - 外部快照链接加说明
- `derived_from` 用于表达“这条记录是从哪些上游判断收敛出来的”。
- 如果某个 event 只是在执行层更新，但 thesis 没变，`derived_from` 仍建议回链到上一条活跃计划 event。

## Anti-Patterns

- 用修改 `0001-decision.md` 代替新增 `0002-update.md`
- 用回改 `meta.md` 的 `status` 代替新增 event
- 没有用户明确要求就写 records
- event 里没有任何来源引用，却给出具体点位和结论
- 把 market brief、scenario plan、execution、review 混成一条无法追责的大 event
