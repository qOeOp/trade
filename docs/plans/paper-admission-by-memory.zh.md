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
5. **拒绝和展示**：`PAPER_CONCURRENCY_LIMIT` 换成 `PAPER_MEMORY_FULL`，消息写明数字，例如"需要 1.2 GiB，预算 3 GiB 里已预留 2.4 GiB"或"主机只剩 0.8 GiB"。列表接口里的 `running`/`limit` 换成 `memory: {budget, reserved, host_available}`。页面显示"已预留 2.4 / 3 GiB"，并按新 run 的预留量提前判断能不能启动。#2463 加的拒绝提示框保持不变。

以 3 GiB 预算、假设单合约预留 0.5 GiB、22 个合约预留约 1.2 GiB 来算，可以同时跑 6 个单合约 run，或 2 个全币池 run 加 1 个单合约 run，具体按测量结果定。比起固定 4 个，单合约 run 能多跑，全币池 run 则受到限制。

不做的：按实际用量动态放行（run 会随时间增长，按当下用量放行会超卖）；排队或调度（AGENTS.md 不建调度器）；运行中自动迁移或停掉 run。

## 3. 需要用户定的

| # | 决定 | 建议 |
|---|---|---|
| D1 | 用按内存准入替换个数上限。这是改拒绝检查，需要授权 | 替换 |
| D2 | 预算从哪来：部署配置的固定预算 + 启动瞬间的主机余量（§2.2–2.3）；或者只看主机余量 | 两条都要：只看余量会超卖 |
| D3 | 预算的初值：3 GiB 是按"主机 7.24 GiB − 常驻服务与系统实测约 2.1 GiB − 1 GiB 余量 − 发布交接时多一个 web"留出的 | 先 3 GiB，测量后再定 |

**用户决定（2026-11-08，「按建议来」）**：D1 替换个数上限（授权改这条拒绝检查）、D2 两条准入条件都要、D3 预算初值 3 GiB；先测量，后实现。

## 4. 先测量，后实现

实现之前，先在本机做一次隔离测量。使用 Binance 公开数据和 Nautilus Sandbox，执行记录写进一个隔离的 paper 库，不进账本。同一份 BTC 策略同时跑单合约和全币池两个 run，各 6 小时，每分钟用 `docker stats` 采样一次，记录内存曲线和峰值。预留量取 峰值 × 2 后向上取整到 128 MiB，测量结果记在本文件。长期增长再用生产上现有 run 的 `docker stats` 补充观察。

## 5. 改动范围（实现时）

`paper/runs.py`：准入和预留公式；`paper/serve.py`：列表接口返回 `memory` 字段；`runtime/container.py`：runner 加 `--cpus`；`deploy/`：`TRADE_PAPER_MEMORY`；`ide/web`：显示预留、按预留提前判断。不新增存储字段，因为预留量就记在现有的 `config.memory` 里。
