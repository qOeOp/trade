# Duty directory

Read when unsure which stance a duty should take in a strategy header (strategy-header.md). Each
duty gives its question, then I (inputs), S (state), O (output) and 钟 (clock), and its boundary
with sources. The four hard contracts (E1, E4, F5, H2) can never be 不适用.

## Contents

- A 对象与适用性: A1–A3
- B 预测与学习: B1–B3
- C 首次行动与记忆: C1–C2
- D 经济构型: D1–D2
- E 风险与分配: E1–E4
- F 持仓路径: F1–F5
- G 实施: G1–G3
- H 资本: H1–H3
- I 生命周期与可行性: I1–I2

### A　对象与适用性

#### A1 可投资对象与资格：哪些资产、合约或交易场所有资格承载机会？

I=当时上市、价格、成交、借券和历史长度；S=当前资格集；O=允许研究/交易集合；钟=成员/合约事件或复核日。  作用对象明确含venue×instrument；同币不同场所不合并资格。行政status/下架仍适用于无固定到期永续。

**边界与出处**　数据能提供的共同集合不是策略选择结果；资格不等于收益排序。影响B、D、H；[X §I.A](https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2019/09/ValueandMomentumEverywhere.pdf)、[G §2.1](https://repec.som.yale.edu/icfpub/publications/2573.pdf)、[T Markets](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

#### A2 动态选择与替换：合格对象中选谁、舍谁、选择哪一到期月份？

I=横截面排名/距离/相对强弱与流动性；S=原成员、选中但未成交意图；O=新成员及变化理由；钟=形成期/再平衡/同时信号。  有序场所对的排序必须同时保留side，交换场所顺序会改变目标腿与价差分母；FA L175–233补证。

**边界与出处**　单资产方向信号不自动是选币；退出旧成员另由F决定。影响E资金竞争；[X §I.C–D](https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2019/09/ValueandMomentumEverywhere.pdf)、[G §2](https://repec.som.yale.edu/icfpub/publications/2573.pdf)、[T Tactics](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

#### A3 机制适用的市场结构／条件过滤：当前是否适合该类收益机制？

I=趋势结构、残差回复速度、成交量、价差/深度；S=当前有效模型/条件；O=启用、降权、暂停新风险；钟=新观测/结构确认。

**边界与出处**　经济过滤不同于网络未连接或指标尚未预热。需说明对既有持仓是否另行处理；[A §3–4,6](https://math.nyu.edu/inmemoriam/avellaneda/AvellanedaLeeStatArb071108.pdf)、[T Entries/Fast Markets](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

### B　预测与学习

#### B1 预期收益／相对错价：未来哪种收益或收敛值得承担？

I=可得价格/财务/条款；S=估计模型；O=方向、强度、预期幅度和置信前提；钟=信号数据更新。  carry预测方法用各场所rate/interval转换共同期限收益；与一次性entry spread/fee门、真实已收现金分开。FA L175–277。

**边界与出处**　不是下单；时序方向、横截面相对排名、条件完成收益不能互相替代；[M §3–4](https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2019/09/TimeSeriesMomentum.pdf)、[A §3–4](https://math.nyu.edu/inmemoriam/avellaneda/AvellanedaLeeStatArb071108.pdf)、[X §I.B](https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2019/09/ValueandMomentumEverywhere.pdf)、[E §4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)。

#### B2 预测期限与衰减：收益能持续多久，等待是否消耗机会？

I=预测因子及回复速度；S=信号年龄、预期未来路径；O=期限相关目标与紧迫度；钟=因子/时间更新。  细分B2a逐渐衰减/收益期限与支付周期；B2b观点有效期失效。I=生成/到期时点，S=每来源有效观点，O=仅有效预测与剩余期目标，钟=观察/到期；exact expiry等号取决于方法，不能统一猜测。BL Insight.cs L133–159。

**边界与出处**　持仓最长时间只是一个方法；会改变加减仓速度、交易成本容忍；[D §1.2,2.2](https://archive.nyu.edu/bitstream/2451/28346/2/DynamicTrading.pdf)。

#### B3 信号组合与估计更新：多个预测及对冲关系如何合成、何时重估？

I=各因子、回归残差、协方差；S=滚动窗口/已拟合系数；O=组合预测、更新后的beta/风险模型；钟=估计日。  细分B3a同source+symbol取最新有效版本，再合并不同来源；B3b参数估计；B3c按已发生观测更新下期权重。I=source/generation/expiry/已发生表现，S=有效观点集/递推分数，O=下期预测/权重；钟=数据关闭/失效/成员变化。UP分数仅模型路径，不是nativePnL/资本。BL L124–176、UP eq3–6。

**边界与出处**　组合alpha不同于跨策略资金分配；模型失效不能靠扩大“其他”吸收；[A §2–4](https://math.nyu.edu/inmemoriam/avellaneda/AvellanedaLeeStatArb071108.pdf)、[D §4.2](https://archive.nyu.edu/bitstream/2451/28346/2/DynamicTrading.pdf)、[X §I.D](https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2019/09/ValueandMomentumEverywhere.pdf)。

### C　首次行动与记忆

#### C1 首次进入与触发方式：何时把机会转为新风险？

I=信号、阈值与价格；S=空仓/待入场；O=首次目标风险/触发意图；钟=收盘、报价、突破或事件。

**边界与出处**　“有信号”不等于已成交；触发价与成交价分开；[T Entries](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)、[A eq16](https://math.nyu.edu/inmemoriam/avellaneda/AvellanedaLeeStatArb071108.pdf)、[E §4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)。

#### C2 不行动、重入与历史依赖：有机会时是否仍应等待，退出后何时能再做？

I=成本、目标偏差、上次突破结果；S=不交易带/止出单元/被跳过突破；O=保持、重新激活；钟=价格跨界/结果确认。

**边界与出处**　不交易是可观察决策；历史交易状态不是研究历史否决门；[W §2,4](https://users.ox.ac.uk/~ofrcinfo/file_links/mf_papers/1999mf09.pdf)、[T Entries/Whipsaw](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

### D　经济构型

#### D1 单腿／多腿经济构型：用哪些合约及数量比例实现所需收益？

I=beta、配对、换股比率/权利条款；S=目标腿组合与原生实际腿；O=联合目标向量、容许不平衡；钟=建构与条款/模型更新。  有序venue pair与long/short方向属于联合目标；净名义零不等于资金零。部分腿失败须联动F2/F4/H2。FA与E。

**边界与出处**　多资产并行不必然是多腿；原生部分成交只是执行事实，需F/H应对；[G §2.2](https://repec.som.yale.edu/icfpub/publications/2573.pdf)、[A eq16](https://math.nyu.edu/inmemoriam/avellaneda/AvellanedaLeeStatArb071108.pdf)、[E §4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)。

#### D2 对冲与非线性暴露：是否、何时、用多少对冲风险，是否保留某些风险？

I=价格/时间/组合delta gamma、因子beta、成本；S=现有风险；O=目标对冲腿或容忍带；钟=价格/时间/风险变化。  严格N/A只由当前全部native合约为linear CryptoPerpetual、无option权利/IV定价/行权状态推出对应vega/行权叶项不存在；不是缺数据。vol sizing/no-trade/gamma式持仓反馈可迁移；如加入option/inverse需重新启用。

**边界与出处**　单一名义额不能概括非线性风险；期权合同权利在crypto永续场景可N/A，但成本与持仓共同决定对冲频率可迁移；[W §4–5](https://users.ox.ac.uk/~ofrcinfo/file_links/mf_papers/1999mf09.pdf)、[A §5.1](https://math.nyu.edu/inmemoriam/avellaneda/AvellanedaLeeStatArb071108.pdf)。

### E　风险与分配

#### E1 单机会的风险与数量（硬契约）：一笔机会承担多少数量／止损风险？

I=权益、N/波动、乘数、保护距离；S=已承诺单元；O=单元数量及风险预算；钟=建仓/主动加仓前。

**边界与出处**　止损距离与数量耦合，不能各算各的；不同于原生保证金余额；[T Position Sizing/Stops](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

#### E2 组合敞口、集中与共同风险：全账户承担多少总、净、方向、相关组或因子风险？

I=候选及持仓风险；S=全组合暴露；O=合成目标和可用风险预算；钟=任一候选/持仓变化。

**边界与出处**　多个单机会合法不代表合成合法；与H资金、D腿向量交互；[T Unit limits](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)、[P §4.2–4.4](https://stanford.edu/~boyd/papers/pdf/cvx_portfolio.pdf)。

#### E3 净值变化后的风险预算：亏损/盈利后是否改变未来风险规模？

I=原生权益历史与初始基准；S=有效名义账户规模；O=新 sizing 基准；钟=权益阈值/复核日。

**边界与出处**　研究用户目标不因此改变；与E1、H储备联动；[T Adjusting Trading Size](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

#### E4 多机会／多策略资源分配（硬契约）：同时争取同一风险、资金或流动性的候选谁先得到多少？

I=全体候选价值/成本/相关性；S=其他已占用与承诺；O=联合分配、未获资源机会；钟=同一决策批次。  细分E4a同批机会联合分配，E4b策略资本分片与全账户竞争。I=全部机会/策略需求＋native占用与可用，S=份额/未决承诺，O=缩量/获配/延后，钟=决策批次/分片复核。PB生产gate按全候选去除/二分边界量；PST按权重分配capital及margin预算。WE/分片预算均不是native margin。

**边界与出处**　不能靠循环顺序或引擎拒单代替；[T Simultaneous Entry Signals](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)是同组多机会直接证据；多独立策略共享账户的推广需另验。

### F　持仓路径

#### F1 主动分批建立与增持：是一次达到目标，还是市场确认后逐单元增加？

I=价格路径、实际前次成交价、剩余预算；S=已成交批次/待执行批次；O=新批次目标；钟=新阈值/原生成交确认。

**边界与出处**　被动部分成交不计主动分批；[T Adding Units](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)直接给出按前次实际fill加码。

#### F2 主动减持与持仓路径：当前应减少多少、以何速度向新目标移动？

I=变化的alpha/成本/风险；S=原生当前持仓和已有承诺；O=目标变化、仅执行当前步；钟=每次重估。

**边界与出处**　与一次性出场不同；成本可使仓位滞后于预测；[D eq9–13,50–51](https://archive.nyu.edu/bitstream/2451/28346/2/DynamicTrading.pdf)、[P §5.2](https://stanford.edu/~boyd/papers/pdf/cvx_portfolio.pdf)。

#### F3 动态保护／获利边界：持仓后损失或利润边界如何随路径、波动、加仓或新结构调整？

I=市场路径、unit fills、N；S=各批保护、原生净持仓；O=新的退出边界和所需覆盖数量；钟=新结构/加仓确认。  细分F3a损失边界、F3b利润目标价、F3c利润目标档位数量。I=current volEMA/原生均价/仓量/exposure预算，S=余仓/既有档位，O=(price,qty)逐档新目标，钟=市场更新或fill。PB动态threshold=base+WEratio权重+1m/1hvolEMA权重，价格由均价重算并量化、数量按余仓/预算/最小量重算；grid非trailing，NFI水位退出不能代替。closes.rs283–353、478–529、1350–1432完整生产bridge。

**边界与出处**　这是经济边界选择；实际挂单覆盖/撤换是工程及执行义务。原Turtle不总挂交易所止损，移植须遵守本项目保护契约；[T Stops](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)。

#### F4 完全退出、到时退出与结束后清理：收益逻辑结束、收敛、期限届满或事件失败时是否全部结束？

I=对向结构、均衡、截止/事件结果；S=所有腿、意图及订单；O=清零目标、结束判据；钟=结构/时间/事件。

**边界与出处**　所有单位退出、组合收敛退出、下架退出是不同方法；原生平仓后残单清理不能冒充经济覆盖；[T Exits](https://www.tradingblox.com/originalturtles/originalturtlerules.pdf)、[G §2.2](https://repec.som.yale.edu/icfpub/publications/2573.pdf)、[E §4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)。

#### F5 成员／模型改变时的存量处置（硬契约）：新选币或失去模型资格后，旧仓/订单保留、减持还是退出？

I=A/B变化；S=旧成员持仓和挂单；O=旧资源释放/过渡目标；钟=成员/估计更新。  细分F5a旧仓旧单目标处置；F5b成员相关模型窗口/观点失效并重建。I=成员增删/历史可得性，S=旧观察与观点，O=reset/expire/重新ready；钟=成员变化/重新预热。BL移除Expire全symbol观点并reset本地，加入读可得历史；未失效旧观点在新观点先过期后可补位，已移除再入不能复活。

**边界与出处**　A选择只决定未来集合，不能默默删除存量；[G §2.2 下架及交易期末](https://repec.som.yale.edu/icfpub/publications/2573.pdf)只证明部分规则；一般动态换池过渡仍需具体策略补证。

### G　实施

#### G1 经济执行方式与价格：吃单还是挂单、报价多远、哪侧多少、多少价格层？

I=alpha紧迫度、库存、波动、深度和成本；S=原生挂单；O=报价/数量/层级目标；钟=行情/执行周期。

**边界与出处**　库存做市的两侧报价不是传统独立买卖信号；[Q §2–3](https://math.nyu.edu/inmemoriam/avellaneda/HighFrequencyTrading.pdf)、[H L713–936,L1029–1131](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/hummingbot/strategy/avellaneda_market_making/avellaneda_market_making.pyx)。

#### G2 等待、刷新与成交后的反馈：原报价是否仍值得等待、何时撤改、成交后是否冷却/保留另一侧？

I=新报价、订单年龄、成交；S=未决撤单与挂单配对；O=保留/撤换/延迟意图；钟=时钟/成交/报价变动。  经济刷新容忍不同于确认安全；PB live cancel-first/authoritative refresh/部分connector延后同scope create提供真实状态桥。clock=ack/account/cache确认；未确认撤单不可释放承诺。

**边界与出处**　经济刷新容忍和冷却不同于必须等ack的状态安全；[H L1165–1266](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/hummingbot/strategy/avellaneda_market_making/avellaneda_market_making.pyx)。

#### G3 冲击、容量与实施速度：建立/退出多快才划算，自己尚未消退的冲击是否改变目标？

I=成本矩阵、市场量、冲击衰减；S=现有/预期冲击；O=当期交易量与未来规划；钟=每次重估。  fill驱动自身预期冲击递推只能影响成本预测/目标/速度，不能重建真实市场或二扣账户费用。

**边界与出处**　不是重建撮合或私算实际成交；[D §2.2](https://archive.nyu.edu/bitstream/2451/28346/2/DynamicTrading.pdf)、[P §4.5,5](https://stanford.edu/~boyd/papers/pdf/cvx_portfolio.pdf)。

### H　资本

#### H1 现金、融资及持有成本：成本后的机会是否仍值得持有，现金保留多少？

I=原生现金、借款/借券利率、持有费；S=所有占用与未结费用；O=成本调整目标及现金储备；钟=决策/融资结算。  持仓carry、支付interval、共同horizon、next settlement、实际资金费cashflow分开。融资本金/不可使用卖空所得单列；不能以正carry跳过入场spread/fee门。

**边界与出处**　“零成本／零净名义”不等于零资金占用；[P §2.3–2.6,4.4](https://stanford.edu/~boyd/papers/pdf/cvx_portfolio.pdf)、[E §4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)。

#### H2 保证金、抵押与缓冲（硬契约）：未来新增风险用多少可用资本，如何为亏损/提高保证金留缓冲？

I=原生账户、保证金条款、压力变化；S=已占用/订单承诺；O=可用资本分配与减杠杆目标；钟=候选/权益/保证金变化。  细分H2a持仓/原生保证金占用；H2b未决订单承诺、不可立即释放；H2c可转移与目的地已到达资本。I=native margin/free/locked/transfer状态，S=pending cancel/transfer，O=等候/缩量/新增上限；钟=原生订单/账户/转移。Binance V3字段仅源概念，不能强套Nautilus同名字段语义；Bybit Pending/Sent尚未目的地可用。

**边界与出处**　引擎拒单是后果，不是分配规则；融资约束与gross notional独立；[L §1–2](https://www.princeton.edu/~markus/research/papers/Mkt_Fun_Liquidity.pdf)。具体跨保证金净额算法未获当前语料。

#### H3 做空可获得性与融资中断：能否借到、借券回收/资金中断时怎样处置？

I=可得借券和融资条款；S=受影响腿；O=停止新增/替换对冲/退出目标；钟=可获得性/召回事件。  仅现货stock借券recall在完全无借股资产/本金/义务的linear perp候选N/A；融资中断/保证金不足/强制风险收束仍适用。I=可得融资/状态事件，O=停止新增/撤风险/替代腿/退出；缺该事件不能N/A。IBKR loan-recall官方定义。

**边界与出处**　融资事件事实归引擎/数据；经济响应需要策略规则；[E §2,4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)、[L §2](https://www.princeton.edu/~markus/research/papers/Mkt_Fun_Liquidity.pdf)说明风险真实性，具体召回响应本语料不足。

### I　生命周期与可行性

#### I1 合约／事件生命周期：到期、换月、并购完成/取消、下架如何改变机会与合同？

I=已知条款、交易/到期日、事件结果；S=对应腿/机会；O=换合约/转换/终止目标；钟=公告/事件/复核。  无固定到期/行权/实物交割只排除相应叶方法；行政status/下架不得排除。I=原生可得status/close，S=受影响仓单/腿，O=暂停新增、撤增加风险单、保持保护、退出/接受native settlement；钟=已知公告/状态事件。

**边界与出处**　强制结算属引擎事实；选择提前退出或换月才是经济职责；[E §4.1](https://www.hbs.edu/ris/Publication%20Files/arbitrage_af05900b-acd4-44db-8210-70a9fbc3cf6c.pdf)、[G §2.2](https://repec.som.yale.edu/icfpub/publications/2573.pdf)、[M §2.1](https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2019/09/TimeSeriesMomentum.pdf)。

#### I2 退出可行性与未来资源：当前看似有利的头寸，未来能否平掉、会不会挤占后续机会？

I=预测成本/流动性/目标；S=持仓及规划期限；O=限制当前交易/终端目标；钟=规划更新。

**边界与出处**　终端规划不等于真的在H期清仓；[P §4.4 liquidation loss,5.2 terminal constraints](https://stanford.edu/~boyd/papers/pdf/cvx_portfolio.pdf)。
