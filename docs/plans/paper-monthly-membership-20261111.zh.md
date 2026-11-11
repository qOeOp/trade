# Paper 运行中逐月读成员资格（覆盖核对 U9，2026-11-11）

用户 2026-11-11「全按建议」授权 U9：运行中的 Paper 每月初重读成员资格，离开成员的合约只平不开。

## 做法

- **宿主写月文件。** `paper start` 和 `paper serve` 的巡检循环（每轮对运行中的 run）调用 `paper.runs.write_months`：
  市场最新提交里有的、开跑月份之后的每个月，写 `inputs/membership/<YYYY-MM>.json`
  （`{"market_commit", "members"}`，只列本 run 的合约）。写过的不再改。`universe.json` 不变，恢复身份不变。
- **运行器按月读。** `engine.paper.Membership` 就是策略收到的 `universe_membership`：开跑月份取自 `universe.json`
  （截到月末），之后每个月在该月开始后、策略或下单规则第一次读它时读对应月文件；文件还没到就当不是成员，
  日志记一次 `membership_stale`（`PAPER_MEMBERSHIP_STALE`）；读到后日志记 `membership`（含文件 sha256）。
  策略在构造时拷贝的副本只含当时已有的月份，所以拷贝的策略到月底后只是不再开仓。
- **只平不开。** Paper 的 `submit_order` 在下单规则之前看：不是 reduce-only、且此刻不在成员区间的单不发，
  日志记 `entry_not_sent`（`PAPER_NOT_A_MEMBER`），运行继续；reduce-only 单照常交给下单规则。

## 取舍

- 选「运行中重读」而非「每月停掉重开」：重开要让恢复身份在月界接受成员变化，还要两段运行合并统计。
- 选「不发并记日志」而非违规停跑：成员变化是行情事件，不是策略缺陷；回放里同样的单由独立审计
  （`ENTRY_ORDER_OUTSIDE_MEMBERSHIP`）判，这条只在 Paper 里拦，回放和 Live 的规则不变。
- Nautilus rc7 没有按合约的只减仓开关（`TradingState.REDUCING` 是全账户的），所以拦在策略包装层。
