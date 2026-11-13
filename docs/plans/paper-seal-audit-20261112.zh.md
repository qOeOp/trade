# Paper 封存审计（R4 第 3 项，2026-11-12）

用户 2026-11-12 授权（"授权，开两个会话"）：封存时对 Paper 的原生事件跑同一个审计（`execution-paths-replan-20261110.zh.md` R4.3）。
本文记录它新增的存储内容和独立审查的结论。

## 做法

- 运行器每次结束时（写完 `summary.json` 之后）把原生 cache 的订单、成交、持仓、账户报告和订单事件写到
  `out/reports/`，写法与回放相同（`engine.report.write_reports`、`write_order_events`）。先删掉上一次结束留下的报告，
  写失败就不留报告（封存记 `AUDIT_NOT_RUN`），不会留下过期的一份。恢复运行的 cache 含整段运行，所以最后一次结束的
  报告就是整段的。
- 封存时 `ledger.paper.audit` 对这份报告跑 `engine.audit.audit`，即回放用的同一个审计。审计要的 `summary.json`
  和 `input-coverage.json` 由封存一方构造（`audit_inputs`）：
  - 窗口：输入起点（恢复沿用原运行的起点，取第一条 `started`）到最后一次请求停止那一刻所在分钟之后（停止时撤掉
    保护单不算缺口）；每个实例从输入起点开始交易。
  - 入场成员资格：声明时的 `inputs/universe.json`（输入起点到当月底），加上之后每个月日志里 `membership` 行记下
    运行器读到且合约在内的月份，与运行器的 `engine.paper.Membership` 一致；运行器没读到的月份文件不算。费率是
    声明的费率。
  - 审计拿报告去核对的数（平仓数、盈利平仓数、拒单数、起始资金、最终余额）取自日志和运行器的概要，不取自报告本身。
    日志和报告来自同一条原生事件流，所以这层核对查的是报告是否完整、一致，不是两个独立来源互证。
  - 每个合约的数据止于日志里最后一根 K 线（按收盘盖时间，与导出的 `last_bar_ns` 相同）。
  - 时钟是 live（下一节）。
- 判定：有发现时原因加 `AUDIT_FINDINGS`；运行器写了概要却没留下报告时加 `AUDIT_NOT_RUN`。两者都不改变
  `complete`/`invalid` 的划分（`invalid` 仍只表示证据不可信：跑了别的代码、出站被拒、没有日志）。

## 实时时钟下的成交与账户变动（用户 2026-11-12 选 A）

真实 Paper 探针（HOTUSDT，15 分钟，7 笔成交）的原生报告里，每笔成交引起的余额变动正好等于该笔手续费，但 Sandbox
给账户状态盖的时间比成交的 `ts_event` 晚 0.5–5.4 ms；回测里两者同一纳秒。审计的资金费核对按精确时间把余额变动
归给成交，于是 7 笔成交全被记成 `FUNDING_BALANCE_MISMATCH`。

用户选 A（"A"）：只对 Paper，余额变动若紧跟一笔成交、中间没有别的成交或余额变动、滞后不超过 1 秒、并且等于这笔
成交的效果，就算这笔成交的；滞后超过 1 秒仍记不符；记下观测到的滞后。实现（`engine.audit.live_fill_changes`，
仅在概要 `clock` 为 `live` 时启用，回放不变）：

- 开仓或加仓的成交：变动必须等于负的手续费。
- 有减仓成交的仓位：它各笔成交的变动加上它的资金费调整，合计必须等于它的已实现盈亏（Nautilus 的已实现盈亏含
  手续费和资金费）。
- 只改保证金、不动余额的账户行不算"中间的变动"。
- 审计结果的 `native_economics` 记 `fill_account_updates` 和 `fill_account_lag_ns_max`；Paper 存后者。

同一探针改后审计通过，最长滞后 5.4 ms。

## 交易所先撤、策略后请求撤单（用户 2026-11-13 选 A）

多合约 Paper 探针（BTCUSDT、ETHUSDT，34 分钟）封存时有 6 条 `EVENT_OUT_OF_ORDER`，每张被撤的止损一条。这不是我们代码的
问题，是 rc7 本身的行为（`matching_engine/mod.rs` 的 `sync_reduce_only_orders`）：平仓成交后，撮合引擎自己撤掉剩下的只减仓
止损，比成交晚 7–1720 µs。Paper 的执行事件是异步送进缓存的，策略的 `on_position_closed` 先因成交被调用，看到止损还开着，
就再请求撤一次。它的 `OrderPendingCancel` 比交易所的 `OrderCanceled` 晚 0.9–96 ms 盖时间，却先写进订单。回放里事件同步
生效，策略看的时候止损已关，所以没有这个问题。

用户选 A（"都同意"）：只对 Paper，下列条件全部满足才不算发现：

- 订单是只减仓单；
- `OrderCanceled` 是它的最后一个事件，并且紧跟在 `OrderPendingCancel` 之后，这也是它唯一一处时间倒退；
- 撤单时间不早于同合约在撤单请求之前的最近一次成交；
- 撤单最多比请求早 1 秒。

该合约在请求之前没有任何成交时也不放行：交易所撤只减仓单总要先有一笔平仓成交，所以这比批准的条件更严一点。

其余情况仍是 `EVENT_OUT_OF_ORDER`，回放审计不变。实现是 `engine.audit.venue_cancel_lead`，只在概要 `clock` 为 `live` 时启用。
审计结果记 `venue_cancels`（次数）和 `venue_cancel_lead_ns_max`（最长提前量），Paper 存进封存读数。同一次探针改后，6 条
全部按此放行，最长提前 96 ms。

## 新增的存储内容

| 内容 | 位置 | 使用者 | 为什么现有内容表达不了 |
| --- | --- | --- | --- |
| `audit`（`passed`、`findings`、`scope`、`fill_account_lag_ns_max`、`venue_cancels`、`venue_cancel_lead_ns_max`） | `seal.json` | IDE 的 Paper 运行页和列表读 `reasons`；对照（R3.2）和用户判断这次运行的证据是否守了订单规则和保护单 | 是封存时算出的读数；日志里只有运行中每秒一次的保护单缺口，没有原生报告之间的核对 |
| `AUDIT_FINDINGS`、`AUDIT_NOT_RUN` | `seal.json` 的 `reasons` | 同上 | 原因列表是 Paper 判定的唯一出口 |
| `reports/`（`orders.csv`、`fills.csv`、`positions.csv`、`account.csv`、`order_events.jsonl.gz`） | `paper_file` | 复核审计；R3.2 对照按原生成交比较 | 实盘行情下的运行不能重放出同一份原生报告，属于"不能再现的观察"，只能存原件；日志里的订单事件是 `repr` 和挑出的字段，不是原生 `to_dict`；`order_events.jsonl.gz` 与日志的订单事件有重叠，但审计读的是原生形式 |

Paper 记录是执行记录，在 Paper 自己的数据库里，不进研究账本（AGENTS.md）。

## 独立审查

加字段前由独立子代理审查（使用者、独立事实、为何现有字段/关系/推导表达不了）。结论：

- 保留 `audit` 的 `passed`、`findings`、`scope` 和两个原因；删掉原生订单/成交/持仓数——它们是已存 CSV 的行数，可推导。
- 保留 `reports/`：Paper 的原生报告不能重放得到。注明 `order_events.jsonl.gz` 与日志重叠（上表）。
- 采纳的修正：窗口用最后一次停止请求；写报告前先删旧报告；成员资格取日志里运行器实际读到的月份，不取当前目录里
  的文件，起点所在月不重复计；注明恢复沿用第一条 `started` 的输入起点；注明日志与报告同源（上文）。
- `fill_account_lag_ns_max` 是用户选 A 时要求记下的滞后，审查之后加入；它是封存时的读数，报告里只有两个时间戳，
  要配对规则才能得出。
- 最终余额检查（`engine.audit` 里的 `live` 是收尾时仍开着的仓位）：收尾空仓时，账户报告的最终余额与运行器概要的
  `balance_total` 核对；仍有持仓时与回放一样跳过。Sandbox 不结算资金费，账户报告里没有资金费变动，资金费检查无事可查。
- `venue_cancels` 和 `venue_cancel_lead_ns_max`（2026-11-13，加字段前独立子代理审查）：两个都保留。使用者与
  `fill_account_lag_ns_max` 相同。两者都要套用配对规则才能从已存的原生事件里得出：被放行的交叉不产生发现，事件里只有
  原始时间戳。最长提前量证明 1 秒上限守住了。次数在原则上可以重算，但它数的是被放行的异常，不同于已删掉的原生行数；
  没有它，提前量为空就分不清是"没有"还是"不是实时时钟"。用户也点名要这两个读数。
