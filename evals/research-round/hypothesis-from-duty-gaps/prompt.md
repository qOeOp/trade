---
description: Rule check — with the skill, the next hypothesis is chosen by summarizing the line's header stances, listing the 缺省 and 不适用 duties and combining them with the latest attribution, and its duty ids go into changed_duties.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `kc-eth-4h`（ETH 永续 4 小时线，单品种）。谱系：`kc-root@1`（根）→ `@2`（加 ATR 追踪止损，F3）→ `@3`（加持仓满 30 根后的时间退出，F4）。三个候选文件头的职责立场：

@3：A1 采用｜A2 不适用｜A3 缺省｜B1 采用｜B2 缺省｜B3 不适用｜C1 采用｜C2 缺省｜D1 采用｜D2 不适用｜E1 采用｜E2 不适用｜E3 缺省｜E4 采用｜F1 不适用｜F2 缺省｜F3 采用｜F4 采用｜F5 采用｜G1 采用｜G2 缺省｜G3 缺省｜H1 缺省｜H2 采用｜H3 不适用｜I1 缺省｜I2 缺省
@2：与 @3 相同，只是 F4 的理由里只有反向突破出场，没有时间退出。
@1：与 @2 相同，只是 F3 为缺省。

最近一次比较 `hypothesis compare --bundle research-plan-k03 --run-id run-k03a`（@3 对 @2）：配对差接近 0，不显著；归因 `profit_bridge` 显示两边的差额主要来自资金费，价格部分差不多，@3 的持仓赶上资金费高位的时间更多；`trade_structure` 里各出场类别差别不大。

我的想法是下一个假设直接把 Keltner 倍数从 2.0 调到 2.5，感觉突破会更干净。请你定下一个假设：改哪一处、为什么选它，并写出登记体里的 `change` 和 `changed_duties`。
