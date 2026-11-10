# Live 单笔入场上限按账户权益的倍数（2026-11-10）

用户 2026-11-10 授权（"Yes, authorize"）：策略源码里不写 USDT 金额；Live 的单笔入场上限从固定 USDT 改成当前账户权益的倍数。
同一授权撤回了连续运行设计（`live-continuous-operation-design-20261110.zh.md`）§3.5 方案 B 里"源码固定 USDT 上限"那一半，
@3 版本不用，改发只加预热的 @4。基线 `origin/main` `b2e8c7b8d`。

## 1. 问题

- 研究里的仓位按权益比例算（风险 2%、名义 ≤ 1 或 2 倍权益），所以不同金额的回放可以按收益率比较，一个版本对应任何金额。
- Live 的单笔上限原来是固定 USDT：`max_notional_per_order` ≤ 3 × `budget_usdt`，`budget_usdt` ≤ 100。
  每笔入场都会重新检查。
- 权益涨到上限的 1/k 以上，k 倍权益的入场就被 `LIVE_BUDGET` 拒绝，运行以失败结束。要继续跑，只能改源码里的金额或重配运行。

## 2. 改法

去掉运行配置里的 `max_notional_per_order`。上限是代码常数 `ENTRY_EQUITY_MULTIPLE = 3`（`engine/live_venue.py`），
不是配置字段：3 是 2026-11-09 用户批准的倍数上限，独立审查认为再给一个可调的 m 只多一个要校验、要显示、要迁移的字段，
而运行里从没有要设成别的值的理由。

每笔入场前产品已经重新读取账户、完整准入一次（`dispatch_entry` → `require_admission`），并且只在空仓、无挂单时允许入场，
所以那一刻的 USDT 现金就是权益。记 E = min(钱包余额, 可用余额)，取自同一次账户快照，`require_admission` 把它返回给调用者：

| 检查 | 原来 | 现在 |
| --- | --- | --- |
| 配置（`LIVE_BUDGET`） | 0 < budget ≤ 100，0 < cap ≤ 3 × budget | 0 < budget ≤ 100（不变） |
| 资金（`LIVE_FUNDS`） | E ≥ budget | 不变：预算仍是现金下限 |
| 最小下单（`LIVE_MINIMUM_SIZE`） | max(最小名义, 最小数量 × 标记价) ≤ cap | ≤ 3 × E |
| 入场（`LIVE_BUDGET`） | 限价名义 ≤ cap | 限价名义 ≤ 3 × E，E 取自这次入场的同一快照 |

- 拒绝代码不变，只改含义和文字。
- 预算 ≤ 100 和"现金 ≥ 预算"不变。
- 单笔入场不再有绝对 USDT 上限：它是期货 USDT 钱包里有多少钱的 3 倍。真正的风险金额就是用户往这个钱包里放了多少钱。
- 源码按 Nautilus `portfolio.equity` 定仓（1 或 2 倍），Live 检查用交易所快照。两者在空仓时只差刚结算的手续费和资金费，
  3 倍留出余量，所以这个检查只拦源码缺陷。

## 3. 审查后定下的细节

- D1 提交和派发分开检查。提交时（`live_source` → `require_entry`）只做结构检查：只接受 LIMIT、标的存在、没有挂着的入场。
  不在提交时读账户，那时没有新快照。名义检查 `require_entry_size` 只在派发时做，用派发读到的同一个快照的 E；
  被拒时和其他派发失败一样，丢掉这次观察、运行标记失败并开始停止，原生提交从不发生。
- D2 manifest 格式 `live-run-v5` → `live-run-v6`，v5 加进 `RETAINED_FORMATS`：旧运行能读、能对账，不能再启动（它的镜像没有新检查）。
- D3 迁移顺序（服务器，各步单独问用户）：暂停 Live 定时器 → 合并 → 镜像就绪 → Live 空闲且没有未决请求时，
  原子替换运营声明 `/var/lib/trade-release/live/configuration.json`，从 `defaults` 去掉 `max_notional_per_order` → 恢复定时器。
  旧声明在新版本里是格式错误的声明，Live 不会配对（按 `deploy/remote/README.md` 的设计不会悄悄去掉 Live）。
  现在服务器 `/srv/trade-private/live/runs` 为空，没有在跑或要保留的 Live 运行。

## 4. 牵连的地方

- `engine/live_venue.py`、`engine/live_commands.py`、`engine/live.py`：上表和 D1。
- `live/configuration.py`（`CONFIG_KEYS`）、`live/runs.py`（准备、校验、D2）、`live/credentials.py`、`live/views.py`、
  `cli/main.py`（去掉 `live preflight --max-notional-per-order`）。
- `live/protocol.py` `PROTOCOL` 2 → 3：Web 与 Live 控制交换的配置字段变了，新 Web 不会提前放在旧控制旁边，要等 Live 空闲时配对。
  基线 `tests/live/protocol-3.json` 由今天的控制录得；protocol-1、protocol-2 不动。
- Web：启动页去掉 "Entry limit (USDT)"（`liveTradingMap.ts`、`liveTradingDto.ts`、`state/liveTrading.ts` 和测试）。
- 文字：`engine/README.md`、`deploy/remote/README.md`，以及 `research-round` 技能 `references/strategy-authoring.md` 的 Live 一条。
- 评测用例 `.agents/evals/research-round/live-adaptation-separate-orders` 的措辞依赖旧上限，按 AGENTS.md 另开 PR 修。

## 5. 不改

- 预算上限 100、现金 ≥ 预算、一次一笔、只接受 LIMIT 入场、亏损阈值和运行时长（后两者在连续运行第 4、5 步另改）。
- 研究的起始资金和可比性：研究照旧按缺省 100,000 比较；钱包规模只做可行性回放（`--starting-balance`）。

## 6. 验证

- 单元测试：准入返回 min(钱包, 可用)；预算边界；最小下单按 3 × E；派发时刚好 3 × E 被接受、超过被拒且没有原生订单；
  E 取自派发快照（连接时 100、派发时 200，600 名义被接受）；可用余额低于钱包时按可用算；v5 运行只能对账；protocol-3 基线。
- 原有 Live 测试按新字段改写后全部通过；Web `npm run check`。
- 不做实盘试运行：每次真实账户试运行仍要用户单独授权、由用户启动。
