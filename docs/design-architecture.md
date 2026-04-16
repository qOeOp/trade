# Design / Architecture

## 当前可记录的临时技术方向

以下内容只记录已经反复出现、且直接影响后续实现节奏的局部技术判断；它们不是长期架构定稿。

### OHLCV 存储演进

- 当前阶段，OHLCV 本地存储优先使用 `CSV + manifest.json`
- 当前访问模式以“增量拉取 + append-only 保存 + 按 timeframe 全量分析”为主，继续用 CSV 成本最低
- 增量抓取依赖 `ohlcv-fetch --since-ts`，本地按 `timestamp` 去重追加
- 当前 `tech-indicators` 直接从 manifest 指向的 CSV 读取数据，不需要额外数据库层

### 进入 replay / backtest 后的方向

- 当主要访问模式变成“按时间段切片读取、反复回放、批量回测、多 symbol 多 timeframe 查询”时，OHLCV 主存应切换到 `SQLite`
- `SQLite` 是回放和回测阶段优先考虑的本地存储，不默认引入更重的服务化方案
- `Redis` 不作为 OHLCV 存储默认组成部分
- 只有在确认存在“最近窗口被反复读取”的热点读取瓶颈后，才考虑在 `SQLite` 之上补缓存层

### 当前不提前固定的内容

- 不在此阶段提前写 `SQLite` schema
- 不在此阶段提前写缓存键设计
- 不在此阶段提前写回测任务编排
- 等 replay / backtest 成为明确需求后，再把这部分下沉到更具体的技术文档

### VCP 指标接入方向

- 这条记录是用户显式要求先放开的临时技术方向，不代表完整架构定稿
- `VCP` 不单独新开 skill，优先作为现有 `tech-indicators` 内的一个新增指标实现
- 当前主链路保持不变：`ohlcv-fetch -> tech-indicators`
- `VCP` 继续复用本地 `CSV + manifest.json` 输入，不引入新的数据源或独立存储

当前判断：

- `VCP` 更像结构型指标，不是独立工作流
- 它需要和现有的 `support / resistance / trendline / volume` 一起解释，拆成第三个 skill 会让工作流分叉
- 开源社区已有 `VCP` 相关 skill，但大多偏股票筛选、Minervini / Finviz 语境，不直接适配当前仓库的 `Binance + crypto + 本地 OHLCV + 多 timeframe` 链路

优先做的最小实现：

- 在 `tech-indicators` 增加 `vcp_candidate` 或 `vcp_structure`
- 输入仍为标准 OHLCV
- 输出优先包含：
  - `is_vcp_candidate`
  - `score`
  - `contraction_count`
  - `pullback_depths`
  - `range_widths`
  - `volume_dry_up`
  - `pivot_high`
  - `breakout_level`
  - `failure_level`

当前不提前固定的内容：

- 不先固定最终评分公式
- 不先固定股票版 Minervini 规则是否原样迁移到 crypto
- 不先固定回测口径、报警机制和前端展示形态
- 先做最小可解释版本，等实际使用后再决定是否扩成完整 screener

### 全市场扫描与候选排序方向

- 这条记录同样只是当前阶段的临时技术方向，不代表长期架构定稿
- 当前仓库里已经存在一版因真实需求而快速落地的最小 `binance-market-scan`，但它只解决“先能扫起来”的问题，不应被误读为后续架构已经定型
- 当前产品语境已经明确存在两类不同入口：
  - 用户已指定单标的，直接做深判
  - 用户未指定标的，要求先扫描市场、比较候选，再收敛到 plan
- 因此主链路后续需要补一个 `全市场候选生成 -> 粗筛 -> 排序 -> shortlist` 的能力；否则 agent 很容易直接进入自由推理，而不是先做结构化收敛

当前判断：

- crypto 需要 `扫描能力`，但不需要直接照搬股票社区 skill 的 `pre-filter + trend template` 实现
- 可以借鉴的是“先缩小 universe，再把高价值候选送进深判”的思想
- 不直接借鉴的部分是股票语境里那些依赖中期强趋势、日线模板、财报或股票风格偏好的硬条件
- `trend template` 在当前仓库更适合作为某类趋势机会的评分因子，而不是全市场统一硬过滤

优先做的最小方向：

- 把扫描器理解成 `OBSERVE` 阶段里的一个运行形态，而不是单独新开主流程阶段
- 先补 `交易可做性硬过滤`
  - 是否可交易
  - 流动性 / 成交额
  - 点差或异常跳针
  - 数据缺失
  - 重大事件窗口
- 再补 `机会质量软排序`
  - 结构位置质量
  - 动量 / 波动状态
  - 压缩或扩张特征
  - 上下方空间
  - 执行友好度
  - 相对强弱
- 最后只把少量 shortlist 候选送入后续深判，而不是让 LLM 直接面对全市场原始噪音

当前已出现、但暂不提前定型的设计压力：

- 当前最小版 `binance-market-scan` 主要依赖公开市场快照做候选生成，因此容易把 `事件驱动 / 新币 / 异常异动` 推到榜单前列
- 这说明后续正式设计里，需要单独考虑 `去噪 / 排除事件驱动` 这一层，但现在还不提前固定它的最终实现形态
- 这层更像扫描阶段内部的候选质量控制，而不是 `ohlcv-fetch` 或 `tech-indicators` 的职责扩张
- 是否采用 `硬过滤`、`软降权`、`分层榜单` 或其他方式，等后续在真实使用里积累更多样本后再决定

当前不提前固定的内容：

- 不先固定全市场扫描的最终字段
- 不先固定统一总分公式
- 不先固定候选池大小和排序权重
- 不先固定 `trend template` 是否会沉淀成某个独立候选策略
- 不先固定 `去噪 / 排除事件驱动` 的规则、阈值和数据依赖
