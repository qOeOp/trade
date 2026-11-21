# Live 请求日志删除（E8，2026-11-21）

[0.5.0 计划](breaking-release-0.5-20261121.zh.md)的 E8：删掉 Live 请求日志（`live/requests.py`、`requests/<id>.jsonl`）里“已认领但结果未知”这一层，改为按 `request_id` 对照各操作自己的效果行做幂等。

## 授权

- 2026-11-21，用户：「需要我定的部份最后也是一样由你决定按推荐做」。下面三项（新增存储字段、收紧启动检查、删拒绝码）都按此由 Claude 决定，并以只读设计评审（基于 `8a653e334`）的结论“做”为准。

## 依据

真钱下单的“至多一次”不靠请求日志，靠的是这几条：

- `runs.launch_locked` 在 `docker run` 前写入并 fsync 带 `request_id` 的 `launch_requested`，容器名是确定的；
- 运行器对 `out/runner.lock` 持排他 flock；
- 容器不可见时，账户槽位不释放；
- 控制端自己从不在 Binance 下单。

请求日志在这些之上多出一层：网页没收到回复时，记一条“结果未知”的认领，要用户再去“解析”。删掉它以后，网页没收到回复，就显示 Live 现在读到的运行或密钥状态，再给一个“再发一次”。再发一次用同一个 ID，服务端对照效果行，至多执行一次。

## 决定

1. **存储字段 `research_at` 移入运行清单**（`runs/<run_id>/inputs/manifest.json`）。
   - 消费者：开始前的审阅（`runs.review`）和预检（preflight）。两者都在这个提交上读候选、登记和验证。
   - 独立事实：准备时研究账本的头提交。它不能从已存字段推出：试验号、源码哈希、版本号只能给出下界；之后加入的登记、历史检验结论都会改变准入当时读到的东西。
   - 现在：它只存在准备请求的认领里，请求日志删了就没有了。
   - 独立子代理评审结论：接受，附三条修改，均已照做：
     - `MANIFEST_FORMAT` 升为 `live-run-5`，旧格式运行经 `runs.earlier()` 整体跳过；
     - 宿主读清单时用 `db.COMMIT_HASH` 校验；
     - 预检只从清单读它。
2. **收紧 `launch_locked`**。最近一次启动的容器找不到，且这次启动之后没有回收记录时，该运行的任何新启动都拒绝（`LIVE_DOCKER_UNAVAILABLE`），预检也一样。
   - 以前：同一 ID 由请求日志挡住；新 ID 会被当作没启动过，自动重启也会照样重启。
   - 现在：容器不可见就不再启动。停止照常可用，槽位照旧不释放。
3. **删拒绝码**。
   - 删：`LIVE_REQUEST_COMMAND`、`_UNAVAILABLE`、`_MISSING`、`_UNRESOLVED`、`_CLOSED_UNCLAIMED`，以及只作日志处置码的 `LIVE_REQUEST_NOT_DISPATCHED`、`LIVE_REQUEST_OBSERVED`，还有 `LIVE_CREDENTIAL_INCOMPLETE`。
   - 留：`LIVE_REQUEST_ID`。
   - 留 `LIVE_REQUEST_CONFLICT`，但改为对照效果行：
     - 准备行和启动行上的 `request_id` 属于别的操作或别的运行时，拒绝；
     - 同一 ID 准备同一运行，但候选、合约、设置或密钥不同时，也拒绝。

## 实施要点

- **准备**：所有输入和 `prepared` 行先写进 `staging/<run_id>`，再整体改名进 `runs/`，并 fsync 两个父目录。
  - 同一 ID 再发、而运行已发布：原样返回，不再读研究头。
  - 未发布：删掉残留的暂存，从头再做。暂存里没有秘密，也没有启动过任何东西。
  - 不再写 `universes/<sha256>.json`。
- **启动**：同一 ID 已有 `launch_requested` 时直接返回，不读密钥，不再 `docker run`。新 ID 只能接管同模式、正在运行的那次启动。
- **密钥保存可续做**：
  - 已选中：原样返回。
  - 已保存但未选中：只追加选中。
  - 什么都没记录：清掉残留文件，重写。
  - 残留文件永远不会被选中；没有秘密进入任何日志。
- **升级**：旧的 `requests/` 目录不再读取，留在盘上。升级时 Live 须空闲（CHANGELOG Breaking）。
