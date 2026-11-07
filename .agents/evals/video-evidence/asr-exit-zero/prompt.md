---
description: Rule check — with the skill, exit status 0 from mlx_whisper is not success; the output gate decides before frames.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。视频 `youtube-ccccccccccc` 的转写，我把配方里 `"${ARGV[@]}" > "$W/asr.stdout" 2> "$W/asr.stderr"` 这一行单独放到后台跑了。刚结束，任务状态显示 `mlx_whisper` 退出码 0。`$W` 和 `$B/.stage-asr` 都还在，配方后面的部分还没跑。

我可以开始取帧了吗？如果要先做什么，写出确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
