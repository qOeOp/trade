---
name: trade-record-chain
description: Persist BTC trade ideas, updates, executions, closes, and reviews into this repository as an append-only event chain. Use when the user asks to record, save, log, archive, update, close, or review a trade decision inside the repo.
---

# Trade Record Chain

## Boundary

- `mission`: 把用户明确要求保存的交易相关信息写成 append-only 决策链。
- `owned_artifacts`: `records/`、`records/schema.md`、`records/README.md`、`templates/`、`skills/trade-record-chain/`。
- `upstream_inputs`: 用户显式持久化意图、daily note、market brief、scenario、执行事实。
- `downstream_outputs`: `records/daily/` 与 `records/trades/` 下的稳定 markdown 记录。
- `invariants`: 不偷偷写入；不回改旧事件；事件编号单调递增；`derived_from` 只能指向过去；`events/` 是 trade lifecycle truth；`meta.md` 只承载 case identity 与慢变化元数据。
- `allowed_dependencies`: `operator-surface`、`risk-guard`、`research-synthesis`、`scenario-planning` 只读。
- `forbidden_dependencies`: 实时市场真伪验证、回测、执行自动化、替上游模块改写历史判断。
- `non_goals`: 不是数据库替代品，不是研究计算层，不是市场判断模块。
- `change_triggers`: record schema 演进；需要更强 lineage；daily note 与 trade case 出现不同 owner。
- `future_split_points`: 当 `daily` 与 `trade-case` 同时出现独立 schema owner、独立 invariants 或独立 review cadence，且继续共挂在同一 writer 下会造成耦合时，才可拆成 `daily-chain` 与 `trade-chain` writer modules。

## Contract Authority

- module ownership 与 chain ownership 以 [docs/architecture/modular-outline.md](/Users/vx/WebstormProjects/trade/docs/architecture/modular-outline.md) 和 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。
- record schema 与 lineage rules 以 [records/schema.md](/Users/vx/WebstormProjects/trade/records/schema.md) 为准。
- [references/path-and-schema.md](references/path-and-schema.md) 只做便于落盘的摘要，不创建新的必填字段。

## Workflow

1. Determine whether the user wants to create a new trade case, append to an existing case, or write a daily market note.
2. For a new case, create `records/trades/YYYY/YYYY-MM-DD-<slug>/`.
3. Create `meta.md` once for case identity and slow metadata. Do not use it to replace event history.
4. Append each new state change as `events/NNNN-<event-type>.md`.
5. If the thesis changes, add a new event. Do not rewrite older events.

## Event Types

- `decision`
- `update`
- `execution`
- `risk`
- `close`
- `review`

## Writing Rules

- Paths and filenames use ASCII, lowercase, and hyphens.
- File body can stay in Chinese.
- Use Asia/Shanghai timestamps unless the user specifies otherwise.
- Preserve chronology and causal chain.
- Quote concrete numbers when available: entry, stop, targets, pnl, invalidation.

## Do Not Do This

- Do not silently overwrite the initial thesis.
- Do not merge multiple major decisions into one event if chronology matters.
- Do not create records unless the user explicitly asks to save or log the decision.

## Reference

Read [references/path-and-schema.md](references/path-and-schema.md) before creating or updating records.
