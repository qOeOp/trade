# 2026-11-07 增长与性能：剩余代价

| Item | Value |
|---|---|
| Sessions | 无被审研究会话；续 [增长与性能](2026-11-07-trial-growth-scaling.zh.md) 与 [服务器重测](2026-11-07-trial-growth-server.zh.md) |
| Audit session | Claude Code（桌面应用），claude-opus-5-5；与上两份记录同一会话 |
| Checkout / ledger | origin/main 77f35b750；本地 compose 账本，全部对照固定在 `--at` `dm80lcig3emlk5b68gdbnp62kk8c91rh`（17 条线，519 个重叠研究运行） |
| Coverage | 前两份记录留下的四处按 trial 或运行数增长的代价：`require_line_records`、`research state` 的落后镜像检查与市场窗口重读、平均相关的 R²·D。每处都在同一固定提交上用 origin/main 与修改后的代码对照输出，只读 |
| Cost | 约 2 h；tokens 未测 |
| Net change | 4 个代码 PR，无 skill 变化；新增 `seams.reusing`、`seams.reading_once`（由 graph 的 `_reusing` 移出共用） |

## Findings

| id | 发现 | 动作 | 代价 | 状态 |
|---|---|---|---|---|
| 20261107-159 | **`require_line_records` 按线 trial 每个约 3 次查询**（#2444 只修了审查读取）。写事务内与 `research state` 各跑一次 | fix：按 `execution.BATCH` 批读运行状态、注册尝试、解释覆盖，恢复包名一次读出按 id 精确匹配。17 条线新旧结果全同，合计 4.46 → 2.03 s，71 trial 的线 0.47 → 0.10 s；补了无运行但有恢复包的测试（以前没有） | minutes | fixed 093a59ee2 [#2449](https://github.com/qOeOp/trade/pull/2449) |
| 20261107-162 | **`research state --current-image` 的 `_behind` 逐 trial 查状态并跑 `reproductions`**，后者对来源的每个后续 explore（任何镜像）读捕获做匹配：一条线 3.75 s，随线长与 explore 数增长 | fix：一批读出不在当前镜像上的通过运行，一次查出当前镜像上的后续 explore，只匹配它们。全部线 × 账本里每个镜像（加一个不存在的）306 例新旧全同；每镜像扫全部线 6.5–10.4 s → 0.03–1.2 s | minutes | fixed 91ca330e4 [#2451](https://github.com/qOeOp/trade/pull/2451) |
| 20261107-163 | **`research state` 对同一市场窗口重读 2–5 次**（`_undistinguished_runs` 每次比较各读一次，每次约 3 s）。graph 早有按窗口记忆，state 没有 | fix：graph 的记忆移到 `seams.reusing`，`research_state` 用 `@seams.reading_once`。3 条线（含一次 `--full`）输出新旧全同，读次数 3/5/2 → 1，单次 15.1 → 5.0 s、11.6 → 5.6 s | minutes | fixed 50cb695c2 [#2452](https://github.com/qOeOp/trade/pull/2452) |
| 20261107-154 | **平均相关仍是 R²·D 逐元素**（#2436 只降了常数）：519 个运行 1.1 s，2,600 个 29 s | fix：按 256 个序列一块的矩阵乘求共同日和；某侧中心化抵消掉 99.99% 以上平方和的对按旧法逐对重算。真实 519 运行均值逐位相同，400 组含常数与近常数的随机序列最大差 2.4e-14、取舍零差异，块大小 1/7/256 跨块边界逐位相同；2,600 个 1.0 s、峰值内存 +94 MiB（旧 29 s、+192 MiB） | minutes | fixed bcf70b338 [#2453](https://github.com/qOeOp/trade/pull/2453) |

## 未做

- 服务器未重测；这四处发布后，下一次增长诊断在服务器上复测 `research state` 与 `research status`。
- `research state` 剩余约 4–5 s 主要是一次市场窗口读取与 `line_trials`，按本线长度线性增长，不再随别线或 explore 增长。
