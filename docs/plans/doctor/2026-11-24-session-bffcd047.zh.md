# 2026-11-24 Gemini 研究会话 bffcd047

| Item | Value |
|---|---|
| Sessions | Antigravity（Gemini），`bffcd047-c5b4-4af3-bf14-7674a927e01a`，2026-11-23 08:46 至 16:36 UTC，及其 28 个评审子代理 |
| Audit session | Claude Code，claude-opus-5-5，`54fec2fd-a2af-4212-ba96-68b2facdd1af`，独立 worktree；本会话没有写过产品代码 |
| Checkout / ledger | `30ca08502`；研究线 `15m-vol-breakout`，账本头 `l2v43b5k5mle3n485vdo1hk4iduo7aih` |
| Coverage | Partial audit。Not exercised: value, flow/single, flow/pool, parity, research, consumers/ledger, consumers/report, consumers/cli, consumers/ide, gates/empty, gates/failed, gates/partial, faults/live, faults/docker, interrupt, cost/replay, cost/ledger, structure, size, pages/empty, pages/records, pages/offline, pages/reload, words, agents, unchanged, a rotating item。已演练：results（raw、fills、bh、cells）、cost（reports、import）、fixed（#3456 #3462 #3463 复测成立）。agents、research、gates 三个视角只用会话证据、探针和只读命令做过，未达到演练要求 |
| Cost | 会话 469 分钟：模型生成 81，评审子代理 92，闲置 80（其中 71 等用户），`line history` 55，`replay run` 48，宿主后台调度 31，其他前台工具约 23，报告与比较 21，`market coverage` 19，预检 18，其余约 3；token：输入 205 万（另有缓存读 1.24 亿），输出 52 万。无产品造成的无效试验。本次审计约 2 小时，子代理约 189 万 token，每个已确认发现约 27 万 |
| Net change | 提议合计：删 1 条拒绝及其强制行；skill 约加 40 词，`line close` 帮助改写并从 skill 移出对应条目；无新机制、无新字段 |

## Findings

`doctor.py report` 的末行：Shown: 10 of 10 probed. Of 0 datable ones, the last audit already had 0.（其中同一结论有两份探针；另有 3 份坏探针、1 份两边读数相同的探针，未计入；`wrongmissing` 探针有误，已剔除。）

复核：反驳代理判 16 条，确认 9 条、大部分或部分确认 5 条，按设计 2 条，确认里 5 条夸大已改正（C4 不是超线性、C5 的提速不来自裁列、C6 占 14% 不是三分之一、C9 部分不实、D1 中语言与强平距离不归因于压缩）。挑战的选择由一个代理测量，未再复核。

- [#3529](https://github.com/qOeOp/trade/issues/3529) restate
- [#3530](https://github.com/qOeOp/trade/issues/3530) restate
- [#3531](https://github.com/qOeOp/trade/issues/3531) remove、restate
- [#3532](https://github.com/qOeOp/trade/issues/3532) restate
- [#3533](https://github.com/qOeOp/trade/issues/3533) restate
- [#3534](https://github.com/qOeOp/trade/issues/3534) restate
- [#3535](https://github.com/qOeOp/trade/issues/3535) remove（authority）
- [#3458](https://github.com/qOeOp/trade/issues/3458) 补充测量

未开 issue：第 1074 步模型自己写出一段 `USER_INTERRUPT`（原始数据库只在模型输出里有，4 条用户输入都不是它），随后停下 Goal 循环；全部 156 份转录里只此一次，已有规则覆盖，不加机制。`change of approach` 的带连字符写法绕过近似拒绝（收紧拒绝需用户授权，只出现一次）。预测逐条报错、短前瞻段只给年化值：影响小。部分 veto 年不计回撤、`research state` 不提示换方向：按设计。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `RECOMMENDATION_INCOMPLETE` | 只挑赢家 | `--based-on` 的 commit 已固定候选集合 | 34 个名字与推导集合完全一致，正文仍与产品表在 11 个候选上不符 | 移除，等用户决定（#3535） |

## Decisions

- [#3535](https://github.com/qOeOp/trade/issues/3535)
- 挑战后保留：逐候选源码评审（全新代码里查出全部真缺陷，只改数值的 9 次评审占 31% 时间，没有安全的免评判据）；关线历史检验回放全部候选（三条线 66 个开发期未达标者无一被历史检验挽回，但平减夏普仍要全名单）。对照段占历史容器时间约 40%，从未失配，判断不出，不提议改。
