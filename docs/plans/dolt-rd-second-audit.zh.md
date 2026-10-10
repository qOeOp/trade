# R1 第二轮审计：把失败转成可验证改良

**用户对“策略没有越改越好”的主要担忧成立。** 11 个完成全年 37 币运行的候选，没有一个超过原点约 11.999% 年化，也没有达到 >20% 年化、58%–62% 净胜率联合目标。三条父链同时改善开发样本中的收益和胜率，但没有取得相对原点的收益与胜率联合改善，也没有独立确认的改进。现金流核对未发现台账或重复扣费压低胜率；主要问题是净优势不足，而研究较晚才系统诊断失败。首轮改良提升了可追溯性，尚未证明能持续选择高价值实验。**保留五表，优先补原生经济诊断、合法增量比较、一致预检和预算内读取，均无需新增字段。** [E1、E2、E3、E4]

审计日期 2026-10-10，固定 Dolt `h32e902jdn35qq3ahc60gn72em7a4fnh`、v130，Git `e0adc2ff1`。本轮只读生产库，核对字节、封存报告、合同、工具轨迹及选定查询；未改 SQL、策略、风险或既有决定，未新跑经济回测。旧审计只作背景，证据文件与 SHA-256 见文末。[E1、E2、E8]

## 11 个完整候选全年年化都落后原点，三条父链只取得开发点改善

快照有 **27 attempts、27 runs、15 策略**。22 attempts 用于研究，21 已决定、D09 pending；5 用于工程。12 个经济决定全部 failed，包含 B00 和 11 个完整候选。C06 是执行/覆盖失败，没有完整全年经济结果。9 个 execution/passed 没有冒充经济成功。所有 run 均为 `development_exposed`，包含控制、pilot 与工程，不能算 27 个独立经济试验。[E1、E2、E6]

下表为原生账户年化、净 PnL>0 的 closed Position 胜率、闭仓数、Sharpe365 和日收盘回撤；回撤展示损失幅度，不是盘中最大回撤。B00/B01/B02/B03 经济一致，属于工程复核，合并为原点。[E2]

| 全年 37 币运行 | 年化 % | 净胜率 % | 闭仓数 | Sharpe365 | 日收盘回撤 % |
|---|---:|---:|---:|---:|---:|
| B00/B01/B02/B03 原点 | 11.999382 | 42.741935 | 496 | 0.657979 | 15.326608 |
| C01 | -1.287684 | 37.054632 | 421 | -0.056846 | 16.314565 |
| C02 | 1.742850 | 38.866397 | 247 | 0.298829 | 6.472004 |
| C03 | -12.562478 | 15.283843 | 916 | -1.132473 | 14.928081 |
| C04 | -0.569198 | 35.175879 | 199 | -0.141331 | 5.098862 |
| C05 | 4.390115 | 36.363636 | 451 | 0.716410 | 6.389875 |
| C07 | -0.527966 | 16.666667 | 6 | -1.300731 | 0.670625 |
| C08 | -3.546655 | 38.341969 | 386 | -0.532202 | 6.371046 |
| C09 | -3.716539 | 22.950820 | 61 | -2.103535 | 3.988347 |
| C10 | -4.666074 | 47.882736 | 614 | -1.008542 | 6.605443 |
| C11 | 0.668864 | 53.642384 | 151 | 0.318608 | 1.863066 |
| C12 | -1.461207 | 28.813559 | 59 | -1.866454 | 1.737530 |

C06 无完整经济值；E00 零交易封存只验证工程可读。C09 原生指标可核验，但正式 compare 因 `cost_model` 文本不一致拒绝；表中读数不能冒充正式配对通过。[E2、E4、E6]

**三条固定父链确有局部改善**：C01→C02 年化/胜率分别 +3.030533/+1.811765 个百分点；C04→C05 为 +4.959313/+1.187757；C10→C11 为 +5.334938/+5.759648。变化涉及趋势准入、方向镜像、小时事件/selector，存在固定源码父关系。但父 run 仍是 candidate，子合同的正式控制仍为 B 系列；不能归因成单个组件效果，也不能事后换控制。[E1、E2、E4、E5]

C10/C11 胜率高于原点约 5.14/10.90 个百分点，年化却低约 16.67/11.33 个百分点。C05 Sharpe 点值稍高，差的重采样 95% 区间 [-3.300830,+3.332331] 跨零。8 组已存配对年化差区间全部跨零，明确承认重复暴露、未校正多次尝试、不是资格；没有父链改善的未暴露复验。[E2、E4、E10]

因此，按全年账户年化及收益/胜率联合目标衡量，最好已知方案没有提高，联合改进为零。C01–C12 更换多种完整机制，不是一条单参数优化曲线；序号不能证明趋势。原点 42.74% 胜率仍有约 12% 年化，C10 47.88% 却亏损，必须同时看盈亏幅度、成本和数量，不私自降低用户目标。DSR 原论文说明重复试验会增加选择偏差，相关记录数不能代替独立试验数，点改善也不能升级为可靠优势。([DSR 原论文](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf))

## 低胜率是真实原生结果，负毛收益、成本和规模需要分别诊断

逐一核对 **27 套运行**的 summary、audit、manifest、orders/fills/positions/account/returns、策略与 binding，未见哈希或身份不匹配。由真实 `OrderFilled` 买卖现金流扣佣金、加 FUNDING 的 `pnl_change`，逐仓核对原生 realized_pnl，最大绝对误差 **≤1e-8 USDT**。这是封存事实核对，没有新成交或替代 PnL 模拟器，不证明模型等于真实市场。[E2、E3]

本批毛盈利闭仓比例与净胜率相同，未发现费用将大量毛赢仓变净亏。下表只分解 closed 现金流；账户年化包含开放仓等变化，不能据此完整归因。[E2、E3]

| 运行 | 闭仓毛 PnL USDT | 闭仓佣金 USDT | 闭仓资金费 USDT | 平均净仓 PnL USDT | 平均净赢 / 非赢 USDT |
|---|---:|---:|---:|---:|---:|
| B03 | 12,283.38 | 965.81 | +15.75 | +22.85 | +320.52 / -199.36 |
| C03 | -9,788.03 | 2,698.14 | +235.49 | -13.37 | +272.02 / -64.86 |
| C04 | +108.30 | 559.33 | -23.86 | -2.39 | +236.72 / -132.14 |
| C05 | +5,707.55 | 1,328.73 | -24.35 | +9.66 | +257.15 / -131.77 |
| C08 | -1,785.27 | 1,645.08 | -96.36 | -9.14 | +208.60 / -144.53 |
| C10 | -3,274.20 | 1,390.18 | +118.77 | -7.40 | +85.82 / -93.05 |
| C11 | +1,001.64 | 340.32 | -10.19 | +4.31 | +92.87 / -98.16 |
| C12 | -1,157.16 | 265.77 | +0.06 | -24.12 | +111.96 / -79.19 |

**C03/C08/C09/C10/C12 毛 PnL 已负**，不能主要怪费用或加预算救策略。C04 毛利约 108 USDT 被约 559 佣金压过，属于弱毛优势不足以覆盖成本。C11 profit factor 约 1.0948、平均净仓仅 +4.31 USDT，胜率提高但净优势薄弱。三类失败需要不同下一实验。[E2、E3]

C03 已成交 parent 计划毛 RR 中位数约 6.40、净胜率 15.28%，高 RR 不预测高命中率；C05 约 2R、36.36% 胜率仍有正净 PnL。C10/C11 parent RR 约 1.60，Position 合并多个 parent，不能以单父单几何代替净仓结果。[E2、E3]

固定 sizing 为 `q=min(equity×0.0025/n/stop_distance, equity×0.05/n/entry)`。stop_distance/entry<5% 时名义额度分支更小；B03 比例 46.60%，C10/C11/C12 为 96.56%/96.02%/100%。C11 闭仓 151 对原点 496，平均净仓也更低，少成交、尺度和薄弱优势同时影响收益。**没有时间加权利用率，不能声称闲置资本 X%、低风险是唯一主因或扩大风险就能达标**；档数不同，也不能把每个 parent 与 bundle 风险上限直接比较。[E2、E3]

五分钟 OHLC、提交时钟与取消/过期会选择成交子集；native audit 不重建全部信号/几何。官方说明 OHLC 路径影响同柱次序，但本轮没有 pinned `2.0.0rc3` 路径配对、更细数据、全量历史币池或合约条款核验。**这些局限未被证实为低胜率主因。** ([Nautilus bar execution](https://nautilustrader.io/docs/latest/concepts/backtesting/bar-execution/))

## 来源和工程确实学到了东西，经济性择优闭环启动得太晚

D02 否决统一 wide zone 来源解释，E01/D03 验证时钟并固定研究者算法，C10 实际采用。D04 用事前固定、无未来/PnL 图样本否决“局部 first peak 等于完整推动腿”，D05 改事件序列，C11 采用后局部改善。D06 否决所有小时多头必须先突破大周期上沿，D07 容量/覆盖不足停下，D08 通过后才 C12。这些学习改变了选择，不能因最终经济失败抹掉。[E1、E5、E6]

C09 成本说明错误后，C10–C12 注册前核对固定控制和真实费用，正式比较通过。C06 空报表失败后，E00 做零交易、B03 做非空回归，旧失败未覆盖。这些纠错有价值，解决的是来源/执行，不等于获得净优势。[E2、E4、E6、E8]

D03 容量门槛主要回答是否有因果计划，没有证明净经济空间；首档 R<1 也不证明必亏，**首次 native 探索合理**。缺口在 C10 614 闭仓已给负净期望后，优先改来源/phase，而未先系统分解真实成交、成本、风险和净期望。C11 胜率改善而收益近零、C12 又失败，之后才登记 B03/C10/C11/C12 经济诊断 D09。v130 仍 pending，本审计核对不会代替或改写其决定。[E2、E3、E6]

局部预算与停止条件存在，C06/D07 确实停了；但材料中没找到 **family 总成本和连续经济失败后转诊断的规则**，不排除会话另有约定。同 family 含 17 个权益主响应和十类诊断响应，是研发分组，不是一个统计检验家族。[E6、E11]

多份计划排除所有 pivot/stop/target/TTL/weight 扫描，防无限事后救分正确，却也排除了有依据、有限预算、事前新登记的优化。AGENTS 没有要求全面禁改，这是 Agent 自施限制。NIST 区分比较、筛选、优化目标，建议先明确测量和简单设计，再用小实验逐步回答问题；应允许少量可反驳的经济改良。([NIST 实验目标](https://www.itl.nist.gov/div898/handbook/pri/section3/pri31.htm)、[设计步骤](https://www.itl.nist.gov/div898/handbook/pri/section1/pri14.htm))

工具轨迹未找到实际独立 sub-Agent 研究批判；`review_evidence` 只证明原件保管，不是审阅执行。这不等于违反新增字段 gate，也未证实造成收益失败。应对少数高成本计划独立读取源码、原生证据和来源，寻找反例，而非加必填身份。既有自我纠错实验说明无外部反馈并不稳定，但不能外推当前模型能力或保证 sub-Agent 有效。([ICLR 论文](https://arxiv.org/abs/2310.01798))

新库来自同目录 fork，继承旧研究上下文；真实轨迹又成功重复 fork 6 次并改名/发等待消息，至少 18 次操作成本，根因不能归为 Dolt 或底层 bug。**空 DB 不等于干净 Agent 或未暴露市场。** 所有 run 诚实声明暴露，重复使用同窗口的 holdout 也不能自行消除搜索影响。([PBO 原论文](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)) [E6、E8]

## 五表与固定关系值得保留，正式消费者仍有真实缺口

快照有 **488 revisions、462 当前身份、1,401 关系**。15 份源码字节/hash 和 199 份材料原字节核对通过，材料共 6,557,586 字节，大件多为来源图。初始 attempt 均 v3/pending/preregistered，完成决定有固定 basis。这些边界值得保留，不支持按条数判垃圾或再拆表。[E1、E6、E7]

| 现有结构 | 本轮价值 | 当前应补的消费能力 |
|---|---|---|
| objects 与固定 revision | 保管完整策略、合同、决定、材料和出版身份 | 由原生事实派生经济失败类型及直接父差异 |
| relations 与固定端点 | 表达派生、比较与证据依赖，防止 latest 偷换历史 | 让事前冻结的比较方向表达相对参考角色；共享 DAG 只读一次 |
| operations 与 write_head | 提供发表版本、幂等和回执边界 | 写前使用正式消费者同一套证据与比较规则 |
| record_store_schema | 保留格式和存储契约身份 | 不以格式版本或字段齐全代替研究价值判断 |

本轮未重验旧审计所有 DDL、孤儿或灾备结论。没有 admitted knowledge、retention 或正式 review decision，**零准入不是缺陷**：正式 economics find 找回全部 12 个失败，无工程噪声。D02/D04/D06 可定向审阅准入，不能批量把失败变知识。英文 support 与中文“支撑”集合不同，只支持补少量受审 aliases，不支持建设 RAG 平台。[E6、E7、E8]

正式消费者反例如下；“复现”“静态核对”“已工程修复”范围不同，未把代码阅读当新镜像回放。[E4、E8、E9]

| 发现 | 第二轮裁决 | 对 Agent 的实际影响 |
|---|---|---|
| RDP01 发表接受、正式读取拒绝绝对证据路径 | B00@1 读取仍拒绝；v2 可读是附属引用 workaround | preflight 没有提前定位不支持路径；纯读取仍给泛化 `RECORD_ERROR`、path=null、write_status=unknown |
| RDP02 brief 丢弃真实封存核验和暴露引用 | B00@2、D04 复现；投影白名单遗漏 `evidence_status`、`run_refs` | `no_fixed_archive_for_path` 容易被误读为原生证据未核验，需要额外 full read |
| RDP03 配对统计强制两源码 hash 相同 | 精确源码与真实工作流静态核对；本轮未新跑统计 | 合法不同策略无法直接消费；应各自核验固定源，不能只删除 hash 检查 |
| RDP04 零交易报表崩溃 | 已工程修复，E00 零交易、B03 非空回归有固定结果 | 原 C06 失败保留，修复只保证无交易也可读，不代表候选覆盖或经济通过 |
| RDP05 成本不一致到登记后才拒绝比较 | C09 正式 compare 仍拒绝，错误指引泛化 | 白跑后才发现登记说明错误；应在写前定位控制 ID 与冲突事实 |
| RDP06 共享父 DAG 重复展开 | C12 为 2,405 次节点出现、24 个固定节点；D09 为 2,406/25 | brief 截断前已构树，validate 多 root 重复读；不是实测 SQL 数，也未证实是 Errno49 唯一原因 |

32 KiB brief 输出限制有效：B00 3,803、D04 12,569 字节；一次 economics find 约 5.29 秒，不是稳定 benchmark。输出小不代表构造便宜，真实父 DAG 重复是此前无关关系载荷测试未覆盖的形态。反馈应定位事实和动作，不靠“提高 ROI”口号。[E8、E9]

**比较角色瓶颈在消费者，不在注册入口**：前 candidate 可作为 control_run_id 登记；`contracts.py:166–173` 的 completed paired 决定、`cli.py:423–426` 的正式 compare 才要求右侧永久 role=control。未来可从新事前 compared_with 边派生相对 candidate/reference，保留旧 role 和旧边，不建角色表或重复运行。当前 C02 仍绑定 B01，不得事后改 C01；父链只能 descriptive。[E4、E6]

## 三项最小共享能力，把验收落在事实和下一选择上

先完成诊断和合法改良路径，再恢复批量新机制。**以下三项无需新增存储字段**；实施若提出新独立事实，仍须用户要求的 sub-Agent 字段 gate，证明消费者与既有关系不能表达的原因，不能以 mandatory prose 模拟质量。

| 优先能力 | 具体消费者与受影响记录 | retain / derive / drop |
|---|---|---|
| 原生经济诊断 | D09 先读 B03/C10/C11/C12；推广到 C03–C12 的下一实验选择 | retain 封存原生报告与固定诊断配方；derive 实际现金流、成交漏斗、风险几何与父差异；drop 新 KPI 持久列、假想成交/PnL、强制高 ROI 说明 |
| 合法增量与不同源码配对统计 | C02/C05/C11 的未来直接改良；RDP03 的两源统计消费者 | retain 原 role、固定比较边、来源与暴露身份；derive 本次相对参考角色及统计结果；drop 角色副本、事后重绑定和仅为改 role 重跑 |
| 统一 preflight、证据状态和预算内 DAG 读取 | B00@1、C09、C12、D09；RDP01/02/05/06 | retain 现有 evidence、compared_with、exposure；derive 一致预检、brief 状态及 snapshot 缓存；drop 状态副本、路径注册表和更多必填正文 |

**原生经济诊断先服务 D09**，仅读真实 sealed reports 与固定 diagnostics，派生计划→父单→fill→closed、现金流→费用/资金费→net、风险几何和 gap，区分开放仓。B03 正优势、C03 毛亏、C04 弱毛被费用压过、C11 薄正优势及不同尺度频次，是验收样本：数量/净 PnL 可复算且容差明确，缺数据不得假 0。新 Agent 应排除错误归因，指出未识别原因，并用已有事实预测一个可证伪改动；不得把低回撤称盈利优势或放大负期望。工具不代选机制。[E2、E3、E6]

**合法增量只用于未来事前边界**。新 pending plan/scope、exposure 与 parents 固定上一候选，新 run 用现有 control_run_id/compared_with 冻结 revision；消费者派生相对角色、各自验证固定源码，保留同 OCI/平台/runtime/config/input/account/cost/window/audit/returns clock 与暴露约束。验收成功处理新 candidate 参考，仍拒绝 C02 事后换绑、hash 错配、latest/self/缺边、任一事实冲突、暴露洗 independent。多规则变化仍只是完整策略比较，旧父链诊断不升级原决定；统计工具复用契约，不能只删 hash 校验。[E4、E5、E6]

**预检/read 共用规则**，register 写前共用比较事实，报具体 code/path、固定控制、expected 和修复入口；纯读取说明未写入，真实写入未知仍 unknown。brief 保留决定、下一动作、封存/档案状态、暴露引用和 full 入口。snapshot 用 (id,revision,commit) 缓存，构树前施预算、DAG 每节点只验证一次，仍查循环/歧义。验收 RDP01/02/05 正反例，实测 RDP06 查询数/耗时/峰值：24 固定节点不能按 2,405 个出现重读，坏祖先不能被 memo 跳过。[E8、E9]

研究流程在现有 plan 冻结 family 总成本与阶段停止条件，不指定通用轮数。少量重要计划独立批判后，预测改动应改变哪个原生读数、哪个结果否证，再跑预算内候选。保留原点与全部失败，派生点改善/联合改善/独立确认三层，不加学习分或 ROI 分；有开发依据才争取未暴露复验，不挑窗口、调风险或洗掉失败。

内容验收让不同干净上下文的 Agent 找回 D04 禁推广、C02 未验证增量、C09 成本冲突，正确选择先诊断或合法新登记；缺证据不得编造，失败不得自动准入。少量高复用结论沿现有审阅接口保管、admit、补 aliases。检查真实动作、库状态与下一选择，不能凭 reviewer ID、格式或轮数宣称稳定。Agent 评估实践要求真实 outcome/轨迹和重复 trials，语义评审需校准；evaluator-optimizer 也需可测提升与停止条件。([Agent 评估](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)、[有效 Agent](https://www.anthropic.com/engineering/building-effective-agents))

合理探索不会每轮收益单调提高；应要求失败排除有价值解释、改变下一选择，并在值得保留的改动上取得可检验改良。本轮证明了失败可诚实保存，尚未证明会变成更优策略。**数据库稳定约束证据和已知矛盾；净优势与高 ROI 选择要靠原生事实、实验设计和真实任务验收，不能由必填字段承诺。**

## 冻结证据与复核入口

私有证据根为 `$HOME/.local/share/trade/research-audits/20261010-v130-second-audit-62b8fbdf`；下表相对路径与 SHA-256 固定字节，便于搬迁核对，不绑定用户路径。每运行 hash/binding 见 E2 proof，策略身份见 E1 manifest。

| 证据 | 文件 | SHA-256 |
|---|---|---|
| E1 快照清单 | `snapshot/manifest.json` | `39870457a10380fee48140177cc47960492bc51caf3b4a07cdb6bcbba557dd2e` |
| E1 全部对象修订 | `snapshot/objects.json` | `100b3550ff89fb693e434534b4b90a1804823d78c11ea96c4bc81052c62cf8f9` |
| E1 固定关系 | `snapshot/relations.json` | `bb352b5c646d26f48c3e00d80a5632f75c37da9a7dfb0fc65ece194e48f63bfe` |
| E1 当前对象 | `snapshot/latest.json` | `b9f1697c76cbb586af198131da3796435b705f16ae05946fc1bc6a25a7cdedbc` |
| E2 原生指标、文件哈希与绑定 | `economics/native_metrics.json` | `f973156a9ebaf22241eae5e4a5db39305ae89a95111e32b96c5640494f0e5efb` |
| E3 现金流与几何核对 | `economics/cashflow_reconciliation_and_geometry.json` | `036072d05a363d87b12f9615ec309b78475d456aee6c38e32d623ceeaec48278` |
| E4 正式 compare | `economics/formal_compare.json` | `1fbc5ac5fdd77a2f5f21d9850c836fe562c6754011a88f9ecaa156b0d8341006` |
| E5 源码 AST 与固定父差异 | `economics/strategy_source_diff.json` | `879d20b91f170c00564ea61a7f5289fd1931b3d40ae4266d58bfdd2c0b121092` |
| E6 合同、决定与暴露清单 | `ledger_evidence/attempt-inventory.json` | `3c005deabd5dac8d7eabe1a115232c8431de6ad48b0c0faffbc23e2ccbd5f9d4` |
| E6 统计和真实工具事实 | `ledger_evidence/verified-ledger-facts.json` | `fa13c6464b7ac2b491c73558c39f67527467031948421e62bbe7812e17d072f0` |
| E7 材料原字节核对 | `ledger_evidence/material-inventory.json` | `580df2432f030bc73aa19c5268c054d4abd92eae27d2ebed633032d5081abf61` |
| E8 只读 CLI 及输出定位 | `ledger_evidence/cli-probes.json` | `55fd76c4e7d84416047e34244bb2560331130aa50d38c29e7af07ea26a3d07b6` |
| E8 真实工具调用 | `ledger_evidence/rd-execution-calls.json` | `829250c6a5297a8ce847a84f7cb27d8f6c7121dad584ac3074de56ee15fbaba4` |
| E8 fork 上下文与结果 | `ledger_evidence/fork-context.json` | `b968268d5539f3ebf6c248c06ad5952ee9b8124d24a3122f3edac989a72adc85` |
| E8 真实报错 | `ledger_evidence/reported-errors.json` | `e2a396c4374f058a864336562a01f0b166e2b7ed7faf0dccb82a041f8fa9fe5c` |
| E9 共享 DAG 出现次数 | `ledger_evidence/lineage-counts.json` | `b1f5c4322f2d2bb8227c56fae6a065a57e4ee765c761936726a71740f4bd5d66` |
| E10 已存配对不确定性 | `snapshot/paired-metrics-learning.json` | `8e9686b49380d0e5ceed1bb33105ebe938d8ac7b384e6a1a3d19c9207122c79e` |
| E11 全部计划和预算审阅 | `snapshot/attempt-analysis.json` | `f3f9490a0ab8ce00a5077ba51ea341b92d88f3c89bbe0e25e7d35ddca29ad3b0` |

本报告未重验全部来源语义、Catalog 原始数据或异机恢复；hash 匹配不等于结论正确，native passed 不等于资格。建议尚未实施或改变拒绝边界；独立身份认证和 SQL 管理员绕过 API 的范围仍按首轮说明。
