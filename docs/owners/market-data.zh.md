# Market Data

## 职责

向所有分析和交易消费者提供规范 时间正确的市场 参考和标的事实。Market Data 拥有数据含义和可观察时间，但不替某个策略决定本轮应消费哪些标的。

### 如何阅读本页

Owner 契约就是标准 Owner 骨架：职责、拥有的权威事实、模块、输入交接、输出交接、拒绝和禁止事项、失败与恢复、
决策契约、后续实现验收。读这几节就知道 Market Data 拥有什么、什么跨越它的边界、它拒绝什么。另一个 Owner 或
规划工作的 agent 需要据以推理的就是这部分。

模块与输入交接之间是各原生子权威契约：Calendar 与 Time Zone、Market Semantics、Correction Policy、Corporate
Action、Replay Market Facts V2、Instrument Master，以及策略 input-role binding。每节自带成熟度标记，各自陈述
一个子权威。

这些节内部，凡标题指向规范 codec、规范身份或规范 census 的子节，规定的是字节布局 字段顺序 整数宽度与摘要域。
它们是规范性的，因为编码不同即事实不同，但只回答一个值如何拼写，不回答谁可以写它或它意味着什么。除非你正在
实现或验证某个编码，否则可以跳过。

## 实现准入台账

本台账是下文契约实际走到哪一步的可 grep 索引。它本身不授予任何许可：处于
`IMPLEMENTATION_ADMITTED` 的以下文状态列所写的为准，别无其他，所以本句不点名任何切片，也不会因某一片状态变化而过期。
扩大已准入集合必须先按 `AGENTS.md` 的架构权威规则修改本文档。已合并的 crate、被点名的
类型、绿色的 job 或本表中的一行都不是实现权威，永远不证明存在生产消费者，也永远不授权生产副作用、部署切换或真实
交易。

除供应商 Data Clients 一行外，每一行 `CURRENT / PARTIAL` 都只依赖唯一一份动态证据，别无其他：`make cargo-test-market-data-owner-postgres-isolated`
经 `crates/data/tests/run_market_data_owner_postgres.bash` 驱动的一次性 PostgreSQL Owner 链路，它只执行单个
`#[ignore]` 场景 `owner::postgres::tests::postgres_owner_is_atomic_restart_safe_acl_sealed_and_fail_closed`，且仅以
`.github/workflows/build.yml` 的 `market-data` 矩阵条目进入 CI。该链路证明原子性、重启、字节幂等、修正拓扑与按角色的
ACL 拒绝。它不证明供应商真实性，不证明生产装配，也不证明消费者行为。Data Clients 一行依赖的则是
`crates/adapters/databento/src/historical.rs` 中需显式触发的 `#[ignore]` 实盘探针测试，它要求本机
`DATABENTO_API_KEY`，从不在 CI 中运行。

### 台账状态词汇

- **`CURRENT`** 指能力已合并于当前 main，拥有生产装配根，且有真实消费者在已部署的二进制内触达它。下表没有任何一行
  处于该状态。
- **`CURRENT / PARTIAL`** 指 Owner 本地权威及其持久 custody 已合并并通过动态验收，而生产装配、可触达的消费者或两者
  仍然缺失。
- **`TARGET`** 指本文档预期该能力，而仓库尚未拥有它。在其真实消费者链路终结之前，该预期保持可修订。
- **`IMPLEMENTATION_ADMITTED`** 指用户已把本文档的某一确切切片准入为有界的、可单独评审的仓库工作。它只是构建与验证
  的许可，绝不是已合并、已部署、已被 Owner 接受或拥有副作用权威的证据。
- **`NOT_ADMITTED`** 指本文档、绿色的 job、保留下来的模块与被点名的类型都不授权该能力或任何相关的业务状态转移。

### 生产阻断物

- **`B1` 铸造缺生产装配根。** `crates/data/src/owner/postgres.rs` 的 `commit_pit_initial_from_owner_custody_v1`
  自行从 Owner custody 解析 canonical basis 且不带任何测试依赖，一次性 PostgreSQL 链路已验收它的 `AVAILABLE`、
  `AMBIGUOUS` 与 `INSUFFICIENT` 终态。剩下的是可达性：它是 crate 私有的，没有任何已部署二进制构造它，也没有请求
  入口，因此链路之外唯一的调用者仍是
  `crates/data/src/owner/postgres/bar_joined_cut_acceptance_v1.rs` 里的验收铸造。解除条件：一个 Owner 装配根，
  以及 `B3`、`B4` 点名的请求入口。
  **这条路径上有 163 个条目在默认构建里编译得到却不可达，而且每一个都只从密封验收模块触达。**
  测量于 `877781213`：带 `RUSTFLAGS="--force-warn dead_code"` 与 `--message-format=json`，按文件与
  行号对每一条 `dead_code` 的 primary span 取键。默认的 `cargo check --workspace` 把 163 条全报为死；
  加上 `--features vibe-data/sealed-strategy-input-acceptance` 后 163 条全部复活；而不带该 feature 的
  `cargo clippy -p vibe-data --all-targets` 一条都唤不活，所以没有任何一条有 `cfg(test)` 调用者。
  它们分布在十一个文件里，而 `postgres.rs` 中的 `validate_*`、`insert_*` 与 `lock_*` 条目是同一条
  写路径上前后相接的环节，不是散落的残留。**这个数此前的两次读法都是错的，而且都朝着令人安心的方向错。**
  读成 92 是因为 `--message-format=short` 把一个实现里的整簇死成员折成一行
  `multiple associated items are never used` 并丢掉它们的名字，又因为这一行的锚点会在两次构建之间
  漂移，放进了五条在两侧都已是死码的条目。读成"六条在非默认 feature 门后"是因为被比较的两个构建
  同时变了两个量：`crates/qualification` 与 `crates/backtest_owner` 在 `[dev-dependencies]` 里带上
  `sealed-strategy-input-acceptance`，于是 `--all-targets` 会把它打开，而裸 `cargo check` 不会。
  **当这个数不再吻合时，重跑那几条命令而不是相信它** - 它在有调用者落地的那一刻就会变，
  而那正是解除 `B1` 的含义。
- **`B2` 声明存储在生产无写入者。** `register_strategy_input_binding_declaration_v1` 与 `B1` 共用同一个唯一非测试调用
  点，于是 `resolve_pit_request_for_strategy_design_v1` 对每一个生产 Design 都返回 `UnknownDeclaration`，
  `crates/strategy_factory/src/source_research_composer_postgres_v2.rs` 中的 Composer 接缝恒定 fail closed。解除条件：
  随 `B1` 一并解除，且该写入者可从 R&D 事务触达。
- **`B3` Deployment Store Admission 处于关闭。** `DEPLOYMENT_STORE_ADMISSION_MODE` 在
  `product/rd-workbench/.env.example` 与 `product/rd-workbench/docker-compose.yml` 中为 `disabled`，因此每个密封读口
  都解析为 `None`，而 `crates/strategy_factory_rd_owner_api/src/main.rs` 把 resolver 留在从不读取的字段
  `_market_data_research_pit` 里。`docs/guide/architecture-rules.md` 点名的生产端口现已存在，并组成 `required` 那条缝。
  解除条件：某个部署按 `product/rd-workbench/README.md` 的步骤开启 `required`，外加一个真正读取该读口的消费者。
  验收链路覆盖 Store Admission 之后的那一段，不覆盖 Admission 本身。在启用 `sealed-strategy-input-acceptance` 的构建中（没有任何
  部署的二进制启用它），`native_replay_scheduling_resolver_for_sealed_acceptance_v1` 以已准入 resolver 的原始读取、校验与选择
  走原生 Replay 调度读路径，但读取之前不做准入，读取之后不做重新校验。它以一个测试用的最小权限主体连接，一次性数据库只授予
  它 `NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1`；它的 evidence 在已准入读取携带 receipt 的位置携带标记
  `SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1`，只有携带该读口的构建才接受这个标记。Admission 本身仍然是 `B3`：还没有
  任何东西租用它的主体。那个主体是 `market_data_admitted_reader`。
  `product/rd-workbench/postgres-init/25-market-data-admitted-reader.sh` 把它建成一个可登录、不继承任何东西、在两个方向上
  都没有角色成员关系、并持有数据库 `CONNECT` 的角色；compose 文件还不运行这个脚本。部署时的 ACL 切换把
  `market_data_private` 与 `market_data_admitted_read` 上的全部权限从它点名的每个角色收回，admitted reader 不在其中。
  切换在 Owner materialize 之后运行，所以 Owner 迁移授给读者的权限能留下来，靠的只是读者不在那些名单里；
  `product/rd-workbench/scripts/check/authority.bash` 拒绝点名它的切换。每一次已准入读取，以及
  测量对 Owner 迁移账本的读取，都只经由 `market_data_admitted_read` 到达 Owner。那里的每个函数要么是同名私有函数的
  `SECURITY DEFINER` 直通包装，参数与结果都相同，要么是四个固定的 Owner 行读取之一；每个都是 `STABLE` 并固定
  `search_path`。Owner 迁移只把它们授予一个角色：`market_data_admitted_reader` 存在时，它获得该 schema 的 `USAGE` 与其中
  每个函数的 `EXECUTE`，在 `market_data_private` 上什么都不获得；时区托管检查要求后者除 owner 外没有任何被授权者。测量仍然
  点名私有函数与关系，它按 schema 与存储名在每个角色都能读的 catalog 行里找到每一个，从不经过 `to_regclass` 或
  `to_regprocedure`，后两者对角色无权使用的 schema 里的限定名会直接拒绝。在迁移最近一次运行之后才建出的读者，会在 Owner 下一次迁移时获得这份授权。除测量自己做的那次账本读取外，每个包装都在某个
  已准入读取的下限上，所以这份授权恰好是已准入读取与测量所调用的东西。一个单元测试把包装清单钉在各下限与测量的那一次
  额外调用上，一条 Market Data PostgreSQL 证明把建好的读者的权限普查钉在这份授权上：它以该读者身份测量并准入每一个
  下限、调用每一个包装，并被 `market_data_private` 拒绝。每个读口只在
  测量覆盖它所服务读取的下限时才打开，原生 Replay 调度读口的 PIT evaluation 读取也在其中；每次读取在它所依据的每次准入上
  都再核一遍自己的下限。
  读取一份 BAR schedule 有**两套托管策略**，每种构建一套，而本文档此前一套都没描述过。测试构建自行开启
  `REPEATABLE READ READ ONLY` 事务并自验该 schedule 的历史；生产构建的快照由已准入读口的 evidence 承担，并在返回前
  重新校验。两者跑的是同一个 `verify_bar_schedule_storage_evidence`。差别是一致性保证从哪里来，不是强弱：测试那条
  路多一步生产没有的历史校验，生产那条路多一份测试拿不到的准入。
  值得明说的后果是**生产那套策略没有任何种类的覆盖**。单测跑的是测试构建那个函数体，而 `crates/data/tests` 下没有任何
  集成测试碰过 BAR schedule。所以 `B3` 挡住的不只是一次部署 - 那道门后的第一段代码从未被执行过。挡住测试够到它的是
  可见性而不是权限：`Custodian::new` 对 store-admission 模块私有，`AdmittedCapability` 只有一个出口，所以该模块之外
  的消费方构造不出生产读所需的那个 port。
  关于这道门还有一条事实，读代码的人默认会读反：**`MarketDataReadPostgres` 的生产形态只在 `required` 模式下被构造。**它唯一的
  生产构造器是 `from_admitted`，带 `cfg(not(test))` 门，而它的七个调用点全都位于
  `RdOwnerStoreAdmissionBootstrap::Required` 之后；没有环境配置时该分支是 `Disabled`，返回 `Ok(None)`。
  `Required` 之后的那个合成根用部署配置所指名的五个生产端口构造 custodian（`store_admission/composition.rs`），
  建不出其中任何一个就以它的失败码拒绝。Market Data 的证明
  `the_production_seam_admits_what_the_administrator_measured_sealed_and_published` 在一次性 PostgreSQL 上把这个合成根
  端到端走了一遍 - 测量、补全、封存、发布、准入，再经 scheduling 读口读取 - 所以**一条自述未建的缝**已不再是它的写照。
  它在那里读到的 BAR schedule 普查是空的；生产策略在真实 schedule 行上仍从未运行过。真实部署会不会设成 `Required`
  是一个关于部署配置的问题，代码里答不出。
  **解除 `B3` 证明的是 `rd-owner-api` 连到了哪个库，并不把凭据挡在这个进程之外**。同一进程启动时就持有两条裸 DSN：
  `MARKET_DATA_OWNER_DATABASE_URL`，即 Owner 的写主体 `market_data_owner`，`product/rd-workbench/docker-compose.yml`
  要求必填；以及 `MARKET_DATA_RD_ROLE_SET_DATABASE_URL`，即读者 `market_data_reader`。其默认构建里有六个 Market Data
  admission 直接用它们连接，而不经过 store-admission custodian - PIT intake、Source Binding、universe selection、
  strategy-input binding（两条 DSN 都用）、Instrument Master 与 Market Semantics，由 `main.rs` 中的
  `bootstrap_market_data_*` 函数组装。它们唯一的门是角色与拓扑检查 `MarketDataOwnerPostgres::ADMISSION_SQL_V1`。
  带 `composer-replay-issuance` 的构建还持有第三条：`INSTRUMENT_OWNER_DATABASE_URL`，即主体 `instrument_owner`，
  `instrument_economic_terms_postgres_owner_from_environment_v1` 用它同样直接打开 economic-terms Owner。compose
  文件对每个镜像都要求它，因为带这个 feature 的构建缺了它就起不来。在这些 DSN 以租用句柄的形式搬到 custodian
  之后以前，`B3` 带来的是防替换 - 一个签过名、处于当前、经直接测量的库 -
  而不是凭据隔离。
  下文 `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1` 有两处表述与代码尚不一致；都不挡生产路线。该档要求由单独执行的主体测量
  目标，而 `DirectMeasurer` 是在 custodian 内用租到的凭据测量。该档还要求准入回执交叉绑定 trust bundle，而
  `SealedDeploymentStoreAdmissionReceipt` 带 witness identity，却没有 signer key fingerprint 或 bundle identity。
  已有五个生产适配器，由 `store_admission/composition.rs` 从部署配置所指名的文件组合起来：pin 住一把公钥的 Ed25519
  签名验证器（`store_admission/signature.rs`）、PostgreSQL custody store（`store_admission/custody_postgres.rs`；其 schema
  与两个主体在 `product/rd-workbench/postgres-init/20-deployment-store-custody.sh`，由 compose 文件的
  `deployment-store-provision` 服务运行），以及 secret 文件凭据 resolver（`store_admission/credential_files.rs`）。
  secret 文件自身没有版本也没有过期时间：其版本是文件原样字节的 SHA-256，由签名 manifest 指名；其租约在准入的 store
  时钟 cut 所在的那个固定长度租期的期末到期，所以同一租期内的每次准入与 revalidation 都封存或重新加入同一张回执。
  已准入的读口按库及其托管、而不是按那段窗口，把每次重新准入与它开启时的回执相比，所以它活过开启时的那个租期；只有一次读
  前后的两次准入必须是同一张回执，跨过租期边界的那次读被拒绝。第四个是单机部署的 anti-rollback
  模式 `SingleTrustDomainNoRollbackWitness`（`store_admission/witness.rs`）：单机上 anti-rollback 性质不成立，每张回执都写明
  这个模式，用户 2026-09-27 的授权载于架构规则。第五个是部署库的直接测量器
  `PinnedTlsPostgresDirectMeasurer`（`store_admission/postgres.rs`，其 TLS 一段在 `crates/postgres_connect/src/pinned_tls.rs`）。
  sqlx 报不出会话的服务端出示了哪张证书，它的校验模式又会在给定根之外信任公网 Web PKI，所以测量器自己建连：发出
  PostgreSQL 的 `SSLRequest`，完成只信任一个 PEM 文件所钉之根的 TLS 1.3，再经一个私有 Unix socket 把 sqlx 的会话转送到
  服务端。它的 TLS identity 写明该服务端出示的证书与所钉的根，且服务端的 `pg_stat_ssl` 必须在 TLS、协议与 cipher 上
  与之一致。每个准入后的读都以同样方式到达库：准入记下测量器的传输方式，并绑定到它测得的证书；每次读都在其上开会话，服务端
  出示的若不是那张证书就拒绝。两段之间的 socket 只存在于握手完成到它接受的那一个会话之间，所在目录只有本进程的用户能进入；
  中继只为本进程转送；另一个根下的服务端、或出示另一张证书的服务端，在 socket 建立之前就被拒绝，会话的任何字节都到不了它。
  compose 文件的 `postgres-tls-install` 服务运行之后，部署的 PostgreSQL 即提供 TLS。管理员在部署到达库的位置用
  `deployment-store-publication-author` 测量该库并补全草稿，再用 `deployment-store-publication-seal` 与
  `deployment-store-publication-publish` 封存并发布历史；步骤见 `product/rd-workbench/README.md`。回执的 slot 带着它的
  到期时刻：单机模式的观测永不变化，只按 head 与观测命名的 slot 会让第一次之后的每次准入都成为冲突。准入只从 custody
  store 的时钟读时间：每次读历史都带回该库的 `clock_timestamp()` cut，commit 也在同一个时钟上判定回执的窗口。
  直接测量器的 role identity 覆盖的是租到的角色能做什么，而不只是所列对象的 ACL；所列对象的 ACL 看不到别处的授权。
  它带一份权限普查（`PRIVILEGE_CENSUS_V1`）：会话角色及其成员关系闭包中每个角色持有的每项权限，无论来自直接授权、
  `PUBLIC` 还是所有权。数据库只问当前这一个；schema 问除 `pg_catalog` 之外的每一个；对象只在该角色能使用的 schema
  里问；关系的行类型和隐式数组类型不问，它们不授予任何东西。`pg_catalog` 里，凡该角色、其闭包或 `PUBLIC` 的某项
  权限与 initdb 的记录不同，都列出来。所以角色在它够得着的任何地方多得或失去一项授权，admission 比较的 identity
  就会变；授给别的角色的权限、别的数据库上的权限、它用不了的 schema 里的对象，都不会让它变。角色能用、而别人会在
  其中建对象的 schema 在它够得着的范围内：部署的数据库里 `PUBLIC` 能用 `public`，`product_edge_owner` 能在那里建
  对象，所以 `public` 里新建一个函数（默认 `PUBLIC` 可执行）会改变普查，admission 需要一份新 manifest。普查按
  PostgreSQL 16 的权限集列举，其他主版本的服务器会被拒绝，而不是少测。
- **`B4` 消费者未编入已部署镜像。** `product/rd-workbench/Dockerfile.owner` 以默认 feature 构建
  `strategy-factory-rd-owner-api`，使 `composer-replay-issuance` 处于关闭，而 dashboard 读取二进制不触及任何
  Market Data 表面。native Replay scheduling 消费者位于这个生产 feature 之后，而不是 acceptance feature 之后；
  修复循环的 shared time-evidence 消费者位于 `native-replay-execution` 之后，它同样是生产 feature。解除条件：部署镜像开启
  这些生产 feature，这是一个部署决定。
- **`B5` 无跨 Owner 消费者。** 该模块的唯一消费者是同一 crate 内的 Replay V2 组合与 PostgreSQL 写入者，且此类模块多数
  在 `crates/data` 内还是 `pub(crate)`。解除条件：一个由本文档点名的固定消费者。
- **`B6` 还没有任何部署准入过供应商。** 整条链路已端到端验证：2026-09-17 的一次性 PostgreSQL 运行里，准入了
  Databento Source Binding、准入其成员、求值选择规则、读取 Owner 决策切面、提交一份冻结请求，并从一条真实
  `AAPL` 报价提交出 `AVAILABLE` 快照，另有一个免密钥的币安现货客户端以零成本回答同一条缝。剩下的是运维而非
  结构问题：没有任何运行中的部署向 `/v1/market-data/source-bindings` 提交过绑定，且未经
  `MARKET_DATA_OBSERVATION_SOURCE` 指名 Data Client 时 intake 保持缺席。
- **`B7` 声明所解析的三个 Owner fact 现在都有生产写入者。** 经
  `POST /v1/market-data/strategy-input-bindings/from-design-intent` 注册时，Owner 会从自己的托管里重新解析批次时刻内
  恰好一条 Market Semantics fact，以及 digest 等于批次 `instrument_master_digest` 的 Instrument Master V1 readback，
  而 Market Semantics fact 又交叉绑定一条 R0 record。这三者各由下文对应章节描述的生产路径写入，都不经 acceptance
  feature 或测试夹具，且 PIT 请求的 `instrument_master_digest` 现在是 Owner 自己的解析结果而非调用方的声称。剩下的
  不是写入者而是一次运行：还没有任何部署用过它们，那正是 `B6` 已经点名的运维缺口。
- **`B8` 没有任何实时事实到达 Runtime。** 标题原样不动，因为它仍然为真；变的是本条原先写的解除条件。它原先说首条实时
  通道会解除本条。首条实时通道现在已存在：它对一个有界 scope 真的在流，其持久头部与 Owner 签发的订阅由有序链路证明，
  本 Owner 其余每条取数缝仍然是 as-of。这并没有解除本条，因为产出一个事实和把它交付给消费者是两件事，而准入该通道
  的那一片自己写明排除了消费侧：no Runtime custody。不存在该 intake 的 Runtime 消费者，所以 Strategy Instance 仍然没有
  实时输入，Paper 与 Live 都无从开始。解除本条需要两样：Runtime 侧的一个消费者，以及本 Owner 这一侧供它消费的一片读面。后者现已准入但尚未建成，前者
  两样都不是：没有任何对外函数供给实时事实。已暴露的十二个在函数体内不再点名 `session_user`，所以给另一个调用者
  授权现在得到的是拒绝而不是空结果，而这正是「每消费者一片读面」得以表达的前提。其准入形态见 Runtime 交接一节。

### 逐片台账

| 切片                                              | 状态                                                                               | 实现位置                                                                                                                                                                                                        | 阻断物     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| PIT Market Snapshot 权威与 custody                | `CURRENT / PARTIAL`                                                                | `crates/data/src/owner/pit_snapshot.rs`、`pit_snapshot/authority.rs`、`owner/postgres.rs` 的 `pit_*` 关系                                                                                                       | `B1`       |
| Source Binding 与 Owner 本地 clock head           | `CURRENT / PARTIAL`                                                                | `crates/data/src/owner/source_binding.rs`、`owner/postgres.rs`                                                                                                                                                  | `B1`       |
| 面向 R&D 的 `ResearchPitTerminal` 输出交接        | `CURRENT / PARTIAL`                                                                | `crates/data/src/owner/research_pit_terminal.rs`                                                                                                                                                                | `B3`       |
| Deployment Store Admission 私有接缝               | `CURRENT / PARTIAL`                                                                | `crates/data/src/owner/store_admission`                                                                                                                                                                         | `B3`       |
| R0 观测证据与 reference‑fact 目录                 | `CURRENT / PARTIAL`，含 R0 写                                                      | `owner/reference_fact_coordinates`、`owner/reference_fact_catalog.rs`                                                                                                                                           | `B5`、`B7` |
| Calendar、Time Zone 与 Session 原生权威           | `CURRENT / PARTIAL`                                                                | `owner/calendar`、`owner/time_zone`、`owner/session`                                                                                                                                                            | `B5`       |
| Market Semantics Owner 契约                       | `CURRENT / PARTIAL`，含 fact intake                                                | `owner/market_semantics`                                                                                                                                                                                        | `B5`、`B7` |
| Correction Policy 私有 Replay projection          | `CURRENT / PARTIAL`                                                                | `owner/correction_policy_projection`                                                                                                                                                                            | `B5`       |
| Corporate Action 的 Instrument Master 子权威      | `CURRENT / PARTIAL`                                                                | `owner/corporate_action`                                                                                                                                                                                        | `B5`       |
| Universe Selection Record                         | `CURRENT / PARTIAL`                                                                | `owner/universe_selection.rs`，持久 custody 与事务内规则求值在 `owner/postgres/universe_selection.rs`（`universe_selection_records_v1`、receipts、outbox、historical‑membership frontier/facts/heads/manifest） | `B1`       |
| Replay Market Facts V2 基础                       | `CURRENT / PARTIAL`                                                                | `owner/replay_market_facts_v2`                                                                                                                                                                                  | `B4`       |
| Instrument Master V1 与 V2 及经济条款             | `CURRENT / PARTIAL`，含 V1 fact intake 与 V2 的 baseline、状态 delta 与快照 intake | `owner/instrument_master.rs`、`owner/instrument_master_v2*.rs`、`owner/instrument_economic_terms*_v1.rs`                                                                                                        | `B4`、`B7` |
| Strategy input‑role binding 与 Design 的 PIT 坐标 | `CURRENT / PARTIAL`                                                                | `owner/postgres/strategy_input_binding_registry.rs`                                                                                                                                                             | `B2`、`B4` |
| EVENT 与 BAR Owner custody                        | `CURRENT / PARTIAL`                                                                | `owner/sample_fact.rs`、`owner/sample_projection*.rs`、`owner/bar_schedule.rs`                                                                                                                                  | `B4`       |
| Shared Time clock‑head 交接                       | `TARGET`                                                                           | `owner/shared_time_evidence.rs`                                                                                                                                                                                 | `B3`       |
| 供应商 Data Clients                               | `CURRENT / PARTIAL`                                                                | `crates/adapters/databento/src/pit_observation_source_v1.rs` 与 `crates/adapters/binance/src/pit_observation_source_v1.rs`，均已实盘验证                                                                        | `B6`       |
| 面向 Runtime 的实时行情事实通道                   | `CURRENT / PARTIAL`，一条通道                                                      | `owner/live_market_fact_v1.rs`、`owner/live_market_stream_v1.rs`、`owner/postgres/live_market_stream_v1.rs`、`crates/adapters/bybit/src/live_market_fact_source_v1.rs`                                          | `B8`       |
| Binance 永续已结算 funding 行                     | `CURRENT / PARTIAL`                                                                | `crates/adapters/binance/src/futures_pit_observation_source_v1.rs`                                                                                                                                              | `B6`       |
| Binance 永续持仓量行                              | `CURRENT / PARTIAL`                                                                | `crates/adapters/binance/src/futures_pit_observation_source_v1.rs`                                                                                                                                              | `B6`       |
| Binance bar 成交量与 taker 买入量                 | `CURRENT / PARTIAL`                                                                | `crates/adapters/binance/src/pit_observation_source_v1.rs`、`futures_pit_observation_source_v1.rs`                                                                                                              | `B6`       |

## 拥有的权威事实

- 标准化市场记录明确区分事件时间 provider 可用时间 本系统检索时间和修订发布时间。可观察表示该事实
  在绑定决定截面已经可被本系统使用，而不只表示底层事件已经发生。
- 数据版本 时点可用性 覆盖范围 血缘 修订和许可约束。
- 规范标的身份 场所映射 最小价格单位 合约周期 币种和估值条款，包括按生效时间版本化的交易
  calendar session time-zone rule corporate action symbol change expiry/roll 事实和历史 membership。
- Universe Selection Record 绑定请求方拥有的 selection rule、eligible-instrument frontier、生效与可观察
  时间、历史 membership cut、排除原因和结果身份。Market Data 只执行外部提供的规则，不替策略选 universe。
- PIT Market Snapshot 身份绑定来源与数据版本 四类时间 共享时钟和决定截面可用前沿、Instrument Master 与 Universe
  Selection Record 版本、calendar/session/time-zone 与 corporate-action cut、覆盖 许可 修订血缘和唯一
  Market Semantics Compatibility 身份。
- 每个普通 Research snapshot disposition 还重复准确 PIT Market Snapshot Request 身份与内容摘要、请求
  instrument 与 universe scope、决定截面、provenance license correction、稳定 correlation 和 Time Evidence。
  Research 侧的 `PREPARED` 或 `SUBMITTED_OR_UNKNOWN` 都不能证明数据可用。
- 历史 snapshot 与 live stream 共享的 Market Semantics Compatibility 身份，绑定 normalization adjustment
  timestamp interpretation instrument/reference mapping 与输入含义版本。
- **TARGET：** 类型化 Strategy Input Binding Receipt，把一个 Research 声明的 market/reference role 解析到
  准确 instrument/universe、field、timeframe、unit、PIT/live cut、source 与 Market Semantics 身份。
- 不可变 Market Data Source Binding 绑定来源实现与配置摘要、已认证 endpoint 与 dataset/account mapping、
  trust 与 normalization policy、license 与 redistribution scope 和不透明最小权限 credential handle。
- 每个 Source Binding 保留完整 supported failure-category set。版本化稳定优先级与证据到达顺序无关地
  选择一个 primary category 与规范状态：权利撤销为 `REVOKED`，明确拒绝为 `UNLICENSED`，权利证据
  未解析或来源不可用为 `UNAVAILABLE`，identity/configuration 或 semantics 不匹配为 `INCOMPATIBLE`。
  `ADMITTED` 是互斥状态，要求 failure set 为空。
- **CURRENT：** 一个私有规范 clock head 与 Owner-local Source Binding 和 PIT fact 原子持久化。当前支持准确
  replay 与同 epoch 前进；epoch 变化、sealed 跨 Owner handoff 与 Epoch Successor Proof 均非当前能力。
  handoff、Epoch Successor Proof 与 `MarketDataDecisionCutV1` 携带的每个时刻都是
  Unix-epoch 纳秒，单位由类型 `EpochNanosV1` 承载；uncertainty 与 skew bound 是 `NanosV1`。
  两者都没有不说出单位就返回数值的访问器，并且都序列化为裸数值，所以把单位移进类型时，
  没有任何 wire 形式或 digest 改变。与毫秒时钟的比较只经由 `may_be_reached_within_epoch_ms`、
  `is_reached_throughout_epoch_ms` 或 `is_not_passed_throughout_epoch_ms`，每个都对整个提交毫秒作答，
  因此朝拒绝取整。Backtest 与 Qualification 的 wire 以 `MarketDataEpochNanosV1` 对应它，
  其唯一的毫秒比较是 `is_expired_at_epoch_ms`。之所以由类型承载单位，是因为名字没有承载：
  Backtest、Qualification、R&D repair request 与 Source Intake 曾把这些时刻当作 epoch 毫秒读，
  于是对纳秒 bound 的过期检查从不触发、顺序检查从不通过，
  而它们测试里唯一的时钟，sealed protected-evaluation 时钟，本身就是毫秒。
- **TARGET：** immutable、content-addressed 且可按准确身份回读的 sealed clock-head handoff 绑定 head
  identity/digest、clock identity/epoch、monotonic sequence、wall observation、decision cut、排他的 valid-through、
  restart-continuity digest、uncertainty/skew bound 与 comparison rule。同 epoch successor 严格推进必需 cut。
  新 epoch 还要求一个 direct immutable Epoch Successor Proof 与新 head 原子提交，绑定准确 predecessor/successor
  head digest、前后 epoch identity、successor continuity digest、proof identity、commit cut 与 comparison rule。

## 模块

- **Data Clients** - 连接官方数据商和交易场所，取得原始成交 报价 K线和参考文件，但不定义业务身份。
- **Data Engine** - 统一记录格式和时间语义，提供订阅查询并生成可复现快照。
- **PIT Catalog** - 记录数据 calendar session action membership 与 correction 何时可观察，并执行外部
  提供的 universe-selection rule，防止未来信息进入历史研究或重放。
- **Instrument Master** - 拥有按生效时间版本化的标的身份 场所映射 合约条款 session time zone
  lifecycle 与 corporate-action 事实，不选择本轮运行标的。

## Calendar 与 Time Zone 原生 Owner 契约

### 持久 R0 observation-evidence foundation

**CURRENT：** `ReferenceFactR0RecordV1` 是独立原生 reference authority 共用的唯一持久 R0
observation-evidence aggregate。R0 不是 business fact、coordinate selector 或第二 clock。其私有 PostgreSQL
resolver 只接收不受信 request 与准确 locator `{request_identity, request_meaning_digest}`。它规范解码准确
PIT Snapshot 与 Source Binding locator，解析并逐字节匹配其原生 Owner custody，解析完整共提交 PIT
observation batch 与准确历史 Shared Time head，随后才创建 record。Head、latest、history scan、caller 携带的
authenticated input 或仅结构有效的 locator 都不能产生 positive R0 custody。

Record 交叉绑定准确 PIT request identity/digest、snapshot identity/fact digest 与经验证 PIT outbox digest；
完整 observation-batch digest；Source Binding identity/fact digest/outbox digest、lineage root/version；准确
source/correction frontier stream/cut-identity bytes、sequence/digest；准确 clock/epoch bytes、monotonic sequence、wall
observation、decision cut、排他的 valid-through、head identity/digest、restart continuity、uncertainty/skew；
replay/effective bound；provider-available、retrieval、correction-publication 与 Owner-observation coordinate；
可选 predecessor；以及 stable correlation。每个重复 time/frontier field 都与准确 PIT observation batch、
Source Binding locator、PIT time evidence 与解析所得 Shared Time head 逐字节匹配。R0 保留 PIT Owner 既有
outbox digest；它不会对 locator bytes 铸造 digest，也不重新解释旧 shared helper 的 SHA-256/little-endian
identity。

R0 version 1 的所有整数均为 big-endian，可选 tag 准确为 `0x00`/`0x01`，reserved 为 `u16BE = 0`；identity
是下列 NUL-terminated domain 加准确 canonical bytes 的 BLAKE3-256。

- Request-meaning domain 为 `vibe.market-data.reference-fact-r0-request.v1\0`；bytes 为 schema、reserved、
  以 `u32BE length || bytes` 编码的规范 PIT 与 Source Binding locator、replay start/exclusive end、
  effective-from、可选 effective-until、四个 observation coordinate、decision cut、可选 predecessor 与
  stable correlation。Request identity 是独立 idempotency key。
- Record domain 为 `vibe.market-data.reference-fact-r0-record.v1\0`；bytes 为 schema、reserved、request
  identity/meaning、按上述顺序排列的准确 PIT、observation、Source Binding、frontier 与 Shared Time field，
  随后为 replay/effective bound、四个 observation coordinate、decision cut、可选 predecessor 与 stable
  correlation。可变 clock、epoch 与 frontier stream/cut identity 使用 `u32BE length || bytes`。
- Cut domain 为 `vibe.market-data.reference-fact-r0-cut.v1\0`；bytes 为 schema、reserved、request
  identity/meaning、准确 member count `u32BE = 1`、record identity/digest，以及 gap count `u32BE = 0`。
  推断 empty 或 multi-record cut 均非 positive。
- Receipt domain 为 `vibe.market-data.reference-fact-r0-receipt.v1\0`；bytes 为 schema、reserved、request
  identity/meaning、cut identity/digest、store-generation identity、正 append sequence 与 stable correlation。
  Outbox identity 等于 receipt identity，payload 等于准确 receipt bytes。
- Readback domain 为 `vibe.market-data.reference-fact-r0-readback.v1\0`；bytes 为 schema、reserved、record
  identity/length/bytes、cut identity/length/bytes、receipt identity/length/bytes 与 outbox identity。

一个 transaction 在私有 table 中存储 record、单 record 完整 cut、generation/append state、receipt 与
outbox。准确 identity/meaning replay 重新解码、重新 hash 并交叉验证每一 row，返回逐字节相同的 move-only
readback。Meaning 改变、locator 缺失/篡改、partial row、scalar/frontier splice、canonical drift 或
response-loss retry mismatch 均不 append。**CURRENT / PARTIAL，生产 R0 写：** Owner 对每个自己提交为
`AVAILABLE` 的 PIT 快照，在与快照同一个 Owner transaction 内 append 其 R0 record，只由同事务提交的 PIT 与 Source
Binding 托管及当前 clock head 派生；没有路由、没有调用方字段、没有测试代码参与，重放的提交 rejoin 同一条 record。
它的声明从快照的事件时刻起，持续 Source Binding 为该快照任一 BAR 行标签所声明的最长固定间隔；没有任何声明时只持续一
纳秒 - 即 binding 不声明任何 bar，或快照只有交易所 session 日的行。更长的声明是对参考事实成立时长的更宽陈述，而不是更
谨慎的陈述：它以快照自身所含最长的 bar 为界，而每个 Replay 的窗口按它自己的执行标签另行推导，所以没有任何执行窗口因它
而变宽。resolver 从已存的 batch 与 binding 重新推导终点；composition-basis 读取不持有 batch，从 resolver 写下的
record 取终点。
一次性 PostgreSQL 链路在两条生产 intake 路径上都证明了它：record 的坐标就是该快照的坐标、重放不再追加第二条、
非 `AVAILABLE` 的快照一条也不带。除这条写入外不声称任何事。**NOT_ADMITTED：** R0 不授予 provider authenticity、deployment、runtime、Dashboard 或
trading authority。

### ReferenceFactCatalogV1 业务值权威

**TARGET：** `ReferenceFactCatalogV1` 是 Calendar、Time Zone 与 Session 业务值的唯一 Market Data Owner
catalog。它与 R0 属于不同权威轴：catalog 拥有 typed value、business scope、业务生效半开区间、revision、
correction lineage 与 direct predecessor；R0 只拥有解析该值时使用的准确 PIT/Source/Shared-Time observation
evidence。R0 的 replay/effective bound 绝不能扩大、截断或创建 catalog 业务区间。

闭合 value tag 为 `1 CALENDAR`、`2 TIME_ZONE` 与 `3 SESSION`。Calendar entry 绑定一个准确 civil-day 的
open/closed 值；Time Zone entry 绑定一个准确 time-zone/ruleset/UTC-offset 值及 offset 保持不变的 UTC
区间；Session entry 绑定一个准确 trading day、连续 interval ordinal 与带显式 fold resolution 的 local
open/close boundary，绝不存储权威 UTC endpoint。只有 Session 能依据准确 Time Zone cut 重算 endpoint，
并且必须证明 open 与 close 两个 instant 都被覆盖。

只有已准入 bootstrap/admin source 可以 append immutable catalog entry。Runtime 只接收不受信的准确 entry
locator，并且只能解析及逐字节验证；caller 携带的 typed proposal、latest/head 选择或仅结构有效的 bytes
都不能铸造 positive custody。Entry 绑定准确 Source Binding identity/fact/lineage 与 source/correction
frontier。原生 Calendar、Time Zone 与 Session fact 重复已解析 catalog identity，并保留独立 R0
observation coordinate。Entry 缺失、meaning 改变、source splice、predecessor branch、非规范顺序、区间
overlap/gap，或 Session boundary 位于 Time Zone coverage 外，都必须写入零 native fact、cut、receipt 与
outbox row。

Catalog key 与 entry identity 分别是
`vibe.market-data.reference-fact-catalog-key.v1\0` 与
`vibe.market-data.reference-fact-catalog-entry.v1\0` 加规范 big-endian bytes 的 BLAKE3-256。Key 绑定闭合
kind、business scope、正 revision、source lineage root 与完整 typed value。Stable catalog-head scope 准确由
stable business-scope identity 加该 source lineage root 构成；revision 与 typed value 都不得选择另一个 head。
Business-scope identity 是 `vibe.market-data.reference-fact-business-scope.v1\0` 加 schema `u16BE = 1`、
reserved zero `u16BE`、闭合 kind `u8` 与准确一个 native key 的规范 bytes 的 BLAKE3-256：Calendar identity
`u32BE length || bytes` 加 civil day `i32BE`；Time Zone identity `u32BE length || bytes` 加 ruleset identity
`[u8; 32]`；或 Session identity `u32BE length || bytes`、trading day `i32BE` 与 interval ordinal `u32BE`。
Entry 在完整 catalog-key bytes 之后另外依次绑定 command identity、可选 catalog predecessor、正 correction
sequence、业务生效区间、准确 Source provenance、administrator admission identity 与 stable correlation；
它不重复已经由该 key 绑定的 typed value。
Catalog predecessor 始终是同一 head scope 内的前一 catalog entry identity，绝不是 native fact identity。
Genesis 的 correction sequence 为 `1` 且没有 catalog predecessor；每个后继 entry 都绑定紧邻的前一 catalog
entry，且 sequence 准确加一。Time Zone 后继要么修正同一个恒定 offset regime 并保留 byte-identical
effective bounds，要么描述紧邻 regime，且其 lower bound 必须等于 predecessor 的 upper bound。Calendar
与 Session 后继修正同一个 stable native key，因此保留 byte-identical effective bounds。使用前必须解码、
重新 hash 并匹配准确 stored bytes。
**NOT_ADMITTED：** 隔离验收 catalog 数据不证明 vendor authenticity，也不授予 default/production database、
deployment、provider、Dashboard、runtime 或 trading effect。

### 共享原生边界与 custody

**CURRENT：** Replay V2 已有 typed Calendar 与 Time Zone value，而 PIT 与 Instrument Master 仍只携带
calendar、time-zone 或 ruleset identity，不携带原生 Calendar/Time Zone readback。Shared Time 只认证
Market Data 何时观察到 fact；绝不提供 calendar day、open disposition、time-zone rule 或 UTC offset。

**TARGET：** Calendar 与 Time Zone 是相互独立的 Market Data 原生权威。其固定消费者是：直接保留原生
cut identity/digest 的 PIT；绑定原生 cut identity/digest 而非字符串的 Instrument Master；接收确定性
projection 的 Replay V2；以及后续 BAR resolution。Session 是准确 Calendar 与 Time Zone cut 的唯一 join。
两个原生权威互不依赖 Session，也不复制对方 fact。不受信 private proposal 不得重新解释既有 Replay V2
value 或铸造 positive custody。

Calendar、Time Zone 与 Session 各权威都只接受一个不受信的准确 catalog-entry locator 来选择 catalog，
并在 caller 的 Owner transaction 中重新解析准确 stored `ReferenceFactCatalogV1` entry，同时解析准确已准入
Source Binding。Latest/current-head lookup 只验证已解析 entry 的 lineage position，绝不参与选择。Native
typed business value 从该 catalog entry 派生并与之逐字节匹配；caller proposal 不能提供或覆盖该值。一个
已验证 `ReferenceFactCoordinatesV1` 只作为 observation evidence，绝不是 business-value 或 lineage authority。

每条 native fact 拥有自身 lineage root、正 native correction sequence、可选 native predecessor 与 current
native head。Native lineage root 准确等于 catalog scope identity；该 scope 只标识一个 native fact key：
`(calendar identity, civil day)`、`(time-zone identity, ruleset identity)` 或 `(session identity,
trading day, interval ordinal)`。它既不从 Source Binding lineage coordinate 派生，也不与其比较。Native predecessor
始终是同一 native fact key 与 domain 的紧邻前一 fact identity，绝不是
catalog entry identity。Catalog 与 native correction sequence 一一对应。Genesis 时两个 sequence 均为 `1`
且两个 predecessor 都不存在。每个 sequence 大于 `1` 的 correction 必须同时具备两个 predecessor，native
fact 的 catalog entry 必须指明 catalog predecessor，并且前一 native fact 必须绑定该准确 catalog
predecessor；即使属于同一 revision，catalog entry hash 与 native fact hash 仍然不同。Predecessor 缺失、
branch、cycle、sequence gap 或 regression、cross-source splice、effective overlap/gap、请求 coverage 不完整、
clock mismatch 或 observation 过期，都在任何 write 前失败。Positive fact、完整 cut、receipt 与 move-only
readback 没有 public constructor/deserializer。公共 caller 只能取得不受信 sealed locator；resolver 由
crate sealed。

Version 1 整数均为 big-endian，可选 tag 准确为 `0x00`/`0x01`，boolean 为 `0x00`/`0x01`，identity/digest
均为 32 bytes。每个 artifact identity 都是 listed NUL-terminated domain 加准确 bytes 的 BLAKE3-256。
每个权威的 receipt bytes 均为 schema `u16BE = 1`、reserved `u16BE = 0`、request identity、
request-meaning digest、cut identity/digest、store-generation identity、正 append sequence `u64BE`、stable
correlation。Receipt identity 因此绑定 generation，并对其 receipt domain 加上述准确 bytes 做 hash。
Outbox identity 与该 receipt identity 完全相同；它没有独立 domain 或 hash，payload 是准确 receipt bytes。
Readback bytes 为 schema、reserved、正 fact count `u32BE`、按 cut 顺序的
每条 fact identity、`u32BE` length 与准确 bytes，随后是 cut identity/length/bytes、receipt
identity/length/bytes 与 outbox identity。Unknown tag、零 required identity、duplicate 或非规范顺序、
malformed length 与 trailing byte 均不受支持。

一个 caller-owned transaction 原子 append 不可变 fact/head row、完整 cut、receipt、outbox 与
generation/append state。准确 identity/meaning replay 会 rejoin 并重新验证完整 stored aggregate；meaning
变化产生 conflict。Partial custody、canonical/scalar drift 或 dependency splice 使 custody 不可信。
Response loss 通过准确 sealed locator 恢复，并在不再次 append 的情况下返回逐字节相同 readback。Table
与 schema 不向 runtime 授权；`PUBLIC` 无任何 privilege；只接纳固定、non-grantable 的 Owner/writer 与
准确 non-grantable reader `EXECUTE` manifest。任何 validation、ACL 或 recovery failure 均写入零 row。

**NOT_ADMITTED：** 这些契约不声称 implementation、migration、store admission、已注册 product
composition、provider authenticity、production/default write、deployment、Dashboard 工作、runtime 或
trading。

### Calendar V1：完整 day/open 权威

`CalendarFactV1` value 是准确 calendar identity `u32BE length || bytes`、从 `1970-01-01` 起算的 signed
UTC civil-day ordinal `i32BE`，以及 `is_open` `u8`。Fact domain 为
`vibe.market-data.calendar-fact.v1\0`；schema 与 reserved 之后的 bytes 是上述从 catalog 派生的完整 value、
准确 catalog entry identity `[u8; 32]`、native lineage root、native correction sequence `u64BE`、可选 native
predecessor、effective-from 与可选 effective-until `i128BE`、provider-available、retrieval、
correction-publication 与 Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity/digest、
Source Binding identity/fact digest/lineage root/`u64BE` version，以及 source/correction frontier digest。

Request-meaning domain 为 `vibe.market-data.calendar-request.v1\0`；bytes 是 schema、reserved、closed
consumer tag（`1 PIT`、`2 INSTRUMENT_MASTER`、`3 REPLAY_V2`、`4 BAR`）、calendar identity、inclusive
first 与 exclusive last day `i32BE`、Owner-observation、decision cut、各自按
`u32BE length || bytes` 编码的 Source Binding 与 R0 locator bytes，以及 stable correlation。Cut domain 为
`vibe.market-data.calendar-cut.v1\0`；bytes 是 schema、reserved、request identity/meaning、consumer tag、
calendar identity、day bound、Owner-observation、decision cut、R0 cut identity/digest、expected-day count
`u32BE`，随后是请求中每个 civil day 准确一项、按 day 排序的 fact identity/digest，再随后是 gap count
与排序后的 missing day ordinal。Positive 表示 gap 为零、day 不重复且 open/closed disposition 完整；空
range 无效。Receipt 与 readback domain 分别把 `calendar-cut` 替换为 `calendar-receipt` 与
`calendar-readback`，版本均为 `v1\0`；outbox identity 按共享原生规则等于 receipt identity，且没有 domain。

### Time Zone V1：完整 UTC-offset transition 权威

`TimeZoneFactV1` value 是准确 time-zone identity 与 ruleset identity（`u32BE length || bytes`，随后
`[u8; 32]`），再加 signed UTC offset seconds `i32BE`。其半开 effective interval 是该 offset 保持不变的
UTC interval。Ruleset transition 是不可变 successor；相邻 before/after interval 在 offset 减小时确定
local fold，在 offset 增大时确定 gap，因此两种情形都不得被猜测或 normalize away。

Fact domain 为 `vibe.market-data.time-zone-fact.v1\0`；bytes 是 schema、reserved、上述从 catalog 派生的
完整 value、准确 catalog entry identity `[u8; 32]`、native lineage root、native correction sequence、可选
native predecessor，随后是按相同顺序排列的 Calendar 所定义 effective、observation 与准确 R0/Source
Binding/frontier tail。Request-meaning domain 为
`vibe.market-data.time-zone-request.v1\0`；bytes 是 schema、reserved、consumer tag、time-zone identity、
ruleset identity、replay-window start 与 exclusive end `i128BE`、Owner-observation、decision cut、
length-prefixed Source Binding 与 R0 locator bytes，以及 stable correlation。Cut domain 为
`vibe.market-data.time-zone-cut.v1\0`；bytes 是 schema、reserved、request identity/meaning、consumer tag、
time-zone/ruleset identity、window bound、Owner-observation、decision cut、R0 cut identity/digest、transition
count `u32BE`、按 interval start 排序的 fact identity/digest entry，随后是 gap count 与排序的半开 gap
bound。Positive coverage 在 window start 或更早开始、在 window end 或更晚结束，并以准确相邻 interval
覆盖每个 instant 且每个 instant 只有一个 offset，包括 fold 与 gap。Receipt 与 readback domain
分别为 `vibe.market-data.time-zone-receipt.v1\0` 与 `vibe.market-data.time-zone-readback.v1\0`；outbox identity
按共享原生规则等于 receipt identity，且没有 domain。

### Session V1：唯一原生 Calendar 与 Time Zone join

**CURRENT：** Replay V2 已有 typed Session value，BAR V1 已有既存 structural bytes，但两者都不是原生
Session join 或权威。**TARGET：** Session 是准确 positive 且相互独立的 `CalendarCutV1` 与
`TimeZoneCutV1` 在一个 Market Data transaction 中的唯一原生 join；同一 transaction 还解析已准入
Source Binding、准确 Instrument Master
reference tuple 与已验证 Shared Time observation。其唯一 raw resolver consumer 是
`MARKET_DATA_OWNER_V1`；内部 PIT、Replay 与 additive BAR composition 可以消费它，而 Backtest 与
R&D 只能接收 sealed projection。Caller 字符串、UTC endpoint、nearest transition 或 private
proposal 都不能铸造 session fact。Gap local time 没有 positive fact，且绝不 shift。
**NOT_ADMITTED：** 本契约不声称 Session implementation、native store、已注册 composition、product
reachability、production write、deployment、runtime 或 trading。

`SessionFactV1` 绑定非空 stable session identity、从 `1970-01-01` 起算且采用 proleptic Gregorian
calendar 的 signed `i32BE` trading day，以及从零开始连续的 interval ordinal `u32BE`。每个 local boundary
是 local day `i32BE`、nanoseconds-of-day `u64BE < 86_400_000_000_000`，以及 resolution tag `u8`：
`1 EXACT`、`2 EARLIER_INSTANT` 或 `3 LATER_INSTANT`。唯一 local time 要求 `EXACT`；fold 要求经认证的
earlier/later choice，并依据准确 Time Zone transition 重新计算。Leap-second spelling 与每个 gap boundary
均不受支持。Fact 重复 recomputed UTC open/close `i128BE`，要求 `open < close`，并绑定准确 Calendar
fact/cut identity/digest、Time Zone open/close boundary fact identity/digest 加 cut identity/digest、Instrument
Master reference tuple、Source Binding identity/lineage、source/correction frontier、correction identity 与完整
R0 observation coordinate。从 catalog 派生的 typed business value 与准确 entry 逐字节匹配；每个派生 UTC
与 dependency scalar 都从 join 的原生 fact 重新计算。

Fact domain 为 `vibe.market-data.session-fact.v1\0`；bytes 是 schema `u16BE = 1`、reserved、session
identity `u32BE length || bytes`、trading day、interval ordinal、local-open tuple 与 local-close tuple，作为从
catalog 派生的完整 typed business value；随后是准确 catalog entry identity `[u8; 32]`、native lineage root、
重算 UTC open、UTC close、Calendar fact identity/digest 与 cut identity/digest、Time Zone open fact
identity/digest、close fact identity/digest 与 cut identity/digest、Instrument Master readback/fact/cut digest、
可选 native predecessor、native correction sequence `u64BE`、provider-available、retrieval、
correction-publication 与 Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity/digest、
Source Binding identity/fact
digest/lineage root/`u64BE` version、source frontier、correction frontier 与 correction identity。Correction
是准确 `(session identity, trading day, interval ordinal)` native key 的不可变 current-head direct successor。

Request-meaning domain 为 `vibe.market-data.session-request.v1\0`；bytes 是 schema、reserved、固定 raw
consumer tag `1 MARKET_DATA_OWNER_V1`、session identity、inclusive first/exclusive last trading day、准确
Calendar 与 Time Zone cut locator、Instrument Master reference locator、按 length-prefixed bytes 编码的
Source Binding 与 R0 locator、Owner-observation、decision cut 与 stable correlation。Cut domain 为
`vibe.market-data.session-cut.v1\0`；bytes 是 schema、reserved、request identity/meaning、consumer tag、
session/day scope、Calendar 与 Time Zone cut identity/digest、Instrument Master reference tuple、
Owner-observation、decision cut、R0 cut identity/digest、day count `u32BE`，随后是每个顺序 day 及其
open/closed tag、interval count 与 interval-ordinal/fact-identity/fact-digest entry，再随后是 gap count 与
missing-day ordinal。Open day 包含从零开始的完整连续 ordinal set；closed day 具有显式 zero-member
census。因此 all-closed window 可以有 positive explicit empty-fact cut。Duplicate key、ordinal gap、UTC
interval overlap、requested day 缺失，或 declared open schedule 内存在 interval gap，都不产生 positive
cut。

Receipt 与 readback domain 为 `vibe.market-data.session-receipt.v1\0` 与
`vibe.market-data.session-readback.v1\0`；outbox identity 等于 receipt identity、没有 domain，并采用
共享原生 write-once、sealed rejoin/recovery、ACL 与 zero-write rule。Replay V2 保留其既有 Session bytes，BAR V1
保留其既有 bytes；采用原生 Session 需要 additive dependency/aggregate field 与 additive BAR successor
contract，绝不重新解释 stored Replay V2 或 BAR V1 custody。

## Market Semantics Owner 契约

### 状态、边界与固定消费者

**CURRENT：** Market Data 架构拥有 Market Semantics Compatibility；`ReplayMarketFactsV2` 已具备下文所述
closed typed Market Semantics value。Source Binding 仍只把 free-form normalization 与 meaning 字符串作为
不受信 source claim 携带；Source Binding admission、字符串相等，或 PIT/Instrument Master 携带的 digest
本身都不能认证 typed Market Semantics。

**一条 fact 的粒度是 Source Binding，不是 instrument，也不是 market。**
`MarketSemanticsFactSubmissionV1` 恰好携带一个 Source Binding locator、一个 PIT snapshot locator 与
typed value；它不携带 coordinate，而一次提交据以解析的 compatibility scope 是 Owner 从该 binding 推出的。
因此一个 binding 陈述一个 price adjustment。一个覆盖多个市场、而各市场复权规则不同的供应商，比如一个市场
发布复权因子、另一个市场因为供应商根本不发布该市场的因子序列而只能是 raw，只有两种陈述方式：按市场各准入
一个 Source Binding、各带自己的 fact；或者为其中一个市场声明一条它并不持有的复权规则。
**后者正是 `UNKNOWN` 要消灭的那类不持有的断言，只是从 value 挪到了 binding 上。**
本文档今天不要求这种拆分，而要求它会约束所有未来的源，所以这里把它记为一条已知限制，
而不是由任何单个源的准入顺带决定。

**在同一 scope 下，每个 PIT snapshot 有自己的一条 fact 链。** 一条 fact 由一个 PIT snapshot 的证据证明：
它绑定该 snapshot 的 identity 与 fact digest，而 Strategy Input declaration 只接受绑定其自身 snapshot 的
fact。因此 fact 链、回答读取的 head 以及重叠规则都按 compatibility scope 与 PIT snapshot 分别保存；同一
binding 下的第二个 snapshot 以它自己的创世 fact 开始自己的链。「一个 binding 陈述一个 price adjustment」
改由一条显式规则保证，而不再依赖 scope 只有一个 head：每次 Owner 提交之后，一个 scope 的所有 head 都携带
相同的五个 typed value。一条 fact 的 value 若与其 scope 中除它所继承的那个 head 以外的任一 head 不同，就以
`ScopeValueConflict` 按名拒绝，不写入任何东西。同一 scope 与 snapshot 的第二个创世 fact 仍是 branch，以
`InvalidCorrection` 拒绝。

提交者读取一个 scope 所陈述的 value，而不是凭记忆重述。`resolve_market_semantics_scope_value_v1` 接受一个 Source
Binding locator，返回 Owner 从该 binding 的 semantics 推出的 compatibility scope，以及该 scope 每个 head 都携带的
value，用 submission 陈述它的那些词表达；scope 尚无 head 时不返回 value，此时任何 value 都可以是第一个。它在调用方的
transaction 中运行，只读，不加行锁。同一 scope 的 head 陈述不同 value 是存储的问题，因此该读取以 `StoreUnavailable`
拒绝，而不是挑一个；Market Data 不持有的 binding 为 `SourceBindingUnavailable`。

**CURRENT：** Market Data 已有一个独立 `MarketSemanticsFactV1` 权威 foundation。其首个固定消费者是 Strategy Input
Binding Registry；`ReplayMarketFactsV2` 随后把同一个 Owner readback 作为确定性 projection 消费。不受信
proposal 只能携带 request identity/meaning、stable correlation、声称的 typed value、声称的 predecessor
与 dependency locator；不得提供 positive fact、coordinate、cut、canonical bytes、digest 或 receipt。
Market Data 私下解析已准入的原生 Source Binding readback、准确原生 PIT Snapshot 与 Instrument Master
readback，以及准确且经 Owner 认证的 `ReferenceFactR0ReadbackV1`；随后解析由 Market Data
拥有的 closed registry entry，该 entry 把这些准确 dependency identity 映射到 typed semantic value。
Free-form Source Binding 字符串、adapter label、provider field、caller mapping 与名称相似性绝不选择或
认证 registry entry。

Positive resolver 只接收不受信 proposal。它规范解码准确 PIT、Source Binding、Instrument Master 与 R0
locator，在 caller transaction 中解析四份 Owner readback，派生 closed registry key，并仅按该 key 解析一条
immutable registry record。Registry-key domain 为
`vibe.market-data.market-semantics-registry-key.v1\0`；bytes 为 schema、reserved、compatibility-scope
identity、R0 record identity/digest 与 cut identity/digest、PIT snapshot identity/fact digest、Source Binding
identity/fact digest/lineage root/`u64BE` version、Instrument Master readback/fact/cut digest、source frontier
与 correction frontier。Registry-record domain 为
`vibe.market-data.market-semantics-registry-record.v1\0`；bytes 为 schema、reserved、key identity、`u32BE`
key length 加准确 key bytes、五个 typed value field，以及 correction identity。Key identity 是私有 table
primary key，record identity 是准确 record bytes 的 BLAKE3 digest。Zero、many、missing、canonical drift、
dependency splice 或 value mismatch 均 unavailable/untrusted；不准按 name、value、scope、latest 或 history
lookup。Test-only seal 不是 production positive path。

**CURRENT / PARTIAL，生产 Market Semantics intake：** 一个 Owner-sealed admission port 与一条路由
`POST /v1/market-data/market-semantics`，Operations 经它在已准入的 Source Binding 旁提交上文的 untrusted
proposal。只有 Owner 解析四个依赖 readback、派生封闭的 registry key、为该 key 用 proposal 的 typed value 注册一次
registry entry（同一 key 的不同 value 以 `SnapshotValueConflict` 拒绝，绝不覆写），并在一个 transaction 内 append fact、完整 cut、
receipt 与 outbox。提交只点名绑定、快照与类型化取值，别无其他：作用域是该绑定自己的兼容性身份，生效区间与关联
标识是该快照自己的 R0 观测证据，两者都不是提交方能说的。一次性 PostgreSQL 链路证明了作用域、重放 rejoin 与冲突。
除这条 intake 外不声称任何事。**NOT_ADMITTED：** 本契约不声称 provider ingestion/authenticity、Strategy Input Registry 或 Replay V2
产品 composition、deployment、runtime execution、Dashboard 工作或 trading authority。Fixture、caller-carried
identity、结构有效的 bytes 或既有 Replay V2 fact 都不是独立 Owner readback。

### 有类型事实、时间与修正拓扑

Version 1 的 closed value 准确包含：非零 normalization identity `[u8; 32]`；price adjustment `u16BE`，
其值为 `1 RAW`、`2 SPLIT_ADJUSTED`、`3 TOTAL_RETURN_ADJUSTED` 或 `4 UNKNOWN`；timestamp basis `u16BE`，
其值为 `1 EVENT_EFFECTIVE`、`2 INTERVAL_OPEN` 或 `3 INTERVAL_CLOSE`；非零 price-unit identity `[u8; 32]`；
以及非零 size-unit identity `[u8; 32]`。零值与所有未列出 tag 均不受支持。

`4 UNKNOWN` 表示提交方声明它不知道该 source 的 adjustment rule。它是一条声明，绝不是回退：本 Owner
不认识的 adjustment 字符串仍然是无效提交并被拒绝，与此前完全一致。规则未知的 source 必须如实声明，
而不得因为 `RAW` 是当时唯一可选项就被记为 `RAW`。携带 `4 UNKNOWN` 的 fact 没有 replay 表示并在那里被拒绝，
因为 replay 要比较价格，而跨未声明口径无法比较。Unit identity 命名
Owner-registry meaning，而不是 unit 字符串、currency default、scale 猜测或 Instrument Master increment
field。

每条不可变 fact 绑定一个 Owner-registry compatibility-scope identity、可选的准确 predecessor、一个半开
effective interval `[effective_from, effective_until)`、provider-available、retrieval、
correction-publication 与 Owner-observation coordinate，以及正 decision cut。它还绑定准确 R0 coordinate
identity/digest、准确已准入 PIT Snapshot、Source Binding 与 Instrument Master identity/digest、Source
Binding lineage、source/correction frontier 与 correction identity。所有重复 coordinate scalar 必须与解析
所得 `ReferenceFactR0ReadbackV1` 逐字节一致；该独立权威不创建第二 clock 或 coordinate authority。
Effective containment 与 observation availability 是相互独立的 predicate。每个 availability coordinate
都必须在同一 authenticated clock 与 decision cut 下可观察。

Correction 是同一 compatibility scope 与 PIT snapshot 内的不可变 direct successor。它指向该链的 current
head，推进经认证的 correction/observation evidence，并可保留被修正的 effective interval；绝不重写
predecessor，也不会让 predecessor 在更早 cut 上失效。同一条链内不同 effective regime 不得重叠。Predecessor
缺失、branch、cycle、ambiguous overlap、coordinate/frontier 回退，或在更早 observation cut 选择更晚
correction，都不产生 positive fact 或 cut。

**NOT_CONSTRUCTIBLE：今天追加不了任何 correction。** 提案里的同一个字段同时充当 R0 record 的 predecessor 与
Market Semantics 的 predecessor。`market_semantics/authority.rs` 里的 `validate_proposal` 要求它等于 R0 record 的
predecessor，即一个 R0 identity；而 `validate_successor_v1` 要求它等于前一条 fact 的 identity；两者是不同
domain 下的 BLAKE3 digest。Owner 为 snapshot 写的 R0 record 也总是创世（`append_owner_r0_for_available_pit_v1`）。
所以今天每条 fact 都是创世。修好这条路径时必须保持上面的规则：不改 typed value 的 correction 可以只推进一个
snapshot 的链；改 value 的 correction 必须在一个 Owner transaction 里为该 scope 的每个 head 各追加一个
successor，因为只改一条链会让各 head 不一致，并以 `ScopeValueConflict` 被拒。这种整 scope 的 correction
在此定义但不建，因为没有任何东西消费它。它不能靠今天逐条 append 的检查逐个追加 successor 来实现：第一个
successor 进来时其他 head 仍是旧值，会被拒。这条规则成立于每次 Owner 提交之后，所以那个 transaction 要先写完
全部 successor，再在结尾对整个 scope 检查一次。

### 规范 codec、完整 cut 与 custody

Version 1 的每个整数均为 big-endian。可选 absence/presence 准确为 `0x00`/`0x01`；每个 identity/digest
均为 32 bytes；reserved 为 `u16BE = 0`；malformed length、零 required identity、alternate tag、duplicate、
非规范顺序或 trailing byte 均不受支持。Identity 是在下列 NUL-terminated domain 后拼接准确 canonical
bytes 所得的 BLAKE3-256。

- Request-meaning domain 为 `vibe.market-data.market-semantics-request.v1\0`；bytes 顺序为：schema
  `u16BE = 1`、reserved、consumer tag、compatibility-scope identity、可选 predecessor、按 fact 顺序排列的
  五个 typed value field、effective-from、可选 effective-until、Owner-observation、decision cut，随后是 PIT
  Snapshot、Source Binding、Instrument Master 与 R0 的不受信 locator bytes；每项均为
  `u32BE length || bytes`；最后是 stable correlation。Request identity 是独立 idempotency key，不属于
  request meaning。
- Fact domain 为 `vibe.market-data.market-semantics-fact.v1\0`；bytes 顺序为：schema `u16BE = 1`、
  reserved、compatibility-scope identity、可选 predecessor、normalization identity、price-adjustment tag、
  timestamp-basis tag、price-unit identity、size-unit identity、effective-from `i128BE`、可选
  effective-until、provider-available `i128BE`、retrieval `i128BE`、correction-publication `i128BE`、
  Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity 与 digest、PIT Snapshot identity
  与 fact digest、Source Binding identity、fact digest、lineage root 与 `u64BE` lineage version、Instrument
  Master readback/fact/cut digest、source frontier、correction frontier 与 correction identity。
- Cut domain 为 `vibe.market-data.market-semantics-cut.v1\0`；bytes 为 schema、reserved、request identity、
  request meaning digest、closed consumer tag（`1 STRATEGY_INPUT_BINDING_REGISTRY_V1`、
  `2 REPLAY_MARKET_FACTS_V2`）、compatibility-scope identity、effective instant `i128BE`、Owner-observation
  `i128BE`、decision cut `u64BE`、R0 cut identity 与 digest、expected-member count `u32BE`、按 scope 严格
  排序且由 scope identity 加 fact identity/digest 组成的 entry，随后是 gap count `u32BE` 与严格排序的
  gap-scope identity。Positive cut 具备完整 expected manifest 且 gap 为零；显式空 manifest 不是推断的
  success。
- Receipt domain 为 `vibe.market-data.market-semantics-receipt.v1\0`；bytes 为 schema、reserved、request
  identity、request meaning digest、consumer tag、cut identity/digest、store-generation identity、正 append
  sequence `u64BE` 与 stable correlation。Receipt identity 是该 domain 加准确 receipt bytes 所得且绑定
  generation 的 BLAKE3-256。Outbox identity 与 receipt identity 完全相同，没有独立 domain 或 hash，且其
  payload 是准确 receipt bytes。
- Readback domain 为 `vibe.market-data.market-semantics-readback.v1\0`；bytes 为 schema、reserved、正 fact
  count `u32BE`、按 cut 顺序排列的每条 fact identity 及其 `u32BE` byte length 与准确 fact bytes，随后是
  cut identity、length 与 bytes，receipt identity、length 与 bytes，以及 outbox identity。Positive fact、
  cut、receipt 与 move-only readback 没有 public constructor 或 deserializer；resolver 由 crate sealed。

Head 按 compatibility scope 与 PIT snapshot 保存在 `market_semantics_heads_v2`。仍持有每个 scope 一个 head
的 `market_semantics_heads_v1` 的 store 会迁移一次，每个 head 以其 fact 所绑定的 snapshot 为键；旧表若是任何
其他形状，迁移停下而不猜测。随后旧表退役而不删除：它保留下来并挂一个拒绝一切写入的 trigger，因此更早的
binary 会发现它已存在，并在第一次 append 时失败，而不是把它重新建成空表、接受任意创世。新 store 同样带着
这张已退役的表。一个 Owner transaction 原子 append 不可变 fact/head、完整 cut、receipt、outbox 与 store
generation/append state。准确 request identity 加准确 meaning 是 idempotent；meaning 变化产生 conflict；
partial row、scalar/canonical drift、dependency splice 或 digest mismatch 使 custody 不可信。Response loss
绝不授权再次 append：recovery 只接受准确 identity/meaning locator，重新验证完整 stored aggregate，并返回
逐字节相同的 move-only readback。

既有 `ReplayReferenceFactValueV2::MarketSemantics` 是从已验证独立 readback 的五个 typed value field
得到的确定性 projection。Replay V2 保留自己的 aggregate fact/cut identity，并且只有在其 time、scope、
source 与 correction projection 与该 readback 逐字节相等后才重复这些 projection。它既不替换独立 fact，
也不会成为第二个 Market Semantics authority。

## Correction Policy 私有 Replay projection

**CURRENT：** Source Binding 拥有 correction lineage/frontier，Replay V2 已有 typed `CorrectionPolicy`
value。**TARGET：** Market Data 从准确已准入 Source Binding lineage 加已验证
`ReferenceFactCoordinatesV1` 为 Replay 确定性派生该 value；不存在独立 Correction Policy receipt、
outbox、state、locator 或 resolver。**NOT_ADMITTED：** caller 字符串、通用 policy label、单独 frontier
digest 或 Replay storage 都不能铸造 policy authority；该 projection 也不声称 implementation、provider
authenticity、production write、deployment 或 trading authority。

私有 version-1 value 是准确非空 correction-stream identity、正 `u64BE` sequence 与
`successor_only = 0x01`；false 与所有 alternate tag 均不受支持。它还绑定准确 Source Binding
identity/fact/lineage、correction-frontier digest identity、不同 frontier change 之间的一个半开 effective
interval，以及第一个已准入 version 的 provider-available、retrieval、correction-publication、
Owner-observation、decision cut、clock 和 R0 coordinate identity/digest。第一个 lineage version 建立
availability；即使其 R0 record 使用有限 replay/evidence interval，该 correction regime 仍保持开放，只有
不同 successor frontier 才能关闭它。随后携带逐字节相同 source、stream、sequence、successor-only value
与 frontier 的 version
被 coalesce 到同一 interval，且不能把 availability 提前。下一个不同 frontier 关闭前一个 interval，且
必须是 direct、sequence-advancing successor。Gap、regression、branch、cross-source splice、stream 改变却
无新 lineage，或 clock/coordinate mismatch，都不产生 projection。

确定性私有 projection domain 为 `vibe.market-data.correction-policy-projection.v1\0`。Canonical bytes 是
schema `u16BE = 1`、reserved、stream `u32BE length || bytes`、sequence、successor-only tag、Source
Binding identity/fact digest/lineage root/`u64BE` version、correction-frontier digest、effective-from 与可选
effective-until `i128BE`、四个 availability/observation coordinate `i128BE`、decision cut `u64BE`、
clock-head identity/digest 与 R0 coordinate identity/digest。Replay V2 只把 stream、sequence 与
successor-only 投影到既有 typed value，并且仅在 time/source/correction field 准确相等后重复这些 field；
其 aggregate custody 不创建第二 policy authority。

## Corporate Action 原生 Instrument Master 子权威

### 状态、输入与 typed action

**CURRENT：** Instrument Master 拥有 corporate-action term/frontier，Replay V2 已有 closed Split、
CashDividend、SymbolChange、Expiry 与 Roll variant，但尚无独立原生 Corporate Action readback。
**TARGET：** Instrument Master 是 `CorporateActionFactV1` 的唯一 writer；固定消费者是 Replay V2 与
Backtest。签发在一个 Owner transaction 中解析准确 positive Instrument Master cut/fact、已准入 Source
Binding、PIT Snapshot、shared-clock observation、correction frontier 与 `ReferenceFactCoordinatesV1`。
Caller digest、symbol、latest row 或 Replay fact 均不得替换它们。**NOT_ADMITTED：** 本契约不声称
implementation、provider ingestion/authenticity、production/default migration/write、product composition、
deployment、runtime、Dashboard 或 trading authority。

每条 fact 绑定一个非零 action identity、准确 canonical instrument bytes 与一个 closed term：

- `1 SPLIT`：正 numerator 与 denominator `u64BE`。方向固定为 post-action quantity 等于 pre-action
  quantity 乘 numerator/denominator，post-action price 等于 pre-action price 乘 denominator/numerator；
  reversal 或隐式 vendor convention 不受支持。
- `2 CASH_DIVIDEND`：signed `i128BE` mantissa、`u8` decimal scale 与非空 canonical currency identity。
- `3 SYMBOL_CHANGE`：非空 successor canonical instrument；predecessor instrument 保留为历史事实。
- `4 EXPIRY`：无 payload。
- `5 ROLL`：非空 successor canonical instrument；只记录 reference transition，不授予 order。

Fact 还绑定可选 direct predecessor、一个半开 effective interval、四个 availability/observation
coordinate、decision cut、R0 coordinate identity/digest、准确 Instrument Master readback/fact/cut digest、
PIT Snapshot identity/fact digest、Source Binding identity/fact/lineage/version、source/correction frontier 与
correction identity。Correction 是同一 action/instrument lineage 内不可变 current-head successor，不能重写
更早 observability。Predecessor 缺失、branch、cycle、sequence/frontier regression、action 或 instrument
splice、无效 ratio/currency/successor、effective ambiguity 或 clock mismatch，都在 write 前失败。

### 规范完整 census 与 custody

Fact domain 为 `vibe.market-data.corporate-action-fact.v1\0`。Bytes 是 schema `u16BE = 1`、reserved、
action identity、instrument `u32BE length || bytes`、上述顺序的 term tag 与 payload、可选 predecessor、
effective-from 与可选 effective-until `i128BE`、provider-available、retrieval、correction-publication 与
Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity/digest、Instrument Master
readback/fact/cut digest、PIT Snapshot identity/fact digest、Source Binding identity/fact digest/lineage root/
`u64BE` version、source frontier、correction frontier 与 correction identity。

Request-meaning domain 为 `vibe.market-data.corporate-action-request.v1\0`；bytes 是 schema、reserved、
closed consumer tag（`1 REPLAY_V2`、`2 BACKTEST`）、inclusive/exclusive replay-window bound `i128BE`、正
instrument count `u32BE`、严格排序的 length-prefixed canonical instrument、Owner-observation、decision
cut、length-prefixed Instrument Master、PIT、Source Binding 与 R0 locator bytes，以及 stable correlation。
Cut domain 为 `vibe.market-data.corporate-action-cut.v1\0`；bytes 是 schema、reserved、request
identity/meaning、consumer tag、window bound、Owner-observation、decision cut、R0 cut identity/digest、
Instrument Master 与 PIT cut digest、instrument count，随后是每个排序 instrument 及 action count 和按
effective start 与 action identity 排序的 action-identity/fact-digest entry，再随后是 gap count 与排序的
gap instrument。每个 requested instrument 准确出现一次。零 action 是该 instrument 的 canonical
`u32BE = 0` census，而不是 missing row 或 `NO_ACTIONS`；positive cut 的 gap 为零。

Receipt 与 readback domain 为 `vibe.market-data.corporate-action-receipt.v1\0` 与
`vibe.market-data.corporate-action-readback.v1\0`；outbox identity 等于 receipt identity，且没有 domain。
其准确 layout、write-once caller-transaction custody、sealed resolution、rejoin、response-loss recovery、ACL
与 zero-write failure rule 采用上述共享原生规则。
Replay V2 把一条 fact 一对一 projection 成既有 action identity、instrument 与 term variant，并且只在
time/source/correction 准确相等后重复这些 field。Backtest 保留相同原生 fact 与 cut identity/digest；
两个 consumer 都不得 normalize 或 synthesize term。

## Replay Market Facts V2 基础

**CURRENT / PARTIAL：** Market Data 定义了 additive、dependency-neutral 的
`ReplayMarketFactsV2` contract 与规范 codec。一个完整的第一语料 cut 包含有类型且内容寻址的 calendar-day、
session-interval、time-zone ruleset、Market Semantics、successor-only correction-policy、
corporate-action 与 historical-membership 事实；universe-member cut 包含 Market Semantics、correction-policy 与
historical-membership 事实，其余四类在何处被证明由下文 universe-member composition 一节陈述。每条事实绑定半开 effective interval、
provider-available、retrieval、correction-publication、Owner-observation、decision cut、Source identity
与 correction identity。Corporate action 携带实际 split、cash-dividend、symbol-change、expiry 或 roll
条款；historical membership 携带准确 selection、member、instrument 与 inclusion disposition。
Corporate-action 或 membership cut 可以完整地包含零个 member，但该空 census 必须是绑定准确 scope
与 decision cut 的显式内容寻址 cut；`NO_ACTIONS` 等字符串绝不等价。

一条事实只有在其 effective interval 与 Replay 窗口重叠、其 provider-available、retrieval、correction-publication 与
Owner-observation 坐标全部不晚于 snapshot 的 observation instant、且其 decision cut 不晚于 snapshot 的 decision cut
时才进入 Replay。Session 多满足一条规则，且不更严：它至少与窗口共享一个时刻；不共享的按名拒绝为
`SessionOutsideReplayWindow`（HTTP 422 `SESSION_OUTSIDE_REPLAY_WINDOW`）。Session 可以早于窗口开盘、晚于窗口收盘。
它的边界是事先排定的日程事实，不是市场观测，而且一个 session 天然包住其中的 bar，所以在窗口到达收盘时刻之前读到收盘位置
不构成 look-ahead。一条 session 事实携带四个值 - `session_identity`、`calendar_identity`、`opens_at_ns` 与
`closes_at_ns` - 每个都是 session 开盘前已知的日程边界。被修订的 session 是一条带自己 correction identity 的新事实版本，
它满足每条事实都要满足的两条检查：在 snapshot 的 observation instant 之前可得，以及 decision cut 不晚于 snapshot 的。
挡住在 snapshot 之后才决定的修订的是这两条检查，不是窗口。

V2 frontier 仅通过各 producer 的准确 identity 与 digest 引用既有 PIT Snapshot、Source Binding、
Instrument Master cut、Universe Selection、normalized observation census、V1 joined-cut receipt 与 V2
sample projection；不复制或重新解释其规范 bytes，也不创建第二权威。公共 request 只接受一个不受信
PIT locator 与半开 replay event-time interval。事实、dependency reference、census、规范 bytes 与
aggregate digest 只能通过 Market Data-private authority 进入。所得 receipt 与 readback 没有 public
constructor 或 deserializer，read port 由 crate sealed。校验会重新编码每条 fact、cut、frontier、
aggregate 与 receipt，并逐字节比较全部重复 scalar projection；canonical-byte、scalar-only 或
cross-splice 漂移都 fail closed。

**CURRENT/PARTIAL，W0/U/C custody seam：** 规范 DTO/codec、私有签发权威与 sealed readback 已实现。
Replay storage leaf 还具备 candidate-private PostgreSQL schema 与 caller-transaction storage；它只机械持久化已经验证的
readback，拒绝 identity/meaning conflict 与 corruption，并且只暴露负向 resolution，stored bytes 不能铸造
positive readback。U 增加 caller-transaction historical-membership 与原生 Universe Selection custody。C
增加完整 observation census 及其准确、未改变 V1 joined-cut receipt 的 caller-transaction custody。这些 leaf
不会自行打开或提交 pool，尚未注册为 positive product composition，也不会把 opaque dependency locator
提升为 Owner authority。

**CURRENT/PARTIAL，W3 positive composition binding：** Market Data 定义 additive sealed
`ReplayCompositionBindingV1` record、receipt、准确 receipt-payload outbox，以及一个不受信的内容寻址 locator。
其 canonical identity 交叉绑定准确 PIT request/snapshot 与 replay window、一个经过认证的
`StrategyDesignV2` identity、排序且完整的 typed-role set、durable registry 的每条 declaration 与 binding、
完整 observation census、未改变的 V1 joined cut、V4 JOINED_CUT sample projection，以及准确原生 PIT、Source
Binding、Universe Selection、Instrument Master 与 Market Semantics locator。W3 绝不接受 V2 或 V3 代替 V4
JOINED_CUT。Additive
`UntrustedReplayMarketFactsCompositionRequestV1` 只包含既有 Replay V2 request 与该准确 binding locator。
Positive issuance 从该 locator 开始，认证并逐字节验证完整 binding，要求每个 native 与 role/binding
projection 准确一致，随后复用既有 Replay V2 issuer 及其未改变的 canonical bytes、readback 与七种类
frontier。Replay storage meaning 还由 binding identity 约束。既有 unbound row 仍仅可产生负向结果：绝不
backfill、infer、按 latest 选择或通过 full scan 发现。

**CURRENT/PARTIAL，universe-member composition binding：** 上文的 W3 binding 只准入一种形状，即
exact-instrument 第一语料；角色为 universe member（scope `UniverseSelection`）的 Design 无法由它绑定，所以其
Replay V3 request 没有可携带的 binding。Market Data 为这类 Design 新增第二种 binding 形状，并逐字节保留第一种。
形状由 record 携带而绝不推断：第一语料保持 schema `u16 = 1` 与 domain
`vibe.market-data.replay-composition-binding.v1\0`；universe-member 形状是 schema `u16 = 2`，domain 为
`vibe.market-data.replay-composition-binding.v2\0`，解码后的 record 声明其形状。组成部分与其形状不一致的
record、claim 或 Replay frontier 按 composition shape mismatch 拒绝。universe-member 形状绑定准确 PIT
request/snapshot 与 replay window、经过认证的 `StrategyDesignV2`、由 universe-member 角色组成的完整排序 role set
及其每条 durable registry declaration 与 binding、准确原生 PIT、Source Binding、Universe Selection 与 Market
Semantics locator，以及 Market Data 由该 request 的 PIT batch 与该 role set 导出的 universe frame。它不绑定
observation census、joined cut、V4 projection 或 native-join attestation：它们为封存 joined cut 而存在，而
universe frame 才是证明每个（member, role）在该 cut 上恰有一个值的东西。出于下文的理由，它也不绑定 Instrument
Master，所以该形状的 record、其 Replay frontier 与解析出的 composition cut 都不携带 Instrument Master。issuance
在读取 native join 之前按 claim 的形状分支。该形状的 Replay V2 facts 携带四种类 frontier：PIT、Source
Binding、Universe Selection 与 `StrategyInputUniverseFrameV1`；第一语料保留其七种类 frontier。

durable declaration registry 准入 `UniverseSelection` scope 的 declaration。每条都对照 PIT batch、其 Source
Binding 与 frontier、batch 所指名且经 Owner 验证的 Universe Selection、batch 层面的 Instrument Master coordinate，
以及 Market Semantics 除单一 instrument 的 Instrument Master coordinate 之外的全部字段校验；其 Owner binding
digest 是 Market Data 自行导出的该 role 在该 batch 上的 universe frame 的 digest。该逐 role 的 digest 不是 Replay
frontier 携带的 universe frame，后者由 Market Data 在 Design 的完整 role set 上导出：declaration 的 digest 标明单个
role 绑定到了什么，frontier 的 frame 是 R&D 读作 `resolved_owner_inputs` 的值，两者之间不做任何比较。universe Design 在
composition 时没有可绑定的 Instrument Master 权威：它的 Instrument Master 是 R&D 首次为 native execution 绑定该
已封存 request 时，Market Data 签发的按 request 定键的 V2 cut。因此 universe role 的 Instrument Master 校验迁移到该
cut 的签发 `issue_cut_for_bound_replay_v1`：它从恢复出的 selection 自身的 included membership 取 member，所以 member
集合按构造就是 selection 的；它在 selection 的 owner observation 时刻解析每个 member 的 Instrument Master V2 fact
chain，该时刻没有 fact 的 member（`MissingFact`）或无法校验的 chain（`ChainMismatch`）会让签发按名拒绝且零写入；member
的 V2 fact 与 binding 的 PIT snapshot 所引用的 V1 readback 不一致时同样如此（`GenerationMismatch`，见下文 V1/V2 代际一致
性规则）。随后 Strategy Factory 的 initial Owner inputs（`resolve_native_replay_initial_owner_inputs_v1`）拒绝 member 与 Plan 的
selection 不一致的 cut。在两个检查点之间，任何 binding、fact 或读者都不得把 Instrument Master 字段声称或传递为已校验。
「selection 的某个 member 没有可校验的 Instrument Master fact 时签发按名拒绝且零写入」由 composition binding 以
universe-member binding 驱动该签发的 Postgres 证明断言。

R&D 从 binding 及其 Replay facts 读取的内容，以及在 universe-member 形状下各自的来源：

| R&D 读取                                  | 第一语料                                            | universe‑member 形状                                                               |
| ----------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `resolved_owner_inputs`                   | observation census 的 identity 与 digest            | 完整 role set 上的 universe frame receipt digest（BLAKE3，identity 等于 digest）   |
| `universe_selection`                      | Universe Selection dependency                       | 同一个 Universe Selection dependency                                               |
| binding locator                           | binding record                                      | 同一个 binding record                                                              |
| market data scope digest（`pit_scope`）   | 解析出的 composition cut，取自 PIT request 的 scope | 同一来源                                                                           |
| PIT snapshot、window、request identity    | Replay facts header                                 | 同一个 header                                                                      |
| Replay facts identity 与 receipt identity | Replay facts                                        | 同一来源                                                                           |
| Design identity、非空 role set            | binding record                                      | binding record；role set 绝不为空                                                  |
| Instrument Master 校验                    | registry，逐个 exact instrument                     | composition 时不绑定；按 request 定键的 cut 签发时校验每个 member 的 V2 fact chain |
| 每种依赖恰好一个                          | 七种类 frontier                                     | 四种类 frontier：PIT、Source Binding、Universe Selection、universe frame           |

R&D 读取的 `universe_selection` 是 Universe Selection Record 的 identity，它同时也是 digest。它不是 Plan 所绑定的
strategy-input universe selection；后者从一个帧 batch 的行推出，两者从不相等。Market Data 签发 Replay 的初始行情读回时，
把两者分别对照该帧已核验的 batch：strategy-input selection 必须是从 batch 行推出的 universe；Record 必须等于 batch 的
`universe_selection_digest`，因为 intake 只为 submission 所指名的 Record 接纳快照。Record 不一致时按
`UniverseSelectionRecordMismatch` 拒绝。这次比对不读 Record：同一个 batch 已经把两对键连在一起。

第一语料的 Replay facts 还携带七个 reference cut。universe-member aggregate 只携带其所绑定 authority 覆盖的三个；另外四个
在每个 member 被解析之处得到证明，而不是被丢弃：

| Reference cut         | 第一语料的 scope 来源    | universe‑member 形状                                                                                                                                                                                             |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar              | Instrument Master V1 cut | 迁移到每个 member 的 `BarScheduleFactV1`：它绑定该 member 的 calendar identity，原生 Replay 调度为每个 Master V2 member 读取它                                                                                   |
| Session               | Instrument Master V1 cut | 迁移到同一 `BarScheduleFactV1`，它绑定 session identity                                                                                                                                                          |
| Time zone             | Instrument Master V1 cut | 迁移到同一 `BarScheduleFactV1`，它绑定 time‑zone identity                                                                                                                                                        |
| Market Semantics      | Source Binding           | 同一个 cut，由同一个 Source Binding 限定 scope                                                                                                                                                                   |
| Correction policy     | Source Binding           | 同一个 cut，由同一个 Source Binding 限定 scope                                                                                                                                                                   |
| Corporate action      | Instrument Master V1 cut | 迁移到按 request 定键的 Instrument Master V2 cut：其唯一类别是封闭的 crypto perpetual，没有 split、dividend、expiry 或 roll；其签发按名拒绝任何其他类别的 member（`MemberClassCarriesCorporateActions`），零写入 |
| Historical membership | Universe Selection       | 同一个 cut，由同一个 Universe Selection 限定 scope；它也证明改名，改名在 Instrument Master V2 中记为新的 canonical instrument，而不是 correction                                                                 |

这一类别拒绝今天没有任何运行期输入可以触发，这是故意的：它对每个类别做匹配而不留通配分支，所以 Instrument Master V2
新增一个类别时，在有人于此决定它是否携带 corporate action 之前无法编译。

存储的 Replay facts 行以 `shape` 列陈述其形状，具名检查 `replay_market_facts_shape_v2` 让每行的列与之相符：第一语料行
有 joined cut 与 sample projection、没有 universe frame；universe-member 行相反，且必有 binding。该表经一次迁移达到此
形状：迁移读取系统目录，只改动确切的旧形状，把既有行回填为第一语料，遇到任何其他形状即中止。
`market_data_rd_api.lock_replay_market_facts_for_replay_v2` 返回形状与 frame；`_v1` 函数逐字节保持原文，因为在该形状
之前构建的 R&D 二进制在读取任何东西之前，会把每个 rd-api 函数的源码与自身编入的逐字比对。这样的二进制无法经 `_v1`
读到 universe-member 行：它只在已解码的 binding 下读取 facts，universe-member 行只挂在 schema 2 binding 下，而它在读取
任何 facts 之前就把 schema 2 binding 作为未知拒绝。移除 `_v1` 要等所有已部署的 R&D 二进制都改读 `_v2`。

exact-instrument 第一语料经 Instrument Master V1 解析其 instrument，而 V1 projection 无法构造原生 crypto perpetual
（`require_complete_native_crypto_perpetual_construction` 恒拒绝），所以任何 exact-instrument 形状都无法运行用户准入的
crypto perpetual；universe-member 形状是它们的路线。目前已建成：durable declaration registry 如上段所述准入
universe-member declaration，将其绑定到该 role 的 universe frame，并拒绝 role 混用两种 scope 或指名多于一个 selection
的 Design；联接单行的路径按名拒绝这种 declaration。registration 恰好针对 Design role intent 所指名的初始 PIT request
组装 universe-member role，并按名拒绝（零写入）未指名任何 request 的 Design、未知的 request、digest 不一致的 request、
head 不是 `AVAILABLE` 的 request，以及为另一个 Research request 所请求的 request；role-intent registration 从 schema 2
role intent 取该引用，attestation 从其 Design 已发布的 schema 2 role intent 取；schema 1 intent 或没有已发布 intent 的
Design 不指名任何 request，其 universe-member role 按「未指名」拒绝。universe-member Design 的 custody 由
`reread_persisted_strategy_input_universe_custody_for_update_v1` 重读：它采用 exact 重读的 claim 与锁，按已存 digest
重新导出每个 role，并封存完整 role set 的 universe frame；`resolve_pit_request_for_strategy_design_v1` 陈述该 Design
声明的 scope，两种重读都按名拒绝另一种 scope 的 declaration。有序链路以 `rd_owner` 重读它，并在该事务打开之前注册该
Design，因为 registration 经 Market Data pool 写入，而重读持有 registration 会等待的锁。该形状的 Replay facts 已建成：
其四种类 frontier 与三个 reference cut、与第一语料并存的存储、由 PIT batch 与 role set 重新导出 universe frame、拒绝
形状与其 binding 不符的 facts，以及 Instrument Master V2 cut 处的类别拒绝。该形状的 binding 已建成并已签发：一条只带
locator 的 `ReplayCompositionUniverseBindingIssuanceRequestV1` 走自己的路由
`POST /v1/replay-compositions/universe-member-issuances`，在自己的 meaning 域
`market-data.replay-composition-universe-issuance-meaning.v1\0` 下哈希；它指名 Composer attestation、PIT request、
Source Binding、Universe Selection、Reference Fact R0 record、Market Semantics 与 correction policy，此外什么都不
指名。两种 issuance body 都不指名 replay 窗口，指名了的 body 在解析时被 `deny_unknown_fields` 拒绝。窗口由 Owner
推导：从快照 R0 record 的起始事件时刻起，持续一个执行 bar - 即 Source Binding 为 Design 执行角色的标签声明的 bar -
且绝不越过 R0 的声明。执行角色是 Design 各个 join 所触发的那个角色；不声明 join 的 Design，则是唯一读 BAR close 的那个
角色；所以第一语料里 join 在一起的 `1M`、`1H` 与 session 日角色按 `1M` 触发器执行。这是 Strategy Factory 的规则
（`derive_execution_role_v2`），从同一份 Composer role-set 投影读出，其权威在 Strategy Factory：凡是 Strategy Factory
定义了该角色的 universe Design，都有一条 Strategy Factory 测试要求两者对同一个 Design 得出同一个角色。join 在一起的第一
语料（一个精确品种、一个 join、三个 close 角色）今天不在那份定义之内，所以这条规则是它唯一的定义；这是一个覆盖缺口，由
Strategy Factory 切片 T2 补上。**决策点，归 T2：** T2 把执行角色推广到带 join 的多周期 Design 之后，role-set 投影携带执行
角色的 identity，Market Data 改为读取该角色的标签，不再自行推导。各 join 触发不同角色、或没有 join 却有多个 close 角色的
Design，以 `EXECUTION_ROLE_AMBIGUOUS` 拒绝；binding 没有为其声明 bar 的标签以 `EXECUTION_TIMEFRAME_NOT_DECLARED` 拒绝；没有固定长度、
或长于 R0 声明的执行 bar 以 `EXECUTION_BAR_EXCEEDS_R0_WINDOW` 拒绝；三者都是 HTTP 422。不声明任何 bar 的 binding，
或没有 BAR 角色的 Design，只得到事件时刻本身。窗口依赖的顺序是：PIT 连同 R0、Market Semantics、角色声明，然后是
schedule。它在第一语料的两个事务与两个 challenge 中运行，但不做 native-join 读取，并原子地存下 schema 2
binding、其 Replay facts 与这次 issuance。重试返回已存字节；issuance identity 在两种形状间是同一个命名空间，并经同一个
resolve 路由恢复；带 exact-instrument declaration 的 Design 按名以 composition shape mismatch 拒绝，零写入。该形状的
Replay facts 只存在于恰为其 request、其 native authority 与其 frame 签发的 universe-member binding 之下。该形状的
resolved composition cut 不带 Instrument Master，每个需要它的 Strategy Factory 读者按名以
`InstrumentMasterAbsentForUniverseShape` 拒绝（HTTP 422 `INSTRUMENT_MASTER_ABSENT_FOR_UNIVERSE_SHAPE`）。schema 2
binding 为该 request 的 Instrument Master V2 cut 定键，与第一语料 binding 完全相同。

该 command 在 PIT request 与其 Source Binding 之外所命名的四个 locator 都由 snapshot 固定，因此调用方读取它们，而不是
重建它们。`resolve_universe_member_composition_basis_v1` 接受 snapshot locator 与 Source Binding locator，返回该
snapshot 被铸造时所基于的 Universe Selection、snapshot 自己的提交所追加的 R0 record、该 snapshot 在 binding 的
compatibility scope 中 Market Semantics 链的 head，以及由 binding 与该 R0 record 投影出的 correction policy。它像签发
那样核验每一条 record，在调用方的 transaction 中运行，只读，不加行锁。它按名拒绝：Market Data 未以 `AVAILABLE` 持有的
snapshot（`PitUnavailable`）、在另一个 binding 下铸造的 snapshot（`SourceBindingMismatch`）、它未以已准入状态持有的
binding（`SourceBindingUnavailable`），以及尚无已准入 Market Semantics fact 的 snapshot
（`MarketSemanticsNotAdmitted`）；签发仍会重新推导并核验它得到的一切。这一读取与 scope value 读取都是 Market Data 的代码，
建立在 `market_data_rd_api` 的六个授予 `rd_owner` 的 `STABLE` `SECURITY DEFINER` 函数之上，这些函数只返回已存储的
行：一个 snapshot、一个 Source Binding、一个 Universe Selection、一条 R0 record、一个 Market Semantics readback，
以及一个 scope 的各个 head。

**TARGET，持久 R&D attestation seam：** positive R&D Develop Composer transaction 将一份不可变、完整的
`StrategyDesignRoleSetReceiptV1` attestation 与 Composer aggregate、receipt 及 outbox 一起规范持久化。它绑定
准确 Research request、Composer aggregate 与
`StrategyDesignV2`、按规范顺序排列的 typed role、每个 semantic coordinate 与完整 role coverage。其内容寻址
准确 locator 在发送前已知。Replay Policy V2 composition 由 R&D-owned A1 跨两个 Owner-isolated transaction
协调。固定 `market_data_reader` 打开一个 read-only transaction，取得 Composer request 的 shared writer-key cut
lock，只调用 Composer Owner 按 locator 读取的 `SECURITY DEFINER` lock/read function，校验完整 canonical
evidence，并保持该 transaction 直到 Market terminal decision。随后 Market Data Owner 打开一个 SERIALIZABLE
transaction，证明两条连接共享同一 live primary、database、postmaster incarnation 与 advisory lock manager；固定
`market_data_owner` login principal 在任何 Market lock 或 write 前取得同一个 shared Composer cut lock。该
principal 只对自己的 `market_data_private` relation 保留 raw authority，不获得 Composer 或 R&D raw access。
Composer writer 在每次 mutation 前都必须持有匹配的 exclusive lock；因此 reader 丢失时，只要 Market
transaction 仍持有 handoff lock，就不能重新打开 mutation window。两个 principal 都不获得另一 Owner 的
raw-table `SELECT` 或 DML、role membership、generic query surface、public positive constructor/deserializer、
receipt/readback input、bearer token、cryptographic-key authority、latest/history/full scan 或 cross-Owner parser。
该边界保证 guarded window 内 Composer evidence 稳定以及 Market write 原子性；它不声称 shared XID、MVCC
snapshot 或 cross-Owner atomic commit。

**TARGET / NOT_ADMITTED，密封 R&D Replay request read：** 选择 EVENT 前，既有 `market_data_owner`
SERIALIZABLE transaction 通过固定 R&D `lock_sealed_exploratory_replay_request_for_market_data_v1` facade
解析一组准确 request/meaning/receipt/seal locator。facade 及其
V2/V1 verifier chain 由隔离的 `NOLOGIN` `rd_exploratory_replay_api_owner` 拥有；Market Data 只获得 facade
执行权，不获得 R&D raw relation grant 或 role membership；routine owner 也没有任何 table-level 或
column-level mutation privilege。caller 保持 request-scoped transaction advisory
shared fence；它与 R&D writer-exclusive fence 配对，并由 SERIALIZABLE 提供稳定 read snapshot。返回的 request
仍属于 R&D authority，且不提供 event selector。隔离 PostgreSQL acceptance 仍须证明准确 positive bytes、
request-fence retention、wrong role/isolation/locator rejection、runtime replacement denial、controlled
owner-drift rejection 与 zero writes。

W3 issuance 只接受该不受信 R&D attestation locator 与准确 Market dependency locator。Market Data 在内部校验
恢复的 attestation，随后独立重新解析每条持久 registry declaration、完整 observation census、未改变的 V1
joined cut、V4 BAR JOINED_CUT sample projection、R0 与独立 Market Semantics record，并要求 Market Semantics cut 指向准确恢复
的 R0 cut。它不消费 `StrategyPlanV2`，也不依赖 R&D。Binding record、receipt 与 receipt-payload
outbox 与未改变的 Replay V2 fact、receipt、outbox row 原子持久化；按准确 binding locator 的 recovery 会
decode、rehash、cross-check 两套 custody aggregate，并返回逐字节相同的 payload。response loss 后按准确
attestation locator recovery 会 join 既有 R&D attestation 而不 append。公共边界不接受 resolver、authoritative
receipt/readback、role list、count 或 token，且任何 caller representation 都不能铸造 positive role set。

**NOT_ADMITTED：** 该 target 不证明 R&D persistence/read function、其 database ACL、registered W3 composition、
disposable PostgreSQL Owner readback、deployment、production write、runtime 或 trading authority。

**TARGET：** admitted deployment 与隔离 disposable PostgreSQL acceptance 必须证明准确 replay、
response-loss recovery、successor-only
correction，以及 move-only R&D 与 Backtest consumer 路径。

**NOT_ADMITTED：** 已实现 storage、custody 与固定 API composition 不是 admitted store、隔离 PostgreSQL
acceptance、provider ingestion/authenticity proof、default product composition、R&D
或 Backtest consumer、runtime execution、production write、deployment 或 trading authority。它们不会把
既有准确二成员 Universe receipt 当作通用 Universe Selection Record，不会以 V2 codec 替换 V1 joined-cut
codec，也不允许 Source Binding rule string 或通用 `version = "v2"` 标签冒充规范 fact cut。

## Instrument Master Owner 契约

### Public Fact V2 原生 projection foundation

**CURRENT/PARTIAL：** `InstrumentMasterFactV2` 是 additive、无 effect 的 public-fact kernel，首个范围只
覆盖 crypto-perpetual native projection。它不重新解释或改变任何 V1 fact、cut、receipt、readback、database
grammar 或 stored byte。Fact 绑定规范 instrument/venue/raw-symbol identity、闭合 crypto-perpetual class、
准确 public contract term、direct predecessor 与正 correction sequence、原始 raw-snapshot provenance、
最新 raw-delta provenance、canonical bytes，以及 domain-separated content identity。

V2 identity 是 `BLAKE3-256("VIBE_INSTRUMENT_MASTER_PUBLIC_FACT_V2" || 0x00 || bytes)`。Bytes 使用
big-endian，依次从 schema `u16 = 2`、reserved `u16 = 0`、canonical identity、venue identity、raw symbol、
closed class、optional predecessor fact digest、correction sequence、baseline provenance、optional latest delta
开始，随后按声明的 struct order 编码完整 materialized term set。Text 是 `u32 length || UTF-8`，digest 为
32 bytes，optional tag 为 `0`/`1`，`FactValue` tag 依次为 `1 VALUE`、`2 UNBOUNDED`、
`3 NOT_APPLICABLE`、`4 UNAVAILABLE`，boolean 为 `0`/`1`，time 与 decimal mantissa 为 signed `i128`。
Unknown tag、nonzero reserved、trailing byte、超限 text/record、无效 UTF-8、zero provenance digest 或
non-canonical decimal 均被拒绝。

每个 public term 准确使用一个 `FactValue`：`VALUE`、`UNBOUNDED`、`NOT_APPLICABLE` 或
`UNAVAILABLE`。后三种状态互不相同，不得折叠成 `None`、zero、one、false 或其他 constructor default。
Decimal 使用 signed `i128` mantissa 加 `u8` scale 的最小 trailing-zero 表示，不使用 floating point。
Public fact 明确排除 maker/taker fee、initial/maintenance margin、account-specific commission schedule、
leverage bracket 与所有 execution-profile authority。

本 slice 唯一获准的 source composition 是一个 raw public `exchangeInfo` baseline，随后接零个或多个 raw
public `!contractInfo` delta。每个 artifact 都绑定准确已准入 Source Binding identity/digest 与 raw payload
digest。Delta 还绑定 canonical instrument、prior raw-event digest、紧邻下一 correction sequence、provider
event time、retrieval time、Owner observation time 与 field-wise patch。省略的 patch member 保留
baseline/materialized value；存在的 member 替换完整 `FactValue`，包括 non-value state。首版 delta grammar
只接纳 `!contractInfo` 携带的 public contract-status member；currency、inverse semantics、executable filter、
multiplier、lot 与 limit 仍由 baseline 拥有。Source、instrument、
raw predecessor、sequence 或 observation-time 不匹配时拒绝 successor。Provider `serverTime` 不是 event 或
provenance authority，不进入 fact。Price/quantity precision 与 increment 只能来自可执行 price/lot filter，
不得使用 display-precision field。Baseline `effective_from` 是独立于 `serverTime` 的明确 Owner-admitted
coordinate；native `ts_event` 使用该 coordinate 或最新 delta event time，`ts_init` 使用与之匹配的 Owner
observation。

`validate_native_crypto_perpetual_public_terms` 是唯一 V2 public/native validation constructor。其
`ValidatedCryptoPerpetualPublicTermsV2` 结果没有 public constructor，并绑定准确 fact、identity mapping、
Source Binding、baseline/latest raw provenance、correction sequence、timestamp 与完整 public structural
term。Contract status、inverse semantics、base/quote/settlement currency、filter-derived precision/increment、
contract multiplier、lot size 与每个 optional limit disposition 必须全部明确，否则 fail closed。
`UNBOUNDED` 或 `NOT_APPLICABLE` 可转换为明确 absent 的 optional limit；`UNAVAILABLE` 不可转换。Filter
precision 必须等于其准确 increment scale。Token 不含 maker/taker fee、initial/maintenance margin、
commission、leverage bracket 或 execution-profile authority，也不调用或构造 `InstrumentAny`。

R&D 仍是唯一 `ReplayExecutionProfileV1` 的 sole owner。逻辑 Instrument Owner 现在另行拥有
private `InstrumentEconomicTermsFactV1` PostgreSQL 路径。该 fact 绑定准确 public instrument
identity/digest、venue、margin-account scope、半开 validity、source 与 provenance、正 revision、quote/fee
currency、正且准确的 maker/taker rate、正且准确的 initial/maintenance rate，以及封闭的
`STANDARD_NOTIONAL_RATE` 语义。该语义明确为不经 leverage 的 `notional * rate`，只可映射到原生
`StandardMarginModel`；V1 不猜测 `LeveragedMarginModel`。

Fact 与 deterministic receipt 原子提交。完全相同的 meaning 与 bytes 重放不写入，并返回相同 locator 与
bytes。恢复只接受准确 fact-and-receipt locator，重新校验 canonical bytes、custody 与 ACL closure；任何
missing、partial、conflicting、cross-spliced 或 tampered storage 都在返回 move-only readback 前失败。该
private fact 不是通用 public Instrument Master truth，也不改变任何 V1 或 public V2 bytes。

对于 Native Replay 初始组合，Instrument Owner 还在 canonical fact 旁维护 Owner-private derived selection
index。一个固定只读操作消费不可伪造的 `InstrumentMasterReadbackV2`、Replay profile 的 venue 与 common quote
currency，以及封存 request 的 start event time。Instrument Owner 从 Master V2 readback 派生两个 canonical
member identity 与 public fact digest，并从自身匹配 fact 派生 account scope。只有在同一 shared account scope
下恰好存在一个完整且有效的 pair 时，才为每个 member 返回一个准确 readback。missing、overlapping、corrupt
或多个完整 pair 全部 unavailable。调用方不提供 account scope、economic-terms locator、latest selector、
pool 或 replacement store。

R&D 只能从该 verified Owner readback 铸造其 move-only economic provenance，并且还必须匹配
venue、account scope、event time、currency 与全部可见 economic profile value。Market Data public-fact
module 仍不 import R&D，也不 validate、copy、select 或 issue replay economic value。

**CURRENT/PARTIAL，持久 public V2 custody 与固定 Native Replay resolution：** Market Data 拥有
additive `InstrumentMasterFactV2` store、不可变 content-addressed cut、原子 receipt/outbox，以及 move-only
exact-locator readback。首个 consumer 是准确 `BACKTEST_OWNER_V1` Native Replay 纵向切片；其 cut 按规范
instrument-identity 顺序准确包含两个不同的 canonical crypto-perpetual instrument。每个 entry 绑定完整 V2
fact bytes/identity、direct predecessor、correction sequence、baseline/latest-delta provenance、Source Binding
identity、venue/raw-symbol mapping 与完整 public term set。V1 fact、cut、receipt、readback、table、codec 与
resolver 行为保持逐字节独立。

Cut issuance 只接受固定 consumer role、R&D-owned request identity 与 decision cut，以及准确 Owner-sealed
双成员 universe-selection readback。Market Data 在该 cut 内部解析两条 public fact chain，并返回新的准确
V2 cut locator/readback。Request 不能携带 fact bytes、fact digest、symbol、member order、store/pool 或 latest
selector。仅在首次 composition 时，固定 resolver 从规范 sealed R&D Replay request identity 派生域分隔 request
key，并解析该 key 下唯一的 cut。R&D 将返回的四坐标 cut locator 封存进其 request binding 后，后续 exact
resolution 只接受该 locator。

这份初次 cut 在 R&D 首次为 sealed Replay request 绑定 native execution input 时签发，而不是在
replay-composition issuance 期间签发：composition binding 在先，sealed R&D request 引用它，因此签发 binding
时 key 所依据的 request identity 还不存在。Bound-replay issuance 只接受该 sealed request identity，以及 R&D
自己的 sealed V3 记录所携带的准确 composition-binding locator。Market Data 恢复该 binding 已绑定的 Universe
Selection，取其 decision cut，并在一笔 Owner transaction 中追加 cut，同时写入一条一次性记录，载明该 request
key 是在哪个 binding 下签发的。相同 key 与相同 binding 再次签发时，以零 append 返回已存储的 cut。相同 key 配不同
binding 时按名拒绝且零写入，即使两个 binding 共用同一个 selection 也是如此，因为 cut 自身的幂等只比较
selection。Market Data 无法验证该 identity 确实指向一份 sealed R&D request：信任边界是持有 Market Data owner
凭据的固定 writer 进程；在错误 binding 下签发的 cut 会被 R&D consumer 拒绝，其 selection 与 member 检查失败即
关闭。该签发与 R&D 的 repeatable-read binding transaction 分开提交，因此 cut 提交后 R&D 一步失败时，重试会复用
这份 cut。它读取 binding 与 selection 时不加行锁，也从不调用 R&D，因此不会等待 R&D 未结束事务所持有的锁；它通过
store 的表锁，同其他所有 Instrument Master V2 写入与解析串行执行；每笔事务在第一次读取之前先取得表锁，因此其快照
已能看到前一个持锁者的提交。

Resolver 必须在一个固定 Owner snapshot 中 decode 并 rehash cut 与两份 fact，证明准确 membership/order，
沿每条 direct-predecessor link 无 gap、无 branch 地回到绑定 baseline，重新校验当前 store admission 与 reader
ACL，然后返回一份 move-only readback。任一 missing、extra、duplicate、reordered、noncanonical、
cross-spliced、tampered 或 ACL-drifted row 都不产生 readback。按准确 locator 的 replay 与 response-loss
recovery 以零 append 返回逐字节相同的历史 bytes；相同 identity 对应不同 bytes 时 conflict。

Fact/cut/receipt/outbox 创建是 append-only 且 failure-atomic。只有固定 Market Data writer 可以创建或推进
public V2 custody；固定 consumer 只能获得准确 resolver 的 `EXECUTE`，没有 raw table privilege。Market Data
不解析 private `InstrumentEconomicTermsFactV1`、Strategy Input universe frame、BAR schedule、replay profile
或 R&D request binding，也不组装跨 Owner execution-input aggregate。

**NOT_ADMITTED：** 本契约仍不声称 provider parser/call、authenticated ingestion、已完成 migration、
已准入 default/production database write、registered product composition、deployment、
runtime execution、production effect 或 trading。private economic 路径不会提升这些 public-fact 声称，也不
构造原生 instrument。

### 状态与固定消费者

**CURRENT/PARTIAL：** Market Data 已实现下文描述的原生 `InstrumentMasterFactV1`、
`InstrumentMasterCutV1`、write-once receipt/outbox、move-only `InstrumentMasterReadbackV1`，以及面向准确
`BACKTEST_OWNER_V1` role 的 sealed PostgreSQL resolver/recovery 路径。PIT 与 Strategy Input 产品路径仍携带
request 提供的 `instrument_master_digest` 并与 Owner-verified batch 比对，下文准入的切片将其退役；代表性 R&D 路径仍冻结 data-Owner role 字符串与 AAPL/MSFT fixture。这些旧 provenance、role 与 mapping 路径不能替代原生权威，也
不证明产品已消费该权威。

**TARGET：** Backtest 产品直接消费既有 Owner-sealed resolution，并以它替换旧 digest 与硬编码 R&D role/mapping 路径。R&D 声明研究 scope，Strategy compiler 消费该 resolution，但两者均不得直接
查询 Instrument Master storage、维护 symbol-to-instrument 或 venue mapping，也不得合成 resolution。

准入该消费是对本 Owner 密封读契约的变更，不是访问控制变更。Backtest 将要消费的那份 resolution 已经存在，
所以障碍不是缺一个函数。本 Owner 对外读 schema 中的每个函数都在密封函数自身内部绑定其许可调用者，
而不仅通过 schema 与 execute 权限，作出判定的是密封函数体。因此单独授予权限不打开任何通路。
持有权限但并非被绑定调用者的一方收到的是空结果而非权限错误，于是在调用点上未授权的读者与缺失的事实
不可区分，而契约把缺失收据当作证据的消费方会把一扇关着的门记成一处数据缺口。任何准入第二个消费 Owner
的提案都按该契约变更定级，并须说明它改写的是哪一处调用者绑定。

**CURRENT / PARTIAL，生产 Instrument Master V1 intake：** 一个 Owner-sealed admission port 与一条路由
`POST /v1/market-data/instrument-master-facts`，Operations 经它为准确的 `BACKTEST_OWNER_V1` role 提交
`InstrumentMasterFactProposalV1`；Owner 经不变的 write-once fact/cut/receipt/outbox 路径解析并 append，重放的
proposal rejoin。提交指名该 fact 所观测时依据的已准入 Source Binding，不再陈述 Market Semantics
Compatibility identity、source frontier 与 correction frontier：Owner 从该 binding 取出这三者，scope 的推导与 Market Semantics
admission 相同，因此任何提交都无法陈述一个没有 binding 声称的 scope。Owner 未以恰为该 locator 的已准入状态持有的 binding，
按名以 `INSTRUMENT_MASTER_SOURCE_BINDING_UNAVAILABLE`（HTTP 409）拒绝，不写入任何东西。同一切片内，PIT intake 以 Owner 自己在该请求 instrument scope 与 decision cut 上的 durable
readback 盖章 `instrument_master_digest`，于是 request 提供的值只是 Owner 覆盖或拒绝的 claim，绝不是它照抄的
fact。一次性 PostgreSQL 链路把两半都证明了：重放的提交 rejoin 同一条 fact、没有已准入 fact 的成员一个快照也铸不
出、持久化的请求带的是 Owner 的 readback digest 而不是调用方的。除这条 intake 与那次盖章外不声称任何事。**NOT_ADMITTED：** 本状态不声称 provider ingestion/authenticity、deployment、
Dashboard 工作、Backtest 动态产品验收、inverse/quanto target-consumption 语义或交易。只要准确 Instrument Master evidence 支持 canonical fixed/session bar，BAR
custody 本身不区分 instrument class。caller-carried digest、看似规范的字符串、静态 fixture、transport
success、仅 Owner test 或文档检查都不能声称产品闭合。

**CURRENT / PARTIAL，生产 Instrument Master V2 baseline intake：** 一个 Owner-sealed admission port 与一条路由
`POST /v1/market-data/instrument-master-v2-facts`，Operations 经它提交一个 instrument 第一份 V2 fact 所依据的原样公开
`exchangeInfo` payload。路由的守卫与 V1 intake 完全相同：请求必须带 API 持有其 digest 的 Product Edge bearer token
（`market_data_pit.rs` 中的 `authorized(&headers, &state.token_digest)`），否则在读 body 之前就以
`UNAUTHORIZED_PRODUCT_EDGE`（HTTP 403）拒绝。它是 `market_data_instrument_master_v2.facts` 在生产上唯一的写入者，
request-keyed 的 V2 cut 读的就是这张表；它和 V1 intake 一样，在 Owner 自己的进程里以 `market_data_owner` 运行。该角色拥有
这个 schema 及其六张表，store 在每次写入时断言没有别的角色在这些表上持有任何权限，所以这条 intake 不需要授权，也不得被
授予权限。

- **提交陈述什么：** raw symbol、以规范词写出的 class、取得时刻、条款所依据的原样 `exchangeInfo` 文本（一份完整响应，
  或包住该 instrument 条目的一个外壳），以及取得 payload 时所依据的已准入 Source Binding。它不陈述规范 instrument identity、venue、条款、生效时刻、任何 digest，也不陈述
  Owner-observation 时刻。唯一准入的 class 词是 `CRYPTO_PERPETUAL`，也是 V2 仅有的 class。
- **Owner 的场所常量表：** 所指名 binding 的 `adapter.dataset_mapping` 作为一个完整字符串精确比较，选中一张封闭表中的
  一行。表中只有一行 `usdm/exchangeInfo`，它给出 venue identity `BINANCE`、inverse `false`、contract multiplier `1`，以及
  规范 identity 的写法：raw symbol 后接 `-PERP.BINANCE`。这一写法与 Instrument Master V1 永续 fact 所用的逐字节相同（raw
  symbol `BTCUSDT` 对应 `BTCUSDT-PERP.BINANCE`），也与继承来的适配器的 instrument identifier 相同，所以任何提交都无法把
  一个 symbol 的条款挂到另一个 instrument 名下。
  不解释该字符串的任何前缀或分段，也不用 binding 的 endpoint identity，因为换一个镜像就能改变它而不改变产品。
- **Owner 从 payload 推出什么：** 它严格解析这些字节，要求恰好一个 `symbols[]` 条目，其 `symbol` 与 raw symbol 逐字节相等、
  `contractType` 为 `PERPETUAL`。生效时刻取该条目的 `onboardDate`，每一项公开条款都来自它的 filter，全部经由同一个函数
  `owner/instrument_master_v2.rs` 中的 `ExchangeInfoBaselineV2::from_usdm_exchange_info`。该函数是下表映射的唯一定义；下表
  只描述它，不定义它。

  | V2 条款                             | 取自条目                                                                   |
  | ----------------------------------- | -------------------------------------------------------------------------- |
  | 生效时刻                            | `onboardDate`，毫秒，换算为纳秒                                            |
  | base、quote、settlement 币种        | `baseAsset`、`quoteAsset`、`marginAsset`                                   |
  | contract status                     | `status` 原文；非 `TRADING` 照录，不拒绝                                   |
  | price increment                     | `PRICE_FILTER.tickSize`                                                    |
  | quantity increment、lot size        | `LOT_SIZE.stepSize`                                                        |
  | price、quantity precision           | 规范化后 tick 与 step 的 scale                                             |
  | 最小与最大价格                      | `PRICE_FILTER.minPrice`、`maxPrice`；`"0"` 为 `UNBOUNDED`                  |
  | 最小与最大数量                      | `LOT_SIZE.minQty`、`maxQty`；`"0"` 为 `UNBOUNDED`                          |
  | 最小名义                            | `MIN_NOTIONAL.notional`；`"0"` 为 `UNBOUNDED`，filter 缺失为 `UNAVAILABLE` |
  | 最大名义                            | `UNBOUNDED`：没有 filter 限制单笔订单的名义                                |
  | venue、inverse、contract multiplier | Owner 场所常量表中的那一行，不取自 payload                                 |

  十进制只接受由数字组成、可带小数部分的写法，去掉小数部分的尾随 0 后规范化；指数写法、正负号、空串一律拒绝。数量界是
  `LOT_SIZE` 的限价单界；`MARKET_LOT_SIZE` 不映射。precision 取规范 scale，所以 `"0.10"` 的 tick precision 为 1。继承来的
  Binance 适配器（`crates/adapters/binance/src/common/parse.rs`）按原字符串取 precision，得 2。两者的 increment 相等，这处差异
  是有意的：V2 的 native 投影要求 precision 等于规范 scale，下游 Replay 用的是 V2 的。适配器一侧的一条对照测试同时断言
  increment 相等与这一处差异。
  最大名义是单笔订单的上限，也就是 native `max_notional` 的含义。`exchangeInfo` 列出了场所施加的全部订单 filter，没有一条限制名义，
  所以这一项是 `UNBOUNDED`，与适配器的 `None` 一致。leverage bracket 按账户限制某一杠杆下持仓的名义，是 execution-profile
  authority，不是公开条款，公开 fact 不承载它。把这一项记成 `UNAVAILABLE`，会让每个 USD-M 永续都在 native 校验处被拒，因为
  该校验不接纳任何 `UNAVAILABLE` 的 limit。
- **Owner 自己取的：** Source Binding 的 identity 与 digest，取自 Owner 以恰为该 locator 的已准入状态持有的 binding；raw
  payload digest，由 Owner 以本模块的 domain 分离 digest 对该文本的原样 UTF-8 字节计算，不信任任何现成 digest。它证明的是提交了
  哪些字节、条款由这些字节推出；它不声称这些字节就是供应方的完整原始响应，Owner 无法核实这一点；Owner-observation 时刻，即其当前
  clock head 的 decision cut，在准入事务内读取；链上位置，即 correction sequence 1、无 predecessor；以及条款依据
  `RetrievedTermsAssumedSinceListing`。V2 fact 不绑定任何 frontier：与 PIT batch 的 frontier 对账若需要，属于 cut 一侧，不
  属于这条 intake。
- **条款是回推到上市日的假定。** `exchangeInfo` 陈述的是取得那一刻的条款。所以 baseline 在 `retrieval_time_ns` 观测到它的
  条款，并在 `[effective_from_ns, retrieval_time_ns)` 上假定它们成立：上市与取得之间 tick 或 lot 的变化不被表示，对那一段的
  Replay 用的是取得时的条款。这是真钱研究的一个精度边界，不是错误。fact 自己通过条款依据说明这一点，readback 与 cut 的每个
  成员都暴露它，报告或 Qualification 可以据此把早于取得时刻的 Replay 标为按假定条款计价。要记录更早的变化需要更正
  intake，它未被准入。
- **时钟：** Owner-observation 时刻是 clock head 的 decision cut，也就是 R&D 的 Universe Selection 请求作为其自身
  Owner-observation 时刻携带的坐标，因此 cut 的规则（成员 fact 的 Owner observation 不晚于 selection 的即可观测）比较的是同一
  个时钟上的两个值。由此有两个后果。
  - fact 自身的时序要求取得时刻不晚于其 Owner observation。只有当一次 Source Binding 准入铸出更新的时钟，head 才推进；
    PIT 提交准入的是当前 head 的时钟，不移动它。生产上一份 baseline 按这个次序准入：取得 `exchangeInfo`，让一次 Source
    Binding 准入把 head 推过取得时刻，然后提交。
  - 在同一个 decision cut 上，准入之前签发的 cut 与之后签发的 cut 答案不同：前者找不到 fact，后者解析到它。cut 按请求键
    写一次，所以同一个请求的答案永不改变，但若两次请求之间发生了准入，同一坐标上的两个请求可以不一致。
- **重放：** 若提交推出的 fact 等于该 instrument 已存的 baseline（按该 baseline 自己的 Owner-observation 时刻读取），就
  rejoin 它并返回同一个 terminal：terminal 带规范 identity、fact identity、Owner-observation 时刻与条款依据，这些都在已存的
  fact 里。Owner 盖上的时刻不属于调用方表达的含义，所以时钟推进之后的重放仍然 rejoin。两份相同的提交同时到来，都以同一个
  baseline 作答，因为事务在读之前就取 V2 store 的表锁，与状态 delta intake 一样。
- **拒绝，均按名给出，且不写入任何东西；每条都说明今天什么提交会走到它：**
  - `UNAUTHORIZED_PRODUCT_EDGE`（HTTP 403）：请求未带 Product Edge bearer token。
  - `MALFORMED_TYPED_REQUEST`（HTTP 400）：body 不是该提交，包括含任何未知字段。
  - `INSTRUMENT_MASTER_V2_UNSUPPORTED_CLASS`（HTTP 422）：`CRYPTO_PERPETUAL` 之外的任何 class 词，例如 `EQUITY`。
  - `INSTRUMENT_MASTER_V2_UNSUPPORTED_VENUE`（HTTP 422）：所指名 binding 的 dataset mapping 在场所常量表里没有一行，例如
    `coinm/exchangeInfo`。
  - `INSTRUMENT_MASTER_V2_DATASET_MISMATCH`（HTTP 422）：选中的条目带 `contractSize`，这是 COIN-M 条目的形状，与 binding
    的数据集矛盾；Owner 拒绝，不在两者之间挑选。
  - `INSTRUMENT_MASTER_V2_SYMBOL_ABSENT`（HTTP 422）：没有 `symbols[]` 条目带这个 raw symbol。
  - `INSTRUMENT_MASTER_V2_SYMBOL_AMBIGUOUS`（HTTP 422）：不止一个条目带它。
  - `INSTRUMENT_MASTER_V2_CONTRACT_TYPE_UNSUPPORTED`（HTTP 422）：条目的 `contractType` 不是 `PERPETUAL`，例如
    `TRADIFI_PERPETUAL` 或交割合约。
  - `INSTRUMENT_MASTER_V2_ONBOARD_DATE_UNAVAILABLE`（HTTP 422）：条目没有 `onboardDate`，或它晚于取得时刻。
  - `INSTRUMENT_MASTER_V2_FILTER_UNAVAILABLE`（HTTP 422）：缺少必需的 filter 或字段、同一 filter type 出现两次，或十进制
    违反可接受的写法、在条款要求为正时不为正。
  - `INSTRUMENT_MASTER_V2_INVALID_SUBMISSION`（HTTP 422）：payload 不是 JSON 的 `exchangeInfo`，或推出的 fact 未通过其自身
    校验，例如空的 raw symbol。
  - `INSTRUMENT_MASTER_V2_SOURCE_BINDING_UNAVAILABLE`（HTTP 409）：没有 binding 以恰为所指名的 locator 被准入，例如 locator
    的 digest 与所存 binding 的不同。
  - `INSTRUMENT_MASTER_V2_RETRIEVAL_AFTER_OWNER_CLOCK`（HTTP 409）：取得时刻晚于当前 head 的 decision cut。在 head 推过
    取得时刻之前提交就会走到这里，推过之后即可成功。
  - `INSTRUMENT_MASTER_V2_BASELINE_EXISTS`（HTTP 409）：该 instrument 已有另一种含义的 baseline，例如同一 symbol 稍后
    取得时 tick 变了。条款未变、只是重新取得的，也落在这里：取得时刻与 payload digest 都属于 fact，所以重新取得是另一个
    fact 而不是重放，运维不得把它当作幂等重试。baseline 在这里从不被替换。
  - `MARKET_DATA_CLOCK_UNAVAILABLE`（HTTP 503）：Owner 没有 clock head。任何提交都构造不出它：所指名的 binding 先被核验，
    而 binding 只会与其观测时所依据的时钟一同被准入，所以持有该 binding 的 store 必有 head。它仍是一次拒绝，而不是一个假定。
  - `INSTRUMENT_MASTER_V2_ADMISSION_CONFLICT`（HTTP 409）：以算出的 identity 存着的 fact 字节不同。任何提交都构造不出它，
    因为 identity 就是规范字节的 digest；只有改动已存的行才会走到，且它被拒绝而不是被覆盖。
  - `MARKET_DATA_OWNER_UNAVAILABLE`（HTTP 503）：store 不可达、拒绝提交，或未通过其所有权与权限断言，例如有别的角色被
    授予了 V2 表上的权限。
- **证明：** Market Data PostgreSQL runner 只经生产路径证明这条 intake。时钟由一次生产的 Source Binding 提交推进，从不
  直接写 head。对没有已准入 fact 的 instrument，request-keyed cut 以 `MissingFact` 拒绝；准入之后，同一个 cut 为一个 Universe
  Selection 签发，其请求携带的是准入之后读到的 decision cut，它解析出已准入的 fact，且该成员的条款依据是
  `RetrievedTermsAssumedSinceListing`、规范 identity 是 `BTCUSDT-PERP.BINANCE`。payload 是仓库里真实的 Binance USD-M `exchangeInfo` fixture，推出的条款逐字段等于期望
  值。重放 rejoin，每一条提交走得到的拒绝都由一份以该 fixture 构造的 payload 或请求驱动一次。

**CURRENT / PARTIAL，生产 Instrument Master V2 contract-status delta intake：** 一个 Owner-sealed admission port 与一条
路由 `POST /v1/market-data/instrument-master-v2-status-deltas`，守卫与 baseline intake 完全相同。Operations 经它为一个已有
V2 fact 的 instrument 提交一条原样公开的 `!contractInfo` 事件。Owner 经 `apply_contract_info_delta` 把它追加为该 fact 的
直接后继，而这个函数的文法只改合约状态、别的一概不改。它是 `market_data_instrument_master_v2.facts` 在生产上的第二个写入者，
与 baseline intake 一样以 `market_data_owner` 运行，不需要授权。

- **按设计只改状态。** `!contractInfo` 携带合约状态、上市与交割时刻以及杠杆分档；fact 只准入其中的状态。分档属于执行画像
  权威，公开 fact 本来就排除它；tick、step、lot、multiplier、限额、币种与 inverse 语义仍归 baseline 所有。所以一条状态
  delta 永远不改变 Replay 据以定价的东西，它也不是对 baseline 条款的更正，见下文 NOT_ADMITTED。
- **提交陈述什么：** 该事件所接续的 fact 的 identity（由 baseline 或更早一条 delta 的 terminal 返回）、取得时刻、原样事件
  文本，以及接收它时所依据的已准入 Source Binding。Owner 推得出的东西它一概不陈述。
- **Owner 从事件里推出什么：** 它把文本严格解析为一个 `e` 为 `contractInfo` 的 JSON 对象。`s` 必须与 fact 的 raw symbol
  逐字节相同，`ct` 必须是 `PERPETUAL`，`st` 若出现必须是 `1`，即 USD-M 系统；`2` 即 COIN-M，与 baseline 的数据集矛盾。
  provider 事件时刻取 `E`（毫秒）换成纳秒，合约状态取 `cs` 原样。`bks`、`dt`、`ot` 与 `ps` 不被任何东西读取。
- **Owner 自己取的东西：** instrument、其规范 identity 与其 baseline 取自所指名的 fact；原始事件 digest 是本模块对文本
  精确 UTF-8 字节做的域分隔 digest；前一原始事件 digest 与下一个更正序号取自所指名的 fact；Owner-observation 时刻是其当前
  clock head 的 decision cut，在准入事务里读取。Source Binding 必须恰以所指名的 locator 被准入，且必须是该 instrument 的
  baseline 所指名的那个 binding。
- **次序：** 事件时刻必须晚于所指名 fact 已知其状态的时刻，且不晚于取得时刻；取得时刻必须不晚于 head 的 decision cut。
  baseline 知道的是取得时刻的状态，因为 `exchangeInfo` 陈述的是取得时的状态而非上市时的；delta 知道的是其事件时刻的状态；
  由下文快照 intake 准入的之后的 `exchangeInfo` 快照，在它是最新状态证据时，知道的是其取得时刻的状态。迟到的较早事件，
  包括上市之后、baseline 取得之前的事件，被拒绝，而不是盖过更新的状态。
- **链：** 所指名的 fact 必须是该 instrument 当前的 head，所以每条 delta 都说明自己接续什么，两份提交不可能都延伸同一个
  fact。cut 为每个成员解析其 selection 的 Owner observation 时刻上可观测的最新 fact，所以在同一个 decision cut 上，delta
  准入之前签发的 cut 解析出所指名的 fact，之后签发的解析出这条 delta。与 baseline 一样，cut 按请求键写一次，所以同一个请求
  的答案永不改变。
- **重放：** 若提交推出的 fact 等于所指名 fact 已存的直接后继（按该后继自己的 Owner-observation 时刻读取），就 rejoin 它
  并返回同一个 terminal，即使其后已有更多 delta。两份相同的提交同时到来也一样：事务的第一条语句就取 V2 store 的表锁，在读
  任何东西之前，所以后一份读到前一份已提交的内容并 rejoin 它。
- **已知局限：一次一个写者。** 事务是 `SERIALIZABLE`，快照由它的第一次读取决定，所以表锁在快照之前取得，每次读取都看得到
  前一个持锁者已提交的内容。这些锁让 `market_data_instrument_master_v2` 上的每一个事务串行：两个 intake、每一次 cut 签发（包括
  bound-replay 签发），以及取同一组锁的每一次 cut 解析，彼此等待。按今天手工提交的量这没有代价；每小时一次的快照归档器会
  增加它。等待变得可测量时重新评估：即观察到某个 intake、cut 签发或解析等这些锁超过一秒时。
- **代际检查不变：** 它不比较状态，所以一条状态 delta 既不引起也不消除 `GenerationMismatch`。
- **拒绝，均按名给出，且不写入任何东西；每条都说明今天什么提交会走到它：**
  - `UNAUTHORIZED_PRODUCT_EDGE`（HTTP 403）：请求未带 Product Edge bearer token。
  - `MALFORMED_TYPED_REQUEST`（HTTP 400）：body 不是该提交，包括含任何未知字段。
  - `INSTRUMENT_MASTER_V2_INVALID_EVENT`（HTTP 422）：文本不是一个 `e` 为 `contractInfo` 的 JSON 对象，或 `E` 不是非负
    整数，或 `cs` 不是 fact 能持有的状态文本。
  - `INSTRUMENT_MASTER_V2_EVENT_SYMBOL_MISMATCH`（HTTP 422）：`s` 不是 fact 的 raw symbol。
  - `INSTRUMENT_MASTER_V2_CONTRACT_TYPE_UNSUPPORTED`（HTTP 422）：`ct` 不是 `PERPETUAL`。
  - `INSTRUMENT_MASTER_V2_DATASET_MISMATCH`（HTTP 422）：`st` 出现且不是 `1`。
  - `INSTRUMENT_MASTER_V2_EVENT_AFTER_RETRIEVAL`（HTTP 422）：事件时刻晚于取得时刻。
  - `INSTRUMENT_MASTER_V2_STATUS_UNCHANGED`（HTTP 422）：`cs` 就是 fact 当前的状态。该事件只改了 fact 不持有的东西，例如
    分档，所以没有可记录的。喂入整条流的采集器每次分档更新都会遇到它，应把它当作预期内、任何重试都改变不了的跳过，而不是
    失败。
  - `INSTRUMENT_MASTER_V2_EVENT_OUT_OF_ORDER`（HTTP 409）：事件时刻不晚于所指名 fact 已知其状态的时刻：其 baseline 的取
    得时刻、最近一条 delta 的事件时刻、最近一次快照的取得时刻三者中最晚的。
  - `INSTRUMENT_MASTER_V2_PREDECESSOR_UNKNOWN`（HTTP 409）：没有 V2 fact 带所指名的 identity。
  - `INSTRUMENT_MASTER_V2_PREDECESSOR_NOT_CURRENT`（HTTP 409）：所指名的 fact 已有另一种含义的后继，例如另一条事件先被
    准入。
  - `INSTRUMENT_MASTER_V2_SOURCE_BINDING_UNAVAILABLE`（HTTP 409）：没有 binding 恰以所指名的 locator 被准入。
  - `INSTRUMENT_MASTER_V2_SOURCE_BINDING_MISMATCH`（HTTP 409）：binding 已准入，但不是该 instrument 的 baseline 所指名的
    那个。
  - `INSTRUMENT_MASTER_V2_RETRIEVAL_AFTER_OWNER_CLOCK`（HTTP 409）：取得时刻晚于当前 head 的 decision cut；head 推过它之后
    即可成功。
  - `MARKET_DATA_CLOCK_UNAVAILABLE`（HTTP 503）：Owner 没有 clock head。任何提交都构造不出它，理由与 baseline intake 所述
    相同。
  - `INSTRUMENT_MASTER_V2_ADMISSION_CONFLICT`（HTTP 409）：从所指名 fact 推出的后继不是该 fact 能接受的，例如 head 的
    decision cut 早于所指名 fact 的 Owner observation。任何提交都构造不出它：delta 就是从所指名的 fact 本身构造的，而
    head 只会前进，所指名的 fact 是在更早的 head 下观测的。
  - `MARKET_DATA_OWNER_UNAVAILABLE`（HTTP 503）：store 不可达、拒绝提交，或未通过其所有权与权限断言，或所指名 fact 的
    链解码不出来，例如某个已存的行被改过：在从中推出任何东西之前，链上每个 fact 都被重新编码并重新计算 digest。
- **证明：** Market Data PostgreSQL runner 只经生产路径证明这条 intake。baseline 经 baseline intake 从录制的 `exchangeInfo`
  fixture 准入，时钟由生产的 Source Binding 提交推进。事件按 provider 文档所载的 `!contractInfo` 形状、以 fixture 的
  symbol 构造；仓库里没有录制到的事件，证明本身会说明这一点。delta 准入之前 cut 解析出 baseline，之后 cut 解析出带其状态的
  delta。第二条 delta 之后的重放 rejoin，每一条提交走得到的拒绝都驱动一次，store 保持不变，其中包括上市之后、不晚于
  baseline 取得时刻的事件。另一个证明扣住 clock head 行，直到两份相同的 baseline 提交、之后两份相同的 delta 都在等锁，
  每一对都以一个 fact 作答。

**CURRENT / PARTIAL，生产 Instrument Master V2 `exchangeInfo` 快照 intake：** 一个 Owner-sealed admission port 与一条路
由 `POST /v1/market-data/instrument-master-v2-snapshots`，归档器或 Operations 经它为一个已有 V2 fact 的 instrument 提交
之后取回的原始 `exchangeInfo` payload。Owner 经 `apply_exchange_info_snapshot` 把它作为该 fact 的直接后继（快照后继）追
加。它是 `market_data_instrument_master_v2.facts` 的第三个生产写者，以 `market_data_owner` 运行，不需要授权。这是下文
TARGET 的第一片：cut 上的窗口选择与归档器都没有构建。

- **提交陈述什么：** 快照所跟随的 fact 的 identity、取得时刻、payload 的原样文本，以及取回它时所依据的已准入 Source
  Binding，它必须是该 instrument 的 baseline 所指名的那个。Owner 推得出的东西它一概不陈述。
- **Owner 推出什么：** 每个条款都经 baseline 自己的映射 `ExchangeInfoBaselineV2::from_usdm_exchange_info`，按该 fact 的
  raw symbol 与该 binding 数据集的场所行推出。payload 的 `onboardDate` 必须是 baseline 的：另一次上市不是这次上市的之后
  快照。fact 保存的记录是 payload digest、取得时刻与 Owner observation；binding 就是 baseline 的，不重复保存。
- **两种次序。** 快照之间有自己的次序：取得时刻必须晚于该 fact 最近一次快照的，或其 baseline 的。合约状态在 delta 与快照
  之间只有一种次序，即 fact 已知其状态的时刻，取其 baseline 的取得时刻、最近一条 delta 的事件时刻、最近一次快照的取得时
  刻三者中最晚的。只有当快照晚于该时刻时，payload 的状态才成为 fact 的状态；否则 fact 保留自己更新的状态，快照只记录它的
  条款，所以快照永远不会因为更新的状态先到而被拒绝。快照之后的状态 delta 必须晚于同一个时刻，即下文 TARGET 所命名的状态
  时刻边界。
- **条款依据。** 除状态外条款与所跟随 fact 相等的快照保持依据 `RETRIEVED_TERMS_ASSUMED_SINCE_LISTING`：条款仍是 baseline
  的，只是之后又被观察到了一次。条款不同的快照让该 fact 以及其后的每个 fact 的依据变为 `OBSERVED_SINCE_TERMS_CHANGE`，因
  为那张快照之前成立的不是这些条款。terminal 会说明快照是否改变了条款。快照不移动 fact 的事件时刻，即 native instrument
  定义里的 `ts_event`：它仍是最近一条状态 delta 的事件时刻或上市时刻，因为快照记录的是何时取得，而不是何时发生了什么变化。
- **在按窗口选择之前，cut 拒绝条款变过的成员。** cut 还不读 Replay 窗口，所以分辨不出窗口在一次变化之前还是之后。它以
  `TermsChanged` 拒绝在 selection 时刻观察到的 fact 依据为 `OBSERVED_SINCE_TERMS_CHANGE` 的成员且零写入，R&D 的
  execution-input binding 回答 `INSTRUMENT_MASTER_TERMS_CHANGED`（HTTP 409）；重试改变不了答案。窗口选择是唯一移除这条拒
  绝的切片。所有快照都重复 baseline 条款的成员仍像以前一样，解析到其最新 fact。
- **时钟。** 当 head 的 decision cut 不早于取得时刻时，快照的 Owner observation 就是该 cut。否则 intake 像 Source
  Binding 准入那样，以自己的墙钟观察铸出下一个 Owner 时钟，并经 Source Binding 准入所用的同一条路径在同一个事务里准入它，
  所以只有 fact 被追加时 head 才会移动；快照的 Owner observation 就是铸出的 cut。晚于该墙钟观察的取得时刻被拒绝。事务
  是 read committed，并像其他每个时钟写者一样，在读 head 之前先取 clock-state 锁，所以同时到来的铸时钟快照与 Source
  Binding 准入会一个接一个地作答。clock head 不需要 owner fact 来锚定：时钟托管检查只读时钟表。R&D 在前一个 head 上冻结
  的 PIT 提交随之以 `ClockEvidenceNotCurrent` 被拒绝，与任何一次 Source Binding 准入之后一样。
- **一次一个写者，以及重放。** 事务的第一条语句就取 V2 store 的表锁，与另两条 intake 一样。若提交推出的 fact 等于所指名
  fact 已存的直接后继（按该后继自己的 Owner observation 读取），就 rejoin 它并返回同一个 terminal；rejoin 永远不铸时钟。
- **F 不变。** 没有快照的 fact 保持原有编码，逐字节不变：快照后继是第三个 lineage 标签，baseline 与状态 delta 的标签没有
  动。一个单元测试钉住由录制 payload 得出的 baseline（414 字节）、它的状态后继（669 字节）与一个 baseline 上的单成员 cut，
  这些值取自快照后继出现之前的代码树，与已有的双成员 cut 钉子并列。
- **拒绝，均按名给出，且不写入任何东西；每条都说明今天什么提交会走到它：**
  - `UNAUTHORIZED_PRODUCT_EDGE`（HTTP 403）与 `MALFORMED_TYPED_REQUEST`（HTTP 400），与其他 V2 路由相同。
  - `INSTRUMENT_MASTER_V2_INVALID_SUBMISSION`（HTTP 422）：文本不是 `exchangeInfo` 对象。
  - `INSTRUMENT_MASTER_V2_SYMBOL_ABSENT`、`_SYMBOL_AMBIGUOUS`、`_CONTRACT_TYPE_UNSUPPORTED`、`_DATASET_MISMATCH`、
    `_ONBOARD_DATE_UNAVAILABLE` 与 `_FILTER_UNAVAILABLE`（HTTP 422）：baseline intake 自己的映射拒绝了该 payload，理由与
    触发它的 payload 均如 baseline intake 所述。
  - `INSTRUMENT_MASTER_V2_LISTING_DIFFERS`（HTTP 422）：条目的 `onboardDate` 不是 baseline 的。
  - `INSTRUMENT_MASTER_V2_SNAPSHOT_OUT_OF_ORDER`（HTTP 409）：取得时刻不晚于该 fact 最近一次快照的，或其 baseline 的。
  - `INSTRUMENT_MASTER_V2_PREDECESSOR_UNKNOWN` 与 `_PREDECESSOR_NOT_CURRENT`（HTTP 409）、`_SOURCE_BINDING_UNAVAILABLE`
    与 `_SOURCE_BINDING_MISMATCH`（HTTP 409），与状态 delta 相同。
  - `INSTRUMENT_MASTER_V2_RETRIEVAL_AFTER_OWNER_CLOCK`（HTTP 409）：取得时刻晚于 Owner 自己的墙钟观察。
  - `INSTRUMENT_MASTER_V2_CLOCK_MISMATCH`（HTTP 409）：head 不是 Owner 时钟能够接续的。生产上没有这样的 head：每个 cut
    都以 Owner 的 identity 与 epoch 铸出，链路的 market base 自封在 Owner 时钟上起也是如此。证明用一个在测试时钟上的
    head 驱动它。
  - `MARKET_DATA_CLOCK_UNAVAILABLE`（HTTP 503）：Owner 没有 head，或其墙钟还没越过 head。任何提交都构造不出它：baseline
    只在一个 head 之下存在，而 head 就是 Owner 自己更早的墙钟观察。
  - `INSTRUMENT_MASTER_V2_ADMISSION_CONFLICT`（HTTP 409）：store 对所指名 fact 的说法自相矛盾。任何提交都构造不出它。
  - `MARKET_DATA_OWNER_UNAVAILABLE`（HTTP 503）：store 不可达、拒绝提交，或某条已存的链解码不出来。
- **证明：** Market Data PostgreSQL runner 在以生产封装器封在 Owner 自己时钟上的 binding 之上证明这条 intake。在 head 之
  后取回的快照恰好铸出一个时钟并取其 cut，在 head 之前取回的取 head 的 cut。十条走得到的拒绝各自既不写 fact 也不写时钟，
  其中一条发生在 intake 已决定铸时钟之后。晚于已知状态的快照设定状态。放宽 tick 的快照以改变后的依据被记录，此后 cut 拒
  绝该成员且不写入任何东西，而之前签发的 cut 保持原答案。重放 rejoin 且不铸时钟，之后的快照再次铸时钟。另一个证明把越过
  一个测试时钟上的 head 的快照以 `CLOCK_MISMATCH` 拒绝，不写入任何东西。第三个证明扣住 clock-state 锁，让一次 Source
  Binding 准入、然后一个铸时钟的快照排队等它，两边都作答；若像 intake 起初那样先取 head 的行锁，它们会死锁。两份相同的铸
  时钟快照同时到来，只铸一次时钟，以一个 fact 作答。单元测试覆盖编码、两种次序、依据、归一化与后继的每条拒绝，以及把一年
  的每小时快照作为一条链解码。

**NOT_ADMITTED：** V2 fact 可执行条款的变化由快照 intake 记录下来，但没有任何 Replay 按它定价：状态 delta 按设计只改合约
状态，而 cut 在按 Replay 窗口选择之前拒绝条款被快照改变过的成员，窗口选择见下文 TARGET，没有构建。状态不是 `TRADING` 的
窗口上的 Replay 是否必须拒绝，尚未决定；今天没有任何东西拒绝它。不从 V1 fact 派生 V2，除加密永续外不准入任何 class，
Owner 场所常量表之外的 venue 也不准入，这里也不声称 provider ingestion、authenticity、部署或交易。没有任何 intake 把 V2
fact 与任何 V1 fact 比较；同时读两者的 cut 做这件事，见下一段。

**CURRENT，V1/V2 代际一致性：** 两代并存期间，同一个 instrument 在两代里各有一份描述。PIT request 指明其快照所依据
的 V1 Instrument Master readback（`instrument_master_digest`），Market Semantics admission、first-corpus Replay
composition 与 R&D 的 research scope 读的是这份 V1 readback；Native Replay binding 读的是按 request 定键的 V2 cut。
两者必须描述同一批 instrument，bound-replay 签发在写入任何东西之前证明这一点。它在自己的事务里沿 binding 的 PIT
snapshot locator 找到该快照 request 引用的 V1 readback，两者都不加行锁地读取，再把这份 readback 与它刚为 cut 解析出
的 V2 fact 逐 member 比较：

- member 集合相等：V1 readback 的 fact 与 cut 的 member 指向同一组 canonical identity；
- 每个 V1 fact 的 class 是 `CryptoPerpetual`，即 V2 仅有的 class；
- 每个 V1 fact 恰有一个 venue identity 等于 V2 fact venue identity 的 mapping，且该 mapping 的 source instrument 与
  V2 raw symbol 逐字节相同；
- V2 的 price increment、quantity increment 与 contract multiplier 都是值，且与 V1 对应条款的 mantissa 和 scale 都
  相等。两代都以规范形式存储 decimal（小数部分无尾零），所以相等的值 mantissa 与 scale 也相等，不做任何归一化。

任何不同都会让签发以 `GenerationMismatch` 拒绝且零写入，R&D 的 execution-input binding 回答
`INSTRUMENT_MASTER_GENERATION_MISMATCH`（HTTP 409）：cut 的 fact 固定在 selection 的 observation 时刻，重试改变不了
答案。在内部，拒绝会点名失败的规则：member 集合、class、缺失或有歧义的 venue mapping、raw symbol，或某个具名条款不
是值或不相等；R&D 把它记录在签发的 storage-diagnostic 坐标下。V2 条款为 `UNAVAILABLE`、`UNBOUNDED` 或
`NOT_APPLICABLE` 时拒绝而不是跳过，因为一个无法为 V1 fact 所陈述的 tick、step 或 multiplier 作保的 V2 fact 不得与之
并用；今天没有 V2 fact 走到这里，因为 intake 的映射总会给这三个条款一个值。其他条款都不比较：币种、lot、限额与状态在 V2 的形式里没有 V1 对应项，V1 的 calendar、session 与 frontier 字段
在 V2 里也没有。检查放在 cut 而不在任一 intake，因为 cut 是两代被一起读取的地方：在 V2 fact 之后才更正或准入的 V1
fact 仍会被比较。

它在每一次 bound-replay 签发上运行，而那是通往 V2 cut 的唯一生产路径。Market Data PostgreSQL runner 通过 PIT
snapshot 引用已存储 V1 readback 的 binding 驱动两种结果。chain market base 上的 universe-member composition binding，
其唯一的 V1 instrument 是股票，按 class 被拒绝且不写入任何东西。bound-replay 签发的证明在生产 PIT intake 取得的 PIT
snapshot 上签发 cut，这些快照的 V1 fact 由生产 V1 intake 准入、与 V2 fact 一致；另有一个 member 的 V1 fact tick
不同，按该条款被拒绝。每条规则的拒绝也在比较函数本身上各断言一次。

**TARGET，由归档 `exchangeInfo` 快照得出按生效时间的 V2 条款：** 快照后继及其 intake 已构建，见上文 CURRENT / PARTIAL 段
；cut 上的窗口选择与归档器未准入、未构建。V2 fact 记录的是一次retrieval 观察到的条款，并假定自上市起一直如此；cut 为每个
member 取 selection 时刻观察到的最新 fact。所以 tick 或 lot的变化永远无法表示，retrieval 之前的 Replay 按 retrieval 当天
的条款定价。本设计用证据替换这一个假定，此外不准入任何东西。

- **证据只能是归档快照。** Owner 为一个 instrument 持有的每个条款，都由 `ExchangeInfoBaselineV2::from_usdm_exchange_info`
  从某个明确时刻取回的 `exchangeInfo` payload 推导。任何提交都不陈述历史条款。允许陈述，就等于把调用方陈述的条款放回
  baseline intake 已经关闭的信任边界之内，那需要用户授权。
- **快照序列。** 一个 instrument 每个已准入的快照是一个 fact `S_i`，带 retrieval 时刻 `t_i`、payload digest 与推导出的
  条款 `T_i`；baseline 是 `S_0`。之后的快照是一种新的后继类型，位于 `!contractInfo` delta 所延伸的同一条线性链上，所以每个
  快照仍点名它所跟随的 fact。编码是追加式的：baseline 的字节以及由此而来的 identity 不变。每个快照都被记录，包括条款与
  head 相等的那个，因为不变的快照正是「在它之前什么都没变」的证据。
- **一条链上的两种次序。** 快照之间按 retrieval 排序：快照的 retrieval 必须晚于该 fact 最近一次快照的 retrieval，或其
  baseline 的。contract status 在两种后继之间只有一种次序，即 fact 已知其状态的时刻：其 baseline 的 retrieval、最近一条
  delta 的事件时刻、最近一次快照的 retrieval 三者中最晚的那个。快照也陈述状态。快照晚于该时刻时，它的状态成为 fact 的状
  态，该时刻随之移到它的 retrieval；否则 fact 保留自己已持有的更新的状态，快照只记录它的条款。所以快照永远不会因为更新的
  状态先到而被拒绝，fact 的状态始终是 Owner 手上最新证据所示的状态。不晚于该时刻的 `!contractInfo` 事件被拒绝，见下文的
  状态时刻边界。
- **序列让 Owner 能说什么**，比较范围是除 contract status 外的每个公开条款：

  | 区间                                        | 那里的条款                             | Basis                               |
  | ------------------------------------------- | -------------------------------------- | ----------------------------------- |
  | `t_0` 之前                                  | `T_0`，假定自上市起如此                | `RetrievedTermsAssumedSinceListing` |
  | `[t_i, t_j]`，其中每个快照条款相等          | 在界定它的每个快照处相等，视为其间未变 | `EqualAtAdjacentSnapshots`          |
  | `(t_i, t_{i+1}]`，`T_i` 与 `T_{i+1}` 不相等 | 未知：变化发生在其中某处               | 无                                  |
  | 最新快照 `t_n` 之后                         | `T_n`，向后假定                        | `RetrievedTermsAssumedForward`      |

- **具名性质：归档精度边界。** 两个相邻快照条款相等，即视为其间条款没有变化。一次变化及其回退若落在同一个归档间隔内，就
  看不见；这个间隔就是归档器的节奏：节奏越长边界越粗，真实变化周围的未知区间也有一个节奏那么长。
- **具名性质：状态时刻边界。** 不晚于 fact 已知其状态时刻的 `!contractInfo` 事件以
  `INSTRUMENT_MASTER_V2_EVENT_OUT_OF_ORDER` 拒绝，正如状态 delta intake 已经拒绝早于 fact 所知的事件；晚于该事件的快照现
  在也会设定这个时刻。当快照先于一条更早的事件到达 Owner 被准入时，该事件的状态并没有丢，因为快照观察到了它之后的状态，
  丢的是它的精确时刻：Owner 此后只知道状态在那张快照之前的一个归档间隔内变过。这个边界与节奏一样粗，一个在一个节奏之内送
  达每条事件的状态采集器永远不会遇到它。
- **cut 按 Replay 窗口选择。** bound-replay 签发已经会恢复 composition binding，其记录携带窗口。对每个 member，在
  selection 时刻观察到的 fact 中，若窗口相交的区间都有 basis，就取开启窗口起点所在区间的那个 fact，basis 取窗口相交各区间中
  最弱的那个（假定弱于在快照处相等）；这些区间持有同样的条款，因为它们之间若有变化就是一个未知区间。cut 仍为每个 member 持有
  一个 fact，所以任何 consumer 都不变。与未知区间相交的窗口以 `TermsChangeWithinWindow` 拒绝且零写入，R&D 的
  execution-input binding 回答 `INSTRUMENT_MASTER_TERMS_CHANGE_WITHIN_WINDOW`（HTTP 409）；重试改变不了答案。V1/V2 代际检查
  比较窗口选中的那个 fact，所以没有被相应更正的 V1 fact 会像今天一样按名被拒绝。cut 与其他 cut 一样按请求键只写一次：按向后
  假定条款签发的 cut，在之后的快照显示条款已变后仍保持原答案，之后的请求签发新的 cut。
- **增长，以及何时压缩。** 一个 baseline fact 实测 414 个规范字节。快照后继携带 baseline 的字节、其前驱的 identity 与一个
  107 字节的记录，共 553 字节；链中有状态 delta 后再多约 220 字节。按默认的每小时节奏，一个 instrument 每天增加 24 个 fact，
  每年 8,760 个，未计行开销约每年 4.8 MB。每次 cut 与每次后继准入都会解码该 member 的整条链，所以成本随链长增长：一个
  instrument 一年的每小时快照，逐个对照前驱解码，在开发机的 release 构建上约 20 毫秒，未优化构建约 120 毫秒。压缩连续条款
  相等快照的触发条件，是签发一个 member 的 cut 超过一秒时的链长；某个 member 的链超过一年时在 Linux runner 上重新测量。
- **归档器。** 专用服务 `market-data-exchange-info-archiver`，从 R&D Owner API 镜像运行，处在 Market Data Owner 的进程与
  凭据之下，经 Owner port 准入快照：不经 Product Edge，也不经在生产中未实现的 Source Intake。它从 R&D Owner API 的 Binance
  perpetual PIT client 所用的同一个具名 host（`BINANCE_PERPETUAL_PIT_BASE_URL`）取回 USD-M `exchangeInfo`，默认每小时一次；
  对每个已有 baseline 的 instrument，把该 instrument 的条目逐字节切入最小信封，在 baseline 的 Source Binding 下准入。
- **快照 intake 自己推进 Owner 时钟。** 今天 head 只在 Source Binding 准入铸出更新的时钟时移动，而没有任何东西按归档节奏
  这样做，所以在 head 之后取回的快照可能无限期等待。当 head 的 decision cut 早于快照的 retrieval 时，intake 像 Source
  Binding 准入那样，以 Owner 自己的墙钟观察铸出下一个时钟准入，并在一个事务里与 fact 一起提交；快照的 Owner observation
  就是那个 cut。retrieval 晚于 Owner 自己墙钟观察的快照被拒绝。所以 head 每个归档间隔至多移动一次。R&D 在前一个 head 上
  冻结的PIT 提交随之以 `ClockEvidenceNotCurrent` 被拒绝，并像 head 其他任何一次移动之后那样，通过读回其 correlation、在
  当前 cut 重新冻结来恢复；一次 RUN 需要反复重新冻结，就是该拉长节奏的信号。这条恢复路径今天只在注入拒绝、cut 未变的情况
  下被驱动过：有序链路的数据库是共享的、从不重置，所以那里没有条目能为其后的条目在冻结与提交之间移动 head。因此，在一个
  使用自己数据库的证明以 Owner 时钟铸出 head、让 R&D 冻结、经生产准入推进 head、并表明 R&D 恢复且在新 cut 上提交之前，归
  档器不开启。归档器按 retrieval 顺序重试被拒绝或没有应答的提交；它的健康检查在最新已准入快照早于两个节奏时失败，这个状
  态现在归档器自己就能消除。
- **F 不变。** 只有一个 baseline、没有之后的快照时，retrieval 之前的每个窗口都落在 `t_0` 之前，member 就是 baseline，
  basis 与今天相同，字节不动；快照 intake 那一片逐字节钉住一个 baseline、它的状态后继与一个单成员 cut，与已有的双成员
  cut 钉子并列。
- **顺序。** 快照后继及其 intake 已先做完，连同逐字节钉子。在 cut 按窗口选择之前，对在 selection 时刻观察到的 fact 跟随
  了改变其条款的快照的 member 按名拒绝，而不是在它们上面为任何窗口定价；窗口选择是唯一移除这条拒绝的切片。cut 上的窗口选
  择会改变 F 链路依赖的签发，所以只在 F 链路通过后开始。归档器已定义但不启动，就像 compose 文件还不运行 store-custody 脚
  本一样；运行它会让生产周期性地从 Binance 取数，这是公开读取而非交易，是否开启是用户的部署决定。status 不是 `TRADING`
  的 Replay 窗口是否必须拒绝尚未决定，不在本设计范围内。

### 原生不可变记录

`InstrumentMasterFactV1` 是按生效时间版本化的不可变 fact。它包含以下全部字段，consumer 不得替换：

- 规范 instrument identity 与可选的准确 predecessor fact digest；
- venue 与 source mapping；instrument class；以及适用的 base、quote、settlement 与 margin currency；
- price increment、quantity increment 与 contract multiplier；每项均编码为 signed `i128` mantissa 加明确
  decimal scale，不得使用 floating-point representation；
- trading calendar、session 与 time-zone identity；
- lifecycle、corporate-action、historical-membership、Market Semantics Compatibility、source 与 correction
  frontier；
- 一个半开 effective interval `[effective_from, effective_until)`；upper bound 缺失表示 open，并不表示
  latest；以及
- provider-available、retrieval、correction-publication 与 Owner-observation coordinate，并附接纳该
  observation 使用的准确 clock identity/epoch/sequence、decision cut 与完整 sealed clock-head projection。

`InstrumentMasterFactV1` 与 `InstrumentMasterCutV1` 都声明既有规范 `timeEvidenceCutKind`
`MARKET_DATA_AS_OF`，不创建新的 Time Evidence kind。每个 fact 与 cut 都绑定接纳它的既有 sealed
clock-head handoff 的完整 projection：head identity 与 digest、clock identity 与 epoch、monotonic sequence、
wall observation、decision cut、排他的 `valid-through`、restart-continuity digest、uncertainty 与 skew bound，
以及 comparison rule。新 epoch 还绑定随该 head 一同解析的唯一 direct immutable Epoch Successor Proof
identity 与 digest；只有未消费 epoch transition 时 absence 才是规范值。这些字段仍位于 fact 与 cut domain
内，不创建第五个 identity domain。

fact 内的 provider-available、retrieval、correction-publication 与 Owner-observation coordinate 都绑定其唯一
准确 sealed head。cut 内的 Owner-observation time 与 decision cut 绑定其唯一准确 sealed head。唯一
comparison rule 是 `SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`：cut head 必须是 commit 时从 Owner 直接解析的
准确 current head，其 identity/digest 与 optional Epoch Successor Proof 必须验证，restart continuity 必须已
证明，cut Owner-observation time 必须严格早于其排他 `valid-through`，且 uncertainty 与 skew 必须位于获准
bound 内。只有 fact 与 cut 的 clock identity 和 epoch 逐字节相等、fact monotonic sequence 不大于 cut
sequence、fact decision cut 不大于请求 decision cut，且 fact 的每个 availability、retrieval、correction 与
observation coordinate 都不晚于 cut Owner-observation time 时，该 fact 才在 cut 可观察。consumer 不得遍历
head 或 epoch-proof chain、跳过 predecessor 或跨 epoch 比较 sequence。head 不可用、不匹配、过期或不连续，
epoch transition 未证明，clock/epoch 混合或未知，uncertainty 或 skew 超限，sequence 或 decision-cut 回退，
以及 cut 后的 correction 或 observation 都不产生 positive result。effective-time containment 是独立的第二个
predicate。

effective time 与 observation/decision-cut time 是相互独立的双时间轴。fact 可以早于其可观察时间生效。
resolution 必须同时证明请求的 effective instant 位于半开 interval 内，且 fact 在绑定 decision cut 已可观察。
late correction 只能创建以被修正 fact 为 predecessor 的不可变 successor；它不得改写 predecessor，也不得
让 correction 在更早 cut 可用。

`InstrumentMasterCutV1` 是面向 `BACKTEST_OWNER_V1` 的 content-addressed 不可变 resolution cut。它绑定
consumer role、请求的 instrument 或 Universe Selection Record scope、effective instant、
observation/decision cut、完整 sealed clock-head projection、准确 expected canonical member set、按契约排序的
已解析 canonical identity 与 `InstrumentMasterFactV1` digest、全部必需 frontier identity，以及明确完整的 gap
set。任何带 gap 或 conflict 的 cut 都不是 positive。

每次获准 resolution 都在 Market Data write authority 下原子 append 一份 write-once receipt 及其 outbox
entry。receipt 绑定 request identity 与 meaning、`BACKTEST_OWNER_V1`、fact 与 cut digest、canonical bytes、
store commit coordinate、stable correlation 和 outbox identity。receipt 与 outbox entry 均不得 update、
replace、通过重排获得另一 identity，也不得在 durable commit 前被视为 positive。

`InstrumentMasterReadbackV1` 是 move-only 且由 Market Data 密封的记录。它携带 consumer 所需的完整准确
canonical `InstrumentMasterFactV1` record bytes 与 `InstrumentMasterCutV1` record bytes，并重复准确 request
identity 与 meaning、consumer role、派生的 fact 与 cut identity/digest、stable correlation 与 durable
receipt/outbox coordinate。普通 consumer 不能 construct、clone、deserialize、implement 或 mint 它。
response loss 后只能通过它恢复；transport acknowledgement、retry success、digest-only existence proof 或
caller 复制的旧字段都不是 readback。

### 规范身份与 codec

原生记录统一使用 domain-separated canonical binary codec 与 BLAKE3-256。准确四个 ASCII domain 为：

1. `VIBE_INSTRUMENT_MASTER_FACT_V1`
1. `VIBE_INSTRUMENT_MASTER_CUT_V1`
1. `VIBE_INSTRUMENT_MASTER_RECEIPT_V1`
1. `VIBE_INSTRUMENT_MASTER_READBACK_V1`

每个 identity 都是
`BLAKE3-256(domain_utf8 || 0x00 || canonical_record_bytes)`；其中 `domain_utf8` 准确等于上述四个字符串
之一，其内部不加 length 或 terminator。record codec 只有以下一种 wire grammar：

- `codec_version` 准确为 `0x0001`；unsigned integer 按字段指定的宽度编码为 big-endian `u8`、`u16`、
  `u32` 或 `u64`；signed decimal
  mantissa 与 time coordinate 编码为 two's-complement big-endian `i128`；decimal scale 为 `u8`；
- 每个 content identity、digest、request identity、correlation、clock identity、store-generation identity、
  clock epoch 与 frontier 准确为 32 bytes；每个 enum discriminant 为 `u16`；optional absence/presence
  准确为 `0x00`/`0x01`，只有 present 时才后接 value；其他值均无效；
- UTF-8 或 opaque byte string 是 big-endian `u32` byte length 后接准确 bytes；list 是 big-endian `u32`
  element count 后接各 element；以及
- time coordinate 是 signed `i128` Unix-epoch nanoseconds。clock sequence 与 decision cut 都是 `u64`；
  store append sequence 也是 `u64`。Uncertainty 与 skew bound 是非负 `u64` nanoseconds。interval 比较
  decoded time coordinate，不按 signed representation 的 bytes 排序。

price increment、quantity increment 与 contract multiplier 的准确数值是
`mantissa * 10^(-scale)`。mantissa 必须大于零，scale 必须位于 `0..=38`。唯一 canonical normal form 要求
`scale == 0` 或 `mantissa % 10 != 0`；因此多余的小数尾零无效。zero、negative value、超过 38 的 scale 与
non-minimal scale 都必须在 canonical bytes 进入 hash 前拒绝。

instrument-class discriminant 只能是 `0x0001 EQUITY`、`0x0002 FUTURE`、`0x0003 OPTION`、`0x0004 FX_PAIR`、
`0x0005 CRYPTO_SPOT`、`0x0006 CRYPTO_PERPETUAL`、`0x0007 FIXED_INCOME`、`0x0008 FUND`、`0x0009 INDEX`、
`0x000a COMMODITY`、`0x000b BETTING` 或 `0x000c SYNTHETIC`；其他值均 unsupported，不产生 positive
record。canonical instrument identity、venue identity、source identity、source instrument、currency、calendar
identity、session identity、time-zone identity 与 consumer role 都是按上述 string rule
编码的准确 case-sensitive UTF-8 byte string，不做 normalization。consumer role bytes 必须准确等于 ASCII
`BACKTEST_OWNER_V1`。currency bytes 是 Market Data 拥有的 currency semantic identity，不是 consumer 解析的
display code。

`InstrumentMasterFactV1` 的 field order 准确为：`codec_version:u16`、准确 UTF-8 string
`MARKET_DATA_AS_OF`、canonical identity、optional predecessor fact digest、venue/source mapping、
instrument-class discriminant、依次为 optional base、quote、
settlement 与 margin currency、price-increment mantissa/scale、quantity-increment mantissa/scale、
contract-multiplier mantissa/scale、calendar identity、session identity、time-zone identity、lifecycle
frontier、corporate-action frontier、historical-membership frontier、Market Semantics identity、source
frontier、correction frontier、effective-from time、optional effective-until time、provider-available time、
retrieval time、correction-publication time、Owner-observation time、clock identity、clock epoch、clock
sequence、decision cut、clock-head identity、clock-head digest、clock-head wall observation、排他的
`valid-through`、restart-continuity digest、uncertainty bound、skew bound、optional Epoch Successor Proof
identity、optional Epoch Successor Proof digest，以及准确 UTF-8 string
`SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`。两个 optional proof field 必须同时 absent 或同时 present。
venue/source mapping 是一个 count-prefixed list。每项 mapping 是 tuple
`(venue identity, source identity, source instrument bytes)`；mapping 必须按完整 canonical tuple bytes 严格递增，
duplicate 无效。

scope discriminant 只能是 `0x0001 EXACT_INSTRUMENT` 后接一个 canonical instrument identity string，或
`0x0002 UNIVERSE_SELECTION_RECORD` 后接一个 32-byte Universe Selection Record identity。
`InstrumentMasterCutV1` 的 field order 准确为：`codec_version:u16`、consumer role、request identity、
准确 UTF-8 string `MARKET_DATA_AS_OF`、request-meaning digest、scope discriminant 与其规定 payload、
准确 expected canonical member identity、effective instant、Owner-observation time、decision cut、clock
identity、clock epoch、clock sequence、clock-head identity、clock-head digest、clock-head wall observation、
排他的 `valid-through`、restart-continuity digest、uncertainty bound、skew bound、optional Epoch Successor Proof
identity、optional Epoch Successor Proof digest、准确 UTF-8 string
`SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`、ordered resolution、lifecycle frontier、corporate-action frontier、
historical-membership frontier、Market Semantics identity、source frontier、correction frontier 与 ordered gap。
expected member、resolution 与 gap 是三个独立 count-prefixed list。expected member 是按准确 bytes 严格递增
的 canonical identity string。对于 `EXACT_INSTRUMENT(A)`，该 list 准确等于 `[A]`。对于 Universe Selection
Record，它必须逐字节等于通过绑定 record identity 直接从 Owner 解析的完整 canonical membership set；
caller-carried list 或 digest 不能建立该集合。每项 resolution 是
`(canonical identity, fact digest)`，并按 canonical identity bytes 严格递增；每项 gap 是
`(gap-kind:u16, canonical scope bytes)`，并按完整 tuple bytes 严格递增。duplicate resolution 或
gap 无效。gap kind 只能是 `0x0001 UNKNOWN_IDENTITY`、`0x0002 AMBIGUOUS_IDENTITY`、`0x0003 OVERLAP`、
`0x0004 STALE`、`0x0005 WRONG_ROLE`、`0x0006 WRONG_CUT`、`0x0007 DIGEST_MISMATCH`、
`0x0008 CODEC_MISMATCH`、`0x0009 COVERAGE_GAP`、`0x000a STORE_UNAVAILABLE`、
`0x000b STORE_UNTRUSTED` 或 `0x000c FRONTIER_MISMATCH`。其他 scope 或 gap discriminant 以及 duplicate
resolution 或 gap 均无效。canonical scope bytes 是准确 scope discriminant 后接其规定 payload，再按 opaque
byte-string rule 包裹一次。

fact identity 与 digest 都是 fact domain 下同一份 32-byte result；cut identity 与 digest 都是 cut domain 下
同一份 32-byte result。receipt-domain record 的 field order 准确为：`codec_version:u16`、request identity、
request-meaning digest、consumer role、按 cut resolution order 排列的完整 length-prefixed canonical fact
record bytes 的 count-prefixed list、完整 length-prefixed canonical cut record bytes、store-generation identity、store append
sequence 与 stable correlation。receipt identity 与 digest 都是 receipt domain 下同一份 32-byte result。
outbox identity 定义为与该 receipt identity 完全相同；它在 hash 后派生，不编码进 receipt record，且 outbox
保存准确 receipt bytes。

`InstrumentMasterReadbackV1` 的 field order 准确为：`codec_version:u16`、request identity、request-meaning
digest、consumer role、按 cut order 排列的同一个完整 length-prefixed canonical fact record bytes 的
count-prefixed list、同一份完整
length-prefixed canonical cut record bytes、stable correlation、store-generation identity、store append
sequence、receipt identity 与 outbox identity。receipt 与 outbox identity 必须逐字节相等。readback identity
与 digest 都是 readback domain 下同一份 32-byte result。该 nested encoding 是 Owner-sealed atomic retrieval
result。expected-member list 与 ordered resolution 必须具有完全相同的 identity，每个 member 准确对应一个
resolution，不得缺失或额外存在。每个 resolution identity 必须逐字节等于 nested fact 的 canonical identity，
且每个 resolution digest 必须等于这些准确 nested fact bytes 的 fact-domain hash。consumer 使用前必须验证
这些等式，并按每个 nested record 自己的 domain 验证。

decode 必须消费全部 bytes、校验每个 reserved value 与 canonical order；任何 identity 获准前，重新 encode
必须与原 bytes 逐字节相等。JSON、map 或 map iteration、locale、display formatting、symbol 或 alias
normalization、database row order 与 evidence arrival order 都不能定义 bytes 或 identity。receipt 与
readback domain 绑定各自 record payload；outbox 保存准确 receipt identity 与 canonical receipt bytes，
不引入第五个 identity domain。

### 解析、失败与恢复

request 只有通过面向 `BACKTEST_OWNER_V1` 的当前 Market Data Owner store 才能 positive resolution。对每个
请求 effective coordinate，Market Data 先保留 half-open effective interval 覆盖该 coordinate，且类型化
`MARKET_DATA_AS_OF` evidence 满足上述准确 same-clock/epoch、sequence、decision-cut 与 Owner-observation
以及完整 sealed clock-head 比较的 fact。correction chain 中每个 predecessor 的 canonical instrument identity
必须与 successor 相同。correction 只有在形成一条完整 predecessor chain 时才可与其 predecessor overlap。
resolution 选择该 chain 中唯一 maximal observable fact，即不再是另一 eligible fact 的
predecessor 的 eligible fact。无 eligible fact、存在多个 maximal fact、branch、predecessor cycle、缺失
predecessor，或不属于同一 chain 的 fact overlap 都是 gap 或 conflict，不产生 positive result。在 cut 后才
观察到的 successor 对该 cut 必须忽略，且绝不能追溯替换 predecessor。

positive `EXACT_INSTRUMENT(A)` cut 准确包含唯一 expected member A 与唯一一项 A 的 resolution。positive
Universe Selection Record cut 准确包含该 record identity 绑定的完整 Owner-resolved membership set，并为每个
member 准确包含一项 resolution。两种情形的 gap set 都为空，每个 resolution identity 与 digest 都等于其
nested fact 的 identity 与 bytes，且每条 nested predecessor chain 都保持同一 canonical identity。member
缺失或额外存在、exact-instrument resolution 为空、membership mismatch、nested identity 或 digest mismatch，
或跨 identity predecessor 都不产生 positive cut、receipt 或 readback。

未知或含糊 identity、任何无效 overlap 或 chain、过期 fact 或 frontier、错误 consumer role、错误 decision
cut、fact/cut/digest mismatch、codec/version mismatch、membership 或 coverage gap、clock-head evidence
不可用、不匹配、过期或不连续、uncertainty 或 skew 超限，以及 store unavailable 或 untrusted 都不产生
positive cut、receipt 或 readback。

相同 request identity 加逐字节相同 meaning 会 join durable receipt，并可取得其原生 sealed readback。相同
identity 但 meaning 改变属于 conflict，不创建状态转换。effective scope、observation cut、consumer role、
frontier 或 codec meaning 任一改变都要求 successor request identity。response loss 不授权第二次 write：
恢复只能准确查找 receipt 并签发对应的 move-only `InstrumentMasterReadbackV1`。

### 必需消费与保留

PIT snapshot 创建、Universe Selection Record 求值、Strategy input binding 与 Backtest input admission 都必须
通过本 Owner 契约直接解析 Instrument Master fact。禁止 symbol、ticker、alias、latest-row、
nearest-effective、venue-default 或 consumer-maintained mapping fallback。R&D 与 Strategy compiler artifact
可以携带 sealed fact/cut projection，但不能成为 mapping authority。

每个 Backtest result 必须保留实际消费的准确 `InstrumentMasterFactV1` identity/digest 与
`InstrumentMasterCutV1` identity/digest。只携带 symbol、alias、latest Instrument Master digest 或另一 cut
的 result 不是该 admitted input 的 result。Runtime、Portfolio、Scanner 与 Execution adoption 属于独立后续
工作，不得弱化固定 Backtest consumer 契约。

## 策略 input-role binding

对于 [StrategyDesignV2 compiler](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel)，
Research 声明类型化 input role，且只有 Market Data 能把 market/reference role 解析为准确 sealed binding
receipt。receipt 把 role 绑定到与 role 无关的稳定 selection identity；后者覆盖 field semantics、instrument
或稳定 Universe Selection Record scope、timeframe/bar specification、unit、scale、Source Binding lineage
root、correction stream 与 Market Semantics identity。可更新的 PIT、snapshot、batch、frontier/version、
time、sequence、row 与 value 不进入静态 digest。它只授予数据消费，不选择策略 universe、mechanism、target、lifecycle action 或 order。

role 解析缺失、过期、含糊、不兼容或不唯一时，binding 必须 unavailable，且不生成 `StrategyPlanV2` 或
replay/runtime input。Market Data、R&D 与 compiler 均不得从 ticker、自由文本 label、alias、substring、
名称相似度、列表位置或到达顺序推断 binding。历史 Backtest 与未来获准 Runtime adapter 必须保留相同
role 与 Market Semantics 身份；不匹配时 fail closed，不能由 consumer 静默 normalize。

**CURRENT/PARTIAL，Owner-binding M1：** Market Data 只能从完整 `VerifiedPitObservationBatch`
派生一个准确含两个成员的 universe，并原子封存按规范顺序排列的 member key、不同的规范 instrument、
Owner 派生 selection identity/digest、Instrument Master digest、batch/snapshot fact、Source Binding
lineage、Market Semantics identity 以及每个请求的 `(member, role)` value。Owner 派生的静态 selection identity/digest 绑定一一对应的
member/instrument 集合、Instrument Master、Source Binding lineage root 与 Market Semantics cut；原 PIT
request universe digest 仅为动态 provenance。caller 到达顺序不影响结果。成员缺失、重复、出现第三个成员、
同一 member 对应不一致 instrument 或不同 member 复用同一 instrument，member-role row 缺失或含糊，
selection/master/semantics/lineage 任一拼接，
以及 caller `InstrumentSet` scope 都不产生 positive selection 或 frame。该状态仅表示当前 Owner-local
binding contract，不声称 compiler、shared kernel、ProgramHost、Backtest、Paper、Live 或生产成熟度。

**TARGET / IMPLEMENTATION_ADMITTED，单成员 universe：** 上述 Owner-binding、`InstrumentMasterCutV2` cut、经济条款解析、
Native Replay scheduling 与 frame sequence 在保留双成员形态的同时，也准入准确含一个成员的 universe；准入单成员
不改变任何双成员的行为或字节，cut 本来就编码了成员数。V1 scheduling receipt 因 quote cut 而发生的改变是另一项
改动，记在 quote cut 段落。这一准入及其用户授权依据，与单成员 target-set 纵向切片一起记录在 Strategy Factory
架构文档中。对于 Replay 初次组装，由固定的 Market Data writer 在 R&D 首次为 sealed Replay request 绑定 native
execution input 时，通过上文 cut issuance 段落所述的 bound-replay issuance 签发 cut。目前已建成：
`InstrumentMasterCutV2` cut 及其托管表（既有表就地迁移到新形状）、经济条款解析、Owner-binding、V1 native scheduling
seal、V2 frame evidence 与 frame sequence 已准入单成员；V1 scheduling receipt 声明其成员数，这属于报价 cut 对它的改变。
Bound-replay issuance 是通向 `issue_cut` 的唯一生产路径，其唯一调用方是 R&D 的 native execution-input binding
issuance。

**TARGET，durable Strategy Input Binding Registry：** Market Data 拥有 write-once、validated binding
declaration；每份 declaration 以准确 PIT request、`StrategyDesignV2` 与 typed input role 为 key。R&D 只能提供 Owner-authenticated Design/role intent，绝不提供或选择 member、frame 或 binding
digest。在一个 Market Data Owner transaction 中，registration 通过原生 authority 解析 PIT Snapshot、
Universe Selection、Source Binding、Instrument Master 与 Market Semantics，派生并存储 declaration/digest，
重新生成既有 V1 binding 与 frame，再原样运行既有 V1 complete-census 与 joined-cut authority。registry
registration 缺失，或 request/Design/role、membership、frame、lineage、semantics、digest 任一不匹配时，都不
生成 declaration、census、joined cut 或 replay input。该 registry 是 Replay V2 positive composition 与真实
Owner-driven R&D/Backtest consumption 的前置条件；它不是 provider registry、deployment registry
或 caller-authored data path。

**CURRENT/PARTIAL，authenticated role-set foundation：** dependency-neutral 的准确 Composer locator 与
`StrategyDesignRoleSetReceiptV1` DTO 已存在；production positive-registration seam 在接受未改变的 V1 request
前必须取得 authenticated complete role set。它校验请求的 Design、Research request、派生 role identity、每项
semantic coordinate 及准确完整的 role coverage。observation-census seam 同样要求未改变的 V1 join claim 在
complete-census/latest-not-after selection 前准确重复一个 authenticated join。既有 V1 request、binding、
receipt bytes 与准确 legacy recovery 均保持不变。**CURRENT/PARTIAL：** W3 只通过 R&D-owned、same-Composer-transaction
durable attestation 的准确 locator DB-ACL read function 接纳该 attestation，并让这条 seam 成为唯一可达的
positive path；Market Data 随后独立解析自身 registry、census、join、V4 sample、R0 与 Market Semantics authority，
再原子签发 binding。该 resolver 已注册而非仅在计划中：`/v1/market-data/strategy-input-bindings` 无条件随部署二进制
发布，其 admission 在两个 principal 均已配置时组合，而部署文件要求每次运行都提供它们。写入路径由
`postgres_replay_composition_owner_is_atomic_exact_and_observes_reader_market_transaction_overlap` 驱动：
它把 terminal 绑定到 Owner 自己已提交的 PIT request 而非 caller 的 claim，在重新 admission 时重新汇合，
并拒绝未经 attest 的 locator。**TARGET：** 一次被观察到的端到端序列。每一环都已存在且无门控：生产 Composer 的
commit function 在与 operation、receipts、outbox 同一个事务里写入 role-set attestation，默认构建选中的正是该
function；但尚未见到任何一次运行把 Composer commit 经 W3 registration 带到 Bounded Feature Program freeze。
上述证明是直接写入 Composer 行来提供 attestation 的，测试可以这样做，部署不可以，所以缺的是这个序列未被见证，
而不是它未被建造。

**TARGET，而且 schema 已经限定了可能的形状：**
`rd_develop_strategy_design_role_set_attestations_v1` 以 `request_identity` 为主键并引用
`rd_develop_operations_v2`，同时要求 `operation_receipt_identity`、`artifact_identity` 与
`canonical_plan_digest` 各自唯一。因此一份 attestation 不可能脱离"产出了 artifact 的 Composer 操作"而存在。
无论用什么授权去单独铸造它，都意味着为一件无人构建的 artifact 插入一行 operation，而那正是这条 seam 存在
所要拒绝的伪造。冻结不是障碍：`freeze` 收的是已装配好的 pair，完全不查询本注册表，链路中的 joint-freeze
证明正是在完全不接触 Market Data 的情况下通过的。障碍在 run。绑定解析在检查已声明角色集之前就调用
`resolve_pit_request_for_strategy_design_v1`，因此一个冻结程序即便一个输入角色都没有声明，也会因缺少
declaration 而被拒；而 attestation 的作用域限于单个 Design，所以第一个程序无法为第二个背书。也没有"零输入"这条退路：
`validate_declarations` 拒绝不含输入的 Design，因为至少需要一个 typed Owner-bound input。
因此这个环是那条要求的推论，而不是疏忽：每个可准入的 Design 都绑定到 Owner 验证过的 custody，
这既是 artifact 可信的来源，也正是第一个 Design 无物可绑的原因。于是每个 Design 各自成环：运行它需要 declaration，declaration 需要一份指名它的 attestation，
而这份 attestation 需要只有运行才能产出的那次 operation。

**ADMITTED，从已认证的 Design 完成首次注册：** 任何携带 program 的东西都打不开这个环。
`BoundedFeatureInputV1` 为每个输入持有 `static_binding_receipt_digest`，全零会被拒，且该值进入 program 的
规范摘要：所以 program 自身的身份就依赖这个注册表尚未签发的 receipt。冻结也逃不掉：它收的是已装配的 proposal，
而装配它需要每个角色各有一份 receipt。唯一能先于 program 存在的是 Design，这正是上一段所说的
"R&D 只可提供 Owner-authenticated Design/role intent"。因此 R&D 通过一个精确 locator 的 DB-ACL 读函数
发布这份 intent（Design 的身份与摘要、它所属的 Research request、它据以准入的 custody 摘要，
以及 R&D 从中派生的角色集），与今天暴露 attestation 的那个并列；Market Data 消费它的方式与消费 attestation
完全相同：校验覆盖，再在签发任何东西之前解析自身的 registry、census、join 与 issuance authority。
这条路径上不存在任何 program、artifact 或未绑定输入。注册仍是 write-once，因此它对一个 Design 只到达一次，
此后每一圈都由 Composer 提交治理；W3 不受影响：它接纳的仍然只有 attestation。
`POST /v1/market-data/strategy-input-bindings/from-design-intent` 就是这个消费者，有序 PostgreSQL 链路
在同一份托管、同一组角色条目上，把它与走 attestation 的准入并排见证：一个在 `composer_private` 中无人指名的 Design，
从没有任何 PIT 坐标走到本 Owner 自行解析出的那一个，且与刚刚走 attestation 的那个 Design 解析到同一个 PIT request
与同一个 decision cut；未发布的 Design 到不了任何 declaration；被就地改写的已发布行，不再能认证它当初所发布的那个 Design。
**NOT_ADMITTED：** caller-proposed Design/role/join 字段、receipt/readback/token、receipt
hash、latest/history/full scan、raw R&D table parsing 或 Market Data storage 都不能认证 Design meaning；Market
Data 不依赖 R&D，不拥有也不重新解释 Strategy Design role/join。

**TARGET / IMPLEMENTATION_ADMITTED，Research request 的 instrument scope：** R&D Owner contract 允许 Research request
以其 `ResearchInstrumentScopeV1` 指名一到两个规范 Instrument Master identity（用户于 2026-09-24 准入），并由 R&D
据此签发 Intent 的初始 PIT request。Market Data 回答该 request，从不替用户选择 instrument。具体如下：

- 固定成员 selection rule。在全部成员 rule（`[0,1,1]`）与 instrument 前缀 rule（`[0,1,2,..]`）之外，Universe Selection
  request 可以携带固定成员 rule：`[0,1,3]` 后接该 scope 的 canonical bytes，且 `selection_rule_identity` 等于 scope
  identity。无法解码为 scope 的 bytes、或任何其他 rule identity，都按无效请求拒绝。Market Data 对其当前持有的
  eligible-instrument frontier 求值，指名其他 frontier 的请求按 `UNIVERSE_SELECTION_FRONTIER_NOT_CURRENT` 拒绝。
  selection 恰好包含所请求的 identity，其余 frontier member 一律以 `RULE_FILTERED_V1` 排除。某个请求的 identity，若
  Instrument Master 在请求的各时刻上选不出生效且可观察的 fact，按 `UNIVERSE_SELECTION_MEMBER_UNRESOLVED` 拒绝；若
  frontier 中没有唯一一个 member 包含它，按 `UNIVERSE_SELECTION_MEMBER_NOT_IN_FRONTIER` 拒绝；二者都不会从 selection 中
  被丢弃而使 selection 成员变少，任何拒绝都不写入 selection。当前 frontier 是最近一次准入的 historical-membership
  frontier：每次准入都承接前一个 frontier，因此由 Market Data 而非请求方决定哪个 frontier 是当前的。membership fact 属于
  它被准入时的 frontier：为另一个 frontier 重述同一条 fact 按冲突拒绝。
- PIT 引用。R&D 通过一个读取 `resolve_research_pit_references_v1` 解析初始 PIT request 的全部 Market Data 引用，该读取在
  R&D 自己的事务里运行，R&D 不自行提供任何值。它返回当前 eligible-instrument frontier；所请求 identity 的 frontier fact
  所指名的那一条 Source Binding lineage 的 locator、lineage root、correction frontier 与 Market Semantics identity；以及
  Market Data 当前的 decision cut 连同 PIT intake 要逐字比对的 clock 证据。它不返回 Instrument Master digest，R&D 提交的
  request 也不陈述它。PIT request 所绑定的 Instrument Master readback 由 intake 自己的一次写入铸出，以 request 的
  correlation 与 event instant 为键，任何对 scope 的读取都无法复现它。因此 R&D 提交的 request 不带 Instrument Master 字
  段，也不带 claimed identity 或 digest；intake 盖上它自己的 readback digest，按它将要提交的内容 seal request 的
  identity 与 digest，并按名拒绝陈述了这三个字段中任何一个的提交，因此任何替代值（全零或其他）都不会被当作
  digest 读取。terminal 报告的 request identity 与 digest 是 Market Data 的。以下情况按名拒绝：某个 identity 不可准入；这些
  identity 的 fact 指名了不止一条 Source Binding lineage 或 correction frontier，因为一个 PIT request 只绑定一个 Source
  Binding；该 lineage 没有已准入的 head；Market Data 没有 clock head。intake 仍会重新校验 R&D 随后陈述的 Universe
  Selection 与其冻结的 PIT request，并准入一到两个成员的 scope。
- 每个 correlation 一次初始 intake。intake 对每个 correlation 至多提交一个初始 PIT snapshot。它在提交该 snapshot 的
  事务里认领该 correlation；在已被认领的 correlation 下，seal 出不同 request 的提交按名拒绝为
  `CorrelationAlreadyCommitted`，且不写入任何东西。重发已存储的提交，只有在 Market Data 的 clock head 仍是该提交切出时
  的那一个时，才会加入已提交的 terminal：intake 在查看 correlation 之前，先把提交的 clock 证据与当前 head 逐字比对，因此
  head 移动之后，任何在旧 head 上切出的提交都在写入任何东西之前按名拒绝为 `ClockEvidenceNotCurrent`，无论其
  correlation 是否已提交。intake 运行期间 head 移动的，在提交时以同一个名字拒绝。所以一次发送没有收到响应，或者被以上两种之一拒绝时，R&D 读回它的 correlation 来恢复，从不重发；只有读回
  什么也不返回时，才在当前 cut 冻结一个新的提交。
  `resolve_research_pit_terminal_by_correlation_v1` 在 R&D 自己的事务里运行，不加行锁，也不写入任何东西。它返回已提交
  snapshot 的 terminal（与 intake 当时的应答相同）以及其 request 携带的 requester；Market Data 从未在该 correlation 下提
  交过初始 intake 时，它什么也不返回。无法执行的读取，以及与其所指 snapshot 核对不上的已存储认领，都是错误，绝不是「什么
  也不返回」。terminal 陈述已提交 fact 的 disposition 及其 primary blocker：`AVAILABLE` 时没有，其余每种
  disposition 时是决定它的那一个，因此读者从不由一者推断另一者。terminal 携带 intake 盖上的 Instrument Master digest；以它 seal 已存储的提交，会重现 terminal 报告的
  request identity 与 digest，从而证明该 terminal 应答的是哪一次尝试。为这一读取进入 `market_data_rd_api` 的，是另一个
  `STABLE` 的 `SECURITY DEFINER` 函数，它返回认领记录及其所指的 snapshot。
- Requester identity。初始 PIT request 的 `requester_identity` 是对
  `vibe.market-data.pit-requester.research-request.v1\0` 后接 Design role intent 所携带的 32 字节 Research request
  identity 所做的 SHA-256；该 identity 即 R&D 对 request locator 所做的 `rd.develop.request-identity.v2` digest，
  而不是对 request identity 字符串另做的任何 digest。Market Data 从该 role intent 字段重算并比对；它从不把 requester
  反解回 Research request。
- 按引用注册。schema 2 的 Design role intent 以 `(pit_request_identity, pit_request_digest)` 指名其初始 PIT
  request。Market Data 恰好针对该 request 注册该 Design 的每个 role：它加载这一对所标识的 PIT lineage 及其 head，并在
  request 未知、digest 不一致、head 不是带 observation batch 的 `AVAILABLE`，或其 `requester_identity` 不是上述针对该
  intent 的 Research request 的值时按名拒绝，且零写入。universe-member role 以该 batch 导出的 Universe Selection
  组装；exact-instrument role 在同一 batch 中绑定其 instrument。schema 1 的 intent 不指名任何 request：其
  exact-instrument role 仍如上文各段所述按坐标解析，其 universe-member role 按名拒绝。universe-member Design 的
  Composer attestation 从该 Design 已发布的 schema 2 role intent 取其 PIT request，从不取自 attestation。
- 提前检查。R&D 在接纳 Research request 之前调用 `check_research_instrument_scope_v1`，它按顺序为每个 identity 返回一行，
  取值 `ADMISSIBLE`、`UNRESOLVED` 或 `NOT_IN_ELIGIBLE_FRONTIER`，并附上判定所依据的 frontier 与 decision cut。判定中的每
  个时刻都是 Market Data 当前的 decision cut。Instrument Master 在该 cut 上选不出唯一一条生效且可观察的 fact 时，该
  identity 为 `UNRESOLVED`；能解析、但当前 frontier 中没有唯一一条对它生效的 membership fact 时，为
  `NOT_IN_ELIGIBLE_FRONTIER`；没有当前 frontier 时每一行都是 `NOT_IN_ELIGIBLE_FRONTIER`。它在调用方的 R&D 事务内不加行锁
  地运行，且不写入任何东西。它只做提前拒绝：PIT request 处的固定成员求值仍是决定，在检查时可准入的 identity 仍可能以非
  `AVAILABLE` 的 terminal 结束。
- 两个读取的传输。两个读取都是在 R&D 事务里运行的 Market Data 代码。进入 `market_data_rd_api` 的是四个 `STABLE` 的
  `SECURITY DEFINER` 函数，它们只返回已存储的证据：Owner 的 clock head、当前 frontier 中所请求 instrument 的 membership
  fact、这些 instrument 的 Instrument Master fact，以及一条 lineage 的 Source Binding head。每个答案都由 Owner 自己的
  decoder 与选择规则决定。

目前已建成：本节中 Market Data 的一半。intake 接收不带 Owner 字段的提交，按名拒绝陈述了其中任何一个字段的提交，盖上它
自己的 Instrument Master digest 并以之 seal request；每个 correlation 只认领一次，按 correlation 的读取按上文作答。
PIT intake 准入含一个或两个 included 成员的 Universe Selection Record，
每个成员的 key 即其 canonical instrument；其他成员数或 key 在写入任何东西之前按名拒绝。按引用注册让 Design 恰好针对其
role intent 指名的初始 PIT request 注册，拒绝如上文所述。每个新准入的 frontier 取下一个准入序号，序号最大的即为当前
frontier；在编号之前准入的 frontier 永远不是当前的。固定成员 rule 及其三种拒绝、检查与引用读取均按上文作答。

Market Data 只消费、但不定义也不重新解释 R&D Owner contract 中明确规定的 big-endian canonical binary
codec；其 JSON 表示不是 canonical receipt material。registration 必须通过固定 R&D adapter 取得
byte-identical 准确 locator recovery；独立重算、重排或修改的 bytes 即使 integrity hash self-consistent，
仍然只是 caller evidence。

**仅限 SEALED_ACCEPTANCE：** 非默认编译期 Cargo feature
`sealed-strategy-input-acceptance` 只暴露一个零参数 fixture adapter，语料固定为 AAPL/MSFT 与
OPEN/CLOSE。adapter 先经过 crate-private Source Binding admission 和 PIT
prepare/aggregate/verify 权威路径，再调用正常 universe-frame binder；它不接受 caller 选择的 row、
request、locator、digest、clock、provider、persistence 或 runtime selector。默认与生产 manifest 均不
启用该 feature；即使 release build 显式启用它，该 build 也仍是隔离 acceptance artifact，绝不是生产
build。此 fixture 只证明编译期验收拓扑，不证明 PostgreSQL custody、provider 连通性、已部署 Dashboard
readiness、生产 composition 或任何交易权威。

### `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1`

**TARGET / ISOLATED_ACCEPTANCE_ONLY：** 这个被显式选择、由 request 驱动的 profile 授权最小动态 PostgreSQL
验收拓扑；它与上面的编译期 fixture 分离，绝不是默认或生产路径。只有在 Market Data 私有 Deployment
Store Admission custodian 消费 canonical management plane 在 repository、candidate、caller、consumer 与被测进程之外
预置的 immutable acceptance trust bundle 后，才可构造其 disposable PostgreSQL store。bundle 固定 environment、
signer key fingerprint、witness、credential-resolver 与 direct-measurer identity。分别执行的独立 principal 签发
signed append-only manifest/history 及其准确 current head、维护 anti-rollback witness、租赁 opaque least-
privilege credential handle、直接测量 target 并关闭 rotation fence；candidate/caller 不拥有 signer private key、
witness write authority、credential material 或 measurement authority。sealed admission receipt 交叉绑定 bundle
与每项 observation。signature、predecessor/generation、current-
head、rotation、endpoint/TLS/server/database、schema/migration/function/role/ACL、credential audience/version 与
measurement identity 必须在 repository 构造前和受保护 use boundary 再次校验时全部相等。custodian 将全部 raw
admission、credential、measurement、PIT、Source Binding、clock 与 head evidence 保留在 Market Data 内部。

输入是一个准确的 R&D Owner-issued 密封 request locator 与 receipt，绝不是 caller-authored request DTO。
Market Data 必须通过固定只读 R&D Owner port resolve 并验证 canonical request bytes digest Owner 请求者角色与
request identity；locator 标签或 Market Data 自己的证明都不充分。在一个 Market Data transaction 内，Owner
解析该 request，选择其准确 `EVENT` projection 与 native event receipt，并提交 request
到 projection/event locator 及 durable Owner readback。完全相同含义的 replay 返回逐字节相同 locator/readback
bytes；含义变化或同一 identity 不同 bytes 均冲突且零写入。restart 后解析该 locator 必须返回相同 canonical
request、projection、event identity 与 bytes。现有 Replay V2 的 `resolved_owner_inputs` content identity 只是
通用 content addressing，单独并不构成这项权威，也绝不能被静默重新解释。隔离路径必须新增一个版本化 Owner
binding receipt，在签发任何 resolver 之前交叉绑定 sealed R&D request identity、准确 Market Data projection
receipt digest 与 Owner-native event identity。

**CURRENT/PARTIAL，完整有序 EVENT corpus V1：**`StrategyInputEventCorpusV1` 是连续 replay 的新增
Market Data 边界。新增且 move-only 的 `StrategyInputEventSourceV1` 只能由从 verified PIT batch 解析出的 Owner event
frame 签发，并逐 frame 保留 snapshot identity、snapshot-fact digest、observation-batch digest、binding/value 坐标及
source/correction provenance。完整 trigger 集合由该 source 而非 `SealedReplayInput` V1 决定，caller 不能选择子集。每个成员绑定
规范 native 顺序键 `(logical_time, event_time, owner_sequence, event_identity)`、joined-cut digest、projection
receipt digest 与 native trigger identity/digest；corpus 还绑定完整 source digest、预期数量
及 domain-separated corpus digest。空集、缺失、重复、乱序、BAR 替换、跨 census、跨 request、跨 projection 或跨 native
trigger 证据都不会产生正向 corpus。现有 V1 cut/V2 projection bytes、digest、`SealedReplayInput` V1 语义、resolver 语义与历史
single-event consumer 保持不变。来自另一 snapshot 或 observation batch 的等值证据会按准确 Owner provenance 拒绝，而不是按值放行。
越过边界交给 R&D 或 Backtest composition 的唯一值
是针对该 request-selected event 的密封、只读 `StrategyInputSampleEventResolverV1` capability；insert、update、
delete、head advance、generic query、raw DSN、credential、admission receipt 或 evidence accessor 均不得越过
Owner 边界。

caller digest、DSN、fixture、fixed corpus、in-memory/temp-file writer，以及由 candidate、caller、consumer 或
被测进程派生的 signer/witness/credential/measurer 均不能铸造
request locator、resolver、event 或 readback。head、rotation、ACL、credential、measurement、request、role、
projection、event、locator 或 readback 任一缺失、过期、已取代或不匹配，都必须在 `ProgramHost` 或 Backtest
state mutation 前失败，且不产生正向 resolver 或 terminal result。成功证明只授权该 disposable profile；
它不为默认产品入口准入任何东西，后者的生产 adapter 只从部署自身的配置组合。它不证明 provider authenticity、production readiness/deployment authority、
Dashboard、Paper、Live、real trading 或其他 production write。

runtime handoff 使用既有静态 receipts 与一个 verified batch 重新解析每个 selection；frame 只携带
trigger 与动态 value receipts，不复制静态 receipt。Market Data 只有在同一个 Owner-verified
observation batch 中所选 rows 具有完全相同的 snapshot/fact/batch identity、event-effective、
provider-available 与 correction-publication time、非零 correction sequence 及 event class 时，才能签发
trigger。bar 映射为 `BAR`；quote、trade、reference、economic 与 scalar frame 映射为 `EVENT`；logical
time 取 provider-available 与 correction-publication time 的较大值；event time 取 event-effective time；
Owner sequence 取 correction sequence。stable event identity 是对这些坐标及排序后的
role/binding/row-digest 集合做 domain-separated BLAKE3 后的前 16 bytes。每份按 role 排序的 value receipt
保留原 binding digest 与 role identity，封存明确 fixed-i128 semantic、准确 little-endian bytes、scale 与
row digest，并交叉绑定 trigger 和 observation-batch digest。consumer 必须从 trigger 派生 lifecycle
envelope，不能从 caller 选择的 value 或 order key 铸造。Market Data 绝不签发 `TIMER` 或 `FILL`
trigger；在真实 Time/Scheduler 与 Execution Owner contract 分别存在前，两者都保持 unavailable。

### CURRENT/PARTIAL EVENT 与 BAR Owner custody；TARGET BAR 产品权威

Market Data 已实现版本化 `TimeframeSpecV1`、`TimeframeProjectionReceiptV1`、`SampleFactV1`、
`SampleReceiptV1`、其原生 exact-receipt resolver，以及 `POINT_EVENT` sample 与 universe sample projection 为 Replay
请求的首帧提交的 BAR sample 的 durable PostgreSQL custody。代码
还实现了 BAR schedule fact/cut/receipt/outbox/head state、已准入准确 schedule readback 与 V3 BAR FRAME
projection receipt 的 durable PostgreSQL custody。这些路径在 isolated dynamic PostgreSQL acceptance 通过后
属于 `CURRENT / PARTIAL` Owner 权威。sealed exact-digest V3 resolver core 同样属于 `CURRENT / PARTIAL`，
但固定 `STRATEGY_FACTORY_RD_OWNER_API_V1` production startup 仍会 fail closed，因为其 production admission
adapter 仍不可用。production startup 与产品或 composite 消费保持 `TARGET / UNAVAILABLE`。BAR 仍仅限完整 fixed-interval bar 与
exchange-session bar，partial bar 仍是
TARGET。Market Data 仍是所有已准入 record 的唯一 writer。所有既有 V1
binding、event、value、frame、joined-cut、row、digest 与 byte 含义继续保持权威且逐字节不变；不得删除、
合成、backfill、garbage-collect、reinterpret 或 promote 任何 V1 record。新增的
`StrategyInputSampleProjectionReceiptV2` 仍是 Owner fact 之上的 canonical EVENT FRAME 或 JOINED_CUT
projection，不是替代权威。不存在独立的 V2 event/value/frame/joined-cut codec；未改变的 V1
event/value/frame 与 joined-cut receipt 仍是准确 evidence input。V2 JOINED_CUT projection 与准确 locator
readback 在下述结构 Owner-custody seam 达到 `CURRENT / PARTIAL`；它们不证明 production startup 或产品消费。
BAR 只能使用下述独立 V3 FRAME projection；其 durable Owner custody 是 CURRENT/PARTIAL，而
其 sealed exact historical resolver core 是 CURRENT/PARTIAL，而 production startup 与产品 resolution 仍为
TARGET/UNAVAILABLE。它绝不扩大或重新解释 V2。新增 V4 FRAME/JOINED_CUT 与 BAR lifecycle 是
TARGET/NOT_ADMITTED，且绝不扩大或重新解释 V2 或 V3。

TARGET 缺口，BAR schedule 的生产提议者：`commit_prepared_bar_schedule_v1` 是 BAR schedule custody 唯一的写者，而没有任
何生产路径提议 schedule；今天每一个提议都由测试或验收夹具构造。native Replay 的初始读需要一个在它的帧上切出的 schedule，
所以在生产提议者出现之前，驱动这条读的验收从 sealed 验收提议者 `commit_bar_schedule_for_acceptance_v1` 取 schedule，它
只存在于带 `sealed-strategy-input-acceptance` 的构建里。给定一个 PIT 快照和在它上面声明的一个 BAR 角色，Owner 从快照受
验的 batch、它的 Source Binding 为该角色行标签声明的 bar、该角色的 binding 以及快照绑定的 Instrument Master readback
推出 schedule 的每个字段：声明的 cadence、anchor、clock、label 与 completion，master fact 的区间，以及在快照事件时刻的
cut。schedule 属于品种与所声明的 bar，不属于角色；帧已经读得到、且声明接纳的 schedule 会被 rejoin，不再重写。找不到快
照、batch 验不过、角色未声明、角色跨多个成员、角色所在行不是 BAR、Source Binding 没有声明任何 bar 周期、角色的行标签
没有对应声明，以及 Instrument Master readback 缺失，都按名拒绝。Strategy Factory 的切片 F 依赖它。像 Binance 永续这
样的连续日线，被声明为从 Unix epoch 起、连续时钟上的 24 小时固定间隔，并按这个 bar 排 schedule。旁边还有一个源缺口：
已准入的 Binance 永续源不提供 QUOTE 行，所以永续 Replay 没有可供成交的报价 cut。

`TimeframeSpecV1` 只有一种 fixed canonical codec，字段顺序是：schema `u16LE = 1`、reserved-zero `u16LE`、
kind `u8`、正 step `u32LE`、unit `u8`、anchor identity `[u8; 32]`、calendar identity `[u8; 32]`、session
identity `[u8; 32]`、time-zone identity `[u8; 32]`、label-rule `u8`、partial-bar-rule `u8`；禁止 trailing
bytes。其 identity 是 `market-data.timeframe.identity.v1\0 || canonical TimeframeSpecV1 bytes` 的 SHA-256。
尤其是 `1d`
表示绑定 calendar、session 与 time zone 下的一个命名 exchange-session day，绝不表示 UTC-duration day 或
无 anchor 的 24 小时间隔。已接纳组合要求的任一字段缺失或含糊时，timeframe 必须 unavailable，consumer
不得填入 default。

tag registry 是封闭的。kind 只能是 `0x01 POINT_EVENT`、`0x02 FIXED_INTERVAL_BAR` 或
`0x03 EXCHANGE_SESSION_BAR`。unit 只能是 `0x00 NOT_APPLICABLE`、`0x01 SECOND`、`0x02 MINUTE`、
`0x03 HOUR` 或 `0x04 EXCHANGE_SESSION_DAY`。label rule 只能是 `0x00 EVENT_EFFECTIVE`、
`0x01 INTERVAL_OPEN` 或 `0x02 INTERVAL_CLOSE`。partial-bar rule 只能是 `0x00 NOT_APPLICABLE`、
`0x01 COMPLETE_ONLY` 或 `0x02 ADMIT_PARTIAL_AS_DISTINCT_SLOT`。全零 32-byte value 是唯一的
not-applicable identity；每个 applicable identity 都必须非零。

只有以下组合是 canonical：

- `POINT_EVENT` 要求 `step = 1`、`unit = NOT_APPLICABLE`、四个 identity 全零、
  `label = EVENT_EFFECTIVE`、`partial = NOT_APPLICABLE`；
- `FIXED_INTERVAL_BAR` 要求 `step > 0`，unit 为 `SECOND`、`MINUTE` 或 `HOUR`，anchor/time-zone identity
  非零；continuous clock 的 calendar/session identity 同时为零，schedule-bounded clock 的二者同时非零；
  label 为 `INTERVAL_OPEN` 或 `INTERVAL_CLOSE`，partial 为 `COMPLETE_ONLY` 或
  `ADMIT_PARTIAL_AS_DISTINCT_SLOT`；以及
- `EXCHANGE_SESSION_BAR` 要求 `step = 1`、`unit = EXCHANGE_SESSION_DAY`、四个 identity 均非零，label
  为 `INTERVAL_OPEN` 或 `INTERVAL_CLOSE`，partial 为 `COMPLETE_ONLY` 或
  `ADMIT_PARTIAL_AS_DISTINCT_SLOT`。

其他 tag、identity 零值组合、step/unit pair 或组合都 unsupported，且不生成 timeframe identity。
`ADMIT_PARTIAL_AS_DISTINCT_SLOT` 要求 partial observation 获得自己的 root slot identity，绝不能 replace
或 alias completed slot。每个 bar interval 都是在绑定 anchor/schedule 下的 half-open `[open, close)`；
`INTERVAL_OPEN` 使用 `open` 作为 event-effective time，`INTERVAL_CLOSE` 使用 `close`；`POINT_EVENT` 使用
source event-effective time。

首个 TARGET BAR slice 对 `FIXED_INTERVAL_BAR` 与 `EXCHANGE_SESSION_BAR` 只接受 `COMPLETE_ONLY`。规范
`ADMIT_PARTIAL_AS_DISTINCT_SLOT` codec 为后续 TARGET 保留，但本 slice 不准入其执行，且不生成 positive
projection、fact、receipt 或 resolver result。

既有 V1 binding 的 free-form timeframe string 仅是 provenance。它绝不解析成 typed schedule bytes，且对它
的修改不能改变 schedule identity、timeframe identity 或 series identity。caller 可以命名一个 untrusted 所需
BAR shape，但该 input 没有直接 projection 权威，也不能铸造、选择或改写 schedule、calendar、session、
time-zone、anchor、label、partial rule 或 instrument evidence。

一行 BAR 作为 bar 是什么，由它的 Source Binding 声明。schema 2 的 Source Binding proposal 声明
`bar_timeframes`：源盖在 BAR 行上的每个标签各一条，按标签严格升序且不重复，每条写明准确的 `row_timeframe`、
cadence（正 step 的 `FixedInterval`，单位为 `Second`、`Minute` 或 `Hour`，或 `ExchangeSessionDay`）、anchor
（`UnixEpoch` 或 `SessionOpen`）、clock（`Continuous` 或 `ScheduleBounded`）、label（`IntervalOpen` 或
`IntervalClose`）与 completion（`CompleteOnly`）。只接纳三种组合：连续时钟上从 Unix epoch 起的固定间隔、交易日程上
从开盘起的固定间隔，以及交易日程上从开盘起的交易所 session 日；其他任何组合、乱序或重复的标签，或 PIT batch 带不了的
标签，都以 `UnsupportedBarTimeframe` 拒绝该 binding。schema 1 的 proposal 不作任何声明。在 schema 2 下，这些声明先
写条数，再进入 binding identity 与 fact digest；schema 1 不编入任何新内容，所以声明出现之前铸造的每条 binding 都保持
原 identity。今天没有任何生产 Source Binding 是 schema 2。UTC 日，例如 Binance USD-M 永续的 `1d` kline，是连续
时钟上从 Unix epoch 起的 24 小时 `FixedInterval`；股票的 `1D` 是 `ExchangeSessionDay`。标签 `1D` 两者都可以指，
只有声明说明是哪一个。

schedule 在三处按同一条规则选择与铸造 - native Replay 排程读、universe sample projection 的成员 schedule，以及
sealed 验收提议者：帧的 batch 指明它的 Source Binding fact，角色的行标签按身份相等选出该 binding 的那条声明，schedule
必须逐字段陈述所声明的 cadence、anchor、clock、label 与 completion。角色标签、行标签与声明的 `row_timeframe` 都作为
provenance 字符串比较：相等只确认角色读的正是这条声明所说的那些行，并不说明标签的含义。schedule 的 anchor identity 是
`market-data.bar-schedule.anchor.v1\0 || anchor tag` 的 SHA-256，所以同一个 anchor 在每个 schedule 上含义相同；连续时
钟无论 Instrument Master 写什么，都绑定为零的 calendar 与 session identity，交易日程时钟两者都绑定。该读按名拒绝没有
声明任何 bar 周期的 binding（`SourceBindingDeclaresNoBarTimeframe`），并按名拒绝没有对应声明的角色标签、来自其他
binding 的声明，以及在帧上所有 schedule 都陈述别的 bar 的成员（`DeclaredBarTimeframeMismatch`）。一个角色有多个周
期无法构造：一个角色只有一个标签，一个标签只有一条声明。一个 Design 里的多个周期就是多个角色，或者在同一条 binding
的不同标签下（如下面已准入的 joined-cut 语料），或者在不同 binding 下（例如同一品种的 1 小时源与 1 日源）；Strategy
Factory 切片 T2 正是按这个形状为每个角色解析其最近一次收盘。声明是否符合市场，是 binding 作者的陈述，与 availability
rule 相同；Market Data 只拒绝没有任何 bar 能具备的组合。等 Session Owner 提供类型化日历后，交易日程类的声明可以对照
品种的 session 校验，而不必信任。

原生引擎给 schedule 的 bar 起的名字，只是类型化 schedule 的一种编码，含义始终只有类型化 schedule。引擎只接受周期性的
step - `Second` 或 `Minute` 的 step 须整除 60，`Hour` 的 step 须整除 24，且都不能等于满单位
（`BarSpecification::validate_step`） - 所以连续时钟上从 Unix epoch 起的固定间隔，用能整除其时长且引擎接受的最大单
位来命名：24 小时是 `1-DAY`，60 分钟是 `1-HOUR`，48 小时是 `2-DAY`；没有任何单位能接受的时长（如 5 小时）以
`NativeRepresentation` 拒绝该帧。这个名字是准确的，因为引擎以 `EXTERNAL` 接收这些 bar：既不聚合它们，也不从名字推导
它们的时刻，行自带时刻。交易日程上的固定间隔保留自己的单位；交易所 session 日命名为 `DAY`，引擎分不清它和 UTC 日，这是
在引擎建模 session 之前明确写明的限制。由于多个类型化 bar 会共用一个名字，Replay 的帧序列拒绝两个 bar 命名相同、声明却
不同的帧，拒绝名为 `NativeBarTypeCarriesTwoTimeframes`。

结构 `BarScheduleFactV1` codec 支撑 CURRENT/PARTIAL durable PostgreSQL schedule 权威。其 canonical
bytes 按顺序为：schema `u16LE = 1`、reserved-zero `u16LE`、canonical instrument
`u16LE length || UTF-8 bytes`、predecessor-fact presence `u8` 并仅在 present 时后接 digest `[u8; 32]`、
effective-from `i128LE`、effective-until presence `u8` 并仅在 present 时后接 `i128LE`、kind `u8`、正 step
`u32LE`、unit `u8`、anchor/calendar/session/time-zone identity 各 `[u8; 32]`、label `u8`、completion `u8`、
Instrument Master readback/fact/cut digest 各 `[u8; 32]`、Market Semantics identity `[u8; 32]`、schedule
source/correction frontier 各 `[u8; 32]`，以及 cut-effective instant `i128LE`。absence/presence 只能是
`0x00`/`0x01`；trailing bytes、空 instrument、所需 identity 为零、unsupported tag combination，以及空或
倒置的 half-open effective interval 均被禁止。fact identity 与 digest 是
`market-data.bar-schedule-fact.v1\0 || canonical fact bytes` 的同一 SHA-256；不存在单独编码的 schedule
identity。Owner-local proposal 提供 effective interval、kind、step、unit、anchor、clock、label 与
completion，但它本身不能铸造权威。preparation 只接纳与一份准确原生 `InstrumentMasterReadbackV1` 交叉绑定的 BAR
row；Market Data 从该 readback 派生 time-zone identity，交易日程时钟也从中派生 calendar 与 session identity，连续时
钟则把两者都绑定为零；calendar 与 session 要么同为零，要么同非零，交易所 session 日永远不是连续的。它拒绝
instrument、Market Semantics、frontier、effective containment 或 Instrument Master mismatch。

结构 `BarScheduleCutV1` canonical bytes 按顺序为：schema `u16LE = 1`、reserved-zero `u16LE`、fact digest
`[u8; 32]`、同一 canonical-instrument variable bytes、effective instant `i128LE`，随后是 Instrument Master
readback/fact/cut digest、Market Semantics identity、source frontier 与 correction frontier，均为
`[u8; 32]`。effective instant 必须等于 selected BAR row 的 event-effective instant；Instrument Master cut 的
effective instant 不得晚于它，且 schedule fact 与 Instrument Master fact 的 effective interval 都必须包含它。Owner
在该时刻所取 cut 为该 instrument 解析出的 Instrument Master fact，必须按 fact identity 等于 schedule 的 Instrument
Master cut 所持有的那份，否则拒绝该 schedule。一个帧窗口共用一个 Instrument Master cut，正是这项比较让其后的 BAR
能以那个 cut 为依据：在 cut 与某个 BAR 之间生效或被观察到的更正会解析为后继 fact，从而拒绝该 BAR 的 schedule，而被
取代的 fact 的 interval 仍包含该 BAR，区间检查拦不住它。当前结构
codec 不编码 interval open/close 或 Owner observation/decision-cut coordinate；这些 predicate 保持
TARGET/PENDING，不能从该 cut 推断。cut identity 与 digest 是
`market-data.bar-schedule-cut.v1\0 || canonical cut bytes` 的同一 SHA-256。

结构 `BarScheduleReceiptV1` 恰好是 108 bytes：schema `u16LE = 1`、reserved-zero `u16LE`、fact digest、cut
digest 与 store-generation identity 各 `[u8; 32]`，再接正 store-append sequence `u64LE`。其 identity 与
digest 是 `market-data.bar-schedule-receipt.v1\0 || canonical receipt bytes` 的同一 SHA-256。
`BarScheduleReadbackV1` 以 schema `u16LE = 1`、reserved-zero `u16LE` 开始，随后对 fact、cut、receipt 依次
编码其 identity `[u8; 32]`、byte length `u32LE` 与 canonical bytes。其 identity 与 digest 是
`market-data.bar-schedule-readback.v1\0 || canonical readback bytes` 的同一 SHA-256；outbox identity 被定义为
等于 receipt identity。readback 没有 public constructor、`Clone` 或 deserialization path。当前 Owner 包含
BAR schedule fact、cut、receipt、outbox 与 head table；一个 atomic append/recovery 路径；固定的
`SECURITY DEFINER` 准确及历史 read；reader ACL；admitted capability issuance/revalidation；以及 public
startup resolver。逐字节相同 recovery 返回准确 stored readback，mismatch 或 tamper fail closed。这是
CURRENT/PARTIAL schedule custody 与 admitted read 权威，不是 Dashboard、Backtest、composite 或其他产品
reachability。caller locator、结构 decode 或重建 bytes 都不产生 schedule 权威。

对于 Native Replay execution-input 初始组合，已准入的 Market Data read capability 还公开一个固定的
request-bound 操作。它按 R&D Replay request 已封存的 snapshot identity 与 fact digest 解析 PIT batch，以 Plan
声明的 role schema 和 Owner batch coordinate 重建完整 universe frame，再读取每个 Master V2 canonical member
的完整 BAR schedule history。只有每个 member 恰好有一份 schedule 的 canonical timeframe、半开 validity、cut
instant、Instrument Master、Market Semantics、source frontier 与 correction frontier 全部等于同一 batch 与
request window，Market Data 才返回 frame 与 schedule readback。missing、duplicate、overlapping、reordered
或 corrupt candidate 不返回任何正向 readback。caller 不提供 schedule locator、account scope、latest selector、
raw row、SQL、pool、credential 或 replacement store。

**SUPERSEDED TARGET，Native Replay 帧序列 V2：** 下文的 PIT 窗口托管在多帧 Backtest 上取代这个 profile；序列签发
与它的表没有调用方，由 Market Data 随 Strategy Factory 切片 T1 删除，表经迁移删除而不只是删代码，而帧 census 与
报价 cut census 继续服务快照路径。本段文字
保留，作为托管所继承的那些不变式的陈述。现有初始帧 resolver、
`StrategyInputUniverseFrameReceipt` V1、BAR schedule readback 和 `NativeReplaySchedulingReadbackV1`
保持逐字节不变。新增只能由 Owner 签发的 move-only `NativeReplayFrameSequenceReadbackV2`；该档接纳
封存请求窗口内整条相邻且完整的双成员 frame 序列。第一帧是准确重解的 V1 初始帧，其后每一帧都来自另一份经
Owner 验证的 PIT snapshot/batch，不得复制数值或使用测试 successor。Market Data 独立枚举窗口与决策 cut
内的完整可用 frame，证明各帧身份不同、顺序严格递增、中间无漏帧；帧数少于两个时该档不可用。一次运行消费
除最后一帧以外的每一帧，最后那帧只用来给它前一帧的流动性划界，所以窗口里只有一帧时一帧也不消费，而更长的
窗口是更长的一次运行而不是一次拒绝。每帧各自保存 PIT
cut、batch、trigger、frame、source/correction lineage、BAR schedule 和 Quote EVENT 流动性 receipt，
后者绑定原始 Quote row digest、bid/ask 价量、事件和初始化时间及成员顺序，取自该帧的报价 cut：一份独立的、
经 Owner 验证的 PIT snapshot，其时刻严格晚于本帧 BAR cut、严格早于下一帧的 BAR cut。一份 PIT snapshot
只有一个时刻，所以跟在 BAR 之后的 Quote 不可能放进那个 BAR 的 cut。报价 cut 不是帧：它不取 frame 序号，
每个被消费的帧与其后继之间恰有一个。其中两个成员的 Quote 共用它的时刻并按 canonical 成员顺序排列，Backtest
对 `ts_init` 相同的元素按原顺序消费。sequence digest 覆盖这些证据、请求身份、窗口与准确顺序。每帧的流动性
EVENT 在 native schedule 顺序中必须先于下一帧的第一个 BAR。各帧必须共用 canonical universe、Design/role set、Instrument Master cut、
timeframe、venue 与 account scope，并逐一校验半开有效期和相邻时间关系。

Resolver 只接收由封存请求推导的首帧坐标与 Owner 认证的 Plan roles；其后每个 PIT cut、历史 schedule 和
流动性证据都必须由 Owner 自己的持久事实解析。调用方不得提交第二 snapshot/时间、frame 清单、价量、SQL、
pool 或替代 resolver。缺失、多出、重复、部分、乱序、跨请求/成员/lineage、过期、篡改或 ACL 漂移都不得
签发正向 V2 能力。V2 receipt/outbox 与序列托管必须原子追加；同意义重试和响应丢失只能重新核验并回读
原字节，意义冲突零写入。Market Data 不签发 R&D binding、Backtest Result、合成出场信号或交易指令。

这个目标所需的请求窗口 frame census 已经存在：每次 PIT snapshot fact 提交都会在其 scope 内取下一个稠密
frame 序号，窗口读回与序列解析按同一顺序读出它。今天缺的是调用方，而且如本段末尾所记，光有调用方还不够。只有核验过的 batch 含 BAR 行的 snapshot 才取
frame 序号；只含 Quote 行的是报价 cut，记入它自己的 census，永不取序号；两者都不是的不进任何 census。
Owner 凭自己核验过的 batch 判定这一点，而不是凭请求方的 scope 声明，并且只从那份 census 为帧解析报价
cut。每个报价 cut lineage 只在一个 cut 上读取：帧自身的 decision cut，即已封存请求所指名的那一个；若 Owner
发布该 lineage 原版的 cut 更晚，则取那个 cut。intake 在 Market Data 的 decision cut 冻结请求，所以它铸出的帧就落在
自身的 decision cut 上，该 cut 能看见的报价 cut 没有一个位于帧之后；成交在决策之后，正如下文托管报价 cut 对
`d_k` 所述，所以决策之后发布的报价 cut 仍是该帧的。lineage 先归约为它在其读取 cut 时可见的最新更正；该更正严格
位于帧的 BAR 与同一 cut 下的上界之间，与帧共用 scope、Instrument Master、universe selection、Market Semantics 与
Source Binding lineage，并且报价的成员恰好是帧的成员时，它才服务该帧。最新更正不能服务该帧的 lineage 什么也不
提供，永不退回到被那次更正取代的版本。Instrument Master 按每个 census 行记录的键比较：intake 为该快照成员解析出的
facts 的摘要，凡解析到同一组 facts 的请求都共用它。它从不按 batch 携带的 readback digest 比较，因为每个 intake
请求都会解析出自己的 readback，并封在该请求的 correlation、event 时刻与 decision cut 之上，所以任何两个快照都不
共用它。不解析 facts 的提交（测试或 sealed 夹具的，从不是生产路径）以请求自身的 digest 为键；在有这个键之前记录
的行没有键，不服务任何帧。在能服务的 lineage 中，读取 cut 最早的那一个是该帧的；同在那个 cut 上读取的
两个会使该帧被拒。census 按请求方声明的 scope
分区，所以在帧的全部坐标上都相同、又在同一 cut 上读取的第二个报价 cut 会与第一个冲突并使该帧被拒：这是拒绝服务，
永远不会把一个 Owner 未为它核验的报价 cut 交给它。每个读取 cut 都由 Owner 已持有的 census 确定，所以日后重读会
解析出同一个报价 cut：在更晚 cut 上发布的 lineage 永远不会取代一个能服务的，只有在 Owner 时钟离开所选 cut 之前、
恰在该 cut 上发布的报价 cut 仍可能与它冲突。某个读取 cut 下的上界是 Owner 在该 cut 时已观察到的、帧所在 scope
census 中第一个更晚的帧，窗口结束前没有这样的帧时则是窗口末端；更晚才被观察到的帧不会移动它，而在迟到报价 cut
之前发布的帧会成为它的上界，使那个报价 cut 归于更晚的帧。报价 cut 只进入成交：帧的策略输入仍只从它自己的 batch
绑定。这些都不由调用方给出。现有 PIT correction lineage
记录的是同一请求的修正版本，不是时间后继索引，也不能证明无漏帧，census 因此是一张独立的表而不是对它的
复用；现有首帧 resolver 与 QuoteTick 投影本身不签发后续帧或独立流动性 receipt。V1 native scheduling seal 从帧的
batch 取每个成员的 BAR，从帧的报价 cut 取每个成员的 Quote，所有 Quote 都在报价 cut 的时刻上并按成员顺序排列。
Owner 按上述规则既从自身托管数据、也经已准入的 store port 解析报价 cut，后者通过两个受测量的 census 函数读取两份
census。V1 scheduling receipt 先声明成员数，并在帧的 batch 之后绑定报价 cut 的 snapshot identity 与 fact，所以
它的字节不同于它从帧自己的 batch 取 Quote 时的字节 - 那些字节 Owner 托管数据从未产生过。V2 帧证据的每一帧都经
同一个 seal 封存，覆盖一个或两个成员，其流动性 EVENT receipt 封存的是报价 cut 而不是帧的 snapshot、fact 与
batch。目前还没有证明在 Owner 托管数据上驱动过一次完整的首帧读取（schedule、universe 与报价 cut 齐备）。

**TARGET / IMPLEMENTATION_ADMITTED（切片 T0），PIT 窗口托管：** 针对回补历史的多帧 Backtest 读一份只追加的 PIT 窗口托管，而不是每帧
一份快照。用户于 2026-09-27 准入了这一点，原选项见 Strategy Factory 页策略形状包络一节的引文，其中包括它收窄的那
一条性质：托管运行的帧不再各自带有自己的铸造 cut 与可信时钟证据，所以托管只准入回补历史，实时决策仍然每个时刻取
一次快照。PIT 快照仍然是一个时刻。快照这一支保持它的字节、封印、census 与报价 cut 端口；受验 batch 的封印与报价
cut 的读各自在旁边新增一条托管视图分支。

切片 T0 准入实现，且只准入 T0。用户于 2026-09-27 授权了这一设计，原话见策略形状包络一节的引文：「换成窗口托管。回补的
历史按整段一次放进托管；每根 bar 何时可见，由 Source Binding 上声明的规则推导；实时交易仍然每个时刻取一次快照。用户授
权收窄『每帧各自带有铸造证据』这一性质的适用域：在回测里，帧不再各自带铸造证据，并且只准入回补的历史。」T0 只是 Market
Data 这一侧：两层托管（截面版本记录，以及后继 sample fact schema 下的行事实）、带分支拒绝的截面更正模型、Source
Binding 上声明的可得规则、由执行周期的 Owner BAR schedule 枚举帧、带时间证据与 identity 的派生视图、受验 batch 封印的
`CustodyView` 分支，以及从托管派生的报价 cut。下文「读者」一条里，T0 记录 Market Semantics fact 与 head、 Instrument
Master cut 与 Reference Fact R0，每条托管链各一次，因为托管视图要经它们来读；声明登记与 universe 成员组合基底随消费它
们的读者一起放在 T1。托管请求自己陈述成员集与周期；由 Research scope 与 Design 推导出这份请求属于切片 T1，N 帧
Backtest 的组合与 Market Data 之外的每个读者也属于 T1；T2（多周期角色）与 T3（按角色预热）在它们的切片准入之前，在本页
仍不准入。T0 不新增路由、生产调用方或 Backtest 输入，所以 T1 准入之前，除 Market Data 自己的证明外，没有任何东西铸造或
读取托管。它的证明是包络里落在 Market Data 之内的那几条证伪： N=1 以及两帧单周期数据，在值、坐标、事件时间、bar 类型与
成员顺序这组投影上等于快照路径；两份只差「某个更正是否在 `d_k` 之前发布」的托管，帧 `k` 的值不同，去掉 publication 条
件就变红，由一个声明了更正流的合成源驱动；可得规则设为铸造时刻时，每一帧都看不见；在 `d_k` 与报价可得时刻之间发布的更
正会到达成交报价，但不到达帧 `k` 的策略输入，两者共用一段代码路径就会变红。T0 在 T1 之前不被驱动：它没有生产调用方，所
以一个完整的 T0 在结构上存在，但没有任何 Backtest 运行它。

- **托管：** 覆盖从预热起点开始的半开窗口，只提交一次，此后不可变。后来的更正是一份后继托管，它指名自己的前驱，只携带
  它新增的版本；视图沿这条链读到 head。后继托管原样重述前驱的基底 - Market Semantics fact、 Instrument Master cut、成
  员集与可得规则 digest - 基底一变就是新的根托管，绝不是后继，所以一条链绝不混用两套基底。更正单位是截面 - 同一个源、
  周期与 event-effective 时刻的全部行 - 带更正序号、前驱与发布时刻，因为一帧的各行必须共用时间与更正坐标。两个版本指向
  同一前驱、序号重复，或发布时刻不随序号递增，都是有歧义的分支。托管分两层：一层是截面版本记录，承载 `SampleFactV1` 已
  陈述的 lineage、分支拒绝与 head 规则；另一层是不可变的行事实，作为某个版本的成员，走后继的 sample fact schema。该
  schema 把来源快照那组字段换成截面版本 identity 与行 digest，根 slot 对 series 与 event-effective 时刻做哈希、不含快
  照 digest，所以同一根 bar 跨多次抓取的更正连成一条链。`SampleFactV1` 的字节绝不被重新解释。因此行身份 - Owner event
  identity、sample slot 与坐标 - 按托管行定键，绝不按派生视图定键，于是同一根高周期 bar 在读到它的每一帧里都带相同的坐
  标字节。在这个 schema 下，series head 每个 event-effective 时刻前进一次：序号加一，事件严格更晚；每个 slot 的
  correction head 按截面的更正序号前进。`SampleFactV1` 把一行的 series 序号取自它的更正序号，这条规则串不起一个不发布
  更正的源的各根 bar，所以后继 schema 自己陈述这两条链。
- **发布：** 截面的发布时刻只从发布更正的源观测得来。不发布更正的源（今天每个已准入的源都是）对每个截面只保留一个
  版本，其发布时刻等于可得时刻，它的后继版本以 `CROSS_SECTION_CORRECTION_NOT_PUBLISHED_BY_SOURCE` 按名拒绝。
  今天没有任何东西能构造这个拒绝，因为托管还不存在；更正的证伪条件由一个声明了更正流的合成源驱动。
- **可得：** 某行何时可见，由 Source Binding 上声明的规则推导（例如 bar 收盘加源延迟），绝不取请求方盖上的
  `provider_available`。规则的 digest 进入托管 identity。不看未来建立在这条规则上，而这条规则是声明，不是观测。声明的
  延迟不严格小于执行 bar 间隔时，无法满足 `d_k < e_{k+1}`，以 `AVAILABILITY_LAG_NOT_BELOW_BAR_INTERVAL` 按名拒绝；今天
  无法构造。规则由 schema 2 的 Source Binding 提案声明，同时声明该源是否发布更正流。规则要么是该行所属 bar 收盘后的一
  段延迟，要么就是抓取时刻本身，后者用于没有陈述更早时刻的源；设为抓取时刻时，今天铸造的托管在它的窗口里一帧都看不见。
  它的 digest 只对规则本身取，所以保持同一规则的 binding 后继保持同一 digest，而 binding identity 仍然哈希每个 cut 的
  frontier 与时间证据。schema 1 的 binding 没有声明规则，托管按名拒为 `SOURCE_BINDING_DECLARES_NO_AVAILABILITY_RULE`，
  托管提交存在之前没有东西构造它，之后由 T0 的证明驱动。
- **成员：** 成员集在整份托管内固定。某成员的 Instrument Master 有效期或 Universe 成员资格在窗口内开始或结束，
  就以 `WINDOW_MEMBER_NOT_VALID_THROUGHOUT` 按名拒绝这份托管。
- **帧：** 从执行周期的 Owner BAR schedule 枚举，绝不从托管行枚举。帧 `k` 有事件时刻 `e_k` 与可得时刻 `d_k`，且
  `d_k < e_{k+1}`；没有完整截面的帧以 `PIT_WINDOW_FRAME_NOT_COVERED` 拒绝整次运行。执行周期是固定间隔，从窗口 schedule
  fact 记录的相位时刻开始枚举，例如日线取 UTC 零点，Binance 周线取周一 UTC 零点；session 型执行周期按名拒为
  `PIT_WINDOW_EXECUTION_TIMEFRAME_NOT_FIXED_INTERVAL`，托管提交存在之前没有东西构造它，之后由 T0 的证明驱动。这是范围
  限制，不是性质：session 型周期（例如黄金按交易所 session 的日线）需要以后一个做 session 展开的切片，在那之前一律拒绝。
  schedule 是托管自己的提交在整个窗口上铸的一个窗口 schedule fact，因为今天的 schedule fact 只能从单个 batch 行铸出。
- **派生视图：** 对帧 `k`，Market Data 为每个源选出执行周期在 `e_k` 上的截面，以及其他每个周期中可得时刻不晚于
  `d_k` 的最新截面；每一处都取在 `d_k` 之前发布、序号最高的版本，丢掉已撤回的，遇到分支就拒绝。某个声明的周期
  还没有产出截面的帧（例如预热期内）以 `PIT_WINDOW_FRAME_NOT_COVERED` 拒绝整次运行。视图的 decision cut 是 `d_k`，顺序检查是 event ≤ available ≤ publication ≤ `d_k`，
  一个派生前沿 digest 覆盖它的统一字段，它的 identity 是对所选各截面版本 identity、可得规则 digest、视图 schema
  版本与 `e_k` 做的 SHA-256，所以一个更正只改变选中它的那些视图。它的时间证据写明托管铸造时所用的 Owner 时钟
  identity 与 epoch，`d_k` 是那个时钟上的时刻。托管自己的铸造 cut 与 retrieval 时刻留在托管证据里。
- **封印：** `VerifiedPitObservationBatch` 增加一个来源（已提交快照或托管视图），并去掉直接取快照 identity 与
  fact digest 的访问器，让编译器列出每个按快照定键的读者。托管视图的构造者与快照的那个一样受封，并有自己的
  `compile_fail` 与篡改测试。
- **读者：** 今天每份快照一份的东西，都变成每条托管链一份，没有任何东西按首帧的快照定键。Market Semantics 的 fact
  与 head、intake 时盖章的 Instrument Master cut、声明登记与 universe 成员组合 basis 都按每条托管链记录一次；sample
  slot 按每条托管行携带的 series 与 event-effective 时刻定键，所以后继托管里的更正落在同一个 slot。Reference Fact R0 按每条托管链覆盖整个窗口存一次，某帧的 R0 在读时由它算出，不存按帧的
  locator。PIT evaluation evidence 的读从托管推导，BAR schedule 检查改为一个窗口 schedule fact，其有效区间包含
  `e_k`，且其 cut 不晚于 `d_k`。这些读碰到的每一张表和每个函数都在 admitted-port 的测量范围内。
- **报价 cut：** 从托管在 `(d_k, e_{k+1})` 之内派生，每个间隙恰好一个、同一时刻、按成员顺序、不占帧序号，而且绝不是后
  来的更正取代掉的那个版本。它的版本是在报价时刻自己的可得时刻之前发布的最高序号，更晚的更正也只在那个时刻取代它：成交
  在决策之后，而在 `d_k` 上没有报价能入选，因为报价的事件在 `d_k` 之后。这只关乎成交报价。帧 `k` 的策略输入仍然截在
  `d_k`，所以在 `d_k` 与报价可得时刻之间发布的更正会到达成交报价，绝不到达帧 `k` 的输入。

在 CURRENT/PARTIAL BAR schedule 路径中，只有具备 custody verification 的 readback 才能授权以准确 V1
binding-receipt digest 为键的新增 immutable `TimeframeProjectionReceiptV1`。其既有 canonical bytes 与 domain
保持不变：schema `u16LE = 1`、
reserved-zero `u16LE`、V1 binding-receipt digest `[u8; 32]`、timeframe identity `[u8; 32]` 与完整
fixed-width canonical `TimeframeSpecV1` bytes，SHA-256 domain 为
`market-data.timeframe-projection-receipt.v1\0`。同一 V1 digest 加逐字节相同 projection idempotent，不同
bytes conflict。schedule readback 缺失、含糊、不唯一或非 durable 时 unavailable。consumer 不得把 `1D`、
`1h`、其他 label、venue convention 或 default 解析成 spec。后续 Owner mapping/calendar 改变后仍可回读
准确 historical schedule 与 projection；这些改变必须形成新的 Owner schedule fact/cut，不能通过 free-form
binding label 偷渡。

`SampleFactV1`、`SampleReceiptV1` 与 308-byte coordinate 携带的 `Owner event identity` 是新增的
role-independent Market Data identity，并非既有 V1 frame-trigger event identity。其 canonical preimage 按顺序
为：schema `u16LE = 1`、reserved-zero `u16LE`、source snapshot identity `[u8; 32]`、source-snapshot fact
digest `[u8; 32]`、observation-batch digest `[u8; 32]`、canonical-row digest `[u8; 32]`、logical time
`u64LE`、event-effective time `u64LE`、provider-available time `u64LE`、retrieval time `u64LE`、
correction-publication time `u64LE`、Owner sequence `u64LE`、correction-stream
`u16LE length || bytes` 与 correction-frontier digest `[u8; 32]`。identity 是
`market-data.sample-event.identity.v1\0 || canonical preimage` 的 SHA-256 前 16 bytes；全零结果、其他
encoding 或不等于所引用 historical Owner row 的 coordinate 都 unsupported。Design、role、static binding、
trigger、frame、join 与 consumer field 均不进入该 preimage。

`SampleFactV1` 是一个 series slot 的 immutable Owner fact。其 canonical bytes 先是 schema `u16LE = 1` 与
reserved-zero `u16LE`，随后按顺序绑定：series identity、slot identity、series-predecessor sample identity、
可选 correction-predecessor sample identity、source snapshot identity、source-snapshot fact digest、
observation-batch digest、canonical instrument bytes、channel、data kind、field-semantic bytes、timeframe
identity、Owner event identity、logical time、
event-effective、provider-available、retrieval、
correction-publication、Owner sequence、value-semantic bytes、准确 value bytes、scale、canonical-row digest、
Source Binding identity、Source Binding lineage root、lineage version、source-frontier digest、correction-stream
bytes、correction-frontier digest、Instrument Master digest、Universe Selection digest 与 Market Semantics
identity。固定 identity/digest 是 32 bytes，Owner event identity 是 16 bytes，time/sequence/version 字段是
`u64LE`，channel/data-kind/scale 是 `u8`，optional absence/presence 是 `0x00`/`0x01`，variable bytes 是
`u16LE length || bytes`；reserved/trailing bytes、超长 value 与其他 encoding 均被禁止。

version 1 channel tag registry 是穷尽闭集：`0x01 MARKET`、`0x02 REFERENCE`、`0x03 ECONOMIC`。version 1
data-kind tag registry 也是穷尽闭集：`0x01 BAR`、`0x02 QUOTE`、`0x03 TRADE`、`0x04 SCALAR`。这些 tag 是
未改变的 V1 Owner `StrategyInputChannel` 与 `MarketDataFieldSemantic.data_kind` 返回字符串的唯一 canonical
encoding；tag 只能由准确 historical V1 binding/event value 选择，consumer 不能自行选择。`0x00`、任何未列出的
tag 或字符串、tag/string 不匹配，以及在 schema version 1 下出现的后续 registry value 都 unsupported，且不生成
fact、series identity、receipt、EVENT V2 coordinate 或 BAR V3 coordinate。扩展任一 registry 都必须使用 successor schema version，不得
重新解释已存储的 version-1 bytes。

version 1 series projection 只有一个有序的 Owner-derived codec。其 bytes 按顺序为：schema `u16LE = 1`、
reserved-zero `u16LE`、canonical instrument variable bytes、channel tag `u8`、data-kind tag `u8`、canonical
field-semantic variable bytes、timeframe identity `[u8; 32]`、准确
`strategy.input.fixed-i128-le.v1` value-semantic variable bytes、准确 V1 unit variable bytes（`PRICE`、
`QUANTITY` 或 `SCALAR`）、scale `u8`、Source Binding lineage root `[u8; 32]`、correction-stream variable bytes
与 Market Semantics identity `[u8; 32]`。每个 variable field 使用与 `SampleFactV1` 相同的
`u16LE length || bytes` encoding。每个成员都复制自准确 historical V1 Owner binding/event 或其 historical
timeframe projection；consumer 不提供任何成员。准确 value bytes、slot/predecessor、snapshot/fact/batch、
Owner event/time/sequence、canonical-row digest、Source Binding identity/lineage version、source/correction
frontier 及其他所有可更新的 per-fact field 明确排除在外。因此 value/time 更新仍属于同一 series，而
correction stream、unit、scale、lineage root 或其他已列 static member 改变时必须形成不同 series。series
identity 是
`market-data.sample-series.identity.v1\0 || canonical version-1 series projection bytes` 的 SHA-256。

root slot identity 是对 `market-data.sample-slot.identity.v1\0` 加 series identity、event-effective time 与
source-snapshot fact digest 的 SHA-256；已接纳 correction 必须保留 predecessor 的 slot identity，不能重新计算。
`fact_digest` 是 `market-data.sample-fact.v1\0 || canonical SampleFactV1 bytes` 的 SHA-256，`sample_identity` 是
`market-data.sample.identity.v1\0 || fact_digest` 的 SHA-256。因此，即使 value bytes 相同，sample identity
也不同于且不得替换为既有 BLAKE3 canonical-row digest。全零 series predecessor 只对 series 首个 fact
canonical；correction predecessor absence 只对 slot 首个 fact canonical。每个 correction 都必须有 present
predecessor，之后每个 fact 都必须命名当前对应 head。

`SampleReceiptV1` 与 trigger、consumer、Design、role 均无关。其 canonical bytes 恰好是 244 bytes，按顺序为：
schema `u16LE = 1`、reserved-zero `u16LE`、sample identity `[u8; 32]`、fact digest `[u8; 32]`、timeframe
identity `[u8; 32]`、Owner event identity `[u8; 16]`、logical time `u64LE`、event-effective time `u64LE`、
Owner sequence `u64LE`、canonical-row digest `[u8; 32]`、Source Binding lineage root `[u8; 32]`、lineage
version `u64LE` 与 Market Semantics identity `[u8; 32]`；其中不含 input-role identity 或 static binding
digest。任何其他 width、endianness、order、reserved value、缺失 byte 或 trailing byte 都 unsupported，且不生成
receipt identity、EVENT V2 coordinate 或 BAR V3 coordinate。其 stable digest 是
`market-data.sample-receipt.v1\0 || canonical SampleReceiptV1 bytes` 的 SHA-256；这些 bytes 准确等于上述
role-independent fact projection；该 digest 同时是 receipt identity，并提供既有准确 308-byte coordinate
的最后一个 sample-receipt-digest 字段。原生 resolver 只接受该准确 Owner-authorized stable digest，并返回历史
存储的 canonical receipt bytes；绝不从 row、frame、trigger、value、latest head、role、binding 或 caller
coordinate 重建它们。

`StrategyInputFrameEvidenceIdentityV2` 是覆盖一份完整、未改变 V1 frame 的 additive identity；它不改变或
替换任何 V1 receipt。其 canonical preimage 按顺序为：schema `u16LE = 2`、reserved-zero `u16LE`、准确 V1
frame-trigger receipt digest `[u8; 32]`、正 value count `u32LE`，以及 V1 frame 每个 value 对应的一份 96-byte
entry。每份 entry 是 input-role identity `[u8; 32]`、static V1 binding-receipt digest `[u8; 32]` 与 V1
value-receipt digest `[u8; 32]`。entry 按 input-role identity 严格排序，重复 role unsupported；总长度恰好是
`40 + 96 * count`。其 identity 是
`market-data.strategy-input-frame-evidence.identity.v2\0 || canonical preimage bytes` 的 SHA-256。缺失、多余、
乱序或不匹配的 trigger/value evidence 都不生成 identity。该 identity 不是 V1 frame receipt，不替换 joined-cut
receipt 的 private single-value component digest，也不能只从一个 trigger 或一个 value 派生。

只有 `StrategyInputSampleProjectionReceiptV2` 形成既有 EVENT FRAME 或 JOINED_CUT role-bound coordinate projection。其 canonical bytes 是
一个 header 后接 fixed component entry。header 按顺序为：schema `u16LE = 2`、reserved-zero `u16LE`、kind
闭集为 `u8 = 0x01 FRAME` 或 `0x02 JOINED_CUT`、准确 subject identity/digest `[u8; 32]` 与正 component count
`u32LE`。每个 entry 恰好是 612 bytes，按顺序为：input-role identity `[u8; 32]`、static V1 binding-receipt
digest `[u8; 32]`、frame-evidence identity `[u8; 32]`、V1 frame-trigger receipt digest `[u8; 32]`、V1
role-bound trigger event identity `[u8; 16]`、V1 value-receipt digest `[u8; 32]`、historical timeframe-
projection-receipt digest `[u8; 32]`、sample identity `[u8; 32]`、native `SampleReceiptV1` digest `[u8; 32]`、
coordinate digest `[u8; 32]` 与准确 308 coordinate bytes。entry 按 input-role identity bytes 严格排序，重复 role
unsupported；总长度恰好是 `41 + 612 * count`。reserved、闭集外 kind、zero count、其他 order/width、缺失或
trailing byte 都不生成 receipt。

subject identity 是 additive frame-evidence identity，entry 穷尽同一有序 role value。每个 entry 解析准确
binding 及其 historical `TimeframeProjectionReceiptV1`；coordinate 的 role、binding、
timeframe、row digest、lineage、Market Semantics、sample identity、native receipt digest 与 coordinate digest
必须等于这些 resolved bytes。V1 frame/value row 与 batch evidence 必须等于被引用 `SampleFactV1`，且该 fact
的 source snapshot/correction census 必须验证其 lineage version。V1 trigger 的 logical/event time 与 Owner
sequence 必须等于 component coordinate；其 role-bound event identity 只作为单独存储的 V1 evidence，绝不复制
进 role-independent native event identity 或与之判等。current/latest lookup、partial component set、cross-
frame splice 或 caller-derived field 都 unsupported。每个 V2 component 必须解析未改变的 V1 `EVENT`
lifecycle。对于 FRAME，subject 是穷尽的 frame-evidence identity，且所有 entry 共享它。对于 JOINED_CUT，
subject 是准确且有效的 V1 joined-cut receipt digest，至少包含两个 component；每个 component 都是准确的
single-value EVENT frame，且独立重算的 frame-evidence identity 必须匹配该 entry。entry 仍按 role 严格排序。
Market Data 只有在 stored closed kind、subject、count、canonical bytes、custody digest 与准确 receipt-digest
locator 全部匹配后，才能 promote move-only readback。BAR lifecycle、BAR timeframe、BAR schedule receipt 或
其他 V2 kind 仍 unsupported，且不生成 V2 receipt 或 readback。

V2 receipt identity 与 digest 是
`market-data.sample-projection-receipt.v2\0 || canonical receipt bytes` 的同一 SHA-256。Market Data 按该 digest
存储并解析准确 bytes；逐字节相同 replay idempotent，同 digest 不同 bytes conflict。因此，一个 Owner sample
保持一份 native receipt，并在同一 role/binding 下被后续 trigger 携带时保持逐字节相同 coordinate，而 enclosing
V2 projection 随其 V1 frame 正确改变。任何 projection 都不能 mint 或改写 Owner sample receipt。

crate-private `StrategyInputSampleProjectionReceiptV3` 结构 codec 是当前唯一存在的 BAR role-bound
projection shape。其 header 按顺序为：schema `u16LE = 3`、reserved-zero `u16LE`、projection kind
`u8 = 0x01 FRAME`、lifecycle `u8 = 0x02 BAR`、准确 frame-evidence identity `[u8; 32]` 与正 component count
`u32LE`。每个 entry 恰好是与 V2 所列相同的 612-byte component layout；当前 V3 codec 不追加 schedule
receipt 或 cut digest。entry 仍按 input-role identity 严格排序，总长度恰好是 `42 + 612 * count`。V3
identity 与 digest 是 `market-data.sample-projection-receipt.v3\0 || canonical receipt bytes` 的同一 SHA-256。
其 frame-evidence preimage 按顺序为：schema `u16LE = 3`、reserved-zero `u16LE`、lifecycle
`u8 = 0x02 BAR`、准确 V1 frame-trigger receipt digest `[u8; 32]`、正 value count `u32LE`，以及与 V2 相同的
有序 96-byte role/binding/value entry；总长度是 `41 + 96 * count`，identity domain 是
`market-data.strategy-input-frame-evidence.identity.v3\0`。lifecycle `EVENT`、任何非 FRAME projection kind、
V2 下的 BAR entry，或其他 order、width、count、trailing byte 都 unsupported。

当前 V3 source 交叉绑定准确 V1 binding、BAR `TimeframeProjectionReceiptV1`、原生 `SampleReceiptV1`、
coordinate、trigger、value 与 frame evidence；native verification 要求 BAR timeframe 与逐字节相同的
sample/timeframe dependency。其 canonical bytes 不携带 `BarScheduleReceiptV1` 或 `BarScheduleCutV1`；durable
dependency column 在 codec 外交叉绑定这些 Owner artifact。V3 PostgreSQL table、atomic commit、逐字节相同
recovery、tamper rejection 与 writer/reader ACL oracle 是 CURRENT/PARTIAL durable Owner custody，并已通过
isolated dynamic PostgreSQL acceptance。其 sealed public locator/readback contract 与 resolver core 是
`CURRENT / PARTIAL`：一个准确 receipt digest 只能读取一个历史 FRAME/BAR projection，并且必须在同一个
fixed PostgreSQL snapshot 中完整验证 projection custody、timeframe/sample fact、schedule dependency、准确
schedule readback 与 append-only schedule history，且在读取前、读取后及 promote 前立即重新验证 admission。
resolver 不能选择 kind/lifecycle、执行 latest lookup、解析 V2 BAR 或 JOINED_CUT，也不暴露 storage authority。
R&D production startup、产品 composition、ProgramHost、Backtest、composite、Dashboard 与其他
所有产品消费保持 `TARGET / UNAVAILABLE`；当 external admission adapter 不可用时，required production startup
不得返回 resolver。stored V3 row 或结构 V3 bytes 本身不产生 consumer 权威或 mutation。

**TARGET / NOT_ADMITTED，additive BAR native join：** `StrategyInputSampleProjectionV4` 的 projection
kind 闭集准确为 `FRAME` 与 `JOINED_CUT`，lifecycle 闭集为 `BAR`。它既不替换也不改变任何 V1 receipt、V2
EVENT projection 或 V3 BAR FRAME projection；所有既有 canonical bytes、domain、identity、semantics、
persistence 与 resolver 均保持逐字节不变。对于 FRAME，V4 绑定准确 Owner-resolved V3 BAR FRAME source 及其
完整 schedule dependency。对于 JOINED_CUT，其 subject 是未改变且有效的 V1 joined-cut receipt 的准确 digest。
canonical V4 receipt bytes 在按 role 排序的 component set 之前包含准确 schedule-dependency-set digest，因此
domain-separated V4 receipt identity 必然同时绑定两者。schedule-dependency set 以穷尽、规范的方式把每个
component role 绑定到准确 BAR schedule cut/receipt 与 timeframe dependency；缺失、多余、重复或乱序 entry
均 unsupported。

每个 V4 component 在完整 role、static binding、frame evidence、trigger、value、timeframe projection、sample
identity、native sample receipt、308-byte coordinate、schedule cut 与 schedule receipt field 上，都必须严格等于
其对应的 exact-locator V3 BAR FRAME component。重新计算外观等价的 component、替换 digest、解析 timeframe
label，或混入其他 frame、slot、batch、joined cut 或 schedule set 的 component，都不生成 V4 receipt。首个
admitted-shape corpus 准确包含六个 role：`1m OPEN`、`1m HIGH`、`1m LOW`、`1m CLOSE`、`1h CLOSE` 与
exchange-session `1d CLOSE`。`1m CLOSE` 是 trigger；四个 `1m` role 必须共享准确完整 schedule slot 与
observation batch。`1h CLOSE` 与 `1d CLOSE` 只能选择在各自 schedule 下不晚于该 trigger 的完整 latest-closed
sample。`1d` role 必须绑定 `EXCHANGE_SESSION_BAR` day，绝不能是 UTC day 或无 anchor 的 24-hour interval。

一个 Market Data Owner transaction 必须 lock 并重新解析准确 V1 joined-cut receipt、每个 V3 FRAME projection、
sample/timeframe fact 与 schedule cut/receipt；校验完整 schedule-dependency set 和全部 strict component
equality；随后原子存储 V4 receipt、准确 locator readback 与 outbox。locator 是准确 V4 receipt identity，且在
发送前已知。逐字节相同 replay 或 response-loss recovery 解析该 locator，以零 append 返回相同 historical
bytes。exact-locator resolver 不读取 latest/head，也不执行 history scan；只有在一个 fixed snapshot 中完整
重新校验后，才能 promote move-only positive readback。private table 不授予 `PUBLIC` 任何 privilege；只有
固定 non-grantable Owner/writer role 能够 mutation，固定 non-grantable W3 reader 只能获得 resolver 的
`EXECUTE`，绝无 raw `SELECT` 或 DML。locator、ACL、canonical-byte、V1-subject、schedule-set、component、
custody、response-loss 或 admission 任一失败时，V4 receipt、readback、outbox 与 W3 binding 均零写入。W3
只消费该 V4 JOINED_CUT locator/readback。该合同不声称 implementation、migration、registered product
composition、production startup/write、ProgramHost、Backtest、deployment、runtime 或 trading authority。

**CURRENT/PARTIAL，universe-frame sample projection：** `StrategyInputUniverseSampleProjectionV1`
为一个 universe frame 的每个（member, role）值提供 bounded feature program 读取的 Owner sample coordinate。它是
additive 的：V1 receipt、V2/V3/V4 projection、`SampleFactV1`、`SampleReceiptV1` 与 coordinate codec 均不改变。
它的 subject 是一个 `StrategyInputUniverseFrameReceipt` 的准确 digest，即 ProgramHost 为该帧接纳的那个
receipt，绝不是 host 无法与之比较的 digest。它为该帧每个（member, role）值各含一个 component，严格按 member
ordinal（即 selection 的 canonical member 顺序，也是帧内值遵循的顺序）、再按 input-role identity 排序，并穷尽该帧；缺失、多余或重复的一对都不产生 projection。component 携带
member ordinal、member key 与 instrument、input-role identity、universe member binding digest、value receipt
digest、该帧的 trigger digest、timeframe-projection receipt digest、sample identity、原生 `SampleReceiptV1`
digest、coordinate digest 与 308 字节 coordinate。coordinate 是未改变的现有 codec（schema `1`，domain
`strategy.input.sample-coordinate.v1\0`）；其 binding 字段承载 universe member binding digest，因为 universe
member 没有 static binding receipt。sample 以它读取的那一行为键，从不以读取它的 binding 为键：键是它的 series，
以及由 snapshot 的 fact digest 决定的 slot。因此 universe member 的 sample，就是读取同一 snapshot 同一行的每个
binding 所读的那一个与 role 无关的 `SampleFactV1`。每个 binding 通过自己的 `TimeframeProjectionReceiptV1` 读取它，
该 receipt 在 exact binding 绑定其 receipt digest 的位置绑定 universe member binding digest；Market Data 把这个
projection 附加到 sample 上，而不是并入 sample 的 custody，所以第二个 binding 读取一行已有 sample 的数据时，附加
它的 projection 并复用该 sample，sample 永不被写两次。

BAR 帧的 projection 还绑定每个 member 的 BAR role 读取时所依据的 schedule。其 schedule-dependency set digest 是对
`market-data.universe-sample-projection-schedule-set.v1\0`、component count `u32LE`，以及按顺序每个 component 的
member ordinal `u8`、input-role identity 与该 member 的 BAR schedule readback identity（各 `[u8; 32]`）取
SHA-256。它对 BAR 帧是必填、绝非可选，对 EVENT 帧则不存在，并且是 projection identity 的一部分，所以同一帧在另一
schedule 下读取就是另一个不同的 projection，由下文「每帧一个 projection」的规则拒绝；timeframe-projection receipt 只绑定 timeframe 而不绑定 schedule，若无此项，
schedule 改变不会改变被接纳事件的 identity。

其 canonical bytes 依次为：schema `u16LE = 1`、reserved-zero `u16LE`、subject `[u8; 32]`、帧 lifecycle `u8`
（`1` EVENT，`2` BAR，即 V3 与 V4 projection 使用的值，而非 trigger 自己的编码）、对 BAR 帧为 schedule-dependency set digest `[u8; 32]`、正的 component count
`u32LE`，然后每个 component 依次为 member ordinal `u8`、带长度前缀（`u16LE`）的 member key 与 instrument，以及
input-role、member-binding、value-receipt、trigger、timeframe-projection、sample-identity、sample-receipt 与
coordinate digest（各 `[u8; 32]`），最后是 308 字节 coordinate。其 identity 是对
`market-data.universe-sample-projection-receipt.v1\0 || canonical bytes` 取 SHA-256。

固定 Market Data writer 通过一个 Owner operation 签发 projection；R&D 调用时只传已封存 Replay request
identity、该 request 的 composition binding locator，以及签哪些帧：request 的首帧，或其 window 消费的全部帧。
在一个 Market Data transaction 中，它解析每帧经 Owner 验证的 batch（对 window 按上文规则从 frame census 取，所以
调用方不点名任何帧列表），取 composition binding 在其签发认证 composer role set 时记录的 Design 与 role
set，以及 Market Data 为每个 role 存储的 declaration（所以调用方不点名任何 role，该 operation 也从不读取 R&D），经产生 host 所接纳之帧的同一 binding 重新导出每帧的 universe frame，提交或复用每个
（member, role）的 sample 与 timeframe projection（BAR role 取该 member 在该帧的 schedule），并存储每个
projection 的 receipt、exact-subject readback 与 outbox。它写入的每个 sample 都延伸其 series 唯一的 head，这个
head 由读取该 series 的每个 snapshot、binding 与 Design 共享：该 operation 在自己的 transaction 中先锁定并读取
series head 与该行的 slot head，再 prepare sample；slot 已有 sample 时复用它，新行的 sample 则以当前 series
head 为前驱 prepare。一个 window 的 projection 在这一次调用中签发，所以
持锁的 R&D transaction 无论 window 多长都只做一次跨库调用。request key（已封存 Replay request identity 连同帧范围）与其签发时的 binding 一并记录，同一 key
下的另一 binding 按名拒绝且零写入；准确 retry 以零 append 返回已存字节。该 operation 从不回调 R&D。R&D 在解析
帧之前调用它。host 只有在 projection 的（member, role）集合同时等于所接纳帧的值集合与 Plan 的 role 表时才附加它，
否则拒绝；R&D 更早做的任何比较都只是提前拒绝，不是这条性质的保证。
一个 universe frame 至多有一个 projection：为已有另一个
projection 的帧签发的 projection 按名拒绝为 `SubjectConflict`，且零写入，所以 exact-subject resolver 按
universe-frame digest 恰好读取一个 projection。目前已建成：首帧。该 operation 按上文签发已封存
Replay request 首帧的 projection，exact-subject resolver 读取它；R&D 在签发初始 execution-input binding 时调用
它，时机在 request 的 Instrument Master cut 之后、解析该帧之前，并在 projection 所指的帧不是它解析出的那一帧时提前拒绝。
sample custody 按上文把每个 binding 的 projection 附加到该行唯一的 sample 上，并复用 slot 已有的 sample。window 的各帧，
以及 host 把 projection 附加到其接纳之帧，尚未建成。不声称 production startup 或 write、deployment、runtime 或 trading
authority。

已接纳 correction 是 immutable successor，同时具有准确 series predecessor 与 correction predecessor。
它创建新的 `SampleFactV1`、`SampleReceiptV1`、`sample_identity` 与 coordinate，并让 sample clock 准确推进
一次，即使其 value bytes 与 predecessor 相等。它绝不 rewrite、replace、mask、replay 或追溯推进 predecessor
state。普通的等值新 slot 同样是新 sample，并准确推进一次。对未来获准的 BAR path，同一 1-hour 或
exchange-session `1d` sample 被后续 1-minute trigger 携带时，必须返回相同 receipt/coordinate bytes，且不得
第二次推进 sample clock。

当前的 PostgreSQL sample 路径（POINT_EVENT sample，以及 universe sample projection 提交的 BAR sample）包含
Owner-owned timeframe-projection-receipt、sample-fact、series-head、per-slot correction-head、sample-receipt、
outbox table 与 exact native resolver。一个 Market Data transaction 插入 fact、receipt、outbox row，并从 fact
绑定的 predecessor 对 series/correction head 执行 compare-and-swap 前进；普通新 slot 从规范 absence 把其
correction head 推进到首个 fact。逐字节相同的 replay 执行零次
write，并返回准确历史 receipt bytes。identity/content mismatch、time/version regression、predecessor 或
sequence gap、competing branch、cycle、cross-lineage splice、head mismatch、缺失/冲突 timeframe projection
或非规范 bytes 都必须 fail closed，且两个 head 均不前进。successor 与 correction 之后仍可读取历史 exact receipt。caller、R&D、ProgramHost、Backtest、fixture、migration 与 reconciliation process 都不获得 insert/update/delete、
head-advance、synthesis、backfill 或 garbage-collection 权威。

上述 BAR schedule fact/cut/receipt/readback PostgreSQL 路径、BAR sample custody 与 V3 projection PostgreSQL
路径在 isolated dynamic acceptance 后是 CURRENT/PARTIAL durable Owner custody。schedule 已具备 admitted
capability、revalidation、固定 read/history、reader ACL 与 public startup resolution。V3 已具备 durable
commit/recovery/tamper/ACL evidence，并具备 sealed exact historical resolver core；V3 production startup、产品
与 composite 消费仍为 TARGET/UNAVAILABLE。crate-private 结构 codec 或 stored row 本身不是产品 acceptance
evidence。

对于 EVENT，V2 projection receipt 交叉绑定每个 selected component 的准确 `sample_identity`、`SampleReceiptV1`
digest、已接纳 V1 role/binding evidence 与既有 308-byte coordinate bytes/digest。它保留所有 V1 trigger、
value、frame 与 row identity，而不从这些 identity 派生 sample 权威。因此，同一个 sample 被后续 event
frame 在同一 role/binding 下选中时，native receipt 与 coordinate bytes 保持逐字节相同。对于 BAR，
只有 Owner sealed、经过动态验证的 V3 resolver core 才能在其已准入边界形成对应 historical projection
readback；该 capability 不准入 production startup 或任何产品 consumer。从 row/frame/trigger digest、caller
timestamp 或 `1d` 的 UTC 24 小时解释计算 coordinate digest 均不具备权威，并在 consumer state mutation
之前失败。

规范 acceptance 必须复用仓库既有 disposable PostgreSQL harness 以及仓库权威的 Makefile、pre-commit 与
CI wiring。它覆盖每个规范 identity/fact field 的逐字段 mutation、逐字节 idempotency 与 same-identity
conflict、普通/correction predecessor topology、response loss、restart、transaction rollback、历史 exact
readback、receipt/coordinate tamper 与 cross-splice、predecessor gap/branch/cycle/regression/cross-lineage
rejection、V1 byte/meaning preservation，以及所有 non-Owner write path 的数据库 ACL denial。consumer
oracle 在 1-minute trigger 间重复同一 1-hour 与 exchange-session `1d` sample 而不 double advance；等值新
sample 与已接纳 correction 各推进一次；restart 后返回相同 native receipt bytes。在具备该 dynamic evidence
前，本合同不声称 provider authenticity、production migration/deployment、Dashboard、Paper、Live、BFP
executable maturity、Backtest 产品闭合（包括 inverse/quanto target-consumption 语义）、
Dashboard/default-database 准入或 trading authority。这些 Backtest 限制不创建 Market Data instrument-class
rejection。

### CURRENT/PARTIAL Binance bar 成交量与 taker 买入量

两个 Binance Data Client，即现货（`crates/adapters/binance/src/pit_observation_source_v1.rs`）与 USD-M 永续，都在已收盘
bar 的 `OPEN`、`HIGH`、`LOW`、`CLOSE` 旁边陈述它的 `VOLUME` 与 `TAKER_BUY_VOLUME`，以基础资产为单位，用 bar 自己的
timeframe。两个数与价格来自同一个 kline 响应，所以不增加请求。

- **为什么需要 `VOLUME`。** 每个原生 Replay 帧都恰好用 `OPEN`、`HIGH`、`LOW`、`CLOSE` 与 `VOLUME` 投影出一根 bar
  （`native_replay_scheduling_v1.rs` 与 `native_replay_scheduling_v2.rs` 中的 `BAR_FIELDS`），census 缺其中任何一个的成员都会被拒绝。
  没有 `VOLUME`，从 Binance 快照铸出的帧一个都投影不出来。
- **taker 卖出量不是一行。** 它等于 `VOLUME - TAKER_BUY_VOLUME`，在消费方第一次需要它的地方推导，不陈述两次。
- **数值按发布原样。** 永续的数量是交易所的十进制字符串；现货的数量是交易所的 128 位 mantissa，配响应中的数量指数。
- **状态。** 两个 client 今天都会给出这两行，任何指定它们的部署都会得到。帧投影仍然受上文 Binance quote 缺口的阻挡。这些行由交易所替身测试、
  两个 live 源测试，以及无凭据的 Market Data 端到端证明断言。

### CURRENT/PARTIAL Binance 永续持仓量行

Binance USD-M 永续 Data Client 在成员最后一根已收盘的 bar 旁边，陈述在该坐标当时或之前最后发布的持仓量。共三行，channel 为
`MARKET`、data kind 为 `SCALAR`、timeframe 为 `TICK`：

- `OPEN_INTEREST`：合约数。
- `OPEN_INTEREST_VALUE`：以计价资产计的名义价值。
- `OPEN_INTEREST_TIME`：以纳秒计的快照时刻。

时刻按公开端点的约定陈述，归档把同一个快照标早五分钟。

- **在快照时刻之后五分钟可知。** 交易所每五分钟采样一次持仓量，约两分钟后发布每个样本（2026-10-02 实测 104 到 144 秒）。因此时刻为
  `T` 的快照，只有在 `T + 5 minutes <= c` 时才对坐标 `c` 可见。
- **两条路由，按年龄选择。** 路由取决于检索时按墙钟计坐标有多旧。scope 的检索坐标不能决定它，因为回放陈述的是一个历史坐标。29 天以内的坐标由无签名的 `futures/data/openInterestHist`
  端点回答，它只提供最近 30 天。更旧的坐标由公开归档中包含该快照那一天的每日 `metrics` 文件回答，连同它的 `.CHECKSUM` 侧文件一起取回，
  SHA-256 不一致就拒绝。
  - 两边都有快照时，两条路由陈述的是同样的数。BTCUSDT 在 2026-10-01，端点与当天归档文件共有的 287 个快照，在把归档的 `create_time`
    向后挪五分钟后全部相等；不挪则每一个都不同。端点当天的第 288 个快照挪入了下一天的文件。
  - 归档里的 taker 比例列遵循另一种约定，所以这里不读取它。
- **缺席就是没有行。** 当坐标前十五分钟内没有可见快照时，成员没有持仓量行，这同时涵盖交易所样本的空缺与归档某一天没有该快照的情况。
  归档文件缺失或不一致、端点不可达、数值不是十进制数，都会拒绝整次检索。
- **与 funding 一样不用凭据。** 两条路由都不签名任何请求，也不发送 key。
- **状态。** 指定 `binance-perpetual` 的部署今天就会提交这些行，还没有消费方读取它们。单元测试用一个本地的交易所与归档主机替身驱动两条路由；
  live 源测试从真实归档读取一个 2025 年的坐标；无凭据的 Market Data 端到端证明从端点读取一个近期坐标。

### CURRENT/PARTIAL Binance 永续已结算 funding 行

`crates/adapters/binance/src/futures_pit_observation_source_v1.rs` 中的 Binance USD-M 永续 Data Client 回答一个
scope 时，给出每个成员最后一根已收盘的 bar，并在旁边给出该成员最后一次已结算的 funding。funding 是两行，channel
为 `MARKET`、data kind 为 `SCALAR`、timeframe 为 `TICK`：字段 `FUNDING_RATE` 是交易所发布的原样十进制数，字段
`FUNDING_TIME` 是以纳秒计的结算时刻。两者都来自无签名的公开 `fundingRate` 端点，取 scope 的 event-effective 坐标
当时或之前的最后两次结算，所以恰在该坐标的结算被包含，晚一毫秒的不被包含。

- **在结算时刻可知。** 已结算费率在它自己的结算时刻可知。公开归档的 `calc_time` 与端点的 `fundingTime` 相等，费率也相等，
  2024-01 的 93 次 BTCUSDT 结算全部如此。
- **缺席就是没有行，绝不是一个值。** 成员第一次结算之前，以及最后两次结算所推出的下一次结算在该坐标已经逾期时，该成员没有
  funding 行，client 也绝不以零费率代替。需要 funding 的消费方因缺这个字段而拒绝。端点不可达或拒绝调用、费率不是十进制数、
  结算时刻晚于坐标，这三种情况各自按有界类别拒绝整次检索。
- **不用凭据。** client 拒绝建立在持有凭据的 HTTP client 之上，它的请求不带 `X-MBX-APIKEY` header，也不带
  `signature` 参数。
- **状态。** 这个 client 就是 `MARKET_DATA_OBSERVATION_SOURCE=binance-perpetual` 组装的那一个，所以指定它的部署今天就会提交
  funding 行；还没有消费方读取它们。该文件中的单元测试用一个本地的交易所替身驱动它，无凭据的 Market Data 端到端证明在实时端点上
  断言这些行。
- **不陈述的内容。** 结算间隔不是一行：端点不陈述它，所以 timeframe 是 `TICK`，而不是猜出来的间隔。来自
  `premiumIndex` 的实时估计、Replay 中的 funding 计提，以及 Design 可以引用的 funding 字段语义，是各自独立的切片。

## 输入交接

- 数据商和交易场所通过 Data Clients 提供原始行情和参考记录，而每一个时间坐标都归属于陈述它的那个时钟，不是
  归属于准入它的那个时钟。场所陈述事件生效时刻与提供方可得时刻，并且分别陈述：前者是事件发生的时刻，后者是
  场所发布它的时刻，拿其中一个当另一个用，等于断言了一次场所从未声称过的发布。在这一对之外，同一套词汇经由
  三条进料口到达本 Owner，而三条在时钟归谁上各不相同：从其中一条学到的规则，用在另外两条上都是错的。一次
  提交的 PIT Snapshot Request 对每个坐标同时携带值与提交方所声称的时钟身份与纪元；本 Owner 不赋值其中任何
  一个，只以自己的密封头逐一比对被声称的时钟来准入它们，不一致即拒绝。一次 Instrument Master 提交只携带坐标
  的值，完全不带时钟；本 Owner 把被准入的事实绑定到自己当前的时钟头上。在实时行情通道上，本 Owner 以宿主
  进程的时钟而非密封头陈述获取坐标，因此它既不能与场所那两个时刻相比较，也不能与任何一个密封头下的坐标相
  比较。把一个坐标绑定到密封头是准入，不是归属：在 PIT 这条进料口上，被声称的时刻在被该头准入之后仍然是
  提交方的主张，绝不能拿它与一个 Owner 陈述的时刻相比较，仿佛两者出自同一个时钟。记录没有陈述某个坐标就不
  产生该坐标，本 Owner 绝不用自己的时刻 事件时刻 或相邻记录的时间戳，去顶替来源没有陈述的坐标。
- [R&D](./rd/) 在探索消费前提交初始冻结 PIT Market Snapshot Request，绑定 Research Request
  Intent TrialFamily、instrument 或 universe scope、四时间决定截面、必需 provenance license correction
  frontier、稳定 correlation 和 Time Evidence。
- [R&D](./rd/) 只有从已提交 `REPAIR_INPUTS` Iteration Decision 才能发出一个 Market Data
  Repair Request。它重复原始 PIT 请求身份与证明摘要 标的范围 决策截面 有界理由 稳定 correlation
  必需 provenance license correction 字段和共享 Time Evidence。
- 运维提供 Market Data Source Binding 不透明 credential handle 许可范围和修订数据，但不能改写历史可观察时间。
  凭据不能进入 snapshot stream artifact 或产品视图。

## 输出交接

- 向 [R&D](./rd/) 提供 move-only、由 Market Data 密封的 `ResearchPitTerminal`；其规范六状态 disposition
  关联准确初始请求身份 内容摘要 scope cut provenance license correction 和稳定 correlation，并附准确 Universe Selection Record 身份与
  摘要用于假设检验。修复请求另以同一关联请求身份返回携带已修复 snapshot 的 `AVAILABLE`，或携带
  有界决定性来源类别的终态 `UNAVAILABLE`。
  R&D 不能 import、construct、deserialize 或 implement terminal authority，也得不到 raw store
  receipt、PIT lineage row、Source Binding lineage row 或 clock row。
- 向 [Backtest](./backtest/) 提供绑定请求 PIT 范围和 snapshot/correction rule 的准确 PIT Market Snapshot
  与 Universe Selection Record。**TARGET：** 直接 `BACKTEST_OWNER_V1` Instrument Master resolution 提供
  sealed fact/cut readback；实际消费与 Run Result 必须重复准确 snapshot、selection、Instrument Master
  fact/cut 以及每个冻结 execution identity。
  **实测 2026-09-22，而本段的第一版把形状判错了。**一个 PIT 快照是一个 as-of 切面，所以 N 根 bar 就是 N 个
  冻结请求。`BTCUSDT.BINANCE` 的 `1M`，512 个连续坐标产出 512 根不同的 bar 与 512 个不同的封印快照，
  严格连续、无缺口、无重复，耗时 767.8 秒。读回每个坐标解析到哪根 bar 是第二次场馆往返，也正是这句话
  说得出来的前提；同样 512 个坐标不带它耗时 655.4 秒，下面的计时都以这些不带见证的轮次为准。
  主导这段时钟的**不是**场馆：把往返减半只省了 15%，而 256 坐标那一轮里全部 SQL 执行时间加起来只占 1.2%。
  成本随**库里已经有多少快照**增长。在同一轮 256 个坐标内，单坐标成本从前八分之一的 0.131 秒升到最后
  八分之一的 1.182 秒。`validate_owner_history_custody` 每次提交都遍历库里每一条 lineage，而每个快照都开
  自己的一条 lineage，于是第 n 次提交要重新校验 n 条、每条六条语句：N=256 时是 101,509 次迭代、609,054 条
  语句，正好把实测时钟填满。所以总成本是二次的。三轮不带见证的实测 - 64、256、512 个坐标分别耗时
  12.1 秒、169.2 秒、655.4 秒 - 拟合出**在测量主机上 t 约等于 0.033 N 加 0.0024 乘以 N 的平方秒**，误差
  0.7% 以内；而更简单的 `0.0025 N squared` 恰好穿过 512 那一点，却把 64 低估了 15%。
  按该曲线外推（这是外推，且假设库从空开始）：**一年的日线约五分半，一年的分钟线约二十二年**，
  而不是第一次测量按线性读出来的那个"天"。一年的日线坐标此后已经跑过一轮，耗时 336.5 秒，但那一轮带着
  见证探针，而且换了标的与周期，所以它佐证的是量级，没有在受控的点上检验这条曲线。实际后果是：几百个
  坐标的有界窗口很便宜；长跨度的分钟级历史这条路径根本到不了；而且**一个从不重置的库会让此后每一个快照
  对每一个写入者都更慢**，所以在共享链路库里累积快照，花的是一笔不会回来的预算。
- 向 [Scanner](./scanner/) 提供已发布激活条件请求的准确 PIT Market Snapshot。
- 向 [Runtime](./runtime/) 提供携带同一 Market Semantics Compatibility 身份的实时行情流和标的更新；
  generation 的 Strategy Artifact 与历史证据必须消费该身份。
  **CURRENT / PARTIAL，一条实时事实通道，已建成并证明：** Strategy Instance 消费的增量 `LiveMarketFactV1`、它的 Owner 封缄
  intake，以及其后恰好一个 Data Client，即场所的公共 WebSocket。供应商侧只陈述场所能知道的事，与 PIT 观测缝既有的要求
  一致；Owner 盖章已准入 Source Binding 的身份与谱系、该绑定的 Market Semantics Compatibility 身份，以及唯一属于它自己的
  那个时间坐标即 retrieval 时刻，连同序号。场所以自己的时钟陈述 event-effective 与 provider-available 两个时刻，而 Owner 的
  retrieval 时刻取自宿主进程时钟而非其密封头，所以跨这些时钟的序都不可证，本 Owner 也不断言任何这样的序。Owner 拒绝
  自己所签发订阅之外的标的，并保留持久头部，使重启后从停下处继续交接而不是重放。此处不准入其他任何
  事：没有第二条通道、没有标的更新流、没有 Runtime 托管、没有下单路径。
  **NOT_ADMITTED：** 一条实时通道不建立 Runtime readiness、Paper、Live、真实交易或任何其他生产写；流式事实永远不是 PIT
  快照、replay 输入，也不是回答历史问题的证据。
- **IMPLEMENTATION_ADMITTED，一片实时行情读面，2026-09-21 准入且尚未建成：** 一个实时行情事实的消费者由它自己的数据库
  角色识别，它能读到什么在读之前就被收窄，而不是在读的时候按调用方的声称过滤。准入的形态是每消费者一个视图，属主为
  `market_data_owner`，限定在该消费者被准入的那些 binding 上，`SELECT` 授予该消费者的角色，且对 `market_data_private`
  零权限。该角色就是这个消费者可见内容的上界：绝不是 `rd_owner`，也绝不与另一个消费者共享一个超集，所以这个界由数据库
  执行，而不是靠信任某个进程持有凭证。今天不需要比角色更细的调用者身份，本 Owner 也不引入；若将来确有需要，每消费者
  一个角色仍是它的上界，在该上界之内细化是唯一准入的形态。此处的准入是建造并验证这一片读的许可，它不授权任何 Runtime
  效应、任何 Paper 或 Live 适配器绑定、任何生产写，也不授权真实交易，并且不准入 Runtime 侧的那个消费者，即 `B8`
  点名的另一半。首次交付要同时陈述其证明的两侧：该消费者自己的视图只返回它被准入的那些 binding，而另一个消费者的视图
  与 `market_data_private` 对它都必须是拒绝而不是返回零行，因为本该拒绝之处返回空，说明授权给宽了。
- 向 [Portfolio](./portfolio/) 提供价格 汇率 合约规格 估值事实，以及 Capacity View 使用的带身份流动性输入截面。
- **TARGET，在 Shared Time producer 闭合后，向 [Portfolio](./portfolio/)：** 为 `PORTFOLIO_FRESHNESS` 提供
  sealed 规范 clock-head handoff。Portfolio 提交自己的准确 prior handoff 并独自授权自身 transition；不能
  遍历或跳过 proof link，也不能跨 epoch 比较 monotonic sequence。

## 拒绝和禁止事项

- 不替研究 回测或扫描选择标的和时间窗口。
- 不静默填补 改写或前移缺失的历史事实。
- 不把数据源可访问等同于许可完整 PIT 正确或适合某策略。
- 不准入不可用 已撤销 endpoint 不匹配 摘要不匹配 不可信或无许可来源，不暴露 credential 值，
  也不在 redistribution scope 之外投递数据。
- 不拥有策略 资格 部署 订单或账户状态。
- 不从送达 静默 旧 snapshot 或不匹配请求证明推断修复终态。修复不改写旧 snapshot 或 Research Intent。
- 不从提交或传输确认推断普通 snapshot 结果，也不在请求身份 内容摘要 scope 决定截面或政策 binding
  已变化时复用旧 snapshot。
- 不成为 global Time Owner，也不替其他 Owner 决定 clock transition。
- 不仅凭 DSN、secret、caller assertion 或含糊 store state 构造受治理 Market Data PostgreSQL repository。
  Market Data 私有 store-admission seam 必须消费并 revalidate 准确 sealed Deployment Store Admission receipt；
  随后 Market Data 必须校验当前
  PIT、Source Binding 与 clock head，才能密封 `ResearchPitTerminal`。普通 consumer 永远得不到 receipt、
  capability、raw evidence 或 caller-selected snapshot query。
  production resolution 与动态 product composition 保持 `TARGET / UNAVAILABLE`。

## 失败与恢复

数据不可用 过期 无许可 含义不明或不足时，依赖消费者必须失败关闭。修订生成新的可追踪版本，不能改写旧回执。恢复期间 Market Data 继续提供估值事实，但不能宣布持仓 外部效果或 Recovery Case 已闭合。

provider catalog 的 `LEGAL_REVIEW_REQUIRED` 或其他权利未知映射为 `RIGHTS_EVIDENCE_UNRESOLVED` 与
Source Binding `UNAVAILABLE`；没有决定性拒绝证据时不得变成 `UNLICENSED`。`TERMS_OR_LICENSE_BLOCKED`
只属于 R&D Source Intake 终态，不是 Market Data 状态。Market Data 必须用自己的政策重新评估底层
rights evidence，绝不能跨 Owner 复制该终态。

同时支持多个 blocker 时，binding 与 snapshot 保留完整集合并选择一个稳定 primary。Snapshot 优先级为
`UNLICENSED`、`AMBIGUOUS`、`STALE`、`INSUFFICIENT`、`UNAVAILABLE`。来源 `REVOKED` 或
`UNLICENSED` 映射 snapshot `UNLICENSED`，`INCOMPATIBLE` 映射 `AMBIGUOUS`，来源 `UNAVAILABLE`
映射 snapshot `UNAVAILABLE`。后续证据只能创建后继 binding 与 snapshot，不能升级旧终态。

任一时间坐标或共享决定截面缺失 冲突，或不能证明该事实在决定时已经可用，快照必须为 `AMBIGUOUS`
或不可用。只有事件时间不能接纳历史事实，决定截面之后取得的数据不能回填更早决定。

## 决策契约

- **输入** - 已接纳 source binding 原始行情与参考记录 correction feed license scope，以及请求方拥有
  的 universe rule 或 PIT scope。
- **诊断与决定** - 统一含义 建立四时间可用性 解析 instrument identity coverage correction license，
  再生成一个版本化事实或 snapshot disposition。
- **冲突解析** - source lineage 和决定时可用性高于后续 correction；identity clock version 冲突时保持
  ambiguous，修订只创建后继。
- **输出与终态负例** - stream instrument fact selection record PIT snapshot，或明确 `INSUFFICIENT`
  `STALE` `UNLICENSED` `AMBIGUOUS` unavailable。
- **反馈与经济意义** - 历史和实时含义一致可阻止 look-ahead 错误合约条款或无许可不完整数据造成的
  虚假 Alpha 估值漂移和不安全 sizing。
- **禁止** - 不决定研究目标或策略 universe，不拥有生命周期 订单 账户投影，不泄露 credential，不
  forward fill 或改写可用性历史。

## 后续实现验收

- 历史查询可以证明请求时点实际可观察的数据版本。
- 每条已接纳事实都用同一时钟和决定截面证明事件 provider 可用 检索和修订发布时间，后知事实不能
  变成更早已知证据。
- 标的身份和合约条款在研究 重放 实时数据 估值和执行适配器之间一致。
- 历史与实时消费者遇到 Market Semantics Compatibility 身份不匹配时必须拒绝，不能在部署时静默改变
  normalization adjustment timestamp 含义或 instrument mapping。
- 每个 PIT 请求都证明 calendar session time zone corporate action lifecycle 历史 membership 和
  universe-selection 版本在请求截面同时已经生效且可观察。
- 每个普通 Research 响应都重复准确初始 PIT Market Snapshot Request 与 correlation binding；含义变化
  必须创建后继请求，静默不能创建 Market Data 或 Research transition。
- 数据不足或过期会得到显式结果，而不是合成成功。
- Data Client 一行都没有答时，属于覆盖不足，不是批次不规范。快照以 `INSUFFICIENT` 连同其覆盖 blocker 提交，不存
  observation batch，因为一个 batch 至少有一行。它的 records digest 是零行规范编码的 digest，任何有行的 batch 都不会是
  这个值。同一请求再次到来时，无论已提交快照的 disposition 是什么，都加入它，且不写入任何东西。
- 对相同准入版本重复生成快照可得到相同规范输入。
- 快照结果必须明确为 `AVAILABLE` `INSUFFICIENT` `STALE` `UNLICENSED` `AMBIGUOUS` 或
  `UNAVAILABLE`。每个修复响应还必须重复 repair request 身份 稳定 correlation 和原始请求证明摘要。
- rights compatibility freshness sufficiency availability 同时失败时保留完整 blocker set，并由冻结优先级
  在任意证据到达排列下选择相同 primary。
- Qualification 冻结保护请求后，重放不能替换 PIT 范围 Universe Selection Record 身份或摘要 快照规则 修订前沿或快照身份。
- 同 epoch handoff replay 合并准确 bytes；前进必须严格推进必需 cut 且不改变 epoch 语义。新 epoch 的新 head
  与 direct immutable proof 若未原子提交并可按 digest 准确回读，必须失败关闭。
- 面向 `BACKTEST_OWNER_V1` 的原生 Instrument Master resolution 对相同 request identity 与 meaning 返回相同
  fact/cut identity 和 canonical bytes；wrong-role、overlap、late-correction、gap、stale、unavailable-store、
  response-loss 与 changed-meaning case 都证明上述 fail-closed 与 successor-only rule。

## 可观测性与持久化

Market Data 在自身写权威下持久化 Source Binding、rights/retention decision、semantics profile、instrument history、PIT request/snapshot、stream/valuation fact、correction 与发布 outbox。Telemetry 记录 provider request latency、新鲜度、缺口、rate limit、correction lag 与有界拒绝类别，但不导出 API key 或受许可约束的 payload body。Dashboard 的来源健康状态必须携带 source/semantics 版本、as-of frontier、license disposition、完整性与 valid-through；绿色 provider metric 不能替代缺失或过期的 PIT fact。
