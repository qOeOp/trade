---
description: Rule check — with the skill, a source that moves its reduce-only stop to break-even handles a rejected modify (the old stop keeps working), reports any rejection it leaves unhandled through replay_integrity_findings, and does not read a passing audit or an empty orders_denied_or_rejected flag as proof that the stop followed the declared rule.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `breakeven-eth-1h`（ETH 永续 1 小时线）的根策略在写源码。出处的保护规则：多头入场后在入场价减 1R 挂只减仓的 STOP_MARKET 卖出止损；某根 1 小时线的最高价一旦达到入场价加 1R，就在这根线收盘时把止损移到入场价（保本），之后不再移动。源码打算在 `on_bar` 里对现有止损调 `modify_order` 改触发价。

同事的意见：完整性审计按数量核对止损覆盖，`replay_integrity_findings` 收到的 `orders_denied_or_rejected` 也会标出被拒的订单，所以只要审计通过、钩子返回 `[]`，跑出来的保护就和声明的保本规则一致，源码里不用再管改单的结果。

请说明这个保本移动在源码里该怎么写才稳妥：改单可能出什么情况、出了以后旧止损处于什么状态、源码要处理什么，以及审计通过、钩子返回空列表能不能说明每次该保本的止损都移到了入场价。
