# Strategy file header

Every strategy file starts with this docstring: the source line, then one line per duty, 27 in nine
groups. Duty definitions: research-round `references/duty-directory.md`.

```text
"""
<策略名>：<一句话写清收益机制>
出处：<DOI / arXiv / URL，加版本或日期>；来源证据包 <bundle 名>

职责立场：每行「编号 立场 | 一句理由 | 来源」
立场 ∈ 采用 / 缺省 / 不适用；来源 ∈ 出处 / 实现者 / 研究者（把出处规则搬到别的市场、周期或品种）

[A 对象与适用性]
A1 可投资对象与资格：<立场> | <理由> | <来源>
A2 动态选择与替换：<立场> | <理由> | <来源>
A3 机制适用的市场结构／条件过滤：<立场> | <理由> | <来源>

[B 预测与学习]
B1 预期收益／相对错价：<立场> | <理由> | <来源>
B2 预测期限与衰减：<立场> | <理由> | <来源>
B3 信号组合与估计更新：<立场> | <理由> | <来源>

[C 首次行动与记忆]
C1 首次进入与触发方式：<立场> | <理由> | <来源>
C2 不行动、重入与历史依赖：<立场> | <理由> | <来源>

[D 经济构型]
D1 单腿／多腿经济构型：<立场> | <理由> | <来源>
D2 对冲与非线性暴露：<立场> | <理由> | <来源>

[E 风险与分配]
E1 单机会的风险与数量：<立场> | <理由> | <来源>  ← 硬契约，不得写不适用
E2 组合敞口、集中与共同风险：<立场> | <理由> | <来源>
E3 净值变化后的风险预算：<立场> | <理由> | <来源>
E4 多机会／多策略资源分配：<立场> | <理由> | <来源>  ← 硬契约，不得写不适用

[F 持仓路径]
F1 主动分批建立与增持：<立场> | <理由> | <来源>
F2 主动减持与持仓路径：<立场> | <理由> | <来源>
F3 动态保护／获利边界：<立场> | <理由> | <来源>
F4 完全退出、到时退出与结束后清理：<立场> | <理由> | <来源>
F5 成员／模型改变时的存量处置：<立场> | <理由> | <来源>  ← 硬契约，不得写不适用

[G 实施]
G1 经济执行方式与价格：<立场> | <理由> | <来源>
G2 等待、刷新与成交后的反馈：<立场> | <理由> | <来源>
G3 冲击、容量与实施速度：<立场> | <理由> | <来源>

[H 资本]
H1 现金、融资及持有成本：<立场> | <理由> | <来源>
H2 保证金、抵押与缓冲：<立场> | <理由> | <来源>  ← 硬契约，不得写不适用
H3 做空可获得性与融资中断：<立场> | <理由> | <来源>

[I 生命周期与可行性]
I1 合约／事件生命周期：<立场> | <理由> | <来源>
I2 退出可行性与未来资源：<立场> | <理由> | <来源>

"""
```

Write the header line by line from this template: each of the 27 duties with its stance
(采用 / 缺省 / 不适用), one reason and its source (出处 / 实现者 / 研究者). The four hard contracts,
E1 single-opportunity risk and quantity, E4 allocation across opportunities, F5 disposal of holdings
when membership changes and H2 margin buffer, are never 不适用.
