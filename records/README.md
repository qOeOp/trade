# Records

这个目录负责存放交易历史与决策链，不负责放临时聊天废话。

## 结构

### 交易案例

```text
records/trades/YYYY/YYYY-MM-DD-<slug>/
├── meta.md
└── events/
```

### 日常市场笔记

```text
records/daily/YYYY/YYYY-MM-DD.md
```

## 核心原则

1. 一笔交易一个 case 目录。
2. `meta.md` 只放相对稳定的信息，不承载生命周期真相。
3. 交易生命周期真相在 `events/`。
4. 新变化写新 event，不回改旧判断。
5. 事件编号严格递增。
6. lineage 字段按记录面区分：`daily note` 与 `trade event` 优先使用 `source_refs` / `derived_from`，`trade meta` 继续使用 `source_note_refs`。

## Authority

- [records/schema.md](/Users/vx/WebstormProjects/trade/records/schema.md) 是 records contract 的唯一 authority。
- `templates/` 是示例起点，不是新的 schema truth。
- 如果模板、skill reference 和 schema 冲突，以 schema 为准，并优先修摘要层。

## 什么时候写入

只在用户明确要求这些动作时写入：

- `记下来`
- `落盘`
- `保存`
- `存一下`
- `归档`
- `更新这笔`
- `复盘`
- `平仓并复盘`

## 推荐 slug

使用简短英文 slug，便于路径稳定：

- `btc-breakout-long`
- `btc-range-short`
- `btc-failed-reclaim`

## 推荐 event 类型

- `decision`
- `update`
- `execution`
- `risk`
- `close`
- `review`

## Schema

更稳定的 frontmatter 与 lineage 规则见：

- [records/schema.md](/Users/vx/WebstormProjects/trade/records/schema.md)

落盘时先判断当前写入的是哪一种记录面，再保证对应字段稳定：

- `daily note`：`note_id`、`schema_version`、`recorded_at`、`source_refs`
- `trade meta`：`case_id`、`schema_version`、`created_at`、`source_note_refs`
- `trade event`：`case_id`、`event_id`、`event_type`、`recorded_at`、`source_refs`、`derived_from`、`summary`
