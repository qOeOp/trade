# 远端市场供数与本地缓存：第一步

用户授权：只实现 Trade 自己的供数边界，以已有 BTCUSDT 2025-10 做正式入口验收；保持回放与审计语义，不接入 TradeTick，不新增市场导入。

## 实现边界

- `registration.seams` 根据显式市场 profile 选择本地或远端 `MarketAdapter`。不切换 active profile。
- `market.remote.RemoteMarket` 负责结构化读请求、按内容寻址的客户端缓存、断点续传和完整目录交付。
- `market.remote.Supply` 将白名单读请求交给原有本地 Market adapter；HTTP handler 只负责协议和文件传输。
- `registration.inputs` 仍组装成员、窗口、输入身份并计算原有 fingerprint；仅增加临时目录的清理所有权，不修改身份或审计字段。
- 服务端使用已有 Dolt reader 读取固定版本，可部署在完整 DoltHub 只读副本旁。客户端不克隆全库，也不向 DoltHub 公共 SQL API 逐页抓取大表。

这是文件供给方式变化。Nautilus、撮合、资金费、保证金、策略回调、因果时钟、风险、审计和运行镜像均不变；`agg_trade` 尚不进入正式回放。

## 身份与 fresh

引用只解析一次；后续均使用完整 commit。请求同时固定数据库、标的、纳秒窗口、quotes 模式、生命周期证据及其 episodes、原有 exporter 和 uv.lock 指纹。缓存 key 另含服务地址及协议版本。

传输清单和下载状态仅为可删除的临时工作副本，不新增 ledger schema 或持久研究字段。原生目录中只放既有 exporter 的文件；`export.json` 的语义处理仍只忽略原有 seconds 字段。每次 materialization 都复制为独立目录，不以硬链接共享可变文件。

正式 fresh 请求必经服务端的新导出。缓存只节省本次清单里 SHA-256 相同文件的传输，不能替代 fresh。非 fresh 缓存复用也逐文件核对；无 latest 回退或缺口补齐。原有拒绝保留，另增加供数协议/传输错误码，不调整任何既有拒绝或审计检查。

## 验收

1. 真实隔离 Dolt fixture 同时放入其他标的、前月数据及窗口 end 边界数据，确认 minute/quote 的半开区间和标的选择；日线 warm-up 保持现有规则。
2. 推进 fixture main 后，原 commit 导出的完整语义 fingerprint 仍相同；不存在的版本明确拒绝。
3. 断连只留下未完成前缀，显式后续调用可续传；损坏、越界、重复路径、身份不匹配均不得交给原生回放。
4. 并发客户端得到独立目录；共享缓存不能因单个回放修改而污染其他回放。
5. 已有月份通过正式 CLI 入口，在隔离工程账本内对比本地与远端；同一策略源、镜像 digest、账户、标的与窗口，检查输入身份、订单/成交/持仓/账户/收益/资金费、独立审计及语义指纹。
6. 再经正式 reproduce 入口确认 fresh 新导出后，旧封存的原生语义指纹仍匹配；量化客户端工作集和缓存增量。

## 部署与测量边界

第一步是适配器及可运行的只读供数进程，不修改现有 Compose 或主检出配置。跨主机部署需正常的 HTTPS/访问控制边界。工程验收的 HTTP 服务和客户端位于同一主机，因此吞吐数字不代表公网或远程磁盘性能。

不做自动缓存淘汰，既有市场库和备份全部保留。客户端须为缓存对象和当前窗口的独立副本各预算空间；服务端新导出也占临时空间。按需供数不等于零磁盘、零准备时间或省去 fresh 校验。

## 2026-10-30 工程验收结果

冻结市场 commit `jprlsnl6gug3bmlqrfh121t8jmfj29tg`；仅 BTCUSDT 的 `[2025-10-01, 2025-11-01)`。镜像为既有 CI digest `ghcr.io/qoeop/trade-runtime@sha256:b0b2337df0c5836e058e4c3c9429966abe3328511843070948d29da16171f4e4`，Nautilus `2.0.0rc7`。工程策略只在 `/tmp`，研究账本为独立 `supply_e2e`；所有账本写入均经正式 CLI。

本地和远端分别走正式 `replay explore`（bars）及 `replay precheck`（quotes）。报价模式显式传相同 initial margin 0.05、maintenance margin 0.025；其余账户参数保持原合约。两种模式均满足：

- 输入身份及有效配置相同，全部七组原生语义指纹完全相同。
- 4 条订单、2 条成交、1 条持仓记录、99 条账户记录、31 天收益及 92 次持仓资金费调整一致；审计均通过，native/audit/fingerprint 三阶段全部 exit 0。
- 手续费 `1.11788050 USDT`、持仓资金费 `-3.60548268 USDT`、最终余额 `99950.25763682 USDT` 一致。这是带原生 bracket 保护的工程夹具，不是策略收益证据。
- 报价模式消费 44,640 LAST、44,640 MARK、42,150,652 QuoteTick 和 93 条资金费输入；无 TradeTick。

再通过未修改的正式 `replay reproduce --trial-id 3`，从本地报价 precheck 跨适配器复现，新增隔离工程 trial 5，返回 `fingerprints_match=true`；本轮供数进程直接通过 `python -m market.remote` 启动。

| 路径 | 端到端秒数 | 客户端 RSS 峰值 | 原生进程最大观测 VmHWM | 下载 payload |
|---|---:|---:|---:|---:|
| 本地 fresh quotes | 249.81 | 426.20 MiB | 2.677 GiB | 本地读取 |
| 远端 fresh quotes，空缓存 | 236.84 | 125.55 MiB | 3.250 GiB | 220,918,690 bytes |
| 远端 fresh reproduce，复用缓存 | 238.98 | 83.125 MiB | 3.328 GiB | 4,533 bytes |

RSS 来自 `/usr/bin/time -l`，不含远端供数及原生容器。VmHWM 为每 0.5 秒间隔（加 Docker 调用耗时）读取容器原生 Python PID 的内核高水位所得最大值，未保证捕获退出前的最终高水位；不可把客户端 83–126 MiB 当成总内存。供数导出仍约 129 秒，缓存省下 Parquet 重传，但没有观察到整月端到端加速。

导出共 175 文件，缓存结束时逻辑 221,005,975 bytes、实际分配 221,364,224 bytes（约 211.11 MiB）；运行时另有约 221 MB 的独立输入副本，以及供数侧导出工作目录。所有 quote Parquet 均被复用；4,533 bytes 是新导出收据。未淘汰任何旧数据、备份或 Catalog。

10 项供数专项测试通过；完整测试命令 `RESEARCH_DOLT_BINARY=<existing Dolt 2.4.2> uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：690 项通过。市场源 HEAD 在验收后仍为上述 commit，`dolt_status` 为空。

完整临时证据：`/tmp/trade-market-remote-e2e-20261030/report.json`、`report.zh.md`、两组 `*-parity.json`、各回放目录中的 coverage/process/audit/fingerprint、`native-memory.jsonl` 和传输计数。未计入成功测量的两次调用也保留：一次漏传报价保证金参数被原检查拒绝，一次临时测量启动器漏加 multiprocessing main guard 导致传输失败；均未开始原生 trial。产品入口和检查未为这些失败放宽。
