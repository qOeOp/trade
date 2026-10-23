# 2026-10-23 EMA 日线长 Goal 会话诊断

按 product-doctor 三个工作流（行为与决策证据、数据与使用成本、产品契约与交付），由三个 fresh、只读子代理独立检查，主代理复核高优先级发现（停止规则文字、作者规则文字、judgment 体积与列类型、会话中提问与 Goal 续跑的时刻）。

| 项 | 值 |
|---|---|
| 会话 | local Codex Desktop（cli 0.163.0-alpha.10.2），`rollout-2026-10-22T22-22-00-01a163c6-925e-75e0-837a-d89b9ed27cba.jsonl`，2026-10-22T13:22:00Z–10-23T01:50:20Z；54 个子会话（parent = 01a163c6…，其中 Leibniz `trial61_native_check` 跨 11.8 h 复用） |
| 检出 / 账本 | 会话检出 `cd132338d`，审计时 main `9b6c7fe73`；账本 `research` `2ljh6sg5gs4gp3vfmu5qelt5lg94uqvk` → `n16ep9acupdag6vt97bcjsg98nicjuh3`，683 次单操作提交（13:28:21Z–01:13:14Z）；未见市场写入 |
| 覆盖 | 行为：全部用户轮、13:22–15:06 与 01:13–01:50 逐调用，全时间线拒绝与非零退出扫描，Goal 事件，账本推荐/试验/源码审阅只读查询。数据：683 提交按操作分类、表计数与一致性、存储体积、逐版本时长与 token、调用类型 token 分摊。契约：-09..-17 合入情况与消费者核对、遮罩路径、标识呈现、skill 规范与字数、ruff/mypy、main CI 39801200436、设计站与 eval。缺口：54 个子会话正文（只看索引与代价）；trial 67 经济读数正确性；Dolt TEXT 溢出行为；备份 head（只有文件时间）；journal 会话内物理增长；`replay report --at` 未实跑；00:59 Goal 暂停由谁发起 |
| 用时构成 | 12.5 h。replay 计算（预检/研究/复现开到封）约 25 分钟（3.3%）；13:39–13:45 等待用户的提问被 Goal 续跑吞掉；其余为研究、审阅、核查与协调，未逐段细分。token：主会话 352M（缓存输入 349M），子会话 174M，合计约 526M；trial 67 成为推荐（14:03）之后 11.6 h、主会话 327M |
| 产品导致的无效试验 | 0。19 个旧运行（上一会话的 trial 3–57）在本会话被追加源码审阅判 causal failed 而遮罩，是策略源码错误；本会话新运行无遮罩 |
| 新发现按动作 | fix 3（-02 部分、-06、20261022-16 余项、M3）/ remove 0 / skill 6（-01、-02 部分、-03、-04、-05、20261022-13 复发）/ authority 1（20261022-10 复发）/ measure 2（-03 溢出、-07）/ none 1（轮询） |
| 复发项 | 20261022-10（停止规则从未触发）；20261022-13（输入时钟只覆盖决策 K 线）；20261022-11 成本上升（每版本 12.1M）；M3 输出 1.24 MB |
| 用户先发现 | 2：20261023-05（用户问 “#253 是 lane 吗”）；20261023-02（用户引用 12 小时前已被遮罩的 entryvar 数字追问） |
| skill 体积 | 全部文件空白分词，对比 33bc935：research-round 5522（5594，−72）、product-doctor 1805（1754，+51，#1638 路由说明）、research-start 1281（1360，−79）、nautilus-report-analysis 1531（1554，−23）、research-sources 1925、video-evidence 5969 不变。本轮不改 skill |

## 范围与证据

时间线位于 `/tmp/doctor-01a163c6/`（每会话一个 Markdown，`index.md` 列 55 个会话与代价），为可再生的工作副本。时间为 UTC，`#n` 为主时间线调用序号。研究线 `research-line-20261022-ema-cross-btc-daily`，窗口 2025-10-01 至 2026-10-01，用户目标最大回撤 ≤15%、年化 ≥20%。本会话 trial 63–194：46 预检、43 研究、43 复现；judgment 71–253：48 解释、65 搜索暴露、47 优先级、23 推荐；66 次源码审阅（20 失败）。

## 发现（按会话代价和复发排序）

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261022-10 | 换线规则的触发条件不可观测，从未触发 | 会话：13:38 priority 77 写“下一步走 research-start”；13:45 priority 79 撤回，理由是低于可检出差“不能证明所有未跑规则都低于”。之后 judgment 88（14:03）起 22 条推荐均保持 `ema-fixed-dailyspec@1`/trial 67，48 条解释均为区间跨零，47 条优先级均引用可检出差，无一提到换线。Agent 自拟的 Goal 目标也只写“用户叫停或研究线无法继续”。当前：`research-round/SKILL.md:44-47` 条件是“no remaining change within the line could exceed”，即对未跑的改动作全称断言，Agent 无法观测；`research-start/SKILL.md:47-50` 的 Goal 停止规则无换线一句。该文字在会话开始前已由 #1639 合入 | authority：用户 2026-10-22 批准的规则文字需改为可观测触发（例如连续若干版解释低于可检出差且推荐不变即经 research-start 回问用户），并在 Goal 停止规则中写入换线；属修改用户已批规则，待用户定 | 实测：推荐冻结后 11.6 h、主会话 327M token、41 个研究版本未改变推荐 | recurred |
| 20261023-01 | 活动 Goal 下向用户提的问题被自动续跑吞掉 | 会话：13:39:11.841 Agent 以“扩窗起点选固定版还是条件数量版？”结束轮次，15 ms 后 Goal 续跑；13:45:18 再次续跑；13:45:39 Agent 自行撤回提问（priority 80），随后单轮从 13:45 跑到 01:20 无用户轮。00:59 Goal 变为 paused，Agent 又工作约 20 分钟，01:20 称“授权已收到”，转录中无对应用户消息（暂停发起者未核实）。当前：research-start “Offer lines and wait” 要求等待，但两 skill 均未说明活动 Goal 下如何提问；会话所见 Goal 工具只有 `create_goal`/`get_goal` | skill：活动 Goal 下只问阻塞工作的问题，且先让 Goal 停在等待（宿主不能暂停时说明须由用户暂停）；非阻塞问题不问，在权限内自定并一句告知；不得声称未出现的授权 | 用户的扩窗选择从未被回答；12 h 研究在旧窗口上进行（是否为用户所愿未知） | open |
| 20261023-02 | 已向用户展示、后被遮罩的数字未撤回；status 比较只给遮罩计数 | 会话：13:39 报告表列 `ema-entryvar@1` 22.29%/8.47%/1.73/1.96（当时有效）；13:57 追加审阅 `source-review-8-5ec23e0e7bfa3de1` 判 causal failed，13:58 只说“19 个旧运行转为诊断”，未点名 entryvar，也未撤回待选项；01:49 用户引用该行追问，01:43 首答笼统，01:50 才更正。当前：`replay report` 清空并给原因（`report/runs.py:107-115`），`hypothesis compare` 拒读（`report/comparison.py:343`），表现正确；但 `research status` 比较表静默剔除遮罩运行，只给 `diagnostic_only_research_runs` 计数（`report/status.py:262`）；`replay report --at <旧提交>` 按旧提交的审阅读出未遮罩数字且不提示 head 已遮罩（`report/runs.py:118-121`，仅代码推断）；`SKILL.md:58-60` 的“原件与更正同列”只管账本记录 | fix（读时计算，不加字段）：status 列出被剔除的 trial 及原因；`--at` 报告在 head 可用性不同时加一句局限。skill：用户已看到的读数失去资格时，在下一次报告中点名撤回 | 用户基于失效数字形成偏好；一次错误回答 | open |
| 20261022-13 | 因果规则只管决策 K 线，订单的其他输入（定量、最小名义金额价）不受约束 | 会话：20 次 causal 失败全部继承自根 `ema-cross-root@2`：每根 bar 都 `self.price = bar.close`，最小名义检查读当分钟收盘并在同一回调提交；首轮审阅对其中 19 份源码判 causal 通过；修复（只用完成日线缓存规格价）后约 40 次审阅 0 失败。当前：`strategy-authoring.md:78-80` 只要求成交晚于决策 K 线收盘；`cli/main.py:467-480` 骨架 `order_quantity(quantity, price=None)` 收价格而无时钟说明 | skill：改为“订单使用的每个输入（信号、数量、门槛价）都来自严格早于提交的事件”，骨架 docstring 同句 | 19 个旧运行作废；最初策略本身也被遮罩 | recurred |
| 20261023-03 | 推荐正文逐版重抄全表，逼近列上限；按单次运行写推荐 | 会话：23 条推荐中 16 条紧跟单次运行；正文 3.9 KB（j88）→ 54.4 KB（j253），j253 与 j234 约 83% 字符重合，由文本替换上一份加追加生成。当前：`ledger sql` 实测最大推荐体 54,387 字节，`judgment.body` 为 `TEXT`（`ledger/schema.sql:187`，上限 65,535 字节），`ledger/judgments.py` 无长度检查；`review.md:8-9` 已说单次运行不需要新推荐，`review.md:15-17` 要求“names every candidate … and weighs …” 驱动全量重抄 | skill：推荐只权衡变化的候选，其余引用比较表与上一推荐；measure：TEXT 溢出时 Dolt 的行为（截断或拒绝） | 实测推荐相关 152 次响应约 28.9M；约两条推荐后可能溢出（未验证行为） | open |
| M3 | `research state` 输出 1.24 MB，已不能直接阅读 | 实测：当前 1,238,773 字节（紧凑 918 KB，解释 428 KB、搜索暴露 294 KB、facts 105 KB、推荐 83 KB），会话起点 322 KB；一次调用截断前 267,054 token；62 次调用中 7 次直读被截断，01:43 回答用户时正因截断只读到推荐正文 | fix：默认输出摘要（gates、未解释 trial、当前推荐与优先级的 id 与头部），完整内容放选项 | 实测 research state 读入约 15.3M（估算的上下文膨胀） | open（已测，待改默认） |
| 20261023-04 | “独立”原生核查代理跨 52 版复用 | 会话：`trial61_native_check`（Leibniz）经 53 次 `followup_task` 复用 11.8 h，552 次响应，中位上下文 159K，93.7M token（全部 18%）。当前：`nautilus-report-analysis/SKILL.md:22-24` 只要求“second agent”复算，未要求每次 fresh；独立性受损未证明 | skill：每次复算用 fresh 代理，只给原件路径；与 20261022-11 的“复现只在决策需要时做”合并考虑 | 实测 Leibniz 每版本 2.1M；预期 fresh 每版本约 0.5–1M（估算） | open |
| 20261022-11 | 每版本成本上升 | 实测：每版本中位 14.9 分钟、平均 12.1M token（主 8.1M、核查 2.1M、审阅 1.9M），高于上次记录的 5–8M；43/43 研究运行无条件全窗口复现 | skill + measure（原动作不变，叠加 -04） | 见上 | open |
| 20261023-05 | 向用户使用裸 “#N” 指称账本对象 | 会话：01:20:29 “最新推荐为 #253”；01:40 用户问“#253 是 lane 253 吗”；01:41 Agent 解释为 judgment_id。当前：skill 只有 `SKILL.md:55` “Cite objects by bundle, trial or registration and ledger commit”（针对账本正文），无面向用户的命名；本仓库 “#N” 通常指 PR 或 lane | skill：对用户称呼对象时写类型加产品 id（“推荐 judgment 253”“trial 67”“ema-fixed-dailyspec@1”） | 一次用户澄清往返 | open |
| 20261022-16 | 写入效果未在消费者读的 help 上说明（余项） | 当前：“记录 explore trial” 只在 `replay --help` 子命令列表（`cli/main.py:1106-1107`）；`replay reproduce --help` 结语只讲暴露（`cli/main.py:1112`），`replay explore --help` 不说写 trial（`replay/entry.py:345-346`），`source review --help` 不说失败会遮罩旧运行；`design-code-cli.mdx:6` 称每个命令的 `--help` 写明写入，实际约 21 个动词中 10 个有结语 | fix（help 文字） | 无直接损失；会话中 help 读 71 次 | open（其余已随 #1639/#1640 合入） |
| 20261023-06 | 设计站与 eval 未跟上 #1639/#1641 | 当前：`docs/rd/design-skill-research-round.zh.mdx:35`（A-2-2-1）与 `:43`（J-1-2-2）仍把已移入 AGENTS.md 的规则记为 skill 规则，eval `own-sizing-not-user-constraint`、`no-strategy-in-git` 仍写“with the skill”（eval 沙箱是否加载 AGENTS.md 未核实）；#1641 新的“继续或换线”单问无 eval，`evals/research-start/start-sets-goal` 仍期待直接 `create_goal` | fix | 无会话损失 | open |
| 20261023-07 | 压缩后反复重读 skill 与 help | 估算：171 次读 18 个 skill 文件，每个压缩段 10–16 次，约 33M 上下文；help 71 次约 7.8M；14 次压缩约每 50 分钟一次。成因为压缩丢掉已读文本，属宿主行为；可降成本的是两个约 10 KB 的参考文件 | measure：先测缩短 `duty-directory.md`、`strategy-authoring.md` 是否影响研究质量 | 估算，未证实 | open |
| — | 等待子代理的超时轮询 | 实测：127 次 `wait_agent` 中 83 次超时（10–30 s 超时对约 3.5 分钟的审阅），98 次空响应 16.6M（主会话 4.7%）。无产品成因 | none（Agent/宿主行为） | 16.6M | — |

`docs/plans/doctor/index.zh.md` 中 20261022-09、-11、-12、-13、-15、-16、-17 的“本地已改，未合并”已过期：均已随 #1639 / c20890092 合入（-16 部分由 #1640 / 0ff1191d6 转入 help）。契约子代理沿消费者核对：-09、-12、-15、-17 已修；-10、-13 复发如上；-11、-16 余项如上。

账本一致性：132 个 trial 同一镜像摘要；每个研究 trial 都有同源预检与复现；登记、bundle、trial 均 43；无孤立 blob、无重复源码原件。预检 135、154、182 无运行，各属被 rev2 取代的 rev1，更正在证据 bundle 中，符合只追加更正。`dolt-backups/research/backup` 文件最后修改为 11:19Z（会话开始前），会话 683 次提交大概率未进备份（head 未核实）；用户 2026-10-22 已决定暂不加备份新鲜度检查（20261022-14 rejected），此处只记事实。

## 删减清单

| 机制 | 防的风险 | 谁覆盖 | 会话所见 | 建议 |
|---|---|---|---|---|
| 读时遮罩（同源码与镜像的失败审阅作用于所有运行） | 因果失败运行的经济读数被采用 | 唯一 | 遮罩 19 个旧运行，正确 | 保留 |
| `hypothesis compare` 对无资格运行拒读 | 以失效对照做比较 | 唯一 | 对 trial 6 的比较被拒，有用 | 保留 |
| 独立源码审阅 | 策略源码时钟、定量、保护错误 | 唯一 | 抓到 20 次 causal 失败；首轮漏 19 次（规则过窄，见 20261022-13） | 保留，补规则 |
| 推荐须点名比较表全部候选（`ledger/judgments.py:99-105`） | 推荐漏看候选 | subjects 已列出，无需正文重抄 | 驱动正文膨胀 | 保留检查；正文要求改为只权衡变化（skill，见 -03） |
| 推荐无效候选的硬拒绝 | — | `review.md:17` 文字 | 未发生 | 不加（属新增拒绝，需授权且无已证失败） |
| 每研究运行无条件复现 | 封存读数不可复现 | 指纹与语义比较 | 43/43 通过，未见改变决策 | 见 20261022-11，先测再定 |

## 决定

本轮无用户决定。待用户裁定：20261022-10 的停止规则改写（authority）。
