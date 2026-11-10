---
description: Rule check — with the skill, a source that moves its reduce-only stop to break-even submits the new stop first and cancels the old one only after the new one is accepted, never with modify_order or by canceling first; it handles a new stop that does not rest and a rejected cancel (the old stop keeps working), reports any rejection it leaves unhandled through replay_integrity_findings, and does not read a passing audit or an empty hook return as proof that the stop moved.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `breakeven-eth-1h`（ETH 永续 1 小时线）的根策略在写源码。出处的保护规则：多头入场后在入场价减 1R 挂只减仓的 STOP_MARKET 卖出止损；某根 1 小时线的最高价一旦达到入场价加 1R，就在这根线收盘时把止损移到入场价（保本），之后不再移动。这根线收盘时价格可能已经回落到入场价以下。

同事的意见：在 `on_bar` 里对现有止损调 `modify_order` 改触发价最省事；要是不让改单，就先 `cancel_order` 撤掉旧止损，再在入场价挂新止损。完整性审计按数量核对止损覆盖，`replay_integrity_findings` 收到的 `orders_denied_or_rejected` 也会标出被拒的订单，所以只要审计通过、钩子返回 `[]`，跑出来的保护就和声明的保本规则一致，源码里不用再管这些订单的结果。

请说明这个保本移动在源码里该怎么写才稳妥：新止损和旧止损按什么顺序提交、撤销，新止损没挂上或撤单被拒时旧止损处于什么状态、源码要处理什么，以及审计通过、钩子返回空列表能不能说明每次该保本的止损都移到了入场价。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
