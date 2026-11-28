# 2026-11-28 瘦身主题审计（engine）

| Item | Value |
|---|---|
| Sessions | 没有指定的研究会话，这是一次整体主题审计。<br>**信号：**<br>• `doctor.py scan`：14 天内 `engine` 有 124 次提交，其中 81 次是修复，远多于其他产品对象（其次是 `ide/web/src` 54 次、`ide/web/scripts` 51 次、`deploy` 42 次）。`tests/engine` 有 14,658 行，多于 `engine` 的 13,165 行；14 天新增 6,070 行，也多于 `engine` 的 5,077 行。各视角上次运行都是 2026-11-25。<br>• 未结的 `agent-finding` issue 有 27 条。<br>• 最近两次审计 `2026-11-28-stop-harm.zh.md` 和 `2026-11-26-stop-harm.zh.md` 都取了 harm。<br>**为什么不取 harm：** #3793 是上次 harm 审计在 `da935310a` 上复验的，之后只有文档提交，代码没变。其余可能造成损失的 issue 要么只差授权，要么已被认领（#3658）。<br>**所以取第 2 主题 Slim：** `engine` 被一次又一次地修，测试也超过了代码本身。<br>**没做的：** Friction 和 Find 两个主题；其余对象；Shape 组里结构、体积、价值、治理之外的视角。 |
| Audit session | Claude Code，claude-opus-5-5，`03dbcb7e-ce56-4a2b-b0e1-44cadab69ea8`。产品树是 `origin/main` 的 detached worktree。本会话只写了本记录的 PR。 |
| Checkout / ledger | `6bb7ee8bf`。没有碰活动账本和活动市场目录。删除、合并和变异都在 `git archive` 出的临时副本上运行，没有建临时账本。 |
| Coverage | **报告标题：** `# Partial themed audit: slim`。<br>**范围：** 视角 structure、size、value、governance、checks；对象 engine、tests/engine。<br>**Not exercised：** nothing listed。<br>**Not examined（覆盖不全）：**<br>• Paper 的 `TERMS_CHANGED`/`PAPER_INSTRUMENT` 实际触发多少次：计数在远程主机的 paper 库里，够不到。<br>• tests/engine 只试了 12 个手选的变异体，加上反驳者的 10 个，没有系统地做变异。<br>• 没有按单条测试统计行数。<br>• `live_connection.py`、`live_commands.py` 只读了调用点。<br>• 成对原生回放都没有运行（需要构建镜像）。<br>• 一条 unexamined 行写着 loopback `test_host_faults` 没读到结果，这行已经过时：它后来在临时副本上跑完并通过。<br>**覆盖表：**<br>• structure/engine：examined，但表里显示 failed。这一行是合并原型第一次运行时的引号错误，0.07 秒就退出了；之后的 `runtests.sh` 那次全部通过。<br>• size/engine：examined。<br>• value/engine：examined。<br>• governance/engine：examined。<br>• checks/tests/engine：examined。<br>• size/tests/engine：skipped tests（3 条 Redis 测试在本机跳过）。<br>**不在任何审计范围内：** 真实账户上的实盘交易，以及对发布主机的变更。 |
| Cost | 证据时间 2026-11-28T05:25:44Z 至 06:02:18Z，整场约 45 分钟（预算 90 分钟）。<br>8 个子代理共约 74 万 token（每个 6.5 万到 12 万），主会话的 token 宿主没有显示（unknown）。<br>产品造成的无效试验 0 次。 |
| Net change | 本次不新增机制、规则、存储字段或技能文字。<br>提出的两项删除都在临时副本上跑过：<br>• Paper 和 Live 的等待入场合并：拦截方法从 10 个减到 5 个，代码 +100/−89，行数不减，好处是每个修复只落一次。<br>• Live 两段最终读并成一段：净 −3 行，尾部分支从 3 个减到 2 个，去掉一次没有读者的写入，删掉一条只断言这个字段的测试断言。 |

## Findings

| Finding | Verdict | Observed | Expected | Control | At the last audit | Refuter's probe |
|---|---|---|---|---|---|---|
| challenge-order-rules-bypass-runtime | shown | ([], [('MARKET', 'FILLED')]) | (['ORDER_RULE'], []) | (['ORDER_RULE'], []) | - | shown |
| challenge-order-rules-bypass-load | shown | False | True | True | - | shown |
| challenge-native-risk-holds-past-bypass | absent | [('MARKET', 'DENIED')] | [('MARKET', 'DENIED')] | [('MARKET', 'FILLED')] | - | none |
| engine-waiting-entry-twice | shown | ['live_source.py:_LiveConfigured', 'paper_terms.py:Waiting'] | ['live_source.py:_LiveConfigured'] | [] | - | shown |
| slim-engine-tests-drift | shown | True | False | False | - | absent |
| live-final-read-twice | shown | {'read_and_require_flat_blocks': 2, 'dead_venue_flat_writes': 1} | {'read_and_require_flat_blocks': 1, 'dead_venue_flat_writes': 0} | {'read_and_require_flat_blocks': 1, 'dead_venue_flat_writes': 0} | - | shown |
| live-give-back-three-sites | shown | {'give_back_decision_sites': 3} | {'give_back_decision_sites': 1} | {'give_back_decision_sites': 1} | - | shown |

Shown: 6 of 7 probed. Of 0 datable ones, the last audit already had 0. Shown by a refuter's own probe too: 5.

独立反驳共审了 7 条主张（有一条删除主张没有 probe，也一并送审）。结果如下：
- 确认 2 条：等待入场机制写了两份；Live 的最终读写了两段。
- 重复 2 条：两条绕过规则的主张都是 #3793 的重复，只在那个 issue 补评论。
- 推翻 3 条：
  - 删除 Paper 的条款等待队列：按设计保留（C-172）。
  - `slim-engine-tests-drift`：不成立。反驳者找到 3 个只有这条测试能抓到的变异体。
  - Live 的三处交还：按设计保留，三处是三个阶段、各有用户决定。
- 未决 0 条。

`tests/engine` 没有找到值得删的测试，这本身就是结果。

- [#3812](https://github.com/qOeOp/trade/issues/3812) — `remove`
- [#3793](https://github.com/qOeOp/trade/issues/3793) — `fix`（只补评论）

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 见 [#3812](https://github.com/qOeOp/trade/issues/3812) | 见 issue | 见 issue | 见 issue | 见 issue |

## Decisions

- [#3812](https://github.com/qOeOp/trade/issues/3812)
