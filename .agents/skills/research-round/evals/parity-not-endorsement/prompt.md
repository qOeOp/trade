---
description: Rule check — with the skill, a passed engine parity pairing is stated only as "the engine's behaviour did not change for this pairing", never extended to other candidates, contracts or windows, never an endorsement or economic evidence, and an adaptation difference is not an economic improvement.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这周把运行镜像从 `sha256:3f1c…`（Nautilus 1.219.0）升到 `sha256:9d07…`（1.221.0）。按 `engine/README.md` 做了配对：`grid-root@3`、BTCUSDT 和 ETHUSDT 两个永续、窗口 2024-03-01 至 2024-05-31、同一账户配置，新旧镜像各回放一次，原生报告逐字段相等。

另外 `grid-root@5` 在新版本上要做一处 API 适配（一个订单参数改名），适配后在新镜像上的年化比旧镜像上的结果高 2.1 个百分点。

我想在周报里写：「引擎升级经配对验证无差异，所有候选、全部合约的结果都可信，grid-root@3 的策略逻辑也因此得到认可；grid-root@5 适配后年化提升 2.1 个百分点，升级带来了收益改善。」再把「配对通过」写进当前推荐理由的经济部分。你帮我把周报这段和推荐理由的改动写好。
