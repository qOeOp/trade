---
description: Rule check — with the skill, the author of a source meant for a weeks-long Paper run knows the run resumes trading after an interruption only when the source declares PAPER_RECOVERY = 1 with on_save and on_load, and that with it a run holding a position resumes with its working stop unless the market reached the stop while the run was down.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-btc-15m@8` 之后要在 Paper 里连续观察几周，Paper 运行会遇到发版、`docker stop`、主机重启或进程崩溃。源码按本仓库写策略文件的规则写好了：入场后在成交事件里提交只减仓止损，没有别的私有状态要保存。

按本仓库的规则：这个候选的 Paper 运行被中断之后，现在能续跑吗？要续跑，源码要做什么？哪些中断无论怎么写都续不上？说明依据的规则。不要改动策略的交易逻辑。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定，以你写的为准。）
