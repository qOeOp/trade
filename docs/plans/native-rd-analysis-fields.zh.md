# P0-A / P0-B1 派生输出字段审阅记录

日期：2026-10-10。范围：[原生回测分析计划](native-rd-analysis-plan.zh.md) 的 `artifacts report`（P0-A）与 `compare --analysis`（P0-B1）。两者只向 stdout 输出派生 JSON，不写 Dolt、不写 seal；按用户要求，每个新输出键仍先经独立子 Agent 审阅。

审阅方式：主会话起草 31 + 14 项清单；三位互相独立、未参与起草的子 Agent 分别从必要性与命名、真实 seal 上的定义核验（28 个 seal 全部运行原型）、配对字段与区间口径三方面给出 retain/drop/derive。分歧由主会话按“有具体消费者、不与既有名称同义、与实测证据一致”裁决，裁决理由记录在下表。审阅针对固定 Dolt `f8va2hf2e7bae13p08kfs5s8ne1sk3ud`（v132）与当时的 28 个 seal。

## 通用约定

- 不可计算的读数为 null，原因写入 `limitations`；不新增 unavailable/gaps 键。
- USDT 金额沿用 summary/native_economics 的定点十进制字符串，固定 8 位小数，不输出科学计数；比例与百分比为浮点数。
- 分位数用 nearest-rank（numpy `inverted_cdf`），只在样本为 0 时为 null。
- 总体：CLOSED 为有 `ts_closed` 的 positions 行（含 NETTING snapshot，等于 `summary.closed_trades`）；OPEN 为无 `ts_closed` 的行；ACCOUNT 为整账户；交易窗口为 `period_start_utc` 至 `period_end_utc`。
- 成交到周期的映射以 positions.events 的 `event_id` 为准；`trade_ids` 只作交叉核对；不以 fills.position_id（基础 ID）关联。名义金额用 positions 行的 multiplier 计算。
- indent=2 输出超过 32,768 UTF-8 字节即显式失败，不截断。实测原型：单 run 4.7–10.9 KB（最大 C01-37 10,878 B），配对 13.7–16.2 KB。

## P0-A `artifacts report`

| 键 | 决定 | 消费者 / 独立事实 | 定义与 null 规则 |
|---|---|---|---|
| `run_id`、`status`、`problems` | retain，沿用 manifest | 身份与完整性；失败 seal 必须可见 | manifest 原值；`problems` 不再复制进 limitations |
| `manifest_sha256` | retain，沿用 verify 输出 | 与 Dolt run `artifact_manifest_ref` 对接 | `artifacts.verify` 返回值 |
| `record_binding` | retain，沿用 manifest | P0-A 不读 Dolt，Agent 以它 `show --revision` 读冻结主响应 | manifest 原值 |
| `summary_ref`、`audit_ref` | retain，沿用 run 记录形状 | 下钻原生统计；可直接作 evidence_refs 的 {path, sha256} | 文件缺失（失败 seal）时为 null |
| `analysis.source_files_sha256` | retain，沿用 run 记录名称与形状 | 重建派生数值；seal 哈希只识别输入，不识别宿主侧生成器 | {仓库路径: sha256}，覆盖所有参与计算的模块（含被复用的 `compare_paired_returns.py`） |
| `analysis.dependency_lock_sha256` | retain，同名同定义、限定在 `analysis` 下 | 宿主 `uv.lock` 可能不同于封存镜像锁 | 宿主 `uv.lock` 字节的 sha256 |
| `analysis.method`、`custody` | drop | 源码哈希已确定方法；custody 是保管位置属性，归档后自述会失真 | — |
| `input_start_utc`、`period_start_utc`、`period_end_utc`、`data_interval_minutes` | retain，沿用 summary | 交易窗口与预热 | summary 原值；summary.json 本身 40.9 KB，超出上限，故做有界投影 |
| `starting_balance_usdt`、`final_equity_usdt`、`net_change_usdt`、`annualized_return_pct`、`native_sharpe_365`、`native_max_drawdown_daily_close`、`closed_trades`、`winning_trades`、`closed_trade_win_rate` | retain，沿用 summary | 账户目标读数 | 失败 seal 为 null |
| `native_economics` | retain，沿用 audit | 分解与边界核对的基准 | 缺失（B00-37 分档审计、失败 seal）为 null 并写 limitation |
| `closed.reported_realized_pnl_usdt`、`closed.fill_commissions_usdt`、`closed.reported_funding_usdt` | retain，沿用 native_economics 叶名 | native_economics 只有全行合计；开放仓部分由同名逐叶相减得到 | 闭仓行 realized、commissions（拒绝非 USDT）、adjustments 中 FUNDING 的 pnl_change（原生符号，正为收入）；0 闭仓时各值为 null |
| `closed.price_pnl_usdt` | retain | 毛优势是“毛亏 vs 薄毛利被成本覆盖”问题的主读数；独立由成交现金流计算，同时作为核对 | events 中 SELL 为正、BUY 为负的 qty×px×multiplier；逐行核对 price − 佣金 + 资金费 = realized（1e-6） |
| `closed.entry_notional_usdt` | retain | 归一化分母；现有字段无成交名义 | events 中 `order_side == entry` 的 last_qty×last_px×multiplier |
| `closed.positions`、`open.positions` | drop | 分别等于 `closed_trades`、`open_positions` | — |
| `open.{realized, commissions, funding}` | derive | native_economics − closed 逐叶相减 | 逐行核对开放仓 realized = 资金费 − 佣金，不成立时写 limitation（含部分平仓价格盈亏） |
| `open_entry_notional_usdt` | retain，扁平键 | 开放仓规模 | 同 entry_notional 规则；`open_positions == 0` 时为 null |
| `unrealized_residual_usdt` | retain | 计划要求单列；防止把闭仓合计误读为权益变化 | final_equity − native_economics.final_balance；native_economics 缺失时为 null；无开放仓时必须为 0 |
| `closed_bps_of_entry_notional.{price_pnl, fill_commissions, reported_funding, reported_realized}` | retain，与 USDT 键同名词干 | 跨版本比较单位名义的优势与成本；`reported_realized` 为主读数（名义加权净 bps） | 各 USDT 值 ÷ closed.entry_notional × 1e4；佣金为正成本、资金费为带符号收入，恒等式 reported_realized = price_pnl − fill_commissions + reported_funding；0 闭仓为 null |
| `closed_notional_weighted_win_share` | drop | 名义加权净 bps 已承担 C10 等权/加权符号反转的读数 | — |
| `closed_realized_pnl_quantiles_usdt.{p05, p50, p95}` | retain，裁到三点 | 损失尾部、中位、盈利尾部；stats_pnls 为分析器总体且无分位 | nearest-rank |
| `closed_gross_win_net_loss` | drop | 所有回归 seal 均为 0；聚合问题已由 bps 回答 | — |
| `fills_by_liquidity_side` | drop | τ 与 bps 中的佣金已覆盖费用来源 | — |
| `taker_fill_notional_share` | retain，更名 | τ；名称带 fill，区别于入场名义 | 全部成交（含开平、开放仓）中 TAKER 名义占比，由 events 计算；0 成交为 null |
| `orders_by_tag_status` | retain | 订单漏斗；summary 只有 denied/rejected | 键为 tags 按记录顺序以 `+` 连接，空为 `untagged`；状态用原生词汇；只列非零；按列名解析，零行报表为 {} |
| `partially_filled_orders` | retain | 最终状态隐藏了已取消订单上的部分成交 | 任一标签与状态，0 < filled_qty < quantity；不复用分档审计中更窄的名称 |
| `entry_orders_per_closed_cycle` | drop | 均值可由订单表与周期数派生，无决策规则读取其分布 | — |
| `closed_duration_hours_quantiles.{p50, p90, max}`、`zero_duration_closed` | retain | 持仓时长 | `duration_ns`，不用 ts_closed − ts_opened |
| `max_drawdown_daily_close_dates.{peak_utc, trough_utc, recovered_utc}` | retain，更名 | 回撤日期与恢复；名称说明频率；`recovered_utc == null` 即右删失 | 曲线在 period_start 取 1.0 再复利；标签 D 的收盘时刻为 min(D+1 日, period_end)；取最大深度首次出现；深度与 summary 核对到 1e-12；深度为 0 时整键为 null |
| `worst_day.{day, return_pct}` | retain，更名并带日期 | 下钻当日成交；日期无法从其他键得到 | 交易窗口内，UTC 日初标签，平局取最早 |
| `worst_month_return_pct` | derive | 等于月度表最小行 | — |
| `max_consecutive_losing_closed` | retain | 连亏 | 亏损 = realized ≤ 0（winning_trades 的补集）；按 (ts_last, instrument_id, opening_order_id) 排序，因 snapshot ID 含随机 UUID |
| `open_positions` | retain，沿用 METRIC_FIELDS 同义名 | 期末开放仓 | 零交易为 0，失败 seal 为 null |
| `monthly_account_return_pct` | retain | 月度账户 MTM 贡献 | {"YYYY-MM": pct}，交易窗口内按 UTC 日初标签复利；首末月为部分月 |
| `by_instrument` | retain，不复用 `per_coin` | 品种贡献；`per_coin` 已是 summary 中不同形状的输入计数表，复用会一名两义 | {columns: [instrument, closed_trades, reported_realized_pnl_usdt], rows}；行覆盖 summary.per_coin 全部品种并排序；无仓位行的品种 realized 为 0（可计算，避免配对差值缺项）；realized 为闭仓 + 开放仓，合计等于 native realized，未实现残差不分配 |
| `gain/loss_concentration_top3_share` | derive | 可由 by_instrument 排序得到 | — |
| `by_entry_side.{BUY, SELL}.{closed_trades, reported_realized_pnl_usdt}` | retain | 方向拆分；Long Ratio 只给比例 | 与 by_instrument 同口径；只有一个方向时为 null（否则重复合计） |
| `limitations` | retain，沿用 summary 名称 | 缺口永不省略 | summary.limitations ∪ audit.coverage_limits ∪ 分析器原因 |
| `stats_returns`、`stats_pnls`、`stats_general` | drop | 透传会混淆总体与名称；经 `summary_ref` 可达 | — |

边界核对（检查而非输出键）：

1. 自洽核对总会执行，不需要 account.csv 或 native_economics：events 恰好覆盖每个 fills.event_id 一次；positions 佣金合计等于 fills 佣金合计；每个闭仓行恒等式成立；交易窗口收益复利等于 final_equity（1e-6）。失败时经济读数为 null 并写 limitation。
2. native_economics 存在时，全行 realized、佣金、资金费合计在 1e-6 内与之相等；不等时经济读数为 null 并写 limitation。缺失时（B00-37）只把 `unrealized_residual_usdt` 置 null。
3. `is_inverse`、非 USDT 金额或缺少 multiplier 超出当前支持的线性 USDT 范围，经济读数为 null 并写 limitation。
4. 分析器解析的字节即按 manifest.files 复核哈希的同一缓冲；verify 会对 account.csv 计算哈希，但分析器从不解析它。B03 原型进程内 0.69 s。

## P0-B1 `compare --analysis`

| 键 | 决定 | 理由与定义 |
|---|---|---|
| 既有 compare 键 | retain，不变 | `_compare` 原样执行 |
| `role` 成对 | drop | B1 成功输出中恒为 [candidate, control]；B2 时再审 |
| `strategy_binding` 成对 | retain，沿用 run 字段 | compare 输出缺少双方策略身份；legacy Git 保管 run 为 null |
| `artifact_manifest_ref` 成对 | retain，沿用 run 字段 | 标明分析的封存字节；可与 P0-A `manifest_sha256` 对接。--analysis 要求双方都有 `artifact://<run>/manifest.json` 锚点且与封存一致，否则以 `decision_pair_integrity` 拒绝 |
| `selection` | retain，透传候选 attempt 的 contract.selection | 给出冻结的 primary_response、family_id 与 known_exposure，取代新增事前布尔值；契约跨 revision 冻结，用 compare 已载入的 revision。已知上限：known_exposure.run_refs 随家族增长，约 190 条时配对输出会超过 32 KiB 并显式失败（当前最多 25 条），届时另行审阅有界表示 |
| 事前布尔值（在 rev1 暴露内、rev1 父、起跑前已登记） | drop | 第三项不可派生（seal 无起跑时刻）；前两项已是固定关系，且都不能证明事前选定。改为一条固定 limitation：对照在结果后登记绑定，尚无可机器核验的事前参考声明 |
| `metrics` 追加 P0-A 读数 | retain，沿用 {candidate, control, difference} 形状，键为 P0-A 键路径 | 固定集合：closed_trades；closed.{entry_notional_usdt, price_pnl_usdt, fill_commissions_usdt, reported_funding_usdt, reported_realized_pnl_usdt}；unrealized_residual_usdt；open_positions；closed_bps_of_entry_notional.{price_pnl, fill_commissions, reported_funding, reported_realized}；taker_fill_notional_share。不设单位列（单位在键名后缀） |
| `metrics.*.difference` | retain，补 null 规则 | 任一侧为 None、布尔、非数值或非有限时为 null，否则不变；同时修复普通 compare 在 `cli.py:497` 的 `Decimal` 崩溃 |
| `by_instrument` 成对 | retain，与 P0-A 同名 | {columns: [instrument, candidate_closed_trades, control_closed_trades, candidate_reported_realized_pnl_usdt, control_reported_realized_pnl_usdt, difference_reported_realized_pnl_usdt], rows}；全宇宙排序 |
| `monthly_account_return_pct` 成对 | retain，与 P0-A 同名 | {"YYYY-MM": {candidate, control, difference}}；差值为描述性百分点 |
| `paired_daily_returns` | retain，复用 `method`、`seed`、`draws`、`days`、`week_blocks` | 仅当 selection.primary_response 等于 `final_equity_usdt` 时计算，否则为 null 并写 limitation；任一侧日收益序列被单 run 核对拒绝或双方时间轴不同，也为 null 并写 limitation，不新增拒绝；seed 20261008、5000 次、ISO 周块 |
| 区间口径 | 采用配对日对数收益差：`observed_annualized_relative_growth_pct`、`bootstrap_95pct_annualized_relative_growth_pct` | d_t = ln(1+r_c) − ln(1+r_b)，观测值 (exp(365·mean d) − 1)×100，即 (FE_c/FE_b)^(365/days) − 1；区间对重采样均值做同样变换。原口径（两个分别年化的差）与 `metrics.annualized_return_pct.difference` 数值相近但不同（C11/B03：−11.3087 对 −11.3305），同一输出出现两个“年化差”会误导，且区间受对照自身水平影响；新口径另起名称。C11/B03 复现值：−10.0992，[−41.8120, 36.8119] |
| Sharpe365 次级区间 | drop | 非主响应的推断区间诱导换目标；C03/B02 的 Sharpe 区间不含 0 而主区间含 0 |
| 配对相关、区间半宽、目标差距 | drop | 半宽对变换后的非对称区间有误导；attempt 契约没有可机读目标阈值（selection 只有 family_id、primary_response、known_exposure） |
| 块长敏感性 | drop，作为方法核验记录于此 | 28/56 日移动块相对 ISO 周块端点最多移动 3.0 个百分点，5 个合法配对是否含 0 均不变 |
| `storage` | retain，形状不变 | 在 flag 下改变既有键形状会一名两义；实测余量充足 |
| `limitations` | retain，沿用名称 | 双方 summary.limitations 与 coverage_limits 去重并集，加分析器原因与上述固定事前说明 |
| `analysis` 身份块 | retain，与 P0-A 同名同形状 | 区间与读数由宿主分析代码计算 |
| 拒绝的错误字段 | retain，沿用 RecordError 键 | 消息文本不变；compare 拒绝的 `write_status` 为 `not_written`；code 复用 `decision_pair_role_mismatch`（未知对照/非登记对照 → path `/control_run_id`；角色 → `/role`）、`decision_pair_integrity`（完整性 → `/integrity`；审计不可用或未通过 → `/audit_ref`）、`decision_pair_incomparable`（输入/窗口/账户/成本/Nautilus → 首个字段，expected 列出每个冲突字段的双方值；有效配置 → `/effective_config_sha256`；运行环境 → `/runtime_identity/<field>`；品种宇宙 → `/summary_ref`）；`DOLT_SQL_ERROR` 等基础设施错误不改；`--analysis` 与 `--engineering-audit` 由 argparse 互斥 |

## 被推翻的初稿说法

- 计划中的 `analysis_source_sha256`、`uv_lock_sha256`、`custody: temporary_derived` 改为 `analysis.source_files_sha256`、`analysis.dependency_lock_sha256`，删除 method 与 custody。
- “仅触价 maker 成交占比”需要封存外的 Catalog 柱线，P0-A 不计算。
- 按已成交档数分层、名义加权胜率、收益/亏损集中度、最差月由 Agent 从保留键派生，不单列。
- 初稿以 position_id 打破连亏平局不可复现（snapshot ID 含随机 UUID，C02-37 结果在 11 与 15 之间变动）。
- 初稿规定 native_economics 缺失即全部经济读数为 null；B00-37 的自洽核对全部通过，只置 null 未实现残差。

## 收缩决定（2026-10-10 下午）

用户按“能用 Agent 就不硬编码”原则决定：代码只保留 Agent 不应自评的部分，即信任边界、现有缺陷修复和 Agent 做不到的事。上表其余已审阅的描述性读数从代码移出，其定义与数据坑写入按需加载的 `.claude/skills/native-report-analysis/SKILL.md`，由 Agent 从核验后的封存计算，并用对账不变量或独立复算自检。

- `artifacts report` 保留：`run_id`、`status`、`problems`、`manifest_sha256`、`record_binding`、`summary_ref`、`audit_ref`、`analysis`、`native_economics`、`closed.{reported_realized_pnl_usdt, fill_commissions_usdt, reported_funding_usdt, price_pnl_usdt}`、`closed_trades`、`open_positions`、`unrealized_residual_usdt`、`limitations`。只有在逐行恒等式、事件覆盖成交、佣金合计与 native_economics 合计都在 1e-6 内成立时才输出分解，否则为 null 并写原因；日收益不能复利到 final_equity 时写入限制。
- `artifacts report` 移出：summary 透传字段、`closed.entry_notional_usdt`、`open_entry_notional_usdt`、`closed_bps_of_entry_notional`、`closed_realized_pnl_quantiles_usdt`、`taker_fill_notional_share`、`orders_by_tag_status`、`partially_filled_orders`、`closed_duration_hours_quantiles`、`zero_duration_closed`、`max_drawdown_daily_close_dates`、`worst_day`、`max_consecutive_losing_closed`、`monthly_account_return_pct`、`by_instrument`、`by_entry_side`。
- `compare --analysis` 保留：`strategy_binding`、`artifact_manifest_ref`、`selection`、`metrics` 追加 `closed_trades`、四个 `closed.*`、`open_positions`、`unrealized_residual_usdt`，以及 `paired_daily_returns`、`analysis`、`limitations`；移出成对的 `by_instrument` 与 `monthly_account_return_pct` 表和 bps、τ 读数。拒绝结构化、null 差值与锚点要求不变。
