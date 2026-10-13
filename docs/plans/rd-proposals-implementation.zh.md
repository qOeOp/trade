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

- 完整规定 unittest：159 项通过，Dolt 2.4.2 可用，集成检查未跳过。
- 已完成原子登记顺序、源码/配置不匹配拒绝、网格点消耗、invalid/unfinished 分计、经济目标失败不阻派生、父版本/比较控制分开等检查。
- 原生一分钟与可恢复 CLI 工程 fixture 在新的 CI 摘要生成后验证；本记录后续追加实测结果。
- 本次不启动十轮策略研究，不 freeze 或 confirm，不改变用户三个目标。

## 保留的产品边界

主机同系统用户的恶意 root 修改仍无法预防；ledger audit 留痕。旧目标 freeze/confirm 的 main 镜像、新鲜 checkout、未来数据时间凭证保护保持原检查；未合并测试镜像不能用于该入口的独立确认。新 schema-v2 不自动迁移旧 schema-v1。历史条款近似、市场缺口、1m bar 内次序和策略自行应用币池的边界照实保留。
