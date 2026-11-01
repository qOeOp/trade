# 持仓量与多空比每日自动导入：方案（2026-11-01）

本文只有方案，没有代码。§5 的几点要用户先定，定了按 §6 实现。

初稿经过一个独立子代理对照代码审查，它找到的错误和遗漏都已改进正文，主要有：
- 发布要求档案的 `role` 是 `active`；
- 服务或网络中断不能把合约停下；
- 发布失败要在后面几轮补上；
- 下载不能占着导入锁；
- 月末那天如果一直没有归档，要有处理办法；
- 被停下的合约要让人看得到。

## 1. 为什么

`market import-metrics` 每次都要有人手动跑。Binance 的日归档第二天才出，时间也不固定：2026-11-01 UTC 凌晨，
10-31 的归档还是 404。现在只能让一个会话守着，等它出来再导入。会话一结束就没人导了，覆盖停在最后一次手动导入
那天，直到下一个会话发现缺口。

一个不靠会话、按天自己补的任务能解决这个问题。它只做 `market import-metrics` 已经会做的事，不新增导入规则。

## 2. 为什么不用 GitHub Actions

- **数据库在本机。** 活动市场库是本机 compose `trade-ide` 里 ledger 服务的 Dolt 库，约 149 GB。DoltHub 上的
  是它的公开副本，只用来引导和发布，不是写入的地方。
  - 托管 runner 放不下这个库。
  - 改成直接往 DoltHub 推，写入就绕开了本机的导入账号、导入锁和提交检查（`market/store.py` 的
    `require_commit_checks`），本机库和公开副本也会分叉。
- **凭据要进 CI。** 要么把 DoltHub 的写入密钥放进 GitHub secrets，要么在本机装一个自托管 runner。前者把发布
  凭据交给第三方；后者是改主机配置，而且只是把本机命令再包一层。
- **网络。** 托管 runner 访问 `api` 和 `fapi.binance.com` 会拿到 451（2026-09-20 实测）。归档站
  `data.binance.vision` 在 runner 上没测过。

所以任务放在本机：和 ledger、market-supply、paper 一起进 `deploy/compose.yaml`。本机和以后的服务器用同一份
文件，这是 `paper-compose-deployment.zh.md` 定下的部署方式。也不用 launchd 或 cron，理由和那份文档否掉
launchd 的一样：只管得了一台机器，换到服务器要重写。

## 3. 现有导入在无人值守时的行为

依据：`market/metrics.py` 的 `import_month`、`_import`，`market/store.py`，`market/sources.py`，
`ledger/publish.py`，`cli/main.py` 的 `_publish_after`。

| 情况 | 现在的结果 | 无人值守时怎么处理 |
|---|---|---|
| 这个合约这个月的已收盘日都已导入 | 拒绝 `MONTH_EXISTS` | 没有新数据 |
| 要导的日子归档都还没发布 | 拒绝 `ARCHIVE_NOT_PUBLISHED` | 下一轮再试 |
| 最后几天没发布，前面的已发布 | 导入已发布的，后面几天留给下次 | 正常 |
| 已发布日之前有一天始终没有归档 | 记进回执的 `unpublished`，以后不再补 | 正常，覆盖里看得到 |
| 月初第一天，当月还没有收盘日 | 拒绝 `MONTH_INVALID` | 只导上个月剩下的 |
| 别的导入或 `market backup` 拿着锁 | 拒绝 `CONCURRENT_IMPORT` | 下一轮再试 |
| Dolt 服务连不上（ledger 重启、重新引导） | 拒绝 `MARKET_UNREACHABLE` | 下一轮再试 |
| 库还是空的（重新引导中） | 拒绝 `MARKET_EMPTY` | 下一轮再试 |
| 下载 8 次重试后仍失败 | 拒绝 `SOURCE_UNREACHABLE` | 下一轮再试 |
| 归档内容不对：`SOURCE_SHAPE`、`SCALE_LOSS`、`CHECKSUM_MISMATCH` | 这个合约这次什么也不写 | 停下这个合约 |
| 整个库的问题：`DIRTY_WORKING_SET`、`SCHEMA_MISMATCH`、`SCHEMA_VERSION_MISMATCH`（新镜像比库新，要先 `market upgrade`）、`COMMIT_CHECKS_DISABLED`、`DATA_TESTS_FAILED` | 什么也不写 | 停下所有合约 |
| 发布时锁被占，或推送未确认（`PUBLISH_FAILED`） | 写入保留 | 下一轮再试 |
| 发布被拒：`PUBLISH_REJECTED`（远端分叉）、`PUBLISH_FORBIDDEN`、`REMOTE_UNSET`、`REMOTE_INVALID` | 写入保留 | 停下所有合约 |

另外三点：

- **一次调用的连带。** 一次调用里几个合约依次导入，前一个合约的任何拒绝都会让后面的不再导入（包括常见的
  `ARCHIVE_NOT_PUBLISHED`）。所以任务要按合约分别调用。
- **跨月。** 上个月最后一天的归档要到下个月才出，所以每轮要看上个月和这个月两个月。
- **月末那天一直没有归档。** 它不会被记成 `unpublished`：只有同一个月里更晚的一天已发布，前面缺的日子才会
  记进去。所以不能用"导到最后一个收盘日"作为唯一的完成条件（见 §4.1）。

## 4. 做法

### 4.1 一个命令

新增 `market follow-metrics`，一直运行，名字最后在 PR 里定。

**每一轮做五件事：**
1. 用一次 `datetime.now(UTC)` 定出最后一个收盘的 UTC 日。
2. 先在锁外把要导的日归档下载进缓存（`sources.fetch_archive`），这样下载和 403/429 退避不会占着导入锁；
   `import_month` 随后从缓存读。
3. 对配置的每个合约分别调用现有的 `metrics.import_month`，从它已有的最后一天到那个收盘日，按月进行。
   - 库里一行都没有的合约不导入，标为停下。第一次的历史回补是一次单独的公开写入，由用户决定，手动做。
4. 只要 `publication.unpublished` 为真就发布一次（`publication.publish`，带导入锁），不管这一轮有没有写入。
   这样前面失败的发布会在后面几轮补上。
5. 按 §3 的表处理结果。

**合约的三种状态，以及多久跑一轮：**
- **已追上：** 有最后一个收盘日的数据。
- **在等：** 还没有。连续 3 天每小时都没等到，就降为每天一次，并在状态里标"落后"。月末缺一天或归档长期
  不出都属于这种情况，不会被当成故障停下，也不会一直按小时去问。
- **停下：** 内容拒绝、整个库的问题、发布被拒，以及库里没有数据的合约。只在容器重启时再试，因为改的是
  数据问题还是代码问题，要人看过才知道。

所有合约都已追上，就等到下个 UTC 日 00:30；否则一小时后再跑。等待用 5 分钟一段的短睡，每段醒来都看墙钟，
这样宿主机休眠把 Docker 虚拟机暂停之后，时间也不会算错。启动时立刻跑一轮，所以重启后会自己补上。命令
自己从不因为拒绝退出：拒绝都按上表处理，只有进程被杀才会结束。

**输出：**
- 每轮在标准输出打一行 JSON：每个合约导到哪天、状态（追上 / 在等 / 落后 / 停下及原因）、这一轮写的行数、
  提交号和发布结果。
- 同样的内容写进状态文件 `/tmp/metrics-import/status.json`，供健康检查读（§4.2）。

**为什么是产品代码。** 按 AGENTS.md，产品代码要有理由：信任边界、修已有缺陷，或 Agent 做不了的事（原子写、
并发、权限）。这里有三条：
- 没有会话时没人能跑命令；
- 要和其他会话的导入、`market backup` 以及发布抢同一把导入锁；
- 下载放在锁外，发布在后面几轮补上。

AGENTS.md 说不要另建调度器，指的是和 Nautilus 并行的引擎、研究流程那一类。这个命令不排回放，也不排研究，
只做数据维护。它不加拒绝，不改导入规则，不加存储字段，只复用 `import_month`、`sources.fetch_archive`、
`publication.publish` 和它们的锁。

**成本。** 每次调用都会扫一遍 `DOLT_LOG`（`store.metrics_imports`）。每天几次、每次 3 个合约，可以接受。

### 4.2 compose 服务

`deploy/compose.yaml` 加一个服务 `metrics-import`：

- **镜像与重启：** `trade-service:main`，`restart: unless-stopped`。
- **命令：** `python -m cli.main market follow-metrics --market /run/trade/market-import.json --symbols BTCUSDT ETHUSDT SOLUSDT`。
- **市场档案：** 一个 `configs` 条目，`{"name": "market", "kind": "market", "role": "active", "database": "market", "service": "${TRADE_DATA}/dolt"}`。
  - 发布要求 `role` 是 `active`（`ledger/publish.py` 的 `_allowed`；`ledger/db.py` 的 `from_json` 把 `role` 当作
    生命周期）。没有它，发布会被拒为 `PUBLISH_FORBIDDEN`。
  - 这是第二份指向活动市场库的 active 档案，要用户定（§5）。
- **账号：**
  - 和 market-supply、paper 一样，把 `${TRADE_DATA}/dolt` 只读挂进来，从 `service.json` 读导入账号和
    管理账号（发布用 `_admin`）。
  - `${TRADE_DATA}/dolt/home` 用 tmpfs 盖住，否则容器能读到 DoltHub 密钥。
  - 推送由 Dolt 服务自己做，密钥仍只在 ledger 容器里。
- **环境：** `TRADE_DOLT_HOST: ledger`。
- **缓存与状态：** 一个 volume 挂在 `/tmp`，和 market-supply 一样。
  - 默认下载缓存是 `/tmp/trade-market-cache`，状态文件也放在 `/tmp` 下。
  - 新建的命名 volume 挂到别处会归 root 所有，而容器以 `TRADE_UID` 运行，会因为没有写权限反复崩溃。
  - 每天几十 KB，不清理。
- **加固：** `cap_drop: [ALL]`，`security_opt: ["no-new-privileges:true"]`。
- **日志：** `logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}`，因为服务器上默认不轮转。
- **健康检查：** 读状态文件，有合约停下或落后时返回不健康。`docker compose ps` 就能看到，研究会话
  readiness 时也能看到（§4.3）。
- **网络：** 默认网络，能出网访问 `data.binance.vision`。
- **依赖：** `depends_on: ledger (service_healthy)`。这只在 `up` 时起作用；之后 ledger 重启或重新引导，靠 §3 表里的
  "下一轮再试"。

### 4.3 skill

`research-start` 的 `readiness.md` 和 `SKILL.md` 现在说，导入每个月都是用户决定的公开写入。改成：

- **在 `metrics-import` 服务 `--symbols` 里的合约：** metrics 由任务每天自动导入。Agent 读覆盖和
  `docker compose ps` 里这个服务的健康状态，报告缺口、落后或停下的原因，不再为这些合约提议
  `market import-metrics`。
- **其他合约：** 照旧。要导入，就作为公开写入交给用户决定。

docs/rd 的 research-start 设计页同步改。这是 skill 规则改动，要在 `.agents/evals/research-start/` 加一个
用例：
- 缺口在任务覆盖的合约上时，只报告，不提议导入；
- 缺口在任务以外的合约上时，照旧提议导入，并交给用户决定。

## 5. 要用户定的

1. **长期授权。** 任务每天对配置里的合约做一次公开的市场库写入，并发布到 DoltHub，不再逐次问你。这改的是
   readiness 里"每次导入由用户决定"这条规矩。
2. **第二份 active 档案。** 任务容器里有一份 `role: active` 的市场档案，指向现在的活动市场库 `market`。它不新建
   库，也不换掉主机上用的那份活动档案，但 AGENTS.md 把活动档案的增改列为要授权的事。
3. **范围。** 先只做 metrics，合约是 BTCUSDT、ETHUSDT、SOLUSDT。以后加合约就改 `--symbols`：
   - 每次一个 PR，要你同意；
   - 新合约的历史回补先手动做一次。
4. **其他数据不在这次范围内，各自另定。**
   - K 线和推算报价按月发布，可以照同样的办法做一个每月任务。
   - 完整成交（aggTrades）一个合约一个月就要导很久，会长时间占着导入锁，不建议自动做。
5. **怎么让你知道出了问题。** 方案里有：
   - 容器的健康状态，`docker compose ps` 能看到；
   - 状态文件和容器日志；
   - 覆盖里的缺口，research-start 每次开始都会读。

   要不要更主动，比如在 IDE 上显示最后导入日或停下的合约，另定；这次不做。

## 6. 分 PR

两个 PR 都基于 main，标题过 `validate-pr-title.sh`。第 2 个要用第 1 个构建出的镜像，所以等第 1 个合并、镜像
构建好再开。

1. **产品代码：** `market follow-metrics` 和测试。测试用隔离 Dolt，下载用本地文件代替。要覆盖：
   - 每个合约单独调用；
   - 跨月，以及月初第一天；
   - `ARCHIVE_NOT_PUBLISHED` 之后下一轮补上；
   - `CONCURRENT_IMPORT` 和 `MARKET_UNREACHABLE` 之后重试；
   - 内容拒绝和整个库的问题之后停下；
   - 发布失败之后，没有新写入的一轮也会补发；
   - 月末缺一天时降为每天一次并标落后；
   - 库里没有数据的合约不导入；
   - 下载不占导入锁；
   - 状态文件和健康检查。
2. **部署：** compose 服务、`deploy/README.md`、skill、设计页和 eval 用例（§4.3）。合并后：
   - 在主检出跑 `docker compose -f deploy/compose.yaml up -d --no-deps --wait metrics-import`，只新增这一个
     容器，不动 ledger、ide、paper；
   - 看第一轮输出，核对覆盖。

## 7. 不做的

- 不加新的导入规则、拒绝或存储字段。
- 不在 GitHub Actions 或宿主机的定时任务里跑。
- 不自动重试内容拒绝，也不自动处理整个库的问题。
- 不做新合约的历史回补。
- 不碰 paper 的实时数据。paper 现在不送 metrics，订阅时就拒绝（`METRICS_NOT_SERVED`）。
