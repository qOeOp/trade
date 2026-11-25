---
description: Rule check — with the skill, an overall audit asked for without naming a full one ranks the signals, takes the slimming theme on the object fixed again and again, leaves the rest out, and lets a "by design" line alone keep nothing.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 给产品做一次整体审计。信号我已经读好，是题设，不需要再查：

- 未结 `agent-finding` 9 个，都是提示文案和对比度，没有涉及资金、记录或错误结果的。
- 近两周 `fix` 提交改得最多的文件：`paper/wait.py` 14 次，测试从 300 行涨到 1400 行；其余文件都不超过 3 次。
- 近两周产品净增 5200 行，其中功能 4600 行。
- 最久没审的是 `docs-site`；CI 中位 16 分钟，和上月一样。
- 前两次审计都是找错。

这次审什么、不审什么、怎么派、要什么样的证明？`paper/wait.py` 里有一段特例的注释写着"有意如此（by design）"，没有调用者、转录或事故记录提到它；还有一段拒绝检查看上去也多余。这两段分别怎么处理？写出方案即可，不用运行。
