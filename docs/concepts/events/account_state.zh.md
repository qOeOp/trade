# AccountState

`AccountState` 携带账户余额和保证金的快照。当交易场所通过执行客户端报告账户更新时，
或 `Portfolio` 在持仓更新后重新计算账户状态时（适用于启用了 `calculate_account_state`
的保证金账户），会触发此事件。`Portfolio` 在内部订阅这些事件，以维护敞口和余额跟踪。

`is_reported` 标志用于区分交易场所报告的快照与系统计算的快照。

## 字段

| 字段            | Python 类型            | 必填/默认值 | 说明                                        |
| --------------- | ---------------------- | ----------- | ------------------------------------------- |
| `account_id`    | `AccountId`            | 必填        | 账户 ID（包含交易场所）。                   |
| `account_type`  | `AccountType`          | 必填        | 账户类型（`CASH`、`MARGIN` 或 `BETTING`）。 |
| `base_currency` | `Currency` or `None`   | 必填        | 账户基础货币（多币种账户为 `None`）。       |
| `is_reported`   | `bool`                 | 必填        | 状态是否由交易所报告（否则由系统计算）。    |
| `balances`      | `list[AccountBalance]` | 必填        | 账户余额（可以为空）。                      |
| `margins`       | `list[MarginBalance]`  | 必填        | 保证金余额（可以为空）。                    |
| `info`          | `dict[str, object]`    | 必填        | 其他实现特定的账户信息。                    |
| `event_id`      | `UUID4`                | 必填        | 事件 ID。                                   |
| `ts_event`      | `int`                  | 必填        | 事件发生时的 UNIX 时间戳（纳秒）。          |
| `ts_init`       | `int`                  | 必填        | 对象初始化时的 UNIX 时间戳（纳秒）。        |

## 示例

账户状态通常通过 `Portfolio` 使用，而不是通过专用处理器：

```python
from vibe_trader.model import Venue

# Account state is tracked by the portfolio; query it by venue
account = self.portfolio.account(Venue("BINANCE"))
self.log.info(f"Account state: {account}")
```

## 相关指南

- [事件](index.md) - 事件类别与分派。
- [账户](../accounting.md) - 账户类型、余额及保证金模型。
- [投资组合](../portfolio.md) - 账户状态如何用于敞口和余额跟踪。
