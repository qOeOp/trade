# Dolt Agent 契约改良与验收

本轮依据[台账审计](dolt-schema-content-audit.zh.md)落实共享产品能力。目标是让错误难以获得超出证据的复用权威，提供可操作的修复反馈，并降低下一轮研究检索和取证成本。没有数据库内置 LLM、研究流程调度器或新的交易账本。研究解释是否准确和有价值，仍通过独立审阅及下游研究任务检验。

## 字段准入与独立审阅

用户要求每个新增字段必须先由独立子 Agent 审阅，防止业务复杂度转化为字段数量膨胀。这条要求已写入 AGENTS.md。审阅必须说明实际消费者、独立事实，以及为何现有字段或固定关系不能表达；给出 retain/drop/derive 和反例。没有实际消费者的字段延期。

`independent_field_review` 对初稿作只读审阅；首尾核验 `attempt.schema.json`、`contracts.py`、`common.py` 的 SHA-256 均一致，基准 Git 为 `adba33f404525b0b91058d3d1d7ab06d1fa90547`。它建议删除五类重复内容，本轮已吸收。审阅范围是字段设计；代码和消费者另行验证。

本轮沿用五张 SQL 表，新增 SQL 表/列均为零。新增持久 JSON **语义叶字段为九个**；三个结构容器、复用 fixed-ref 的 id/revision 及派生关系索引不作为新研究事实计数。

| 字段 | 保留原因与消费者 |
|---|---|
| attempt.purpose | 登记时声明研究、工程、演示或未知用途；find/material search 用途过滤。历史缺失显示 unknown。 |
| contract.selection.family_id | 表达可能跨 lineage 的选择家族；find --family-id 找回同家族失败和待定尝试。复用同一 realized comparison family ID。 |
| contract.selection.primary_response | 事前主响应不能从结果最优指标反推；家族查询和 brief 展示冻结主响应。保持字符串，不新增指标语言。 |
| contract.selection.known_exposure.status | 登记前接触结果的声明与后来 evidence_grade 不同；注册校验、brief 和审阅使用。unexposed_declared 仅是声明。 |
| contract.selection.known_exposure.run_refs | 固定已见运行与后来新运行不同；发布校验存在性，生成轻量固定关系。空数组合法。 |
| decision.basis.mode | paired/descriptive/source 是判断意图，不能从 run.role 推断；发布守卫和决策查询使用。 |
| decision.basis.candidate_run_ref | 多个 run 中指出真正作决定的固定运行；发布验证归属及比较口径，读取固定证据图。 |
| decision.basis.evidence_refs | 指出实际审阅的固定对象；来源失败、诊断和描述性决定同样可以发表。 |
| retention.claim.aliases | 仅 component 的新 v2 准入可保存最多八个经审阅的短名称；检索沿明确固定复用关系召回，避免跨义正文扩词。 |

已删候选：run_budget、stopping_rule、known_exposure.notes 使用既有 plan/scope；control_run_ref 从候选的唯一固定 compared_with 边派生；claim.mechanism_refs 使用既有 typed relations。错误响应 reason 与 message 重复，details 无明确消费者，均删除。预算、停止条件和研究价值不通过必填自由文本假装获得保证。

错误、匹配原因、选中 revision、取证状态、共同审阅分组及 brief 省略说明均是派生 DTO，未另存入数据库。

### 重建资料的字段审阅

追加修复由独立 `reconstruction_contract` 审阅，结论是 retain 既有 `recipe_ref` / `verification_ref` 的角色、既有 material 原文字节与哈希、来源 provenance，以及 publication 已有的 `input_sha256`；derive 恢复入口；drop 专用表、路径映射注册表、恢复引擎和额外 reviewer 字段。请求哈希的实际消费者是 operation 重试：原请求的路径式输入与规范化后的固定材料引用不同，必须能在原文件消失后识别改动过的原请求。

新 admission v3 接受固定材料引用，或把既有 `{path, sha256}` 文件输入在同一次事务中保管为 material，存入的 `recipe_ref` / `verification_ref` 统一使用既有 `{id, revision}`。同哈希已有材料复用完整旧对象与 provenance；两种角色可以引用同一个原件。材料字节、准入、发表凭据和 admission_evidence 一起发布；不增加 SQL 表/列或新的业务事实字段。原件保管不等于执行过重建，也不自动保管配方内部所需的镜像、Catalog 和依赖。

## 实施边界

1. 先合入正式 main 已支持的 native v2 消费者，再实现元数据契约；不通过扩大枚举伪装运行支持。新版本先支持消费者再共享发表，演示使用隔离库。
2. `show/compare` 校验选中目标及其固定依赖，`find` 先筛选再校验候选，失败命中明确显示身份和版本；`validate` 保留全库检查。固定历史证据不能被 latest 替换。
3. `contract attempt/run` 离线提供 Schema 描述。发表准备和 `--dry-run` 使用同一路径；JSON 错误提供 code/path/expected/next_actions/write_status。未观察到写入结果时保持 unknown，不诱导盲重试。
4. 新事前登记 v3 保存上述最小上下文，第一次 pending/pending；原 v2 冻结合同及历史读取保持。意图变更需要新 attempt。completed v3 绑定证据，比较控制对象从固定关系读取，失败和不确定结果仍可保存。
5. 领域检索按用途、结果和知识/决策/档案视图筛选，解释匹配字段。准入仅适用于受审 target revision；来源纠正提示固定影响和共同审阅，保留原经济事实。
6. 简要读取以确定性投影限制总 UTF-8 字节，原始字节、逐事件和重复来源按需完整读取；取证状态区分声明、历史凭证和当前实际哈希读取。
7. latest 对象在 SQL 中筛选后返回 JSON，避免先读取所有历史大载荷。新关系只保存端点与必要定位/范围，不复制来源原始字节。既有原文不在此轮删除。

没有可信 Claude/Codex 会话身份适配器时，reviewer 和 aliases 仍是 Agent 的声明。本轮没有把填写 UUID、不同模型或报告存在当作独立审阅执行证明。

### 错误反馈覆盖复核

追加核实发现的关键反馈缺口已修复：Schema、准入、资料审阅、固定原件及正式发表版本冲突提供具体 code/path/expected/next_actions。准入及审阅的原有拒绝分支已细化；通用 CLI 提示仍用于其余低频生命周期和读取错误，不能声称所有产品错误均已专用化。

本地校验拒绝及正式 stale-version 拒绝标 not_written；原操作内容冲突明确只表示此次重试未写入，原操作可能已经提交，要求先查原回执并保留原请求。原生事务冲突或连接失联保持 unknown，不诱导盲目换 operation 重试。确认发表后的状态读取失败标 already_committed，要求沿真实 operation/commit 回读。run 的 Schema 指引指向 artifact register，避免误导提交 attempt。研究意图或固定依赖变化明确要求新 attempt。

独立 `reset_backup_design_review` 复核发现并关闭两个格式反馈 P2：审阅版本仅接受精确整数 1，拒绝 true/1.0/字符串/null；原文字节字段的错误类型返回结构化错误，不漏出 traceback。最终九文件首尾 SHA 一致，未发现本轮关键反馈范围内的未关闭 P0/P1/P2。真实隔离 Dolt 的完整回归 **284 项通过**；没有增加 SQL 表/列、业务事实字段或身份认证平台。

审阅身份认证另属未建设能力：现有 reviewer/rationale/scope、决策原件与哈希校验能约束声明和保管完整性，不能证明真实独立 Agent 执行或结论有研究价值。发表 API 执行上述语义校验；裸 SQL 管理写入可以绕过它，不能称为数据库内核强制执行了独立审阅。

## 验收与下一轮真实 R&D

### 审计关闭状态

八项发现的主要产品实现及上述关键反馈缺口已补齐。存量试用数据修订、异机恢复及真实多轮研究效果另行验收。下表区分实现状态与这些边界，不将它当作新的存量数据审计。

| 审计项 | 当前状态 |
|---|---|
| 合同兼容与读取边界 | 新消费者与选中闭包已实现；固定 v1 旧登记保持拒绝，提供原件读取命令。 |
| 研究概念召回 | 用途过滤、匹配原因、受审 component aliases 已实现；共享存量用途及中英文别名未补齐。 |
| 家族与暴露 | 新 v3 已实现，拒绝已知矛盾；历史未知不伪造事前事实。 |
| 决策精确依据 | completed v3 固定 basis 已实现；旧 v2 决策未批量补齐。 |
| 更正与待修复提示 | 三类效果、固定范围、共享审阅分组和 incoming repair 已实现；实际研究任务效果待验收。 |
| 领域不变量 | 自引用、重复来源、自我 control、pending 联动、固定 revision DAG 与冻结合同守卫已实现。 |
| 证据与访问状态 | 固定引用及实际哈希取证已实现；历史重复 bytes 未清理，完整恢复仍未验收。 |
| 摘要成本与 SQL 规模 | 32 KiB brief、latest SQL 和选中关系/审阅闭包查询已实现；千/万条无关关系的载荷诊断通过，真实多轮查询成本仍需验收。 |

SQL 关系查询已按 kind、固定端点、scope 或 edge IDs 在数据库中限定返回正文，保持历史 AS OF 和 dangling 检测。strategy lineage/publication 只查固定父节点；review status/prepare/apply 只查固定 inventory 的决策与证据闭包，链接按归一化后的 provenance.path 取历史材料及 sections。material show 按目标固定引用读取准入，不被无关坏准入阻断。显式 archive、迁移和 validate 保留全库语义；没有把普通查询包装成全库检查。

追加的[跨环境可移植性审阅](product-portability-audit.zh.md)发现并修复重建原件路径绑定、宿主时区漂移与持久化临时目录判定不一致。服务配置、个人路径示例、文档检查 cwd 及 JSON 默认编码问题也已修复。重建契约、时间/路径和服务候选分别经独立冻结审阅；未新增 SQL 表/列或业务事实字段。存量补齐、旧登记读取和历史去重仍属于试用数据的边界，新库不会自动继承旧问题。可信独立审阅身份认证尚未建设，reviewer 的声明不能作为真实执行证明；本轮没有以必填身份字段模拟认证。

产品回归在独立 Dolt server 的随机 `records_test_*` 数据库验证，未在共享库试写。验收覆盖错误反馈后修复、preflight 不写入、固定发表与重试、未知版本不阻断无关 show、失败命中可见、冻结合同、固定 control、合法负面证据、用途过滤、机制别名边界、纠正传播、历史取证和 32 KiB 简要读取。用户后续明确授权当前库本地 dump、完整历史备份和清空；该运维操作先停服、验证两种恢复，再归档原目录并初始化全新同名库，不通过回归测试或历史数据回填伪造研究验收。

已完成的检查：`uv sync --frozen`、原生 runner `--help`、`compileall` 与全套 `unittest discover -s tests -t . -p 'test_*.py' -q`；关键反馈修复后 **284 tests passed**，真实 Dolt 测试使用独立实例。服务另有 50 项相关测试、独立审阅修订后的 14 项定向测试，以及 Ruff、格式与 Mypy 检查。字段设计与实现复核由 `independent_field_review` 完成；读取/简要投影由 `retrieval_review` 发现五项问题，修订后原五项反例全部关闭。实现复核发现的 dry-run 转发、暴露矛盾、冻结家族口径、回执状态及历史 self reference 问题也已修正；不把子 Agent 同意当作科学正确证明。

真实 SQL 样例包含 11 历史修订、4 个当前身份，latest 读取由 116,285 降到 16,974 JSON bytes（约减少 85.4%），历史 AS OF 与 kind 改变语义通过。固定历史 H25a 的简要 CLI 为 14,941 bytes，保留 37 币摘要；H27a 原经济 outcome=failed 保留，D98 三条历史引用核验通过。

追加 1,000/10,000 条无关关系诊断：material show/search 选中样例均只返回 1 条、200 JSON bytes；10,000 条时全读为约 42.6 MB。策略 lineage 返回 2 条、128 bytes，publish 返回 1 条、64 bytes；已审 inventory 的 status/重复 prepare/apply 返回 6 条、2,758 bytes，两种规模一致。相关对象读取量也一致，无关的大证据和坏 review/admission 未读取。scope 的 JSON 条件仍可能扫描服务器记录；这些结果证明传回载荷范围，不能宣称服务器 CPU 恒定或完成真实 R&D 规模验收。

独立 `query_closure_review` 最初发现两个漏项：无关不兼容准入阻断目标读取，以及策略/审阅入口仍全读正文。最终候选补齐后，首尾核验 11 文件与规模结果 SHA 通过，两个漏项关闭；额外复核旧 review 作为固定证据时不覆盖当前 review、多版本 section 的字节匹配、合法长 ID 与固定历史来源。正常入口不再无条件读取全库关系正文；没有新增存储字段或把原历史引用换成 latest。

两币原生 host 诊断与 D105 固定报告配对通过：888 orders、66 fills、19 positions、2,117 account rows、366 returns 的非临时身份字段一致；439 次 funding 合计 -33.26180486 USDT、手续费 42.67346713 USDT、最终权益 102098.92127801 USDT 一致。原生 integrity 和 audit findings 均为空。该诊断使用本地 Python 3.14.6，原 OCI 为 3.14.8，不能称为恢复同一 OCI 执行身份；输出在 `/tmp`，没有登记为研究证据。

时间修复后另构建固定 `linux/arm64` OCI 镜像，探针核对实际代码哈希，在该镜像执行同一 BTC/ETH 固定源与输入。配对事实及经济结果一致，integrity/audit 均为空；镜像字节和结果保管在外部私有目录，详见可移植性审阅。这是新镜像的工程一致性验证，不是原镜像身份恢复、37 币策略资格或第二台物理主机灾备验收。

历史读取限界：`55u8…` 的 H27a/D102 固定父记录仍有不支持的 v1 Git 登记。正式 show 不接受这些旧登记，也不自动换成 latest；错误会指出固定 ID、版本和原件 `material show` 命令。资料视图可以读取原始决定及取证状态。这不是旧登记兼容层，不需要为了将清空的试用数据增加持久字段或重建历史。独立实现审阅同意保持这一边界。

2026-10-09 已完成用户授权的本地 SQL dump、完整 Dolt 历史备份及同名空库初始化。SQL 和原生恢复均核对全部表行与结构；原生恢复另核对历史、分支、旧快照和操作回执。原库目录保留在外部备份中。当前主库 `version=0`，对象、关系、操作回执均为 0，表结构保留，原配置不变；正式查询及全库 validate 通过，没有向空库写入测试研究数据。

下一阶段在全新研究库开展真实 Claude/Codex 多轮策略 R&D。先冻结验收任务及答案，包含找回负面结论、识别撤回、限范围复用组件、核验旧运行；分别检查错误复用、失败遗漏、取证成功与读取/迭代成本。已知审计反例作回归，另留未用于产品调优的新任务。重复干净会话 trial；几十个相关策略版本属于一条研究链，不能当几十次独立重复。

当次覆盖内零已知回归缺陷是可验证目标，无法硬保证未来随机模型永远不产生语义错误。本轮不会用清空数据掩盖问题，也不会把失败运行或未准入解释当作不能存储的内容。
