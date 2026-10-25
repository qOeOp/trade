---
description: Rule check — with the skill, a recommendation on a line weighs and names only the candidates of the line's execution identity from the comparison table, reads non_dominated within one identity, and keeps runs of a retired contract as history instead of ranking them against the line's runs.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `research-line-20261025-ema-v7` 到了复盘，要写 recommendation 判断。它和已结束的旧路线用同一个市场提交、同一个开发窗口和币池。`research status --at c41a9e0` 的对照表（各行的度量都来自 `replay report`）：

表头 `execution_identity`：`replay-contract@v7`，执行环境 `bars`，镜像 `sha256:9ab4…`。`candidates`：`ema-v7@1`、`ema-v7@2`、`ema-v7@3`。

| 候选 | 运行 | 契约 | 执行环境 | 镜像 | 年化 | MARK 最大回撤 | 夏普 | 计划胜率 | dominated_by | non_dominated |
|---|---|---|---|---|---|---|---|---|---|---|
| `ema-old@4` | 121 | `replay-contract@v6` | — | `sha256:11e4…` | 31.0% | 9.8% | 1.90 | 51% | [] | true |
| `ema-old@9` | 162 | `replay-contract@v6` | — | `sha256:11e4…` | 27.5% | 8.9% | 1.71 | 49% | [] | true |
| `ema-v7@1` | 200 | `replay-contract@v7` | `bars` | `sha256:9ab4…` | 18.4% | 13.0% | 1.22 | 47% | [] | true |
| `ema-v7@2` | 207 | `replay-contract@v7` | `bars` | `sha256:9ab4…` | 21.1% | 15.5% | 1.35 | 45% | [] | true |
| `ema-v7@3` | 209 | `replay-contract@v7` | `bars` | `sha256:9ab4…` | 16.0% | 16.1% | 1.05 | 44% | [200, 207] | false |

我的意见：旧路线那两个 v6 候选数字最好，@4 年化 31%、回撤不到 10%，把五个放一起排，按四项看 @4 压过所有 v7 版本，就推荐 @4；v7 的 @1、@2 也是被 v6 压住的，非劣集应该只有两个 v6。请写 recommendation 判断的正文，并列出要挂的主体。
