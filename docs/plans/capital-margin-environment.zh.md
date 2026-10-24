# 本金、策略杠杆与保证金环境的边界

2026-10-25。用户逐项确认：固定初始本金 100000 USDT；单笔金额、仓位、资金分配、实际杠杆和风险预算由策略决定；保证金模型与费率属于同环境比较时共同固定的条件。本轮同步文档，不改执行代码或默认环境。

## 已定边界与现有实现

- `engine/config.py::ACCOUNT_CONTRACT` 固定本金 100000 USDT，默认 `bars` 环境继续保留，强平关闭。
- `execution_account` 在 `quotes` 环境关闭 K 线撮合、开启原生强平，使用 `StandardMarginModel`；运行参数声明的一组初始／维持保证金率进入有效配置，由 `engine/run.py::with_margins` 应用于回放合约。当前没有动态历史分档保证金模型。
- 原生保证金模型不再除以 `default_leverage`，该参数为 1 不代表策略只能持有一倍名义仓位。实际杠杆由策略持仓与权益形成；50 倍仅是初始保证金率 2% 下的理论容量示例，费用与已有占用仍须计入。
- `registration/comparability.py::check_comparable` 核对镜像、有效配置和输入；更改策略仓位规则与更改环境条款分别处理，不能为大敞口候选单独放宽保证金条件后直接比较成绩。
- `engine/report.py::fixed_limitations` 已区分两种环境。报价来自 aggTrades 推断、采用合约最大数量供给 L1，未建模真实深度；原生强平按缓存报价估值，以开仓名义价值计算维持保证金，不模拟标记价强平、动态分档、额外强平费和接收延迟。推断误差可能向两个方向影响触发。
- 策略可以选择接近强平的风险，亏损和费用照实保留。原生拒单仍由现有完整性检查处理；删除旧文档中“保证金拒单但运行仍有效”的错误表述，不改变检查。

## 文档范围

更新回放环境的账户、保证金和强平正文，并在撮合段落注明 K 线规则的适用环境，避免同页仍把所有回放描述为 K 线撮合。保留能力编号，同步八项悬浮定义与图谱标题；从章节和总待定清单移除该决策。英文入口维持现有待翻译中文镜像标记。

没有修改代码、测试、skill、目标或审计／拒绝检查，没有写账本、市场库或 canonical Catalog，也没有自动把已有研究切换到报价环境。

## 验证

- `PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -B -m unittest tests.engine.test_strategy_loader.StrategyLoaderTests.test_the_execution_environment_is_a_runner_argument_in_the_effective_configuration tests.engine.test_stream.StreamTests.test_quote_execution_is_liquidated_natively_and_equals_backtest_node -q`：两项通过，无跳过。覆盖环境与保证金参数的有效配置及拒绝、源码不能声明环境，以及约 31 倍名义敞口的人造场景下原生强平、流式运行与原生 BacktestNode 的订单／成交／账户等结果一致。日志 `/tmp/trade-capital-docs-native-check.log`。
- `npm run check:i18n --prefix docs-site`：47 组双语章节通过；三组本轮累计修改页面的英文待翻译镜像与中文正文一致。
- `npm run build --prefix docs-site`：静态构建通过，日志 `/tmp/trade-capital-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望路由与导出路由通过，94 个本地化页面有导航父级。
- 直接解析中英文导出 HTML：账户与策略边界、两种执行环境和模型局限均已输出，旧概括不再出现；既有能力锚点保留，章节和总待定清单均移除该项。八项正文标题／首段与悬浮定义及图谱标题逐项一致，生成文件与源索引一致。
- 与本项修改前的页面比较，全部能力锚点、实现脚注和步骤数量保持一致；此前已确认的结算价证据和外部数据时点内容保留。
- `git diff --check`：通过。

测试是本地依赖与隔离临时 Catalog 上的现有工程回归，不是新 CI 镜像或真实行情研究验收；没有重跑既有候选，也没有声称新旧执行环境经济结果相同。文档修改未运行产品全量单测。
