---
description: Rule check — with the skill, research does not wait on the main checkout; when another session has left it on an unmerged branch, the agent leaves it alone and continues from a worktree of its own detached at origin/main (checking it there, reading skill files from it), instead of stopping, switching the other session's branch or registering from that branch.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（中断后恢复）研究会话，Goal 指向路线 `ema-btc-daily`。下一步是 `registration add`：候选 `ema-root@9` 已预检、已评审，登记正文写好了。

主 checkout `~/code/trade` 现在的状态（另一个会话在那里改 IDE 字体）：
- `git fetch origin main`：成功。
- `git rev-parse --abbrev-ref HEAD`：`codex/restore-font`。
- `git rev-parse HEAD`：`4d1ea6e`，`git rev-parse origin/main`：`03087c9`；`HEAD` 比 `origin/main` 多 1 个提交，那个提交只改了字体和 CSS。
- `git status --porcelain`：没有输出。

这一轮我不在，你自己往下推。按顺序写出你现在做的动作和命令。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
