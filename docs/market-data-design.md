# Market Data Design

## 目的

- 记录当前阶段围绕 `Binance` 市场数据接入的设计方向
- 为后续继续讨论 `skill` 拆分、`CLI` 命名、职责边界提供共同底稿
- 当前只记录已经较明确的方向，不提前固定接口、schema、长期流程

## 当前事实

- 现有公共市场数据链路正在向 `Node + binance-api-node` 收口：
  - `ohlcv-fetch`
  - `binance-symbol-snapshot`
  - `binance-market-scan`
  - `tech-indicators`
- 账户与交易执行入口同样在 `TypeScript + binance-api-node`
  - `binance-account-snapshot`
  - `binance-order-preview`
  - `binance-order-place`
  - `binance-order-cancel`
  - `binance-position-protect`
- 本仓库当前尚未使用统一多交易所 `ccxt` 库
- 当前 Node 侧真实依赖是 `binance-api-node`
- `binance-api-node` 现已归属 `ccxt` 组织，但它仍是单独的 Binance 专用库，不等于统一交易所库 `ccxt`

## 当前已拥有的数据

- `OHLCV`
- `24h ticker`
- `bid / ask`
- `trade_count`
- `premium_index` 语境
  - 当前 Node 版通过 `futuresMarkPrice` 提供 `mark / funding` 语境
- `open_interest`
  - 当前 Node 版对缺失高层方法的端点保留少量 raw fallback
- 账户语境里的：
  - `markPrice`
  - `liquidationPrice`
  - 持仓
  - 挂单
  - 保护单

## 可轻松获取的数据

- `aggTrades`
  - 可用于推 `主动买卖量`、`delta`、`CVD-lite`
- `trades`
  - 可作为更细原始成交材料
- `bookTicker`
  - 可用于点差、买一卖一强弱
- `depth`
  - 可用于前几档盘口不平衡
- `markPrice`
- `fundingRate`
- `liquidation`
  - REST 历史或 WebSocket 流
- `markPriceKlines`
- `indexPriceKlines`

## 关于 `binance-api-node`

- `premiumIndex` 不是缺失，只是换名为 `futuresMarkPrice`
- 当前库里的 `futuresMarkPrice` 实际请求的就是 Binance `/fapi/v1/premiumIndex`
- `openInterest` 当前没有现成高层方法
- 但库提供了 `publicRequest(method, url, payload)`，可以继续通过同一 client 直调公开端点
- 因此后续若收口到 Node，原则上可以统一为：
  - `binance-api-node` 高层方法优先
  - 少量缺失端点走 `publicRequest` fallback

## 当前方向

- 不把“市场数据来源”继续分散在多套风格里
- 后续公共市场数据接入层优先逐步收口到 `Node + binance-api-node`
- 不因为接入层迁移，就强制把纯本地分析层一起迁走
- 也就是说：
  - `交易所数据接入层` 可以迁 Node
  - `本地计算 / 指标 / 结构分析层` 是否保留 Go，单独判断

## 分层原则

### 1. 接入层

- 负责向 Binance 拉原始或近原始数据
- 只做轻度标准化
- 输出 JSON
- 不在这一层做交易解释

当前适合收进接入层的能力：

- `candles`
- `aggTrades`
- `trades`
- `bookTicker`
- `depth`
- `markPrice`
- `fundingRate`
- `liquidation`
- `openInterest`

### 2. 快照 / 特征层

- 负责把原始材料压成更适合日内判断的轻量摘要
- 仍然保持“按需抓取、即时返回”，不默认长期落盘

当前最有价值的候选特征：

- `trade_flow`
  - 最近窗口主动买卖量
  - `delta`
  - `CVD-lite`
- `book_micro`
  - spread
  - 顶部几档不平衡
  - 买一卖一相对强弱
- `liquidation_flow`
  - 最近窗口强平方向
  - 爆仓脉冲强度
- `funding_context`
  - funding
  - mark / index 偏离
- `oi_context`
  - OI 当前值
  - 可选短窗口变化

### 3. 分析层

- 负责结构、指标、支撑阻力、趋势线和交易解释
- 当前仍以本地 `OHLCV` 为主输入
- 不把微观结构和交易解释直接耦合进同一个接入 CLI

## Skill 方向

- 当前先不急着新增很多 skill
- 优先保持 skill 数量克制
- 先按能力密度而不是“每类数据一个 skill”来拆

当前建议：

- `ohlcv-fetch`
  - 继续只负责 K 线
- `binance-market-scan`
  - 继续只负责候选粗筛
- `tech-indicators`
  - 继续只负责本地 OHLCV 分析
- `binance-symbol-snapshot`
  - 继续做“单标的即时市场快照”
  - 后续优先承接：
    - `24h ticker`
    - `mark / funding / premium`
    - `open interest`
    - `trade_flow`
    - `book_micro`
    - `liquidation_flow`

当前不提前固定：

- 是否最终拆出独立 `flow-snapshot`
- 是否把 `binance-symbol-snapshot` 再分成 `snapshot` 与 `microstructure`
- 是否把某些快照能力沉到共享模块而不是 skill 级别

## CLI 设计原则

- 一个 CLI 只回答一类问题
- 不把“拉数据”和“解释市场”揉成一个命令
- 命名优先贴近职责，不优先贴近底层端点名
- CLI 对外语义应稳定，底层可替换实现

当前暂定职责：

- `ohlcv-fetch`
  - 回答“把这个标的的多周期 K 线拉下来”
- `binance-symbol-snapshot`
  - 回答“这个标的现在大概什么状态”
- `binance-market-scan`
  - 回答“全市场先看谁”
- `tech-indicators`
  - 回答“结构和指标怎么看”

## 存储原则

- `OHLCV` 继续沿用当前 `CSV + manifest.json`
- 轻量流数据当前默认不落盘
- 只有在明确进入以下场景后，再讨论持久化：
  - replay
  - backtest
  - 跨时段对比微观结构
  - 反复回看 liquidation / delta / order book 事件
- 在真实需要出现前，不提前设计新的数据库 schema

## 迁移原则

### 先迁的

- `ohlcv-fetch`
- `binance-market-scan`
- `binance-symbol-snapshot` 的公共市场数据接入部分

### 暂不因接入迁移而联动重写的

- `tech-indicators`
- 纯本地指标计算
- 纯本地结构分析

### fallback 原则

- `binance-api-node` 有高层方法时，优先用高层方法
- 缺少高层方法但 Binance 公开端点稳定时，走 `publicRequest`
- 只有当 `binance-api-node` 明显无法覆盖时，才考虑额外保留独立 raw 实现

## 当前待决问题

- `binance-symbol-snapshot` 扩容后是否会变得过重
- `trade_flow / book_micro / liquidation_flow` 是否应该在第一阶段就全部进入 `binance-symbol-snapshot`
- `openInterest` 是否只保留即时值，还是第一阶段就补短窗口变化
- `binance-market-scan` 是否需要引入少量 flow 特征，还是坚持只看 24h 级快照
- 接入层迁到 Node 后，Go 侧是否保留兼容期，还是按 skill 逐个替换

## 当前结论

- 后续重点不是“再找新的数据源”，而是把已经可得的数据接入方式统一起来
- 对当前仓库最有性价比的方向，是在不增加过多 skill 的前提下，把：
  - `OHLCV`
  - `OI`
  - `funding / premium`
  - `aggTrades`
  - `bookTicker / depth`
  - `liquidation`
  组织成一套清晰的接入层与快照层
- 这份文档后续用于继续讨论：
  - skill 拆分
  - CLI 命名
  - 职责边界
  - Node 迁移顺序
