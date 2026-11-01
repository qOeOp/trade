# 市场页：全币圈热力图与板块、币种下钻（计划）

2026-11-02 用户提出：IDE 里要有一个像 CoinGlass 那样看整个币圈的全局视图。热力图是必需的，
**BTC、ETH 这些币就是热力图上一个个矩形**；热力图的做法参考本地 vibe-trading 项目，但格子里不画 K 线；
下钻到板块时显示这个板块有用的相关信息，也能下钻到币。用户随后要求数据源**向外详细调查**，不局限于
现有数据。

用户看过本计划初稿后答「可以的」（2026-11-02），并说后续要实现这个新页面，现在最重要的是预览图和计划。
预览图见第 10 节。

本文是动手前的计划：先说结论和页面，再列数据源（第 4 节，2026-11-02 在本机逐个实测）、与研究的边界、
**需要用户授权的事和本文已定的取舍**（第 7 节），实施按第 8 节分步，每步一个 PR。

## 结论

- **IDE 新增 Market 页**，和 Runs 页一样占编辑区。热力图照 vibe-trading 的下钻热力图做：**一次只画一层**，
  每层是一组平铺的大矩形，不把 518 个币一次铺满（那样大多数格子只有十来像素，既难看又没信息）。
  面积默认按市值，可切换为持仓量（OI）或 24h 成交额；颜色按涨跌幅，窗口可选 1h / 4h / 24h / 7d，
  也可改成按资金费率或 OI 变化着色。
- **逐层下钻**：全市场（约 11 个板块矩形）→ 板块（二级板块矩形；币少的板块直接是币）→ 二级板块（币矩形，
  BTC、ETH 这些币在这一层是一个个矩形）→ 选中币。每层的矩形都大到能放下内容：板块矩形里列龙头币、
  市值占比和涨跌家数，币矩形里列价格、OI、资金费率。右侧 Details 显示这一层的汇总：全市场的总览、板块的
  涨跌分布、资金和爆仓、消息，币的跨交易所衍生品数据、公告和消息，以及**交易它的模拟盘运行**。
- **币的范围 = 币安 USDT 本位永续**（实测 522 个在交易，去掉指数、盘前合约和稳定币后 518 个），也就是我们研究和模拟盘的
  交易范围。
- **全部用免费、不需要凭据的公开接口**（第 4 节）。CoinGlass 的核心指标里只有两样免费拿不全：
  币安的完整爆仓额（币安自己的推送每秒只给一条），以及 ETF 资金流。
- **新增一个只读进程 `ide/overview`**（Node 24 直接跑 TypeScript，与 `ide/agent` 一样），放在 ide 容器里，
  页面通过 `ide.py serve` 的 `/api/overview/` 访问。它**不写账本、不写市场库、不存研究数据**，
  数据只在内存里；它的数字不是研究证据，也不进入回放和策略。
- **需要用户授权的只有两件事**：继模拟盘之后的第二条实时公开行情连接（AGENTS.md 只授权了模拟盘那一条），
  以及每步合并后重建 ide 容器（第 7 节）。其余取舍本文已定，写在第 7 节末尾，用户可以推翻。

## 1. 页面

**入口。** **Market 是左侧边条的第一个按钮**（用户 2026-11-02 定），其后依次是现有的 Versions（⌥1）、
Sources（⌥7）、Runs（⌥8）。左侧四个按钮互斥：选中 Market 时左侧工具窗关闭，编辑区整块是市场页。⌥0–⌥9 已全部占用，Market 和下面两个工具窗不设快捷键，从命令面板也能打开。
页面和研究线无关，换研究线不影响它。页面启动时请求一次 `/api/overview/health`：服务没配（serve 不带
`--overview`，或 `ide.py render` 渲染出的独立文件）就不显示 Market 按钮；配了但没答，按钮显示离线。

**布局。**

- **顶栏**：搜索（输入币名直接跳到它所在的那一层并选中），以及两个切换：
  - Size：Market cap / Open interest / Volume 24h
  - Color：一个下拉选指标（Change / Funding / OI change 24h），选 Change 时旁边是窗口 1h / 4h / 24h / 7d
- **编辑区**：热力图，标题行是面包屑（`All › DeFi › DEX`，点上层返回）和色阶图例。
- **右侧 Details**：随当前层级和选中的币变化（第 3 节）。
- **底部两个工具窗**（和 Trades 一样由页面供数，但只在市场页出现，不进其他页面的边条）：
  - **Coins**：当前层级所有币的可排序表（价格、各窗口涨跌、市值、OI、OI 变化、资金费率、多空比、24h 爆仓）。
    表和图选中联动。
  - **News**：当前层级的消息和公告（第 3.4 节）。
- **涨跌口径**：1h、4h 是现价对 1h、4h 前那根 5 分钟 K 线收盘价的变化，7d 用 4 小时 K 线，24h 用币安的
  滚动 24h 行情；所以 1h、4h、7d 的误差在一根 K 线之内，K 线每 15 分钟更新一遍。
- **状态栏**：每类数据最后更新的时间，失败的那类显示红色标记和原因，旧数据继续显示。
  爆仓这一类写明「自 HH:MM 起记录」。

**颜色。** 涨跌一律用已定的 TradingView 色 `--candle-up` / `--candle-down`（用户 10-27 决定），不用
vibe-trading 的红涨绿跌。色阶为 7 档，从跌经灰到涨：中间灰档很窄（24h 为 ±0.1%），每边三档，24h 的边界是
0.1 / 1 / 2.5%，1h 和 7d 按比例收窄和放宽。三档用涨跌色和格子底色按固定比例混合（暗色主题跌 40 / 68 / 100%、
涨 50 / 80 / 100%，亮色主题跌 40 / 80 / 100%、涨 50 / 88 / 100%），不混黑色，避免相邻两档看不出差别。
图例固定显示边界。资金费率和 OI 变化用同样的发散色阶。资金费率的数字只在绝对值不小于 0.03% 时上色。
亮、暗两套主题都要过对比度检查。

**标注来源。** 页面底角写 「Market cap: CoinGecko」，恐惧贪婪指数旁边写 alternative.me，这两家都要求标注。

## 2. 热力图（参考 vibe-trading）

参考 `vibe-trading/apps/web/src/features/market/`（`hooks/use-treemap.ts`、`components/treemap/`），按本仓的
React 19 + visx 重写，不搬它的 mock 数据和 A 股语义。vibe-trading 当初做下钻就是为了解决平铺热力图「小方格
又丑又没信息量」的问题，这里照它的思路：**每层一组平铺的矩形，而不是全部币按板块分组铺满一屏。**

**层级。**

| 层 | 矩形 | 例子 |
|---|---|---|
| All | 一级板块，约 11 个 | PoW、Layer 1、DeFi、Meme、AI … Other 放最后 |
| 板块 | 二级板块（第 4.1 节的表） | DeFi：Derivatives、DEX、Lending、Liquid staking、Yield、Other DeFi |
| 二级板块，或币不到约 25 个的板块 | 币 | DeFi › DEX 的 23 个币；PoW 的 15 个币，BTC 是其中一个矩形 |

- **每层的矩形数有上限。** 币层按面积权重排序，权重占比不到 2% 的尾部合成一个「+N more」矩形（尾部只有
  一两个币时不合并），点它展开成下一层。实测 DEX 23 个币显示 19 个加一个「+4 more」。
- **板块矩形的颜色**是板块内币的**市值加权**涨跌幅，和徽标上的数一致；涨跌幅**中位数**和涨跌家数放在矩形底部
  与 Details 里，免得「PoW 绿色但 12 个币在跌」这种读数互相打架时没有解释。

**布局**（照 `use-treemap.ts`）：

- 每层一次 D3 squarify，`ratio(1)`，`padding(2)`，外边框 2px；纵向先拉伸 1.35 倍再压回，让矩形偏横向，
  好放一行行文字。本仓用 `d3-hierarchy`，不引入整个 d3。
- **面积压缩**：矩形面积按指标的 0.4 次方（vibe-trading 用 0.8 次方，但它的值是指数权重；市值跨度大得多）。
  预览图里 All 层 PoW 和 Layer 1 各占约四分之一，最小的板块也能放下名字和徽标。指数在第 1 步用真实数据再定，
  写进图例旁的提示。
- **悬停放大**：照搬 `calculateRippleLayout`、`elasticRedistribute`、`buildSplitLineStructure`：被悬停的小矩形
  放大到 `getTargetSize`（画布宽高各除以 min(4, √n)），周围矩形沿分割线弹性让位，每格至少保留 60px。
  因为每层只有十几到二十几个矩形，正是这套算法设计时的规模，**可以原样用**，不用再分组限制。
- **自适应文字**：`getAdaptiveStyles` 按面积在本层最大、最小矩形之间插值字号（9–28px）、粗细、留白和徽标；
  高明显大于宽时竖排；最短边不到 50px 时只留名字和徽标。圆角只给贴着容器四角的矩形（`getBorderRadius`）。

**矩形内容**（空间够才加下一行，按优先级）：

- **板块 / 二级板块**：名字和下钻箭头、市值（右上）；龙头币最多 8 个，每行是代码、占板块市值的比例条、
  涨跌幅；矩形够大时底部加一块 OI、资金费率、7d、24h 成交额；最底一行是「N up · M down」和涨跌徽标。
- **币**：代码、市值（右上）；价格和全名；OI、资金费率、24h 成交额、7d（BTC 另加多空比）；最大的币矩形再加
  「各交易所 OI 占比」条；右下是涨跌徽标。
- 悬停的矩形加描边和阴影，选中的币加粗描边。

**不搬的部分：**
- 格子里的 K 线（`candlestick-sparkline`），按用户要求去掉；也不用别的走势小图代替，空间留给上面的数字。
- A 股的资金流字段。
- 进出场动画。

## 3. 下钻：每层显示什么

### 3.1 全市场（All）

右侧 Details 分块：

- **大盘**：总市值、BTC 占比、24h 变化（CoinGecko `/global`）；恐惧贪婪指数（alternative.me）。
- **衍生品**：全市场 OI 及 24h 变化、OI 加权的平均资金费率、24h 多头和空头爆仓（第 4.3 节）。
- **涨跌分布**：涨和跌的币数；按板块列出涨跌幅中位数，排好序，点一行就下钻到那个板块。
- **领涨领跌**：前 5 和后 5。
- **其他**：稳定币总供应及 7 天变化（DefiLlama）、Coinbase 溢价和韩国溢价（自己算）、
  BTC 期权 OI / 最大痛点 / DVOL（Deribit）。这些放第 8 节第 5 步。

### 3.2 板块

- 市值加权涨跌幅（和矩形颜色一致）、涨跌幅中位数，以及币数（涨 / 跌）。
- 板块内的 OI 合计和变化、平均资金费率、24h 爆仓（多 / 空）。
- 领涨领跌；二级板块 × 1h / 24h / 7d 的涨跌中位数小热力表（All 层同样有一张一级板块的）。
- 板块里的币最近的公告：上新、下架、杠杆或档位调整。
- 交易这个板块里的币的模拟盘运行（第 3.5 节）。

### 3.3 币

- 价格，各窗口涨跌，市值、FDV、流通量。
- **跨交易所衍生品**：Binance、Bybit、OKX、Bitget、Gate、Hyperliquid 各自的 OI 和资金费率（表格），
  以及合计。
- 多空比（Binance 账户比，并附 OKX / Gate 作为第二来源），24h 多 / 空爆仓（分交易所）。
- 公告（各交易所）和消息（第 3.4 节）。
- 模拟盘运行（第 3.5 节）。
- Details 里有一条 7 天价格线（只有收盘价，不是 K 线），格子里不画。

### 3.4 消息与公告

- **全市场消息流**：
  - 英文 RSS：CoinDesk、Cointelegraph、The Block、Decrypt、Blockworks；
  - 中文 RSS：Odaily 快讯、PANews；
  - 按链接去重。
- **挂到币上**：
  - 主要靠 Binance Square 新闻流，每条自带 `tradingPairs`；
  - RSS 的条目按币代码和币名匹配标题，作为补充；
  - 挂到板块，则通过币所属的板块。
- **交易所公告**：
  - Binance：CMS 目录 48 新币和合约上线、161 下架、49 最新动态（含杠杆、档位、tick size）；
  - Bybit `/v5/announcements/index`（new_crypto、delistings）；
  - OKX `/api/v5/support/announcements`（新币、下架、交易规则更新）；
  - Upbit、Bithumb 公告（韩国上币）。
- **只显示标题、来源、时间和链接**，不抓正文。每 1–5 分钟轮询一次。

### 3.5 模拟盘运行

- **模拟盘运行**：`/api/paper/` 的运行带 `symbols`，可以直接列出交易这个币的运行（在跑的在前），点一下跳到
  Runs 页。这是现有的只读路径。
- **市场库覆盖不放在这一页**：预览图的审美评审认为它和行情无关、挤占 Details，覆盖缺口已由 research-start
  报告（#2040）。所以 serve 也不加 `/api/coverage`。
- **研究线和候选交易哪些币**：视图里没有合约字段（`report/graph.py`、`ide/schema/graph.schema.json`），候选的
  合约只在策略源码里。要显示就得给视图加字段，按 AGENTS.md 先做字段评审。本计划**不做**，以后需要再单独提。

## 4. 数据源（2026-11-02 本机实测）

本节所有接口都用 `env -i … curl` 实测过，没带任何 key。本机是大陆线路，表中 HTTP 状态是本机看到的。
原始记录在当次会话的 scratchpad 里，不入库。部署到服务器前要在那台机器上再测一遍连通性：GitHub 托管
runner 访问 fapi 返回 451，本机可以访问不代表别处也行。

### 4.1 币的范围和板块

- **范围**：Binance `GET /fapi/v1/exchangeInfo`，筛选 `contractType=PERPETUAL`、`status=TRADING`、
  `quoteAsset=USDT`、`underlyingType=COIN`，再去掉稳定币（USDC 等，和市场库的币池规则一致）。快照里是 518 个；
  BTCDOM 这类指数合约、盘前合约和 TradFi 合约在 `underlyingType` 这一步就被排除了。
- **一级板块**：同一接口的 `underlyingSubType`。除了通用的 `Crypto` 和 `Alpha` 两个标签，每个币**最多一个**
  板块标签：427 个恰好一个，95 个没有。共 14 种：DeFi 111、Infrastructure 59、AI 56、Layer-1 49、Meme 46、
  Gaming 27、Layer-2 21、PoW 15、NFT 10、Metaverse 9、Payment 7、Storage 5、Chinese 5、RWA 4。
  我们把这 14 种合并成约 10 组（比如 NFT 和 Metaverse 合并、Storage 并入 Infrastructure）。
  没有标签的 95 个，按 CoinGecko categories 的固定顺序补；补不上的归 Other。
- **二级板块**：**没有任何免费接口提供多级分类树。** CoinDesk DACS 和 21Shares/CoinGecko 的 GCCS 都是
  三级分类，但只有 PDF，没有逐币数据；Datonomy 收费。所以我们自己维护一张小表：从 CoinGecko 的 1051 个扁平
  categories 里挑 30–40 个作为二级，例如 DeFi 下分 Derivatives、DEX、Lending、Liquid staking、Yield，其余归 Other DeFi，Meme 下分
  Dog / Frog / Cat、Solana Meme，AI 下分 AI Agents。一个币可能属于多个 category，按表里的顺序取第一个命中的。
  层级和命名参照 DACS。这张表是页面的显示配置，放在 `ide/overview/` 下，进 Git。
  成员关系每天拉一次：对每个选中的 category 调 `/coins/markets?category=…`，每个约 1–2 页（预算见 4.2）。

### 4.2 市值（面积）

- **CoinGecko，不用 key**：先用 `/derivatives/exchanges/binance_futures?include_tickers=unexpired` 把每个合约
  映射到 `coin_id`，522 个里映射上 520 个，缺的是 BTCDOM（指数）和 ALL。再用 `/coins/markets?ids=`
  每次 250 个、3 次覆盖全部，取市值、FDV、流通量，511 个有市值。
- **限速**：没有 key 时实测连续约 5 次就开始 429，间隔 20–25 秒一次可以稳定访问。所有 CoinGecko 请求排进
  **同一条队列**，每 25 秒最多发一个，每小时 144 个名额：市值每 10 分钟 4 次（每小时 24 次）、`/global` 每
  10 分钟一次（6 次）、二级板块成员每天 40–80 次（在空闲名额里慢慢发），合计用不到一半。遇到 429 就整条
  队列暂停一分钟。
- **需要修正的映射**：
  - CoinGecko 把 1000SHIB、1000BONK、1000RATS、1000SATS 映射到了没有市值的「1000x」包装代币，
    用一张 CoinGecko id 改正表改正（一次性对照 CMC 的映射就能找出来）；
  - 改过名的代币（BEAMX、LUNA2、RAYSOL 等）走 tickers 映射，不按代码匹配；
  - 市值为 0 的约 9 个币，面积退回用 FDV，并在格子提示里注明。
- **不选的方案**：
  - CMC 网站接口一次能覆盖 522 个，但没有公开文档，条款有风险，只作人工对照；
  - Binance 网站接口只覆盖有现货的 360 个；
  - CoinPaprika 免费档只限个人使用，按代码匹配有歧义；
  - CMC、CoinCap、CryptoRank、CoinDesk Data 要注册拿 key；Messari 按次收费。

### 4.3 衍生品（跨交易所）

全合约接口，一次调用返回所有合约（全部免 key，实测）：

| 交易所 | 接口 | 给什么 |
|---|---|---|
| Binance | `/fapi/v1/ticker/24hr`（权重 40）、`/fapi/v1/premiumIndex` | 24h 涨跌、成交额、标记价、资金费率 |
| Bybit | `/v5/market/tickers?category=linear` | 930 个，含 OI、OI 美元值、资金费率和结算间隔 |
| OKX | `public/open-interest?instType=SWAP`、`market/tickers`、`public/funding-rate?instId=ANY` | OI（美元）、行情、资金费率（ANY 这种用法文档里没写） |
| Bitget | `/api/v2/mix/market/tickers` | 868 个，含资金费率、以币计的 OI |
| Gate | `/api/v4/futures/usdt/tickers` | 1070 个，含资金费率，OI = `total_size × quanto_multiplier` |
| Hyperliquid | `info` `metaAndAssetCtxs` | 235 个，含 OI、资金费率、昨日价格、24h 成交额 |

只能逐个合约查的：
- Binance OI `/fapi/v1/openInterest`（权重 1），522 次；
- 多空比 `/futures/data/globalLongShortAccountRatio`，单独的 IP 限额，30 天历史；
- 1h / 4h / 7d 涨跌要逐个合约取 `/fapi/v1/klines`：5 分钟 K 线 49 根、4 小时 K 线 43 根，每次权重 1。

覆盖：调查时取的是币安全部 756 个 USDT 合约（含已下架），其中只有 16 个在其他五家都没有；在交易的 522 个
基本都有第二来源。

**OI 24h 变化**：着色和合计**只用币安的 OI**，冷启动时用 `openInterestHist`（1 小时粒度，25 根）补齐过去
24 小时，所以启动后马上就有。其他五家的 OI 只在币详情里显示当前值；它们的 24h 变化要等进程连续跑满 24 小时
才有，之前显示 `—` 并注明「自 HH:MM 起」。

**爆仓**：没有任何免费的历史接口能覆盖币安，只能常驻 WebSocket 往前记录：

- **Bybit** `allLiquidation.{symbol}`：一条连接订阅了全部 USDT 合约。实测同一合约同一秒出现过两条，
  文档写推送全部爆仓，**是唯一推送全部爆仓的来源**。
- **Binance** `!forceOrder@arr`，路径必须是 `wss://fstream.binance.com/market/ws/…`（`/ws/` 能握手但收不到帧）。
  每个合约每秒最多推一条，**会低估**。
- **OKX** `liquidation-orders`（instType=SWAP 一次订阅全部）。实测 WS 收到 25 条，同期 REST 有 29 条，**有节流**。
  可以每小时用 REST 补有爆仓的币。
- **Gate** `contract_stats` 有每个合约每小时的多 / 空爆仓额，能回溯 180 天，是唯一免费又完整的历史，
  但只覆盖 Gate 自己。

页面上的爆仓数字一律写明「自 HH:MM 起，Binance 和 OKX 偏低」。进程重启后从零开始记，不补；
每次重建 ide 容器（第 7 节）都会清零，Gate 的小时数据不受影响。

**币安的请求额度。** 模拟盘（`engine/paper.py`、`engine/egress.py`）和 market-import（`market/sources.py`）
也从本机同一个 IP 访问 fapi。overview 要是被币安封 IP（HTTP 418），会连带打断模拟盘，所以额度按最坏情况算：

| 请求 | 频率 | 每分钟权重 |
|---|---|---|
| `ticker/24hr`（40）+ `premiumIndex`（10） | 每 5 分钟 | 约 10 |
| `openInterest` × 522（各 1） | 每 5 分钟一遍，错开发 | 约 104 |
| `klines` 5m × 522 + 4h × 522（各 1） | 每 15 分钟一遍 | 约 70 |
| 合计 | | 约 185，币安上限 2400 |

`/futures/data` 下的多空比和 `openInterestHist` 另有共用的限额：每 5 分钟每 IP 1000 次。多空比每 30 分钟一遍
（每 5 分钟约 87 次），冷启动的 `openInterestHist` 分 15 分钟发完（每 5 分钟约 174 次），两者合起来也不到 300。

做法：
- 每个请求读响应头 `X-MBX-USED-WEIGHT-1M`；
- overview 自己每分钟最多用 600 权重，达到就等到下一分钟；
- 遇到 429 按 `Retry-After` 退避；遇到 418 立刻停掉所有币安请求，直到封禁结束，并在状态栏报出。

其他交易所的限额都很宽（第 4.3 节表里的全合约接口每轮各一次），只设同样的 429 退避。

### 4.4 全市场面板

| 指标 | 来源（免 key，实测 200） |
|---|---|
| 总市值、BTC 占比 | CoinGecko `/global`（备用 CoinPaprika `/v1/global`） |
| 恐惧贪婪指数 | `api.alternative.me/fng/`（要标注来源） |
| 稳定币供应 | DefiLlama `stablecoins.llama.fi/stablecoins`、`/stablecoincharts/all` |
| 交易所储备和流入流出 | DefiLlama `/cexs`（只覆盖公开了钱包的交易所） |
| Coinbase 溢价 | Coinbase `api.exchange.coinbase.com/products/BTC-USD/ticker` 对 Binance 现货（再用 Kraken USDTUSD 换算） |
| 韩国溢价 | Upbit `/v1/ticker` KRW-BTC、KRW-USDT |
| BTC 期权 | Deribit `public/get_book_summary_by_currency`（OI、算最大痛点）、`get_volatility_index_data`（DVOL） |
| 山寨季指数 | 自己算：市值前 100（去掉稳定币和包装币），统计 90 天涨幅跑赢 BTC 的比例；日线用 Binance |

**ETF 资金流免费拿不到**：
- Farside 和 SoSoValue 有 Cloudflare 人机验证，我们不绕；
- CoinGlass 和 DefiLlama 的 ETF 接口要付费；
- 唯一免 key 的 BGeometrics 只有 BTC，每天限 15 次，数据滞后约 4 天，而且它的条款里关于 key 的说法自相矛盾。

所以本计划不做 ETF 资金流（第 7 节末尾）。

### 4.5 调查过但不用的

- **新闻 API**：CryptoPanic 的免费层已取消，v2 developer 路径返回 404；CoinDesk Data 自 2026-05-21 起
  停了免费档。
- **社交和情绪数据**：LunarCrush、Santiment、X、Reddit 要付费或注册。
- **链上数据商**：CryptoQuant、Glassnode、Arkham 要 key 或付费。
- **衍生品聚合商**：CoinGlass API 最低 29 美元/月；Coinalyze 要注册 key；Laevitas、Velo、Kaiko、Amberdata 收费。
- **解锁日历**：Tokenomist、CryptoRank 要注册；DefiLlama 的正式接口收费。它的前端数据接口和 CMC 的接口
  都没有公开文档。

用户 10-28 定过不查付费数据源，这里只列出来，说明为什么不用。

## 5. 结构

```
浏览器 ──/api/overview/*──▶ ide.py serve（只转发 GET）──▶ ide/overview（Node 24, 127.0.0.1:8768）
                                                              ├─ REST 轮询：各交易所、CoinGecko、DefiLlama、RSS、公告
                                                              └─ WebSocket：Bybit / Binance / OKX 爆仓
```

- **`ide/overview`**：与 `ide/agent` 平级的独立模块，Node 24 直接跑 TypeScript，只用内置的 `node:http`、
  `fetch` 和 `WebSocket`，不引入新的运行时依赖（agent 用了 hono，这里不用）。RSS 和 Atom 用一个只取标题、
  链接、时间的小解析器，不引 XML 库。不 import 产品包，不连 Dolt。
  - 对外接口：
    - `GET /api/overview/health`：页面判断服务在不在；
    - `GET /api/overview/snapshot?level=&sector=`：当前层级的格子和汇总；
    - `GET /api/overview/coin?symbol=`：一个币的详情；
    - `GET /api/overview/news?symbol=|sector=`：消息和公告。
  - 外加一个 SSE `events`：有新快照时通知页面，每 15 秒发一次心跳（serve 转发的超时是 900 秒）。
  - 每类数据独立更新、独立报错：某个源失败，只让那一类数据变旧，在状态栏显示。
- **`ide.py serve`**：加 `--overview=URL`，和 `--agent`、`--paper` 一样走 `forward()`；对它**只允许 GET**，
  其他方法回 405（这是新增的拒绝规则，写进第 7 节第 1 项的授权范围）。
- **entrypoint**：像 agent 一样在后台启动 overview。
- **出站访问**：overview 请求的主机写死在源码里，换主机要改代码过评审。但这只是代码约定，**不是隔离**：
  ide 容器本身能访问任意外网，不像模拟盘的 runner 那样经过 egress 代理（`engine/egress.py`）。要做成真正的
  边界，得给 ide 容器也加出站代理，那是另一件事，本计划不做。
- **存储**：只在内存里，不写文件、不写库。重启后 OI 快照和爆仓计数清零；OI 变化在冷启动时用
  `openInterestHist` 补，爆仓注明从何时开始记录。按 AGENTS.md，这些不是研究数据，回放给不回来也不需要
  给回来。overview 的内存数据就是一份工作缓存。
- **页面**：`ide/web/src/widgets/market/`，包括热力图、Details 的三个层级、Coins 表、News 窗。
  状态放在 `state/market.ts`。新增依赖 `d3-hierarchy`（或 `@visx/hierarchy`）。
- **要同步改的文档和 CI**：`ide/README.md` 和 `docs/rd/design-code-ide.zh.mdx` 都写着 serve 只转发 agent 和
  paper，要加上 overview；`.github/workflows/ide-web.yml` 目前只跑 `ide/agent`，要加 `ide/overview` 的路径和
  `node --test`。

**为什么要写产品代码。** AGENTS.md 的规矩是产品代码只为信任边界、缺陷修复，或 Agent 做不到的事。
常驻的 WebSocket 采集和一个持续刷新的页面，属于 Agent 在会话里做不到的；它也不碰研究流程，不碰 Nautilus 的职责。

## 6. 与研究的边界

- 这一页的数字**不是研究证据**：不写账本，不进回放、策略和市场库，研究报告也不引用。研究用的行情仍然
  只来自市场库，经它的导入和拒绝检查。
- IDE 的 Agent 聊天这次**不加** overview 工具。以后要加，单独提，并在工具描述里写明它是实时快照，不是证据。
- 不新增存储字段，所以不需要 AGENTS.md 要求的存储字段评审。

## 7. 需要用户授权的事，以及本文已定的取舍

**需要授权（AGENTS.md）：** 用户 2026-11-02 看过本节后答「可以的」，下面两项按此办理；每次重建 ide 容器前仍然先问。

1. **新的实时公开行情连接。** AGENTS.md 规定实时交易所连接要用户明示授权，目前只授权了模拟盘那一条。
   - **只读**：overview 只发 GET 请求和行情 WebSocket 订阅，不带任何凭据，不调用任何认证或下单接口；
     serve 对 `/api/overview/` 只转发 GET。
   - **主机**：
     - 交易所行情：`fapi.binance.com`、`fstream.binance.com`（爆仓推送）、`api.binance.com`（算 Coinbase 溢价
       用的现货价）、Bybit `api.bybit.com` 和 `stream.bybit.com`、OKX `www.okx.com` 和 `ws.okx.com`、Bitget
       `api.bitget.com`、Gate `api.gateio.ws`、Hyperliquid `api.hyperliquid.xyz`、Deribit `www.deribit.com`、
       `api.exchange.coinbase.com`、Kraken `api.kraken.com`、Upbit `api.upbit.com`；
     - 交易所网站（公告和快讯）：`www.binance.com`（Square 新闻流、公告 CMS）、`api-manager.upbit.com`、
       `feed-api.bithumb.com`；
     - 非交易所：`api.coingecko.com`、`api.llama.fi` 和 `stablecoins.llama.fi`、`api.alternative.me`；
     - RSS：`www.coindesk.com`、`cointelegraph.com`、`www.theblock.co`、`decrypt.co`、`blockworks.com`、
       `rss.odaily.news`、`www.panewslab.com`（具体路径在第 4 步定下后写进源码）。
   - **隔离**：如第 5 节所说，主机清单只是代码约定，ide 容器本身能访问任意外网。

   不授权的话，只能做不连交易所的部分：市值、板块、消息。热力图的涨跌也可以用 CoinGecko 的数据，但没有 OI、
   资金费率和爆仓。
2. **每一步合并后重建 `ide` 容器**。按惯例，每次重建前问你。

**本文已定的取舍（不属于要授权的事，你可以推翻）：**

- **没有公开文档的网站接口**：用 Binance Square 新闻流和公告 CMS，以及 Upbit、Bithumb 公告。量很小，只取
  标题和链接，挂失效了只影响消息那一块。CMC 网站接口和 DefiLlama 的前端数据接口不用：市值有 CoinGecko，
  解锁日历先不做。
- **二级板块**：自己维护约 30–40 个 CoinGecko category 的表（第 4.1 节）。
- **ETF 资金流不做**：免费来源只有滞后约 4 天、只有 BTC 的 BGeometrics；完整数据要你注册 SoSoValue 的 key，
  那是新增凭据，需要另行授权。以后你想要再提。
- **不做研究线、候选和币的关联**（第 3.5 节）：要给视图加字段，先做字段评审，以后再单独提。

## 8. 分步实施（每步一个 PR，基于 main）

1. **最小可用版**：
   - 先用真实数据把预览图（第 10 节）的各层跑通，定面积指数和尾部合并的阈值（第 2 节）；
   - overview 骨架（含 `/health`、币安请求额度控制），加上：币的范围、一级板块、Binance 的 24h 涨跌 / 成交额 / 资金费率、CoinGecko 的市值和 id 改正表；
   - serve 转发和 entrypoint；
   - Market 页：逐层热力图（Size 和 Color 切换、悬停放大、自适应文字、「+N more」）、面包屑和下钻、
     选中币、Details 的基本汇总、Coins 表。二级板块在第 2 步表格就位前，板块层直接显示币。
2. **衍生品**：跨交易所 OI 和资金费率、OI 24h 变化（含冷启动补齐）、1h / 4h / 7d 涨跌（K 线）、多空比，
   币详情里的跨交易所表；二级板块表。
3. **爆仓**：Bybit、Binance、OKX 三路 WebSocket 加 Gate 小时数据；全市场、板块、币三层的爆仓汇总，
   以及「自 HH:MM 起」的标注。
4. **消息与公告**：RSS、Binance Square、各交易所公告；News 窗和三层过滤。
5. **全市场面板**：总市值和 BTC 占比、恐惧贪婪指数、稳定币供应、两个溢价、Deribit 期权、山寨季指数；
   ETF 资金流不做（第 7 节）。
6. **模拟盘运行**：币和板块详情里交易它的模拟盘运行，点一下跳到 Runs 页。

## 9. 验证

- **overview**：`node --test` 覆盖以下纯函数，用录下来的真实响应做夹具：
  - 范围筛选、板块合并和补齐；
  - CoinGecko id 改正表（四个 1000x 合约）；
  - 币安额度控制：权重计数、429 退避、418 全停；
  - 各交易所 OI 的单位换算（币数、张数、美元）；
  - 爆仓的方向（Bybit `S=Buy` 表示多头被爆）和去重；
  - 某个数据源失败时只让那一类变旧。
- **serve 转发**：沿用 paper 和 agent 转发的现有测试方式，加上 POST 回 405 的用例，以及不带 `--overview`
  时页面不显示 Market 按钮。
- **页面**：`npm run check`。在内置浏览器里截亮、暗两套主题，分别在 All、板块、二级板块（币）三层，
  以及悬停一个小矩形时的放大；对照第 10 节的预览图。交付前由子代理做一次审美评审。
- **实测**：每一步都在本机对真实接口跑一轮，核对几个币的数值和交易所网页一致（例如 BTC 的 OI、资金费率），
  并记下各源的请求量。
- **单元测试**按 AGENTS.md 跑全套：`uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`、
  `ruff`、`mypy`。

## 10. 预览图

2026-11-02 做的高保真预览图，放在主检出的 `.review-shots/market/`（未入库的工作副本）。页面源码是
`.review-shots/market/mock/index.html`，用当天一次性抓下来的真实快照（518 个合约、六家交易所的 OI 和资金费率、
CoinGecko 市值和 categories、RSS、Binance 公告、本机模拟盘运行），直接用浏览器打开，地址参数 `view=all|sector|dex|coin`、
`theme=light|dark`、`hover=<矩形名>`。

| 图 | 层级 |
|---|---|
| `v2-all-dark.png`、`v2-all-light.png` | All：11 个板块矩形 |
| `v2-defi-light.png`、`v2-defi-hover-dark.png` | DeFi：6 个二级板块；暗色图里悬停 Yield，周围矩形让位 |
| `v2-dex-dark.png`、`v2-dex-light.png` | DeFi › DEX：19 个币加「+4 more」 |
| `v2-pow-btc-dark.png`、`v2-pow-btc-light.png` | PoW：币层，BTC 选中，Details 是 BTC 的跨交易所表和模拟盘运行 |

- **示意的部分**：爆仓金额是编的（实时 WebSocket 没接）；二级板块是按 CoinGecko categories 临时套的
  （顺序 Derivatives > DEX > Lending > Liquid staking > Yield，其余 Other DeFi），正式表按第 4.1 节做；
  1h 涨跌和 7d 来自 CoinGecko，正式版按第 1 节的口径用 K 线算。
- **子代理审美评审**的结论是逐层显示解决了小方格问题，每层不超过约 20 个矩形，几乎每个都有名字、涨跌和
  涨跌家数。按评审改过的地方都已写进第 1、2 节：徽标移到右上，底部加中位数，色阶不混黑、step 3 不用满色，
  尾部市值占比用数字代替细条，最大矩形不超过本层 45%，Movers 只列真涨真跌，表格在板块内按 24h 排序并去掉
  重复的板块列。
- **留到实现时再看**：一个币独大的层（PoW 里 BTC 占约 98%）矩形内仍有空白；全市场总市值的 24h 变化来自
  CoinGecko，和币安的滚动 24h 窗口不同，图上已标来源，第 5 步再决定是否改成自己算。
