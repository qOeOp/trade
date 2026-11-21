# 订单规则 5：只放行 Live 发得出的订单（2026-11-21）

来源：[0.5.0 全量重判](rejudge-0.5-20261121.zh.md) 的 C-160、C-143、C-058；doctor 行 20261114-36 与 20261121-26。

## 决定

2026-11-21 用户把需要定夺的事项交给 Claude：「需要我定的部份最后也是一样由你决定按推荐做」。据此收紧 `engine/order_rules.py` 规则 5（拒绝码仍是 `ORDER_RULE`，不加新码），回放、Paper、Live 三条链路同一规则：

- C-160：GTD 到期至少在提交后 605 秒（`GTD_LEAD_NS` = Binance 的 600 秒 `GTD_MINIMUM_NS` 加 Live 为入场账户核对留的 5 秒 `SEND_MARGIN_NS`）。此前 600–605 秒的 GTD 回放与 Paper 照收，Live 以 `LIVE_ORDER_UNSUPPORTED` 拒。
- C-143：只收默认触发类型（`DEFAULT`，非触发单为 `NO_TRIGGER`）。`MARK_PRICE`、`LAST_PRICE` 等在回放与 Paper 按 bar 价撮合，Binance 按各自的价，三条链路对同一源码给不同触发。`LAST_PRICE` 在 Binance 与默认同为 `CONTRACT_PRICE`，也一并拒：写法不同、意思相同，拒掉只要源码删一个参数，规则更简单。
- C-058：只收钉住版本（rc7）Binance USD-M 客户端发得出的形状，依据 rc7 源码的拒绝分支：
  - 订单类型：`crates/adapters/binance/src/futures/http/client.rs` `order_type_to_binance_futures` 只映射 MARKET、LIMIT、STOP_MARKET、STOP_LIMIT、MARKET_IF_TOUCHED、LIMIT_IF_TOUCHED、TRAILING_STOP_MARKET；其余（TRAILING_STOP_LIMIT、MARKET_TO_LIMIT）在 `futures/execution.rs` `validate_order` 里 `UnsupportedOrderType`。
  - 有效期：`common/enums.rs` `BinanceTimeInForce::try_from` 只收 GTC、IOC、FOK、GTD；DAY、AT_THE_OPEN、AT_THE_CLOSE 为 `UnsupportedTimeInForce`。`close_position` 的市价单不经 `submit_order`，规则在 `OrderRules.close_position` 里另查（GTD 市价平仓在原生代码里直接 panic）。
  - 移动止损偏移只收 `BASIS_POINTS`（`validate_order` 的 `UnsupportedTrailingOffsetType`）。
  - GTD 不能 post-only（`determine_futures_order_lifetime`）。

## 证明

`tests/engine/test_order_rules.py` 先写失败用例（每种形状一例，另有放行的反例），修复后通过；配对原生验收见 PR。已封存的运行不受影响；用到这些形状的源码要出新版本。
