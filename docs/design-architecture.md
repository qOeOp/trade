# Design / Architecture

当前阶段不支持写入该层文档。

原因：

- 上层 `vision` 与 `prd` 还在收敛
- 现在提前写系统结构、模块划分、技术选型或架构图，容易把临时想法提前固化

当前约束：

- 不在本文件写前后端分层
- 不在本文件写模块职责
- 不在本文件写数据流与技术选型
- 不在本文件写架构图

待 `vision` 与 `prd` 稳定后，再开启这一层。

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
