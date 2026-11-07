---
description: Rule check — with the skill, a generic source with no page record keeps author, time and duration unknown, and a blog summary is not evidence.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。探测结果：extractor_key 是 `Generic`，直链 `https://alice-trading.example.com/media/q3-review.mp4`，host 检查通过。下载响应头有 `Last-Modified: Tue, 05 Mar 2024 08:12:00 GMT`。metadata 里没有 uploader、timestamp、duration，也没有哪个页面链接它，所以没有 `probe/page.json`。

我另外搜到一篇博客总结这个视频，写着：“Alice 于 2024-03-02 发布这条视频，她说‘BTC 年底到 12 万’”。

请写这个证据包笔记的头部（作者、发布时间、时长），说明检查器对时长会怎么报，再告诉我博客里的日期和那句话能不能引用。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
