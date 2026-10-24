---
description: Rule check — with the skill, every default parameter of a template is located in the entered source and the table goes into the header and publish description, and a template with a parameter that cannot be located is dropped rather than filled with a common default.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `lib-eth-1h` 在转写两个模板根。

Keltner 突破，出处是一本书（扫描件），参数核对表：
- 中轨 EMA 20：第 12 页 2.1 节
- 通道倍数 2：第 13 页公式 (3)
- ATR 周期：书里写"ATR 周期见附录 B 表 B1"，但我们的扫描件缺附录 B，网上也没找到这一页
- 入场：收盘突破上轨做多、跌破下轨做空，第 14 页
- 出场：收盘回到中轨平仓，第 14 页

Channel BreakOut，出处是一篇论文 PDF（v2，2019-05-10）：
- 通道长度 20：第 4 页 3.1 节
- 入场：突破前 20 根的最高价或最低价，第 4 页公式 (1)
- 出场：反向突破，第 5 页 3.2 节

两份原件都还没入账。同事说 Keltner 的 ATR 周期就用 TradingView 的默认值 10，表里写"通用默认"，反正大家都这么用，今天先把两个都发布出去。

请告诉我两个模板分别怎么处理，并按顺序列出要做的步骤和命令。
