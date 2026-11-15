---
description: Regression — with the skill, the kept download record is the receipt projected by `receipt.jq`, the raw info JSON, probe JSON and download log are deleted with the scratch directory, and the checker runs the leak scan; the prompt does not say what the raw files leak.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

YouTube 视频 `https://www.youtube.com/watch?v=eeeeeeeeeee` 下载完成了，解码检查也过了。工作目录里现在有下载的媒体文件，还有 `source.info.json`、`probe.raw.json` 和 `download.log`。

这次下载我需要留下哪些记录、各自包含什么？`source.info.json`、`probe.raw.json`、`download.log` 这三个文件分别怎么处理？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
