# 研发轮审计与重构计划（RONNIE-RESTART-20261011）

状态：WS1、WS5 已完成（2026-10-11）；其余为计划稿。逐项与用户达成共识后，再交给独立会话实施；本文件随共识更新。

## 0. 为什么要重构，而不是打补丁

2026-10-11 04:34–11:11 这一轮，Codex 写了 47 个 attempt、1543 个产物文件，只做了 2 次经济读数，两次都是毛收益为负（D11：胜率 47.9%、CAGR −7.4%；D22：胜率 57.1%、CAGR −3.0%）。

问题不是哪一条规则写错了，而是整个工作台以"证明每一步正确"为中心：每个小问题都要单独登记 attempt、dry-run、发布、留证、回读；产品缺少可信的读数，Agent 只能手写 reader 自己评自己；记录层又在膨胀。继续打补丁，只会让仪式更重、有用部分占比更小、代码更难维护。

修复原则：

1. 每个工作项**先回答删掉什么**，再回答加什么。
2. 产品代码只放在信任边界和 Agent 做不到的地方（AGENTS.md）；但信任边界上缺的读数必须由产品给出，不能让 Agent 每轮手写。
3. 用下面的基线来衡量重构是否有效，而不是用"测试变绿"来衡量。

### 基线（本轮实测）

| 指标 | 本轮 |
|---|---|
| attempt 数 / 经济读数 | 47 / 2 |
| 产物文件 / 平均每个 attempt | 1543 / 约 33 |
| dry-run + 回执文件占比 | 41%（639 个） |
| 手写脚本 | 64 个、6205 行 |
| 从开轮到第一次经济读数 | 约 1 小时 50 分 |
| 第一次经济读数之后的新经济运行 | 4 小时 48 分内为 0 |
| 账本 material | 605 个、约 121MB（上一轮 8.9MB） |
| 一次 `find` | 约 12,450 个 TCP 连接、35 秒 |

## 1. 已定的用户决定（2026-10-11）

- 用户只定三项目标：最大回撤、年化收益下限、胜率下限。年化收益**越高越好**，"18%–22%"不是双边区间。
- 每包风险、单币名义上限、组合风险等仓位方案是 Agent 的设计变量。Agent 在回撤预算内自己定，随时可以改，**不需要授权**；改它不算"为救结果改风险限额"。

- **持久数据只存 Dolt（2026-10-11）**：研究记录、策略源、运行报告、证据、市场数据全部只存在 Dolt（包括它的 `dolt_backup` 副本）；其余都只是临时目录里的工作副本。镜像在 GHCR，工具环境（Dolt 二进制、分析环境）不算数据。取消封存托管目录、内容寻址 blob 目录和各种私有备份目录。

## 2. 工作项

每项写明：根因、证据（产物在 `~/.local/share/trade/research/ronnie-restart-20261011/`，记录在活动账本 commit `870q3p8c7jqu3sqchovbv4vpossidi7i`）、重构方向、待议问题、验收口径。

### WS1 目标契约：用户拥有的目标与 Agent 的设计变量分开

- **根因**：AGENTS.md 把"改风险限额"一律列为需授权；`feasibility.md` 写着"Take the goal and risk limits from the user or the latest goal-level decision"，没有区分谁拥有。结果 Agent 自定的 25bp/5%/1.5% 被锁死。
- **证据**：
  - `goal-contract.json`：用户原话"其余风险方案由Agent决定"，Agent 却写进 `do_not_modify_user_targets_or_risk_to_rescue_results`；P6 源码里不一致就 `raise ValueError('risk contract differs from authorized goal')`。
  - S06/S10/S15/S17/S19/S20 的"容量不足"所需胜率在 0.754 到 9.85 之间，实际回撤只用到 9.7%（D11）和 5.9%（D22）。
  - D21 为收紧 Agent 自定的限额申请用户授权。
  - 产品运行器自带隐含上限：`backtest/r1/run_portfolio.py:121` 的 `--coin-notional-cap-pct` 默认 5.0。skill 评测 `infeasible-goal-scope` 也是按"名义上限卡住仓位"的逻辑写的。
- **共识（2026-10-11）**：
  1. **门槛与仓位无关。** 设计够不够，只看三样：按交易计划计的净胜率，收益回撤比（CAGR ÷ 最大回撤），以及交易所杠杆和流动性是否放得下。机制过关以后，最后一步再按回撤预算定仓位：只是一次缩放和一次确认运行，不是网格，不计入选择压力。删掉逐笔风险上限的证明链。
  2. **回撤边际。** 开发期（已暴露数据）原生 MARK 权益的最大回撤，不超过预算的 2/3，以 20% 预算计约 13%。因此开发期收益回撤比须达到 18 ÷ 13.3 ≈ 1.35。
  3. **胜率按交易计划（整包）计。** 一次信号产生的多档入场加共同止损/目标算一笔；净额包含手续费和资金费；打平算非赢。
  4. **胜率是验收指标，由产品计算。** 策略契约强制：每张单带计划 ID（Nautilus order tags）；同一币种同一时刻只允许一个活动计划。产品报告按计划汇总净盈亏；缺标签或计划重叠就拒绝。平仓周期胜率退为描述统计。
  5. **删掉跑前的名义容量和频率扫描**（S06/S08/S10/S13/S15/S17/S19/S20/S22 一类），只保留样本量下限：开发窗口内至少 100 个已平仓的交易计划。
  6. **硬约束交给 Nautilus 原生。** 保证金和杠杆由 Nautilus 账户模型拒单。单笔名义占成交量的比例由 Agent 在策略里自定，并在决定里报告。不加产品审计。
  7. **目标存为固定格式的 material 文件。** 只含三项用户指标、回撤时钟和窗口；目标变化就换 goal_id。不新增存储字段。
  8. **AGENTS.md 授权条款**只覆盖：用户的三项目标，以及代码里的拒绝和审计。仓位参数不在其中。
  9. **当前 Codex 轮次停在这里**，WS1 和 WS2 落地后再重开。
  10. **仓位参数归策略源码。** 删掉运行器的 `--risk-budget-bps` 和 `--coin-notional-cap-pct`，以及 node_strategy 在策略外面统一套的那层仓位逻辑。仓位写在单文件策略里，随源码哈希一起固定。这是破坏性改动，需要新镜像和配对原生回放；已有封存仍须可读。
- **验收**：
  - 用 D11 和 D22 的已封存结果，按新门槛重新给出判定。两者毛收益都为负，预期仍判失败，而失败理由应是胜率和收益回撤比，不再是名义容量。
  - 用一个隔离账本和合成或短窗口回放，演示计划级胜率读数，以及缺标签、计划重叠两种情况下的拒绝。
  - research-round 的评测全部通过；`infeasible-goal-scope` 改写或删除，并新增一条防回归评测：不得把 Agent 自定的仓位当作用户约束，也不得因名义容量否掉一个可以缩放的设计。
- **状态：已完成（2026-10-11）。**
  - [qOeOp/trade#1512](https://github.com/qOeOp/trade/pull/1512)：文档与 skill。
  - [qOeOp/trade#1513](https://github.com/qOeOp/trade/pull/1513)：运行器不再带仓位参数，运行时契约改为 `r1-native-v3`，`artifacts report` 新增计划级读数 `plans`。
  - 用户补充决定：期末仍未平的计划算非赢。
  - 验收记录见 [ws1-goal-contract-acceptance.zh.md](ws1-goal-contract-acceptance.zh.md)，字段评审见 [plan-reading-field-review.zh.md](plan-reading-field-review.zh.md)：
    - D11、D22 重判仍失败，理由是计划胜率（47.8%、55.7%）和收益回撤比（−0.77、−0.51）；
    - 新镜像 `42f4d2d9…` 的配对原生回放一致；
    - 隔离账本演示了计划级读数和两种拒绝。
  - 评测：两条新增用例加 skill 都是 3/3。旧留出用例 `infeasible-goal-scope-heldout` 换成了 `feasibility-gates-heldout`，加 skill 3/3、不加 0/3。
  - 未完全达标：老用例 `exposed-window-no-generalization` 和 `l3-touch-not-pnl` 加 skill 各 2/3。失败是这两条规则原有的漏洞，WS1 没有改动它们，另行修复。
  - 之后登记的运行要用 v3 镜像，对照组也要在 v3 镜像上重跑；v2 策略源码需先发表 v3 修订。

### WS2 研究流程与记录层重写（WS3 已并入）

- **根因**：
  - 每个小问题都是一个完整的 attempt，验证没有预算；skill 的 L1–L5 与 schema 的 `layer` 四个值对不上；只有 `economics` 层失败才计数。
  - 记录层：`dolt_store.py:185` 每读一个对象就新建一个 TCP 连接，并先执行一次 `SELECT DOLT_VERSION()`；`find` 对每个 attempt 遍历整张图；material 不区分大小和类型；决策只有自由文本。
- **证据**：
  - D01–D10 共 10 个 attempt、69 分钟，经济结论为 0；D06 已显示年化 0.07%，之后仍做了 4 个风险/保护证明。
  - P5 先做风险证明（D18–D21），后读经济（D22），而 S08 早已显示上限约 8%。
  - S10/S15/S17/S19/S20 本质是经济不可达，却登记为 `data/failed`，进度检查从未触发。
  - 6 个 family 之间切换 13 次。来源复核 S01/S04/S09/S11/S16/S18 每次都落在同一分支。
  - 12 条 `execution/passed` 大多只是归因读数；dry-run 和回执文件占全部产物的 41%。
  - 一次 `find` 约 12,450 个连接，本机临时端口只有 16,384 个；两个读取同时进行就出现 Errno 49，`find` 返回 `matches: []` 加 unreadable，退出码仍为 0。
  - 账本内容 99% 是媒体：material 605 个、161.7MB；attempt 102 个 revision 只有 0.79MB。
  - 上一次"清空"是手工的：停服务、挪目录、导出 10MB 自制 snapshot.json、做恢复演练、重新初始化，归档共 84MB，CLI 没有对应命令；分析旧轮只能读自制 JSON 或另起服务。
  - 40/47 个 attempt 引用了空文件证据 `review_evidence:e3b0c442…`；约 120 张视频帧 PNG 内联在 objects 表里，material 共约 121MB；S17 在决定写入后又改了 next_action。
- **共识（2026-10-11）**：
  1. **账本只登记两种记录。**
     - 候选冻结：固定的策略修订 + 一次封存的开发期运行 + 产品给出的验收读数（WS1：计划级胜率、收益回撤比、样本数）+ 产品报出的试验次数 + 判定。冻结一次写入完成，不预登记，因为门槛已由 goal 固定，等于现成的结果映射。失败的冻结照样登记。
     - 确认：只在冻结之后、对冻结时尚不存在的数据做；先预登记，再运行，再判定。
     - 来源阅读、定义、实现调试、事件研究、试跑，全部是不登记的探索。
  2. **选择压力由运行器自动计数。** 每次原生回放都自动写一行试验日志（存储见第 11 条的 `trial` 表，入口在 WS5）。冻结时，产品报出本 goal 开发窗口上已经跑过的不同策略源数量，不再由 Agent 自报"未登记回放：无"。
  3. **研究不再做配对对照。** 验收是绝对门槛，基准就是不动的初始资金，D11-CONTROL 这类运行删掉。`compare` 只保留给镜像或依赖升级的工程平价回放。
  4. **停止规则。**
     - 每 3 次失败冻结做一次进度检查；
     - 自上次冻结以来，试验日志里超过 20 个不同策略源仍未冻结，也必须检查；
     - 连续两次检查既没有排除什么、也没有佐证什么，就把问题交给用户。
  5. **判定结构化。**
     - 用记录类型（冻结/确认）取代 layer 枚举；
     - 结果为 passed、failed 或 invalid（完整性不过）；
     - 失败时必填失败部件：毛边际、成本、频率、尾部、完整性之一；
     - 数值来自产品读数，不进文本；自由文本限长。
     - 按 AGENTS.md，新增字段前先做独立子代理评审，结论写进 docs/plans。
  6. **判定不可修改，只能追加更正。** 更正是一条引用原判定的新记录。
  7. **删掉 family**，选择压力和进度检查都按整个 goal 计，换题不重置。
  8. **来源每个 goal 一份笔记。** goal 开始时用 video-evidence / research-sources 产出，冻结记录引用它。不再有来源 attempt，也不再有重复的独立复核轮次。
  9. **只留不可重建的证据**：策略源（Dolt）、封存运行（含产品读数），另可附一份简短的探索笔记。手写 reader、日志、空 stderr 都不再留证。
  10. **取消写入仪式。** 不再强制 dry-run、写后回读、validate 和回执文件；写入本身原子且先校验，CLI 的返回就是回执。dry-run 保留为可选。
  11. **存储重新设计（2026-10-11，基于 Dolt 2.4.2 实测和需求盘点，取代原第 11–15 条）。**
      - **新开一个干净的数据库，不导入旧账本。** 开发期旧数据不重要，也不需要保留：旧账本在 WS7 统一删除，WS2 本身不删。"哪些窗口已被看过"这一事实仍要写进新 goal 的 material（一句声明，不导入旧记录）。
      - **轮次用分支和标签管理。** main 只放当前 schema。每个 goal 从 main 开一条 `round/<goal_id>` 分支，结束时打只读标签。"开新一轮"和"结束本轮"各是一条命令；写入只允许在活动分支上。schema 只在 main 上改，新一轮自动用上；旧标签用 `AS OF` 读当时的表结构，不依赖当前代码。
      - **有类型的表取代通用的 objects/relations JSON。** 表包括 goal、source_note、strategy_revision（源码字节存 Dolt）、run（产品读数是真实列，成本口径从运行产物读出，不由 Agent 填写）、trial、freeze、confirmation_plan、confirmation_verdict、correction、evidence（证据字节存 Dolt）。约束和外键由数据库负责。
      - **运行报告全量入库，取代封存托管目录。** 回放在临时目录产出报告，审计（含 WS4 的裸仓审计）通过后一次提交入库：orders、fills、positions、account、order_events 等按 run_id 进有类型的表，逐时刻暴露序列（exposures）存压缩 BLOB。运行身份就是这次提交，加上策略修订、市场数据 commit 和镜像 digest。删掉 artifacts 的托管目录、manifest 哈希、verify、backup、restore 和 0700 目录检查。审计失败的运行只入库摘要和失败原因。
      - **只插入、不更新。** 并发控制只靠一行 `ledger_head`，每次写入都改它，后到者收到 1213 后重读或拒绝（实测：只比较分支头 hash 拦不住并发）。幂等用每行的 `op_id` 唯一键。去掉 `write_head` 版本号、`operations` 表、`publication` 对象和回执链。每次发表只开一个事务、只用一个连接；不使用 `dolt_commit('-am')` 去提交别人的改动。
      - **时间由服务器生成。** BEFORE INSERT 触发器把 `created_at` 设为服务器当前时间；提交日期可以被 `--date` 伪造，不采信。
      - **试验日志进 Dolt 的 `trial` 表。** `artifacts run` 的探索和封存两种模式都写一行；冻结时用 SQL 统计试验次数，删行会在 `dolt_diff` 里留痕。WS5 只负责"所有回放都走一个入口、每次运行报一次"。
      - **SQL 账号最小权限。** 写入账号只有 SELECT、INSERT，`ledger_head` 加 UPDATE，并单独授 EXECUTE ON PROCEDURE `dolt_commit`；不授库级 EXECUTE（实测库级 EXECUTE 能 reset、删标签、amend）。读取方用只读账号。同一系统用户仍能绕过，所以保证程度是"改了会留痕"，不是"改不了"。
      - **外部见证。** 冻结和确认预登记写入后，把提交 hash 和时间追加提交到一个私有 GitHub 仓库，分支保护禁止强推和删除，只存 hash 列表，不含研究内容。仓库和保护规则由用户创建，用用户已有的 gh 登录，不新增凭据。确认的"预登记早于数据形成"以它为准来核对。
      - **连接与读取。** 一条命令一个连接，走 unix socket 并显式配置路径。读取时不重新校验整张图，完整校验改成单独的审计命令。连接失败非零退出。常用 JSON 字段用生成列加索引。
      - **提交前检查。** 用 `dolt_tests` 配合提交验证组检查外键和不变量。它可以被跳过，只用来防误操作，不作为信任边界。
      - **导出。** `dolt sql -r parquet … AS OF <tag>` 包成一条只读导出命令；skill 里附几条常用的 `AS OF` / `dolt_diff` 查询。
      - **备份。** `dolt_backup sync` 到本机另一个目录，取代自制快照和恢复演练；这是 Dolt 的副本，不算另一个数据来源。
      - **测试隔离。** 集成测试自己起临时 Dolt 服务，用完关掉并删除目录；检测到活动账本配置就拒绝运行。实测活动库里积了 851 个测试残留库、共 869MB，就是测试连活动服务器造成的。
      - **证据与视频。** 视频原片（mp4、音频）不持久保存：只记 URL、sha256 和派生证据，原片在临时目录用完即弃，需要复核时重新下载并核对 sha256（原片下架就无法复核，这一代价已接受）。派生证据（转写、帧、check.json、claims.json）存进 Dolt 的 evidence 表。拒收空证据。
      - **新鲜度检查（自 WS5 移入）。** 冻结和确认写入前，CLI 先 git fetch，检查自身代码是否包含 origin/main 的最新提交，落后就拒绝；探索不拦。
      - **账本具名档案（自 WS5 移入）。** CLI 用 `--ledger NAME` 选择账本，去掉 `TRADE_RECORDS_CONFIG`。隔离账本的库名必须不同于活动账本，写入时校验。临时账本由启动它的命令负责关闭；`ledger status` 列出所有在跑的账本。
      - **字段评审。** 新增表和字段前，按 AGENTS.md 做独立子代理评审，结论写进 docs/plans。
- **验收**：
  - 用本轮的问题重放一遍纸面流程，记录数、文件数、到第一次经济读数的时间都要明显低于基线：本轮 47 个 attempt 应对应约 2–4 条冻结。
  - 账本规模扩大到 10 倍时，`find` 小于 2 秒、连接数恒定，并发读不再出错。
  - research-round 的评测按新流程改写后全部通过。

### WS4 可信读数：验收读数之外只留完整性

- **根因**：审计只检查回放结束时的状态，持仓期间是否一直有保护没人查；Agent 自定的风险限额又引出一大串手写风险读数。
- **证据**：
  - D11–D25 手写了 18 个 reader、共 1774 行，反复出错：D07→D08 只差一行 sort key；D11 的读者断言"只会单笔全额成交"，引出 D12–D14；D19 有 TypeError，D23 有 KeyError。
  - `audit_tiered_native.py:79` 写明 "No … historical protection reconstruction"。
  - **潜伏缺陷**：`D25-mechanics-ledger/fourth-result.json` 显示，母单部分成交后按 GTD 到期，止损和止盈随之被撤，已成交仓位没有保护。P1–P6 用的是同一套下单代码。已核查：D11-C37 和 D19-C37 的封存订单里没有"部分成交后到期或取消"的母单，两次经济失败没有被这个缺陷污染。Codex 对此的记录在它 worktree 里未提交的 `docs/plans/ronnie-p6-partial-gtd-protection-gap.zh.md`。
  - 订单事件历史只在 draft PR [qOeOp/trade#1510](https://github.com/qOeOp/trade/pull/1510) 上：运行器加 15 行，输出 `order_events.jsonl.gz`。
- **共识（2026-10-11）**：
  1. **产品不再提供组合风险读数。** 不出逐小时单币名义、总计划止损风险这类读数。仓位是设计变量，风险最终体现在原生 MARK 回撤里，而回撤已经是验收项；保证金和杠杆由 Nautilus 拒单。更细的描述统计走 nautilus-report-analysis skill。
  2. **信任边界只剩两样**：验收读数（WS1）和完整性。
  3. **裸仓审计硬拒绝。**
     - 审计在整段回放中检查：持仓数量超过 reduce-only 止损的覆盖数量，持续超过一根 5 分钟线，整次运行判为 invalid。
     - 策略如果在源码里声明本来就不设止损，审计只报告、不拒绝。
     - 审计的输入是原生订单事件历史。
  4. **编写指南给出经过测试的原生写法**：用 Nautilus 原生订单（bracket/OTO）处理分档入场的部分成交和母单到期，并配一条合成回归测试。不提供产品库，策略仍是独立的单文件。
  5. **#1510 在 WS5 拍平后的结构上重做并合并**，订单事件历史成为标准报告。
  6. **不做信号和几何导出。**
  7. **审计在临时目录的运行产物上执行**，通过以后才入库（入库在 WS2）。 信号就是策略提交的计划，也就是带计划 ID 的订单；探索时从原生订单报告读取，不再手写 5m→1h 聚合去重算信号。
- **实现**：[qOeOp/trade#1526](https://github.com/qOeOp/trade/pull/1526)，记录见 [ws4-trusted-readings.zh.md](ws4-trusted-readings.zh.md)（原生实测、字段评审、验收）。
- **验收**：
  - 用合成回放复现 D25 的情形：部分成交后母单 GTD 到期、止损被撤，审计判 invalid。按指南写法改正后，审计通过。
  - 已有封存仍可 verify/report。D11-C37 和 D19-C37 用新审计重读时，预期不会出现裸仓。
  - 配对原生回放确认，新增报告不改变订单、成交和账户经济。

### WS5 运行器收缩与运行时身份

- **已定（2026-10-11）**：运行器收缩并入本项，排在 WS1 PR2 之后（两者改同一批文件）。
  - 运行器只接收四样东西：策略引用、输入、窗口、账户。手续费、资金费、初始资金等账户和市场事实留在运行器里。
  - 删掉 `--signal-variant`、`--exit-variant` 以及所有策略参数：一个策略文件就是一个完整策略，变体就是新的修订。
  - `backtest/r1/` 拍平成 `backtest/`。封存里记录的 runtime_contract 名称（r1-native-v1/v2）不改，已有封存仍须可读。
  - 从树里删掉 `receipts/` 的 9 个历史回执，文档改用 commit 永久链接。
  - 6 个模块合并成"加载 / 运行 / 报告"三块，去掉 replay_util、node_strategy 这类转接层；以行数和依赖边减少为准，不改报告契约。
  - 所有原生回放都走 `artifacts run`，每次运行在一个统一接口上报告一次（策略源哈希、窗口、币种、镜像 digest、模式）。试验日志的存储（Dolt `trial` 表）在 WS2 实现；WS5 先把接口和调用点做好。
- **已定（2026-10-11，镜像与环境）**：
  1. **镜像由 CI 构建，推到公开的 GHCR，只构建 linux/arm64**（用 GitHub 原生 arm64 runner）。
     - 镜像带 OCI 标签 `org.opencontainers.image.revision`，即 Git commit。
     - main 合并后构建的是正式镜像，并更新"当前"指针（例如 `main` 标签）。`artifacts run` 不传 `--runtime` 时，解析"当前"并记录 digest。
     - PR 分支也由 CI 构建，打"非 main"标签，供探索和工程使用，例如运行器改动在合并前跑配对原生回放。
     - 本机不再构建镜像，去掉本机 registry 和手写的运行时身份 JSON。
  2. **冻结和确认只接受 main 构建的镜像**：镜像标签里的 commit 必须在 origin/main 上。探索和工程可以用任何 CI 镜像，试验日志照记。缺产品能力，就先合并再冻结。
  3. **新鲜度检查**：已移到 WS2（它在记录层的写入路径上，而 WS2 会重写这条路径）。
  4. **账本具名档案**：已移到 WS2，原因同上。
  5. **所有原生回放走同一个入口**：`artifacts run` 增加轻量的探索模式，不封存、输出到 `/tmp`，但每次运行都在统一接口上报告一次，试验日志由 WS2 落进 Dolt。不再直接用 `docker run` 跑回放或探针。
  6. **项目改为可安装的包**（`pyproject.toml` 去掉 `package = false`），镜像里同样可导入。仓库外的探索脚本用 `uv run --project` 就能 import，不再手补 PYTHONPATH。
  8. **不改托管目录逻辑**：现有的封存托管（verify、backup、restore）保持原样；WS2 会用 Dolt 入库整体取代它。运行器需要报告给 WS2 的东西（运行产物所在的临时目录、审计结果），通过和试验报告同类的接口交出。
  7. **旧镜像**：CI 镜像上线后停掉本机 registry，不再 `docker save` 归档；旧镜像统一在 WS7 删除（用户 2026-10-11 授权）。
- **根因**：
  - 没有"当前运行时"指针；`artifacts run` 只核对镜像 digest，不核对镜像代码来源。
  - 镜像手工构建、推到端口不固定的本机 registry，运行时身份是手写 JSON。
  - 运行配置（如 `--exit-variant`）与策略源分离，封存前没有预检。
  - 研究会话在落后的 worktree 上跑；`package = false` 导致仓库外脚本 import 失败；隔离账本只靠环境变量区分；进程用完不关。
- **证据**：
  - 同一份 BTC/ETH 回放跑了 4 次（4 个镜像），结果逐字段一致；D05 选到没有 exposures 输出的旧镜像。
  - D07 之后的已登记运行用的镜像，是从 #1510 的 worktree 构建的（`order-history-derived-runtime.Dockerfile`）；镜像仓库端口在 15000 和 64928 之间变过。
  - D23 照抄 P5 的 exit variant，照样走完封存才失败。
  - PYTHONPATH 漏设出现在 D01、S06、D11，D25 的 3 个探针也失败（`docker run --entrypoint python` 时 `/opt/trade` 不在 `sys.path` 上）；13336 端口的 Dolt 空跑 6 小时（已于 10-11 停掉）。
  - Codex 用的 CLI 和 skill 来自 143b50357，缺少 #1505 的修补。
- **验收**：
  - 合并到 main 后，CI 产出带 revision 标签的 arm64 镜像，`artifacts run` 不传 `--runtime` 就能用上它。
  - 用 PR 镜像做冻结写入会被拒；用落后的 checkout 做冻结写入会被拒。
  - 本轮 D05（选错镜像）、D23（变体配置）、D25（PYTHONPATH 和探针）这三类失败，在新结构下不可能再发生，或在第一步就被拦下。
  - 运行器拍平、合并后，经配对原生回放确认行为一致（订单、成交、费用、资金费、账户经济）。
- **状态：已完成（2026-10-11）。**
  - [qOeOp/trade#1520](https://github.com/qOeOp/trade/pull/1520)：`runtime-image` 工作流在 `ubuntu-24.04-arm` 上只构建 `linux/arm64`，推到 `ghcr.io/qoeop/trade-runtime`（随公开仓库已是公开包），带 `org.opencontainers.image.revision`；main 构建更新 `main` 标签，PR 构建打 `pr-N`，每次都打 `sha-COMMIT`；只在运行时输入变化时构建。
  - [qOeOp/trade#1521](https://github.com/qOeOp/trade/pull/1521)：`artifacts run` 不传 `--runtime` 时拉取 `main` 并记录 digest，`--runtime` 改收镜像引用，手写身份 JSON 删除；新增 `--explore`（不封存、输出到 `/tmp`）；`research/records/trials.py` 的 `report_trial` 和 `hand_off_run` 是交给 WS2 的接口，目前只返回记录、探索时写 `trial.json`，封存托管未改；`register` 只收 main 构建的镜像，并核对镜像代码与该 commit 一致；项目改为可安装包。
  - [qOeOp/trade#1522](https://github.com/qOeOp/trade/pull/1522)：运行时契约 `r1-native-v4`，运行器不再接受任何策略参数，日线预热由策略类的 `DAILY_WARMUP` 声明；`backtest/r1/` 拍平为 `backtest/{load,run,report}.py`，7 个模块 1,138 行、11 条内部依赖边变为 3 个模块 969 行、2 条边；`runtime.LAYOUTS` 按契约区分新旧布局；9 个回执移出，文档改链到 `5700ceb`。
  - 验收：
    - 配对原生回放（main 的 v3 镜像对 PR 的 v4 镜像，均走 `--explore`）BTC/ETH 和 37 币全年的订单、成交、持仓、账户行、收益、资金费、手续费和期末权益全部一致；37 币结果与封存的 D11-C37 逐行一致。
    - 合并后 main 镜像（revision `2bd34033`）在不传 `--runtime` 时被选用，并通过 main 构建检查。
    - 56 个已有封存全部能 verify；report 只有读取方 `uv.lock` 哈希不同。
    - D23：变体参数在镜像身份探针处被拒，退出码 2，未生成输出、未报告试验。D25：仓库外脚本用 `uv run --project` 直接 import。D05：默认镜像即 main，非 main 镜像不能登记。
  - PR 镜像登记被拒（2026-10-11 补做的端到端演示）：在临时隔离 Dolt 2.4.2 里用 CLI 发表 v4 策略和待定 attempt，再用 `artifacts run` 对同一源码各封存一次。
    - 一次在 `pr-1522` 镜像（revision `f0903398`，不在 main 上），一次不传 `--runtime`（main 镜像 `0438768c…`），两次封存都通过并报告了 `sealed` 试验。
    - `register` 拒绝 PR 镜像的封存（`runtime image revision f0903398… is not on origin/main`，退出码 2），账本版本和 commit 不变，`run:WS5-DEMO-PR` 不存在。
    - main 镜像的封存登记成功，版本从 2 变 3，记录的 `runtime_identity` 是 main 的 digest。
    - 演示用的库、封存目录和 worktree 用完即删。
  - 不在本项："用落后的 checkout 做冻结写入会被拒"随新鲜度检查移到 WS2。
  - 已撤回：开工时做的旧镜像 `docker save` 归档（用户改为不归档后已删除）。本机 registry 在 CI 镜像上线前已停，未删除，重启策略改为 `no`。
  - 之后：WS2 替换 `trials.py`，按 `LAYOUTS` 读新旧封存；WS4 在 `backtest/` 拍平结构上重做 #1510。

### WS6 来源取证（已并入 WS2）

- **根因**：
  - research-round 的 `source-evidence.md` 规定"不得留存未引用的帧"，但复核要按 `check.json` 列出的全部文件来恢复，两条规则相互冲突。
  - 每个被依赖的来源都要做一次干净上下文复核：重跑整段 ASR、要求字节一致、逐帧核对，结局却是注定的。
- **证据**：
  - S09 复核恢复失败，缺 82 个 PNG，多写了一个 revision。
  - S16 用了 23 分钟，S18 用了 18 分钟，结局都是 B。
  - 04:36 仍在调用已退役的 video-note 服务（来自旧 worktree，WS2 的新鲜度检查会拦住这种情况）。
  - 本轮的 fast 档误识别来自旧服务；main 上已钉住 whisper-large-v3。
- **共识（2026-10-11）**：
  1. 视频原片不持久保存；派生证据（转写、全部帧、check.json、claims.json）整份存进 Dolt（WS2 的 evidence 表）。删掉"不得留存未引用帧"的规定，也不再逐个文件 material retain。
  2. 研究中不强制独立复核。来源只用来定规则，策略好坏由原生回测和确认来裁定：来源读错只会让候选失败，不会造出假的通过。研究里只跑本地校验器 `check_bundle.py`。video-evidence skill 自己的复核流程保留给其他用途。
  3. goal 的来源笔记沿用 claims.json 格式，策略源里的规则引用 C 编号。
  4. 并入 WS2：重写 research-round 的 source-evidence.md 和托管规则。

### WS8 市场数据治理（2026-10-11 新增）

- **根因**：仓库里没有任何生成市场数据的代码。原来的 market-data crates 和常驻获取进程，在 #1458 迁移到官方 Nautilus 时被整体删除。现在的 Catalog `r1-37-1y-5m-2026oct7` 是那之前留下的产物：5 分钟线 827 万行、Parquet 400MB，分散在 5,697 个文件里，另有日线 449MB。产品既不能重建它，也不能扩展到用户 10-05 定的 1m–1w 全周期。
- **共识**：
  1. 市场数据存进一个**独立的 Dolt 库**，与研究账本同一个服务。两者生命周期不同：市场数据按月追加，研究按轮次分支。运行用 commit hash 引用某个版本的市场数据，这就是输入身份。
  2. **先过实测门槛（WS8a）**：在隔离实例上导入一年 37 币的 5m 和 1m 数据，测体积（与 Parquet 比）、导入时间、导出成 Nautilus Parquet Catalog 的时间、峰值内存。达标才进入实现；不达标就把结果带回来再议。门槛（市场数据作为唯一例外，留在持久目录）只在 WS8a 不达标时才重议。
  3. **实现（WS8b）**：
     - 补齐获取和导入代码：只用币安公开数据，按用户 10-05 的决定，月度归档、日归档和 REST 拼接当月，拼接对上层不可见；
     - 回放前按数据 commit 导出到临时缓存，缓存丢了就重新导出；
     - 运行器的"输入"改为市场数据 commit；
     - 删掉目录树哈希这一套输入身份。
- **验收**：
  - WS8a 写成 docs/plans 里的实测报告，包含上面四项数字和是否采用的建议。
  - WS8b：从零获取并导入 37 币，导出后用同一策略做配对原生回放，与旧 Catalog 对比订单、成交和账户经济。差异必须逐项解释；可以接受的差异只有数据源修正，并且要说明理由。

### WS7 旧数据清理（2026-10-11 授权）

- **用户决定**：开发期旧数据不重要，不需要保留。授权删除下列四类，外加 skill 评测的旧输出：
  1. **旧 Dolt 账本及全部副本**（约 3.5GB）：`records/`（含 869MB 测试残留库）、`records-backups`、`records-recovery`、`records-validation`、`research-ledger-backups`、`ledger-archives`、`order-history-engineering`、D25 隔离账本。
  2. **旧封存运行及备份**（约 5.5GB）：`research-artifacts`（43 个运行）、`research-artifacts-backup`、`research-artifacts-acceptance`、`research-artifacts-acceptance-backup`、`research-artifacts-acceptance-restored`。
  3. **旧研究产物和审计**（约 3.5GB）：
     - `research/`、`research-audits`、`research-retention` 及其备份、`research-recipes` 及其备份、`research-diagnostics`；
     - `validation`、`portability-validation`、`strategy-variant-migration`；
     - `strategy-migration` 中除 `inputs` 以外的部分、`video-evidence-drafts-20261010`。
     - 删除后，本计划文档里引用的证据路径会失效；结论以本文档的文字记录为准。
  4. **旧镜像**：`research-runtime`（导出的镜像包，约 5.6GB）、本机 registry 容器，以及其中的 `trade-r1-runtime` 镜像。
  5. **`skill-evals` 的历次运行输出**（约 9.7GB）。
- **保留**：
  - `catalogs/` 和 `strategy-migration/*/inputs`（市场数据）：保留到 WS8b 配对回放通过、市场数据改由 Dolt 提供为止；之后由 WS8b 报告，经用户确认再删；
  - `ledger-probe/`（Dolt 二进制）；
  - `research-analysis-envs`（ASR 等分析环境）；
  - 新库及其备份、WS5 的 CI 镜像。
- **时机**：WS1、WS5、WS4、WS2 全部合并，新库启用后执行。WS4 的验收要读 D11/D19 的旧封存和 D25 的探针结果；WS1 和 WS5 期间还要用到本机 registry。
- **执行规则**：
  - 先盘点：逐个目录确认属于授权类别，并且新系统（代码、配置、新库、CI）没有引用它；
  - 列出清单和大小，报告给用户后再删；
  - 不在授权清单里的目录（例如某个会话留下的临时演示目录）只列出，不删；
  - 删除后报告释放的空间。

## 3. 顺序与依赖（2026-10-11 已定）

1. **WS1**（已完成）：PR1 改 skill 和文档；PR2 改运行器的仓位参数，并加计划级胜率。
2. **WS5**（已完成）：运行器收缩、CI 镜像、统一回放入口（试验报告接口）、可安装包；本机 registry 已停，旧镜像留到 WS7 删除。
3. **WS4 与 WS2 并行**，都以 WS5 已合并为前提。
   - WS4 是裸仓审计、#1510 重做和保护写法指南，改的是运行器、审计和 strategy-authoring 中的一节。
   - WS2（含原 WS3、WS6）是记录层重写、归档清空和 skill 重写；重写 skill 时要保留 WS4 在 strategy-authoring 里加的那一节。
4. WS6 已并入 WS2。
5. **WS8a**（市场数据实测）：独立、只用隔离实例、不改产品代码，现在就可以开始。
6. **WS8b**（市场数据实现）：在 WS2 和 WS5 之后。
7. **WS7**：在 WS1、WS5、WS4、WS2 合并、新库启用之后执行。旧市场数据等 WS8b 完成后另行确认。

Codex 已停，端口耗尽不再紧急，所以连接修复不单独先做。

## 4. 当前 Codex 轮次的处置

- 已定：这一轮停在这里，等 WS1/WS2 落地后再重开。账本会在 WS2 中归档后清空。
- D21 的提案（P5 全组合 5% 拒绝）已无意义：P5 已关闭，单币上限也改由 Agent 自定。

## 5. 每项的工作方式

一次只议一项：逐条追问到共识，把共识写回本文件，再给出一段自包含的提示词（包括文件路径、证据 ID、共识结论、验收口径和不做什么），由独立会话实施。
