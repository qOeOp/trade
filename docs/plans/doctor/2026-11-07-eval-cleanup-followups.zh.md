# 2026-11-07 评测清理收尾

证据标记：**子** = 这批子代理的报告或结果笔记读出，主线程没有逐项复核；**测** = 实际跑出的读数；**读** = 写本记录时读过所引的行或 PR 正文，没有跑运行。

| Item | Value |
|---|---|
| Sessions | 无研究会话。来源是这批评测清理子代理的报告、结果笔记（`eval-red-nonseparating-results.md`、`eval-48-{doctor,nautilus,sources,video}-results.md`，主会话的本机笔记，不进仓库）和已合并 PR 的正文 |
| Audit session | Claude Code 桌面版，claude-opus-5-5，子代理，会话 95363383-a5d1-49a8-a27e-33f6c6c25214，worktree `agent-a9ab16578077f45cb`；本会话写的 PR：[#2396](https://github.com/qOeOp/trade/pull/2396) 和带本记录的 PR |
| Checkout / ledger | `5f870e3d1`；账本未读未写 |
| Coverage | 收尾 20261105-39、-41、-47、-48，记下这批的新发现。缺口：没有逐个重跑用例；A 组修复没在合并后的 main 上重测（`e072b6b6f` 上测的）；#2371–#2373 没跑无 skill 组；所有读数每组 3 次、每判官一票 |
| Cost | 这批写用例和修红用例 list 价共 $176.60，明细见下表；时间拆分和各会话自身 token 没量（unknown）；本记录自身 unknown，另有 5 次 haiku 探测，金额没量 |
| Net change | 拒绝码 254（上份 254，`CATALOGUE` 键）；skill 词数 25,241（上份 26,365，同口径 `find .agents/skills -name '*.md' \| xargs cat \| wc -w`）。本记录的 PR：skill 0 词，拒绝码 0，机制 0，存储字段 0。#2396：`AGENTS.md` +30 词 |

## 这批的结果

`KEEP-ADD-CASE` 写用例的总产出：写 98，留 72（子；留下的数和各 PR 标题一致，读）。-48 原估 102 个，差 4 没有逐条对齐；#2386、#2392、#2394 的正文各记了因已覆盖或已放弃而没写的。放弃的用例和原因见各 PR。

| PR | 范围 | 写 | 留 | list 价 |
|---|---|---|---|---|
| [#2196](https://github.com/qOeOp/trade/pull/2196) | 高风险规则试点 | 16 | 11 | $21.62 |
| [#2197](https://github.com/qOeOp/trade/pull/2197) | research-round、research-start | 29 | 19 | $39.76 |
| [#2387](https://github.com/qOeOp/trade/pull/2387) | nautilus-report-analysis | 10 | 6 | $13.42（含 #2388、#2390 的复测） |
| [#2392](https://github.com/qOeOp/trade/pull/2392) | product-doctor | 13 | 10 | $18.34 |
| [#2386](https://github.com/qOeOp/trade/pull/2386) | research-sources | 7 | 4 | $14.71（含 #2391） |
| [#2394](https://github.com/qOeOp/trade/pull/2394) | video-evidence | 23 | 22（11 个区分偏弱） | $35.66 |
| [#2371](https://github.com/qOeOp/trade/pull/2371) [#2372](https://github.com/qOeOp/trade/pull/2372) [#2373](https://github.com/qOeOp/trade/pull/2373) [#2374](https://github.com/qOeOp/trade/pull/2374) [#2375](https://github.com/qOeOp/trade/pull/2375) [#2376](https://github.com/qOeOp/trade/pull/2376) | 有 skill 也败、无 skill 也过的用例 | | | $33.09 |

- A 组留红只剩 `gross-negative-updates-priority`：#2371、#2372、#2373 修好 3 个，#2376 只改题面（子）。
- `research-start/references/recommendation.md:13-15`、`research-round/references/duty-directory.md:4` 单独复跑后保留（子）。

状态变更（索引只写状态词）：

| id | 状态 | 依据 |
|---|---|---|
| 20261105-39 | `fixed b8f462fda` [#2254](https://github.com/qOeOp/trade/pull/2254) | 有无 skill 对照基线已做（子）。`fixed` 只表示已合并 |
| 20261105-41 | `in PR` [#2396](https://github.com/qOeOp/trade/pull/2396) | 判官在外部工具里换不了，改为在 `AGENTS.md` 写明。命令形式和 #2197 正文不完全一致：#2197 没有 `--setting-sources ''`，#2375、#2385 与写入的形式相同。测：放一个说只答 `BANANA` 的 `AGENTS.md`，问 2+2，不带这个参数答 `BANANA`，带了答 `4`；提示词作为 `--tools ''` 之后的参数会报错，要走 stdin |
| 20261105-47、20261105-48 | `fixed 15c4d292a` [#2394](https://github.com/qOeOp/trade/pull/2394) | 上表最后一个 PR。两行原状态都是 `open`（读）。还没有用例的规则记在 20261107-147 |
| 20261107-44 | 不动 | 已是 `fixed 1622cff47` [#2377](https://github.com/qOeOp/trade/pull/2377)，和 `gh` 读出的合并提交一致（读） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261107-139 | `video-evidence/references/custody.md:25-26` 只给符号链接检查，没说检查失败后怎么办 | 子：6 个有 skill 回答 4 个直接用链接目标、2 个问用户；判据两种都收。读：行内容属实 | authority（检查行为，用户定） | unknown | open |
| 20261107-140 | `video-evidence/references/transcribe.md:21-22` 要求窗口不一致时停下问，但答案没有去处 | 读：`DETECTED` 那行窗口不一致时报错（`:34`），复核又重跑同一块（`:81-84`）。子：3 个回答 3 种接法（标明偏离配方、设 `DETECTED=en`、说要先改规则） | authority（用户定） | unknown | open |
| 20261107-141 | `video-evidence/references/acquire.md:37` 没说清循环探测一份清单算不算“重复调用” | 子：`no-scripted-search` 第二版题面 2/3 有 skill 回答引用禁令后仍写带 `sleep` 的 `yt-dlp -J` 循环，同题面首轮 0/3；留下的用例只问翻搜索页，不覆盖这点 | skill + 评测 | unknown | open |
| 20261107-142 | `product-doctor/user-first-miss` 的 Q1、Q2 要的结论可能和 `research-start/SKILL.md:92-97` 不一致 | 读：Q1、Q2 把“选项没带目标”判为问错；`SKILL.md:92-97` 是用户选线之后才查目标，两处都没有时才要，先选线再要目标也合规。没有跑过对照 | authority（用户定问题本身该问什么） | unknown | open |
| 20261107-143 | Live `prepare` 有两项是条件比较：`runtime` 只有带 digest 才比较，源码只有传了 `strategy_file` 才比较；重复 prepare 同一个 run-id 不报 `LIVE_RUN_CONFLICT`，返回原 manifest | 子：#2365 正文，测试没有钉住。读：`live/runs.py:412-416` | authority（涉及真实资金的检查，改动要用户授权） | unknown | open |
| 20261107-144 | 更正：[无用例规则](2026-11-05-rules-without-cases.zh.md)（`SKILL.md:54-56` 那行）说 `order_funnel@1` 不分子单，实际排除了子单和 reduce-only | 子，读：`ledger/metrics.py:822` 的 `entries` 去掉有 `parent_order_id` 和 `is_reduce_only` 的订单，`:839` 只数 `entries`。没跑运行。据那行写的 `cancels-are-contingent-children` 已在 #2387 放弃，没有用例依赖这句话 | measure（跑一次运行核对漏斗） | unknown | open |
| 20261107-145 | 评测里 17/105 个无 skill 回答说文件搜索被拒，题面允许 Glob、Grep | 子：video-evidence 这批，原因没查，其他批次的笔记没提这一点 | measure（查原因，无 skill 组的读数可能受影响） | unknown | open |
| 20261107-146 | `gross-negative-updates-priority` 的 Q4 真违规留红：priority 判断不写各动作的依据 | 子：`feedback.md` +7 词试改，原题面 1,2/6，改题面后 4,3/6（haiku 未过线），相邻用例变差（`priority-cites-report-signals` 3,3/3 → 2,1/3，`capital-allocation-ranked-by-target-gap` 3,3/3 → 3,2/3），已还原；只改题面 0,0/3 | skill + 评测（下次试改同时看相邻用例） | unknown | open |
| 20261107-147 | 这些规则现在没有用例：提议新起点要写合约范围（#2375 删）；video 探测顺序（#2385 删）；`product-doctor/SKILL.md:82` 使用方那一半；#2392 放弃的 3 条（`subagent-finding-rechecked`、`unresolved-stays-focused`、`repair-at-every-consumer`）。另外 `coinalyze-binance-liquidations` 的 7 天窗口要随实测更新 | 读：#2375、#2385、#2392、#2391 正文，`SKILL.md:82`。子：#2392 终版不再测 `:82` 那一半。测：`data.md` 的 `1min` 清算历史 5 天内从 2–3 周变成 9.5 天，再落到 7 天以下 Q1 就错 | 评测（补用例或确认不补；窗口随实测改） | unknown | open |

## Removal list

无。

## Decisions

- 2026-11-07，用户：“全定一下，一次性做完”（主会话转述）。授权这批收尾开 PR，不含合并。
