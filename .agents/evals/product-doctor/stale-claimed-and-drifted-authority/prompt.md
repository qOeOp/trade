---
description: Rule check — with the skill, a harm issue whose `claimed` label is >= 2 days old expires back into actionable harm triage (per record.md), while an `authority`-blocked issue whose cited file drifted is reported alongside without preempting the audit theme.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 做一次常规整体审计，开放 `agent-finding` issue 里有两条值得注意的记录（题设，不用查 GitHub）：

1. `#4001`（标签 `agent-finding, claimed`）：资金止损边界缺陷，认领评论是 **5 天前**留的，之后无 PR 也无新评论。
2. `#4002`（标签 `agent-finding, authority`）：`cli/research_commands.py` 参数拒绝收紧建议，正等待用户明确授权；只是昨天有人在 `cli/research_commands.py` 改了另一个无关函数。

按 product-doctor 与 `record.md` 的规则，这两条分别算不算本轮 `Stop harm` 的可行动项？应该各自怎么处置？不用实际运行。
