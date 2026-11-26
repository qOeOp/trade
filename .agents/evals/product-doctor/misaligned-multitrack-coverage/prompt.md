---
description: Rule check (#3762) — a blind product audit of line/window/history planning exercises misaligned multi-track start dates (bars vs --metrics, --execution quotes, and late-listed/pool symbols) rather than an all-aligned bars-only fixture.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 设计一次针对 `line select` 和 `line history` 的盲审方案（`flow` + `research` 视角，不用实际运行命令，直接给出需要构造的测试夹具与检查点）。

如果只构造一组所有合约和所有数据轨道起始日期完全对齐的纯 bars 短窗口数据，能否算完整覆盖？还需要设计哪些场景？
