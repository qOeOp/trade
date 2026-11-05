# 2026-11-05 capital.md 把成交量占比写成“market fill”

聚焦诊断。来自 20261105-48 的试点：用例 `participation-not-read-as-low-impact` 有 skill 也不过，原因不在用例。产品行为没有改，读数也没有改，只改文字。

| Item | Value |
|---|---|
| Sessions | 无被审研究会话。试点回答存于试点会话 scratchpad 的 `pilot/r1/out/participation-not-read-as-low-impact/with.json`（`evidence` 字段） |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `a5fa652f-76d5-45e3-afb2-5e2e7ef95cfb`，worktree `nostalgic-pike-730889`；本会话写记录、改文字并开 PR |
| Checkout / ledger | `7c6617584`。活动账本只读（`replay report --trial-id 605`），没有写入 |
| Coverage | `capital.md` 这一句、`engine/report.py` 的 `write_fill_volumes`、`ledger/metrics.py` 的 `participation`、4 个 bars 运行的 `reports/`（trial 585、600、605、634，都是 `/tmp` 里已有的副本，只读）。**缺口**：没有查研究会话里有没有人据此写错过报告 |
| Cost | 研究代价 unknown（未查研究会话）。产品造成的无效试验：0 个。本审计评测 $3.49（三轮三臂，runner 报价），另有重判费用未计 |
| Net change | 机制、存储字段、拒绝码都不变（`CATALOGUE` 249 个）。skill 词数 26335，本 PR 净 +3 词（`capital.md` 569 到 572）。加 1 个用例 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-55 | `capital.md:17` 说 `capital.participation@1` 给 “each market fill's quantity”，读者理解成只算市价单，于是在报告里写限价入场不在读数内。实际每种订单类型的成交都算 | 见下节 | skill | wrong output（评测中的报告段落写错；研究会话未查） | in PR |

### 证据

**代码。** `engine/report.py:124-125` 取每个订单的全部 `OrderFilled`，不看订单类型。`ledger/metrics.py:854` 只跳过 `ENGINE_ORDERS`（`EXPIRATION-`、`LIQUIDATION-`）。`capital.md:43-50` 本身也在这个读数下讲挂单分批成交。

**运行。** `--execution bars` 的 4 个运行，`fills.csv` 和 `fill_volumes.csv` 按 `event_id` 一一对上，双向都没有缺行：

| trial | 成交 | LIMIT | STOP_MARKET | MARKET | 全部成交的最大占比 | LIMIT 的最大占比 |
|---|---|---|---|---|---|---|
| 605 | 582 | 370 | 192 | 20 | 0.0553 | 0.0553 |
| 600 | 2058 | 1323 | 728 | 7 | 0.2165 | 0.2165 |
| 634 | 1394 | 893 | 499 | 2 | 0.0695 | 0.0695 |
| 585 | 6036 | 999 | 2000 | 3037 | 0.2508 | 0.0286 |

正对照：trial 605 账本里封存的读数是 `fills` 582、`median` 0.0010159、`p95` 0.0093416、`p99` 0.0218412、`max` 0.0552853，和用这些成交重算的结果到第 6 位小数相同。其中 370 笔是 LIMIT，最大值也来自 LIMIT，所以限价成交确实在封存读数里。

**评测。** 试点题面（只改判分标准），每臂 3 次，逐题重判，判官 sonnet / haiku，`skill-fired` 有 skill 的两臂 3/3：

| 文字 | 轮次 | 通过 | 判为“限价不在读数内” | runner 投票（通过 / 9） |
|---|---|---|---|---|
| 新文字 | 第 3 轮（最终判分标准） | 2, 2 | 0, 0 | 6 |
| 新文字 | 第 2 轮（回答同一批，判分标准改后重判两次） | 3, 2 与 2, 2 | 0, 0 与 1, 0 | 6 |
| 旧文字 | 第 3 轮 | 0, 0 | 3, 3 | 0 |
| 旧文字 | 第 2 轮（同上） | 1, 0 | 2, 3 | 1 |
| 空 `skills/` | 第 3 轮 | 0, 0 | 1, 0 | 0 |
| 空 `skills/` | 第 2 轮（同上） | 0, 0 | 0, 0 | 0 |

runner 投票在第 2 轮是判分标准改之前投的。第 2 轮 Q1 原写 “say or imply”，sonnet 把 “超过 1 的读数只可能来自市价止损” 也判成排除限价，这句话并不排除；所以收窄后重判，再跑独立的第 3 轮。收窄后 sonnet 重判两次，这条回答一次判否、一次仍判是，属于判官噪声。新文字第 3 轮唯一的失败，以及第 2 轮 haiku 判的失败，都落在 Q3：回答漏了“低值不等于冲击小”，和这一句无关。我读了新文字两轮的 6 条回答，没有一条说限价不在读数内。

**误读不是每次都发生。** 第 1 轮我写的题面给了 `fills` 并直接问“覆盖了哪些成交”，旧文字 3 次回答都说全部成交都算，有一次还写成“全部 582 笔对市场的成交”。所以第 1 轮不能区分新旧文字，换回试点题面后才复现。

## 未处理

`capital.md:19-20` 说 “above the volume” 和无 K 线、零成交量一样 “counted apart”。`ledger/metrics.py:868-872` 里超量成交仍留在分布内（`max` 可以大于 1），只是另外计数。可能也会被读错，这里没有测，也没有改。

## Removal list

无。

## Decisions

无 authority 项。
