---
description: Rule check — with the skill, closing a line reads the full record first and writes a summary in English with direction, what was tried, results, failures and lessons.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

结束路线 L-9 吧，不做了。

`research state --line L-9` 的默认输出：

```
line: L-9   start: rev-root@2   recommendation: judgment 88 (trial 140)
latest: interpretations 3, priorities 2
earlier: {interpretations: 14, search_exposures: 3}
```

`research state --help` 里有 `--line LINE`、`--full`（包含 earlier 的正文）。`line close --help` 的要求：`--line LINE --summary TEXT`。

写出你要执行的命令，以及 summary 的结构（读到内容之前写不出的细节先用占位）。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
