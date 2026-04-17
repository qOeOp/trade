# plan schema v1

## 目标

这份文档把 [docs/plan-file-outline.md](/Users/vx/WebstormProjects/trade/docs/plan-file-outline.md) 继续收紧成可实现规范。

当前只固定三件事：

- `plan.v1` 的字段字典
- 关键 enum 集合
- `plan_key` 的 canonical hash 规则

对应的机器可读 schema 在 [docs/plan-v1-schema.json](/Users/vx/WebstormProjects/trade/docs/plan-v1-schema.json)。

## 核心约束

- `plan` 是不可变对象
- `plan_key` 来自内容 hash
- 旧 plan 不会被原地更新
- 新版 plan 通过 `lineage.prev_plan_key` 和 `lineage.supersedes_plan_keys` 表达继承与替代
- `plan chain` 不是单独实体，而是按 `root_plan_key / prev_plan_key / parent_plan_keys` 读取出来的视图

## 顶层对象

`plan.v1` 顶层必须包含 8 个对象：

- `identity`
- `lineage`
- `scope`
- `intent`
- `basis`
- `judgement`
- `actions`
- `state`

除 schema 明确允许的字段外，默认 `additionalProperties=false`。

## 字段字典

### 1. identity

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `plan_key` | 是 | string | `sha256:<64 hex>` |
| `schema_version` | 是 | string | 当前固定为 `plan.v1` |
| `hash_algo` | 是 | string | 当前固定为 `sha256` |
| `created_at` | 是 | string(date-time) | RFC 3339 时间 |
| `created_by` | 是 | enum | `agent / user / system` |
| `plan_kind` | 是 | enum | `analysis / execution / management / review` |

### 2. lineage

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `root_plan_key` | 是 | string | genesis plan 时等于当前 `plan_key` |
| `prev_plan_key` | 否 | string or null | 直接前驱 |
| `parent_plan_keys` | 是 | string[] | 父节点列表；线性改版时通常只有一个 |
| `lineage_type` | 是 | enum | `genesis / revise / fork / merge / replace / close` |
| `supersedes_plan_keys` | 是 | string[] | 当前版显式替代的 plan |
| `fork_group_key` | 否 | string or null | 并列候选 plan 的分叉组 |
| `branch_label` | 否 | string or null | 如 `base / aggressive / sleep / user-modified` |

约束：

- `lineage_type=genesis` 时：
  - `root_plan_key == identity.plan_key`
  - `prev_plan_key = null`
  - `parent_plan_keys = []`
- 非 genesis 时：
  - `root_plan_key != ""`
  - `parent_plan_keys.length >= 1`

### 3. scope

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `venue` | 是 | string | 例如 `binance` |
| `market_type` | 是 | enum | `spot / usdm / coinm / mixed` |
| `symbols` | 是 | string[] | 至少一个标的 |
| `account_scope` | 是 | enum | `global / symbol-only / position-only` |
| `position_scope` | 否 | object or null | 仓位或挂单绑定范围 |
| `mode` | 是 | enum | `flat / pending-entry / in-position / hedged / monitor-only` |
| `timeframe_scope` | 是 | string[] | 例如 `["4h","1h","15m"]` |

### 4. intent

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `user_goal` | 是 | string | 用户最真实目标 |
| `system_goal` | 是 | string | 系统收敛后的目标 |
| `constraints` | 是 | string[] | 用户或系统约束 |
| `risk_budget` | 否 | object or null | 风险预算 |
| `execution_preference` | 否 | object or null | 执行偏好 |
| `acceptance_mode` | 是 | enum | `full / partial / override` |

### 5. basis

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `as_of` | 是 | string(date-time) | 事实时间 |
| `observation_refs` | 是 | string[] | 观测引用 |
| `account_snapshot_refs` | 是 | string[] | 账户快照引用 |
| `execution_refs` | 是 | string[] | 执行事实引用 |
| `chat_history_refs` | 是 | string[] | 对话素材引用 |
| `data_quality` | 是 | object | 数据质量与降级信息 |
| `market_context` | 是 | object | 市场口径与关键位摘要 |

### 6. judgement

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `direction_bias` | 是 | enum | `long / short / neutral / mixed / unknown` |
| `opportunity_status` | 是 | enum | `valid / weak-valid / invalid / unclear` |
| `participation_status` | 是 | enum | `fit / wait / avoid / reduce / exit / hedge` |
| `current_action` | 是 | enum | `enter / wait / manage / reduce / exit / hedge / observe / abandon` |
| `thesis` | 是 | string | 最短核心判断 |
| `supporting_reasons` | 是 | string[] | 支持理由 |
| `counter_reasons` | 是 | string[] | 反方证据 |
| `key_risks` | 是 | string[] | 当前主要风险 |
| `invalidations` | 是 | object[] | 失效条件列表 |
| `validity_window` | 否 | object or null | 生效窗口 |

### 7. actions

`actions` 是数组，数组里每个元素都是 action block。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `block_key` | 是 | string | plan 内唯一 key |
| `block_type` | 是 | enum | `entry / exit / stop / protect / hedge / wait / watch / noop` |
| `variant_key` | 是 | string | 所属变体 |
| `symbol` | 是 | string | 标的 |
| `side` | 否 | enum or null | `buy / sell / long / short / reduce-long / reduce-short` |
| `trigger_kind` | 是 | enum | `immediate / limit / stop / conditional / manual-confirm / state-change` |
| `trigger` | 是 | object | 触发条件 |
| `price` | 是 | object | 价格或区间 |
| `quantity` | 是 | object | 数量、比例、预算、杠杆 |
| `protection` | 否 | object or null | 绑定保护 |
| `strength` | 是 | enum | `core / strong / normal / weak / optional` |
| `merge_policy` | 是 | enum | `must-keep / mergeable / skippable` |
| `notes` | 否 | string or null | 极短说明 |

约束：

- 同一 plan 内 `block_key` 必须唯一
- `actions` 保持有序；顺序即默认展示顺序和同层优先顺序
- `noop` block 允许 `side=null`

### 8. state

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `status` | 是 | enum | `noop / wait-condition / ready-execute / wait-until-fill / in-position / abandon / draft-closed / closed` |
| `state_reason` | 是 | string | 状态原因 |
| `next_checkpoints` | 是 | string[] | 下次回来先看什么 |
| `pending_questions` | 是 | string[] | 未闭合问题 |

## enum 清单

### `created_by`

- `agent`
- `user`
- `system`

### `plan_kind`

- `analysis`
- `execution`
- `management`
- `review`

### `lineage_type`

- `genesis`
- `revise`
- `fork`
- `merge`
- `replace`
- `close`

### `market_type`

- `spot`
- `usdm`
- `coinm`
- `mixed`

### `account_scope`

- `global`
- `symbol-only`
- `position-only`

### `mode`

- `flat`
- `pending-entry`
- `in-position`
- `hedged`
- `monitor-only`

### `acceptance_mode`

- `full`
- `partial`
- `override`

### `direction_bias`

- `long`
- `short`
- `neutral`
- `mixed`
- `unknown`

### `opportunity_status`

- `valid`
- `weak-valid`
- `invalid`
- `unclear`

### `participation_status`

- `fit`
- `wait`
- `avoid`
- `reduce`
- `exit`
- `hedge`

### `current_action`

- `enter`
- `wait`
- `manage`
- `reduce`
- `exit`
- `hedge`
- `observe`
- `abandon`

### `block_type`

- `entry`
- `exit`
- `stop`
- `protect`
- `hedge`
- `wait`
- `watch`
- `noop`

### `side`

- `buy`
- `sell`
- `long`
- `short`
- `reduce-long`
- `reduce-short`

### `trigger_kind`

- `immediate`
- `limit`
- `stop`
- `conditional`
- `manual-confirm`
- `state-change`

### `strength`

- `core`
- `strong`
- `normal`
- `weak`
- `optional`

### `merge_policy`

- `must-keep`
- `mergeable`
- `skippable`

### `status`

- `noop`
- `wait-condition`
- `ready-execute`
- `wait-until-fill`
- `in-position`
- `abandon`
- `draft-closed`
- `closed`

## canonical hash 规则

`plan_key` 的计算对象不是“原始输入”，而是“规范化后的完整 plan”，但必须排除 `identity.plan_key` 自己，否则会产生自引用循环。

### 参与 hash 的字段

参与：

- 整个 plan 对象

排除：

- `identity.plan_key`

当前阶段不额外排除其他字段。

这意味着：

- `created_at` 变化，会产生新的 `plan_key`
- `state.status` 变化，会产生新的 `plan_key`
- `actions` 任一 block 变化，会产生新的 `plan_key`

### 规范化步骤

1. 复制完整 plan 对象
2. 删除 `identity.plan_key`
3. 保留其余所有字段
4. 对所有 object 的 key 做递归字典序排序
5. 数字按 JSON 最简数值表示输出
6. 时间一律使用 RFC 3339 带时区偏移格式
7. 不补不存在的字段；缺失字段和显式 `null` 视为不同内容
8. 数组默认保持原顺序，不在 hash 时自动排序
9. 使用 UTF-8、无多余空白的 JSON 序列化
10. 取 `sha256(hex)`，最终拼成 `sha256:<hex>`

### 为什么数组不自动排序

因为 `actions`、`timeframe_scope`、`next_checkpoints` 这些数组都可能有顺序语义。

因此规则固定为：

- 由生产方先给出稳定顺序
- canonicalization 不再猜测哪些数组是集合、哪些数组是序列

## 存储建议

如果要落数据库，当前推荐一张 `plan` 表，加热字段上浮：

- `plan_key`
- `root_plan_key`
- `prev_plan_key`
- `schema_version`
- `created_at`
- `plan_kind`
- `lineage_type`
- `venue`
- `market_type`
- `mode`
- `direction_bias`
- `opportunity_status`
- `participation_status`
- `current_action`
- `status`
- `body_json`

其中 `body_json` 保存完整 plan 文档。

## 当前 schema 明确不做的事

- 不定义 execution row
- 不定义 observation row
- 不定义 chat-history row
- 不把 plan 再拆成外部 chain 对象
- 不把所有自由字段都提前拆平

## 下一步最合理的收紧方向

如果继续往下做，最值得优先固定的是：

1. `position_scope / risk_budget / execution_preference / data_quality / market_context / invalidations / validity_window` 这些开放 object 的子结构
2. `actions[].trigger / price / quantity / protection` 的子 schema
3. app 层约束：
   - `block_key` 唯一
   - genesis 规则
   - `root_plan_key` 一致性
   - `prev_plan_key` 与 `parent_plan_keys` 的一致性
