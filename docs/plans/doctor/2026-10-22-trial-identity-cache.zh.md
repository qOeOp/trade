# 2026-10-22 执行身份与预检缓存复核

| Item | Value |
|---|---|
| Sessions | 当前 chat 01a15f8b-e253-72d0-a67b-76d3e2e8377e；2026-10-22 用户提出并批准方案；本地会话 rollout-2026-10-22T02-39-25-01a15f8b-e253-72d0-a67b-76d3e2e8377e.jsonl 及当日接续文件 |
| Checkout / ledger | base f7e7c1df；实现 539815505；复核修正 caa9eb0f1；隔离 v2/v3 库，无 active ledger 写入或切换 |
| Coverage | v3_behavior_review、v3_data_review、v3_contract_review，均 fresh、fork_turns:none、只读；实际 CLI、Dolt、OCI、双语静态页与 ER 浏览器消费者；未验发布站点或跨代研究接续 |
| Time split | 全量测试 216.713 秒，最终专项 14.315 秒；其他阶段时间未知，不估算节省 |
| Invalid trials caused by the product | 本次未证实新增；隔离工程探针两次预热不足，原件保留，不记作经济失败 |
| Findings by action | remove 2；独立复核修复文档合同与无关身份查询放大 |
| Recurred items | 原 20261021-07 的技术投影与经济内容暴露问题仍独立未结，本次不声称解决 |
| Found by the user first | 2：独立 run_id 的必要性、成功预检全量报告永久存储的必要性 |
| Skill size | research-round 增加缓存核验/再生的必要命令；未增加审查项或历史场景；nautilus-report-analysis 仅同步编号 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261022-04 | 现有 trial→run 严格一对零或一，生命周期分离不需要第二套自增编号 | 用户本次质疑；原 schema.sql 的 run.trial_id UNIQUE；新共享主键及子表 FK；真实 report/compare/export 消费者统一；乱序与同时间戳结果按既有提交 seq 选择 | remove | 翻译编号的认知/维护成本未量化；不声称有显著空间节省 | 用户批准，已实现待 PR |
| 20261022-05 | 必要预检事实有后续消费者，但不能据此要求所有成功预检报告永久存储 | 原 execution._capture_files 全量保存 reports；新成功预检七表只存指纹/清单；CLI 原缓存与再生缓存核验；四项审查及登记专项、原生 OCI 配对 | remove | 报告有效载荷减少，物理 Dolt/备份收益未测 | 用户批准及暴露调整授权，已实现待 PR |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 独立 run_id | 结果身份、结果入库顺序 | trial_id PK/FK、结果行存在性、已有 Dolt 插入提交及 ledger_head.seq | 一次 trial 没有多个结果需求；结果顺序专项通过 | 删除独立编号，保留独立结果实体 |
| 成功预检七表完整字节 | 后续独立技术审查与故障追溯 | 原最小事实、指纹及核验后的原缓存/再生缓存 | 原/再生读口 reports_verified=true，始终非经济证据 | 仅完整成功可再生表改缓存；失败/缺指纹保留原件 |
| 无关 trial 的逐对数据库核验 | 再生身份核验 | 已批量读取身份先内存筛选，再调用唯一核验函数 | 独立数据镜头发现无关身份仍产生两次 SQL；最终修正后专项通过 | 先筛选，保留完整核验；不新增缓存表 |

## Decisions

2026-10-22 用户逐项批准[具体方案](../2026-10-22-trial-identity-precheck-cache.zh.md)，
明确授权相应暴露检查调整；隔离测试与 PR，不自动合并，现有账本不动。
没有新增存储事实、表或列；旧库和历史原件不改，v3 active 切换另审。

最终本地证据：454 tests 全量通过，13 tests 最终专项通过，Ruff/Mypy/compileall 通过；
文档 build、34 组双语、72 条静态路由通过。默认 Mermaid 检查只识别 fenced 图，本次命中 0 图，
另在 /tmp 复用同一浏览器消费者脚本读取 MDX chart，实际核验 design-ledger 两种语言的 4 张图及导航通过。
固定 OCI、同源码同市场输入的 BTC/ETH v2-v3 和原件-再生配对通过，审计、手续费、资金费和账户经济对齐；
这只证明所配对的工程行为，不证明策略改进或经济接受。临时报告只在 /tmp，不入 Git。
