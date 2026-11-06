# 2026-11-06 Paper 收益曲线混入回测

## 范围与证据

用户先报告新启动 Paper 已有收益波动；聚焦产品显示诊断，非研究审计。当前 main 为
dc49edba7，线上 IDE 为 f217f838。2026-11-06 14:00 UTC 左右只读查询线上
`GET /api/paper/runs`：run 3，`price-action-retest-midpointonly@1`，13:50:47 UTC 创建，
BTCUSDT，0 fills、0 submitted orders，10 根已观测分钟线；10 个权益点全部为 100000，
`total_return=0`。没有改记录、连接凭据或操作运行。

## 发现

| id | 发现与消费者 | 动作 | 代价 | 状态 |
|---|---|---|---|---|
| 20261106-06 | 用户先发现（Product contracts and delivery）。`ChartCard` 在 Paper 阶段仍把研究 backtest 传给 `continuous`；后者先画历史收益，再缩放 Paper 起始本金承接历史末值。Details 和 Trades 却描述当前 Paper 账户，导致把回测波动读成刚启动的模拟盈亏。Backtest 阶段也拼接 Paper candles，与阶段选择不一致 | fix | wrong output | in PR [#2223](https://github.com/qOeOp/trade/pull/2223) |

## 修复决定

图表遵循现有阶段选择：Paper 绘制 Paper 权益、K 线、成交和合约；Backtest 绘制研究
权益、日线和 cycles。Paper 没有观测数据时显示等待，不借用回测；切换阶段隔离缩放记忆，
不等待另一阶段的数据。沿用已有 Paper 链历史规则，本项没有改独立运行的归组语义。

`none`、技能指导或仅改标签不能消除同一条线对 Paper 本金的错误缩放；直接消除跨阶段
图表输入比新增历史开关简单。只加一个无状态的阶段选取函数供图表使用，不加存储字段、
拒绝、审计规则或执行机制，不改目标或运行经济结果。

验证覆盖：回测存在时，新 Paper 的平线仍为 100000、scale=1、drawdown 不继承；Paper
等待中无曲线；Backtest 无 Paper 点。工程测试不代表未来研究或真实成交验证。

## 工程验证

- `npm run build --prefix ide/web`：类型、规则检查、86 项前端测试和生产构建通过。
- 独立浏览器，线上只读快照驱动本地预览：亮暗主题截图均已检查，无页面脚本异常。
- 全量 Python 测试：918 run，302 skipped，5 errors，均为本机 Dolt 1.80.2 与要求的
  2.4.2 不符；main dc49edba7 的同五项 reproduction 测试也失败。
- PR title 与 `git diff --check` 通过。未部署此修复，没有改动线上运行。

截图与只读快照位于 `/tmp/trade-ide-display-review/`；这些是工作副本，不进 Git。
