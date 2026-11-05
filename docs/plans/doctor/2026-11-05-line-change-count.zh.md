# 2026-11-05 换线规则只说“`REVIEW_DUE` 数的次数”，agent 不读就当作 3

聚焦诊断。来自 20261105-48 第二阶段（[#2197](https://github.com/qOeOp/trade/pull/2197) 的 Evidence and limitations 第 1 条）：用例 `losses-keep-options-inside-line` 三版题面 skill 都加载了，最后一版仍是 sonnet 0/3、haiku 1/3，回答停下来列别的线和新起点。

| Item | Value |
|---|---|
| Sessions | 无被审研究会话。旧回答存于 #2197 会话 scratchpad 的 `pilot/{s1,s2,s3}/rejudged.json`；本次回答存于本会话 scratchpad 的 `m1/{r1,r2,r3,r4}/rejudged.json`（都是临时文件） |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `aecc9fd1-3054-4ad5-ad5f-c2357151866d`，worktree `fix-basket-note-ccbab0`；本会话写记录、改文字并开 PR |
| Checkout / ledger | `e9a587df9`。没有读写账本 |
| Coverage | `research-round/SKILL.md:108-118`、`research-start/SKILL.md:32-34,68,79-84`、`registration/register.py:46,580-582`、`report/status.py:615,654`、三版题面的 9 条有 skill 回答逐条读过。**缺口**：评测是离线的，没有测真实宿主上 agent 会不会真去读 `review_every`；研究会话的 transcript 没查；doctor 记录里按“提前换线”等词搜过，没有命中，这不等于没发生过 |
| Cost | 研究代价 unknown。产品造成的无效试验：0 个。本诊断评测 $24.82（126 条回答，agent $22.37，逐题重判 $2.45，list 价）|
| Net change | 机制、分支、存储字段、拒绝码都不变。skill 词数 26335 到 26337，净 +2 词（`research-round/SKILL.md` 1765 到 1767）。加 2 个用例。净增的 2 个词换来 agent 指得出去哪里读次数；更短的写法测过，效果差（见证据） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-56 | `research-round/SKILL.md:111` 用 “as many consecutive research runs as `REVIEW_DUE` counts” 定义换线次数，没有数字，也不说去哪里读。agent 不知道次数时不去读，而把手上的 3 当成到期：最新 3 个分不出差异就停止登记、列线。次数其实是 5（`REVIEW_EVERY`），由 `research state` 的 `review_every` 给出 | 见下节 | skill | unknown（评测里旧文字 6/6 判错；研究会话未查） | in PR |

### 三个怀疑，逐一判定

**规则 `research-start:83` 的措辞：不是。** 这句话本身被照做了。旧文字下没给次数的 15 条有 skill 回答（#2197 三版各 3 条、本次 6 条）里，12 条主动说亏损不会带出模板根，没有一条因为亏损把模板根列为选项。给出次数后，同一句话下回答都留在线内（下表）。

**`research-start` 的列线段在线内被加载时读偏：不是原因，是结果。** 旧文字、无次数时 `research-start` 加载 5/6；给了次数后 0/6（三组共 0/18，`research-round` 都是 6/6）。agent 是先在 `research-round` 认定到期，才按 `:115-116` 去读 `research-start`。所以 #2197 怀疑的 “`REVIEW_DUE` 被读成列线的停点” 确实出现在回答里，但错误发生在 `research-round:111`。第三版已经把 `REVIEW_DUE` 写成处理完了，仍有回答说 “连续次数到了 `REVIEW_DUE` 的阈值”。

**用例问得太开：只对第一版成立。** 第一版写 “新会话” 和 “给我选项吧”，`research-start:32-34` 正要求这时问继续还是换线，3 条回答都说换线没到期并推荐留在线内，这是对的，却被判败。判据 Q2 的 “new starting strategies” 也比 `:83` 宽：`:68` 要求没有候选能开线时设计新起点。第二、三版是真错，原因如下。

### 证据

**次数不在题面，skill 也不说去哪里读。** 代码是 `registration/register.py:46` 的 `REVIEW_EVERY = 5`，`report/status.py:615,654` 输出 `review_every`。`.agents/skills` 里之前没有这个字段名，`research-start:28` 列的要读的键也不含它。已合入的三个 `line-change-*` 用例题面都写了 “`REVIEW_DUE` 的固定次数是 5”，只有这个用例没写。#2197 的 9 条回答没有一条说出 5，有一条写 “推断是 8 次”。第二、三版 6 条都停止登记，理由是最新 3 个分不出差异或 `REVIEW_DUE` 出现。

**对照一：恢复的用例（只测次数给不给、文字改不改）。** 每臂 6 次，全部有 skill 的臂 `skill-fired` 6/6。判官 sonnet / haiku，数字是通过数：

| 题面 | skill | 第一轮判据（3 问） | 最终判据（4 问） |
|---|---|---|---|
| 无次数 | 旧文字 | 0, 0 | 未跑 |
| 无次数 | 短写法 | 未跑 | 0, 0 |
| 无次数 | 新文字 | 0, 1 | 不适用，见对照二 |
| `review_every` 为 5 | 旧文字 | 6, 6 | 6, 5 |
| “固定次数是 5” | 旧文字 | 6, 6 | 未跑 |
| `review_every` 为 5 | 短写法 | 未跑 | 5, 6 |
| `review_every` 为 5 | 新文字 | 6, 6 | 6, 6 |
| `review_every` 为 5 | 空 `skills/` | 4, 2 | 0, 0 |

结论：拿到次数，旧文字也几乎全过，规则本身没问题；这个用例只区分有无 skill，区分不出新旧文字。

**对照二：新用例 `line-change-reads-review-every`（题面不给次数，判 agent 是否先读再决定）。** 每臂 6 次：

| skill | sonnet | haiku | runner 投票（/18） | 回答提到 `review_every` |
|---|---|---|---|---|
| 新文字 “the last `review_every` (`research state`) research runs in a row” | 6 | 6 | 18 | 6 |
| 短写法 “`review_every` (`research state`) consecutive research runs” | 2 | 2 | 6 | 5 |
| 旧文字 | 0 | 0 | 0 | 0 |
| 空 `skills/` | 0 | 0 | 0 | 0 |

新文字下回答都先读 `review_every`，再分 “到了” 和 “没到” 两支；有的回答猜 “大概率已到”，但决定仍看读数，所以真实宿主上会读到 5。短写法下有 3 条回答提到字段名，仍直接判到期。为什么多这几个词差这么多，没有查，只是测到的。

**没有改坏相邻用例。** 新文字与旧文字各 3 次：`line-change-counts-undistinguished-runs` 3, 3 与 3, 3；`line-change-due-while-recommendation-moved` 3, 3 与 3, 3；`line-change-offer-from-ledger` 2, 2 与 2, 2；`review-is-not-stop` 2, 2 与 2, 2。新文字下的失败都不是换线次数：`offer` 失败在 Q3（选项的读数来源），`review-is-not-stop` 失败在 “离线跑不了复盘” 和判官分歧。

### 用例的改动，选后的都写明

- **恢复的用例改名 `losing-line-not-due-keeps-iterating`，从 `research-start` 挪到 `research-round`。** 给了次数后只加载 `research-round`，`:108-111` 才是决定性的规则。题面只比第三版多一行 `research state` 读数。
- **判据是看过回答后改的。** Q1、Q2 按 “是否判到期” 和 “下一步是否线内实验” 重写。Q4（当最后一次尝试、失败就关线）是看到空 `skills/` 第一轮过了 4, 2 才加的：这些回答都是 “最后跑一批，不过就关线”，违反 `research-round:110` 和 `research-start:46-49`。最终判据的数字都是新跑的回答，不是重判。

### 限制

- 每臂 6 次、每条回答每个判官一票，旧笔记说 12 次以下的差距有时是噪声。0/6 对 6/6 的结论不靠这一点；短写法和新文字之间的差距要谨慎读。
- 没有测研究会话。真实宿主上 `REVIEW_DUE` 的拒绝信息本身带次数（`register.py:581-582`），`2026-11-01` 审计记录过一次在连续五次时正确换线，所以实际发生率可能低于评测。

## 补救

选 `skill`。`none` 不合适：旧文字 0/6 会去读次数。删除不合适：规则本身要留。这里是重述规则：把代号换成能读到的字段，含义不变（次数仍是 5，判定仍是三个区间），不动拒绝和检查，不动 `research-start:83`，不改两个目标。`docs/rd/feedback.zh.mdx:271` 和 `design-skill-research-round.zh.mdx:43` 说次数与 `REVIEW_DUE` 的固定次数相同，仍然正确，不改。

## Removal list

无。

## Decisions

无 authority 项。
