---
description: Trigger — a suspected defect in a product command, in natural words; it never names the skill, and the agent should invoke product-doctor.
tags: [trigger]
plugins: ["../../.."]
runs: 5
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

`replay report` 给 trial 640 的手续费是 182 USDT，同一个运行 `hypothesis compare` 里显示的候选方手续费是 171 USDT。两个命令都读同一个封存运行，数不该不一样。这是产品的问题吗？帮我查清楚是哪里错了。
