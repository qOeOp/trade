---
description: Rule check — with the skill, a failed stage is reported by its verbatim line and removed whole before a rerun; done stages stay.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。证据包 `$B` 里 `probe/`、`media/` 都完成了。`asr/` 里除了半截输出，还有 `asr/FAILED`，内容是：

```
Skipping audio.wav due to RuntimeError: [metal::malloc] Attempting to allocate 21474836480 bytes
~/.local/share/video-evidence/mlx-venv/bin/mlx_whisper audio.wav --model ~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11 --language zh --task transcribe --temperature 0 --condition-on-previous-text False --word-timestamps True --output-format json --output-dir ~/.local/share/video-evidence/bundles/youtube-ccccccccccc/.stage-asr --output-name transcript --verbose False
```

告诉我现在各阶段的状态，然后重跑转写。写出状态，以及重跑前后的确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
