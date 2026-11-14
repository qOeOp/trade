# 连续运行第 6 步：新控制接管运行中的 runner（2026-11-13）

状态：已被取代（2026-11-14）。用户决定 0.x 期间版本之间不保留兼容（"马上都要升0.3.0了……老研究能直接删了在新版本上重新开始研究的吧"）：Live 安装后每次发布都配对新控制并等 Live 空闲，只改网页的版本也一样；新控制不接管运行中的 runner，运行中的运行不换镜像，网页不先于控制发布；更早格式的运行留在磁盘上，不读、不迁移。见 `deploy/remote/README.md` 和 `live-continuous-operation-design-20261110.zh.md` §3.8。下文只作历史记录。

依据：`live-continuous-operation-design-20261110.zh.md` §3.8、§4 第 6 步。用户 2026-11-10 授权"改了控制程序的发布
不再等 Live 空闲，由新控制接管运行中的 runner（先出设计）"。设计稿经独立评审（需修改后批准，三处阻塞，均已按下文
处理）；兼容条件在 A（运行镜像构建输入相同）和 B′（runner 合同号）之间，由协调会话 2026-11-13 定为 B′：
不改任何拒绝或审计检查，接管本身已获授权，独立评审也支持 B′。

## 为什么"空闲"可以换成"可接管"

所有 runner 效果都在原 `account.lock` 内，由 `live/release.py admission_locked` 按磁盘路由和 `transaction.json`
判定唯一 owner；宿主也在同一把锁内写事务、改路由、清事务。所以交接的互斥本来就成立，"必须空闲"不是它的来源。
它额外保证的只有一件事：提交后没有活着的 run 要由另一版本的控制来维护（重启中断的运行、判断是否中断、收尾）。
runner 和 egress 是独立容器，发布从不碰它们。

## 规则

1. 声明（`live/configuration.json`）未变、候选源码 `live/release.py` 声明 `ADOPT_INSPECT = 1` 时，宿主请候选控制以
   `live release-inspect --adopt` 检查账户。回答为 `idle` 时照旧成对发布。回答为 `busy` 时附 `runtimes`，即每个忙 run
   的 `manifest.runtime.build_revision`。宿主在锁内用 Git 读候选与每个修订的 `engine/live.py RUNNER_CONTRACT`，
   全部相同才写事务；提交时在同一把锁内再查一遍。
2. `RUNNER_CONTRACT` 只覆盖控制解读 runner 的部分：`runner_args`、退出码（0、1、2、3）、结束事件
   （`RUN_ENDED`、`FLAT`）、`stopping`、`connecting`、`armed.json`、`STOP`。它在运行镜像的构建输入里。
   `tests/live/test_runner_contract.py` 用 `runner-contract-1.json`（本版控制录下的读法）核对两边：改了其中任何一处
   而没把号加一，测试就会失败。
3. 不可接管（合同号不同或缺失、某个 run 没有构建修订、Git 读不出）时退回 Web 先行，条件与以前相同（`PROTOCOL`
   相同）；不满足就保持现状。候选未声明 `ADOPT_INSPECT` 时不传 `--adopt`，行为与以前完全相同（新宿主配旧服务镜像）。
4. 声明已变时仍要求空闲：候选只做空闲检查。
5. `release-inspect` 运行失败（容器退出非零、超时、输出不是 JSON）按 unavailable 处理，不再让整个发布 tick 失败。
6. `idle_locked` 改为读完所有 run 再下结论：任一 run 无法核验即为 unavailable。以前遇到第一个忙 run 就返回 busy，
   后面的 run 不再检查。
7. 交接点只有提交那一刻：宿主持锁写入新路由并清事务。事务期间旧控制只能做维护，候选什么都不能做；之后旧控制被
   准入拒绝、退役（只发 SIGTERM），新控制下一轮维护（≤10 秒）接手。`admission_locked`、`authority`、`serve`、
   `control`、`notify` 都没改。

## 拒绝与审计检查

- 发布准入：从"只有空闲放行"改为"空闲，或忙的 run 都可接管"。这一条由 2026-11-10 的授权覆盖。
- 收紧：一个无法核验的 run 不再被前面的忙 run 掩盖（第 6 条）。
- 其余检查不变。

## 风险（独立评审的非阻塞项）

- **声明变更期间维护全部暂停。** 已经换了声明、还没有配对时，旧控制拒绝一切新效果（含维护）：中断的运行不会被
  重新拉起，密钥不会定期检查，结束的运行也不收尾，直到 Live 空闲、新控制配对。要告诉用户：运行中别换声明。
- 回滚后，旧控制会读到候选在事务期间写的请求和 lifecycle。今天空闲配对也是如此，记录格式向后可读仍靠作者。
- 接管前没有让候选在锁内确认凭证存储可读；凭证存储读不出时，新控制的重启会失败并留下 `launch_unresolved`。
- 通知去重靠 `notify/lock` 和 `notify/state.json`，要求消息键在版本之间不变。
- 每个发布 tick 在锁内多一次 inspect；不可接管时每个 tick 多一次 `prepare`（按 digest 拉镜像）。
- 提交时 30 秒取不到锁（旧控制正在做一次慢重启）仍按现有规则回滚并标记 failed。
- 隔离演练没有加测试专用的产品入口：宿主侧用 `tests/deploy/test_live_release.py` 的替身容器，控制侧用临时 root。

## 验证

- 单元与集成测试：`tests/deploy/test_live_release.py AdoptReleaseTests`（接管成对、合同号不同/缺失/读不出时
  Web 先行、无 `ADOPT_INSPECT` 或声明已变时不传 `--adopt`、inspect 失败、提交时变为不可接管就回滚）；
  `tests/deploy/test_release.py`（Git 声明读取）；`tests/live/test_release.py`（读完所有 run、`--adopt` 输出、
  真实 CLI）；`tests/live/test_runner_contract.py`。
- 没做：在真实 Docker 宿主上，运行中发布一个只改 `live/` 的版本，核对 runner 的容器 Id 和 `StartedAt` 不变、
  新控制能重新拉起被 kill 的 runner。这需要宿主上线新的 `deploy/` 代码和一个版本标签，由用户决定。真实账户上的
  一次核对需要用户单独给范围。
