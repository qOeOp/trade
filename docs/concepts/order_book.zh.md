# 订单簿

VibeTrader 提供以 Rust 实现的高性能订单簿，能够维护各类受支持公开订单簿的完整状态。`OrderBook` 是跟踪公开市场深度的主要组件；`OwnOrderBook` 则单独跟踪自己的订单，从而提供显示真实可用流动性的过滤视图。

:::note
本指南介绍 Rust API。Python 也可以通过公共模型模块使用这些类型（`vibe_trader.model.OrderBook` 和 `vibe_trader.model.OwnOrderBook`）。Rust 与 Python 接口之间的差异请参阅 API 参考。
:::

## 订单簿类型

在回测和实盘交易中，每个金融工具分别维护一个 `OrderBook` 实例：

- `L3_MBO`：Level 3 按订单市场（MBO）数据。跟踪各价格档位上的每一笔订单，并以订单 ID 为键。在订单簿的每一侧，一个订单 ID 只映射到一个价格档位；以不同价格重新添加同一 ID 会将订单移到新档位。值为零的订单 ID 不表示任何身份（例如聚合深度或 MBP 风格的输入），因此订单簿会根据订单价格派生 ID。
- `L2_MBP`：Level 2 按价格市场（MBP）数据。按价格档位聚合订单，每个价格对应一个条目。
- `L1_MBP`：Level 1 按价格市场（MBP）的最优档数据，也称最优买卖价（BBO）。仅记录最优价格。

:::note
报价、成交和 K 线数据（`QuoteTick`、`TradeTick` 和 `Bar`）也可以驱动 `L1_MBP` 订单簿。
:::

## 订阅订单簿数据

策略和 actor 通过以下方法订阅订单簿更新。订阅方法和处理器属于 Python 策略/actor 层：

```python
from vibe_trader.model import BookType


# Incremental book deltas
self.subscribe_book_deltas(instrument_id, BookType.L2_MBP)

# Aggregated depth snapshots (up to 10 levels)
self.subscribe_book_depth10(instrument_id, BookType.L2_MBP)

# Full book snapshots at a timed interval
self.subscribe_book_at_interval(instrument_id, BookType.L2_MBP, interval_ms=1000)
```

每种订阅类型都会将数据传递给相应的处理程序：

```python
def on_book_deltas(self, deltas: OrderBookDeltas) -> None: ...


def on_book_depth(self, depth: OrderBookDepth10) -> None: ...


def on_book(self, order_book: OrderBook) -> None: ...
```

## 访问订单簿

`OrderBook` 提供以下最优档访问器：

```rust
let best_bid: Option<Price> = book.best_bid_price();
let best_ask: Option<Price> = book.best_ask_price();
let spread: Option<f64> = book.spread();
let midpoint: Option<f64> = book.midpoint();
```

## 分析方法

`OrderBook` 支持市场深度分析和执行模拟：

```rust
// Average fill price for a given quantity
let avg_px = book.get_avg_px_for_quantity(quantity, OrderSide::Buy);

// Average price and quantity for a target exposure (notional)
let (price, qty, exposure) =
    book.get_avg_px_qty_for_exposure(target_exposure, OrderSide::Buy);

// Cumulative quantity available at or better than a price
let qty = book.get_quantity_for_price(price, OrderSide::Buy);

// Quantity at a specific price level only
let qty = book.get_quantity_at_level(price, OrderSide::Buy, 2);

// Simulate fills against the book
let fills: Vec<(Price, Quantity)> = book.simulate_fills(&order);

// All crossed levels regardless of order quantity
let levels = book.get_all_crossed_levels(OrderSide::Buy, price, 2);
```

## 完整性检查

`book_check_integrity` 函数验证订单簿状态是否与其类型一致：

- **L1_MBP**：每侧最多一个档位。
- **L2_MBP**：每个价格档位最多一笔订单。
- **L3_MBO**：无结构约束（任何级别的任意数量的订单）。
- **所有类型**：最优买价不得高于最优卖价（交叉订单簿）。锁价市场（买价 == 卖价）视为有效。

应用增量时会在内部执行这些检查。系统还会验证传入增量的金融工具 ID 是否与订单簿的金融工具 ID 一致；不一致时返回 `BookIntegrityError::InstrumentMismatch`。

带有 `NoOrderSide` 的增量要求缓存中能够唯一确定订单方向。如果其订单 ID 同时存在于两侧，`Add` 会返回 `BookIntegrityError::AmbiguousOrderSide`；`Update` 或 `Delete` 则会跳过该增量并发出警告。

## 友好打印

`OrderBook` 和 `OwnOrderBook` 都提供 `pprint` 方法，以便将订单簿呈现为人类可读的表格：

```rust
book.pprint(5, None);
book.pprint(5, Some(Decimal::new(1, 2))); // group_size = 0.01
```

对于 tick 较细的金融工具，`group_size` 参数会将价格档位归并到更粗的分组中。输出为格式化表格：左侧显示买单，中间显示价格，右侧显示卖单。

## 自有订单簿

`OwnOrderBook` 将自己的活动订单与公开订单簿分开跟踪。做市及其他报价策略可以用它扣除自身订单，估算每个价格档位的可用流动性。

启用 `manage_own_order_books` 后，执行引擎会维护自有订单簿。订单事件改变状态时，缓存会更新已有的自有订单簿。可跟踪的订单必须有价格，且有效期类型不能是 `IOC` 或 `FOK`。即使订单原本不符合跟踪条件，终态事件仍可能清理已有的自有订单簿条目。

### 订单生命周期

`OwnOrderBook` 在整个生命周期中跟踪订单。订单提交或通过对账生成后加入订单簿，状态变化到达时更新，关闭时移除。更新涵盖订单模型支持的已接受、待更新、待取消、部分成交、已成交、已取消、已过期、已拒绝和已否决等状态。

每个 `OwnBookOrder` 都包含：

- `client_order_id`：用于使自有订单簿与缓存状态保持一致的客户端订单 ID。
- `venue_order_id`：交易场所已经分配的订单 ID。
- `side`、`price` 和 `size`：订单方向、价格和未成交数量（leaves quantity）。
- `order_type` 和 `time_in_force`：过滤器和诊断使用的订单类型元数据。
- `status`：当前订单状态，例如 `SUBMITTED`、`ACCEPTED` 或 `PENDING_CANCEL`。
- `ts_last`：应用于这笔自有订单的最新订单事件时间戳。
- `ts_accepted`：交易场所接受订单时的时间戳。
- `ts_submitted`：提交订单时的时间戳。
- `ts_init`：订单初始化时的时间戳。

这些字段使过滤视图可以按状态和接受时间纳入或排除自有订单（参阅[状态和时间过滤](#状态和时间过滤)）。

### 审计

`audit_open_orders` 方法根据一组有效的客户端订单 ID 对自有订单簿进行对账。不在给定集合中的自有订单会被移除，并记为审计错误。`Cache::audit_own_order_books` 根据未结和在途订单构建该集合，因此不会在交易场所的正常延迟窗口内移除已提交订单。实盘系统可以按照自有订单簿审计间隔定期执行此审计。

### 查询

```rust
// Check if a specific order is tracked
let in_book = own_book.is_order_in_book(&client_order_id);

// Get all tracked order IDs per side
let bid_ids = own_book.bid_client_order_ids();
let ask_ids = own_book.ask_client_order_ids();

// Aggregated quantities per price level
let bid_qty = own_book.bid_quantity(None, None, None, None, None);
let ask_qty = own_book.ask_quantity(None, None, None, None, None);

// Pretty print
own_book.pprint(5, None);
```

### 过滤视图

从公开订单簿中扣除自己的订单，即可查看净可用流动性：

```rust
// Filtered maps of price -> quantity (own orders subtracted)
let net_bids = book.bids_filtered_as_map(Some(10), Some(&own_book), None, None, None);
let net_asks = book.asks_filtered_as_map(Some(10), Some(&own_book), None, None, None);

// Full filtered OrderBook with all analysis methods available
let filtered = book.filtered_view(Some(&own_book), Some(10), None, None, None);
let avg_px = filtered.get_avg_px_for_quantity(quantity, OrderSide::Buy);
```

`filtered_view` 方法会返回一个扣除自身订单数量的新 `OrderBook`，因此可以在净订单簿上使用完整的分析方法（`spread`、`midpoint`、`get_avg_px_for_quantity` 等）。

### 状态和时间过滤

过滤视图支持按可选状态和时间条件筛选自有订单：

```rust
let status = Some(AHashSet::from([OrderStatus::Accepted]));

// Only subtract ACCEPTED orders (ignore SUBMITTED, PENDING_CANCEL, etc.)
let filtered = book.filtered_view(Some(&own_book), None, status, None, None);
```

`accepted_buffer_ns` 参数提供一个宽限期：设置后，仅纳入满足 `ts_accepted + buffer <= now` 的订单。这样可以排除最近刚被接受、可能尚未出现在公开订单簿数据流中的订单。无论订单状态如何，缓冲期都作用于 `ts_accepted` 字段。省略 `ts_now` 会禁用接受时间过滤；正数 `accepted_buffer_ns` 则要求同时提供 `ts_now`。还可以结合状态过滤器排除尚未接受的订单。

```rust
// Only subtract orders accepted at least 500ms ago
let filtered = book.filtered_view(
    Some(&own_book),
    None,
    None,
    Some(500_000_000),
    Some(clock.timestamp_ns()),
);
```

## 二元市场

对于二元/预测市场（例如 Polymarket），金融工具有两个互补方向（YES 和 NO），两侧价格之和为 1.0。NO 侧 0.40 的买价在经济上等价于 YES 侧 0.60 的卖价。

`OwnOrderBook::combined_with_opposite` 方法执行该转换，将两侧订单合并到单一视图中：

```rust
let yes_own = own_yes_book
    .cloned()
    .unwrap_or_else(|| OwnOrderBook::new(yes_instrument_id));

let no_own = own_no_book
    .cloned()
    .unwrap_or_else(|| OwnOrderBook::new(no_instrument_id));

// Merge NO-side orders with parity price transform (1 - price)
let combined = yes_own.combined_with_opposite(&no_own).unwrap();

// Filter the public YES book using the combined own book
let filtered = book.filtered_view(Some(&combined), None, None, None, None);
```

转换的工作原理如下：

- NO 侧价格为 P 的卖单，在合并订单簿中转换为价格 1 - P 的买单。
- NO 侧价格为 P 的买单，在合并订单簿中转换为价格 1 - P 的卖单。

这样可以完整呈现自己在市场两侧提供的流动性。
