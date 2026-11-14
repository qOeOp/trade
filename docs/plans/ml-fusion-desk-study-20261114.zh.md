# 2026-11-14 机器学习融入规则策略：案头研究与计划项

| 项目 | 内容 |
|---|---|
| 起因 | 同日两条研究线验证了“在规则策略里接入滚动拟合的模型”。工程上可行，但没找到价值（判断 79、81、82）。用户认为低成本实验受样本和基础设施所限，要求先从论文、开源项目、社区和视频讲座取证，判断这种融合有没有纸面价值、值不值得进未来的实现计划。 |
| 产品版本 | 引用以 `origin/main` `147ba64067e289c5ea75cc841757232da41c4d19` 为准。 |
| 改动 | 只写本文档。没有写账本，没有改技能、代码或检查。 |
| 取证 | 三个子代理并行取证：学术 36 篇（OpenAlex、Crossref，按 `research-sources` 记查询日志）；开源项目 8 个加社区讨论；视频讲座 4 场（`video-evidence` 证据包）。各路结论由本会话综合。 |

## 结论

1. **用模型否决规则的交易，纸面上没有价值。** 论文、开源加社区、视频三路证据都给不出在真实数据上、计入成本、样本外的正面结果。本地结果（试验 155，p=0.51，省下 17k 手续费，丢掉 18k 价格盈亏）正是文献预料的。
2. **用模型或波动率预测定仓位，有条件地有价值。** 条件是规则本身已有毛利优势，周期在日线或更长；收益主要表现为回撤下降。大部分价值来自“按波动率缩放”这个规则，跟预测准不准关系不大。这在现在的策略源码里就能做，dow-theory 线做过（@70/@71），不需要新的产品能力。
3. **融合本身算不上创新。** meta-labeling 2018 年就写进了书里，FreqAI、Jesse、QuantConnect 也早有完整的训练、重训和推理管线。缺的是净成本、样本外的成功证据，不是工具。
4. **计划处理：** 不把“ML 融合”做成产品功能或研究主线。把一组评估能力记为触发式计划项（见下文），触发条件是某条研究线出现了能覆盖成本的候选。

## 本地实验回顾

| 线 | 做法 | 结果 |
|---|---|---|
| `dow-theory-btc-eth` | 日线道氏规则，加波动率预测定仓位；方向模型和三重障碍模型离线评估 | 改进来自仓位大小，不来自预测能力；方向模型把结果排反了（判断 79） |
| `channel-breakout-model-filter` | 8 个永续合约上的 15 分钟通道突破（根，试验 154），子版本加每日重拟合的 L2 逻辑回归过滤器（试验 155） | 根策略被手续费吃掉（年化 −14.4%，最大回撤 53%，6,038 个周期）；过滤器配对比较 p=0.51，被拒交易在根策略里并不比通过的差（判断 82） |

judgment 82 记下的产品缺口：
- 报告没有模型质量指标；
- 没有存放逐决策预测的地方，本次用订单 tag 临时代替；
- 策略源码里没有 numpy；
- 日内长预热要在 Paper/Live 45 秒的启动限制内加载完。

## 三种融合形态的纸面证据

### 否决过滤：规则出信号，模型决定做不做

- **最接近本地实验的独立研究：** Zhang, Chang, Zhang, Wang 2026（SSRN，doi:10.2139/ssrn.7356724，只读到摘要）。5 个中国期货品种，15 分钟线，均线交叉规则加 XGBoost 过滤，三重障碍标签，往返成本 4 bps，purged walk-forward。AUC 接近 0.5。指标是 Ret/MDD（收益除以最大回撤）相对原始均线规则的差：5 个品种在两个随机种子下，配对 bootstrap 95% 区间都含 0，其中两个品种换种子后符号翻转。接受率 1.44–6.76%（τ=0.50）。持仓量变化的贡献因品种而异，并不一致为正。
- **加密永续：** Zhang, Zhu, Ji, Cao, Wang 2026（JCEBS，doi:10.1080/14765284.2026.2753973，摘要）。1、4、8 小时周期，样本外 R² 全部为负，净收益几乎都为负。
- **元标签系列：** Hudson & Thames 的 JFDS 2022–2023 元标签论文（Joubert 2022 等）。论文全文没有找到开放副本，读了摘要和作者公开的代码 `hudson-and-thames/meta-labeling`。数据是合成的 AR(3) 过程，单一 regime 或两 regime 切换。假阳性实验和校准定仓位实验的特征里，有真实 regime 标记滞后 5 天的副本（`regime = flags.shift(5)`）。代码里没有任何成本项。有收益是数据构造出来的，不能说明真实市场。
- **开源对照：** MQL5 文章用 RSI 规则在 EURUSD H1 上做样本外测试，计入真实点差。过滤和定仓位把回撤降了 57–93%，但策略仍然亏损，测试准确率 48%。QuantConnect 论坛帖 14706 的种子网格测试里，加元标签后平均 Sharpe 反而下降。
- **视频：** 共 4 场：López de Prado（QuantCon 2018）、Hudson & Thames 元标签讲座、Ernest Chan、Don Brady。四人一致认为“规则定方向，模型定做不做、做多大”。但给出的数字要么是合成数据，要么是单品种一年且不计成本，要么是本人也称为 anecdotal 的个例，要么是厂商宣传。四场都没有报告成本和试验次数。

### 仓位与风控：波动率缩放、校准概率定仓位

- Kim, Tse, Wald 2016（JFM，doi:10.1016/j.finmar.2016.05.003）：TSMOM 的 alpha 主要来自波动率缩放。
- Cederburg 等 2020（JFE，doi:10.1016/j.jfineco.2020.04.015）。全文读的是亚利桑那大学仓储的接受稿，月度数据，CRSP 1926–2016。
  - 直接比较 Sharpe（表 2）：103 个策略里，波动率管理版本高的 53 个，原版高的 50 个，显著的多是动量策略。
  - 实时、样本外的组合（表 6 A）：Sharpe 上 45/103 胜过原版，确定性等价收益上 31/103 胜过。
  - 原因是 spanning 回归的结构断点（第 5 节）。
  - 全文没有成本处理，所以这个“跑不赢”还是未扣成本的结果。
- Harvey, Hoyle, Korgaonkar, Rattray, Sargaison, Van Hemert 2018（JPM，doi:10.3905/jpm.2018.45.1.014）。全文读的是作者主页上的发表版，计入成本（股票 1 bp，债券和信用 0.5 bp，商品 2–3.5 bps）。
  - 美股 1927–2017：Sharpe 从 0.40 升到 0.48–0.51（Exh. 5）。
  - 债券：Sharpe 下降或持平（Exh. 11、13）。
  - 50 个期货和远期：只有股指和信用略有改善（Exh. 15）。
  - 波动率的波动和左尾几乎全部改善，但右尾也一起被削掉。
- Bongaerts, Kang, van Dijk 2020（FAJ，doi:10.1080/0015198X.2020.1790853，表 1）：常规波动率目标法平均 Sharpe 只提高 0.04，动量因子例外，提高 0.16。
- Meyer, Barziy, Joubert 2023（JFDS，doi:10.3905/jfds.2023.1.119，摘要）：概率校准能改善固定的仓位函数（合成数据）。
- Lim, Zohren, Roberts 2019（JFDS，doi:10.3905/jfds.2019.1.015，Exh. 2、8）：深度学习趋势模型毛 Sharpe 2.80，MACD 为 0.98；成本到 10 bps 时 LSTM 降到 −5.31，训练时加换手惩罚后为 0.91，MACD 为 0.72。不加惩罚时，只在成本 2–3 bps 以内胜过基准。

### 方向预测与截面排序：模型直接出信号

- **日内加密可以预测，但量级很小：** G-Research Kaggle 一个银牌方案线上相关约 0.02，交叉验证约 0.08。Jaquart, Dann, Weinhardt 2021（JFDS，doi:10.1016/j.jfds.2021.03.001）测 BTC 1–60 分钟方向，准确率 0.51–0.56，计入成本后收益转负。
- **日线截面有一篇正面结果：** Jaquart, Köpke, Weinhardt 2022（doi:10.1016/j.jfds.2022.12.001），未经复现。读的是作者 KIT 博士论文第 2.3 章的投稿前版本，正式发表版的数字可能不同。
  - 每边成本 15 bps（第 2.3.3.8 节）。
  - 计入成本后，多空组合 Sharpe 为 LSTM 3.23、GRU 3.12，市场为 1.33（表 2.13）。
  - 但空头腿几乎没有贡献，Sharpe 在 −0.55 到 0.54 之间（表 B.4）；只做多头腿就有 2.98–3.52（表 2.14）。测试期 2020-04 到 2022-05 是加密牛市。所以这是牛市里挑选做多的币种，不是多空中性的 alpha。
  - 这是组合排序的产品形态，不属于本次的规则融合假设。
- **Binance 永续因子：** Nefedov 2026（SSRN，doi:10.2139/ssrn.7350238，摘要）研究 137 个 Binance 永续，基线方法下 6 个因子都过不了 DSR，其中 4 个样本外 Sharpe 为负。资金费 carry 只在乐观的成本假设下才能通过。

## 为什么本地实验必然测不出价值

- **手续费：** 开源调研按基本法则粗算，相关 0.02–0.05 的信号每笔约值 0.5–1.5 bp，taker 往返约 10 bp，差一个数量级。规则本身被手续费吃掉时，过滤器省下手续费，也丢掉同等的价格收益。
- **检验力：** 6,038 笔交易各半分成通过和拒绝两组，5% 双侧、80% 检验力下能分辨的最小每笔差异约 0.07σ，按 t≈3 的门槛约 0.10σ。若每笔 24 小时持仓的 σ 取 2%，约为 14–20 bps，比手续费本身还大。σ 是假设值，这个算术是子代理的估算，不是文献里的数字。
- **特征：** 文献中有效的过滤器靠的是规则没用到的信息。合成实验更是直接把真实 regime 给了模型。本地特征（突破强度、波动比、趋势、成交量、止损距离）只是规则自身输入的另一种写法。

## 计划项：评估能力（触发式）

这四项正好对应 judgment 82 的四个缺口，也是 FreqAI、Jesse、Qlib、QuantConnect 共有的基础设施。前两项对任何过滤或仓位规则都有用，不止服务 ML。

| 能力 | 作用 | 归属 |
|---|---|---|
| 逐决策记录，包括被拒交易后来的结果 | 没有它，就算不出 AUC、校准，也做不了通过与拒绝的对比。本次用订单 tag 临时代替。 | 产品：新的存储字段，加之前按 AGENTS.md 另做独立评审 |
| 报告里的过滤归因 | 把变化拆成省下的手续费、丢掉的价格盈亏和仓位效应；再加同接受率的随机否决基线，过滤器必须胜过随机砍掉同样比例的交易。 | 产品报告；也可以先作为 `nautilus-report-analysis` 的 Agent 做法 |
| 运行时数值库（numpy；LightGBM 或 ONNX） | 让策略源码能训练、推理像样的模型。 | 运行时镜像，属于运行契约变更 |
| 预训练模型热启动 | Paper/Live 启动有 45 秒限制，训练要移出启动路径。 | 运行时与 Paper/Live 启动 |

**触发条件：** 某条研究线出现毛利为正、能覆盖成本的候选，比如接近回撤 15%、年化 20% 这两个目标。到那时再用 ML 做仓位或风控增益才有意义。评估标准是：与同一规则不加 ML 相比，计入成本的样本外收益或回撤是否改善，不看分类准确率。在此之前，波动率或概率仓位留在策略源码里，作为 Agent 的普通研究手段。

**文献要求的最低评估做法**（触发后适用）：
- purged/embargo 的 walk-forward 或 CPCV；
- 计入真实试验次数的 PBO 和 DSR，t≈3 门槛；
- 按概率定仓位之前先检查校准；
- 配对 block bootstrap；
- 同接受率的随机否决基线；
- 预先登记，并写明检测下限。

## 局限

- 学术侧多数来源只读到摘要；几篇关键的 2026 年研究是未经同行评审的 SSRN 工作论文。AFML 原书和 JFDS 元标签论文全文没有读到。
- 11-14 第一轮：本会话给学术子代理的指令不许用密钥，覆盖了 `research-sources` 的规定（该技能要求带 `OPENALEX_API_KEY` 和 `SEMANTIC_SCHOLAR_API_KEY`）。结果 Semantic Scholar 免密钥检索全部返回 429。这是委派指令的错误，不是产品缺陷。
- 11-15 带密钥重查了 10 篇决定结论的论文：两个密钥的请求都返回 200，没有出现 429。
  - 读到全文的 3 篇：Cederburg 2020、Harvey 2018、Jaquart 2022（博士论文版本）。JFDS 元标签三篇读了作者代码。
  - 其余仍只有摘要：Zhang 2026 两篇、JFDS 元标签三篇、Atluri 2026（Crossref 摘要被截断）、Kim–Tse–Wald 2016、Nefedov 2026、Mikhailov 2026。原因是没有 arXiv 副本；SSRN、UCL Discovery、CORE 和 Hull 仓储都弹出机器人校验，ScienceDirect 返回 403，按技能规定都没有绕过。
  - 这几篇要读全文，需要用户提供 PDF。
  - 全文核对没有改变结论，还更支持原判断：唯一计入成本的 ML 正面结果是日线截面、靠做多腿的结果；波动率管理即使不扣成本，实时也跑不赢原版。
- 社区侧 Reddit、Discord、Kaggle 讨论页多数要登录，没读到，社区证据比计划的薄。
- 视频：没找到 FreqAI 作者本人的讲座，用 Don Brady 的讲座代替。Chan 有商业利益（PredictNow.ai）。证据包没有做独立复核，也没有备份（`VIDEO_EVIDENCE_BACKUP` 未设置）。标为“仅 ASR”的数字没有对照画面核对。
- 正面证据普遍不计成本、不报试验次数；负面证据更多来自独立的一方。所以结论是“缺乏证据”，不是“证明无效”。

## 来源

- 视频证据包，在本机 `~/.local/share/video-evidence/bundles/`：
  - `youtube-BRUlSm4gdQ4`（López de Prado，与同日外部批评研究共用，不计为新来源）
  - `youtube-ZCFmZFBtqsQ`（Hudson & Thames）
  - `youtube-nBy7b_oZ7mE`（Ernest Chan）
  - `youtube-Jnvmzk5ae5U`（Don Brady）
- 开源与社区：
  - [FreqAI](https://www.freqtrade.io/en/stable/freqai/)
  - [Jesse ML](https://docs.jesse.trade/docs/research/ml/)
  - [Qlib](https://github.com/microsoft/qlib)
  - [QuantConnect ML](https://www.quantconnect.com/docs/v2/writing-algorithms/machine-learning/key-concepts)
  - [QuantConnect 论坛 14706](https://www.quantconnect.com/forum/discussion/14706/why-meta-labeling-is-not-a-silver-bullet/)
  - [MQL5 RSI 元标签对照](https://www.mql5.com/en/articles/22274)
  - [G-Research 赛后总结](https://www.gresearch.com/news/wrapping-up-the-g-research-crypto-forecasting-competition/)
  - [Hudson & Thames 元标签代码](https://github.com/hudson-and-thames/meta-labeling)
  - [NautilusTrader README](https://github.com/nautechsystems/nautilus_trader)：把内置 AI/ML 工具列为不在范围内。
- 方法学文献：
  - Bailey, Borwein, López de Prado, Zhu 2016（JCF，doi:10.21314/jcf.2016.322，PBO）
  - Bailey, López de Prado 2014（JPM，doi:10.3905/jpm.2014.40.5.094，DSR）
  - Harvey, Liu, Zhu 2016（RFS，doi:10.1093/rfs/hhv059）
  - McLean, Pontiff 2016（JF，doi:10.1111/jofi.12365）
