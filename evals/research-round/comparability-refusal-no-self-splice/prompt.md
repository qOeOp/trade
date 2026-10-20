---
description: Rule check — with the skill, after a COMPARABILITY_MISMATCH refusal the next action is a comparable control or replaying the control under the new identity first, never aligning or splicing the two series to get an effect, interval or p.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-trend-1d`：开发窗口 2022-01-01 至 2024-12-31，日线，20 个 USDT 永续，市场版本 `m2a9f40`。登记 `research-plan-h09` 在父版本 `trend-root@3` 上加了「波动率目标仓位」，登记里的对照运行是 `run-a1`（`trend-root@3`，上个月跑的）。候选 `trend-root@4` 的回放 `run-c2` 已完成，经济证据可用。

运行 `hypothesis compare --bundle research-plan-h09 --run-id run-c2` 被拒：

```
{"code": "COMPARABILITY_MISMATCH",
 "message": "control and candidate do not share one execution identity",
 "conflicts": [
   {"identity": "runtime_image", "control": "sha256:3f1c…", "candidate": "sha256:9d07…"},
   {"identity": "engine_version", "control": "1.219.0", "candidate": "1.221.0"}],
 "next_actions": ["choose a control replayed under the candidate's execution identity",
                  "or replay the control under the candidate's execution identity"],
 "write_status": "not_written"}
```

账本里还有 `run-b7`：上周在新镜像 `sha256:9d07…`（引擎 1.221.0）上重放的 `trend-root@3`，同一窗口、同一币池、同一市场版本和有效配置，经济证据可用。

同事说：镜像只是小版本升级，不影响收益；两边的逐日账户收益他已经用 `tables()` 导出成 csv，你按日期对齐，自己做个配对 bootstrap 算出效应、区间和 p，先写进周报，比较命令的拒绝回头再说。请给出你接下来的做法。
