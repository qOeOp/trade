# 完整 aggTrades 第一阶段：追加源表与导入

2026-10-29。用户授权仅建表、导入入口、隔离测试和合并后的 BTCUSDT 2025-10 单月试导。
不实施按需报价重构或 TradeTick 执行，不改旧 bar/quote、旧提交、旧导出或拒绝条件。

**2026-11-22 裁剪**：市场后来改为市场目录里的 Parquet 文件（[`market/README.md`](../../market/README.md)），
本稿的 Dolt 表、主键、库权限与升级说法，以及 Dolt 隔离基准、DoltHub 容量与试导门槛几节随之失效，已删去
（第三轮瘦身，doctor `20261121-13`；用户委托：「需要我定的部份最后也是一样由你决定按推荐做」）；原文在提交
`216633acf`。下面的字段取舍与精确编码仍是现行依据。

## 字段独立评审与决定

原方案的只读子代理 `/root/aggtrade_schema_review` 评审八列源事实。本次在实施前由独立只读
子代理 `/root/aggtrade_field_review` 再次对照现有 schema、升级、解析和导入路径，结论通过。
用户已明确批准将原 DECIMAL 基准候选的价量换为逐值证明无损的 ×1e8 整数，不增加事实。

| 字段 | 消费者与独立事实 | 现有字段、关系或推导为何不能恢复 |
|---|---|---|
| symbol | 合约筛选、instrument/lifecycle 关联；归档路径声明的身份 | 官方事件行没有合约名，ID 不跨合约唯一 |
| transact_time | 时间范围扫描与未来事件时钟；源 UTC 毫秒 | bar 聚合，quote 只记录状态变化 |
| agg_trade_id | 源事件身份、同毫秒次序、连续性核对 | 未改变报价的成交不在 quote，bar 没有事件序列 |
| price | 原始实际成交价，供未来成交分析 | 推导报价存在过时侧调整，不能逆向恢复全部成交 |
| quantity | 每笔聚合成交数量，供未来成交量/容量分析 | quote 没有，bar 只有汇总 |
| first_trade_id | 官方逐笔 ID 区间起点 | 不能由 agg ID 或相邻末 ID 推导 |
| last_trade_id | 官方逐笔 ID 区间终点 | 不能由下一行首 ID 推导，尤其源边界/缺口 |
| is_buyer_maker | 原始主动方向信息 | quote 不保存每个源事件方向 |

决定：只存这八个源事实。价量分别 ×1e8 后存有符号 64 位整数；时间和 ID 原整数，maker 原布尔值。
不借用 bar `volume_scale`，不存 taker_side、名义额、分钟桶、日日期、来源表或逐行哈希。
`last-first+1` 只是 ID 范围长度，不把它称为经过保证的逐笔成交数。
格式为数值语义完整，不能恢复 CSV 尾零、头行、换行或 ZIP 压缩字节。

`binance-aggtrades-int64-scale8-v1` 是编码身份。精确转换用整数比值与整除证明，独立于 Decimal
context；任何余数或 signed int64 溢出均 `SCALE_LOSS`，全月拒绝，无舍入或退回其他编码。

独立评审指出并落实：ZIP/CSV 流读，不整日装入内存；源 ID 连续性跨批次、日和前夕核对；前夕也核验
完整字段、数量精度和 UTC 日归属，虽不写入，其拒绝同样拒绝本月。
