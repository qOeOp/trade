# 社区常见策略开发问题与研发链覆盖评估

> 证据目录：`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/`（只读模拟的脚本、探针与日志，`MANIFEST.sha256` 记录全部文件哈希）。
> 审查范围：worktree `rr-self-contained`，即 main（a0c492777）加上待合并的 #1505；Dolt 台账 v138（commit `0bnuhr5ulfrdcjrj62p7n2crgv44ddsv`），28 个 attempt / 27 个 run，以及 `~/.local/share/trade` 下的 seal 和审计。整个过程只读：没有写 Dolt，没有提交 Git，也没有改仓库文件。
> 编号说明：问题类型用一位数字（如 M1 指 K 线内路径歧义），审查发现用两位数字（如 M01）。两套编号不要混淆。

## 1. 结论先行

- **覆盖面。** 从量化社区（QuantConnect、Freqtrade、TradingView/Pine、NautilusTrader、quant.SE、Elite Trader、Quantopian 讲义和学术文献）归纳出 **11 组、58 类**常见问题，并据此整理出 **18 个阶段**的理想研发链。
  - 52 类研究内问题：完整覆盖 **9 类（17%）**，部分覆盖 **33 类（63%）**，缺失 **10 类（19%）**。另有 6 类实盘问题，在用户授权实盘前属于范围外。
  - 18 个阶段：**15 个部分覆盖，3 个缺失**（组合构建、分级部署、实盘对账），没有一个阶段完整覆盖。
- **强项。** 数据托管与复现（D3、P3）、事件驱动的因果时钟（B1）、资金费原生结算（C1）、预登记和禁止事后调整（P1、P6）、确认只能使用发表后的新窗口（S3）。这些都有代码约束。
- **最可能导致研发失败或得出错误结论的问题：**
  - 全部证据来自同一个已反复查看的熊市年份，也没有可复用的数据配方，所以确认和跨行情检验都做不了（M01）。
  - L3 事件研究把同时触发、高度相关的 37 个币当成独立样本，有效 N 只有约 1.5–2.3，逐事件 t 值在两个方向上都会给出假显著（M04）。
  - 没有匹配的随机或基准对照，盈利容易被错归到信号上（M05）。
  - 宿主读取 Catalog 有静默陷阱（例如 1000x 别名读到零行，M13）；幸存者偏差只做了披露，没有限定结论范围（M14）。
- **最浪费时间的问题：**
  - 一年数据做配对检验，最小可检测效应约 45–65 个百分点，而局部改良通常只有 +3 到 +5pp，所以在跑之前就注定 inconclusive（M20）。
  - 换镜像必须重封对照，网格和父子改良没有便宜的配对路线，每轮约 25–29 条命令（M21–M23）。
- **修复成本。** 绝大多数修复只是几行 skill 文本或 Agent 流程，不需要新代码。需要用户决定的只有四件事：是否恢复研究目标并跑一轮真实研究；W7/W6 数据配方的文件清单与体量；压力撮合配置（需要新镜像）；以及将来是否授权实盘。D10 之后再没有真实研究轮，所以 #1490–#1506 的方法论修补只在合成评测中验证过（M19）。

## 2. 社区常见问题类型

> 频次判断依据各社区反复出现的主题和专门工具，没有做系统计数。Reddit r/algotrading 抓取被拦截，只用了镜像和搜索摘要；Wilmott 和 Quantopian 论坛未能访问；QuantStart Part I 抓取时返回 502。部分数字是二手或只看了摘要（Pimentel 24%/4%、Wiecki R²、Ammann 62%、ADL 估计）。DeFi、税务和期权不在范围内。

**数据（D1–D7）**
- **D1 幸存者与币池选择偏差**：只测至今仍存在的合约，或者用窗口之后的信息挑选币池。Ammann 等的摘要估计，加密等权口径下这项偏差约 62%/年。[QC 研究指南][qc-rg] · [Ammann/Liebi/Stöckl](https://alexandria.unisg.ch/handle/20.500.14171/108037)
- **D2 坏价、闪崩影线与异常值**：误价或单个交易所的薄盘影线进入 OHLC。一根 K 线就能触发止损或制造盈利，例如 2021-10 Binance.US 上 BTC 打出 8,200 美元。[The Block](https://www.theblock.co/post/121657/binance-us-blames-bitcoin-flash-crash-to-8200-on-a-bug-in-a-clients-trading-algorithm) · [七宗罪][sins]
- **D3 缺 K 线、历史截断与静默修订**：交易所停机、API 历史长度有上限、供应商事后重算数据，导致重跑时实际用的是另一份数据。[Freqtrade 交易所说明][ft-ex] · [Amberdata 事故](https://status.amberdata.io/incidents/cpfnmwy69wsy)
- **D4 时间戳、K 线标注与日界**：把开盘时间戳当成开盘即可见，或时区、日锚不同，或辅助序列错位，结果是泄露一整根未来 K 线。[Nautilus bar execution][nt-bar] · [ProRealCode 日线锚][prc-day]
- **D5 复权与连续合约拼接**：把现货历史拼到永续上，新旧代码或 1x/1000x 合约被隐式拼接。[QC 研究指南][qc-rg] · [quant.SE 147][se147]
- **D6 交易规则用错时点**：把今天的 tick、最小名义、杠杆档和维持保证金套用到全部历史。[Freqtrade 回测][ft-bt] · [Binance 保证金 FAQ][bn-margin]
- **D7 研究数据与实盘数据不一致**：交易所、价格类型（last、mark、index）或 K 线构造不同，同一份代码算出的指标不同。[QC 论坛 ADX](https://www.quantconnect.com/forum/discussion/20251/adx-values-differ-between-live-and-backtest-both-using-quantconnect-data-seeking-explanation/) · [QC 对账][qc-rec]

**偏差与泄露（B1–B6）**
- **B1 同根前视**：用第 N 根的收盘或高低点做决策，却按同一根的价格成交。这是被引用最多的单个错误，R-bloggers 的例子里 Sharpe 1.59 改正后只剩 0.66。[Chan 讲义][chan] · [Robot Wealth][rw]
- **B2 全样本统计与负位移**：使用 `shift(-k)`、全序列均值或极值、全期校准的阈值。[Freqtrade lookahead-analysis][ft-la]
- **B3 高周期取值与重绘**：使用尚未收盘的高周期值，或历史 K 线和实时 K 线走的是不同算法。[Pine 重绘][pine-rp]
- **B4 指标预热与历史长度敏感**：递归指标的值取决于加载了多少历史，换个起点结果就变。[Freqtrade recursive-analysis][ft-ra]
- **B5 机器学习的标签与交叉验证泄露**：标签在时间上重叠、k 折没有清洗和禁运、在切分前就做了缩放。[Purged CV](https://en.wikipedia.org/wiki/Purged_cross-validation) · [Quantpedia：ML 基金为何失败][qp-ml]
- **B6 研究者与 LLM 的后见之明**：人或模型已经知道窗口内发生了什么，训练截止前的价格被“记住”。[Glasserman & Lin](https://arxiv.org/abs/2309.17322) · [lookahead propensity](https://arxiv.org/html/2504.14765v2)

**过拟合与统计（S1–S7）**
- **S1 参数过拟合与尖峰最优**：参数调到样本内曲线好看为止，最优点落在尖峰上，自由度相对交易数太多。[QuantStart][qs] · [Elite Trader](https://elitetrader.com/et/threads/is-this-over-fitting.373413/post-5786816)
- **S2 多重检验与选择偏差**：从 N 个变体里挑最好的，结果必然偏高，所以门槛要随试验数提高。[PBO][pbo] · [DSR][dsr] · [Quantopian 888 算法研究][qp-888]
- **S3 留出集污染与前推误用**：看过样本外再改，或者反复重选直到前推检验通过。[Arnott/Harvey/Markowitz][ahm] · [Elite Trader WFA][et-wfa]
- **S4 统计功效不足与指标估计误差**：独立事件太少；存在正自相关时，年化 Sharpe 最多会被高估约 65%（Lo）。[Lo 2002][lo] · [quant.SE 1891](https://quant.stackexchange.com/questions/1891/how-much-data-is-needed-to-validate-a-short-horizon-trading-strategy)
- **S5 没有零假设或基准**：不和随机入场、打乱信号、买入持有比较。Aronson 测了 6,400 多条规则，按书评的说法没有一条显著。[quant.SE 3225][se3225] · [CXO 书评][cxo]
- **S6 把 beta、carry 或因子暴露当成优势**：牛市里的多头、资金费 carry、山寨币的共同因子；动量策略会在恐慌后的反弹中崩溃。[Daniel & Moskowitz][dm] · [Quantopian 讲义][qr]
- **S7 相关品种与重叠交易被当成独立证据**：几十个山寨币可能只是一个赌注。[quant.SE 85698][se85698] · [Quantpedia][qp-ml]

**执行与成本（E1–E2）**
- **E1 手续费与融资成本**：零佣金或默认佣金、maker/taker 用错、费率档不对。[七宗罪][sins] · [Freqtrade 回测][ft-bt]
- **E2 滑点、冲击、部分成交与容量**：按收盘价全额成交，复利后仓位超过盘口深度。[quant.SE 1264](https://quant.stackexchange.com/questions/1264/how-to-simulate-slippage) · [QC 成交模型](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/trade-fills/key-concepts)

**市场微观结构（M1–M5）**
- **M1 K 线内路径歧义**：同一根 K 线里止损和止盈都被触及，引擎只能猜哪个先发生。[TradingView Bar Magnifier](https://www.tradingview.com/support/solutions/43000669285-what-s-bar-magnifier-backtesting-mode/) · [NinjaTrader 论坛](https://forum.ninjatrader.com/forum/ninjatrader-8/strategy-development/1090866-stoploss-and-takeprofit-in-the-same-candle)
- **M2 限价单乐观成交**：价格一碰到就算成交，忽略队列位置和逆向选择。[NinjaTrader fill-on-touch](https://ninjatrader.com/support/helpGuides/nt8/isfilllimitontouch.htm) · [Nautilus trade execution](https://nautilustrader.io/docs/latest/concepts/backtesting/trade-execution/)
- **M3 止损按触发价成交**：价格跳空或影线穿过止损时仍按止损价成交，尾部亏损被低估。[Freqtrade 回测][ft-bt] · [Mudrex][mudrex]
- **M4 决策到成交的时延**：假设下单零延迟。[Nautilus bar execution][nt-bar] · [QC 论坛](https://www.quantconnect.com/forum/discussion/3532/running-an-algorithm-live/)
- **M5 交易所下单规则与拒单**：模拟器接受了交易所会拒绝的单，例如止损太近、post-only 穿价、价格保护、最小名义不足。[Freqtrade 交易所说明][ft-ex] · [ProRealCode][prc-live]

**行情与衰减（R1–R2）**
- **R1 行情依赖**：优势只在某一种波动或趋势状态下存在，而测试窗口恰好只覆盖它。[quant.SE 12793](https://quant.stackexchange.com/questions/12793/regime-switching-model-for-detecting-market-shifts) · [Daniel & Moskowitz][dm]
- **R2 优势衰减与结构变化**：McLean 和 Pontiff 发现异象在样本外收益低约 26%，发表后低约 58%。交易所规则也在变，例如 Binance 资金费间隔从 8h 改为 4h 和动态 1h。[McLean & Pontiff](https://counterpointfunds.com/wp-content/uploads/2017/07/PredictabilityMcleanPontiff.pdf) · [Binance 资金费][bn-fund]

**流程（P1–P9）**
- **P1 先看结果再编故事**：没有机制，也没有可证伪的预测。[QC 研究指南][qc-rg] · [七宗罪][sins]
- **P2 试验不登记，没有“失败想法墓地”**：DSR 需要的试验数无从算起。[DSR][dsr] · [SSRN 3167017](https://papers.ssrn.com/abstract=3167017)
- **P3 不可复现**：代码、数据、依赖或缓存发生漂移。Jupyter 研究中约 24% 能运行、约 4% 能复现结果（二手数字）。[Pimentel 等 MSR 2019](https://2019.msrconf.org/details/msr-2019-papers/36/A-Large-scale-Study-about-Quality-and-Reproducibility-of-Jupyter-Notebooks)
- **P4 参数扫描与优化器管理**：挑最佳 epoch、结果依赖随机种子、扫描格不计为试验。[freqtrade #7190](https://github.com/freqtrade/freqtrade/issues/7190)
- **P5 代码或引擎缺陷制造好结果**：曲线好得过头，通常是 bug。[Chan 讲义][chan] · [ProRealCode](https://www.prorealcode.com/reply/100429/)
- **P6 确认偏差与事后微调**：看了亏损单再加过滤条件，或者移动目标来保住结果。[quant.SE 147][se147] · [Arnott 等][ahm]
- **P7 研究蔓延与技术债**：同一策略有多份略有不同的定义。[Sculley 等](https://papers.nips.cc/paper/5656-hidden-technical-debt-in-machine-learning-systems)
- **P8 没有独立审阅**：研究者自己给自己打分。[Arnott 等][ahm] · [Quantpedia][qp-ml]
- **P9 没有时间预算和停止规则**：QuantConnect 建议探索封顶在 8–32 小时。[QC 研究指南][qc-rg]

**风险与仓位（K1–K3）**
- **K1 过度杠杆与按估计优势定仓**：回测优势本身偏高，按它下满 Kelly 或高杠杆就会过度下注。[MacLean/Thorp/Ziemba](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf)
- **K2 回撤与尾部风险低估**：回测的最大回撤只是一条路径；2025-10-10/11 那次级联约有 190 亿美元强平。[Rej/Seager/Bouchaud][rsb] · [FTI][fti]
- **K3 集中与相关性飙升**：多个山寨币仓位在下跌时变成同一个仓位。[Quantopian 讲义][qr] · [FTI][fti]

**加密永续特有（C1–C6）**
- **C1 资金费核算错误**：缺数据就当 0、结算间隔错、按 last 而不是 mark 计算名义。[Binance 资金费][bn-fund] · [Freqtrade 杠杆](https://www.freqtrade.io/en/stable/leverage/)
- **C2 强平、保证金档位与 mark/last 价格**：强平看 mark 价和分档维持保证金，止损却可能看 last 价。[Binance 保证金 FAQ][bn-margin] · [Bitsgap](https://bitsgap.com/blog/three-prices-one-liquidation-mark-index-and-last-price-explained)
- **C3 ADL、社会化亏损与抵押品脱锚**：极端行情中盈利腿或对冲腿被强制平仓。[ADL 预印本](https://arxiv.org/html/2512.01112v2) · [Binance 补偿报道](https://finance.yahoo.com/news/binance-spends-283-million-cleaning-190608586.html)
- **C4 交易所宕机与 API 冻结**：最需要退出时下不了单。[CNBC](https://www.cnbc.com/amp/2021/08/19/cryptocurrency-traders-seek-damages-from-binance-after-major-outage.html) · [Baumgartner](https://acfr.aut.ac.nz/__data/assets/pdf_file/0009/686754/6b-Tim-Baumgartner-May19.pdf)
- **C5 合约生命周期**：上市、退市、更名迁移，以及 1000x 乘数映射错误。[BitMEX POL 迁移](https://www.bitmex.com/blog/polygon-migration-implications) · [CoinAPI](https://www.coinapi.io/blog/how-to-eliminate-survivorship-bias-in-crypto-backtesting)
- **C6 山寨币流动性薄、成交量注水与操纵**：按 Kaiko 2023 年的数据，Binance 约占全球深度的 31%、成交量的 64%。[Kaiko](https://research.kaiko.com/insights/the-crypto-liquidity-concentration-report)

**价格行为特有（A1–A5）**
- **A1 主观形态定义与周期依赖**：结构突破、订单块没有唯一算法，每个定义上的选择都是一个自由参数。[Lo/Mamaysky/Wang](https://www.nber.org/papers/w7613) · [futures.io](https://futures.io/elite-circle/3506-elusive-price-action-how-trade.html)
- **A2 摆动点确认延迟**：摆动点要等右侧 k 根 K 线收盘才能确认，在摆动点自身那根 K 线上行动就是前视。[Pine 重绘][pine-rp] · [LuxAlgo](https://www.luxalgo.com/library/indicator/fcIyc96d-pivot-points-high-low-with-confirm-bar/)
- **A3 事后画出的支撑阻力**：用全图画价位，再用之后的触及次数给价位打分。[LuxAlgo 不重绘 S/R](https://www.luxalgo.com/library/indicator/izNAorFy-support-and-resistance-non-repainting/)
- **A4 止损聚集与扫损级联**：整数关口和明显价位外侧聚集止损，被打掉后行情加速（Osler）。[Osler sr150][osler150] · [Osler sr125](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr125.html)
- **A5 时段与日锚效应**：量和波动按小时变化；24/7 市场的日锚是任意选的。[Baur 等](https://research-repository.uwa.edu.au/en/publications/bitcoin-time-of-day-day-of-week-and-month-of-year-effects-in-retu/) · [Quantpedia](https://quantpedia.com/periodicity-in-cryptocurrencies-recurrent-patterns-in-volatility-and-volume/)

**实盘与部署（L1–L6）**
- **L1 回测与实盘偏离未对账** [QC 对账][qc-rec]
- **L2 纸面交易误导** [Alpaca 论坛](https://forum.alpaca.markets/t/paper-trading-fill-delays-of-50-260-seconds-limit-orders-filled-minutes-after-price-crossed/18223)
- **L3 运营故障无熔断**：Knight Capital 约 45 分钟亏损 4.6 亿美元以上。[SEC](https://www.sec.gov/news/press-release/2013-222)
- **L4 断线重启后状态对账** [Binance WebSocket API](https://developers.binance.com/en/docs/products/spot/web-socket-api)
- **L5 没有预设的衰减或退役规则** [Robot Wealth Cold Blood Index](https://robotwealth.com/a-quants-approach-to-drawdown-the-cold-blood-index/)
- **L6 人工干预覆盖系统** [QuantStart][qs]

[qc-rg]: https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/research-guide
[qc-rec]: https://www.quantconnect.com/docs/v2/cloud-platform/live-trading/reconciliation
[sins]: https://bookdown.org/palomar/portfoliooptimizationbook/8.2-seven-sins.html
[ft-ex]: https://www.freqtrade.io/en/stable/exchanges/
[ft-bt]: https://www.freqtrade.io/en/stable/backtesting/
[ft-la]: https://www.freqtrade.io/en/stable/lookahead-analysis/
[ft-ra]: https://www.freqtrade.io/en/stable/recursive-analysis/
[nt-bar]: https://nautilustrader.io/docs/latest/concepts/backtesting/bar-execution/
[prc-day]: https://prorealcode.com/topic/the-daily-candlestick-is-not-the-universal-daily-candlestick-on-prt-ig
[prc-live]: https://www.prorealcode.com/topic/backtesting-vs-live-trading
[se147]: https://quant.stackexchange.com/questions/147/what-are-the-key-risks-to-the-quantitative-strategy-development-process
[se3225]: https://quant.stackexchange.com/questions/3225/tests-that-any-system-must-pass-to-be-taken-seriously
[se85698]: https://quant.stackexchange.com/questions/85698/how-to-validate-statistical-significance-for-a-low-frequency-crypto-strategy-n%e2%89%88
[bn-margin]: https://www.binance.com/th/support/faq/360033162192
[bn-fund]: https://www.binance.com/en/support/faq/introduction-to-binance-futures-funding-rates-360033525031
[chan]: https://cmtassociation.org/wp-content/uploads/2024/01/erniechan-020211-1.pdf
[rw]: https://robotwealth.com/backtesting-bias-feels-good-until-you-blow-up/
[pine-rp]: https://www.tradingview.com/pine-script-docs/concepts/repainting/
[qp-ml]: https://quantpedia.com/why-machine-learning-funds-fail/
[qp-888]: https://quantpedia.com/quantopians-academic-paper-about-in-vs-out-of-sample-performance-of-trading-alg/
[qs]: https://www.quantstart.com/articles/Successful-Backtesting-of-Algorithmic-Trading-Strategies-Part-I/
[pbo]: https://papers.ssrn.com/abstract=2326253
[dsr]: https://papers.ssrn.com/abstract=2460551
[ahm]: https://papers.ssrn.com/abstract=3275654
[et-wfa]: https://elitetrader.com/et/threads/backtesting-without-proper-wfa-is-mostly-just-curve-fitting.390792/
[lo]: https://rpc.cfainstitute.org/research/financial-analysts-journal/2002/the-statistics-of-sharpe-ratios
[cxo]: https://www.cxoadvisory.com/technical-trading/evidence-based-technical-analysis-applying-the-scientific-method-and-statistical-inference-to-trading-signals-chapter-by-chapter-review
[dm]: https://www.nber.org/papers/w20439
[qr]: https://www.quantrocket.com/codeload/quant-finance-lectures/quant_finance_lectures/Introduction.ipynb.html
[mudrex]: https://mudrex.com/learn/why-crypto-futures-liquidated-despite-stop-loss/
[rsb]: https://arxiv.org/abs/1707.01457
[fti]: https://www.fticonsulting.com/insights/articles/crypto-crash-october-2025-leverage-met-liquidity
[osler150]: https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr150.html

## 3. 理想迭代链

**核心原则：**
- 研究是有预算的序贯决策：只有当至少两种可能结果会导致不同动作时，才值得做实验。
- 对 LLM 研究者来说，只有冻结之后才产生的数据能用来确认；更早的数据只能用来探索或证伪。
- 每一个自由选择都算一次试验，证据门槛要随试验数提高。
- 从最便宜、能证伪的层开始测：定义 → 因果实现 → 市场响应 → 可执行优势 → 净账户 → 组合 → 前向 → 实盘。任何一层失败都回到决定环节。
- 先验证测量本身，再做推断；结果好得过头时，先当作 bug。
- 优势只能相对于同引擎、同成本、经过匹配的零假设来衡量，不能相对于 0。
- 数的是独立证据，不是数据行数。
- 无法判定也是有效答案。
- 先冻结再看结果；负结果是资产；作者不给自己打分；可复现就是身份；预算和退役阈值要事先定好。

| 阶段 | 做什么 | 针对的问题类型 |
|---|---|---|
| 1 先验检索与机制假设 | 动手前检索全部旧尝试（含失败和未登记回放）和文献，写下机制、可观测预测、反驳条件；文献效应只当作假设 | P1 P2 P7 R2 B6 |
| 2 决策价值、可行性与预算 | 映射每种结果对应的动作；算设计能达到的上限；按 family 设预算、停止和升级规则；冻结目标和风险限值 | P9 P1 P6 S2 |
| 3 操作定义与因果事件检测器 | 把主观概念写成确定、因果、带“可用时间”的事件目录；备选定义事先列出，每个都计为试验 | A1 A2 A3 A5 B3 D4 S1 |
| 4 时点数据托管与合约登记 | 内容寻址快照、缺口审计、异常标记、时点币池、时点合约条款；资金费和 mark 不完整就让运行失败 | D1–D7 C1 C5 C6 |
| 5 暴露分类与数据角色 | 每个窗口标为已暴露或未见；已暴露的只用于探索和证伪；确认只用发表后才开始的窗口；每次查看都记日志 | B6 S3 R2 P6 |
| 6 预登记与功效检查 | 冻结层级、主响应、参照、窗口、成本和撮合模型、至多一个网格、最小事件数、结果映射、读取器哈希；事先算功效 | P1 P4 P6 S2 S3 S4 S5 D1 |
| 7 因果实现与完整性（L2） | 强制因果时钟；截断检验、延迟一根检验、流式结果等于批量结果、预热不变性；运行不变量；独立复算；封装身份 | B1–B5 D4 A2 A3 C5 P3 P5 |
| 8 事件研究对匹配零假设（L3） | 和匹配的随机时点、反向事件、打乱时间比较事件后的响应；按聚集情况计有效样本；按行情和时段拆开看；触及不算盈亏 | S5 S4 S6 S7 R1 A1 A4 A5 |
| 9 执行设计与撮合真实性（L4a） | 限价单穿价才成交；止损按更差的价格成交；扫描延迟；按时点规则校验订单；同根歧义给出上下界 | M1–M5 E2 A4 C2 |
| 10 净账户经济与归因（L4b） | 时点费率、原生资金费、按流动性分档的滑点、分档保证金和强平；拆出毛信号、执行、各项费用；对 beta 和 carry 做归因；指出哪个部分失败 | E1 E2 C1 C2 C6 D6 S6 K3 |
| 11 稳健性与选择校正推断 | 网格全曲面与平台规则；消融；跨 family 和目标计试验数；DSR、PBO、SPA；逐币留一；行情切分 | S1 S2 S4 S7 P4 R1 R2 D1 D2 A5 K3 |
| 12 定仓、回撤与尾部压力 | 用打过折扣的优势估计来定仓；块自助法得到回撤分布；命名的压力窗口、宕机和 ADL 情景；导出监控阈值 | K1 K2 K3 C2 C3 C4 A4 |
| 13 决定、负结果记忆与跨假设学习 | 按预登记的映射做决定，写明失败层和失败部分；更新试验计数和预算；部分合并相关效应，复用基率 | P2 P6 P7 P9 S2 |
| 14 独立对抗式冻结审阅 | 干净上下文的审阅者只拿固定 ID，用问题清单攻击结论；2–3 个 Agent 复算，不一致就不下结论 | P8 P5 P6 S3 B6 |
| 15 前瞻确认（L5） | 冻结全部身份 → 窗口开始前发表 → 等窗口过去 → 按配方构建数据 → 只跑一次 → 按预登记范围判定 | B6 S3 S4 R2 D3 P3 |
| 16 策略组合构建 | 每个策略一个固定资本账户；按机制族衡量分散度；稳健分配；组合层限额 | K1 K3 S6 S7 |
| 17 分级部署与实盘一致性 | 纸面交易只用来测管道；比较实盘和回放的指标；订单预检；需要用户授权并具备运营控制 | L2 D7 B4 M5 C4 |
| 18 实盘对账、衰减与退役 | 每个实盘期配一次回放并归因差异；按预登记阈值监控；记录人工干预，并保留不干预的影子账户 | L1 L5 L6 R2 K2 |

L3（熔断与运营控制）和 L4（断线对账）属于交易与运营层，研发链只在阶段 17 把它们当作晋级门槛。

## 4. 覆盖映射

### 表 A：阶段覆盖（15 个部分覆盖，3 个缺失，0 个完整覆盖）

| 阶段 | 状态 | 现设计已有 | 主要缺口（对应发现） |
|---|---|---|---|
| 1 先验检索 | 部分 | `find` → `show --brief`；计划写机制、激活事件和反驳观察；research-sources 要求三种措辞并记查询日志 | `find` 要求全部词命中且只能单语言；文献材料不能检索；无查重（M18） |
| 2 决策价值与预算 | 部分 | 结果映射至少 2 个动作；可达性算术；family 预算；三次失败后做进展检查；目标冻结 | 按 goal_id 计数，可被重置（M06）；不检查胜率带和收益几何是否兼容（M16）；不检查能否分辨（M20） |
| 3 定义与事件检测 | 部分 | 命名了 L1/L2；有因果时钟规则；E01 显示原生小时 K 线与 5m 派生结果完全一致 | 定义变体不计试验（M15）；无流式和批量一致性检查；Swings 语义与社区不同（M09） |
| 4 时点数据托管 | 部分 | 输入身份哈希；只读挂载并在运行前后哈希；收据区间等于回放区间；5m LAST/MARK 和资金费不完整就失败；合约条款必须标注为近似 | 只有一个 Catalog，没有配方（M01）；没有时点币池（M14）；没有异常标记（M12）；没有流动性度量；1m 数据用不上 |
| 5 暴露与数据角色 | 部分 | `known_exposure`；截止前的窗口只能探索；禁止给已看过的窗口改名；代码检查 independent 等级 | `run_refs` 手填；发表前的读取不算查看（M08）；Git 时期的暴露没有计入（M06） |
| 6 预登记与功效 | 部分 | 先发表 pending attempt；合同冻结；有 preregistered/retrospective 状态；溯源审计见证时间 | 没有功效或 MDE 检查（M20）；没有可靠的试验计数（M06、M07） |
| 7 因果实现（L2） | 部分 | BacktestNode 按收盘时间戳；拒单即失败；通用审计；seal 绑定 SHA、镜像、输入和配置；`tables()` 对账 | 审计不证明信号时钟；无截断、延迟或预热检查流程（M09）；宿主读取有陷阱（M13） |
| 8 事件研究（L3） | 部分 | l3-boundary 要求预登记 horizon 和参照；零结果只关闭该定义；触及不算盈亏 | 参照不匹配（M05）；忽略事件聚集（M04）；没有行情切分（M03）；没有 L3 层（M10） |
| 9 撮合真实性（L4a） | 部分 | 原生 OTO 加 OUO、GTD、止盈先于止损激活；同根歧义先报告、不排序 | 触及即成交、止损按触发价、零延迟、零滑点（M02）；固定高先路径（M11） |
| 10 净账户与归因（L4b） | 部分 | maker/taker 按实际成交收费；资金费原生结算并单列；报告拆出价格、佣金和资金费 | 无成本加压和盈亏平衡读数（M02）；无 beta 分解（M03）；已登记 seal 都没有 exposures（M22） |
| 11 稳健与选择校正 | 部分 | 一个预登记网格，每格计试验；DSR 作为诊断；`compare --analysis` 用周块自助法 | N 和 Var(SR) 没有定义（M07）；窗口外检验做不了（M01）；网格的执行路线没有文档（M21） |
| 12 定仓与尾部 | 部分 | 100k 固定资本、杠杆 1、每笔风险 25bp、单币名义上限 5%；原生 MaxDrawdown；5m 估值 | 2025-10-10/11 级联落在预热期（M12、M26）；没有组合热度读数（M24） |
| 13 决定与负结果记忆 | 部分 | 追加式决定、失败部分、进展检查、谱系、产品发现 | L3 否证被记成 execution/passed（M10）；跨目标的试验数无法推导（M06） |
| 14 冻结审阅 | 部分 | 有干净上下文审阅流程，未决项会阻塞，2–3 个 Agent 复算 | 从未运行过；清单缺项；没有校准用例（M17） |
| 15 前瞻确认（L5） | 部分 | 确认流程五步；代码只给发表后的窗口 independent 等级 | 没有窗口数据配方（M01）；没有预期事件数（M20）；没有窗口内退市规则（M14） |
| 16 组合构建 | 缺失 | 架构规定多逻辑共享资本时做成一个组合策略 | 有两个以上确认策略之前不需要 |
| 17 分级部署 | 缺失 | 范围外，需要用户授权实盘 | — |
| 18 实盘对账与退役 | 缺失 | 范围外 | — |

### 表 B：问题类型覆盖

合计：**已覆盖 9、部分覆盖 33、缺失 10、范围外 6**。分组情况：数据 2/4/1/0，偏差 1/4/1/0，统计 1/6/0/0，执行 0/1/1/0，微观结构 0/2/3/0，行情 0/2/0/0，流程 4/5/0/0，风险 0/3/0/0，加密 1/3/2/0，价格行为 0/3/2/0，实盘 0/0/0/6（依次为覆盖/部分/缺失/范围外）。

| 类型 | 状态 | 缺口（对应发现） |
|---|---|---|
| D1 幸存者/币池 | 部分 | 只有披露；没有时点币池和退市合约；决定的范围不要求写明（M14） |
| D2 坏价与影线 | 缺失 | 只查覆盖不查值；10-10 级联在预热期内，但仍锚定了窗口内的计划（M12） |
| D3 缺失与修订 | 覆盖 | 旧下载器的缺口处理需要在 W7 重下时比对（M01） |
| D4 时间戳与日界 | 部分 | 宿主读取器的分组换算容易错一根（M13） |
| D5 复权与拼接 | 覆盖 | 宿主读取器有 1000x 别名陷阱（M13） |
| D6 交易规则时点 | 部分 | 用户 10-10 决定不做条款快照；没有小币最小名义的敏感性指引 |
| D7 研究与实盘数据 | 部分 | 实盘比对在范围外 |
| B1 同根前视 | 覆盖 | 没有延迟一根的扰动检验 |
| B2 全样本统计 | 部分 | 宿主读取器没有截断检查（M09、M13） |
| B3 高周期重绘 | 部分 | 没有流式和批量、截断一致性流程（M09） |
| B4 预热与历史长度 | 部分 | 起点被收据固定；长回看指标需要在文件内门控（M09） |
| B5 ML 泄露 | 缺失 | 对拟合常量没有规则（M29） |
| B6 后见之明 | 部分 | 发表前的读取不计（M08）；Git 时期的暴露不计（M06） |
| S1 参数过拟合 | 部分 | 无自由度对事件数检查；网格路线没有文档（M21） |
| S2 多重检验 | 部分 | N 和 Var(SR) 没有定义（M07）；按目标计数（M06） |
| S3 留出污染 | 覆盖 | 偷看问题见 M08 |
| S4 功效不足 | 部分 | 没有 MDE 和最小事件数（M20） |
| S5 零假设/基准 | 部分 | 参照不匹配；从未跑过随机或买入持有对照（M05） |
| S6 beta/carry | 部分 | 资金费已单列；没有 beta 分解（M03） |
| S7 相关品种合并 | 部分 | L3 没有聚集规则（M04） |
| E1 费用 | 部分 | 费率档不按日期；没有成本加压和盈亏平衡读数（M02） |
| E2 滑点与容量 | 缺失 | 没有滑点、参与率和容量曲线（M02） |
| M1 K 线内路径 | 部分 | 固定高先路径没有按方向报告（M11）；1m 数据用不上 |
| M2 限价乐观成交 | 缺失 | 触及即成交，B03 中涉及的周期占闭仓净值 8.7%（M02） |
| M3 止损按触发价 | 缺失 | 516 笔止损全部按触发价成交（M02） |
| M4 时延 | 缺失 | 市价单按上一根收盘价零延迟成交（M02） |
| M5 交易所规则 | 部分 | 用当前条款快照；拒单直接让运行失败，而不是作为一种结果统计 |
| R1 行情依赖 | 部分 | 只有一个熊市年；没有行情切分（M03、M01） |
| R2 衰减与结构变化 | 部分 | 没有结构变化日历 |
| P1 编故事 | 覆盖 | — |
| P2 试验登记 | 部分 | Git 时期缺席；检索依赖语言；L3 否证不可见（M06、M10、M18） |
| P3 复现 | 覆盖 | 新数据需要配方（M01） |
| P4 扫描管理 | 部分 | 不存全曲面；网格路线（M21） |
| P5 bug 制造好结果 | 部分 | 没有“好得过头”的触发机制；宿主读取陷阱（M13） |
| P6 事后微调 | 覆盖 | 偷看问题见 M08 |
| P7 研究蔓延 | 覆盖 | 读取器每次都重写（M13） |
| P8 独立审阅 | 部分 | 从未运行；清单缺项（M17） |
| P9 预算与停止 | 部分 | 换 goal_id 会重置计数（M06） |
| K1 过杠杆 | 部分 | 有候选之前不需要按折扣定仓 |
| K2 回撤与尾部 | 部分 | 级联在预热期；没有压力窗口（M12、M26） |
| K3 集中与相关 | 部分 | 没有组合热度读数（M24） |
| C1 资金费 | 覆盖 | — |
| C2 强平与 mark/last | 部分 | 强平关闭；MARK 触发的止损无法回放（M26） |
| C3 ADL/脱锚 | 缺失 | 只有对冲组合才需要（M26） |
| C4 宕机 | 部分 | 保护单原生挂在交易所；没有不可用窗口（M26） |
| C5 合约生命周期 | 部分 | 没有退市和更名事件；宿主别名陷阱（M13、M14） |
| C6 薄流动性 | 缺失 | 没有价差和深度数据（M02） |
| A1 主观定义 | 部分 | 变体不计试验（M15） |
| A2 摆动点确认 | 部分 | 没有按确认时间打戳的规则；Swings 语义（M09） |
| A3 事后 S/R | 部分 | 宿主构建的价位没有“可用时间”规则（M09） |
| A4 止损聚集 | 缺失 | 没有盘口和强平数据，需要声明价格代理（M25） |
| A5 时段与日锚 | 缺失 | 没有按小时的读数；时段过滤已经计入试验（M03） |
| L1–L6 实盘 | 范围外 | 授权实盘时再做 |

## 5. 十轮模拟摘要（模拟）

**先看真实历史（非模拟）：**
- **Git 时期**：约 50 个 H 编号、101 个 D 诊断，约 25 个候选跑完 37 币全年回放，联合目标一次都没达到。H01 年化 23.24%，但胜率只有 36.6%，而且靠放大风险；H27a 胜率 62.25%，年化只有 7.90%。
- **Dolt 新台账（10-09，约 5 小时）**：27 个 attempt，12 个 economics 决定全部 failed，没有一个超过原点 B00/B03（年化约 12.0%、胜率 42.74%）。8 个配对区间全部跨零。经济诊断 D09 是在第 12 次经济失败之后才登记的（历史 I01、I11）。
- **10-10 之后**：做了审计和 #1490–#1506 的修补，此后唯一的研究 attempt 是 D10。当前镜像 ffd4687f 上没有任何已登记的 run。
- **已关闭的历史问题**：I07（原生执行缺陷，已修复）和 I16（资本口径误读，#1506 已加 exposures）。其余 16 条仍未解决，已并入第 6 节。

两次模拟都是只读的。标“校准”或“探查”的数字来自对已有 seal 和 Catalog 的只读读取，其余结果都是模拟出来的。

### 族 A：支撑阻力加回调限价和原生括号单（日志 `~/.local/share/trade/research-audits/20261011-rd-loop-simulation/sr-pullback.md`）

| 轮次 | 问题与层级 | 模拟结果 | 决定 | 主要摩擦 |
|---|---|---|---|---|
| R1 | 支撑阻力这个想法能预测什么，能否达到目标（L1，只做规划） | 文献给出可检验的预测和人工价位零假设（Osler 2000）。库内没有通用 S/R 对照检验。达到收益目标所需胜率 45.9%，B03 实际 42.7%（校准） | 不发表；冻结 4h k=8 确认枢轴的定义 | `find` 中英文召回不同；目标不是记录；文献笔记不能检索 |
| R2 | 原生实现是否因果，事件数多少（L2，无单诊断） | 0 次时钟违规，约 5,150 个首次触及；宿主读取器 v1 有约 4% 事件错一根，v2 后 100% 一致 | execution/passed | 截断和起点检验只能在宿主做；无单导出也要走全套托管；`run_refs` 要手填 27 个以上 |
| R3 | 确认的 S/R 区被首次触及后，反转是否多于人工价位（L3） | 支撑 −2.4pp [−6.0, +1.1]，阻力 +1.5pp [−2.2, +5.0]；各月 up-first 比例在 35%–66% 之间，跟着行情走 | 在本窗口关闭通用定义；记为 execution/passed | 没有 L3 层；逐事件区间窄一半，会造成假显著；没有人工价位和去漂移规则 |
| R4 | B03 的回撤档位与随机比例对比，并统计计划生命周期（L3） | A 部分 +0.8pp [−3.5, +4.9]。B 部分（校准）：5,878 个父单中 880 个成交（15%）；516 笔止损全部按触发价成交 | execution/passed | 默认撮合下“触及未成交”这一类为空；`tables()` 的时间格式陷阱 |
| R5 | 在 ffd4687f 上重建对照，读取资本占用（工程） | 经济结果完全一致；平均 12 个持仓，峰值 29 个，约 7% 权益同时处在止损风险下（按计划预算估算） | 登记为对照 | 重封要单独开 attempt；没有组合热度读数；`account.csv` 有 206MB |
| R6 | 对照能否和 8 个随机档位种子区分开（L4 基准） | 种子结果 104.9k–113.6k，对照 111.36k，排第 6/9 | economics/inconclusive | `compare` 拒绝不同标签的配对；没写种子算不算试验；约 45 条命令 |
| R7 | 改成穿价才成交、加止损滑点后结果是否还在（L4） | 约 109.6k，下降约 1.7k，区间 [−3.4, +0.2] 跨零；止损滑点 5/10/20bp 分别减少 0.6/1.3/2.6k | economics/inconclusive | 撮合模型固定在镜像里；一年数据功效不够 |
| R8 | k=6/10 网格是否有平台（L4 稳健性） | k6 +4.2k，k10 +9.0k，中心 +11.36k；k6 低于中心的一半，没有平台 | economics/failed | 网格格不能和中心配对；用标签当参数没有文档 |
| R9 | 有效试验数、DSR、能否冻结（审阅） | N 在 40–60 之间，DSR 0.25–0.41；各季度（校准）−6.0k/−2.0k/+3.8k/+15.3k；审阅者的未决项阻止冻结 | 不能冻结 | DSR 的输入没有定义；没有子期检验；没有校准用例 |
| R10 | 接下来做前向确认、历史证伪，还是停止（L5 规划） | 没有可以冻结的候选 | 停止是有效结果；三个选项交给用户 | 确认需要新下载器和日历等待；幸存者偏差无法检验 |

**核查后的更正：**
- R4 和 R7 所称“触及即成交的仓位约占净值 13%”是按成交重复计数得到的。按周期计算应为 39 个周期净 989 USDT，占 8.7%（M02）。
- R7 所称“14 个同根持仓全是多头，说明高先路径有偏”不成立：B03 本身只做多，而且这 14 个都是止损出场（M11）。
- R2 中 v1 读取器出错的原因被写反了：按收盘前 1ms 的时间戳 floor 分组其实是对的，是 +1ms 或减去 K 线长度这两种换算出错（M13）。

### 族 B：波动收敛后的结构突破、回踩确认和扫流动性反转（日志 `~/.local/share/trade/research-audits/20261011-rd-loop-simulation/breakout-structure.md`）

| 轮次 | 问题与层级 | 模拟结果 | 决定 | 主要摩擦 |
|---|---|---|---|---|
| R1 | 什么算“收敛后突破”，有哪些先例和文献（L1） | 真实 `find` 结果：本窗口已有 5 个突破类经济失败（C04、C05、C07、C10、C12）。`compression` 命中 0 条，`收敛` 命中 C12、D08。文献显示加密技术规则的样本外效果会缩水 | 冻结定义，不发表 | 目标只存在于文字里；`find` 依赖语言；`run_refs` 手填 |
| R2 | 枢轴、BB 百分位、唐奇安在截断数据上是否一致（L2） | 首稿把分形枢轴标在它自身那根 K 线上，6–8% 的事件不一致，修正后为 0。4h 的 BB(250) 需要约 42 天预热。真实探针显示 rc3 的 Swings 是运行中极值的跟踪器 | execution/passed | 没有前视和预热检查流程；改 trade_start 会破坏配对 |
| R3 | 事件数量、聚集度和可行性（L2 容量） | 探查结果：1h 每年 6,210 个、4h 每年 1,674 个；51% 和 55% 的事件发生在至少 5 个币同时突破的时刻；有效币数约 1.5；需要约 0.17 ATR 的毛响应 | 写下 L3 门槛；把胜率冲突交给用户 | 可行性检查不比较胜率带和收益几何；聚集没有计入 N |
| R4 | 响应能否比随机时点高出 0.17 ATR（L3） | 探查（探索性）：1h h4 +0.03 [−0.08, +0.14]，4h h24 +0.35 [−0.45, +1.41]；逐事件 t 值会给出 +2.3 和 −4 两个假显著 | 关闭 1h；4h 只做一个机制读数候选 | 没有聚集规则；预登记前的读取不计；没有 L3 层 |
| R5 | 4h 候选与匹配随机对照比较（L4） | 候选约 +4.2%/年，胜率约 39%；随机对照约 −8.7%；差 +12.9pp [−7, +34] | economics/failed：每周期毛优势约 0.11R，成本约 0.03R | 没有随机对照配方；要先在新镜像上重封 B03；没有滑点模型；约 45 条命令 |
| R6 | 盈利是突破响应，还是多头 beta 集中（L4 描述） | 4 月和 8 月贡献约 125% 的净值；多头 +8.1k，空头 −3.9k；前 5 个币占约 80% | 不在本窗口继续细化 | 做不了子期和前推；没有 beta、集中度、蒙特卡洛的配方 |
| R7 | 扫流动性后反转有没有响应（L3） | 探查：1h h24 −0.05 [−0.29, +0.19]，4h h24 +0.11 [−0.27, +0.46]，低于门槛 | 关闭该定义 | 只能用价格代理流动性；关闭后显示为 execution/passed |
| R8 | 回踩确认能否改善结果（L4 父子比较） | 胜率从 39% 升到 46%，净值转为约 −0.9% | economics/failed（第 2 次） | 父子不能配对；胜率带会奖励这类变体 |
| R9 | 按 BTC 4h 方向做门控（L4 组合） | 约 +2.6%/年；与带门控的随机对照相比 +6pp [−12, +25] | economics/failed（第 3 次），触发进展检查 | 跨品种门控没有文档；同一时间戳的回调顺序没有定义；门控来自已经看过的结果 |
| R10 | 进展检查和停止审阅 | 排除了 1h 延续、扫损反转、“回踩提高净值”三个解释；最佳 Sharpe 约 0.7，DSR 约 0.1 | 在本窗口停止族 B；提出 W7 和可选的前向确认 | 计数按目标而不是按窗口；DSR 和 PBO 要手算；只有单区间 Catalog |

**核查后的复算：**用 `~/.local/share/trade/research-audits/20261011-rd-loop-simulation/m04/verify.py` 复算的聚集比例为 51.0% 和 55.3%，逐事件 t 值为 +2.32 和 −3.97。按周块重抽，4h h24 为 +0.35 [−0.47, +1.31]，所有区间都跨零。

## 6. 问题清单（按严重度，严重度采用核查后的校正值）

### 一、导致研发失败（阻塞确认和跨窗口检验）

**M01 只有一个已准备的窗口，没有可复用的数据配方**（原评“阻塞研发”，校正为“降低研发能力”）
- **问题**：所有原生回放都绑定在 `r1-37-1y-5m-2026oct7`（2025-10-07 至 2026-10-07 08:30）上。窗口内可以用 `--trade-start` 切子期，但这样只能证伪；窗口之外的更早历史、其他行情和前向确认窗口都跑不了。旧 `prepare.py` 依赖一个打过补丁的私有 Nautilus，而固定版本 rc3 下载不了历史 MARK K 线和资金费，所以把旧文件恢复回来也没有用。W6 和 W7 用户已经批准，但都还没建。现在没有候选进入冻结，所以今天还不阻塞；第一个需要确认或跨行情检验的问题会卡在这里。
- **证据**：`backtest/r1/replay_inputs.py:40-47`；`~/.local/share/trade/catalogs` 下只有一个 Catalog；28 个 seal 的 `start` 都是 2025-10-07、`trade_start` 都是 2025-10-17；`docs/plans/agent-rd-methodology-plan.zh.md:169,221-222,265-266`；Sim A SR-I05/SR-I16，Sim B B09；历史 I04、I13。
- **最小修复**：按计划第 222 行执行 W7。先向用户列出文件和体量；然后用 Binance 公共数据写外部配方，重下当年一个月（BTC、1000PEPE 和一个 4h 资金费币）逐事件比对，输出独立的单区间 Catalog；在配方里加时点币池和退市说明；同一份配方复用于 W6。
- **修复方式**：外部配方（Agent 流程），需要用户确认文件清单和体量。

### 二、可能得出错误结论

**M04 L3 推断忽略跨币和时间上的聚集**（保持原评）
- **问题**：1h 有 51%、4h 有 55% 的收敛突破发生在至少 5 个币同时突破的时刻，有效独立币数只有约 1.5–2.3。逐事件 t 值分别是 +2.32 和 −3.97，但按周块重抽后区间都跨零。`l3-boundary.md:6-10` 没有说明“无法区分”该怎么判断。唯一的重抽工具在 `compare --analysis` 里，只能处理配对的账户日收益。
- **证据**：`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/b_ground2.json.pool.pkl`；`research/records/analysis.py` 的 `_paired`（行 43-46、496-516）；Sim A SR-I02，Sim B B01；社区做法见 Brown & Warner 1985、Kolari & Pynnönen 2010、Petersen 2009。
- **最小修复**：在 `l3-boundary.md` 中写明：
  - 同一时间戳的事件和相关的币视为一个依赖簇；
  - 用覆盖全部币的连续时间块重抽，块长不短于最长的预登记 horizon（horizon 小于一周时可以用自然周）；
  - 事件行和参照行从同一组块中抽取；
  - 报告块数、事件里同时涉及至少 5 个币的比例，以及有效 N 的代理值；
  - 禁止引用逐事件标准误、t 值或二项区间。
  
  另外补一个回归 eval。
- **修复方式**：skill 文本加 eval。

**M05 L3 和 L4 没有匹配的零假设或基准**（保持原评，影响限于归因）
- **问题**：
  - L3 的参照不要求按品种、UTC 小时和波动率匹配，也没有人工价位这种零假设（Osler 2000）。
  - L4 完全没有随机入场、同几何对照或买入持有基准。
  - 怎么构造可以配对的随机对照没有写：`compare` 要求有效配置相同（包括标签和 trade_start），而 `strategy-authoring.md:35-37` 还在引用已删除的 TIER_RATIOS。
  - v138 中没有任何记录用过随机或基准参照。
  
  后果是：通过的候选可能被错误归因到信号上；但这不影响对绝对目标的通过或失败判断。
- **证据**：`l3-boundary.md:8-10`；`research/records/cli.py:490-492`；`backtest/r1/run_portfolio.py:154-172`；在 v138 上 `find --text` 搜 random/随机/benchmark/buy-and-hold 都是 0 条；Sim A SR-I06，Sim B B06；历史 I12。
- **最小修复**：
  - 在 `l3-boundary.md` 中要求参照按品种和 UTC 小时匹配、以波动率为单位、扣除漂移，并允许人工价位这类零假设。
  - 在 `strategy-authoring.md` 中删掉 TIER_RATIOS 那句，写明对照必须接受候选的标签和 trade_start。
  - 补一个匹配随机入场的配方：同几何、同标签、同事件率、固定种子、独立 attempt，并先登记为 control。种子分布只是描述性读数，不算试验。
  - 把等权买入持有或 BTC beta 作为描述性基准。
- **修复方式**：skill 文本。

**M13 宿主读取 Catalog 的静默陷阱**（保持原评，仅限 Catalog 一侧）
- **问题**：skill 要求 L3 诊断读“和 seal 输入身份一致的 K 线”，但没说怎么读。有三个静默陷阱：
  - 用 `{coin}USDT-PERP.BINANCE` 去查 1000PEPE/1000SHIB，会静默返回零行（F24 曾因此得出 `all_exact=true`）。
  - `query_bars([instrument_id])` 返回的是 LAST 和 MARK 交错的数据。
  - 5m K 线的时间戳是收盘前 1ms，按 `floor(ts_event)` 分组才是对的；+1ms 会让结果滞后一根，减去 K 线长度会引入前视。
  
  seal 一侧的问题（`tables()` 里时间是文本、列名叫 `type`）只是麻烦，不会导致错误结论。
- **证据**：`r1-native-rd-findings.zh.md` F24；`research/records/analysis.py:58`；`strategy-authoring.md:57-60`；Sim A SR-I11；历史 I06。
- **最小修复**：在 research-round 的 references 里加一节宿主读取说明：
  - 从 `nautilus_trader.persistence` 导入；
  - 合约 ID 从 `catalog.instruments()` 或 `r1-download-complete.json` 取；
  - 按完整的 bar type 查询，并断言每个币的行数不为零；
  - 不要自己解码 parquet；
  - 用 `floor(ts_event)` 分桶，并且只在桶内最后一根 K 线之后才使用该桶；
  - 用一个币核对每个 4h 桶是否有 48 根；
  - 把仓库根目录加入 PYTHONPATH。
- **修复方式**：skill 文本。

**M14 币池幸存者偏差只能披露，不能检验**（保持原评）
- **问题**：
  - 2026 年的 37 币名单被回溯用到 2025。运行器只接受全窗口都有完整数据的品种，所以中途上市或退市的合约跑不了。
  - 这个偏差有方向：做多山寨会显得更好，做空山寨会显得更差。
  - W7 以 TIA（2023-10-31 上市）为起点，会把回溯拉长到约 3 年。
  - `confirmation.md` 没有写确认窗口内有币退市时怎么办；事后把它剔除，会把偏差带进 independent 结果。
- **证据**：`run_portfolio.py:360`；`native_node._prepare_mark_catalog`（158-236）；`agent-rd-methodology-plan.zh.md:64,222`；`find --text` 搜 幸存/退市 为 0 条；Sim A SR-I20，Sim B B20。
- **最小修复**：
  1. L4 和稳健性决定的范围里写明“未检验幸存者偏差”以及偏差方向；`confirmation.md` 要求预登记窗口内退市的处理规则。
  2. W7 用窗口起点时的币池，并报告因中途退市被排除的币。
  3. 以后再让运行器支持部分窗口和原生退市结算（先用探针测 `settlement_prices`）。
- **修复方式**：第 1、2 项是 skill 文本加配方；第 3 项是后续产品代码。

**M17 冻结审阅从未运行，清单漏掉常见失败类别**（保持原评，潜在风险）
- **问题**：冻结审阅是拿到 independent 结论的唯一关口，代码只检查绑定和时间顺序（`confirmation.md:21`、`contracts.py:94`）。`review.md:16-26` 的清单缺少四项：
  - 实证的前视和预热证据；
  - 触及即成交和止损滑点的影响；
  - 37 个相关币情况下的有效样本量；
  - 币池怎样选定、窗口内退市怎么处理。
  
  `review.md:11` 要求先做校准，但没有存任何校准用例。前向确认用的是同一套代码和撮合模型，所以这些问题在确认阶段不会消失。至于“从未运行”，原因是还没有候选走到冻结，不算违规。
- **证据**：`review.md:11,16-26`；v138 台账没有 `independent` 等级的 run，`find --text "freeze review"` 与 `find --text "冻结审阅"` 都是 0 条（只读查询）；`native_node.py:40-60,270-285`；`backtest-result-diagnosis.zh.md:59`；历史 I17。
- **最小修复**：把上面四项加进冻结清单；在 Git 之外存一个已知干净、一个已知有 bug 的校准用例，审阅时引用它们的 ID；按仓库惯例先用 eval 证明这些改动有增量价值。
- **修复方式**：skill 文本加校准用例。

**M02 撮合模型偏乐观，也没有加压方法**（原评“导致错误结论”，校正为“削弱结论”）
- **问题**：venue 没有设置 `fill_model`、`latency_model`、`fee_model`、`queue_position`、`liquidity_consumption`，而 rc3 全都支持。B03 中的实际情况：
  - 881 笔入场里有 40 笔发生在最低价刚好等于限价的 K 线上，涉及的 39 个周期净 989 USDT，占 8.7%；
  - 516 笔止损全部按触发价成交；
  - 31 笔市价单全部零延迟、按上一根收盘价成交；
  - 单笔成交量占 5m 成交量的比例，中位数 0.1%，最大 25%。
  
  在合理的压力下（止损 1 tick 滑点约 −1.7%，费率翻倍约 −8.5%，去掉触及即成交的周期约 −8.7%），B03 的符号不会变，只有结果贴近目标门槛时才可能翻转决定。策略文件本身能测的是“穿价才成交”和“下一根再下单”；滑点和费率测不了。
- **证据**：`native_node.py:41-60,271-285`；`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/m02/verify.py`；`nautilus-report-analysis SKILL.md:78`；Sim A SR-I04，Sim B B10。
- **最小修复**：
  - 在 nautilus-report-analysis 中增加四个读数：触及即成交的份额及其周期盈亏；按触发价成交的止损及跳空情况；成交量占比；盈亏平衡费率倍数，即闭仓 price_pnl 除以佣金（B03 约为 12.7 倍）。
  - 在 research-round 的 L4 部分，把“穿价或下一根下单”的变体与对照配对，作为标准的加压方法。
  - 允许做标注为诊断用途的成本折算。
  - 版本化的压力撮合配置需要新镜像，并由用户决定。
- **修复方式**：skill 文本；压力撮合配置需要用户决定。

**M03 只有一个熊市窗口，却不要求读 beta 和行情**（校正为“中等，误导中间决策”）
- **问题**：
  - 这一年 BTC 跌了 21.0%，37 个币里只有 4 个上涨，日相关性 0.63，第一主成分解释 65%。
  - B03 仅 2026 年 9 月一个月（+15,866）就超过了全部闭仓净值（+11,333），但计划文档第 28 行仍写 B03 “接近目标”。
  - rc3 自带 BetaRatio 和 Alpha，可是没有 skill 要求使用。
  
  集中度、去漂移和时段计试验这几项已经覆盖。
- **证据**：`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/probe/regime.py`、`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/probe/b03stats.py`；`backtest-result-diagnosis.zh.md:49,56`；Sim A SR-I03，Sim B B23。
- **最小修复**：
  - nautilus-report-analysis 增加：用 BTC 和等权篮子（来自同一输入身份的 Catalog）计算 beta 和 alpha；在有趋势的窗口里按月份和方向拆分。
  - research-round 增加一条：单一趋势窗口上得出的结论要在范围中写明所处行情；由一个月或一个方向带来的差异不算机制证据。
  - 先做 eval。去掉日锚和结构断点检查，因为两次模拟都没有支持它们的证据。
- **修复方式**：skill 文本加 eval。

**M06 试验数和进展检查按 goal_id 计**（校正为“中等，削弱防线”）
- **问题**：goal_id 是自由字符串，换一个 goal_id，计数就清零。这已经发生过：Git 时期在同一窗口、同一目标下跑了约 32 个 H 候选和约 95 个 D 诊断，新目标 RONNIE-NATIVE-RD-20261010 从零开始计数。B00 的计划里用文字披露了这一点，但没有变成数字。这会让冻结审阅时的试验数严重偏少，进展检查也可以通过改名来重置。
- **证据**：`SKILL.md:43,58`；`review.md:19`；B00 的 `known_exposure.run_refs=[]`；Sim A SR-I09，Sim B B04；历史 I04。
- **最小修复**：在 SKILL.md 和 review.md 中改为按市场窗口（同一交易所、同一币池、时间重叠）跨所有 goal_id 统计试验和失败，并包含经 `history.json` 找到的 Git 时期候选。新 goal_id 落在已暴露的窗口上时，继承原有计数。目标下的第一个 attempt 要引用目标的来源。
- **修复方式**：skill 文本。

**M08 预登记之前读取窗口价格不算“查看”**（校正为“中等”）
- **问题**：`publish.md:34` 写了“先发表再读”，但逐项披露清单（`SKILL.md:44-45`）只列原生回放。`publish.md:40` 把 registration 写死为 preregistered，`run_refs` 也只能绑定 run。结果是读几秒 Catalog 不留任何痕迹，attempt 看上去仍是预登记的。这不会导致虚假确认，但会少计选择压力。
- **证据**：`SKILL.md:44-45`；`publish.md:34,40,58-59`；`store.py:93-97`；Sim A SR-I19，Sim B B02。
- **最小修复**：第 5 步扩展为也要列出发表前对“事件之后价格”的读取（Catalog、seal 报告或导出），并写明命令和输出路径。说明 retrospective 只用于记录已经读过的结果，不能绑定 `artifacts run`；之后要新开预登记 attempt 并披露这次读取。
- **修复方式**：skill 文本。

**M09 L2 缺少预热、历史长度、指标语义和宿主事件时点的检查流程**（校正为“中等”）
- **问题**：原生回放已经防住了大部分前视（E01 验证过），但仍有几处缺口：
  - 已登记的 run 只有 10 天预热，长回看指标需要在文件里门控，或者用更晚的 trade_start 重封；skill 都没有说明。
  - 历史长度和截断检验无法在原生环境里跑（`replay_inputs.py:40-47`）。
  - 没有提醒先用探针确认指标语义，例如 rc3 的 Swings 不是确认后的分形枢轴。
  - 宿主读取器可能把枢轴标在它自身那根 K 线上。
- **证据**：`seal.md:51-53`；`strategy-authoring.md:55-69`；`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/m09/swings_probe.py`；RD20261010-E01；Sim B B07/B08/B13。
- **最小修复**：
  - 按指标是否就绪来门控，并报告第一次可以做决策的时间；
  - 长回看指标用 `historical_daily_bars` 播种，或者两边一起重封；
  - 结构事件按确认时间打戳；
  - 把指标当作社区概念使用之前，先用探针确认语义；
  - 截断检验用单独的 Catalog 做，可以选用 E01 的无单导出，配合宿主侧重算，并设定容差。
- **修复方式**：Agent 流程（skill 文本）。

**M12 不筛查异常 K 线，最大的尾部事件落在预热期**（校正为“中等”）
- **问题**：
  - 2025-10-10 21:15–21:20 UTC 这根 K 线，是 37 个币全年最大的 5m 振幅，但它落在预热期，不进入任何尾部或回撤读数。
  - 它仍然影响窗口内的交易：B00-37 中有 31 个币的 89 个计划把锚定在级联低点上，其中 34 个成交。
  - 这些都是真实成交价，不是坏 tick。按 LAST 触发止损是 Binance 的默认行为（F73–F75）。
  
  所以问题在于披露和归因，而不是数据损坏。
- **证据**：28 个 seal 的 manifest；`native_node.py:158-219`；`agent-rd-methodology-plan.zh.md:169`；`r1-native-rd-findings.zh.md` F73、F75。
- **最小修复**：做一个保留为配方的流程：标出 LAST 振幅或 LAST 与 MARK 偏离超过 k×ATR 的 K 线，报告触及或锚定在这些 K 线上的交易和盈亏；在范围中写明级联落在预热期，并列出被它锚定的计划。
- **修复方式**：Agent 流程（配方）。

**M15 定义变体不计为试验**（校正为“中等”）
- **问题**：
  - 价格行为概念没有唯一算法：D24 找到 18 条候选线，D30 有 8–9 个候选低点，D41 的 8 个低点中有 4 个与画面吻合；S46 更正过的来源误归因，曾让 H27a 只测到研究者自己的代理规则。
  - skill 没有要求先列出备选定义并计为试验（同一个修订内用不同 signal_variant 的变体、只读扫描都会漏计），也没有要求把来源无法确定的规则标为研究者代理。
- **证据**：`r1-native-rd-findings.zh.md` F23、F30、F37、F38；D02/D04/D06 均为 source/failed；`SKILL.md:23-24`。
- **最小修复**：在 L1 下加一两句；把 review.md 的计数单位改为“源码版本和配置”。
- **修复方式**：skill 文本。

### 三、拖慢研发

**M07 有效试验数、DSR、PBO 没有定义输入**（校正为“增加迭代成本”）
- **问题**：没有规定哪些 run 计入 N、Var(SR) 从哪里估。以 B03 为例，取 SD(SR)=0.6 时 DSR 为 0.25，取 0.4 时为 0.41。本例两个值都远低于 0.95，不影响决定；但遇到强候选时会跨过 0.95，几个复算者之间会出现分歧。
- **证据**：`review.md:19-20,28-29`；`backtest-result-diagnosis.zh.md:28-29,238`；Sim A SR-I10，Sim B B15。
- **最小修复**：
  - N 计入同一窗口上行为不同的候选，包括失败的、未登记的和存档的；排除零假设种子，以及经济结果完全相同的重跑（例如 B01–B03 对 B00）。
  - 报告 DSR 时给出一个范围，而不是单个值。
  - PBO 只用于预登记的、至少 20 个配置的族。
  - 先做 eval。
- **修复方式**：skill 文本加 eval。

**M10 L3 和诊断结果没有层级约定**（校正为“增加迭代成本”）
- **问题**：`decision.layer` 只有 source/data/execution/economics 四个值。L3 否证、归因读数和多部分诊断都没有约定；D10 的 A、B 两部分被合在一起记为 execution/passed。因此 `find --failure-layer` 列不出已经关闭的市场响应定义。
- **证据**：`contract attempt` 的 schema；在 v138 上 `find` 显示 D01、D03、D05、D08–D10 都是 execution/passed；`publish.md:84-86`；`agent-rd-methodology-plan.zh.md:258`；Sim A SR-I01，Sim B B03。
- **最小修复**：在 publish.md 里加一张映射表：
  - L1 → source；L2 → execution。
  - L3 诊断 → execution，并且不计入进展检查；无法区分记为 failed，可以区分记为 passed，测量无效记为 inconclusive。
  - L4 → economics；网格没有平台记为 economics/failed。
  - L3 的 primary_response 以 `l3_` 开头。
- **修复方式**：skill 文本。

**M16 联合胜率目标没有和收益几何比对**（校正为“浪费运行”）
- **问题**：不考虑漂移时，2R 设计先到达目标的概率约为 33%，真实的 C04、C05 胜率是 35–36%，而 58–62% 的胜率带比这高 20–25 个点。计划第 28、234 行已经注意到这一点，但没有写进 `feasibility.md`。
- **证据**：`feasibility.md:6-26`；`agent-rd-methodology-plan.zh.md:28,234,274`；Sim B B05；历史 I02。
- **最小修复**：用公式 W=(required_net/N+(1−p)L)/p 算出胜率带边缘对应的盈亏比，再和计划的几何以及 1/(1+R) 比较。如果明显到不了，就改用机制读数作为主响应，并在范围里写明“不测联合目标”。不需要问用户哪个目标优先：用户 10-10 已经决定两者都保留。
- **修复方式**：skill 文本。

**M18 先前工作和文献难以重新找到**（校正为“增加迭代成本”）
- **问题**：`find --text` 要求每个词都作为子串出现在文本里。`support` 和 `支撑` 各自都只找到一部分；`support 支撑` 合在一起只返回 D06。#1497 之后，保留的文献材料无法按文本检索。`run_refs` 也不会累积：C12 有 25 个，它的子记录 D09 只有 4 个。
- **证据**：`store.py:274-280,346`；`dolt-schema-content-audit.zh.md:90`；`skill-product-form-audit.zh.md:207,216`；Sim B B18；历史 I10。
- **最小修复**：
  - 每个新 attempt 之前，都用英文、中文和至少两个同义词分别检索，取并集写进计划。
  - 把 DOI 和 review_evidence ID 写进计划文本。
  - `run_refs` 取父记录的并集再加上新的 run。
- **修复方式**：skill 文本。

**M19 方法论修补只在合成评测中验证过**（校正为“降低信心，中等”）
- **问题**：D10 之后再没有真实研究轮，v136–v138 只给已有记录附加了视频。验收也不完整：
  - 触及非盈亏的留出用例只有 1/3 通过；
  - stability-before-freeze 没有留出用例；
  - 没有评测 Codex；
  - nautilus-report-analysis 没有留出集，且 #1506 之后的文本从未评测；
  - 过程审计还没有做成配方。
  
  这些都已经列在 `skill-product-form-audit.zh.md` §11 第 4 项和 §12。
- **证据**：同上；`aggregate-result.json`；`agent-rd-methodology-plan.zh.md:241`；历史 I18。
- **最小修复**：按已有计划补齐评测；跑一轮真实研究后，按 skill 规则逐条审计已发表的记录，并把这个审计保留为配方。
- **修复方式**：Agent 流程；跑真实研究轮需要用户恢复研究目标。

**M20 跑配对之前不检查能否分辨**（保持“拖慢研发”）
- **问题**：C11 对 B03 的区间是 [−41.8, +36.8]，8 个配对区间全部跨零。C 系列对 B03 的周差标准差为 2.2–3.2%，80% 功效下的最小可检测效应约 45–65pp，而父链上的改良只有 +3 到 +5pp。确认阶段已经有预登记范围和单次读取，缺的是预期事件数。
- **证据**：`compare C11-37 B03-37 --analysis`；`dolt-rd-second-audit.zh.md:32`；`r1-native-rd-findings.zh.md:625`；`confirmation.md:9,18-19`；Sim A SR-I15；历史 I13。
- **最小修复**：
  - 在 feasibility.md 中，用最近一次同类配对的区间半宽（机制被替换时用 1.96·√(var_c+var_b)·52/√weeks）和合理效应做比较。效应小于半宽时，改用可以分辨的主响应，或者写明结果只能是 inconclusive。注意要用配对差的方差，不能只用对照的方差。
  - 在 confirmation.md 中写出窗口的预期事件数，以及低于多少就判为 inconclusive。
- **修复方式**：skill 文本。

**M21 网格、种子和父子改良没有便宜的配对路线**（保持）
- **问题**：
  - 代码其实允许一个修订、一个 attempt 下用不同标签封装多个诊断 run，但 skill 没有写，Agent 会给每一格都开一个修订和一个 attempt。
  - 网格格的标签不同，不能和中心配对，所以中心必须用对照的标签。
  - 子版本不能拿父版本的候选 run 作参照（C02 对 C01 返回 `decision_pair_role_mismatch`），但可以把父版本重封为 control，B01、B03 就是这么做的；publish.md:56 没有写这一步。
- **证据**：`artifacts.py:341-345`；`cli.py:458-463,490-493`；`store.py:76-116`；Sim A SR-I07，Sim B B14；历史 I09。
- **最小修复**：写明标签可以选择预登记的常量；写明父子配对要先把父版本重封为 control；删掉 TIER_RATIOS 那句；`pair_preflight` 在没有误拒的情况下改为直接拒绝（用户已经批准）。
- **修复方式**：skill 文本。

**M22 换镜像就要重封对照**（保持）
- **问题**：比较要求镜像相同。10-10 新建了 3 个镜像，都没有登记过 run，也没有任何 seal 带 exposures。要使用新镜像的能力，就得先开一个绑定对照策略的工程 attempt 去重封对照，目前只发生过一次（B03）。这条规则写在 4 份 docs/plans 里，但 seal.md 没有写，结果要到 register 的 dry run 时才会暴露。继续用 d6bbbde7 加 B03-37 仍然有效。
- **证据**：seal manifest；`cli.py:484-497`；`contracts.py:217-228`；`r1-fresh-ledger-product-findings.zh.md:83`；Sim B B17；历史 I08。
- **最小修复**：在 seal.md 中写明：发表候选之前先选定本轮镜像；如果与对照不同，先为每个对照策略开一个工程 attempt 重封并登记；只对真正要用的镜像这样做。
- **修复方式**：Agent 流程。

**M23 一轮候选约 25–29 条命令**（保持）
- **问题**：原生回放只要 34–137 秒，但一轮要 10–40 分钟。可以节省的部分包括：
  - 宿主试点应该在发表 attempt 之前做，否则发现 bug 就得新开 attempt；
  - 试点可以用草稿（`--strategy-binding` 是可选参数）；
  - 单独的 verify 是多余的，backup、register 和 report 内部都会调用；
  - 无单诊断也被强制要求填 `--cost-model`。
- **证据**：`seal.md:57-77`；`strategy-authoring.md:142-165`；`artifacts.py:344,589,636`；Sim B B16；历史 I11。
- **最小修复**：写明先做试点、再发表 attempt；删掉单独的 verify 步骤；给无单诊断一个固定的成本模型文本；可选地写一个临时的轮次脚本，遇到预检发现就停下。
- **修复方式**：Agent 流程。

**M24 组合层协调和相关持仓风险没有文档**（保持）
- **问题**：
  - Cache 和 Portfolio 是跨实例共享的，同一时间戳的回调按 `--coins` 的顺序执行。
  - 多个策略订阅同一个 bar type 时，处理器的执行顺序在不同运行之间会变（探针 6 次中有 3 次不同），模块全局变量实际上是共享的。
  - 风险在于运行不可复现，而不是前视。
  - F68/F70 已经记录：挂单加持仓的原止损承诺峰值达到 9.86%，但这条没有进入 skill。
- **证据**：`native_node.py:306-330`；`strategy-authoring.md:15-17`；`r1-native-rd-findings.zh.md` F68、F70；`~/.local/share/trade/research-audits/20261011-rd-loop-simulation/m24/probe/order_probe.py`；Sim A SR-I14，Sim B B12。
- **最小修复**：
  - 写明上限用原生计数实现；读其他品种的数据只能从 `self.cache` 读，而且只读严格更早的 K 线；不要多个订阅者订阅同一个 bar type；平局规则必须是显式的。
  - nautilus-report-analysis 增加两个读数：同时持仓数，以及挂单加持仓的原止损承诺。
- **修复方式**：Agent 流程（skill 文本）。

### 四、次要

- **M11 固定高先路径在方向比较上有偏，但目前影响可以忽略**：rc3 源码证实每根 K 线都按开-高-低-收处理。当前 seal 中受影响的比例不超过 0.7%：B03 2/496，C11 1/151，C08 和 C09 为 0。`strategy-authoring.md:68` 写的是“未知”，与事实不符。**修复**：把措辞改为“固定假设”；在 nautilus-report-analysis 中按方向统计同一根 K 线同时触及止损和止盈的周期数，入场那根 K 线和之后的 K 线分开统计。方式：skill 文本。
- **M25 流动性概念没有数据，需要声明价格代理**：现有规则已经把失败限定在被测的定义上。只差 L1 下的一句话：如果机制依赖输入里没有的量，写明用的是哪个价格代理，以及它代表不了什么。方式：skill 文本。
- **M26 尾部压力、ADL、宕机和 mark/last 触发既没有模拟，也没有在审阅中要求**：rc3 默认 `liquidation_enabled=False`；MARK 触发的止损无法回放（F75）；28 个 seal 的交易窗口都避开了级联。**修复**：review.md 冻结清单加一行，要求写出未建模的风险、窗口内是否有压力事件，以及回撤与块自助法或 Sharpe 隐含包络的对比；对冲组合需要预登记单腿亏损情景。先做 eval。方式：skill 文本。
- **M27 有一条过时规则**：`strategy-authoring.md:35-37` 还在引用已删除的 TIER_RATIOS。计时器的成本（慢 10 倍以上）只写在 `README.md:159-160`。**修复**：替换这几行，并在“因果时钟”一节加一行“优先用 K 线事件或 GTD，不用计时器”。方式：skill 文本。
- **M28 从主 checkout 启动的会话会加载旧 skill**：主 checkout（d9dd49dd0）比 origin/main 落后 4 个提交，导致 research-sources 仍在宣传已删除的 11 个来源；子 agent 会继承这份旧列表。**修复**：从目标设计所在的 worktree 启动会话；`rev-list` 计数不为零就快进；在计划里记录会话根目录的 HEAD。方式：Agent 流程。
- **M29 拟合常量没有规则**：用 numpy/pandas 离线拟合后把结果作为常量嵌入，现在是允许的。**修复**：只在拟合常量时适用：写出拟合窗口、标签期限和重叠情况；读数只用拟合窗口之后、至少间隔一个标签期限的数据，或者用清洗加禁运的切分；预处理只在训练折上拟合；每个配置都计为试验。方式：skill 文本。

## 7. 已被现有设计覆盖或被核查否定的担忧

**已覆盖的问题类型**：
- D3：内容寻址的输入身份，覆盖和资金费检查不通过即失败。
- D5：每个永续是独立合约，使用原始价格。
- B1：事件驱动，只能看到已完成的 K 线。
- S3：只能用发表后的窗口做确认，有代码强制。
- P1、P6：机制、反驳条件、结果映射、合同冻结、禁止从亏损单里推导过滤条件；评测为带 skill 3/3、不带 skill 0–1/3。
- P3：绑定 Dolt 修订、SHA、镜像、配置、输入，并封装、验证、备份，做溯源审计。
- P7：每个策略一个文件，有谱系。
- C1：原生资金费结算，并做完整性检查。
- 历史上的 I07（执行缺陷）和 I16（资本口径）已关闭。

**本次 29 项发现都被调整过，没有一项被整体否定**。被否定或缩小的部分说法如下：
- **M01**：窗口内的子期切分其实可以做；历史留出本来就不是合法用途；下载器被删并不是根本原因，rc3 本身就下载不了 MARK 和资金费。
- **M02**：“约 13%”应更正为 8.7%；`reject_stop_orders` 与乐观成交无关；限价成交概率和时延可以在策略文件里加压。
- **M03**：集中度已有 K4 eval 3/3 和 stability-before-freeze 覆盖；日锚和结构断点没有证据。
- **M05**：L3 已经有参照，选无条件参照时会自动去漂移；对照在计划文本里早就冻结了。
- **M06**：Git 时期的暴露已在 B00 计划中披露；工程重封进入 run_refs 是正确的。
- **M08、M15、M29**：L5 只接受发表后的数据，所以这几项不会造成虚假确认。
- **M11**：原证据无效，因为 B03 只做多，而且是止损出场。
- **M12**：10-10 那些影线是真实成交，不是坏 tick。
- **M13**：原文的对齐说法写反了；seal 一侧的金额和列表解析已经由 `tables()` 处理。
- **M16**：2R 配 60% 胜率在代数上并非不可能；不应让用户重新选择目标优先级。
- **M17**：读取发生在发表前、以及集中度，都已有其他规则覆盖。
- **M18**：2.84MB 的完整 show 不是问题，`show --brief` 只有 17KB。
- **M21**：成本模型文本已由 `seal.md:69-72` 覆盖。
- **M23**：E01 只有一次封装、一次登记，不是两次。
- **M24**：“前视”这个说法没有依据，实际风险是不可复现。
- **M26**：强平在任何杠杆下都是关闭的，不只是杠杆 1 时到不了。
- **M27**：期末全仓止盈要求已经写在 skill 里。

## 8. 建议的下一步（按工作量从小到大排列）

1. **会话卫生（M28）**：在最新的 worktree 中启动研究和评测会话，并记录 skill 提交。不需要用户决定。
2. **一批小文本修正（M27、M11 措辞、M25 一句、M29 一行）**：只改文字，不改变行为。不需要用户决定。
3. **宿主读取小节（M13）**：消除静默的零行读取和分桶错误。不需要用户决定。
4. **`l3-boundary.md` 加 `publish.md` 映射（M04、M05 的 L3 部分、M09 确认时间打戳、M10）**：解决假显著问题，并让 L3 否证可以检索到。不需要用户决定。
5. **research-round 计数与范围规则（M06、M08、M15、M14 范围、M03 行情范围、M16、M20、M18）**：不需要用户决定。
6. **nautilus-report-analysis 新读数（M02 四个读数、M03 beta/alpha、M11 按方向统计、M24 并发与原止损承诺、M12 异常 K 线配方）**：不需要用户决定。
7. **review.md 冻结清单和 DSR 配方（M17、M07、M26），并在 Git 之外存校准用例**：不需要用户决定。
8. **流程类文本（M21 网格与父版本重封、M22 先选镜像、M23 先试点后 attempt、M05 随机对照配方）**：不需要用户决定。`pair_preflight` 改为拒绝已获用户批准，确认没有误拒后执行。
9. **对第 4–8 步的每条新规则做带/不带 skill 的回归 eval，并补留出用例（M19）**：包括 nautilus-report-analysis 的留出集和一组 Codex 评测。不需要用户决定。
10. **【需要用户决定】恢复长期研究目标，跑一轮真实研究，并做过程审计（M19）**：同时处理 handoff 中待定的 D11，以及 D09 提出的单档 61.8% 候选（需要 B2 授权）。
11. **【需要用户确认文件清单和体量】W7 历史数据配方**：包含时点币池和退市说明，同一配方复用于 W6（M01、M14）。
12. **【需要用户决定】版本化的压力撮合配置（fill_model 滑点、费率倍数）**：需要新镜像并重跑对照（M02）。
13. **【后续产品能力】**：运行器支持部分窗口品种和原生退市结算（先用探针测 `settlement_prices`，M14）；只有当重封变成常规操作时，才做“候选作参照”的配对能力（M21）。
14. **【需要用户授权实盘】**：阶段 16–18，以及 L1–L6 的运营控制。

按这个顺序修完后，“部分覆盖”的类型大多会有明确的规则和检查。但有两类缺口仍然受数据限制，靠 skill 文本补不上：
- 没有盘口和成交数据：E2、M2–M4、C6、A4；
- 没有时点币池和条款历史：D1、D6。