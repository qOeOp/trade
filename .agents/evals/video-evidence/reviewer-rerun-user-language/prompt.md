---
description: Rule check — with the skill, a reviewer rerunning the transcript of a bundle whose run.json records a user-named language sets USER_LANGUAGE from run.json's user_language before the recipe's blocks, rather than stopping at disagreeing windows or editing the DETECTED line.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。我是 clean-context 复核者，要按复核流程重跑恢复出来的 bundle 的转写。`$B/asr/run.json` 里 `detected_language` 是 `yue`，`user_language` 也是 `yue`：当初两个语言窗口一个 `zh` 一个 `yue`，作者问过用户，用户说是粤语。

我准备直接跑 MODEL、Language、Transcript 三段；不过上次别人这么跑，`DETECTED` 那行报了 `windows disagree`。

写出复核重跑的确切命令（从设置变量开始），以及 `DETECTED` 怎么核对。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
