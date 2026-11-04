# 同一市场提交和窗口上并行多条研究路线

2026-11-05，用户授权移除 `LINE_DATA_TAKEN`，并要求先做字段评审（原话：「授权，先做字段评审」）。本文记录评审和决定，代码尚未改动。问题的证据见诊断记录 [2026-11-05-same-key-research-lines.zh.md](doctor/2026-11-05-same-key-research-lines.zh.md)（发现 20261105-01）。

本文取代 [parallel-research-lines.zh.md](parallel-research-lines.zh.md) 第 3 节的方案 (a)。那一节写明：用户真要在同一市场提交和窗口上并行时，再评审方案 (b)。

## 字段评审

评审由一个独立子代理完成，只读代码和账本，没有拿到诊断结论。主会话复核了下面标明的几项；其余数字是子代理在账本提交 `smuqhash9d…` 上的实测。两边都没有运行过同键路线的场景。

### 消费者

- 直接读路线归属的：`bind`、`_retried`（经 `registration_line`）；`line_trials`。
- 经 `line_trials` 间接读的：`require_line_records`、`REVIEW_DUE`、`line_identity`（进而 `comparison_table`）、`research state`、研究图。
- `replay/`、`paper/`、`line_targets` 和 `judgments` 不读归属。IDE 经 CLI 读，不自己判断。

### 独立的事实

两条路线同键时，归属不能由已存内容推出：

- `--line` 只用来选路线，随后被丢弃。`research-plan.json` 里没有随路线变化的字节，所以哈希、op_id 和提交信息都分不开两条路线。
- `candidate` 不含路线；`judgment.line_bundle` 写在事后，而 `bind` 需要先知道归属。

### 被否决的做法：沿策略血缘推归属

血缘推导与现行归属在 179 个登记中有 33 个不一致，全部在 channel-breakout 路线上（子代理实测）。原因是线内允许登记新根：`channel-breakout-15m@3` 是没有 parent 的根（主会话已查 `candidate` 表确认），它登记在起点为 `@2` 的路线上，其后代走不到起点。这条路径是 `register.py` 的拒绝信息明确给出的。要用血缘就得新增拒绝并禁掉这条路径，字段更简单。

### 字段放在哪里

放在 `research-plan.json` 顶层，与 `body`、`execution`、`runtime_ref` 并列，不放进 `body`（这几条主会话已读代码确认）：

- `_validate` 按 `additionalProperties: false` 重查存储的 body，只剔除 `change`。放进 body，每次 `bind` 都要额外放行。
- `_runtime_transition` 比较两份 body 时只排除 `retry_of`、`prechecks`、`control_trial_id`。旧 body 没有这个键，放进 body 且不改这里，旧登记的重建重试就不再算转换，等于悄悄收紧检查。
- `load_plan` 只查 `format`、`body`、`execution`，顶层多一个键不受影响。已查样本的顶层键是这四个。
- `format` 不升级，否则 `load_plan` 会拒绝旧登记。

## 决定

| 项 | 决定 | 依据 |
|---|---|---|
| 存储字段 | 顶层加 `line`，由 `register` 从所选路线写入，调用方不写 | 通过字段评审 |
| `LINE_DATA_TAKEN` | 整个删除 | 用户已授权移除 |
| 旧登记 | 没有 `line` 的继续用现行推导，不改写账本 | 用户 11-05 决定不改写账本；这些登记写入时不存在同键并开的路线，现行规则对它们成立 |
| `comparison_table.candidates` | 收窄到本路线的试验在该身份下的候选，加路线起点 | 用户 11-05 授权（原话：「收窄」） |

评审曾建议保留一个窄版拒绝（同键且同起点）。这里不采纳：同起点两次相同选择的重放判断仍在；并发下多出来的重复路线可以 `line close`；同一起点分两个方向研究本身合理，起点源码已由 `SOURCE_ALREADY_EXPOSED` 看守。

### `candidates` 为什么收窄

`candidates` 原先只按执行身份筛选，而身份由镜像、有效配置和输入内容决定，不含策略。同币种同配置的两条路线因此可能身份相同，一条路线的推荐就必须点名另一条路线的全部候选（`RECOMMENDATION_INCOMPLETE`），首次推荐还要逐个权衡（`research-round/references/review.md`）。这不会卡死，但一条路线的会话要去评价它没有上下文的候选。两条线的身份是否真的相同，尚未验证。

收窄不削弱这项检查的原意：线内的候选仍必须全部点名，不能只挑赢家；`runs` 继续列出其他路线的运行；多重检验的计数本来就跨路线（`report/status.py:301`）。

收窄同时影响先后关系：同键的已关闭前任路线上的候选，除非是本路线起点，也不再必须点名，仍可在 `runs` 里看到。

收窄只管点名，不管比较。2026-11-05 用户决定别的路线的候选仍要比较（原话：「Yes, keep comparing」）：同身份、有经济证据的候选不管哪条路线跑的，推荐时都要比较，只是不必挂为主体。

## 实现

1. `register`：写 `"line": held["bundle"]` 到计划顶层。同一内容重写的幂等不变；同名登记换路线写，会拒绝 `DUPLICATE_BUNDLE`。
2. `bind`、`_retried`：取计划的 `line`，没有时走 `registration_line`。
3. `line_trials`：只在多条路线持有同一键时读试验所属登记的 `line`，否则走现行推导。`ledger` 不能依赖 `registration`。
4. 删除 `select_line` 的检查、`LINE_DATA_TAKEN` 目录项、CLI 帮助中的说明和 `tests/ledger/test_lines.py` 的对应断言。
5. `comparison_table`：`candidates` 只取本路线试验（`line_trials`）在该身份下的候选，加路线起点；`runs` 不变。
6. 同步文字：`lines.py` 模块和函数说明、`register.py` 的 `market_commit` 比较注释（检查本身保留）、`RECOMMENDATION_INCOMPLETE` 的目录文字和 CLI 帮助、`research-start/SKILL.md`、`research-round/references/changes.md`、`research-round/references/review.md`、`design-code-ledger`、`design-code-cli`、`entry` 文档（中英文）。skill 中「并行路线从不同源码起步」保留。
7. 测试：两条同键路线交替登记，`line_trials` 和 `bind` 各归各的；路线关闭后 `bind` 得 `LINE_ENDED`；没有 `line` 的旧计划仍按推导归属；身份相同的另一条路线的候选不进 `candidates`、仍在 `runs` 里。

## 上线顺序

没有 `line` 的登记会走现行推导，所以旧代码在同键路线上写登记会归错（推断，未实测）。第一条同键路线开出来之前：

- 所有写账本的会话先换到含此改动的 checkout，包括受阻的 3 个会话，它们的工作树停在 c0e0c01ba。
- IDE 镜像也要更新，否则研究图按旧规则显示。重建前先问用户。

## 净变化

- 拒绝码减 1；`RECOMMENDATION_INCOMPLETE` 的范围收窄到本路线。
- 存储内容加 1 个可选顶层键，不改表，不升 format。
- 分支加 1 处（有 `line` 读 `line`，否则推导），因账本不改写而长期保留。
- skill 文字约减 40 词（估算），实际词数由实现 PR 报告。
