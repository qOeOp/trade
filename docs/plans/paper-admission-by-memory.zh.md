# Paper 运行按内存准入（设计）

2026-11-08。起因：生产上两次 Paper run 撞上固定的 `MAX_RUNNING = 4` 被拒（#2463 已让拒绝看得见）。用户指出，固定个数一方面在资源闲着的时候也拒绝启动，另一方面在资源不够时又挡不住：4 个都是全币池的 run 也能放进来。

## 1. 现状（只读核对，2026-11-08 02:10 UTC）

| 项 | 值 | 出处 |
|---|---|---|
| 主机内存 | 7.24 GiB（MemTotal），可用 4.0 GiB，另有 8 GiB 交换区 | `/proc/meminfo` |
| 并发上限 | 4 个，第一版定的数，从没测过 | `paper/runs.py:35`，[paper-trading-design §资源](paper-trading-design.zh.md) |
| 每个 runner 的内存上限 | 4 GiB，注释写着 "an uncalibrated example value"；egress 256 MiB；runner 没有 CPU 上限 | `paper/runs.py:36-37`，`runtime/container.py:118` |
| 4 个 run 的上限合计 | 4 ×（4 + 0.25）= 17 GiB，是主机内存的 2.3 倍 | 同上 |
| 常驻服务的上限合计 | 约 6.9 GiB：ledger 2、web 1.5（发布交接时有两个）、paper 守护进程 1、agent 1、live 0.75，其余约 0.6 | `docker inspect` |
| 实际用量 | 4 个单合约 runner 各 165–190 MiB、CPU 约 3%，已运行 15–36 小时，未见增长；egress 各约 20 MiB | `docker stats` |
| 全币池 | 不是全市场，是部署配置手选的名单（11-05 时 22 个）。回放峰值 0.415 GiB，单合约 0.207 GiB | [btc-only 验证](doctor/2026-11-05-btc-only-validation.zh.md) |
| 实时全币池 run 的内存 | **没测过** | — |
| 超过上限时 | Docker 杀掉容器，`OOMKilled` 写进封存记录 | `paper/runs.py:252` |

结论：现在的个数上限和每个 run 的内存上限都和主机对不上。常驻服务的上限已经接近主机内存，所以按这些上限去算，留给 paper 的余量几乎为零。真正保护着主机的只是实际用量碰巧很低。如果 4 个 run 同时涨到各自的上限，主机会进入交换区抖动，ledger 和 web 会跟着变慢。10-19 那次全池回放涨到 48 GB、耗尽交换区，就是这种情况。

## 2. 设计：按预留内存准入，不按个数

每个 run 启动时预留一块内存，这块预留同时就是它在 Docker 里的硬上限（`--memory`）。是否放行，看的是预留量，不是个数：

1. **每个 run 的预留量 = 基数 + 每个合约的增量 × 合约数**。由测量确定（§4），不靠猜。现有的 `config.memory` 字段已经记录了每个 run 的上限，直接沿用，不新增存储字段。run 一旦超过预留就被 Docker 杀掉，并封存为 invalid（原因 `oom_killed`），页面写明"超过了内存预留"。坏的只是这一个 run，主机不受影响。
2. **paper 总预算**：部署配置 `TRADE_PAPER_MEMORY`（例如 3 GiB），在 compose 环境里设，随主机大小调整。放行条件：已在运行的 run 的预留之和 + 新 run 的预留 ≤ 预算。这条保证的是最坏情况：所有 run 都涨满，总量也不超过预算。
3. **启动瞬间的主机余量**：再读一次主机的 MemAvailable，要求扣掉新 run 的预留后仍至少剩 1 GiB 余量。这条随主机当下的状况变化：发布交接时两个 web 并存、Live 在跑、研究回放在跑，都会在这里体现。它只决定新 run 能不能启动，不会停掉已经在跑的 run。
4. **CPU**：每个 runner 加 `--cpus 0.5`，CPU 不纳入准入。CPU 争用只会让东西变慢，不会把主机搞崩。
5. **拒绝和展示**：`PAPER_CONCURRENCY_LIMIT` 换成 `PAPER_MEMORY_FULL`，消息写明数字，例如"需要 1.2 GiB，预算 3 GiB 里已预留 2.4 GiB"或"主机只剩 0.8 GiB"。列表接口里的 `limit` 换成 `memory: {budget, reserved, host_available, free, smallest}`。连最小的 run 都放不下时，页面把启动按钮变灰，菜单写 `memory full`，点击后说明是预算满了还是主机余量不够；其余情况仍以服务器的判断为准。#2463 加的拒绝提示框保持不变。

按 §4 测出的公式，每个 run 的预留是单合约 320 + 64 = 384 MiB，21 个合约 640 + 64 = 704 MiB。3.5 GiB 预算可以同时跑 9 个单合约 run，或 5 个全币池 run，或 3 个全币池 run 加 3 个单合约 run。比起固定 4 个，单合约 run 能多跑一倍多；几个全币池 run 也不会再超出预算。

不做的：按实际用量动态放行（run 会随时间增长，按当下用量放行会超卖）；排队或调度（AGENTS.md 不建调度器）；运行中自动迁移或停掉 run。

## 3. 需要用户定的

| # | 决定 | 建议 |
|---|---|---|
| D1 | 用按内存准入替换个数上限。这是改拒绝检查，需要授权 | 替换 |
| D2 | 预算从哪来：部署配置的固定预算 + 启动瞬间的主机余量（§2.2–2.3）；或者只看主机余量 | 两条都要：只看余量会超卖 |
| D3 | 预算的初值：3 GiB 是按"主机 7.24 GiB − 常驻服务与系统实测约 2.1 GiB − 1 GiB 余量 − 发布交接时多一个 web"留出的 | 先 3 GiB，测量后再定 |

**用户决定（2026-11-08，「按建议来」）**：D1 替换个数上限（授权改这条拒绝检查）、D2 两条准入条件都要、D3 预算初值 3 GiB；先测量，后实现。

**用户决定（2026-11-08，「改到约 9 个」）**：测量后用户问 8 GB 主机为什么只能跑 5 个。按 §4 的 22–43 小时实测，预留从峰值的 2.5 倍收到约 1.6 倍，预算从 3 GiB 提到 3.5 GiB（主机此时可用 4.9 GiB，扣 1 GiB 余量和发布交接时多出的 web 仍够），单合约 run 约 9 个。

## 4. 先测量，后实现

2026-11-08 02:40–08:41 UTC 在本机做了一次隔离测量：`ledger init --kind isolated` 建了一个隔离 paper 库，加上 `paper start --duration-seconds 21600`，使用 Binance 公开数据和 Nautilus Sandbox，镜像 `trade-runtime@sha256:755701cb…`，市场提交 20261106。两个 run 同时跑：`dow-structure-fastpivot-freshlow-4h@1` 只跑 BTCUSDT；同一条线上的兄弟版本 `dow-structure-fastpivot-4h@1`（同为 `DowStructure` 类）跑 `--universe pool`，当月是 21 个合约。每分钟用 `docker stats` 采样一次，共 350 次，中间没有断档（主机没有休眠）。两个 run 都按时跑满 6 小时：BTCUSDT 收到 360 根 bar，全币池收到 7560 根（21 × 360）。

| run | 合约 | 起始 | 1 h | 3 h | 5 h | 峰值 | CPU 均值 / 最大 |
|---|---|---|---|---|---|---|---|
| 单合约 | 1 | 142 MiB | 173 | 186 | 194 | **199 MiB** | 1.6% / 3.4% |
| 全币池 | 21 | 147 MiB | 265 | 276 | 279 | **324 MiB** | 2.0% / 7.4% |

egress 无论单合约还是全币池都约 20 MiB。生产上 4 个单合约 run 在 11-08 09:00 UTC 停止前跑了 22–43 小时，runner 各 116–188 MiB，跑得最久的（43 小时）最低，看不出随时间增长；egress 各约 20 MiB。

由此定的公式（`paper/runs.py`）：runner 预留 = 256 MiB + 16 MiB × 合约数，向上取整到 64 MiB，即 1 个合约 320 MiB、21 个合约 640 MiB，约为测得峰值的 1.6 倍（单合约 199 MiB，全币池 324 MiB）；egress 从 256m 降到 64m。如果某个 run 超出预留，它会被 Docker 杀掉并封存为 invalid（`oom_killed`），这时再按实际情况调公式。

局限：测量在 macOS 的 Docker VM（arm64）上做，服务器是 amd64；只测了 6 小时；两个 run 的交易都很少，大量下单时 Nautilus 缓存的增长没有测到。

## 5. 改动范围

`paper/runs.py`：准入和预留公式；`paper/recovery.py`：恢复运行时同样检查内存；`paper/serve.py`：列表接口返回 `memory`，health 返回 `memory_budget`，子进程继承 `TRADE_PAPER_MEMORY`；`runtime/container.py`：runner 加 `--cpus 0.5`；`ledger/refusals.py`、`cli/main.py`：用 `PAPER_MEMORY_FULL` 替换旧的拒绝码；`ide/web`：按内存提前判断能否启动，About 页显示预算。部署不改：`TRADE_PAPER_MEMORY` 不设时默认 3584m（3.5 GiB）。不新增存储字段，预留量记在现有的 `config.memory` 里。macOS 上的 shell 没有 `/proc/meminfo`，这时只按预算判断。
