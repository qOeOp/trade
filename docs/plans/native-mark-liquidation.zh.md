# 官方原生强平接入调查

> **历史调查记录（2026-10-24），归档于 2026-10-25。** 本页按调查先后保留观察、临时探针及未采用路线；文中的“当前”“未接入”“下一步”均指所在调查阶段，不代表归档时的产品状态或新的实施授权。后续产品已提供可选报价执行与原生强平环境，见[执行环境边界](../rd/replay-environment.zh.mdx)；正式 Binance 成交推断报价的接入、验收与局限见[后续接入记录](binance-aggtrades-quotes-liquidation-plan.zh.md)。本页不将 OKX 或其他场所的数据混作 Binance 合约输入。
>
> 本次仅归档调查笔记，没有重新下载来源、重跑原生探针或复核全年原始数据。`/tmp` 路径是当时工作副本位置，不是永久证据备份承诺；历史测试与未完成事项的范围仍以各节说明为准。

2026-10-24，用户确认启用强平，并要求固定初始本金 100000 USDT，策略自主决定保证金预算、杠杆及名义敞口。50 倍是策略使用资金的例子，不把它新增为所有策略的目标或名义额度约束。强平损失、费用和跳空后的负权益必须保留，不因策略爆仓而删去亏损样本。

## 已核实的原生依赖缺口

产品诊断基线为 `9429d344aaf348bb9a27b0573fc2c01f3f85296f`，Nautilus 为锁定的 `2.0.0rc3`。合成探针位于 `/tmp/trade-liquidation-native-probe/`，没有活动账本写入或实盘连接。

- 账户 100000 USDT，测试入场数量 45000、价格约 100，初始保证金率 2%、维持保证金率 0.5% 均仅为人造测试参数，不是已核实的交易所档位。
- 当前 Bar + MARK 输入，打开原生强平后，权益降至 7549.90、维持保证金为 22500，仍持有仓位。原生审计通过不能证明强平有效。
- 加入人造报价作对照，原生生成只减仓强平单，撤销旧挂单、收取普通吃单费，最终权益 5545；现有审计通过。这些报价只用于测试，不进入真实市场输入。
- MARK 下跌、报价不变时不触发；报价下跌、MARK 不变时触发。原生 `Cache.calculate_unrealized_pnl` 只读取报价，缺报价返回 None；`SimulatedExchange.process_liquidations` 在不能给任一持仓估值时跳过。
- 跳空对照最终权益为 -804050，独立审计通过。非正权益的报告维度和资格须一并核验，不将无定义的复利年化伪造为有效数字。
- 已发布 `v2.0.0rc7` 的对应源码仍仅从报价计算浮盈亏，不能凭升级版本号认定缺口已修复；未声称完成 rc7 原生运行验收。

## 官方方式与已验证边界

用户随后明确要求先调查官方推荐方式，尽量少参数、少自建周边设施。因此不预定修改框架，先以官方原生接入为首选。

- 官方固定版本示例 `examples/backtest/liquidation_demo.py` 使用 `QuoteTick` 行情与原生 `BacktestEngine.add_venue`。在本项目锁定的 2.0.0rc3 环境运行官方原件成功：`liquidation_triggered=true`、未平仓位 0、已平仓位 1。日志在 `/tmp/trade-official-liquidation-demo.log`。
- 最少额外配置是 `liquidation_enabled=True`。触发比率默认 1.0，即权益不高于维持保证金时强平；强平前撤销挂单默认 True。没有理由在周边再加入一组自定义阈值或策略侧强平器。
- `SimulatedExchange` 按结算币种汇总账户权益和维持保证金；原生撮合器发出只减仓市价 IOC 强平单，继续通过原有成交、费用、持仓与账户事件路径处理。
- 默认保证金模型为 `LeveragedMarginModel`，按名义价值除以杠杆后乘合约保证金率。另一个内置 `StandardMarginModel` 不再除杠杆。选择应依据研究环境条款，不自行实现第三套公式。
- 官方 MARK 文档描述它可用于衍生品估值及强平，但这不等于当前固定版本的强平入口已经采用 MARK；`PortfolioConfig.use_mark_prices=True` 影响 Portfolio 估值，不能修复 `SimulatedExchange` 独立使用报价的路径。
- 官方 bar 执行会生成撮合器内部的合成 L1 更新，但实测这些更新不等于强平读取的 Cache 报价。不得因 bar 撮合能运行，就声称 Bar + MARK 已具备强平能力。

当前最小接入调查结论：优先保留已发布原生框架与默认强平逻辑，核实正式输入能否提供其使用的真实报价。若研究仍只使用 Bar + MARK，就明确记录现有能力缺口；不在外围伪造报价、增加账户风控引擎或擅自修改框架。尚未对外发送议题、评论或 PR。

官方依据：

- [固定版本强平示例](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/examples/backtest/liquidation_demo.py)
- [BacktestEngine.add_venue 强平参数](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc3/crates/backtest/src/python/engine.rs)
- [保证金模型](https://nautilustrader.io/docs/latest/concepts/backtesting/accounts-and-margin/)
- [MARK 数据用途](https://nautilustrader.io/docs/latest/concepts/data/mark_price_update/)
- [Bar 撮合方式](https://nautilustrader.io/docs/latest/concepts/backtesting/bar-execution/)

上述 latest 文档只作为官方概念说明；版本行为以固定标签源码和本机原生运行核验。

## 独立字段评审

依 AGENTS.md，在增加任何持久化字段之前，独立只读子代理 `liquidation_identity_review` 审阅了真实消费者。结论为本轮不新增存储字段：

- 强平启用、固定触发比率、先撤挂单选项及模型实现由运行源码、锁定依赖和不可变镜像身份确定，不另存常量副本。
- 合约保证金条款已在原生导出与既有条款回执中记录，继续复用。
- 策略选择的杠杆、预算与敞口规则已由完整源码及源码哈希固定，不混入共同环境的 `effective_config.account`。`registration/comparability.py` 会比较完整 account；新增策略杠杆映射会错误地阻断不同策略之间的比较。
- `engine/config.py` 的运行源码及依赖锁身份、`engine/run.py` 的执行绑定、`replay/entry.py` 的既有覆盖回执和 `registration/comparability.py` 的镜像核对已足以区分新旧运行环境。
- 不新增“配置已开启”“强平已观察到”等派生存储标记。有效性由真正触发强平的原生回归证明。若未来同一镜像接受逐运行选择的环境参数，届时再独立评审其输入身份。

## 接入验收

按用户最新要求，先确认官方方式及其输入前提，再确定产品接入方案。接入前须对齐初始保证金与维持保证金的语义。不得把当前 `10% / leverage` 直接宣称为用户选择的倍数，也不让选择的杠杆错误地稀释交易所维持保证金要求。

验收覆盖：多空；MARK 与成交价不同；先撤旧挂单再平仓；普通费用与额外强平费的界限；跳空和负权益；原生订单、成交、账户、日收益与报告资格；同一输入重放一致性。升级原生版本或改变运行实现需要新 CI 镜像；两镜像对照应区分非触发场景的行为保持与强平场景的预期经济变化。

当前未启用产品强平，也未修改原生框架实现。`/tmp` 的五个诊断用 Rust 场景中，不提供 MARK 的两项既有行为通过，三个期待 MARK 参与强平的场景失败；它们只重现能力差异，不代表官方承诺这三个场景已支持。接入方案等待基于官方前提确定。

## 先修行情输入：来源与接入前提

用户随后要求先修行情输入。本轮核对 `market/sources.py`、`schema.sql`、`export.py` 和 `engine/run.py`：目前只有 LAST、MARK、资金费与生命周期事件，没有历史买卖报价的导入、持久化、导出或运行流。不能只打开强平开关就声称修复。

### 已验证的数据来源

- 直接读取 Binance 官方 S3 完整目录（`IsTruncated=false`）：BTCUSDT、ETHUSDT 的 daily bookTicker 各有 320 个 zip，文件日期为 2023-05-16 至 2024-03-30；monthly 各有 12 个 zip，文件名为 2023-05 至 2024-04。BTC 的 2025、2026 daily 前缀以及 ETH 的 2025 daily 前缀均无文件；完整 monthly 目录也没有这两年的文件。这是所查合约和目录的观察，不推广为所有合约、所有供应商均无数据。
- 通过既有 `fetch_archive` 下载并验证 BTC 的 2024-04 monthly `.CHECKSUM`。压缩包 37,761,761 字节，CSV 303,835,669 字节，共 3,223,964 行；实际首尾交易时间为 2024-04-01 00:00:00.006 UTC 至 06:46:50.135 UTC，并不覆盖整个四月。交易时钟在此文件中无倒序。
- BTC 已列出的 daily 压缩包合计 52,578,851,529 字节。全量逐笔报价明显大于现有分钟线输入，不能在未测量导入与重放开销前，直接承诺把全币池、多年数据按现有分钟数据方式装载。daily 与 monthly 有重叠，不相加作为独立数据量。
- 官方 `GET /fapi/v1/ticker/bookTicker` 只有 symbol 查询，没有历史起止时间分页，不能用当前报价回补 2025–2026。
- 已核对 Tardis 官方文档及公开 metadata。BTC、ETH 的数据集均列有 `quotes`、`book_ticker`，合约级可用范围截至 2026-10-23；该范围不是逐日完整性的证明。`quotes` 是供应商从真实 L2 重建的最优报价，`book_ticker` 是原交易所 BBO 通道，两者须区分。每月首日可免 Data API key 下载，完整期间的访问仍须确定用户已有文件或供应商授权。

来源：

- [Binance BTC daily 目录](https://data.binance.vision/?prefix=data/futures/um/daily/bookTicker/BTCUSDT/)
- [Binance BTC monthly 目录](https://data.binance.vision/?prefix=data/futures/um/monthly/bookTicker/BTCUSDT/)
- [Binance 当前 bookTicker REST 接口](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#symbol-order-book-ticker)
- [Tardis Binance Futures 覆盖说明](https://docs.tardis.dev/historical-data-details/binance-futures)
- [Tardis 公开数据集 metadata](https://api.tardis.dev/v1/exchanges/binance-futures)
- [Tardis 报价数据类型](https://docs.tardis.dev/downloadable-csv-files/data-types)
- [Tardis 下载与样本范围](https://docs.tardis.dev/downloadable-csv-files/overview)

### 已完成的原生输入探针

使用校验后的真实 BTC 档案前 10,000 行构造 `QuoteTick`，本机固定的 2.0.0rc3 完整接收 10,000 次回调，逐行数值与次序一致，最后一条 Cache 报价也一致。没有更改价格、插值或生成虚构报价。探针为 `/tmp/trade-real-quote-probe.py`，结果为 `/tmp/trade-real-quotes/native-input-probe.json`。

该样本的尾随零可精确缩至价格 1 位、数量 3 位；转换时逐项检查数值相等，没有四舍五入。`transaction_time` 映射 `ts_event`，交易所的 `event_time` 暂映射 `ts_init`，仅证明输入可接收；交易所推送时钟不是采集器收到消息的时钟。正式来源须保留其真实时钟语义，不把该探针映射冒充实测网络延迟。探针未下单，未验证真实窗口的强平触发，也不是 CI 镜像验收。

### 接入决策仍需来源事实

固定版本已有原生 `stream_tardis_quotes`，若正式来源采用其格式，可以复用原生流式解析，而无需另造报价引擎。Binance 原始归档则需要薄格式适配。先确定当前研究期间真正可获得的报价，才确定持久化字段；任何新字段仍需单独独立评审，本页前述强平配置评审不替代报价事实评审。

还须明确执行语义：固定版 `process_quote_tick` 更新原生 L1 并调用撮合迭代；真实报价既用于强平估值，也会影响挂单、止损和成交。不能宣称只补强平输入而原有 bar 成交语义完全不变。接入后应以同一真实输入核对时钟、保护单、费用、资金费和账户经济结果，明确记录环境变化。

目前没有修改市场表、生产导入器、运行器或活动数据库；没有购买数据或使用凭据。公共旧档案只能支持工程验证，不能替换当前研究期间。

### 用户现有 Databento 接入的覆盖核对

用户确认没有历史报价文件，产品只绑定了 Databento API。2026-10-24 核对其[官方支持场所](https://databento.com/venues)与[数据集目录](https://databento.com/docs/datasets)，公开列表没有 Binance，也没有当前所需的 Binance USD-M 永续报价数据集。因此现有 API 绑定尚不能解决本项输入缺口；没有访问用户账户或声称核实其私人授权。Databento 支持 MBP-1/BBO 等报价格式，与是否覆盖所需交易场所是两个问题。不能把 CME 等其他场所的 BTC 合约报价混入 Binance 永续账户，冒充同一合约的强平输入。

当前 checkout 的业务源码、文档与项目依赖未找到 Databento 接入实现；用户所说的 API 绑定可能位于外部配置，不能据此否定绑定存在。没有读取密钥，也没有发起计费历史下载。不能用已有 API 绑定代替来源覆盖的核验。

### 社区方式与币安停供的直接证据

用户明确要求不修改原生依赖代码。此前提出维护原生 MARK 补丁的建议撤回，不作为本产品的接入方案。

- Binance 公开仓库 [#334 的处理回复](https://github.com/binance/binance-public-data/issues/334#issuecomment-2109510370) 于 2024-05-14 明确表示 Futures 已停止提供历史 bookTicker，建议以后监听 WebSocket，恢复无时间表；随后关闭该问题。另见 [#372 后续回复](https://github.com/binance/binance-public-data/issues/372#issuecomment-6020302431)。因此公共文件缺失不是尚未找到正确日期或下载脚本；回复没有解释停供的业务或技术原因，不能自行归因。
- 这不代表币安所有历史行情都不可获得。现有分钟线、MARK、资金费来源仍是另一组接口与归档。当前 REST bookTicker 和未来 WebSocket 采集不能返回未采集过的过去报价。
- 币安[2020 年官方说明](https://www.binance.com/en/blog/futures/421499824684901131)曾提供需白名单期货账户的历史订单簿下载。此次检查其旧 FAQ 返回 article does not exist，旧开发文档入口落到首页，现行 `/en/docs/llms.txt` 中也未找到 TickLevel/histDataLink。只能确认历史上存在此通道，不能把旧文档当作当前可用性、VIP 等级或 2025–2026 完整覆盖的承诺。未连接账户或使用交易所凭据。
- Nautilus 的[官方 Tardis 集成](https://nautilustrader.io/docs/latest/integrations/tardis/)提供历史报价解析与 Catalog 接入；固定版也有 `stream_tardis_quotes`。社区 [#4371](https://github.com/nautechsystems/nautilus_trader/issues/4371) 给出了 `binance-futures`、BTCUSDT、2025-09-01 至 09-10 的 trade/quote 导入配置，是具体用户使用证据；不是所有社区用户的统计，也不是当前版本全链路验收。
- 原生强平 [#4077 的维护者审阅](https://github.com/nautechsystems/nautilus_trader/pull/4077#issuecomment-4484398639)明确把 MARK、分级减仓、额外强平费、保险基金列作 v1 之后的跟进项。2026-05-28 合并的是原生强平机制，并不能据此宣称完全复刻币安强平规则。即便取得报价，仍须如实表达原生模型的边界。

目前可核实且不修改依赖的历史报价路径是：外部已采集的真实 Binance 报价，经官方适配器进入原生数据模型与强平逻辑。新实时采集只能积累未来数据，不能补回当前历史窗口。数据取得与原生模型能力是两个独立验收事项。

## 免费 Tardis 样本的原生验证

用户同意先验证免费样本，未授权购买。使用 `binance-futures/quotes/2025/09/01/BTCUSDT.csv.gz`，HTTPS 下载 18,893,471 字节，SHA-256 为 `2904386a77f564a37aa2b05cad634b5a497c0ec33bc2ee9e3cedd78c6794aff6`（本地内容身份，不是供应商另行发布的校验值）。本机 `uv run --frozen`，Nautilus 2.0.0rc3；没有依赖补丁，也不是 CI 镜像中的正式重放。

- 官方 `stream_tardis_quotes` 完整解析 1,322,183 行；独立读取 CSV 逐行计算语义指纹，买卖价格、数量、交易时钟和本地接收时钟全部一致，行序保留。全文件有一对相同接收时间；本样本不能证明未来多文件同时间戳排序已解决。
- 选取 05:30 至 10:00 UTC 的 255,763 条，官方 `write_quote_ticks` 写入原生 Catalog，`query_quote_ticks` 逐条读回完全一致。窗口按工程触发需要选择，不是预注册策略研究，也没有独立样本收益含义。
- 固定 100000 USDT；工程合约 IM=2%、MM=0.5%、leverage=1，名义入场目标 450 万 USDT；费率沿用既有假设。它们是探针条款，不是已核实的币安历史档位。
- 同一输入比较空头不开强平、空头开强平、空头重复运行与健康多头。不开强平时没有强平单；开启后发出 20 笔原生只减仓 IOC 成交，旧入场挂单在首次强平成交前或同一时刻取消。首次强平前权益约 22487.24，原生维持保证金为 22499.52705 USDT。
- 真实 L1 数量限制导致 IOC 部分成交，空头从 41.790 BTC 减至 6.736 BTC；期末权益 12867.84753809，高于原生维持保证金 3626.62872000，因而停止继续强平。不能沿用合成大流动性示例的“一次全平”断言。原生数量守恒、每次触发前的保证金越界、成交侧价格边界、费用、持仓已实现盈亏与账户余额核对通过；健康多头没有误触发。
- 同一输入重复运行的订单、成交、持仓、账户、事件及其关联，在按确定性 venue-order 身份对齐随机强平单 UUID 后一致，共 14 项工程核对通过。

首次探针错误地期待全部平仓，并把取消数量限定为一笔；真实 IOC 会取消每笔强平单的未成交余量，这两个断言不成立。原件保留为 `/tmp/trade-tardis-sample/probe-initial.py`、`probe-initial.log`、`probe-initial-results.json`；后续核对记录真实的部分成交行为，没有修改产品审计。原生执行、Catalog、核对脚本与结果分别在同目录的 `probe.py`、`prepare.py`、`verify.py`、`prepared.json`、`verification.json` 和 `runs/`。

### 正式封存仍有一个产品问题

`engine.compare` 先按原始 client order ID 遍历事件，再编号 UUID。强平订单 ID 自带随机 UUID，导致相同经济结果的编号顺序不同。对本轮实际生成的五份原生报告复用现有编号规则，orders、fills、positions、order_events 的指纹不同，account 相同。按确定性 venue-order ID 对齐后五表及关联一致，未抹去价格、数量、时间或成交 ID。

这是五表诊断，不是完整封存重放或独立审计通过的结论；报告没有资本观察器的完整 exposures、returns，也未绑定 CI 镜像。尚未修改比较器、审计检查或正式行情契约。正式接入前需要明确处理随机强平身份的比较语义，不能把此样本宣称为产品修复已经完成。

### 已核对的付费成本，仅供比较

2026-10-24 通过官方公开订单表单实际选择 Solo + Perpetuals：季度为 2100 美元，带过去 12 个月历史；年度为 8400 美元，带 4 年历史。季度当时显示从 2025-10-23 开始，银行转账额外增加 3 个月历史，年度增加 12 个月，见[计费说明](https://docs.tardis.dev/faq/billing-and-subscriptions)。Solo 提供 CSV，不需要为本轮官方 CSV 解析器另购 Machine/API 档位。未进入结算、注册账号、创建密钥或购买；这只是个人档位的页面报价，不假定适用于所有团队用途。

## 社区共享数据调查：优先免费候选

用户进一步要求寻找持续采集并打包共享的社区来源，因此不把付费 Tardis 当作唯一方案。以下均区分发布方声明、已下载样本事实与尚未完成的验收。

### CryptoHFTData：当前最值得继续验证

- [发布方](https://www.cryptohftdata.com/datasets/binance-orderbook-data)声明 Binance Spot 与 USD-M Futures 的 L2 历史自 2025-06-28 起，持续按小时发布 Parquet；[公开 REST 文档](https://www.cryptohftdata.com/docs/rest-orderbook)支持无 key 下载（60 请求/分钟）。目前免费，主体由个人运营；属于免费可用的数据服务，不能称为可任意再分发的开源数据。
- 实际无注册、无 key 下载 BTCUSDT 两个小时：2025-10-01 00 UTC 有 3,791,517 行，69,463 个增量消息；2026-09-02 12 UTC 有 5,451,975 行，135,002 个增量消息。两份小时内部按消息的 `pu -> u` 序列均无断裂，接收时钟无倒序。前者外层还有一层 Zstd，解压后才是 Parquet；后者直接为 Parquet。
- 两个小时均只有 update，没有 snapshot。因此文件可获得、小时内部序列连续，不等于已重建正确 BBO；需要可信的前置快照和跨小时连续性。不能从空订单簿开始套用增量，就认定最优买卖价正确。
- [缺口与修正页](https://www.cryptohftdata.com/docs/data-gaps-and-corrections)还列出历史快照重复、空快照缺失等问题；部分修复尚未部署或无法追溯恢复。不能仅凭首页“Verified”承诺接受整个研究窗口，尤其下架/停牌合约。
- [条款](https://www.cryptohftdata.com/terms)允许个人和公司内部研究，允许本地保留及备份，标准许可禁止把原数据再分发或嵌入对外数据服务。对本仓库内部研究是候选，不把下载文件提交到 Git 或对外发布。
- 原生框架不动；若最终采用该格式，需要薄格式适配及原生订单簿/报价转换，尚未实现产品导入。样本和检查结果位于 `/tmp/trade-public-quotes/`。2025 小时下载体 SHA-256 为 `75c7f88b46ca6812aea93cfc878d818c1e18c53e26b5a8b2dab0f97c662b3fce`，2026 小时为 `6b7259ac1f0f015b3f372a14c2b7e3d8912aaf8cb10db84bfc33369b03805eed`。

### Hugging Face 的实际公开包

- [predict-quant/binance-future-orderbook](https://huggingface.co/datasets/predict-quant/binance-future-orderbook/tree/main)：标注 Apache-2.0，有 BTC/ETH/SOL/XRP 的 20 档数据。目录实查 BTC 33 天（2026-03-05 至 04-07），ETH 30 天（同范围），SOL 27 天、XRP 32 天（至 04-08），均非完整连续年度。已实际下载 BTC 2026-03-05 的 448,460 行样本，包含 snapshot、depthUpdate、E/T、U/u/pu、买卖档位；没有独立采集接收时间字段。可用于工程交叉验证，不能补齐当前整年窗口。
- [delmiron27/cryptolake-binance-futures-btc](https://huggingface.co/datasets/delmiron27/cryptolake-binance-futures-btc)：确有大量 20 档快照、交易、资金费文件；说明为 Cryptolake 订阅采集的镜像，声称约 2024-11 至 2026-06、可能有缺口，许可仅标为 other。授权与实际逐日覆盖尚未确认，不把公开可下载当作可直接正式使用的证明。
- 另查到 `mad0g4/l2_orderbook_binance`，文件为 `.enc` 加密，未见明确许可；`AJKLABS/fincept-crypto-lake` 的 Binance bookDepth 是聚合深度类别，不是所需 BBO；OpenMarket 发布的 Binance 部分是现货且日期有限，不能替代本产品的合约行情。仅有采集器代码或继续镜像 Binance 公共旧档案的项目，也不能补回停供后的报价。

初步判断（下方扩展验证前）：先验证 CryptoHFTData 的可信起始快照、跨小时序列和研究窗口覆盖，再决定正式接入；保留 Tardis 免费样本作为独立对照，暂不推进采购。扩展验证已发现阻止当前窗口验收的实际缺口，详见下节。

## 扩展验证：当前整年窗口不通过

用户要求完整验证后，以当前文档中的 BTCUSDT 研究输入窗口 `[2025-10-01, 2026-10-01)` UTC 为验收对象。结论是：CryptoHFTData 的时间粒度满足分钟研究，但已下载的研究首日内容不能建立连续可信的订单簿，因而目前不能作为该整年窗口的合格输入。此结论不推广为所有日期或合约都不可用，也没有把未检查的全年文件标为通过。

### 实际下载并完整扫描的前置日及研究首日

- 逐行扫描 2025-09-30 与 2025-10-01 的全部 48 个小时，共 212,098,338 行；研究首日为 108,559,553 行。所有 2880 个分钟都有更新，最大消息间隔约 10.669 秒，接收时钟无倒序，交易时钟没有晚于接收时钟的行。
- 48 小时内完全没有 snapshot。47 个跨小时边界的 `pu -> u` 衔接均连续，但小时内部发现 7 次序列断裂：前置日 11:06、12:06、19:47；研究首日 08:07、12:07、16:37、17:16（UTC）。不能用跨小时通过掩盖小时内部失败。
- 研究首日第一处断裂：08:07:06.028959625 的 `u=8736505467467`，下一消息于 08:07:08.203481810 到达，其 `pu=8736505602356`。两者不相等。即使此前取得过更早快照，也不能据此继续确认断裂后的订单簿；该日余下文件没有恢复快照。
- 对含该断裂的 08 点文件重新请求下载，内容 SHA-256 两次均为 `7a2bfd31bb257120d8642c1ab8632415e4a774367cb82c331148a14fca69751e`，26,197,374 字节。缺口可以在同一下载体上复现，没有通过补值、插值或忽略序列检查修复。
- Binance 的[USD-M 本地订单簿官方规则](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly)要求后续消息 `pu` 等于上一消息 `u`，否则重新取得快照。发布方的[缺口说明](https://www.cryptohftdata.com/docs/data-gaps-and-corrections)也要求断链后废弃旧簿、从新快照恢复。因此“缺了几秒但仍有每分钟消息”不足以批准此数据用于强平。

工作副本与回执：`/tmp/trade-public-quotes/window-verification.json`、`confirmed-sequence-gaps.json`、`refetch-verification.json`；各小时下载体、解压文件、内容哈希和消息序列扫描在同目录 `expanded/`。适配脚本均为 `/tmp` 工程脚本，没有发布为产品导入器。

### 有效快照文件的原生接入验证通过

另外完整下载 2026-09-30 23 UTC 和 2026-10-01 00 UTC 两个连续小时。第二小时在研究窗口之外，只用于跨边界工程验证，不把它计为研究输入覆盖。

- 共 9,456,198 行，包含两个完整小时起始快照，分别有 20,544 与 23,581 个档位行；按完整消息应用到固定版本的 Nautilus `OrderBook(L2_MBP)`，没有搭建第二套订单簿引擎。
- 第一小时末的原生全档位状态与第二小时起始快照逐价格、数量完全相等，不只是比较最优一档。原生检查没有交叉簿、空最优档、序列断裂或接收时钟倒序。
- 生成 270,902 条真实 `QuoteTick`，保留交易时钟与采集接收时钟；快照没有交易时钟时保留其交易所事件时钟，不伪造网络延迟。价格 1 位、数量 3 位的转换均检查精确相等，没有四舍五入。120 个分钟均有有效报价，最大消息间隔约 0.306 秒。
- 写入官方 `ParquetDataCatalog` 并逐条读回，价格、数量、双时钟和次序完全相等。报价语义 SHA-256 为 `ac47738ee6bbdf4309bfd0a6848572a54a8e6febfdb53bd3179933ce001acf4d`。
- 同一报价输入运行关闭强平的多头、启用强平的多头、重复多头与健康空头。100000 USDT、IM=2%、MM=1.95%、leverage=1、名义入场目标 450 万为工程触发参数；普通费率为该工程沿用的假设，均不代表币安历史保证金档位或已批准产品条款。
- 启用后出现 3 笔原生只减仓 IOC 成交，旧入场挂单在首笔强平成交之前或同刻取消，仓位从 53.796 BTC 减至 51.133 BTC。首次触发前权益约 87588.124684，原生维持保证金 87748.69715820；期末权益 87443.23581255，高于维持保证金 83404.97679735。关闭强平与健康空头均没有强平成交。
- 16 项工程核对通过，覆盖完整报价回调、原生触发、先撤旧单、只减仓 IOC、每笔强平成交前保证金越界、数量守恒与不反手、成交价侧边界、费用、原生持仓盈亏与账户余额、恢复到维持保证金以上、同一输入的经济事件及关联重现。
- 另有 6 项适配器工程核对通过：无快照的真实增量不产生可接受报价；真实快照可启动；连续增量可继续；注入的序列错误使簿失效；后续增量不能静默恢复；新的真实快照才恢复。注入错误只用于工程故障测试，没有进入真实市场输入或产品检查。

最初复用上一探针的多头挂单价 90000，在本次约 83648 的行情下立即成交，因而无法验证“撤旧挂单”。保留该次失败核对和脚本为 `native-probe-initial-verification.json`、`native-probe-initial.py`；随后把工程挂单价改为 50000，真实保持挂单后重新运行并通过，没有删去检查条件。

本轮仍发现前述随机强平单 UUID 的既有比较问题：按确定性 venue-order 身份对齐后五份报告及关联相同，当前产品比较器的 orders、fills、positions、order_events 四份指纹仍不同。工程核对通过不等于正式封存复现通过；没有更改比较器或审计。

结果位于 `/tmp/trade-public-quotes/native-reconstruction.json`、`native-verification.json`、`gap-handling-verification.json`、`native-identity.json` 和 `runs/`。固定依赖为 Nautilus 2.0.0rc3，本机 `uv run --frozen`；依赖锁 SHA-256 为 `88d7328814e989d27ff51d48d633d8ee5815dbc0f2012febb06123131aa717d8`。这些是宿主机原生工程验证，不是 digest-pinned CI 镜像的正式研究回放，也没有资格收益结论。

### 全年覆盖检查的实际边界与下一步

全年预期 8760 个小时。匿名接口实际检查了 131 个小时对象的下载响应及文件头，均可取得；其余 8629 小时没有标为已验证。检查次序先逐日零点，不能称为连续检查了 131 小时。发现研究首日的确定性内容缺口后停止继续枚举：其余文件即使全部存在，也不能修复已确认的断链与缺少恢复快照。全年逐行完整性没有通过或完成。

当前验收为“不通过，等待来源补齐或更换”，不通过调低审计标准接入，也不把旧报价跨越断链继续用于强平。后续可核实发布方是否另有未发布的历史恢复快照/修正版，或者选择能覆盖所需期间的其他来源；未联系发布方、购买服务、创建账户或使用凭据。只有来源能解决这些已确认缺口后，继续全年逐文件与逐消息检查才有验收意义。

本轮只更新调查记录。没有修改原生依赖、市场表、产品导入器、运行器、比较器或活动账本，没有新存储字段。未运行产品全量单测；实际执行的是上述扫描、原生接入与工程核对。

## 发布方补齐能力的公开确认

用户要求进一步确认后，查到发布方 2026-09-11 的[快照说明](https://www.cryptohftdata.com/blog/missing-orderbook-snapshots)，其中直接表示：正在从最后一个真实快照重放并检查序列，回填历史小时边界快照；工作尚未完成，部分真实缺口不能修复。对缺少锚点或断链的具体 exchange/symbol/UTC hour，要求联系支持团队调查。因此可以确认存在回填工作，不能确认本轮已发现的 2025-10-01 BTCUSDT 缺口能补齐，更没有找到这些目标时段已修复的公开回执或完成时间。

- 发布方还给出了“从空簿重放、丢弃首分钟”的样本经验。这不等于对当前整年输入的正确性承诺，也不恢复断链丢失的变化；本轮没有据此放宽快照与序列验收。
- 下载其原版 `examples/orderbook_warmup.py`（SHA-256 `3f0940ad611effd8a39b48039c02517f3634616f93d576b37b1b9959cc72ab70`），检查源码后直接使用未修改的 `Sequencer` 和消息分组器复核实际 2025-10-01 08 UTC 文件。接受 8209 条消息后，同样报错 `Binance chain broken: pu=8736505602356 expected 8736505467467`。不是本项目自定义分组或检查额外制造的断链结论。
- 再次下载该小时，SHA-256 仍为 `7a2bfd31bb257120d8642c1ab8632415e4a774367cb82c331148a14fca69751e`，当前公开对象没有变化。发布方说明的历史更正会替换同一对象键；尚未取得目标小时的已修正版。
- 官方脚本特别提示：部分真实快照分两段写出，`received_time` 可能不同；应以 snapshot 的 `event_time` 和序列身份分组，不能泛化本轮两个单一接收时间的小时边界快照探针。若继续实现正式适配器，需要覆盖此情形。该注意事项不影响已确认完全没有 snapshot 的 48 小时，也没有改变当前工程样本结果。
- [官方联系页](https://www.cryptohftdata.com/contact)提供 `support@cryptohftdata.com` 及支持表单，公开表示通常一个工作日内审阅，数据调查可能需要更多核验。这是渠道声明，尚未收到人工回复。

公开页面原件及其哈希、官方脚本复核与最新下载身份保存在 `/tmp/trade-public-quotes/provider-confirmation-sources.json`、`provider-confirmation.json` 和 `provider-orderbook-warmup.py`。针对七处断链、恢复快照路径、修复可能性、回填进度和历史质量回执的英文询问已准备于 `/tmp/trade-public-quotes/provider-support-inquiry.txt`，尚未发送。

## 再查 Hugging Face 与其他公开归档

用户继续要求寻找归档更完整、数据质量更可靠的公开替代。2026-10-24 通过 Hugging Face 公共目录 API、仓库完整文件清单、固定 revision 的 README 与实际样本复查；同时搜索 GitHub、学术归档和交易所公开历史页。当前没有找到已经验证能覆盖 `[2025-10-01, 2026-10-01)`、同属 Binance USD-M 且可直接验收的公开版本。此处是所查来源的结论，不声称互联网不存在其他数据。

| 来源 | 实查归档 | 当前判断 |
| --- | --- | --- |
| [delmiron27/cryptolake-binance-futures-btc](https://huggingface.co/datasets/delmiron27/cryptolake-binance-futures-btc) | revision `7c027b47b1d8a9e735fc559edc960e2bcfde3206`，book 共 379 个日期，2025-05-09 至 2026-06-02；当前研究窗口有文件的日期为 234 天 | 真实 20 档独立快照，值得作为局部核验候选；中间缺 11 个日期、尾部也未覆盖，许可仅标 other，不能认作完整年度无缺口版 |
| [delmiron27/recorder-binance-futures-btc](https://huggingface.co/datasets/delmiron27/recorder-binance-futures-btc) | revision `d7f07ce571742e48c5948684106816fde5fa332c`，BTCUSDT depth_snapshot 与 book_checkpoint 各 1574 个小时文件，2026-06-01 至 2026-08-05；另有增量、原始记录及 integrity_gap | 归档结构较可审计，但期间有限；有真实质量告警，须结合恢复行为核验，不因有告警就断言后续都错误，也不因 README 宣称质量高就接受 |
| [predict-quant/binance-future-orderbook](https://huggingface.co/datasets/predict-quant/binance-future-orderbook) | revision `b8590b83452d7a32fbb274ff7741b6db000b3984`；BTC 33 个日期，2026-03-05 至 04-07 | 仍仅短期样本，不覆盖全年 |
| [tripudium/tardisdata](https://huggingface.co/datasets/tripudium/tardisdata) | revision `7667f0ff15a6eed69654862fe786c1f70ae3d3d2`；75 份 BTCUSDT book_snapshot_25，2025-04-01 至 06-14 | 确有 Tardis 格式的公开快照包，但在当前窗口之前；镜像授权不能只凭上传者标注推定 |
| [skyler210/binance](https://huggingface.co/datasets/skyler210/binance) | revision `c7a70856b4231972196ab6237592f29a4dab1f1b`；BTC orderbook 3362 个小时、141 个日期，2026-06-01 至 10-19 | 样本证实是 CryptoHFTData 的现货镜像，不能补永续报价；并非独立修复版 |

### 新样本的实际证据

- Cryptolake 的研究首日文件下载 84,568,523 字节，SHA-256 `8f8d74ddefdc664c5f3f17be516056acc1e236809192b08cc7f4ff68292951f5`。784,167 条 20 档快照，接收时间覆盖当日 1440 个分钟，最大相邻正向接收间隔约 7.652 秒，无锁定/交叉 BBO、非正最优数量或事件晚于接收时钟。文件 metadata 明确 `contains_gaps=Yes`，物理行序有 1197 处接收时间及序列倒序。这是独立快照，可研究按真实接收时间规范排列；倒序不等同于这些快照全都错误，但尚未完成其排序、精度与全窗口验收，不能称无问题。
- Cryptolake 当前窗口中间缺少的目录日期为 2026-02-05、05-08、05-11、05-12、05-15、05-20、05-21、05-22、05-27、05-28、05-29。即便与新找到的 skyler 目录仅按日期合并，仍缺这 11 天；更重要的是 skyler 已证实为现货，该合并只有目录诊断含义，没有合约输入合法性。
- Recorder 实际抽取 2026-06-01 05 UTC 的 depth_snapshot、book_checkpoint 以及 06 UTC 的 integrity_gap。元数据确认 `binance_futures/BTCUSDT`，含采集、交易所事件与交易所交易三时钟字段。该 06 UTC 的 17 条质量记录中，13 条为 `rest_depth_drift_qty_mismatch`，另有各 2 条 `rest_depth_drift_missing_rest`、`rest_depth_drift_missing_local`；它们提示需核实重置恢复，不能直接授予全时段正确结论。
- Skyler 2026-09-30 23 UTC 文件实际为 4,313,912 字节，SHA-256 `42c7dd7031e61f06fc949518c4d4723297d9d38514c56854daa415ec28c101a5`；从 CryptoHFTData 的 `binance_spot/2026-09-30/23/BTCUSDT_orderbook.parquet` 再下载，字节哈希完全一致。没有把同币种现货当成永续、或者把镜像更名当成修复。
- [tmmycruise/autoresearch-crypto-data](https://huggingface.co/datasets/tmmycruise/autoresearch-crypto-data)虽有较细的来源 manifest 和 coverage report，但实际 UM/BTC bookTicker 目前仅查到 2023-05 至 09 五个月分区，coverage 仍 `finished=false`。其来源仍为 Binance Vision，不能补回停供后的 2025–2026 BBO；聚合 bookDepth 也不替代报价。其他查到的 Hyperliquid 1m/5m 样本、Polymarket/Kalshi 订单簿、现货包、加密文件和股票 L2 均不满足本轮合约与输入范围。

发现和验证回执在 `/tmp/trade-public-quotes/hf-broad-discovery.json`、`hf-deep-candidates.json`、`hf-additional-candidates.json`、`hf-combined-coverage.json`、`hf-sample-downloads.json`、`hf-snapshot-scan.json`、`hf-recorder-gap-scan.json`、`hf-skyler-source-check.json`。HF API 检查是文件目录覆盖，未把它表述为逐小时或逐消息质量通过。Kaggle 匿名目录 API 返回 404、Zenodo 查询 API 返回 400，相关仓库只作网页搜索，不冒充已完整枚举。未购买、注册或发送外部消息。

若允许另定研究场所，[OKX 官方历史页](https://www.okx.com/historical-data)公开列有自 2023-03 起的高分辨率 L2 历史，可另行验证其具体合约、日期、下载与质量。但那是新的研究环境，不能把 OKX/Bybit 行情拼入当前 Binance 永续回放。本轮没有切换场所或更改任何产品边界。
