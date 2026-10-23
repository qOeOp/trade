# 预热提交审计：原生探针与字段评审

2026-10-23，用户逐项确认本方案：预热允许读数据、更新指标和创建订单对象；向引擎提交订单必须不早于提交者实例的有效交易起点，否则整次运行无效，不能作为经济证据。不丢单、不挪时间、不在运行器加另一套撮合或订单拦截。信号输入的因果时钟仍须另外审查。

## 先做原生探针

在 `uv.lock` 固定的 `nautilus_trader==2.0.0rc3` 上，直接使用公开 BacktestEngine、固定账户条款和人造行情；无交易所连接、无账本写入。探针工作副本：`/tmp/trade_warmup_submission_probe_extended.py`，输出 `/tmp/trade-warmup-native-probe-extended.json`。

- 提前提交市价单：原生 `OrderSubmitted` 与成交均在起点前。
- 提前提交未成交限价单：有 `OrderSubmitted`，没有成交，仍应拒绝。
- 提前提交括号单：父单和两个子单均有 `OrderSubmitted`。
- 提前创建但不提交：执行缓存无订单；提前创建、起点提交：`OrderInitialized` 早于起点、`OrderSubmitted` 恰在起点。
- 起点才创建并提交：提交时间恰在起点。
- `on_start` 提交：有起点前的 `OrderSubmitted`。
- 提交至本地模拟器：只有 `OrderInitialized`、`OrderEmulated`，可以一直没有 `OrderSubmitted`。因此两种原生提交确认事件都要检查。

时间比较只用提交确认事件的整数纳秒 `ts_event`，不用初始化时间或成交时间。括号单每个违规订单各留一个发现。

## 新字段的独立评审

按 AGENTS.md 要求，在实现前由只读独立 Agent `timing_field_review` 审查；其初议使用 `per_coin.trade_start_ns`，进一步检查后否决：订单目标合约与提交者实例可能不同，会选错边界。

最终批准一个最小的 summary 字段：`trade_start_by_strategy: {strategy_id: trade_start_ns}`。

- **消费者**：独立审计器 `engine.audit.submission_findings`。
- **独立事实**：运行器实际向各实例配置的最终交易起点，来自 `plan_instances`，在调用策略源码前保存；不读策略可变属性或诊断。
- **已有资料为何不足**：全局交易起点、上市时间可从输入回执得到；日线预热就绪时间要扫描实际连续日线，回执只有条数与首末时间，不能推导中间断档及首次就绪时间。
- **为什么最小**：不另存 input start、instrument 身份或 ledger 列；只给独立审计传递必要的提交者→起点关系。不存在的实例不写入 map。
- **存储性质**：可重建的运行报告元数据；不成为另一份长期研究事实。summary 由既有执行 capture 保留，审计记录其文件哈希；语义报告指纹不包括 summary，不能宣称它由该指纹覆盖。
- **校验**：map 缺失、类型非法、未知提交者均不能通过；值须在交易窗口内，有输入回执时还核对窗口、导出实例身份和上市下界。日线就绪的精确值来自受运行身份约束的运行器计划，不让审计器复制日线规划算法。

## 验证边界

回归测试使用原生事件与合成输入；不修改既有封存结果。旧报告缺少 map 时，新审计器明确报无法完成本项审计；历史镜像及其审计结论保持原样。源码修复须经 CI 构建出新镜像摘要，后续回放才能使用新边界；本地测试不等于新镜像验收。

本次实际执行结果：

- 原生探针：Nautilus 2.0.0rc3，八种情形运行完成；回归另覆盖定时器提交、提前创建括号单后在起点提交、跨合约提交者身份。
- `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：474 项，250 通过、224 跳过。跳过原因均为缺少 Dolt 2.4.2（本机 PATH 上为 1.80.2），没有用其他版本替代，也没有接触活动账本。
- 原生运行器集成：策略把自身起点改为 0、自检通过、无被拒订单，独立审计仍按运行器保存的正式起点发现提前提交；起点字段确实随原生报告写出，不是只测手工字典。
- `uv run --frozen ruff check .`：通过。
- `uv run --frozen mypy cli engine ledger market qualification registration replay report runtime`：67 个源码文件通过。
- 文档 `check:i18n`、`build`、`check:routes`：通过；46 组双语章节、96 条静态路由。图谱身份无重复，新能力与函数的悬浮定义齐全，两个版本的待定清单已移除此项。
- `git diff --check`：通过。

本次未构建或发布 OCI 镜像，未声称完成两镜像原生回放验收；没有修改其他待定边界。
