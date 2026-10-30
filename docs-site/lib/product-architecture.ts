import type { ArchitectureItem, ArchitectureRelation } from './architecture-map';

// Architecture facts and documentation links are independent of the homepage composition.
export const productArchitectureNodes: readonly ArchitectureItem[] = [
  {
    "id": "product",
    "title": "Product packages",
    "kind": "region",
    "docsRoute": "design-code-cli"
  },
  {
    "id": "runtime",
    "title": "Digest-pinned runtime",
    "kind": "region",
    "docsRoute": "design-code-runtime"
  },
  {
    "id": "runner",
    "title": "Runner · no network",
    "parent": "runtime",
    "kind": "region",
    "docsRoute": "design-code-engine"
  },
  {
    "id": "ide",
    "title": "IDE",
    "kind": "region",
    "docsRoute": "platform-architecture/#ide"
  },
  {
    "id": "paper",
    "title": "Paper",
    "kind": "region",
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "paper-network",
    "title": "Per-run network · same digest",
    "parent": "paper",
    "kind": "region",
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "dolt",
    "title": "Active Dolt",
    "kind": "region",
    "docsRoute": "platform-architecture/#data"
  },
  {
    "id": "research-db",
    "title": "Research DB",
    "parent": "dolt",
    "kind": "region",
    "docsRoute": "design-ledger"
  },
  {
    "id": "market-db",
    "title": "Market DB",
    "parent": "dolt",
    "kind": "region",
    "docsRoute": "design-database-market"
  },
  {
    "id": "agent",
    "title": "Agent",
    "kind": "component",
    "description": {
      "zh": "外部 Agent 按 .agents/skills/ 查来源、写单文件策略、提出假设并解释证据；经 cli/main.py 发布研究记录，用户决定路线与目标。",
      "en": "The external Agent follows .agents/skills/ to read sources, author single-file strategies, propose hypotheses and interpret evidence. It publishes through cli/main.py; the user chooses lines and targets."
    },
    "docsRoute": "design-skill-research-round"
  },
  {
    "id": "tsa",
    "title": "RFC 3161 TSA",
    "kind": "component",
    "description": {
      "zh": "ledger/witness.py 向外部 RFC 3161 TSA 请求并校验时间戳 token；样本外登记先提交，再见证提交身份和时间。",
      "en": "ledger/witness.py requests and verifies RFC 3161 tokens from an external TSA. Out-of-sample registration commits first, then witnesses that commit identity and time."
    },
    "docsRoute": "design-database-coordination"
  },
  {
    "id": "registry",
    "title": "CI / OCI registry",
    "kind": "component",
    "description": {
      "zh": ".github/workflows/runtime-image.yml 构建策略镜像；runtime/image.py 从镜像核对 digest、平台、契约与源码身份。trade-service 服务镜像与策略 runtime 镜像分开。",
      "en": ".github/workflows/runtime-image.yml builds strategy images; runtime/image.py verifies digest, platform, contract and source identity from the image. The trade-service service image is distinct from the strategy runtime image."
    },
    "docsRoute": "design-code-runtime"
  },
  {
    "id": "browser",
    "title": "Browser",
    "kind": "component",
    "description": {
      "zh": "浏览器访问 services/ide/ide.py 提供的 Web 服务；研究图读取 IDE 自己的公开副本，Paper 面板代理独立 daemon API。",
      "en": "The browser accesses the Web service in services/ide/ide.py. Research graphs read IDE-local public copies, while Paper panels proxy a separate daemon API."
    },
    "docsRoute": "platform-architecture/#ide"
  },
  {
    "id": "binance",
    "title": "Binance",
    "kind": "component",
    "description": {
      "zh": "market/sources.py 等产品导入代码校验公共历史数据并写 market；实时公共行情只经 engine.egress 进入 Paper，不连接交易账户或交易所订单流。",
      "en": "Product import code including market/sources.py validates public historical data before writing market. Live public prices reach Paper only through engine.egress, without trading accounts or exchange order flow."
    },
    "docsRoute": "design-code-market"
  },
  {
    "id": "cli",
    "title": "CLI",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "cli/main.py、cli/replay.py 是主机或服务进程调用的产品命令入口，负责发布、登记、回放、比较和账本管理；不是另一个常驻网络服务。",
      "en": "cli/main.py and cli/replay.py are product command entry points used by host or service processes for publication, registration, replay, comparison and ledger administration. They are not another persistent network service."
    },
    "docsRoute": "design-code-cli"
  },
  {
    "id": "candidate",
    "title": "Publish",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "ledger/strategies.py 保存完整单文件源码、内容哈希、父版本与改动；registration/precheck.py 绑定原生预检和独立 Agent 的 source-review，评审不由策略作者自报代替。",
      "en": "ledger/strategies.py retains complete single-file source, content hash, parent and difference. registration/precheck.py binds native prechecks and an independent Agent source-review rather than accepting the author’s self-assessment."
    },
    "docsRoute": "design-database-candidates"
  },
  {
    "id": "registration",
    "title": "Register",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "registration/register.py 在回放前登记假设、候选与对照、比较设计、输入身份和网格；registration/inputs.py 固定 market 输入并核对覆盖身份。",
      "en": "registration/register.py preregisters hypotheses, candidates/controls, comparison design, input identity and grid before replay; registration/inputs.py pins market inputs and checks coverage identity."
    },
    "docsRoute": "design-code-registration"
  },
  {
    "id": "validation",
    "title": "Validate",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "registration/validation.py 登记并绑定用户发起的样本外检验；ledger/witness.py 在登记提交后取得并核验 RFC 3161 凭证，证明登记早于检验窗口。",
      "en": "registration/validation.py registers and binds user-initiated out-of-sample validation; ledger/witness.py obtains and verifies RFC 3161 evidence after the registration commit to prove preregistration ordering."
    },
    "docsRoute": "design-database-validation"
  },
  {
    "id": "replay",
    "title": "Replay",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "replay/entry.py 将 trial、binding 与 ledger/execution.py 的 start receipt 放在同一事务提交；提交后 runtime/container.py 才启动 runner，再启动同 digest 的独立 auditor 和 fingerprint 容器。",
      "en": "replay/entry.py commits the trial, binding and ledger/execution.py start receipt in one transaction. Only afterward does runtime/container.py launch the runner, followed by separate auditor and fingerprint containers at the same digest."
    },
    "docsRoute": "design-code-replay"
  },
  {
    "id": "market-inputs",
    "title": "Market I/O",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "market/sources.py、market/series.py、market/aggtrades.py 导入公共历史数据到 market；market/read.py、market/export.py、registration/inputs.py 按固定提交读取行情、规则和范围，导出只读 Nautilus Catalog；runner 不连数据库。",
      "en": "market/sources.py, market/series.py and market/aggtrades.py imports public historical data into market. market/read.py, market/export.py and registration/inputs.py read pinned prices, rules and universe and export read-only Nautilus Catalogs. The runner does not connect to databases."
    },
    "docsRoute": "design-code-market"
  },
  {
    "id": "capture",
    "title": "Capture",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "ledger/execution.py、ledger/problems.py、ledger/metrics.py 经 CLI 核对原始捕获、审计和语义指纹，封存执行身份、失败事实与一次计算的读数；原生报告本身是可再现缓存。",
      "en": "ledger/execution.py, ledger/problems.py and ledger/metrics.py use the CLI path to verify captures, audits and semantic fingerprints, sealing execution identity, failure facts and once-computed readings. Native reports themselves remain reproducible caches."
    },
    "docsRoute": "design-code-ledger"
  },
  {
    "id": "qualification",
    "title": "Eligibility",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "qualification/availability.py 在读取时按当前检查身份判断经济证据可用性；这是共享 Python 包的读时派生结果，不是服务，也不把资格结果写回旧 run。",
      "en": "qualification/availability.py assesses economic evidence availability at read time under the current check identity. It is a shared Python package derivation, not a service or a writeback to old runs."
    },
    "docsRoute": "design-code-qualification"
  },
  {
    "id": "reports",
    "title": "Reports",
    "parent": "product",
    "kind": "component",
    "description": {
      "zh": "report/runs.py、report/comparison.py、report/attribution.py、report/graph.py 按所连接账本读取并派生报告、比较和研究图；IDE 调用相同只读代码，但连接自己的本地副本，不读活动研究库。",
      "en": "report/runs.py, report/comparison.py, report/attribution.py and report/graph.py derive reports, comparisons and graphs from the connected ledger. IDE uses the same read-only code against its own local copies, not the active research database."
    },
    "docsRoute": "design-code-report"
  },
  {
    "id": "strategy",
    "title": "Strategy",
    "parent": "runner",
    "kind": "component",
    "description": {
      "zh": "engine/load.py 在 runner 内按已记录源码身份加载原生 Nautilus Strategy；源码来自候选记录或 start receipt 的唯一原件，不从 Git 另取一份。",
      "en": "engine/load.py loads the native Nautilus Strategy inside the runner against recorded source identity. Source comes from the candidate record or sole start-receipt original, not a separate Git copy."
    },
    "docsRoute": "strategy-file"
  },
  {
    "id": "data-clock",
    "title": "Data / Clock",
    "parent": "runner",
    "kind": "component",
    "description": {
      "zh": "engine/run.py、engine/config.py 配置 Nautilus 原生 Catalog、事件时钟、交易窗口与实例；数据是只读挂载，研究 runner 使用 network=none。",
      "en": "engine/run.py and engine/config.py configure native Nautilus Catalogs, event clocks, windows and instances. Inputs are read-only mounts, and the research runner uses network=none."
    },
    "docsRoute": "design-code-engine"
  },
  {
    "id": "risk-execution",
    "title": "Risk / Execution",
    "parent": "runner",
    "kind": "component",
    "description": {
      "zh": "engine/run.py 接入发布版 nautilus_trader；订单生命周期、风险检查、原生撮合和成交由 Nautilus 管理，产品不维护并行执行引擎。",
      "en": "engine/run.py uses published nautilus_trader. Nautilus owns order lifecycle, risk checks, native matching and fills; the product does not maintain a parallel execution engine."
    },
    "docsRoute": "design-code-engine"
  },
  {
    "id": "portfolio",
    "title": "Account",
    "parent": "runner",
    "kind": "component",
    "description": {
      "zh": "Nautilus 拥有组合、账户、结算与费用事实；engine/report.py 从原生账户和报告导出读数，不维护第二套账户账本。",
      "en": "Nautilus owns portfolio, account, settlement and fee facts. engine/report.py exports readings from native accounts and reports rather than maintaining a second account ledger."
    },
    "docsRoute": "report"
  },
  {
    "id": "auditor",
    "title": "Auditor",
    "parent": "runtime",
    "kind": "component",
    "description": {
      "zh": "replay/entry.py 在 runner 完成后，以同一 digest 的另一个命名容器运行 engine.audit；它只读原生报告和覆盖回执，独立重算完整性与账户经济核对，不是 runner 内函数。",
      "en": "After the runner finishes, replay/entry.py runs engine.audit in another named container at the same digest. It reads native reports and coverage receipts to independently recompute integrity and account economics; it is not a runner function."
    },
    "docsRoute": "audit"
  },
  {
    "id": "fingerprint",
    "title": "Fingerprint",
    "parent": "runtime",
    "kind": "component",
    "description": {
      "zh": "engine/compare.py 在同一 digest 的独立 fingerprint 命名容器读取原生报告，归一化随机标识并计算语义指纹；不直接读写 Dolt。",
      "en": "engine/compare.py reads native reports in the separate named fingerprint container at the same digest, normalizes random identifiers and computes semantic fingerprints. It does not read or write Dolt directly."
    },
    "docsRoute": "design-code-engine"
  },
  {
    "id": "cache",
    "title": "Native reports",
    "parent": "runtime",
    "kind": "component",
    "description": {
      "zh": "engine/report.py 生成 orders、fills、positions、account、returns 和事件历史等报告，先写临时工作目录。它们是可按输入身份重建并对照 fingerprint 核验的缓存，不是持久事实数据库。",
      "en": "engine/report.py writes orders, fills, positions, account, returns and event history into a temporary work directory. These reports are caches regenerated from pinned inputs and checked against fingerprints, not another durable fact database."
    },
    "docsRoute": "ledger-runtime"
  },
  {
    "id": "ide-web",
    "title": "Web / Graph",
    "parent": "ide",
    "kind": "component",
    "description": {
      "zh": "services/ide/ide.py 和 services/ide/research_graph/ 在 IDE 服务中读取本地副本生成研究图，并将 Paper 请求和 stream 代理至独立 daemon。IDE 不写活动研究账本。",
      "en": "services/ide/ide.py and services/ide/research_graph/ generate graphs from IDE-local copies and proxy Paper requests/streams to a separate daemon. IDE does not write the active research ledger."
    },
    "docsRoute": "platform-architecture/#ide"
  },
  {
    "id": "chat",
    "title": "Chat",
    "parent": "ide",
    "kind": "component",
    "description": {
      "zh": "services/ide/agent/src/tools.ts 只允许产品只读命令，并连接 IDE 本地数据库副本；threads.ts 将对话写 IDE volume。这个聊天工具不是执行研究发布的外部 Agent。",
      "en": "services/ide/agent/src/tools.ts allows read-only product commands against IDE-local database copies; threads.ts stores chats in the IDE volume. This chat tool is distinct from the external Agent that publishes research."
    },
    "docsRoute": "platform-architecture/#ide"
  },
  {
    "id": "copies",
    "title": "Local research + market",
    "parent": "ide",
    "kind": "component",
    "description": {
      "zh": "services/ide/docker/entrypoint.sh、pull.sh 在 IDE volume 中维护自己的 research 与 market Dolt 副本；首次从 DoltHub clone，此后只做 fast-forward DOLT_PULL，业务读取账号只有 SELECT。",
      "en": "services/ide/docker/entrypoint.sh and pull.sh maintain IDE-local research and market Dolt copies in its volume. They initially clone from DoltHub, then fast-forward with DOLT_PULL; application readers have SELECT-only access."
    },
    "docsRoute": "platform-architecture/#data"
  },
  {
    "id": "daemon",
    "title": "Paper daemon",
    "parent": "paper",
    "kind": "component",
    "description": {
      "zh": "paper/serve.py、paper/runs.py、paper/reconcile.py 是 compose 的 paper 服务控制面，负责启停、封存与对账，经 CLI 写活动研究库；它不是策略 runner。ledger 与 paper 服务共用 trade-service 镜像。",
      "en": "paper/serve.py, paper/runs.py and paper/reconcile.py form the compose paper service control plane for start/stop, sealing and reconciliation. It writes the active research database through CLI and is distinct from the strategy runner. ledger and paper share the trade-service image."
    },
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "docker-api",
    "title": "Docker API",
    "parent": "paper",
    "kind": "component",
    "description": {
      "zh": "services/ide/docker/docker-api.cfg 只放行 Paper 必需的 Docker API；它是 compose 的 docker-api 服务，只有 Paper 控制面能访问，IDE 没有 Docker socket。",
      "en": "services/ide/docker/docker-api.cfg permits only Paper-required Docker API calls. It runs as the separate compose docker-api service, reachable by Paper control plane; IDE has no Docker socket."
    },
    "docsRoute": "platform-architecture/#deployment"
  },
  {
    "id": "journal",
    "title": "Run files",
    "parent": "paper",
    "kind": "component",
    "description": {
      "zh": "engine/paper.py 将运行中 journal、summary、日志写到 service/paper/<database>/<paper_id>。daemon 封存 capture 后清理容器和网络；目录保留到用户删除 run，不是另一套数据库。",
      "en": "engine/paper.py writes growing journals, summary and logs under service/paper/<database>/<paper_id>. After capture sealing the daemon removes containers and network; the directory remains until user deletion and is not another database."
    },
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "sandbox",
    "title": "Sandbox runner",
    "parent": "paper-network",
    "kind": "component",
    "description": {
      "zh": "paper/runs.py 为每个 PaperRun 启动独立 runner 容器和 internal network；engine/paper.py 消费公共实时行情，由 Nautilus Sandbox 管理虚拟订单、成交、风险、组合与账户。它与 egress 使用同一镜像 digest。",
      "en": "paper/runs.py starts a separate runner container and internal network per PaperRun. engine/paper.py consumes public live prices while Nautilus Sandbox owns simulated orders, fills, risk, portfolio and account. Runner and egress use the same image digest."
    },
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "egress",
    "title": "Egress proxy",
    "parent": "paper-network",
    "kind": "component",
    "description": {
      "zh": "engine/egress.py 是每次 PaperRun 独立的出站代理容器，和 runner 同 digest；只有 egress 同时接出站网络，runner 经 internal network 从它读 Binance 公共行情。",
      "en": "engine/egress.py is a separate outbound proxy container per PaperRun, sharing the runner digest. Only egress also joins the outbound network; the runner reads Binance public prices through it over the internal network."
    },
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "candidates",
    "title": "Candidates",
    "parent": "research-db",
    "kind": "component",
    "description": {
      "zh": "ledger/strategies.py、ledger/schema.sql：同一研究数据库中的 candidate 记录保存完整源码、源码哈希、父版本和改动说明；这一格是记录族，不是一个数据库。",
      "en": "ledger/strategies.py and ledger/schema.sql: candidate records in the research database retain complete source, hash, parent and difference. This box is a record family, not a database."
    },
    "docsRoute": "design-database-candidates"
  },
  {
    "id": "plans",
    "title": "Plans",
    "parent": "research-db",
    "kind": "component",
    "description": {
      "zh": "ledger/lines.py、ledger/targets.py、registration/register.py、registration/validation.py：研究路线、用户目标、研究计划和样本外登记属于同一个研究数据库。",
      "en": "ledger/lines.py, ledger/targets.py, registration/register.py and registration/validation.py: research lines, user targets, research plans and out-of-sample registrations belong to the same research database."
    },
    "docsRoute": "design-database-validation"
  },
  {
    "id": "trials",
    "title": "Trials",
    "parent": "research-db",
    "kind": "component",
    "description": {
      "zh": "ledger/trials.py、ledger/execution.py、ledger/metrics.py：试验身份、start receipt、原始捕获、审计结论、一次封存的指标与日收益以及报告指纹；不是另一份原生报告缓存。",
      "en": "ledger/trials.py, ledger/execution.py and ledger/metrics.py: trial identity, start receipts, original captures, audit verdicts, once-sealed metrics/daily returns and report fingerprints, not another native report cache."
    },
    "docsRoute": "design-database-runs"
  },
  {
    "id": "evidence",
    "title": "Evidence",
    "parent": "research-db",
    "kind": "component",
    "description": {
      "zh": "ledger/evidence.py、ledger/judgments.py、ledger/witness.py：来源原件、证据包、只追加判断、取代关系和时间戳凭证，均在研究数据库中。",
      "en": "ledger/evidence.py, ledger/judgments.py and ledger/witness.py: source originals, evidence bundles, append-only judgments, supersession and timestamp witnesses all live in the research database."
    },
    "docsRoute": "design-database-evidence"
  },
  {
    "id": "paper-records",
    "title": "Paper run",
    "parent": "research-db",
    "kind": "component",
    "description": {
      "zh": "ledger/paper.py、ledger/schema.sql：paper_run 声明与 paper-<id>-capture 在同一研究数据库；它们不是 research trial，也不存在 Paper 独立数据库。已封存 run 的用户删除路径由 paper.delete 处理。",
      "en": "ledger/paper.py and ledger/schema.sql: paper_run declarations and paper-<id>-capture live in the same research database. They are not research trials and there is no separate Paper database. paper.delete handles user deletion of sealed runs."
    },
    "docsRoute": "platform-architecture/#paper"
  },
  {
    "id": "market-records",
    "title": "Market records",
    "parent": "market-db",
    "kind": "component",
    "description": {
      "zh": "market/schema.sql、market/store.py：market 数据库保存版本化 LAST、MARK、aggTrades、资金费率、合约规则、成员；库名由 profile 指定，与研究库共用活动 Dolt SQL 服务。",
      "en": "market/schema.sql and market/store.py: the market database stores versioned LAST, MARK, aggTrades, funding, instrument rules, membership. Its profile specifies the database name; it shares the active Dolt SQL service with the research database."
    },
    "docsRoute": "design-database-market"
  },
  {
    "id": "dolthub",
    "title": "DoltHub",
    "kind": "component",
    "description": {
      "zh": "ledger/publish.py 与市场发布命令将研究和 market 的版本历史发布到 DoltHub；IDE clone 后 ff-only 拉取这些公开副本。DoltHub 不是另一份独立事实来源。",
      "en": "ledger/publish.py and market publication commands publish research and market version history to DoltHub. IDE clones then fast-forwards these public copies; DoltHub is not another independent source of fact."
    },
    "docsRoute": "platform-architecture/#data"
  },
  {
    "id": "backup",
    "title": "dolt_backup",
    "kind": "component",
    "description": {
      "zh": "ledger/admin.py 与市场备份代码维护研究、market 的 dolt_backup 全历史副本，位于 service 与 Git checkout 之外；它是恢复副本，不是第三套活动账本。",
      "en": "ledger/admin.py and market backup code retain full research/market history in dolt_backup outside the service and Git checkout. These are recovery copies, not a third active ledger."
    },
    "docsRoute": "ledger-runtime"
  }
];

export const productArchitectureEdges: readonly ArchitectureRelation[] = [
  {
    "id": "agent-cli",
    "source": "agent",
    "target": "cli",
    "description": {
      "zh": "Agent 经声明的 CLI 发布研究记录，用户决定路线与目标。",
      "en": "The Agent publishes research records through the declared CLI; the user chooses research lines and targets."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cli-candidate",
    "source": "cli",
    "target": "candidate",
    "description": {
      "zh": "CLI 调用候选发布、预检与独立源码评审记录接口。",
      "en": "CLI invokes candidate publication, prechecks and independent source-review recording."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cli-registration",
    "source": "cli",
    "target": "registration",
    "description": {
      "zh": "事前登记在回放前锁定假设、候选、对照与输入身份。",
      "en": "Preregistration locks hypotheses, candidates, controls and input identity before replay."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cli-validation",
    "source": "cli",
    "target": "validation",
    "description": {
      "zh": "用户发起样本外检验，经 CLI 登记、见证并绑定一次验证回放。",
      "en": "The user initiates out-of-sample validation; CLI preregisters, witnesses and binds the validation replay."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cli-replay",
    "source": "cli",
    "target": "replay",
    "description": {
      "zh": "CLI 调用 replay/entry.py 协调一次有持久身份的原生回放。",
      "en": "CLI calls replay/entry.py to coordinate native replay with a durable identity."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "witness-tsa",
    "source": "tsa",
    "target": "validation",
    "description": {
      "zh": "登记提交后，ledger/witness.py 向 RFC 3161 TSA 发送摘要请求，校验返回 token 并保存时间戳凭证。",
      "en": "After registration commits, ledger/witness.py sends a digest request to the RFC 3161 TSA, verifies its response token and retains timestamp evidence."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "registry-runtime",
    "source": "registry",
    "target": "runtime",
    "description": {
      "zh": "runner、auditor、fingerprint 是同一固定 digest 镜像的三个独立命名容器，不是一个 runner 内的三个函数。",
      "en": "Runner, auditor and fingerprint are three separately named containers from the same pinned image digest, not three functions inside one runner."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "market-inputs",
    "source": "market-db",
    "target": "market-inputs",
    "description": {
      "zh": "产品导入代码写入版本化市场记录，导出代码从固定 market commit 读取行情、规则与范围；容器不直连数据库。",
      "en": "Product import code writes versioned market records; export code reads prices, rules and universe at a pinned market commit. Containers do not connect directly to databases."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "catalog-runner",
    "source": "market-inputs",
    "target": "runner",
    "description": {
      "zh": "market/export.py 导出 Catalog，由 runtime/container.py 只读挂载进无网络 runner。",
      "en": "market/export.py exports Catalogs which runtime/container.py mounts read-only into the networkless runner."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "replay-runner",
    "source": "replay",
    "target": "runner",
    "description": {
      "zh": "replay/entry.py 将 trial、binding、start receipt 在同一事务提交，提交之后才启动 runner 命名容器。",
      "en": "replay/entry.py commits the trial, binding and start receipt in one transaction before starting the named runner container."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "data-strategy",
    "source": "data-clock",
    "target": "strategy",
    "description": {
      "zh": "Nautilus 按原生时钟将数据事件交给 Strategy。",
      "en": "Nautilus delivers data events to Strategy under its native clock."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "strategy-execution",
    "source": "strategy",
    "target": "risk-execution",
    "description": {
      "zh": "Strategy 发送原生订单命令，由 Nautilus 风险与执行组件处理。",
      "en": "Strategy sends native order commands to Nautilus risk and execution components."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "execution-account",
    "source": "risk-execution",
    "target": "portfolio",
    "description": {
      "zh": "原生成交驱动组合、账户与费用状态更新。",
      "en": "Native fills update portfolio, account and fee state."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "history-import",
    "source": "binance",
    "target": "market-inputs",
    "description": {
      "zh": "公共历史档案交由产品导入代码校验、导入并发布 market 版本；数据源不直接写数据库。",
      "en": "Product import code validates public historical archives, imports them and publishes market versions. The external data source does not write databases directly."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "runner-cache",
    "source": "runner",
    "target": "cache",
    "description": {
      "zh": "engine/report.py 导出原生报告到临时目录，报告为可再现缓存。",
      "en": "engine/report.py exports native reports to a temporary directory as reproducible caches."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cache-audit",
    "source": "cache",
    "target": "auditor",
    "description": {
      "zh": "独立 auditor 容器只读报告和覆盖回执，重算完整性及账户经济。",
      "en": "The separate auditor container reads reports and coverage receipts to recompute integrity and account economics."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cache-fingerprint",
    "source": "cache",
    "target": "fingerprint",
    "description": {
      "zh": "独立 fingerprint 容器只读报告并生成归一化语义指纹。",
      "en": "The separate fingerprint container reads reports and computes normalized semantic fingerprints."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "cache-capture",
    "source": "cache",
    "target": "capture",
    "description": {
      "zh": "产品将原始执行捕获绑定到报告身份；原生报告可按已存指纹重建，不作为第二份持久事实源。",
      "en": "The product binds original execution capture to report identity. Native reports can be regenerated against stored fingerprints rather than becoming another durable source of fact."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "audit-capture",
    "source": "auditor",
    "target": "capture",
    "description": {
      "zh": "独立 auditor 的结论和原件进入产品捕获封存核对。",
      "en": "Independent auditor verdicts and originals enter product capture and sealing verification."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "fingerprint-capture",
    "source": "fingerprint",
    "target": "capture",
    "description": {
      "zh": "独立语义指纹进入封存记录，供报告重建时核对。",
      "en": "Independent semantic fingerprints enter sealed records for later report-reconstruction checks."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "capture-research",
    "source": "capture",
    "target": "research-db",
    "description": {
      "zh": "经 CLI 将身份、审计结论、执行捕获和封存读数写入同一研究数据库。",
      "en": "Through CLI, identity, audit verdicts, execution capture and sealed readings are written to the same research database."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "research-qualification",
    "source": "research-db",
    "target": "qualification",
    "description": {
      "zh": "qualification/availability.py 从所连接账本按当前检查身份读时判定，不回写资格结果；IDE 调用时连接自己的公开副本。",
      "en": "qualification/availability.py derives availability at read time under the current check identity without writing it back. When called by IDE, it connects to IDE-local public copies."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "research-reports",
    "source": "research-db",
    "target": "reports",
    "description": {
      "zh": "共享 report Python 包从所连接账本派生指标、比较、归因和图；不是另一项网络服务。",
      "en": "Shared report Python packages derive metrics, comparisons, attribution and graphs from the connected ledger. They are not another network service."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "reports-ide",
    "source": "ide",
    "target": "reports",
    "description": {
      "zh": "IDE 调用相同只读 qualification/report 代码，以 IDE 本地副本为数据源。这是代码复用关系，不表示 IDE 读取活动研究库，也不是活动库推送派生报告。",
      "en": "IDE invokes the same read-only qualification/report code against IDE-local copies. This denotes code reuse, not IDE access to the active research database or an active-database report push."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "browser-ide",
    "source": "browser",
    "target": "ide-web",
    "description": {
      "zh": "浏览器访问 IDE Web、研究图与 Paper 面板。",
      "en": "The browser opens IDE Web, research graphs and Paper panels."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "copies-web",
    "source": "copies",
    "target": "ide-web",
    "description": {
      "zh": "研究图通过只读 CLI 查询 IDE 本地 research、market 副本，不连接 active Dolt。",
      "en": "Graphs query IDE-local research and market copies through read-only CLI, without connecting to active Dolt."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "chat-copies",
    "source": "chat",
    "target": "copies",
    "description": {
      "zh": "Chat 工具白名单只读产品命令，数据来自本地副本；对话另存 IDE volume。",
      "en": "Chat tool allowlists expose read-only product commands using local copies; conversations are stored separately in the IDE volume."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "hub-copies",
    "source": "dolthub",
    "target": "copies",
    "description": {
      "zh": "IDE 首次从 DoltHub clone，此后只做 ff-only DOLT_PULL；公开副本同步不等于直连活动研究库。",
      "en": "IDE initially clones from DoltHub, then uses ff-only DOLT_PULL. Public-copy synchronization is not a direct connection to the active research database."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "dolt-hub",
    "source": "dolt",
    "target": "dolthub",
    "description": {
      "zh": "产品管理命令将研究和 market 的版本历史发布到各自公开 DoltHub 副本。",
      "en": "Product administration publishes research and market version history to their public DoltHub copies."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "dolt-backup",
    "source": "dolt",
    "target": "backup",
    "description": {
      "zh": "dolt_backup 保存研究、market 的全历史增量恢复副本，位于 service 和 checkout 之外。",
      "en": "dolt_backup retains incremental full-history recovery copies for research and market outside the service and checkout."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "ide-daemon",
    "source": "ide",
    "target": "daemon",
    "description": {
      "zh": "IDE Paper 面板经 Web 代理向 paper:8767 发请求并接收 stream；控制面写入发生在 daemon 的 CLI 路径。",
      "en": "IDE Paper panels use the Web proxy to call paper:8767 and receive streams; control-plane writes occur through the daemon CLI path."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "daemon-docker",
    "source": "daemon",
    "target": "docker-api",
    "description": {
      "zh": "只有 Paper 控制面调用受限 Docker API 代理，IDE 无 Docker socket。",
      "en": "Only Paper control plane calls the restricted Docker API proxy; IDE has no Docker socket."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "docker-run",
    "source": "docker-api",
    "target": "paper-network",
    "description": {
      "zh": "受限 Docker API 为每次 run 创建 internal network，并启动同 digest 的 runner 和 egress 两容器。",
      "en": "The restricted Docker API creates each run’s internal network and starts runner and egress containers at the same digest."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "binance-egress",
    "source": "binance",
    "target": "egress",
    "description": {
      "zh": "只有 egress 连接 Binance 公共 REST/WebSocket，允许的是公共行情，不是交易账户连接。",
      "en": "Only egress reaches Binance public REST/WebSocket endpoints for public prices, without trading-account connectivity."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "egress-sandbox",
    "source": "egress",
    "target": "sandbox",
    "description": {
      "zh": "runner 经 internal network 消费 egress 转发的公共行情；订单与成交由 Nautilus Sandbox 管理。",
      "en": "The runner consumes public prices through egress over the internal network; Nautilus Sandbox owns orders and fills."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "sandbox-journal",
    "source": "sandbox",
    "target": "journal",
    "description": {
      "zh": "engine.paper 将运行中 journal、summary 和日志写入运行目录。",
      "en": "engine.paper writes growing journals, summary and logs into the run directory."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "journal-daemon",
    "source": "journal",
    "target": "daemon",
    "description": {
      "zh": "daemon 读取 journal 提供面板数据，结束后经 CLI 封存 capture 并清理容器/网络；目录保留至用户删除 run。",
      "en": "The daemon tails journals for the panel and after exit seals captures through CLI and removes containers/network. The directory remains until user deletion."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "daemon-research",
    "source": "daemon",
    "target": "research-db",
    "description": {
      "zh": "daemon 经 CLI 声明 paper_run 并封存 capture 到同一个研究数据库，Paper 不是 trial 或独立数据库。",
      "en": "The daemon uses CLI to declare paper_run and seal captures into the same research database. Paper is neither a trial nor a separate database."
    },
    "docsRoute": "platform-architecture"
  },
  {
    "id": "market-daemon",
    "source": "market-db",
    "target": "daemon",
    "description": {
      "zh": "启动 Paper 时，产品从固定 market commit 读取成员与范围身份；合约规格和实时价格经 egress 获取公共 REST/WebSocket。",
      "en": "At Paper start the product reads membership and universe identity from a pinned market commit. Instrument specifications and live prices come from public REST/WebSocket through egress."
    },
    "docsRoute": "platform-architecture"
  }
];
