# 全新台账中的 R1 研发工作台发现

## RDP01：发表前未校验证据路径是否能被正式读取

- 受影响 attempt：`RD20261010-B00` 初始 revision 1。
- 被阻断的 Agent 任务：通过固定 `show --brief` 读取已登记合同。初始 `evidence_refs` 使用真实、带 SHA-256 的外部输入身份绝对路径；dry-run 和发表均接受，但正式读取将非 `artifact://` 路径按 Git 相对路径解析，拒绝绝对路径。
- 证据：初始发表 commit `l85iul0djd7ean00aqdubhpc8tg1rp1g`；正式读取返回 `invalid archived source path`。该问题是发表和读取契约不一致，不是输入文件损坏，也不能通过自动导入旧演示数据修复。
- 迭代成本：一次正式读取失败和一次正确追加决定。原生执行与完整性审计未受影响；合同、源码和运行时未被重写。
- 已用 workaround：保留原始 revision；运行封存后，revision 2 改用其 `artifact://` 输入身份、摘要与审计引用。当前正式读取成功。
- 最小共享能力建议：复用现有证据路径解析规则，在发表 preflight 中拒绝正式消费者不支持的路径格式，并提示先在现有 scope/plan 中绑定输入身份、再引用实际封存证据。不要新增本机路径字段或放宽任意外部文件读取。尚未实施这个产品改动。

## RDP02：简要引用状态与真实封存核验状态需要区分

- 受影响 attempt：`RD20261010-B00` revision 2。
- 被影响的 Agent 任务：从简要结果判断原生封存证据是否已经核验。`reference_status` 对真实 `artifact://` 引用报告 `declared / no_fixed_archive_for_path`，但正式 evidence 检查和 artifact verify 已验证其 SHA-256；简要视图省略了 `evidence_status`。
- 证据：当前固定 commit `3ks90tfnrdr3794r3vcubom99gk77uee` 的 `show RD20261010-B00 --brief`，以及既有 `artifacts verify` 输出。材料历史归档解析与原生封存核验是两种证据，不能混作同一种状态。
- 迭代成本与 workaround：需额外读取完整记录或执行既有 verify，不能仅凭 `declared` 推断封存不可用。
- 最小共享能力建议：在已有简要投影中清楚展示封存核验状态及来源，复用已有字段，不新增持久化状态副本。尚未实施这个产品改动。

## RDP03：旧配对统计工具要求两策略源码相同

- 受影响 attempt：`RD20261010-C01`、`RD20261010-C02`。
- 被影响的 Agent 任务：对不同完整单文件策略的已登记配对运行读取原生日收益差异及不确定性。
- 证据：`backtest/r1/checks/compare_paired_returns.py` 的身份检查要求 `strategy_source_sha256` 相等。C01 与 B01 使用不同固定 Dolt 源码，但正式 `records.cli compare` 已核验共同输入、OCI、账户、成本与有效配置，并返回 `recorded_contract_matches`。
- 迭代成本与 workaround：正式配对描述可用，旧统计工具不能直接用于此类合法源码差异实验。不能修改报告哈希使其通过，也不能把候选角色当成控制。当前研究保留描述性结论；如需补充统计，仅以正式配对核验后读取原生序列的临时诊断完成，并声明开发样本与多次尝试局限。
- 最小共享能力建议：统计消费者复用正式配对契约，以各自固定源身份核验不同源码，保留同输入、同成本和同运行环境要求。不新增登记字段。不在本次 R&D 中修改现有拒绝边界；尚未实施产品改动。

## RDP04：零交易原生运行在报告阶段崩溃

- 受影响 attempt：`RD20261010-C06`，原始失败运行 `RD20261010-C06-P02`。
- 被阻断的 Agent 任务：区分没有源事件、没有成交与执行出错。BTC/ETH 的固定规则各读取 2,192 根完整四小时柱，源事件和原生订单均为零；旧镜像报告器访问零列订单表的 `status` 后抛出 `KeyError`，未输出摘要及审计。
- 证据：原失败 manifest SHA-256 `a58c2b5960e933df6689836e8c3effd520cb5ce10d17ffb5cee7cd0d63391ebf`；C06 的失败决定固定在 Dolt `murvr43ql1msbbpmigg0qlb2phvhlhfg`。原始失败字节保留，未把它登记为成功 run，未改候选规则制造成交。
- 迭代成本：一次无完整摘要的全年 pilot、一次独立源事件读回及一次新 OCI 工程验证。不能以合成 OTO 构造成功替代实际成交和保护覆盖。
- 最小共享修复：仅在原生报表零行时补齐已有消费者需要的 CSV 列名，不生成行、不修补非空损坏报表、不新增台账字段。空报表、源码加载和原生审计相关 25 项测试通过。
- 工程验证：新镜像 `sha256:d6bbbde7d87e8877985745fa38c8821fbeba3dc2e0cc9c84ae2bfaea0693e35f` 仅改变报告器源码，依赖锁、审计代码和有效配置保持一致。`RD20261010-E00-P02` 用完全相同 C06 源码成功封存零订单、零成交、零仓位和 100,000 USDT 原生权益，胜率为空；这只验证零交易可读，不是 C06 的策略执行覆盖或经济通过。非空控制回归另登记为 B03，完成结果以其固定决策为准。

## RDP05：候选登记后才发现成本说明与控制不一致

- 受影响 attempt：`RD20261010-C09`；固定候选 `RD20261010-C09-37@1`，登记 commit `g1cuoivn3cls6tde28652gqe9vje3v2a`。
- 被阻断的 Agent 任务：按合同读取候选与 `RD20261010-B03-37@1` 的正式配对差异。Agent 登记时错误地传入缩略说明 `frozen native fees and Catalog funding`；控制使用完整的原生手续费、历史资金费、五分钟 OHLC 执行和当前合约条款近似说明。`artifacts register` 接受了候选，之后 `records.cli compare` 才因 `incomparable runs: cost_model` 拒绝。
- 证据：两份封存报告的 OCI、共享运行代码、有效配置、账户、输入身份和窗口一致，策略源独立固定；成本说明文字仍不一致，不能用这些事实替代正式比较要求。真实原生运行与成本并未被更改，问题源自 Agent 的登记说明错误及写入前缺少配对预检。
- 迭代成本：一次正式比较拒绝，配对统计未执行。没有重复全年回放来获得新登记，也没有覆盖已封存 run 或降低比较边界。
- 已用 workaround：保留不可变登记，将本次未达联合目标的经济决定记为描述性失败，明确配对尚不可用。后续登记先读取固定控制的完整成本说明、核对实际封存成本事实，再使用一致说明；不能盲目抄写控制来掩盖不同费用模型。
- 最小共享能力建议：在候选登记的写入前，复用正式比较的契约检查，发现不一致时给出固定控制 ID、冲突字段和修复动作。继续使用现有字段，不新增成本文本副本，也不把自由文本近似相同当作费用身份相同。尚未实施该产品改动。

## RDP06：固定父关系的重复展开放大读取成本

- 受影响 attempt：`RD20261010-C12@2`；固定 Dolt commit `pn0aocn1n7qdmabklcij9hpamrun1omi`，台账 v128。
- 被影响的 Agent 任务：完成已封存候选的全库验证和简要决策读取。首次收尾命令出现 `DOLT_SQL_ERROR`，底层为本地 TCP `Errno 49: Can't assign requested address`。后续状态查询、固定对象读取正常，重试全库验证通过（26 attempts、27 runs）；未重跑策略、覆盖登记或降低验证要求。
- 已核实的结构问题：`research/records/cli.py` 的 `_dolt_lineage` 按每条路径递归展开共享祖先，每次调用分别读取对象和关系；`validate` 又对每个 attempt 重新调用。对该固定快照的父关系做只读计数，C12 单根展开 **2,405 个节点出现次数**，实际只涉及 **24 个不同固定 attempt 版本**。这是图结构计数，不是实测 SQL 调用数；不能据此认定它就是本次连接错误的唯一原因。
- 迭代成本与 workaround：多执行一次全库验证；通过直接读取固定 `attempt@revision` 确认经济失败决定，再重试正式验证。不能因读取失败把原生回放判为失败，也不能把读回成功说成连接资源问题已修复。
- 最小共享能力建议：在一次固定快照读取内复用 `(id, revision, commit)` 对象与关系查询；全库验证对 DAG 节点只验证一次，保留逐路径循环检测和固定关系歧义检查。简要读取应在展开前应用深度或预算边界，不先生成整个祖先树再截断。继续使用现有字段，避免增加持久化缓存状态。尚未实施产品改动。
- D09 收尾复现：`RD20261010-D09@2` 固定在 `f8va2hf2e7bae13p08kfs5s8ne1sk3ud`、v132。正式 `--at <commit> validate` 首次及一次重试均报相同 `DOLT_SQL_ERROR / Errno 49`，重试退出码为 2；全库校验尚未确认。决定及七份证据已经固定读回，错误后再次读取 D09 正常，台账 v132 干净，原生数据库备份及四套 seal 备份核验完成。这不证明祖先展开就是连接错误的唯一原因，也不把单条读回当全库通过。
- 本次迭代成本与证据：两次未完成的全库读取，未重复发表决定或运行策略。证据保管在外部配方根 `research-recipes/20261010-native-economics-diagnostic/post-publication-validation.json`，SHA-256 `06745666e186975fc63347771dbc6eb2c6af56660a13a98ff4be588115bc076f`；用配置中的配方根定位，不绑定用户主目录。沿用上述最小共享能力建议，保持正式校验规则和风险拒绝边界。

## 修复状态（2026-10-10）

按用户"能用 Agent 就不硬编码"的原则，以下只修现有读写路径的缺陷，不新增规则或字段：

- RDP01：`publish attempt`（含 `--dry-run`）对 `show`/`compare` 读不了的 `evidence_refs` 路径返回 `read_preflight`。第一版只报告；用户已同意确认不误拒后再改为写入时拒绝。
- RDP02：简要视图保留 `evidence_status` 与 `selection.known_exposure.run_refs`。B00 的简要视图同时显示资料归档状态 `declared/no_fixed_archive_for_path` 和封存核验结果 `verified`。
- RDP03：已由 #1490 的 `compare --analysis` 解决。
- RDP05：`artifacts register` 新增 `--dry-run`；候选带对照时返回 `pair_preflight`，复用 `compare` 的同一组记录检查（抽成 `_check_pair_records`）。用 C09 当时的成本说明做 dry-run，写入前即报出 `/cost_model` 冲突与双方原文。第一版只报告。
- RDP06：`_dolt_lineage` 在一次读取内只读每个固定祖先一次，`validate` 跨根共享。固定 v132 上 `show RD20261010-D09 --brief` 的连接数从 5,164 降到 402、耗时从 5.8 秒降到 1.3 秒，输出逐字节不变；`--at f8va2hf2e7bae13p08kfs5s8ne1sk3ud validate` 通过（27 attempts、27 runs，214 条连接，2.6 秒），此前两次因 `Errno 49` 失败。

## RDP07：决定证据原文没有 CLI 发表入口

- 受影响 attempt：`RD20261010-D09`（proof 操作 `rd-20261010-d09-proof`，v131）、`RD20261010-D10`（`rd-20261010-d10-proof`，v134）。
- 被影响的 Agent 任务：把 reader、结果与结论原字节固定为 `review_evidence` 材料，再在 `decision.basis.evidence_refs` 中引用。两次都只能直接调用 `research.records.reviews.retain_file` 与存储适配器的 `publish`。
- 迭代成本与 workaround：每次多写一段十几行的 Python；内容哈希与只读保管规则仍由 `retain_file` 执行，没有绕过校验。
- 决定（用户 2026-10-10 "能用 Agent 就不硬编码"原则）：不新增命令，把用法写进 `research-round` skill；若出现第三类调用者或误用，再评估最小 CLI。
