# 大重构覆盖核对（2026-11-11）

问题（用户 11-11）：之前记录过的所有问题、遇到过的所有断点、所有 doctor 发现的问题，这次重构都覆盖到了吗？

做法：三个只读子代理分别逐条核对，对照 origin/main（48a630a3c）和三个草稿（#2599 2884057c8、#2587 c58b76f43、#2595 40f020fbc）。主会话抽查了其中的缺口判断。

| 来源 | 条数 | 已修/已覆盖/已接受/不相关 | 计划了没做 | 缺口 | 回归风险 |
|---|---|---|---|---|---|
| doctor 索引全部行 | 423 | 372 | （计入覆盖） | 47 | 4 |
| `docs/plans/` 全部计划文档（105 份 + 6 份未跟踪） | 465 | 292 | 120 | 53 | — |
| 记忆、CI 失败（11-07..11-11 共 6000 次运行）、代码标记 | 111 | 76 | 13 | 22 | 若干 |

三份有大量重复，去重后约 **95 个缺口**、**4 个回归风险**。下面按「谁来做」分组，每项后面括号是来源编号。明细表在子代理的输出里（`coverage/doctor.md`、`plans.md`、`memory-ci-code.md`），本文是合并后的结论。

结论：重构解决了表结构、冗余字段、字段名、按存储布局造成的慢、换镜像要搬运行（A4）这几类问题。还没盖住的主要有五块：
- 执行路径 R2–R5（Live 持续运行、Paper 资金费与审计、共享对账）：设计有，但没有分支、负责人和阶段。
- 第 4 阶段的技能与设计站重写：漏列了若干项。
- 一批跟重构无关、在 main 上一直挂着的缺陷和 CI 问题。
- 备份与恢复。
- 发布卫生：许可证、版本、安全头。

## 1. 需要用户决定或授权

**用户 2026-11-11 回答「全按建议」：U1–U16 全部按下表「建议」列执行。** 其中的拒绝和审计改动（U2 备份陈旧报问题、U3 缺资金费拒绝、U4 按合约放宽、U6 预检读 Catalog、U8 拆码）就此授权，只覆盖表里写的这几处。去向：U2/U4/U5/U8/U10 → L5（#2599/#2587）；U3/U6/U9 → R1（#2595）；U7 → 第 4 阶段；U11–U13、U15、U16 → doctor 索引标为接受（ci-hygiene 会话）；U1、U13 文字、U14 → 新会话；U2 的恢复演练 → 新机部署后。

| # | 事项 | 现在 | 建议 |
|---|---|---|---|
| U1 | 许可证与 Binance 数据署名（-102、-103） | 仓库公开却没有 LICENSE；Binance Vision 数据条款是 CC BY-NC-SA，公开账本里有派生读数，却没有任何署名 | 代码用 MIT；README 和账本说明加 Binance 数据署名，并写明公开读数按 CC BY-NC-SA 4.0；Supply 字体核实许可，不行就换 |
| U2 | 备份自动同步与陈旧告警（20261022-14、-114、ledger-compose §4.8、live-release §9） | 备份只在手动 `ledger export --kind backup` 时同步；`ledger review` 对落后的备份仍报 ok（11-07 落后 8103 个提交）；Paper 库、原生原件、Live 根没有定期备份，也从未演练恢复 | 收线（`line_close`）时自动同步备份；`ledger review` 对落后的备份报问题（属于收紧审计，要授权）；新机部署后给账本、Paper、Live 根各做一次恢复演练 |
| U3 | 资金费文件缺失（-116） | 某月 `funding/` 丢失时，回放直接不结算资金费，不报错 | 收紧：回放窗口里有 K 线的月份缺 funding 文件就拒绝 |
| U4 | SOURCE_ALREADY_EXPOSED 不分合约（20261105-38） | 在 BTC 上跑过的源码不能在其他合约上正式重跑；用户 11-05 说过「只做 BTC 是产品缺口」 | 放宽：同一源码、同一合约才算已暴露 |
| U5 | AGENTS.md 对复现暴露的措辞（20261105-15） | AGENTS.md:42-43 说复现算暴露，`changes.md:18` 说不算 | 改成「复现结果一致，不算新的暴露」 |
| U6 | 开试验前先读一次 Catalog（20261028-11） | 预检 `--describe` 挂载了输入却不读，读失败要等试验开了才发现 | 加：预检读一遍 Catalog（新增拒绝） |
| U7 | 盲审（20261021-07） | 审阅者拿到费用等经济字段，盲审不是产品规则；曾因此作废约 20 个审阅 | 做：research-round 交给审阅者的缓存去掉经济字段（技能规则） |
| U8 | REPRODUCTION_MISMATCH 一码三用（20261105-14） | 镜像不同、配置不同、结果不同都报这一个码 | 拆成三个码（属于拒绝改动，要授权） |
| U9 | Paper 跨月成员资格、长时间 Paper（-119、paper-trading §3、forward-observation §3.2） | 成员资格只在开跑时读一次，一个月后就不再开仓；续跑只能在当天 UTC 内 | 运行中的 Paper 每月初重读成员；离开成员的合约只平不开。长 Paper 就靠这条规则成立，「Paper 即验证」（#2549）照旧延后 |
| U10 | 分层迁移 P5（20261107-113） | P5 定了「按 L10 分层迁移」，但没有机制；#2599 的 `schema.sql:2` 写的是「以后改 schema 就是新账本」，两者矛盾 | P5 落成两条：读数层靠 reseal 重算；承诺层只加列、不改不删。写进 schema 文档，并替换 `schema.sql:2` |
| U11 | 跨线研究经验（-30、未跟踪草稿 `cross-line-research-experience`） | 与 research-round「Offer no other line」冲突，也没有批准 | 由 fusion §3 的 Agent 侧借鉴路径取代；草稿归档，-30 关闭 |
| U12 | Docker 代理的符号链接竞态（记忆 go_docker_api_proxy） | 只在启动时检查绑定挂载；现在部署给 GitHub team 里的几个人用 | 接受（团队成员都受信任）并记录；以后开放给不受信任的策略作者时再上 rootless |
| U13 | CD 硬编码作者身份（-118） | `release_host.py:19-22`、`release-ready.cjs` 写死了 qOeOp/ghcr.io/qoeop | 标明「只供作者部署」并记录，不做通用化 |
| U14 | 失败告警（-120） | Live 有 Telegram；Paper 中断、发布失败、publish_failed 没有任何通知 | 复用 Telegram 通道推送这三类 |
| U15 | bookTicker 参考报价核对（提案全文） | 从未决定；现在由 Agent 自己记录读数，提案认为这等于自评 | 不做（约 300 GB 原件，且不用付费数据），记为接受 |
| U16 | 未纳入任何阶段的度量项：上下文成本（20261025-18、20261023-07）、拉镜像挂起 300 s（20261020-39）、预检到不了出场逻辑（-40）、更正与原文的关联（20261021-23）、九项职责没有映射（-25）、四角合并（-28）、重试换镜像分支（20261029-14）、人工查账本（20261031-16）、跨线多重检验计数和季度稳定性报告（line-close §5） | 都没排进计划 | 统一记为「复发时再测」，doctor 索引里标成接受 |

## 2. 已有负责人的分支：补进去的事项

### L5 / #2599（账本、研究、Paper 库）

| 事项 | 来源 |
|---|---|
| **#2599 的 skill-names 检查现在是红的**：`nautilus-report-analysis/SKILL.md:8`、`research-round/templates/report.md:4`、`research-round/SKILL.md:41` 和 eval 还在用已删除的 `--hypothesis`、`--bundle` | CI 42931426877；doctor 20261020-14（回归） |
| rebase 到 main 时保留 #2600 的 `--leverage` 恢复（`replay/reproduce.py:52-77` 现在没有） | 计划 X8 |
| 收线历史测试余下部分：§3.3–3.5 全流程，加上冻结与拒绝（用户 11-11 选 B，代码里还没有）、`research history`、多年目标读数、热图 | A2、line-close |
| N1 `market_commit`→`market_day`、N2 profile 的 kind/role、C1 `LEGACY`、C2 `commit_of`、X10 `exporter_source_sha256` 和回执 `scope`：都已授权，但没有任何分支在做 | 重构 C1/C2/N1/N2、schema X10 |
| C10/B3：跨合约复现要求配置全等（`reproduction.py` 的 `shared_equal`） | 重构 B3 |
| reseal 命令、L11 读路径（默认只看开着的线、E1–E5）、切换后的规模测试 E7 | C3、E 段 |
| `input_identity.membership` 与成员文件重复；`research_line.market_day` 留不留 | store-once L112、schema §7 |
| 分批平仓：一个周期只记最后一张平仓单（`closing_order_tag`），现在已允许多仓位，触发条件已满足 | report-storage §审阅 L36 |
| 清理代码里 7 处 Dolt 2.4.2 注释；AGENTS.md「computed once at sealing」改写（B7） | 重构 L8、B7 |
| CF-04、CF-12、CF-18（已转） | codex-flow-review |
| #2587：Paper 容器挂载了整个 `service.json`（含 root），收窄到只给 Paper 自己的账号；remote README:259 已过时 | paper-compose §5.3、ide-reads-ledger §3.4 |
| #2587：Paper 对账按合约、方向、角色、时间配对，同方向并发的计划会配错，改为按入场顺序配对（若并入 R3.2 就写进 R3.2） | fusion §4.2 第 7 项 |

### R1 / #2595（v8 契约、镜像）

| 事项 | 来源 |
|---|---|
| 拆分回放与执行镜像，并补齐：主机清理覆盖执行镜像（E8）、**GHCR 保留规则加上执行镜像包**、R2 证据镜像的规则按拆分后重写 | replay-image、ghcr-image-retention |
| **镜像工作流路径回归**：main 的 push 路径又加回 `.github/actions/ci-paths/**`、`pyproject.toml`、`.dockerignore` 等，只改 CI 或工具的提交会让 `main` 摘要变动；拆镜像时按闭包测试收紧 | doctor 20261107-02（回归） |
| `release-ready.cjs` 往回找时碰到只有 `backtest/runtime/Dockerfile` 的旧提交会抛错而不是跳过（11-10 main 上 5 次）；#2595 也没改它 | CI 42780156575 等 |
| N3：`runtime-failure-v2`、`live-run-v7`、`summary@1`/`lineage@2` 等版本后缀；C4：`fill_volumes` 改成必填；C5：镜像不再输出 `by_utc_day` | 重构 N3/C4/C5 |
| 价格刻度按窗口放宽（`price_precision_widened`）：同一策略和数据，窗口终点不同就给出不同价格。当时说等改导出时再修，现在就是这个时候 | trust-boundary-deferred §价格刻度 |
| 确定性：镜像固定 `PYTHONHASHSEED`；对 bracket、OCO、限价、部分成交、退市、多计划各做一次进程间双跑；一次 arm64/amd64 成对回放 | report-storage §审阅 L24、determinism L18 |
| `skill_heat.py:116` 文档字符串里还是 `DAILY_WARMUP` | 代码标记 |

## 3. 第 4 阶段（技能、eval、设计站、文档）要补的清单

重构 §6 已列的照旧（C9 文本、模板名单、participation、research-start/readiness、eval 里的 `@N`、88 个 skill-fired 评分器、C5 弱 eval、设计站 118 处标记等）。下面是**漏列**的：

- fusion 的技能段落和至少 2 个 eval（§S 没写 fusion）；收线「不选窗口」的技能文本。
- `strategy-authoring.md:181` 仍写「同一合约上的计划不重叠」，与 #2588 矛盾。
- 恢复 c20890092 加的 price_pnl 取整说明，#2186 把它删了（doctor 20261022-12，回归）。
- doctor 技能缺口：20261105-02（`.pyi` 存根、`rg -uu`）、-04（worktree 里 compose 命令失败）、-05（市场写入走 market-import 容器）、-17、20261101-05（换路线的提问要写目标与可检出年差）、20261031-14（引用要支撑改动）、20261023-03（首次推荐要权衡全部候选）、20261025-06（Codex Goal 下怎么提问）、`changes.md:21` 按消息读 REPRODUCTION_MISMATCH。
- 文案残留：设计站 `strategy-runtime`（-08、-10）、`comparison.zh.mdx:125`、Dolt 市场旧说法（-07）、`binance-live.zh.md:56`。
- 计划文档：
  - `paper-trading-design` 过时；`paper-run-storage-decision` 已被 #2587 取代。
  - `research-graph-design-spec` 头部仍是「草案」，其中概览条已被 `useAxisView` 取代。
  - 重构 §6 L363 错写 20261022-14、-121 会随新账本消失。
  - 重构 §7 的服务器过渡段还是旧主机写法。
  - schema §5/§7 写 `ledger review` 跑 DOLT_VERIFY_CONSTRAINTS，实际是走 information_schema。
- U7 盲审：research-round 交给审阅者的缓存去掉经济字段。
- 要保留，不要删：research-start 的 Goal 段、`readiness.md` 第 4 部分、`capital.md:23-27`。
- eval 复核：`root-repair-stays-root` 失败原因不明；`validation-input-runtime-change` 只查过结构、从未评过分；`reads-through-tables` 第 3、4、6 题。
- doctor 索引：6 行实际已修却标着 open（20261107-117、-123、-125、-130、-137，20261106-03），还有 -120（Telegram 已做）。

## 4. 现在就能在 main 上修的独立问题（不碍草稿）

| # | 事项 | 来源 |
|---|---|---|
| M1 | **Live 撤单缺陷**：`engine/live_session.py:200-204` 撤单结果未知时按方向 `cancel_all_orders`。#2588 之后，BUY 方向上可能挂着空头仓位的 BUY 减仓止损，会被一起撤掉，仓位失去保护 | hedge-implementation L136-139 |
| M2 | `.gitignore` 加 `.claude/launch.json`、`.codex/`、`.review-shots/`：这三个文件让每个 checkout 都变脏，干净检查会挡住回放 | doctor 20261026-05 |
| M3 | CI：`npm ci` 从 nuget 拉 `onnxruntime-node` 超时，quality 和 ide-web 都会因此失败（6 次） | CI |
| M4 | CI：`dolt version` 检查不带 `DOLT_ROOT_PATH`，又丢掉 stderr，偶发拒绝二进制（3 次）；和 B2 的 `dolt config --global` 竞态一起修 | CI、B2 |
| M5 | docs-pages 按提交分并发组，会与并行部署冲突；改成按 ref | CI |
| M6 | 发布日志只有「unclassified runtime failure」，真实异常要手动包一层才看得到 | 记忆 server_residue |
| M7 | 19 个运维选项没有帮助文本（ledger mirror、paper serve、live web-command/preflight/release） | doctor 20261020-28（回归） |
| M8 | IDE：Agent 改 baseURL 后沿用已存的 key，key 可以被转发到任意地址（安全） | -126 |
| M9 | IDE：Paper 单击直接启动没有确认；四处空态和离线文案写错；⌘ 键写死；Market 对比度；状态栏 `market …0000` 和 Dolt 市场旧说法；推荐「Unchanged for N」的门槛不显示；测度显示原始字段名 | -132、-133、-134、20261105-06、20261031-09、-15 |
| M10 | compose `start_period: 6h` 要么重新论证，要么调低 | -138 |
| M11 | 发布卫生：版本 tag/release、changelog、回滚手册、IDE 显示版本；SECURITY.md、Caddy 的 CSP/HSTS、CodeQL、镜像扫描或 SBOM；用户手册、FAQ、排障页；全新安装 E2E | -112、-128、-135、-136 |

## 5. 执行路径 R2–R5（有设计，没有分支和负责人）

不改账本结构，可以排在切换之后，但要在新版本给 Live 用之前做完。计划文档里的条目归到这里：

- **R2** Live 运行声明的镜像；preflight 要求同源码、同镜像、同契约有已封存的回放；删除 Live 专用的改写源码（`rewritten`、`origin_candidate`）；D5 删除运维 CLI 的 `--credentials-file` 路径；按钱包规模回放 Live 版本。
- **R3.2** Paper 与 Live 共用对账和归因：成交配对、流动性方向（第二次部分 LIMIT 成交是 MAKER 还是 TAKER）、`sync_reduce_only_orders` 与 Binance 的行为差异（先做原生探针）、按账户等级的费率。
- **R4** Paper 用推送的资金费率结算、去掉固定 100 ms 持有、封存时做 Paper 审计。
- **R5 Live 持续运行**：
  - 去掉 24 h 上限，处理断线和重启；15% 刹车；预算 = 钱包 × 85%；定期核对时钟和 key；IP 白名单。
  - Redis AOF 不重写、内存缓存不清理；合约离开 TRADING 或交易所维护时的处理。
  - `live/views.py` 的 16 MB、1442 分钟、200 行上限会被永不结束的运行撑破；推送流每次都带整条分钟权益（IDE 和 Telegram 会一起坏）；`events.jsonl` 不轮转（E9）。
  - 撤单丢失后成交无止损（#2273）；保留原生 INFO 命令日志；解释启动时「incomplete bounded reconciliation」警告；共享腿的对冲反例原生探针；新控制进程接管正在跑的 runner。
  - Live 多合约（fusion §5.2）。

## 6. 切换后和部署后的验收与实测

- 重构 §7 全研究链验收、规模测试；在 v8 上重跑验证绑定演练（含公共 TSA）；收线全流程耗时。
- 新机：IDE 首次运行端到端（CI 镜像、gen-1 schema、没有账本时的 `ide/agent`）；带持仓的 Paper 续跑；amd64 上有交易的长时间 Paper 内存实测（准入公式）；全池报价回放的资源实测；带下单策略的池年回放内存（48 GB 那次至今没解释）；Web 预热时 runner 的延迟；E9 增速；E10 残留核对。
- 断线后 Nautilus 会不会补 bar（原生探针）；Binance 2026-10-28 归档是否仍缺。
- 用户自己做：真实账户 Live 验收（另给范围）、用自己的模型 key 跑一次 Agent、跨线运行读取的原问题重问。

## 7. 本次核对顺带发现、主会话要改的

- 记忆 `user_authorization_line_close_freeze` 写「L5 已在 #2599 实现」，实际还没做。
- 记忆「验证 1–2 在 2027-05-12 到期」已随旧账本作废。
