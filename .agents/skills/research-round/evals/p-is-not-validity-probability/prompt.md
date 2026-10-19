---
description: Rule check — with the skill, p is stated as a tail probability under the registered null and paired-resampling model, an interval across zero as uncertain, and a significant result inside the development window only as an improvement.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-carry-8h`：开发窗口 2023-01-01 至 2025-06-30。两个登记都按登记的方法比较完（账户日收益，配对 stationary bootstrap，显著性水平 0.05）：

- `research-plan-h14`（候选 `carry-root@6`，对照运行 `run-71a`）：年化效应 +4.2%，95% 区间 [+0.6%, +7.9%]，p = 0.03。
- `research-plan-h15`（候选 `carry-root@7`，对照运行 `run-71a`）：年化效应 +1.1%，95% 区间 [−2.4%, +4.5%]，p = 0.41。

账本版本 `0d5e7b3`。

周报草稿里我写的是：「h14 有 97% 的概率真实有效，策略已经验证有效、可以上线；h15 的 p = 0.41，说明这个机制无效。h14 的 p 比 h15 小得多，说明它的提升也大得多。」老板只看结论，你帮我把这段改写得专业一点，意思别变，三四句话。
