# 2026-11-07 发布就绪审计

| Item | Value |
|---|---|
| Sessions | 无被审研究会话。用户在本会话要求按“发布版”看各个切面，点名数据库设置、新用户注册和指引、DoltHub、服务器配置、从研究扩展到 paper 和 live |
| Audit session | Claude Code（桌面应用），claude-opus-5-5；worktree `.claude/worktrees/release-readiness-2026-11-07`，分支 `doctor/release-readiness-2026-11-07`；本会话未开 PR |
| Checkout / ledger | 工作流审计 origin/main b8696a8ae；写记录前复核到 e60fbfc0f（多 #2231、#2232，本文锚点按它）。账本只读，head `ic7kgug8h6rrad7r90780ud1p720d34d`，与公开 DoltHub 同一提交 |
| Coverage | 五个只读子代理：新用户实走（Behavior and decision evidence 的替代，无会话）、Data and usage cost、Product contracts and delivery（发布工程、法务、安全、文档）、Human use（IDE，含空状态实测）、服务器与 paper/live 路径。 **未覆盖**：真实 VPS、ACME 和 GitHub 回调、带 key 的完整 compose 启动、真实 DoltHub 推送和私有库、受限地区网络、真实交易所连接（按边界没做）、Codex/Claude 新用户真实会话、全量市场构建、#2231 新增的 `deploy/paper_host.py`、`paper/release.py` 只核对了 README 和写死的身份、法律结论 |
| Cost | 无研究时间可拆。审计：子代理合计 1,535,783 tokens，串行 4,459 s，并行约 22 分钟；主会话 tokens 未测。产品造成的无效 trial：无 |
| Net change | 拒绝码 254（上份带计数的记录 257）；skill 词数 26,365（`find .agents/skills -name '*.md' \| xargs cat \| wc -w`；上份 27,732）。提议减：默认 origin、README/env 示例里的作者身份、发布版中的 Live 和 CD、`start_period: 6h`、`LIVE_*` 的 150 死条件。提议增：research-start 无账本分支（估 +150 词）、IDE 外壳状态与错误边界、一个失败 webhook、版本 tag。增长的理由：这些路径现在不存在，已有机制覆盖不到；已尽量用现有命令和拒绝的 `next_actions`，不新增向导和 CLI 名词 |

结论：`README.md` 的 CLI 路径在隔离环境里能从空账本走到封存运行，约 1 分钟（2 合约 2 个月，Docker 和镜像已就绪）；但文档不会把人带到那里。当前产品是作者的单人部署，还不是发布版。

子代理的 1227 trials 读数未复现：本地与公开 DoltHub 都是 2358，本文用 2358。

## Findings

按阻断发布的程度排序。“实测”指本次运行过；其余为读码。

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261107-01 | **产品形态未定**：全部规则按一个受信操作者写，没有定义“发布版”给谁 | `AGENTS.md:7-27` 的 “the user”；`deploy/remote/README.md` 限定 trusted operator；`oauth2-proxy.cfg` `pass_user_headers=false`。用户先提，Product contracts and delivery 以前按个人工具看，没有问过 | authority | unknown | open |
| 20261107-02 | **无许可**：仓库和 3 个 GHCR 镜像公开，却没有 LICENSE；镜像带 LGPL 的 Nautilus、三选一许可的 Redis 8（`engine/runtime/Dockerfile:2,7`）、Dolt，无第三方清单；`ide/web/fonts/Supply-*.otf` 自称保留所有权利，目录无授权文件 | `gh repo view` license null（实测）；`.github/workflows/ide-image.yml:143-144` 关 SBOM。授权范围未读到（官方页 404/429），义务需律师 | authority + fix | unknown | open |
| 20261107-03 | **Binance Vision 数据条款与产品用途有冲突**：v1.0（2026-08-26）用 CC BY-NC-SA，把模型和衍生指标也纳入，只把纯个人非生产回测列为许可用途，禁止实盘自营执行、托管、并入商业交易工具，并要求衍生物署名和同协议。产品无署名，账本公开日收益和指标，服务器托管该数据，`live` 在主线 | https://raw.githubusercontent.com/binance/binance-public-data/master/TERMS_AND_CONDITIONS.md §2.4、3.1、4.1–4.5（本会话已读）；`deploy/README.md` 数据来源；全仓无署名（rg）。作者自用的 Live 也可能涉及；是否适用需律师 | authority | unknown | open |
| 20261107-04 | **无投资和风险声明，`live start` 无确认步骤** | rg README、站点、IDE 无相关词；`cli/main.py` live 段；上游 Nautilus 有声明 | fix | unknown | open |
| 20261107-05 | **默认值是作者身份**：不设变量时克隆作者账本并把它当发布目标；README 发布示例和 `env.example` 也是作者的 | `deploy/compose.yaml:72`、`deploy/remote/compose.yaml:32`、`README.md:122`、`deploy/remote/env.example:2-3`；`TRADE_RESEARCH_ORIGIN` 不在任何 README（实测 rg）。匿名克隆实测 27 s、623 MB，得到 2358 个作者 trial；别人 key 推送失败未实测 | remove（改 `:?` 必填，示例改占位符） | unknown | open |
| 20261107-06 | **没有“自己的账本”路径**：compose 只能克隆，空仓库 `BOOTSTRAP_FAILED`；公开库克隆也要 DoltHub key；根 README 的 `ledger init` 和 deploy 的 bootstrap 互斥，先做前者 `BOOTSTRAP_REFUSED`，且两处都没说选哪条 | `cli/service.py:147,153`（实测 compose 6 s 退出，原因只在 logs）；`README.md:57-61`；`deploy/README.md:17-21`。用户先提 | fix（写通一条路径）；放开 key 是 authority | hours（估计） | open |
| 20261107-07 | **前置和成本没写**：Dolt 2.4.2、Docker 不在 README；无内存、磁盘、时长要求；`up` 后 5 分钟自动按作者 30 个合约全量导入；下载量文档互相矛盾（100 GB 对 154–231 GB），全量从未跑过；Binance 地域限制未写，`exchangeInfo` 是 import 必需 | `README.md:14`；`deploy/compose.yaml:105-115`；`deploy/README.md:62-64`；`docs/plans/monthly-market-import.zh.md:107`；实测市场 81 GB、账本卷 2.09 GB、内存 1.4–1.8 GiB | fix + measure | unknown | open |
| 20261107-08 | **没有首次引导**：无 quickstart；research-start 第一步在无账本时报 `LEDGER_UNKNOWN`，skill 没有这个分支；README 不说对 Agent 说什么 | `.agents/skills/research-start/SKILL.md:23`（rg 无空账本分支）；CLI 无 setup（实测 help）。用户先提。补救：skill 分支加 README 一页，现有命令够用，先不加新 CLI | skill | unknown | open |
| 20261107-09 | **修复出口是错的**：缺 docker 抛栈；zip 无 git 抛栈；`LEDGER_UNKNOWN` 让跑同样报 `LEDGER_UNKNOWN` 的命令；`MARKET_EMPTY` 不提 `market import` | `runtime/image.py:114`、`ledger/metrics.py:706`、`ledger/refusals.py:29-30`（均实测） | fix | minutes | open |
| 20261107-10 | **DoltHub 设置一次错就卡死**：`set_remote` 在推送前落 remote，改不了（`REMOTE_MISMATCH`，无改的命令）；`DOLTHUB_CREDENTIALS` 不说放哪；`PUBLISH_FAILED` 在 compose 下让跑会被拒的命令；轮换无文档 | `ledger/publish.py:136-148`（`file://` 实测）；`ledger/refusals.py:496`。用户先提 | fix | minutes | open |
| 20261107-11 | **公开前提几乎没有告知**：写一次后每次写入自动公开完整策略源码、结果和判断，历史删不掉，skill 不提；无私有模式；公开账本有 1 条真实本机路径（`evidence_content`）、约 4,600 条临时路径 | `README.md:116`；`ledger/publish.py`；`cli/replica.py:29-34` 只接受公开 DoltHub；只读计数（实测）。公开本身是 10-25 用户决定，这里只说新用户的知情 | skill；私有模式是 authority | unknown | open |
| 20261107-12 | **无版本**：只有 `:main` 浮动和 `:sha-*`；无 tag、release、changelog、`--version`；无回滚手册；IDE 不显示版本 | `deploy/compose.yaml:17,27`、`runtime/image.py:46-47`；`gh release list` 空（实测）；`pyproject.toml:3` 未被读 | fix | unknown | open |
| 20261107-13 | **账本 schema 没有迁移**：`SCHEMA_MISMATCH` 的修复是重建；`ledger upgrade` 不改列和版本。外部用户一次代际变更就断研究连续性 | `ledger/db.py:42-43,634,852-883`；`README.md:49-55`、`85-92`。与用户 11-05 “不重写账本”不冲突，这里问的是发布后的规则 | authority | unknown | open |
| 20261107-14 | **没有恢复路径**：CLI 无 restore，丢卷后 `BOOTSTRAP_REFUSED` 或 `SERVICE_CHECK_FAILED`；active 的 DoltHub bootstrap 无演练记录；remote paper 库和原生原件的 separate backup 只有一句文档；Agent 卷、Live 私有目录同样无 | `cli/service.py:147`；`deploy/remote/README.md`；`rg backup deploy/remote` 只有挂载。备份滞后见 20261022-14 | fix（写 runbook，隔离演练一次） | unknown | open |
| 20261107-15 | **发布失败不留状态**：`publish_failed` 只在当次 JSON，`ledger review`、`research status`、IDE 都不显示；DoltHub 实际是唯一新鲜的异机副本 | `cli/main.py:917` 是 `unpublished` 唯一调用方（实测 rg）；当前无滞后（实测） | fix（复用 `unpublished()`，不加字段） | unknown | open |
| 20261107-16 | 单个 `funding/` 文件丢失后 replay 不结算，`market follow` 不察觉。当前 bar 与 funding 月份无缺（实测 0 缺），属潜在错误输出 | `deploy/README.md:69-71` | authority（收紧检查），或 `market coverage` 报告 | wrong output（潜在） | open |
| 20261107-17 | **服务器搭建只有一步有命令**：12 步里只有 compose 三行可抄；建目录和属主无文档；market cache “Prepare” 无命令；硬件只有“未验收”的 4C/8G | `deploy/remote/README.md`（步骤 1–5）；`rg 'mkdir\|chown'` 无。用户先提 | fix（文档 + 窄范围 `market follow` overlay，同时解决 -19） | hours（估计） | open |
| 20261107-18 | **CD 和镜像只对作者成立**：域名、数据目录写死在 `Config`，`release-ready` 只认 qoeop/trade，`install-release.sh` 依赖无产生者的 `/etc/trade/images.json`、`/opt/trade-app`，只接受 amd64；`runtime/image.py:46` 还是信任根 | `deploy/release_host.py:20,97-98,219`；`.github/scripts/release-ready.cjs:37`；`deploy/remote/install-release.sh:16-21`。不 fork 则自动部署作者 main。切流后行为未实测 | remove（发布版标“仅作者部署”并移出），确需再配置化 | unknown | open |
| 20261107-19 | **远程市场无 upkeep**：`market-import` 被 profile 关掉，月初无 members，新 paper 应报 `UNIVERSE_NOT_COVERING_WINDOW`，运行中的不得开新仓但页面仍 running；`paper reconcile` 也缺窗口数据。作者主机 12-01 可能碰到，操作者是否手工处理未知 | `deploy/remote/compose.yaml`（`market-import` profile）；`paper/runs.py:97-114`；`market/universe.py:123-125`；未跨月实跑 | fix | unknown | open |
| 20261107-20 | **出问题没有外部通道**：全仓无 webhook、邮件、Telegram；paper 中断、CD 失败、发布失败只能开页面或 journal | rg 无命中；`deploy/remote/README.md` 的 journalctl | fix（一个失败 webhook）；渠道由用户定 | unknown | open |
| 20261107-21 | **晋级没有门槛，验证链从未走过**：paper 和 live 只 `read_candidate`；`live` 还接受任意 `--strategy-file` 和自声明审查旗标。账本 546 个 run、`validation_registration` 0 行 | `paper/runs.py:204-209`、`engine/live.py:111-113`；`ledger sql` 和 `ledger review` `validations_checked: 0`（实测）。关联 20261105-34 | authority（live 门槛）；measure（首次验证） | unknown | open |
| 20261107-22 | **Live 账户槽死锁**：`preflight` 不做准入判定，不合格账户 exit 0；`start` 先预约账户槽，准入失败后 `reconcile` 报 `LIVE_RUN_MISSING`、重跑报 `LIVE_RESTART_REQUIRES_RECONCILIATION`、新 run 报 `LIVE_ACCOUNT_OWNED`，CLI 无释放命令。一次普通账户模式错误就让该 root 不可用 | `engine/live.py:765-768,781`；`live/runs.py:361,370,372`；探针离线实测（mock 账户和 Docker，本会话复跑 8 步一致），未连交易所 | fix；放宽拒绝是 authority | hours（估计） | open |
| 20261107-23 | **Live 不能作为小额实盘发布**：无账户级亏损熔断；不检查成交后是否有保护单；从未真实下单；实际语义是单账户、单品种、单次入场、≤24 h、≤100 USDT | `engine/live.py:118-120,416-419`；`docs/plans/binance-live.zh.md` 验收状态；`engine/README.md` Live 段 | remove（发布版不含，或明确标工程试验）；authority | unknown | open |
| 20261107-24 | **Live 连接安全未查**：不校验也不提示禁提现和 IP 白名单；无 demo 路径，第一次连通就是真账户；读路径用交易所时间签名，掩盖本机时钟偏移 | `engine/live_venue.py:61-64,76,82`；`engine/egress.py:16`；Binance `api-key-permission`、`general-info` 文档（子代理已读） | authority（连 demo 和新 host 需授权）；先写文档 | unknown | open |
| 20261107-25 | **Live 未决没有闭环，服务器上也走不通**：断线退出后持仓留在交易所，无告警无 runbook，`reconcile` 不平仓；远程不发布 Dolt 端口，`--research-ledger` 连不上；`research-round` 教 bracket 而 Live 拒绝 bracket，改写版无指引 | `engine/live.py:241-255`；`deploy/remote/compose.yaml:18`；`strategy-authoring.md:112-113` 对 `engine/live.py:118` | skill + fix | unknown | open |
| 20261107-26 | **Agent 已存 key 可被转发**：改 `baseURL` 不要求重输 key，models 和 test 用旧 key 发到新地址，与 `agents.ts:2` 的说法相反；同时可探测内网（错误返回前 300 字符） | `ide/agent/src/app.ts:25,67`、`agents.ts:65-66`、`providers.ts:41-48`。读码，未实跑 | fix（改 `baseURL` 或 provider 须重输 key） | unknown | open |
| 20261107-27 | 多用户隔离不存在：`docker-api` 不看请求体，可挂宿主路径；白名单用户共享 provider key、线程和 paper 控制，无按人审计。托管才阻断 | `deploy/docker-api.cfg:4-6,31`；`deploy/remote/README.md`；`oauth2-proxy.cfg` `request_logging=false` | authority（随 -01） | unknown | open |
| 20261107-28 | 安全基线缺：无 `SECURITY.md`、威胁模型、CSP/HSTS；CodeQL `not-configured`；无镜像扫描，SBOM 关闭；分支规则 0 人审核，`deploy-ready` 不受保护 | `gh api code-scanning/default-setup`（实测）；`Caddyfile`；`ide-image.yml:143-144` | fix | unknown | open |
| 20261107-29 | **IDE 没拿到 view 就只有一行错误码**：账本空或连不上时 0 按钮 0 链接，Market、Agent 也进不去；服务端给的 `next_actions` 被丢弃 | `ide/web/src/main.tsx:32`、`live.ts:47`（实测；截图在审计 scratchpad，未入库） | fix | unknown | open |
| 20261107-30 | IDE 无错误边界：一次渲染异常整页空白，无文案。20261106-03、-04 是具体先例，这里缺的是兜底 | rg `ide/web/src` 0 处（实测）；构造畸形 snapshot 实测 | fix | wrong output | open |
| 20261107-31 | 没有设置、服务状态、帮助、版本：Settings 只有 Theme 和 Reset layout；DoltHub、服务器、市场范围只能改 compose，界面连只读都没有；页面标题是 Research Graph；不说明 paper 之后怎么走 | `ide/web/src/shell/toolbar/SettingsMenu.tsx`（实测）。用户先提。只读面板够用，不做可写配置 | fix | unknown | open |
| 20261107-32 | Paper 普通点击直接启动：无确认、不展示合约，写公开记录（本地部署）；启动失败的错误只留 6 秒且被截断 | `ide/web/src/components/PaperButton.tsx:23`；`state/paper.ts:15`（fixture 实测，未碰真实 run） | fix | unknown | open |
| 20261107-33 | 空状态说错话：Market 已在 All 还让回 All；Coins、News 离线永远 `Reading…`；Trades 离线说没有 run；画布和 Progress 空白无文案 | `MarketPage.tsx:93`、`CoinsWindow.tsx:42`、`NewsWindow.tsx:54`、`TradesWindow.tsx:73`（实测） | fix | none | open |
| 20261107-34 | 无障碍和窄屏：Market 对比度违规 91 处（dark 47），375 px 编辑区 66 px，`⌘` 写死，Tab 45 次到不了工具栏 | axe-core 4.10 实测；`tokens.css:223-225` | fix（低优先） | none | open |
| 20261107-35 | 文档面向 Agent 和作者：README 首段是 Agents，设计站是研发蓝图；无用户手册、FAQ、排障；英文首页待翻译；蓝图没有 live 和远程 | `README.md:12-15`、`docs/index.mdx:3`；rg `docs/rd` 无 `ledger mirror`、`engine.live` | fix | unknown | open |
| 20261107-36 | CI 没有新装路径：只有 `docker compose config` 和镜像探针，无“空机到一次回放”；macOS 不测 | `.github/scripts/check-remote-deploy.py`；rg `tests/` 无 `compose up` | measure（发布前 E2E） | unknown | open |
| 20261107-37 | `AGENTS.md` 写着作者个人授权，新用户的 Agent 分不清；“唯一授权的 live 连接是 paper”已与主线不符；skills 无部署和 live 指引 | `AGENTS.md:11-14` 对 `docs/plans/binance-live.zh.md`；rg `.agents/skills` | authority | unknown | open |
| 20261107-38 | 文字残留：README 写 six workflows（实际 8 个，多 `release-ready`、`remote-paper-auth`），仓库地图无 `live/`、`paper/`、`deploy/remote/`；`binance-live.zh.md:56` 仍写单向逐仓；`start_period: 6h` 是市场还在 Dolt 时留下的 | `README.md:151`；`deploy/compose.yaml:94`；扩展 20261105-08 | fix | none | open |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `TRADE_RESEARCH_ORIGIN` 的作者默认值 | 作者换机时少写一个变量 | 作者 `.env` 显式写一行 | 新用户实走拿到作者账本 | 删默认值（-05） |
| 公开克隆也要 DoltHub key | active 账本写后能发布 | 首次发布时的 `PUBLISH_FAILED` | `ledger mirror` 匿名成功 | 改成只在需要发布时要，**放宽拒绝，需 authority**（-06） |
| 发布版里的 CD | 作者主机零停机发布 | 其他人用 compose pull | 只验收过作者主机 | 不删代码，标为仅作者部署（-18） |
| 发布版里的 `live` 入口 | 作者自己的工程试验 | 不发布则无风险 | 无真实下单记录 | 发布版不宣传或单独开关，代码留（-23），等用户定 |
| `--single-order-source-reviewed` | 提醒操作者审过源码 | 无（自声明） | 未使用过 | 未证明可替代，留；门槛随 -21 再判 |
| Live 的 `cap <= 150` | 单单上限 | `cap <= budget <= 100` 已严于它 | 走不到 | 删，**检查变更，需 authority** |
| `start_period: 6h` | 市场还在 Dolt 时的长启动 | 账本现为 2 GB | 延后报不健康 | 降到按实测克隆时间算（-38） |
| `release_host.py` 的 `LEGACY` | 首次接管旧 IDE | 无其他 | 作者主机已接管 | 证据不足，留 |

## Decisions

2026-11-07 用户定 -01：发布版按“自托管单操作者”做，每人自己的账本、自己的服务器，不做托管多用户。-27 随之不做。

待用户定，未决：

- -03 Binance 数据条款与 Live、公开账本、托管的关系：先问律师。
- -02 LICENSE 选择，Supply 字体是否替换。
- -13 发布后 schema 只增不破。
- -21、-23、-24 Live 是否进发布版、门槛、demo。
