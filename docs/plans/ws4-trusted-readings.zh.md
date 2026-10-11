# WS4 可信读数：订单事件历史与裸仓审计

状态：实现见 [qOeOp/trade#1526](https://github.com/qOeOp/trade/pull/1526)。计划与共识见 [rd-round-audit-refactor-plan.zh.md](rd-round-audit-refactor-plan.zh.md) 的 WS4 节。

## 改了什么

- **订单事件历史成为标准报告。** 运行器在回放结束后读缓存里每张订单的 `Order.events()`，把未改写的 `to_dict()` 写成 `order_events.jsonl.gz`：按订单 ID 分组，组内保留原生顺序，gzip 时间头为零。这是 [qOeOp/trade#1510](https://github.com/qOeOp/trade/pull/1510) 在拍平后结构上的重做。
- **裸仓审计硬拒绝**（用户授权，范围仅此一项）。
  - 审计先核对事件历史与 `orders.csv`、`fills.csv` 逐项一致：订单集合、数量、成交量、终态、成交事件。
  - 再按时间戳把同一纳秒的事件一起应用，逐个"策略 × 币种"读出持仓，以及平仓方向上已接受、reduce-only 的止损单（stop-market、stop-limit、trailing）的未成交数量。
  - 持仓大于止损覆盖、且持续超过一根 5 分钟线，整次运行判 invalid。`audit.json` 的 `uncovered_intervals` 列出每段区间：起止、持仓量、覆盖量、仓位内成交过的订单、撤掉后造成缺口的止损单。findings 里同样写出时间、币种、数量和订单 ID。
- **无止损声明。** 策略类属性 `USES_STOP_LOSS = False`（默认 `True`，只接受布尔值），与 `DAILY_WARMUP` 同一种声明方式。加载时校验，经 `strategy_uses_stop_loss` 写进 `summary.json`。声明后只报告区间、不拒绝。
- **编写指南** `strategy-authoring.md` 新增"Partial entries and expiry"一节，给出经原生回放测试的写法。
- 审计结果仍经 `trials.hand_off_run` 交出，签名和函数体都没改：拒绝体现在 `audit.passed` 和 `findings` 里。

## 原生行为实测（nautilus_trader 2.0.0rc3，uv.lock 钉住的版本）

用 `BacktestEngine` 和与 `ACCOUNT_CONTRACT` 相同的 venue 配置做了几组探针，复现 D25：母单 0.25/16.339 部分成交后 GTD 到期。

| 情形 | 结果 |
|---|---|
| 默认 bracket，母单 GTD 到期 | 止损、止盈随即被撤，0.25 裸仓，后续止损线没有任何单子 |
| 策略配置 `manage_contingent_orders=True` | 同上 |
| `manage_gtd_expiry=True`（由策略撤单） | 同上 |
| GTC 母单，到期时把数量改小到已成交量 | 母单被撤，子单同样被撤 |
| 到期前价格穿过止损线 | 母单在同一根线全部成交，止损 16.339 全部成交、平仓，没有问题 |
| 在 `on_order_expired` / `on_order_canceled` 里按缺口补挂 reduce-only 止损和止盈 | 新单在同一时间戳被接受，之后止损线正常平仓 |
| 用 `to_dict`/`from_dict` 重建成 OUO 对 | `OrderList` 不能从 Python 构造；逐张提交时缓存里的订单身份与事件对不上。太脆，不写进指南 |

结论：rc3 里，母单只要终止（到期、撤单、改量到已成交），venue 都会撤掉它的子单。指南只采用最后可行的那种写法：两张独立的 reduce-only 单，平仓后撤掉剩余单。

缺口的计算方法：持仓减去仍然存活的 reduce-only 止损的未成交量。子单存活的条件是它的母单已全部成交，或者仍在工作且有成交。两档同时到期时，这种算法只补挂一对。

## 字段评审（独立子 Agent，2026-10-11）

| 字段 | 消费者 | 为什么现有字段不能表达 | 决定 |
|---|---|---|---|
| `order_events.jsonl.gz` | 本审计；nautilus-report-analysis | `orders.csv` 只有终态；`fills.csv`、`positions.csv` 只有成交。止损何时被接受、撤销、到期、改量，都推不出来 | 保留；不加全局序号或推导状态 |
| `summary.json` 的 `strategy_uses_stop_loss` | 审计（独立进程，只读报告目录） | 不能从数据推断：没有止损恰恰是要拒绝的故障。审计也不应执行或解析策略源 | 保留，加载时严格校验 `bool`；缺键时按 `True` 处理 |
| `audit.json` 的 `uncovered_intervals` | 用户和 Agent 读拒绝原因；`USES_STOP_LOSS = False` 时的报告 | 新事实 | 保留；时间只存 ns，ISO 时间只写在 findings 里；按币种和起点排序 |

评审建议改名：`STOP_LOSS` 改为 `USES_STOP_LOSS`，避免与订单 tag `STOP_LOSS` 混淆；`unprotected_positions` 改为 `uncovered_intervals`，并加 `position_id`。两项都已采纳。

评审的其他意见：

- **升级运行时契约：不采纳。** 理由如下：
  - verify 从不重跑审计，每个镜像只审计自己的运行；
  - 目前没有 `r1-native-v4` 封存（56 个原生封存都是 v1–v3）；
  - 新增声明默认 `True`，对已发表的 v4 源码向后兼容。
- **"旧封存没有事件历史，D11/D19 无法重读"：与事实不符。** 这两个封存的镜像来自 #1510 的 worktree，自带 `order_events.jsonl.gz`。
- **"仓位内订单 ID 可由 position_id 推出"：仍保留 `position_order_ids`。** 用户要求拒绝时直接给出订单 ID；从未挂过止损的情形下，`ended_stop_order_ids` 为空。

## 未改动、留给用户

- 原有的"期末持仓须有等量 stop-market 和 limit"检查与新审计有部分重叠，它还要求止盈。删除或合并它属于修改拒绝规则，需要授权，本项没有动。因此 `USES_STOP_LOSS = False` 的策略如果期末仍持仓，依旧会被这条旧检查拒绝。
- `DAILY_WARMUP` 的校验写法是 `not in (True, False)`，会放过 `1` 和 `0`。收紧它也属于修改拒绝规则，没有动；新声明用的是严格写法。

## 验收（2026-10-11）

### 单元测试

`uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：198 项通过，6 项 Dolt 集成测试未配置专用库而跳过。

`tests/backtest/test_partial_entry_protection.py` 和 `test_native_audit.py` 另在 `pr-1526` 镜像里跑过一遍（无网络，测试目录只读挂载），19 项通过。

### 合成回放复现 D25

`test_partial_entry_protection.py` 用原生 `BacktestEngine`，按 `ACCOUNT_CONTRACT` 配 venue，经真实的 `report.write` 写出报告，再跑完整审计。

- **单档**：母单 16.339 在限量线上只成交 0.250，6 小时 GTD 到期，止损和止盈被撤。
  - 裸 bracket：审计判 invalid，只有一条 finding，给出币种、0.250、到期时刻、仓位订单和被撤的止损单。这段裸仓一直持续到策略后来市价平仓，中间错过了止损线。
  - 指南写法：到期的同一时间戳补挂 0.250 的止损和止盈，止损线到达时平仓，审计通过。
- **两档同时到期**：每档成交 0.250。裸 bracket 判 invalid（0.500，两张被撤的止损）。指南写法只补挂一对 0.500，审计通过。

### 旧封存只读重读

用新审计的事件对账和区间计算，只读地读取 `RR20261011-D11-C37` 和 `RR20261011-D19-C37` 自带的 `order_events.jsonl.gz`，没有写入封存目录。

| | 订单 | 事件 | 成交 | 事件与报告对账 | 超过一根线的裸仓 | 任意长度的未覆盖瞬间 | 先成交后撤单或到期的订单 |
|---|---|---|---|---|---|---|---|
| D11-C37 | 10,161 | 38,989 | 4,552 | 一致 | 0 | 0 | 0 |
| D19-C37 | 345 | 1,374 | 227 | 一致 | 0 | 0 | 0 |

反向对照：去掉全部止损单的 `OrderAccepted` 事件后，同一计算在 D11 报出 924 段、在 D19 报出 113 段。可见"没有裸仓"不是因为读空。

结论：两次经济失败没有被部分成交的保护缺陷污染，与计划里的核查一致。这两个封存会在 WS7 删除。

### 配对原生回放

按 `backtest/README.md` 做配对，两次都用 `artifacts run --explore`，同一份草稿：D11 源码只把构造参数改为 v4 的默认常量，规则不变；草稿哈希 `4e164d7b…`。

- 输入：Catalog `r1-37-1y-5m-2026oct7`，窗口 2025-10-07 → 2026-10-07T08:30Z，交易起点 2025-10-17，固定账户。
- 参照：main 镜像 `sha256:0438768c56775999bdd46c8939fe145ae7772cc8b1ef2da2d00e84c8517f566f`。
- 候选：`pr-1526` 镜像 `sha256:ac8b3d59227963961bb439ee859c5a18d7b4e97e0424d87f5762bc9c55ccc7b1`，revision `903e7b06`。

`backtest.checks.compare` 的结果如下，两边的审计都通过：

| | BTC/ETH | 37 币 |
|---|---|---|
| 订单（36 列） | 837 = 837，0 处不一致 | 10,161 = 10,161，0 |
| 成交（18 列） | 348 = 348，0 | 4,552 = 4,552，0 |
| 持仓（28 列） | 77 = 77，0 | 930 = 930，0 |
| 账户行 | 2,008 = 2,008，0 | 24,425 = 24,425，0 |
| 收益点 | 366 = 366，0 | 366 = 366，0 |
| 资金费调整（逐笔一致） | 273 笔，合计 −20.52290742 USDT | 3,178 笔，合计 58.82583323 USDT |
| 成交手续费 | 161.21290618 两边相同 | 1,866.56057473 两边相同 |
| 期末权益 | 100,072.35619904 两边相同 | 92,771.08303293 两边相同 |

- `exposures.csv.gz`、`returns_series.csv`、`account.csv` 逐字节相同。
- `summary.json` 只在 `load_source_sha256`、`report_source_sha256` 和新增的 `strategy_uses_stop_loss` 上不同。
- 候选的新审计：37 币有 38,989 个事件，与报告对账一致，`uncovered_intervals` 为空。
- 候选 37 币的 `order_events.jsonl.gz` 与封存 D11-C37 的同名文件（来自 #1510 的镜像）逐事件相同：38,989 = 38,989，0 处不一致。比较时排除了每次运行都会变的 event、venue、trade、position ID。

探索产物都在临时目录，没有封存，没有登记，也没有写任何账本。
