# Live 准入要求 Paper 对账无误：能否在准入时推导，及存储字段评审（2026-11-21）

对应 doctor `20261120-06` 的后半（用户 2026-11-21「我都授权」：Live 只在候选未被关线证伪、且 Paper 运行一段时间并对账无误后才允许启动）。前半（候选未被关线证伪）已在同一 PR 里实现为 Live 拒绝；本文只讨论后半，结论是**不在本 PR 实现，交用户定**。独立评审由一个只读子代理完成（不读本会话的推理，只给问题与文件），下面按 AGENTS.md 的存储字段评审格式写出它核实的事实与本次的决定。

## 要的事实

“Paper 运行 P（已封存，判定 `complete`）是这一候选（同一 `source_sha256`）在同一组合约上的运行；在镜像 I、市场日 D 上重放 P 的窗口，`paper compare` 的对照没有无法解释的差异”。

“没有无法解释的差异”按 `replay/comparison.py` `compare` 的输出，应同时满足：

- `data_source` 为 `archive`，不用 `--preliminary` 的 REST 补齐；
- 重放成功且写出了订单事件（`replay_events` 为 None 时分组计数全为 None：订单未知，不是没有）；
- 没有 `cause == "unexplained"` 的分组（摘要里没有这个计数，要从 `groups` 数；已知原因与其后的 `consequence` 允许）；
- `look_ahead_suspects == 0`，`equity_unexplained_minutes == 0`。

哪次 Paper 运行算数：已封存且不是 `invalid`；`source_sha256` 等于 Live 在 `research_at` 读到的候选；合约集合与 Live 运行相同（与 `_evidence` 对回放的要求一致）；其镜像的回放代码（`REPLAY_CODE`）与 Live 的执行镜像相同；任一匹配的运行都算，不只最新一次。

## Live 现在能读到什么

- Live 控制的配置只有 `root`、`socket`、`research_ledger`、`runtime`、`market_root`（`live/configuration.py` `Configuration`；`deploy/live_configuration.py` `HOST_FIELDS`；`deploy/live_host.py` `facts`）。发布只为它写 `research.json` 与 `market.json` 两份 profile，**没有 `paper` 数据库的 profile**。
- 读者账户本身已在：Live 控制以只读方式挂载 ledger 的读者卷，`ledger/service.py` `write_readers` 为服务持有的每个数据库写读者账户，`paper` 读者有 `GRANT SELECT ON paper.*`（`ledger/db.py`）。缺的只是一份指向 `paper` 库的 profile，这是部署与配置改动（`release_host.prepare`、`HOST_FIELDS`、快照比较、`Configuration`）。
- 远端主机上 Live 控制与 Paper 控制在同一发布平面、同一 Dolt 服务；封存的 Paper 日志从数据库读（`ledger/paper.py`），不需要 `paper-tmp` 挂载。控制有 Docker 套接字、只读市场目录和以原路径挂载的可写根目录。

所以 brief 里的“从 Live 主机已能读到的数据推导”目前**不成立**：要先给 Live 控制加一份 Paper 读者 profile。

## 准入时推导要付的代价

- 对账是一次完整的原生重放：`paper.compare.compare` → `replay.comparison.replay_and_compare` → `entry.replay_unrecorded`（导出、原生与审计阶段容器，订阅 metrics 时再带 `--metrics` 重放一次），每个阶段容器上限 16g（`runtime/container.py`），窗口是 Paper 运行的整个寿命加预热：几周的 Paper 运行要几分钟到几小时（按代码常数估计，未实测）。
- 不能在 `prepare_locked` 里同步做：它在 `requests.dispatch` 的 `serialized(root)` 账户锁里、在一次 `live web-command` HTTP 请求里执行；发布交接只等账户锁 30 秒（`deploy/live_host.py` `ACCOUNT_LOCK_WAIT_SECONDS`），一小时的重放会让每次发布失败、页面挂起。Live 控制自身内存上限 768M，Live 自己的每日对账也是另起容器跑（`live/daily.py`：`MEMORY="2g"`、`SEGMENT_SECONDS=3600`、`CONTAINER_SECONDS=6*3600`、`compare-tmp` 工作目录）。
- 可行的推导形状：仿 `live/control.py` `Evidence`，页面选定候选与合约后在后台起一个与每日对账同形的子容器跑 `paper compare`，结果按（`paper_id`、封存、市场日、镜像）只放在控制进程内存里；`prepare_locked` 只认内存里“干净”的答案，没有就以新码（如 `LIVE_PAPER_UNRECONCILED`）拒绝。代价：新 profile 与部署字段；一个新的子容器路径与工作目录（不能与每日对账共用 `compare-tmp`，除非共用 `compare.lock`）；市场要先覆盖到 Paper 停止那一分钟（`PAPER_COMPARE_UNCOVERED`，至少等下一轮日导入）；每次控制重启（每次发布都会）内存答案丢失，要重算才能准备 Live。

## 存储字段评审

- **消费者**：Live 准入（`live.runs.prepare_locked`）。
- **独立事实**：上面“要的事实”一节；它是 Paper 库（`paper_run`、`paper_file`、`source`）、市场目录与镜像的确定函数。
- **为什么现有字段、关系或推导表达不了**：原则上表达得了，代价只是重。AGENTS.md 不存可推导的东西，所以推荐不存、在后台推导。只有当用户不接受“每次发布后要重算才能准备 Live”，或要在 Live 清单里记下是哪次 Paper 运行放行的，才需要存储。
- **能放在哪**：绝不进研究账本（Paper 与 Live 执行记录不进账本）；不放 Paper 库（`paper compare` 不写库是用户 2026-10-26 的决定，且那是 Paper 控制写、Live 信任，越过 Live 的信任边界）；只能放 Live 私有根，由 Live 控制根据自己跑的对账写。
- **最小形态**（若用户批准）：(a) 缓存，每个键一份 `<root>/paper-reconciled/<sha256(key)>.json`，含 `paper_id`、封存摘要、`source_sha256`、合约、`image_ref`、市场日、对照格式版本与 `clean`，准入时再对照 Paper 库核封存摘要；(b) 在清单 `evidence` 里记下放行的 `paper_id`、封存摘要与市场日。两者各需逐字段授权；(b) 不是检查本身所需。

## 留给用户的选择

1. 后半要不要做；做的话用后台推导（推荐，不存储，但每次发布后要重算）还是批准 (a)/(b) 里的存储。
2. 给 Live 控制加 Paper 读者 profile（部署配置改动）。
3. 没有任何订单分组（`groups == 0`）的 Paper 运行算不算“对账无误”（建议至少有一组订单）；Paper 杠杆要不要等于 Live 杠杆；被中断后挂起（原因 `held`）的运行算不算；“运行一段时间”要不要最短时长。

## 决定（2026-11-21）

协调者在用户的委托（「需要我拍板的都按照你的建议来」）与对 `20261120-06` 的「我都授权」之下决定：

1. 做后半，用后台推导，不存储（没有缓存文件，也没有清单字段）；每次发布后重算，接受。
2. 给 Live 控制加 Paper 读者 profile（部署配置改动：`release_host.prepare`、`HOST_FIELDS`、快照比较、`Configuration`）；它只在下一次打标签的发布时到达远端主机，发布仍由用户决定。
3. 算数的 Paper 运行：已封存、`complete` 且不是 `invalid`；`source_sha256` 等于候选在 `research_at` 的源码；合约集合与 `REPLAY_CODE` 相同；对照用归档数据、不是 `preliminary`；对照至少有一组订单，没有 `unexplained` 分组，`look_ahead_suspects == 0`，`equity_unexplained_minutes == 0`。中断后挂起的运行不算；杠杆不必相同；没有最短时长（“至少一组订单”就是门槛，天数是编造的）。
4. 拒绝码 `LIVE_PAPER_UNRECONCILED`，说明原因：没有匹配的运行、对照还没做完、市场还没覆盖，或哪一项检查没过。

后半在前半合入之后作为单独的 PR 实现。
