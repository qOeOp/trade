# plan outline

## 核心前提

- 每个 `plan` 是不可变对象；任何判断变化、参数变化、状态变化都生成新的 `plan`
- `plan_key` 来自内容的 canonical hash，不用外部自增 id
- `plan chain` 不是独立实体，而是通过 `root_plan_key / prev_plan_key / parent_plan_keys` 读出来的视图
- `plan` 才是一级实体

## 结构分层

一个 `plan` 分 8 层：

| 层 | 名称 | 回答什么 |
| --- | --- | --- |
| 1 | `identity` | 这是哪个 plan、谁生成的、什么类型 |
| 2 | `lineage` | 从哪来、替代了谁、是否分叉 |
| 3 | `scope` | 管哪个标的、哪类账户、当前仓位客观状态 |
| 4 | `intent` | 用户真实目标和约束 |
| 5 | `basis` | 依据了哪些事实、事实有多新 |
| 6 | `judgement` | 机会是否成立、是否适合参与、核心判断 |
| 7 | `actions` | 具体怎么做、每段有多核心 |
| 8 | `state` | 这版 plan 的生命周期位置、下次先看什么 |

## 1. identity

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `plan_key` | string | `sha256:<hex>` |
| `schema_version` | string | 固定 `plan.v1` |
| `created_at` | RFC 3339 | 生成时间 |
| `created_by` | enum | `agent / user / system` |
| `plan_kind` | enum | `analysis / execution / management / review` |

`plan_kind` 区分：
- `analysis`：只看盘，不挂单，产物是观测结论
- `execution`：有具体挂单动作
- `management`：持仓中的调整、保护、加减仓
- `review`：复盘和归因

## 2. lineage

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `root_plan_key` | string | 谱系起点；genesis 时等于 `plan_key` |
| `prev_plan_key` | string? | 直接前驱 |
| `parent_plan_keys` | string[] | 父节点；线性改版通常只有一个 |
| `lineage_type` | enum | `genesis / revise / fork / merge / replace / close` |
| `supersedes_plan_keys` | string[] | 这版显式替代的旧版 |
| `fork_group_key` | string? | 并列候选 plan 的分叉组 |
| `branch_label` | string? | 如 `base / aggressive / sleep` |

genesis 约束：`root_plan_key == plan_key`，`prev_plan_key = null`，`parent_plan_keys = []`

## 3. scope

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `venue` | string | 例如 `binance` |
| `market_type` | enum | `spot / usdm / coinm` |
| `symbols` | string[] | 涉及标的 |
| `position_scope` | object? | 绑定的仓位或挂单范围 |
| `mode` | enum | 账户层客观仓位状态：`flat / pending-entry / in-position / hedged` |
| `timeframe_scope` | string[] | 例如 `["4h","1h","15m"]` |

`mode` 表达账户层事实（空仓 / 有挂单 / 持仓 / 对冲中），不是 plan 的生命周期阶段；后者由 `state.status` 表达。

## 4. intent

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_goal` | string | 用户最真实目标 |
| `system_goal` | string | 系统收敛后的目标 |
| `constraints` | string[] | 用户或系统约束 |
| `risk_budget` | object? | 风险预算 |
| `execution_preference` | object? | 如 `sleep-order / no-chase / manual-confirm` |
| `acceptance_mode` | enum | `full / partial / override` |

## 5. basis

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `as_of` | RFC 3339 | 事实时间 |
| `observation_refs` | string[] | 观测结果引用 |
| `account_snapshot_refs` | string[] | 账户快照引用 |
| `execution_refs` | string[] | 执行事实引用 |
| `data_quality` | object | API 是否完整、是否有降级 |
| `market_context` | object | 市场口径、bias、关键位摘要 |

plan 不可变，所以依据也必须冻结在这里。`data_quality` 记录 API 是否完整返回、是否有截图回退，agent 读 plan 时知道依据是否有缺口。

## 6. judgement

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `direction_bias` | enum | `long / short / neutral / mixed` |
| `opportunity_status` | enum | `valid / weak-valid / invalid / unclear` |
| `participation_status` | enum | `fit / wait / avoid / reduce / exit / hedge` |
| `current_action` | enum | `enter / wait / manage / reduce / exit / hedge / observe / abandon` |
| `thesis` | string | 最短核心判断 |
| `supporting_reasons` | string[] | 支持理由 |
| `counter_reasons` | string[] | 反方证据 |
| `key_risks` | string[] | 当前主要风险 |
| `invalidations` | object[] | 失效条件列表 |
| `validity_window` | object? | 生效窗口 |

`opportunity_status` 回答机会本身成不成立；`participation_status` 回答现在适不适合参与。两层必须同时存在，不能用"不追"代替"方向没有"。

## 7. actions

`actions` 是有序数组，每个元素是一个 action block。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `block_key` | string | plan 内唯一 key |
| `block_type` | enum | `entry / exit / stop / protect / hedge / wait / watch / noop` |
| `variant_key` | string | 所属变体，如 `base / aggressive` |
| `symbol` | string | 标的 |
| `side` | enum? | `buy / sell / reduce-long / reduce-short` |
| `trigger_kind` | enum | `immediate / limit / stop / conditional / manual-confirm` |
| `trigger` | object | 触发条件 |
| `price` | object | 价格或区间 |
| `quantity` | object | 数量、比例、杠杆 |
| `protection` | object? | 附属保护单 |
| `strength` | enum | `core / strong / normal / weak / optional` |
| `merge_policy` | enum | `must-keep / mergeable / skippable` |
| `notes` | string? | 极短说明 |

`actions` 记录"这版 plan 建议做什么、每段有多核心、哪些可折叠"，不记录已成交多少——那是执行事实，在 `basis.execution_refs` 里引用。

## 8. state

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | enum | plan 生命周期位置（见下） |
| `state_reason` | string | 为什么落在这个状态 |
| `next_checkpoints` | string[] | 下次回来先看什么 |
| `pending_questions` | string[] | 还没闭合的问题 |

### status enum

| 值 | 大类 | 含义 |
| --- | --- | --- |
| `noop` | NOOP | 无操作，机会不成立或不参与 |
| `wait-condition` | 观望 | 有 setup，等市场条件达到；订单尚未挂出 |
| `ready-execute` | 观望→执行 | 条件已满足，等用户确认后执行 |
| `wait-until-fill` | 挂单 | 订单已挂出至交易所，等成交 |
| `in-position` | 监控 | 仓位存活，持续管理循环 |
| `abandon` | 终止 | 条件过期 / 机会消失 / 主动放弃 |
| `draft-closed` | 终止 | 计划成形但从未进入执行 |
| `closed` | 终止 | 仓位完全结束，进入 REVIEW |

`state.status` 和 `scope.mode` 不同：前者是 plan 生命周期语义，后者是账户层客观仓位事实。agent 读取时不能用其中一个推断另一个。

## plan_key 计算

1. 复制完整 plan，删除 `identity.plan_key`
2. 对所有 object key 做递归字典序排序
3. 数组保持原顺序（`actions` 有顺序语义）
4. 时间用 RFC 3339 带时区偏移
5. UTF-8 无空白 JSON 序列化
6. `sha256(hex)` → `sha256:<hex>`

## chain 如何从 plan 中读出来

- 沿 `prev_plan_key` 往前追 → 线性版本链
- 按 `root_plan_key` 聚合 → 同一根脉络的所有版本
- 按 `fork_group_key + branch_label` → 同一轮并列候选
- 按 `supersedes_plan_keys` → 哪些版本已被显式替代

## 数据库存储

一张 `plan` 表，热字段上浮成列，完整对象存 `body_json`：

```sql
create table plan (
  plan_key          text primary key,
  root_plan_key     text not null,
  prev_plan_key     text,
  created_at        timestamptz not null,
  plan_kind         text not null,
  lineage_type      text not null,
  venue             text not null,
  market_type       text not null,
  mode              text not null,
  direction_bias    text not null,
  opportunity_status text not null,
  participation_status text not null,
  current_action    text not null,
  status            text not null,
  body_json         jsonb not null
);
```

## 待详细设计

- `position_scope / risk_budget / execution_preference / data_quality / market_context / invalidations / validity_window` 的子结构
- `actions[].trigger / price / quantity / protection` 的子 schema
- app 层约束：`block_key` 唯一、genesis 规则、`root_plan_key` 一致性检查
