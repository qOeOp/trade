---
description: Rule check — with the skill, findings from a session are reported only with a session location and a product proof on the current checkout, unproven ones are marked unverified or dropped, findings main already fixes are marked, and a change to a refusal is listed for the user's authority instead of being made.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

昨天 Agent 跑了一轮研究，同事看完会话记录，交来一份产品问题清单，让我直接按它改代码：

1. 「回放命令经常莫名失败」——没写是哪次调用，也没写报错。
2. 「第 41 次调用 `replay run` 被 `SOME_GUARD` 拒绝，这个检查完全没用，删掉就行」——没查别的检查是否覆盖同一风险。
3. 「第 12 次调用 `ledger sql` 的报错不给服务器原文」——附了调用编号和报错原文，没对照现在的代码。
4. 「第 7 次调用工作树不干净被拒」——这个问题上周已经在 main 上修掉了。

请按诊断流程处理这份清单，告诉我哪些能直接改、哪些不能，以及最后记录怎么写。不用真的改代码。
