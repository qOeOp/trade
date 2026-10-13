# 持续候选研发测试分支实现与验收

日期：2026-10-13。起始 Git `99db440e06e79ecc1bbb48c2ac6591a3c052a6bd`；测试分支 `codex/rd-proposals-test-20261013`，保留、不合并 main。

唯一设计输入：用户指定 toc.zh.md（SHA256 `6a641243e54def5e2bd2a1571ad0d2f3ab87b3887669b227e5991d49ee4f2134`）、proposal.md（`13936f05dbb0e554154ef2f93f49f4e454192bcaec062bd18b3602c88dd8e6b4`）和 P001–P009 已审阅回执。manifest 所列来源、提案、总稿及有哈希的回执共 25 项逐项核对一致；解释材料 F005–F009 不替代设计。P005 替代经济硬排除；P008/P009 替代逐步采纳、采纳事件计数及切版本语义。

## 实现与检查映射

| 提案 | 最终落实 | 检查入口 |
|---|---|---|
| P001 | 用户选路线，Agent 自主推进路线内假设；认可/部署仍归用户 | research-start / research-round；后续技能行为检查 |
| P002 | facts / explanation / next hypothesis 引用连续追加；复用 source/evidence notes | hypotheses.validate 的留存来源检查；knowledge / records 指引 |
| P003 | 没有历史候选或用户主动改方向时选根；亏损/停滞/运行故障不自动重选 | research-start；candidate list 保留完整谱系 |
| P004 | 单处实际规则改动及部件联动、条件限定反馈；invalid 无经济推断 | 版本 parent/difference 与锁定登记一致；RegistrationTests |
| P005 | 条件取代排除范围；旧网格、执行/出场和低优先级动作可重评 | skills 与旧 eval 语义更新；无经济排除字段/执行检查 |
| P006 | 尝试/有效/无效/未完成分别计数；次数只触发复盘；总预算可选 | round status；unfinished/invalid 测试；无 stop flag |
| P007 | 效应、区间、p、检验对象、功效近似和适用性分别报告 | PairedEvidenceTests；comparison.py；不返回 adopted/verdict |
| P008 | 版本不经二元采纳产生；完整有效候选无需显著或目标达标即可继续派生 | valid_losing_candidate_can_derive；独立控制与研发父版本测试 |
| P009 | 所有截至当前可比候选综合推荐；推荐与下一实验排序分别留痕 | candidate list + Agent notes；skills 行为场景 |

新增字段经过独立审阅，见 [存储边界记录](rd-proposals-storage-review.zh.md)。产品新增的责任限于登记身份、原子尝试绑定、可比性与事实读回。不存在 optimizer、research_result 状态机或推荐分数；不采用贝叶斯优化或 Thompson sampling。

## WS8b 与一分钟合同

从 `feat/ws8b-runner-input` 固定提交 `f4277e11d00666a7a4a8e55ccf2dab26720f40f9` 有选择集成 market、runner 接入及既有检查；没有修改对方 worktree。其市场字段审阅及历史验收文档随分支保留，文档里的旧五分钟结果不作为新一分钟验收。

新增 `r1-native-v6`：实际 export timeframe=1m、BacktestNode LAST bar=1-MINUTE、MARK 每分钟、constructor.execution_bar_minutes=1、配置与 summary 分辨率=1、保护允许时长仍为一个执行 bar（现在一分钟）。信号周期由源码定义。保留旧 v4 镜像身份布局供旧证据读回。

市场只读 profile `/Users/vx/.local/share/trade/ledgers-market-pending/market.json`；目标固定 commit `ebg4rg1g7pmtlj8vfk6tu8hdlql4gbkr`。`--market-profile` 与研究库 profile 目录分别选定。新 schema-v2 研究库通过官方 CLI 初始化；活跃研究库和市场库不迁移、不写入。

保持输入保护：市场 commit、pool/universe、规范化导出内容和实现清单身份在登记/实际运行/比较时核对；回放前后完整原始树核验未变。发现原生大 CSV 字段的 131072 默认解析限制会使合法报告无法读取，修复 analysis/audit 解析器，不截断字段、不放宽对账，加入大字段检查。

## 统计证据边界

对同 UTC 日钟的原生日账户 simple returns 取 log1p 差，周循环块共同抽样；中心化单侧尾部 p 检验平均对数差不大于零。基本与嵌套学生化区间针对平均对数差；另列成对 CAGR 差 percentile 区间及原生账户实际年化差，不能把两者混称。给出块长敏感性、五日差集中度、80% 功效的正态近似可分辨对数效应及局限。退化方差无 p/学生化区间，不造数。

算法按事前登记固定，用于开发证据；参数示例不是产品常数。学生化依据参考 [arch 官方方法说明](https://bashtage.github.io/arch/bootstrap/confidence-intervals.html)，本实现不加入分析依赖，不复制旧 /tmp workbench。未定义非收益维度推断，不将收益 p 套用于回撤/胜率。Bonferroni 仅覆盖当次网格，不覆盖持续自适应搜索；不称 p 为策略有效概率，也不称开发改善为独立确认。

## 当前验收

- 完整规定 unittest：160 项通过，Dolt 2.4.2 可用，集成检查未跳过。
- 已完成原子登记顺序、源码/配置不匹配拒绝、网格点消耗、invalid/unfinished 分计、经济目标失败不阻派生、父版本/比较控制分开等检查。
- 新 CI 镜像 `ghcr.io/qoeop/trade-runtime@sha256:8697e10d261481b0a2c9aebbc152d167c6cdfe3cc1b8149a5c570ad99b980c73`，构建 Git `667d4cef11cd21336b0b16cd0d99321c822966c5`；[workflow_dispatch 成功](https://github.com/qOeOp/trade/actions/runs/38371834207)，已拉取并经官方 artifacts 入口真实执行。
- 隔离研究库 `rd_proposals_eng_fixture_20261013`，profile home `/Users/vx/.local/share/trade/rd-proposals-engineering-20261013/profiles`。BTCUSDT 工程窗口输入 2026-09-01..18，交易 09-03..18；每次 24,480 LAST、24,480 MARK、51 funding，source 观察间隔均 60,000,000,000 ns，constructor/config/summary 都为一分钟。
- 两个审计 passed 的原生 run1/run2，分别封存于 `h11qluo5tec3hm2um0fvcimf002e5duj`、`n4q6qo1c8chphbcl9df0pr3s3dl9f6s9`；源码只放隔离 Dolt。只改工程数量 0.002→0.003，用于真实源码/订单数量、账户和比较接口检查，不是研发获利试验。原始账户、费用、资金费、持仓与订单证据保留在 run。
- 两次独立 fresh export 的语义指纹相同；登记与运行身份核对成功，未放宽输入检查。第三版仅发布和登记，父版本 run2 的源码、比较控制 run1 分开；本次没有第三次回放。child 未满足旧最小改善幅度或工程兼容目标也不妨碍登记派生。
- 官方 compare 返回效应、区间、p、学生化与敏感性；不输出采纳状态。真实 repeat 被 `GRID_ALREADY_ATTEMPTED` 拒绝，没有新增 trial。
- ledger audit 两个运行核验通过，零发现；工程 fixture 通过既有 evidence 接口留存、关闭标签和 backup 后读回。原始回执与导出工作副本在 `/tmp/rd-proposals-engineering-20261013`。
- 独立技能 forward check 验证：非显著候选可继续、负毛边际不禁执行出场、推荐与下一实验分开、尝试不强制终止、开发不称样本外；发现 `retry_of` 操作说明缺口，已修正。两个 skill 的 quick_validate 均通过。
- 初始化实测暴露长数据库名生成超过32字符的账户、失败后 secured 状态丢失的既有缺陷；固定长名字散列账户、幂等安全初始化并及时保存配置，长名字集成检查通过。两份失败初始化库原样保留，未删除。
- 修复官方 invalid report 从保留的原生 summary 暴露年化/账户结果的问题：原始 summary 仍保管，正式读数返回 null；invalid 比较仍拒绝。既有对账与验证检查没有放宽。
- 本次不启动十轮策略研究，不 freeze 或 confirm，不改变用户三个目标。

## 保留的产品边界

主机同系统用户的恶意 root 修改仍无法预防；ledger audit 留痕。旧目标 freeze/confirm 的 main 镜像、新鲜 checkout、未来数据时间凭证保护保持原检查；未合并测试镜像不能用于该入口的独立确认。新 schema-v2 不自动迁移旧 schema-v1。历史条款近似、市场缺口、1m bar 内次序和策略自行应用币池的边界照实保留。

交付复核：完整规定测试 160 项通过（Dolt 集成未跳过）；compileall、runner help、skill quick_validate 和 diff 检查通过。镜像内 runner/load/report/audit/uv.lock 与 CI 构建提交逐一哈希一致。
工程库关闭标签 `closed/RD-PROP-ENG-20261013`，关闭提交 `75u1fl8qqmpq875vimhga9ltoou3vdid`；关闭后 audit 零发现。24 份 evidence 文件与源码从固定标签导出逐字节/hash 读回一致；全部表导出 Parquet，`dolt_backup` 同步到隔离库备份目录。两个初始化失败库保留，不作为可用研究 fixture。市场固定提交读回不变。本次没有十轮研究、freeze、confirm、真实交易或 main 合并。
