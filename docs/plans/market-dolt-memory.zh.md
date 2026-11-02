# 市场库放在 Dolt 里的体积和内存（2026-11-02 实测）

起因：用户问 DoltHub 是不是最优的存储。研究账本（161 MB）要的是只增、可验证的历史和免费公开发布，Dolt 正合适，
不在本文讨论。本文只量市场库（207 GB，大头是推算报价和 aggTrades 成交）：同样的数据放在 Dolt 里比 Parquet
大多少，Dolt 服务要多少内存，以及 16 GB 内存的采集服务器（`collection-server.zh.md`）够不够。

所有测量都在一次性的库或容器里做，没有写活动账本或活动市场库，用完已删除。镜像
`ghcr.io/qoeop/trade-service:main`，Dolt 2.4.2。

## 1. 体积：Dolt 约为 Parquet 的 2.6–2.8 倍

BTCUSDT 2025-10 一个月，从活动市场库 `main`（`ire8moaj1thrkbhpiggali41hdl92q1c`）用产品自己的只读账户读出。同一批行
分别写成 Parquet，和用 `dolt table import` 导进一个空 Dolt 库（建表语句同 `market/schema.sql`）。Dolt 的体积是
`dolt gc` 后 `.dolt` 的大小；推到 `file://` 远端后大小相同。

| 表 | 行数 | Dolt | Parquet zstd(3) | Parquet zstd(9) | Dolt ÷ zstd(3) |
|---|---:|---:|---:|---:|---:|
| `quote` | 42,150,652 | 505 MB（12.0 字节/行） | 189 MB（4.49） | 169 MB（4.01） | 2.67 |
| `agg_trade` | 55,717,206 | 1,118 MB（20.1 字节/行） | 430 MB（7.72） | 402 MB（7.22） | 2.60 |
| 合计 | | 1,623 MB | 619 MB | 571 MB | 2.62（zstd(9) 为 2.84） |

报价 12.0 字节/行和 `market-full-history-cost.zh.md` 从备份差值推算的 11.2 字节/行一致。

## 2. 内存：Dolt 常驻内存随库变大，16 GB 不够

在限内存（`--memory` 等于 `--memory-swap`，不用交换区）的容器里，用 206 GB 的市场库副本测试。副本从
`dolt-backups/market` 得到：先把备份的表文件链接进一个工作目录（同 `ledger/admin.py` 的 `_link_store`，备份
不动），再用 `dolt backup restore`。每 5 秒采样一次 Dolt 进程的匿名内存（RssAnon），并记录容器的 OOM 次数。

| 负载 | 上限 | 结果 |
|---|---|---|
| `dolt backup restore`（相当于新机器第一次克隆） | 16 GB | 拷贝期间稳定在约 10.2 GB；203 GB 写完后的收尾阶段被 OOM 杀掉 |
| 同上 | 40 GB | 峰值 28.8 GB；文件 3 分钟拷完，收尾阶段跑了 30 多分钟仍未结束，测试中途停掉 |
| `dolt sql-server` 刚启动、跑完一条查询 | 16 GB | 11.1 GB |
| `market import-trades --month 2026-10 --symbols BTCUSDT ETHUSDT SOLUSDT`（产品命令，三个合约并行写） | 16 GB | 7 分钟写到 10-27，Dolt 稳定在 15.7 GB 没被杀；导入进程只有 0.1 GB。随后因 Binance 尚未发布 2026-10-28 的日归档被拒（`ARCHIVE_NOT_PUBLISHED`），整月未提交，所以提交阶段没有量到 |
| `CALL DOLT_GC()` | 16 GB | 开始后马上被 OOM 杀掉 |
| `CALL DOLT_GC()`，加 `GOMEMLIMIT=13GiB` | 16 GB | 撑了约 6.5 分钟，涨到 15.9 GB 后被杀；所以 gc 用的是存活内存，不是迟迟没回收的垃圾 |

本机生产环境的 ledger 容器（同时放账本和市场库）：2026-11-02 常驻 10.4 GB；从 11-01 04:10 启动起，峰值
（VmHWM）35.3 GiB。是哪一步造成的峰值没查出来：期间 `market-import` 只做过很小的每日导入。

刚启动、几乎没做事时就占约 11 GB，而且导入、gc、还原都在这个基础上往上加。由此推测，常驻部分是全部表文件的
索引，会随库变大而变大；这条推测没有单独验证。三个合约每月新增 3–4 GB 数据，常驻内存也会跟着慢慢涨。

## 3. 结论

- **本机：** ledger 服务加内存上限 `TRADE_LEDGER_MEMORY`，默认 40g（实测峰值 35.3 GiB 再留点余量），
  让 Dolt 不能占掉 paper 等服务的内存；超限时 Dolt 被杀、按 `restart: unless-stopped` 重启，进行中的导入整笔回滚，
  由 `market follow` 下次再导。2026-11-02 已用 `docker update` 对运行中的容器生效，没有重启。
- **采集服务器：** 只放市场库的话，16 GB 跑不了 gc 和第一次克隆，月度成交导入也只剩约 0.3 GB 余量。按 Dolt 的现状，
  服务器要至少 32 GB 内存；而且随着库变大，需要的内存也会往上涨。
- **换存储：** 只算磁盘，换 Parquet 省 2.6–2.8 倍，不够抵 211 个钉住的试验和重写导入导出的代价。内存是另一笔账：
  如果报价和成交两张大表不放在 Dolt 里，Dolt 只剩 K 线、资金费、metrics 和合约条款（几 GB），常驻内存会小得多。
  不过"大表移出 Dolt"要改存储设计，在服务器选型时再决定，本文不做。
