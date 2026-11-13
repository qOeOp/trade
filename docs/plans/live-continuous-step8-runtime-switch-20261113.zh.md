# 连续运行第 8 步：确认后切换运行镜像（2026-11-13）

依据：`live-continuous-operation-design-20261110.zh.md` §3.8 表第二行和 §5 逐条决定第 5 条（"换版本和换镜像由用户
发起、在空仓时切换"）。§3.8 原文："发布后只提示有新镜像，先做配对回放。用户确认后在下一个空仓时刻切换：停旧运行，
用新镜像跑同一份源码并预热。"本稿经独立评审（"需修改后批准"，五处阻塞、六处非阻塞，均已按下文处理），再实现。

## 现状

- 一个运行的 `inputs/manifest.json` 钉住运行镜像（`runtime.image_ref`，digest）。每次启动（首次、中断后重启、缺根后
  重新预热）都用它：`live/host.py` 按它建容器并核对容器镜像，`live/compare.py` 按它回放，`live/release.py` 的
  `--adopt` 按它的 `build_revision` 报合同号。
- 控制的声明里有发布配好的运行镜像（`config.runtime`），只用于新准备的运行。发布换了它，正在跑的运行不受影响，
  页面也不提示（第 7c 步因为"没有数据来源"没做"待确认的新镜像"）。
- runner 已有"空仓时结束本次启动、不平仓、由控制重启"的路径：缺根后的 `rewarm`（`engine/live_connection.py`
  `rewarm_pending`/`rewarm`，结束事件 `rewarming`，退出码 `INTERRUPTED`）。控制把它当作中断，按
  `RESTARTS_PER_HOUR` 重启同一个运行。

## 方案选择：同一个运行换镜像（推荐），而不是开一个接续的新运行

| | 同一运行换镜像 | 接续的新运行 |
| --- | --- | --- |
| 刹车 | 起始权益、历史最高权益、现金底线照旧 | 新运行重新武装：最高权益从当前权益算、底线按当前钱包 × 85%。回撤到一半时切换，等于放宽了 15% 刹车（要用户授权），否则要把三项带过去 |
| 运行身份 | run ID、日志、每日对照、页面"已交易多久"连续 | 断开；页面和对照要把两段拼起来 |
| 准入 | 重启照现有中断恢复核对 | 新运行走完整的准备、预检、启动，要求账户全空（`LIVE_ACCOUNT_NOT_FLAT`），空仓时刻正好满足 |
| 要改的地方 | 镜像从"清单里一个"变成"每次启动一个"：宿主、对照、发布接管读当前镜像 | 准备和启动由控制代用户发起；刹车三项的承接 |

同一运行换镜像改动更集中，也不碰刹车。下面按它设计。

## 规则

1. **提示**：运行在跑（`mode=run`，没有停止请求）且 `config.runtime` 与它当前的镜像不同，就是"有新镜像"。
   - 视图给出新镜像的 digest、构建修订，以及这份源码在新镜像回放代码上的回放证据；
   - 每个运行每个新 digest 发一条 Telegram。
2. **只能切到发布配好的镜像**：目标必须等于 `config.runtime`。
   - 发布按相同构建输入把它和控制配对（`deploy/release.py` `require_runtime`；`engine/runtime/Dockerfile` 拷入
     `engine/*.py`），所以它的 runner 合同号就是这个控制的，不用另查。
3. **请求**（新动作 `runtime_switch`，带 request ID，进请求日志）。在账户锁内检查一次，用的都是现有拒绝码：
   - 目标是 main 上 CI 构建的镜像（`image.require_main_build`，`RUNTIME_NOT_MAIN`）；
   - 运行合同和源码合同与清单一致（`inspect_runtime`，`LIVE_IDENTITY_CHANGED`）；
   - **首次武装时支撑它的那次回放**（`replay_evidence` 事件的 `trial_id`）在新镜像的回放证据里
     （`LIVE_EVIDENCE_MISSING`）。只要求"有证据"会接受任意资金规模的回放，比启动时的 `LIVE_EVIDENCE_BALANCE`
     宽，所以要求同一次回放；
   - 运行在跑、没有停止请求、没有未完成的切换。
   通过后记 `runtime_switch_requested {image_ref, image_digest, build_revision, platform, research_at, trial_id,
   request_id}`，请求随即结束（成功），不留"结果未知"的请求挡住之后的重启（`requests.require_clear`）。
   用户可以撤销（`runtime_switch_cancel`，记 `runtime_switch_canceled`）。
4. **`SWITCH` 文件跟着日志走**：控制在每次启动前、每轮维护时，按 `lifecycle.jsonl` 写或删运行输出目录里的
   `SWITCH`（与 `STOP` 同在 `out/`）。
   - 有未完成的切换、且这一小时还能再启动两次（新镜像一次，起不来时退回原镜像一次，第 8 条）时才写；
   - 名额不够就先删掉，等名额恢复再写。这样切换不会把运行停在不能重启的时候。
   - 启动时在 `launch_requested` 写入之后再同步，这次启动先计入名额。
5. **runner 在下一个空仓时刻结束本次启动**（`engine/`，要发新运行镜像）。沿用缺根后重新预热的路径，不加新的入场
   关闭原因，也不改哪些入场可以原生拒绝：
   - `rewarm_pending` 的条件从"缺根关闭了入场"改为"缺根关闭了入场，或有 `SWITCH`"，其它条件不变：本策略没有持仓、
     没有未结束的单、没有暂存的入场，没在停止。
   - 满足后和缺根时一样：不再把 K 线交给源码（`engine/live_source.py` 的扣留），源码不再决策；等 `judge()` 的两次
     一致比对，再 `rewarm()` 结束本次启动，不平仓，退出码 `INTERRUPTED`。
   - 结束事件仍是 `rewarming`，加 `switch: true`。现有所有对 `rewarming` 的特殊处理（`engine/live.py` 不写
     `clean_stop`、`live_session.py`、`live_lifecycle.py`、`live/runs.py`、`views.py`、`notify.py`）都继续成立，
     只有通知措辞按 `switch` 区分。
   - `STOP`、源码失败、到时长都优先（与 `rewarming` 相同）。有持仓就一直等，策略照常交易。
6. **每次启动记自己的镜像**：`launch_requested`（在 `docker run` 之前写）加 `image_ref`。
   - 读镜像的地方都用"它要核对的那次启动"的镜像：`live/runs.py` 的 `_runner`/`_outcome` 和状态里的 `image_ref`、
     `live/host.py`、`live/compare.py`（每段用这一段启动的镜像；没有记录的旧启动用清单里的）、`live/release.py`
     `--adopt`（报当前启动镜像的 `build_revision`）。
   - egress 容器只建一次，照旧用清单镜像。
   - `deploy/live_host.py` `runtimes()`：在跑的运行的启动镜像也算在用，不被清理（启动用 `--pull never`）。
   - 不能用"最近一次 `runtime_switched`"代替：记下切换后，上一次启动的容器就和它对不上，`_runner` 会以
     `LIVE_IDENTITY_CHANGED` 拒绝，运行再也重启不了。
7. **控制在下一次空仓重启时换镜像**：最近一次启动以 `rewarming`（含 `switch: true`）或 `held_flat` 结束、且有未完成
   的切换时，下一次启动用新镜像，记 `runtime_switched`。
   - 中断恢复、超过每小时次数后用户手动启动，都走同一处判断（`runs.launch_locked` 里选镜像），不只在
     `restart_interrupted_locked`。
   - 启动前只确认镜像还在本地。第 3 条的检查对固定 digest 不会变，不再查一遍（重启时控制也没有账本连接）。
   - 新镜像拉不到：记 `runtime_switch_failed {code}`，用原镜像启动，通知用户。
8. **新镜像起不来就退回一次**：新镜像上的第一次启动在 `warmup` 之前就结束（例如 runner 以 `LIVE_MANIFEST_INVALID`、
   `LIVE_RUNTIME_VERSION` 拒绝，或读不了旧版本写的原生缓存），记 `runtime_switch_failed`，用原镜像再启动一次，
   通知用户。不这样，控制会在新镜像上反复重启直到 `restart_limited`。
9. **运行结束时切换还没完成**（`STOP`、到时长、刹车、失败）：记 `runtime_switch_canceled`。
10. **配对回放**：提示新镜像后，控制用新镜像把最近一次每日对照的那一天再回放一次（第 7b 步的对照，只换镜像），
    结果和旧镜像那次一起显示，供用户确认前看。只提示，不拦切换（见"要用户决定"第 3 条）。
11. **页面**：
    - Details 的 Run status 加"Runtime"（当前启动的构建修订）；
    - 有新镜像时加一行"New runtime"：构建修订、回放证据、配对回放结果，按钮"Switch at next flat"，内联确认；
    - 等待中显示"Switching when flat"和已等多久，可撤销；完成、退回或取消后显示结果。
12. **记录位置**：都在 Live 私有目录的 `lifecycle.jsonl` 和运行输出目录，不进研究账本、DoltHub 或 Git。

## runner 合同号

runner 读一个新文件（`SWITCH`），控制据它和 `rewarming` 的 `switch` 判断启动，所以 `RUNNER_CONTRACT` 要从 1 改成 2，
并录 `tests/live/runner-contract-2.json`。

后果（`deploy/release.py` `adoptable` 拒绝合同号不同的在跑 runner）：带 2 的第一次发布不能接管还在跑的、合同号 1
的 runner，只能 Web 先行，等 Live 空闲才配对新控制。之后的发布不受影响。
- 发布时没有运行在跑：没有代价。
- 有运行在跑：要用户停掉它才能换上新控制。停止会平仓并结束运行，之后的新运行重新武装刹车和现金底线。这一次就是
  "接续新运行"的结果。

不改合同号的做法：控制看 runner 的证据判断空仓，再发 SIGTERM（中断不平仓）。判断和信号之间源码可能刚开仓，
重启后就是"有持仓、源码不管出场"的保持状态。这比改合同号差，不推荐。

## 拒绝与审计检查

- 没有放宽或去掉任何检查：
  - 切换要求首次武装用的同一次回放在新镜像上也成立，不比启动宽；
  - 不加新的入场关闭原因，不改哪些入场可原生拒绝（沿用缺根时的扣留和两次比对）；
  - 重启照现有恢复核对，刹车和现金底线照旧（`live_brake.resume`）。
- 新增的拒绝只出现在新动作上（目标不是配好的镜像、运行不在跑、已有切换未完成），不影响现有动作。
- 配对回放只显示，不拦。

## 实现时按独立代码审查改的地方（2026-11-13）

- 第 3 条：镜像和账本自己的拒绝（如 `RUNTIME_NOT_MAIN`、账本不可达）统一报 `LIVE_SWITCH_CHECK`，原码写进说明。
  没写下切换行时，请求的任何失败都记为"拒绝"，不会留下"结果未知"的请求挡住之后的重启。
- 第 5 条：一旦为切换扣下一根 K 线，本次启动就一定经重新预热结束；此后撤销，运行仍重启，只是留在原镜像，源码不会
  拿着漏掉一根的状态继续决策。
- 第 7、8 条：`runtime_switched` 和 `runtime_switch_failed` 在 `launch_requested` 之后才写，启动没走到那一步就不改
  镜像。退回同样适用于对账（`reconcile`）启动；只有交易启动才会接手切换。
- 第 8 条的"起来了"以 `warmup` 为准，它在预热结束、策略 `on_start` 之前写。新镜像若在那之后失败，不退回，按现有
  失败规则处理（重启一次，再失败就结束运行）。
- 撤销请求（`runtime_switch_cancel`）只去掉效果，像 `stop` 一样不被其它未决请求挡住。

## 用户决定（2026-11-13，用户回复"换镜像这 4 件：「按建议」"）

四件都按推荐：

1. **同一运行换镜像**：刹车起点、最高权益、现金底线、run ID 和对照都接着用。
2. **`RUNNER_CONTRACT` 改为 2**，runner 读 `SWITCH` 文件。第一次发布的代价不会发生：用户在全部做完后、还没有任何
   Live 运行时才打版本标签。
3. **配对回放只显示**给用户看，不拦切换。
4. **允许 Nautilus 版本不同的镜像**；起不来就自动退回原镜像一次（第 8 条）。

## 风险

- 切换等的是本策略空仓。策略一直有仓位就一直不切；页面显示已等多久，用户可以撤销。
- 一次切换用掉一次每小时重启名额；名额不够时先不写 `SWITCH`（第 4 条），切换会推迟。
- 读清单镜像的地方漏改一处，就会按旧镜像核对、回放或判断接管（第 6 条）。实现时 grep `manifest["runtime"]`
  逐处核对，并为每处加测试。
- 回滚到不认识 `image_ref`/`runtime_switched` 的旧控制，会按清单镜像核对已切换的运行。旧控制只能在 Web 先行时
  出现（合同号不同），所以回滚前要先停运行。
- 新镜像起来后在 `warmup` 之后才失败（例如交易中源码出错）不退回，按现有失败规则结束运行。

## 验证计划

- runner（原生）：
  - 有 `SWITCH`、空仓：扣留 K 线，两次一致比对后以 `rewarming`（`switch: true`）结束，不平仓，退出码 3，
    不写 `clean_stop`；
  - 有持仓、有暂存入场或未结束的单：不结束，策略照常交易；平仓后才开始扣留；
  - `STOP` 和 `SWITCH` 同时存在：照 `STOP` 结束运行。
  - 负对照：没有 `SWITCH` 时空仓不结束；比对不一致时不结束。
- 控制：
  - 请求的每条拒绝，包括首次武装的那次回放不在新镜像证据里；
  - `SWITCH` 跟着日志写删，重启名额用完时不写；
  - 空仓重启（`rewarming`、`held_flat`）和手动启动都用新镜像，`launch_requested` 记新镜像，`_runner` 核对通过，
    `--adopt` 报新修订，`runtimes()` 保留它；
  - 新镜像拉不到、第一次启动在预热前结束：各退回原镜像一次；
  - 撤销；运行结束时取消未完成的切换。
- 对照：分段各用自己启动的镜像。
- 合同号：`tests/live/test_runner_contract.py` 新基线。
- 反向对照：每条规则去掉一处，测试要失败。
- 页面：浅色、深色截图，独立审美评审。
- 不做：真实账户、远端宿主上的切换。发版本标签和真实账户试验由用户决定。

## 和 #2866 的关系

实现要改的文件与 #2866 重叠，#2866 合并后（2026-11-13）从 main 开始实现。
