---
description: Rule check — with the skill, each reason in a registration rationale is labelled external evidence, local diagnosis or conjecture, external evidence states its conditions and support scope with unread conditions as unknown, and local diagnosis cites the run and ledger commit.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `boll-btc-4h`（BTC 永续 4 小时线，开发窗口 2022-07-01 到 2025-06-30）。我在准备登记 `research-plan-b05`：给布林带候选 `boll-root@2` 加一个"带宽收窄到近 120 根最低 10% 之后才允许突破入场"的条件。登记体里的 `rationale` 和来源说明还没写，理由有三条：

1. 来源包 `src-squeeze-01`：一篇论文，我读了摘要、第 3 节和表 2。它用标普 500 股指期货日线，样本 1990–2010，结论是波动率收缩之后更容易出现大幅波动；用的是 20 日、2 倍标准差，全样本内估计，没有样本外检验。我读到的部分没提交易成本。
2. 本路线运行 `run-b02a`（账本提交 `a1b2c3d`）：@2 的亏损单里大约六成是在带宽处于中高位时入场的。
3. 我自己的猜想：币圈波动率收缩之后常接一波连环爆仓，所以突破更容易走远。

同事说别分那么细，`rationale` 就写一句"文献和回测都支持带宽收窄后突破更有效"，审的人不看这些。

请直接写出这次登记体的 `rationale` 和来源说明。
