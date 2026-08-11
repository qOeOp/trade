# Interactive Brokers

Interactive Brokers（IB）提供股票、期权、期货、货币、债券、基金及其他资产类别的市场接入。
VibeTrader 适配器通过 [TWS API](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/) 连接 Trader Workstation
（TWS）或 IB Gateway。

该适配器通过同一套 Rust 实现及 Python 绑定，提供实盘数据、执行、历史数据、金融工具加载，
以及可选的容器化 IB Gateway 管理。

## 安装

请按照[安装指南](../getting_started/installation.md)安装 VibeTrader。Python 软件包已包含
Interactive Brokers 适配器和 Docker gateway 支持，无需安装适配器专用 extra。

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/interactive_brokers/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/interactive_brokers/examples/)

## 入门

启动客户端前，请先运行 TWS 或 IB Gateway。配置该应用以接受 socket API 连接，并让其以 UTC
返回市场数据时间戳。适配器运行时不会转换 TWS 或 IB Gateway 的时区。

IB 对不同应用和交易模式使用不同的默认端口：

| 应用       | 模拟交易 | 实盘交易 |
| ---------- | -------: | -------: |
| TWS        | `7497`   | `7496`   |
| IB Gateway | `4002`   | `4001`   |

适配器默认为 `127.0.0.1:4002`，对应本地模拟交易 IB Gateway。使用 TWS 或实盘账户时，
请显式设置端口。

### 连接 TWS 或 IB Gateway

从 `vibe_trader.adapters.interactive_brokers` 导入公开配置类型：

```python
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersDataClientConfig
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersExecClientConfig
from vibe_trader.adapters.interactive_brokers import MarketDataType


data_config = InteractiveBrokersDataClientConfig(
    host="127.0.0.1",
    port=7497,
    client_id=101,
    market_data_type=MarketDataType.DELAYED,
)

exec_config = InteractiveBrokersExecClientConfig(
    host="127.0.0.1",
    port=7497,
    client_id=101,
    account_id="DU123456",
)
```

连接同一 TWS 或 IB Gateway 会话的每个进程都应使用不同的客户端 ID。执行客户端 ID 不能是
`1000` 的倍数，因为适配器按 `client_id % 1000` 对订单 ID 分区。

当前的 [Python 数据测试器](https://github.com/qOeOp/trade/blob/main/examples/live/interactive_brokers/data_tester.py)
和[执行测试器](https://github.com/qOeOp/trade/blob/main/examples/live/interactive_brokers/exec_tester.py)
展示了如何将这些配置及其 factory 添加到 `LiveNode`。

### 使用容器化 IB Gateway

适配器可以管理
[gnzsnz IB Gateway 容器](https://github.com/gnzsnz/ib-gateway-docker)。可在配置中提供凭据，
也可通过 `TWS_USERNAME` 和 `TWS_PASSWORD` 提供：

```python
from vibe_trader.adapters.interactive_brokers import DockerizedIBGateway
from vibe_trader.adapters.interactive_brokers import DockerizedIBGatewayConfig
from vibe_trader.adapters.interactive_brokers import TradingMode


gateway = DockerizedIBGateway(
    DockerizedIBGatewayConfig(
        trading_mode=TradingMode.PAPER,
        read_only_api=True,
    ),
)
gateway.start_blocking()

print(gateway.host)
print(gateway.port)
```

请单独启动 `DockerizedIBGateway`，再将其 `host` 和 `port` 传给数据与执行配置。向任一客户端
配置传入非 `None` 的 `dockerized_gateway` 参数会引发 `ValueError`，因为 Python 不负责容器生命周期。

只有 gateway 必须提交订单时才设置 `read_only_api=False`。默认容器为
`ghcr.io/gnzsnz/ib-gateway:stable`；需要远程桌面访问时，`vnc_port` 可使用 `5900` 至 `5999` 的端口。

## 组件

公开 Python 模块导出以下主要组件：

- `InteractiveBrokersDataClientFactory`：创建实盘市场数据客户端。
- `InteractiveBrokersExecutionClientFactory`：创建实盘执行客户端。
- `InteractiveBrokersInstrumentProvider`：解析 IB 合约与 Vibe 金融工具。
- `HistoricalInteractiveBrokersClient`：请求历史金融工具、柱和 tick。
- `DockerizedIBGateway`：管理容器化 IB Gateway。

## 符号体系与金融工具

`InteractiveBrokersInstrumentProviderConfig` 支持两种符号体系方法：

| 方法                         | 用途                       | 示例       |
| ---------------------------- | -------------------------- | ---------- |
| `SymbologyMethod.SIMPLIFIED` | 使用更短、更易读的符号。   | `EUR/USD`  |
| `SymbologyMethod.RAW`        | 在符号中保留 IB 证券类型。 | `AAPL=STK` |

默认值为 `SIMPLIFIED`。如果证券类型必须在金融工具 ID 中保持显式，例如
`AAPL=STK.SMART`，请使用 `RAW`。

可通过 Vibe 金融工具 ID 或 IB 合约字典配置金融工具：

```python
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersInstrumentProviderConfig
from vibe_trader.adapters.interactive_brokers import SymbologyMethod
from vibe_trader.model import InstrumentId


provider_config = InteractiveBrokersInstrumentProviderConfig(
    symbology_method=SymbologyMethod.RAW,
    load_ids={InstrumentId.from_str("AAPL=STK.SMART")},
    load_contracts=[
        {
            "symbol": "MSFT",
            "secType": "STK",
            "exchange": "SMART",
            "currency": "USD",
        },
    ],
)
```

同一份 provider 配置可同时传给数据与执行客户端配置，从而保证两个客户端的合约解析与金融工具
ID 一致。

### 金融工具 provider 选项

| 选项                            | 默认值       | 用途                                         |
| ------------------------------- | ------------ | -------------------------------------------- |
| `symbology_method`              | `SIMPLIFIED` | 选择简化或原始金融工具符号。                 |
| `load_ids`                      | 空           | 启动时加载 Vibe 金融工具 ID。                |
| `load_contracts`                | 空           | 启动时加载 IB 合约字典。                     |
| `min_expiry_days`               | `None`       | 设置加载衍生品链时的最短到期天数。           |
| `max_expiry_days`               | `None`       | 设置加载衍生品链时的最长到期天数。           |
| `build_options_chain`           | `None`       | 控制是否构建完整期权链。                     |
| `build_futures_chain`           | `None`       | 控制是否构建完整期货链。                     |
| `cache_validity_days`           | `None`       | 设置缓存金融工具数据的有效期。               |
| `convert_exchange_to_mic_venue` | `False`      | 将 IB 交易所代码转换为 MIC 交易场所。        |
| `symbol_to_mic_venue`           | 空           | 覆盖指定符号的 MIC 交易场所。                |
| `filter_sec_types`              | 空           | 排除指定 IB 证券类型。                       |
| `filter_callable`               | `None`       | 通过完全限定的导入路径应用 Python callable。 |
| `cache_path`                    | `None`       | 将金融工具缓存持久化到指定路径。             |

### 衍生品链与价差组合

在合约字典中设置 chain flag，可将该合约用作标的或衍生品链种子。provider 级别的
`min_expiry_days` 和 `max_expiry_days` 会限制加载的合约：

```python
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersInstrumentProviderConfig


provider_config = InteractiveBrokersInstrumentProviderConfig(
    load_contracts=[
        {
            "symbol": "SPY",
            "secType": "STK",
            "exchange": "SMART",
            "currency": "USD",
            "build_options_chain": True,
        },
        {
            "symbol": "ES",
            "secType": "CONTFUT",
            "exchange": "CME",
            "currency": "USD",
            "build_futures_chain": True,
        },
    ],
    min_expiry_days=7,
    max_expiry_days=60,
)
```

当 `CONTFUT` 带有 chain flag 时，适配器会对其进行合约确认，并加载匹配的有到期日期货或
期货期权。没有 chain flag 时，它表示 IB 连续期货，而 IB 将连续期货限制为只能获取历史数据；
它既不能提供实盘市场数据，也不能接受订单。参见
[IB 连续期货文档](https://www.interactivebrokers.com/docs/general/contracts/futures/continuous-futures)。

适配器还会根据 Vibe 价差金融工具 ID 解析 IB `BAG` 合约。订阅或交易价差组合前，先请求该金融工具：

```python
from vibe_trader.model import InstrumentId


spread_id = InstrumentId.from_str("(1)SPY C400_((1))SPY C410.SMART")
self.request_instrument(spread_id)
```

单括号表示正的腿比例，双括号表示负比例。所有腿必须使用同一交易场所。IB 要求每条组合腿都
提供合约 ID、比例、操作和交易所；参见 [TWS API 中的价差组合](https://www.interactivebrokers.com/docs/general/contracts/spread-contracts/twsapi-spreads/spreads-in-the-tws-api)。

## 历史数据

`HistoricalInteractiveBrokersClient` 使用金融工具 provider 和数据客户端配置建立连接。
其异步 Python 方法支持：

- `request_instruments`：发现合约与金融工具。
- `request_bars`：请求一种或多种柱规格。
- `request_ticks`：请求历史成交或买卖报价 tick。

IB 控制历史数据可用性、请求速率限制、柱大小、持续时间及常规交易时段筛选。选择请求范围前，
请查看[官方历史柱文档](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/#historical-bars)
和[历史逐笔成交文档](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/#historical-time-sales)。

## 订单路由与 IB 属性

提交订单、提交订单列表或修改订单时，可传入 `params={"exchange": "..."}`，为该命令覆盖缓存
合约的交易所。空值或省略该值时保留缓存中的交易所：

```python
self.submit_order(order, params={"exchange": "IEX"})
```

IB 专用订单属性可通过 tag 传入：以 `IBOrderTags:` 为前缀，后接 JSON 对象。适配器会覆盖已识别的
IB 订单字段，并支持价格、时间、保证金、执行、成交量与百分比变化条件：

```python
import json


ib_attributes = {
    "ocaGroup": "MY_OCA_GROUP",
    "ocaType": 1,
    "conditionsCancelOrder": False,
    "conditions": [
        {
            "type": "price",
            "conId": 265598,
            "exchange": "SMART",
            "isMore": True,
            "price": 250.0,
            "triggerMethod": 0,
        },
    ],
}
tags = [f"IBOrderTags:{json.dumps(ib_attributes)}"]
```

将 `tags` 传给订单 factory。OCA 类型 `1` 会在防止超额成交的同时取消剩余订单；类型 `2` 和 `3`
会按比例减少剩余订单，分别启用和不启用该保护。支持的订单属性参见
[IB 订单参考](https://www.interactivebrokers.com/docs/tws-api/ref/order-class-reference/introduction)。

## 配置

### 数据客户端

| 选项                             | 默认值      | 用途                                  |
| -------------------------------- | ----------- | ------------------------------------- |
| `host`                           | `127.0.0.1` | TWS 或 IB Gateway 主机。              |
| `port`                           | `4002`      | TWS 或 IB Gateway socket 端口。       |
| `client_id`                      | `1`         | IB API 客户端 ID。                    |
| `use_regular_trading_hours`      | `True`      | 将请求限制在常规交易时段。            |
| `market_data_type`               | `REALTIME`  | 选择实时、冻结、延迟或延迟冻结数据。  |
| `ignore_quote_tick_size_updates` | `False`     | 忽略只改变数量的报价更新。            |
| `connection_timeout`             | `300` 秒    | 设置 socket 连接超时。                |
| `request_timeout`                | `60` 秒     | 设置 IB API 请求超时。                |
| `handle_revised_bars`            | `False`     | 处理修订后的实时柱。                  |
| `batch_quotes`                   | `True`      | 使用 `reqMktData`，而非逐 tick 报价。 |
| `instrument_provider`            | 默认值      | 配置合约与金融工具加载。              |

### 执行客户端

| 选项                                         | 默认值      | 用途                            |
| -------------------------------------------- | ----------- | ------------------------------- |
| `host`                                       | `127.0.0.1` | TWS 或 IB Gateway 主机。        |
| `port`                                       | `4002`      | TWS 或 IB Gateway socket 端口。 |
| `client_id`                                  | `1`         | IB API 客户端 ID。              |
| `account_id`                                 | `None`      | 选择 IB 账户。                  |
| `connection_timeout`                         | `300` 秒    | 设置 socket 连接超时。          |
| `request_timeout`                            | `60` 秒     | 设置 IB API 请求超时。          |
| `fetch_all_open_orders`                      | `False`     | 请求会话可见的所有活动订单。    |
| `track_option_exercise_from_position_update` | `False`     | 根据持仓更新推断期权行权。      |
| `instrument_provider`                        | 默认值      | 配置合约与金融工具加载。        |

## 故障排除

- 确认 TWS 或 IB Gateway 正在运行且已登录。
- 确认 socket API 访问已启用，并且配置端口与应用和交易模式一致。
- 确认 API 客户端 ID 未被占用。
- 确认账户拥有所需市场数据订阅。只有能够接受延迟数据时才使用
  `MarketDataType.DELAYED`。
- 确认 TWS 或 IB Gateway 已配置为输出 UTC 时间戳。

IB 错误代码和连接设置参见
[官方 TWS API 参考](https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/)。

## 贡献

如需添加功能或参与 Interactive Brokers 适配器开发，请参阅
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
