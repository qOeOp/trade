# 下架结算价：证据标准与数据缺口分开

2026-10-25。用户逐项确认：下架结算价须有可核对的交易所原始证据；仅有算法时须有完整算法及输入；缺证据时沿用终止前清仓撤单，不以最后行情代填价格。本轮收敛文档，不改产品拒绝、审计判定、存储字段或原生依赖。

## 已定边界

- 接受能对应具体合约与结算时刻的交易所官方最终结算价，保留发布内容原件。
- 仅有官方算法时，保留适用版本、时间窗与全部输入，独立复核结果；不能仅凭下架公告或终止时刻声明取得了结算价。
- 缺证据时只供给终止时钟，策略在此前以原生订单清仓撤单；现有独立审计核验结果。末根 K 线收盘、最后报价、MARK、插值均不能代填结算价。
- 来源权威性和算法适用性由 Agent 核对并留存审查依据；代码只核验证据包关联、市场提交、原生事件和精度，不自动认证来源，不新增结算器。
- 具体合约缺证据属于数据缺口；从两份总待定清单移至数据缺口，不宣称已取得全部真实结算价。正文与悬浮定义保留 `W.3.2.2` 身份。

## 现有实现依据

- `market/lifecycle.py::validate_lifecycle` 核对市场提交、来源文件引用、片段与原生事件；`require_native_price` 拒绝不能精确落在合约价格网格的结算价，不舍入。
- `market/lifecycle.py::write_lifecycle_events` 供给原生 `InstrumentStatus` 与 `InstrumentClose`，后者由 Nautilus 结算。
- `engine/audit.py::lifecycle_findings` 要求无价终止前空仓、订单结束，并核对迟到事件；有价结算沿原生结算路径核对。
- 文档在回放环境正文表达来源证据标准，在审计章节引用该标准，不把来源判读写成新自动校验。

## 验证

- `PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -B -m unittest tests.engine.test_native_audit.LifecycleAuditTests tests.engine.test_entry_membership.EntryMembershipTests.test_native_settlement_is_reduce_only_and_close_is_not_preclose -q`：9 项通过，无跳过。覆盖有价原生结算、无价终止前清仓撤单、迟到事件与回执不一致；包含原生 EXPIRATION 只减仓结算路径。
- `npm run check:i18n --prefix docs-site`：47 组双语章节通过。英文入口仍按现有状态标记为待翻译的中文镜像，本轮三组镜像内容逐项一致。
- `npm run build --prefix docs-site`：Next.js 16.4.2 静态构建通过，日志 `/tmp/trade-settlement-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望路由与导出路由通过，94 个本地化页面有导航父级。
- 直接解析中英文入口的六份导出 HTML：正文新措辞、数据缺口分组、`W-3-2-2` 与 `G-3-3-3` 锚点通过；总清单不再含旧待定条目。悬浮定义同步，章节图谱原有双向引用保持一致。
- `git diff --check`：通过。

仅修改文档与定义索引，没有新增或修改测试、执行代码、审计阈值或持久化字段；没有写活动账本、市场库或 canonical Catalog，没有运行策略研究或构建运行镜像。未运行产品全量单测，不宣称取得了新的真实结算价来源。

## 后续只读证据盘点

[研究窗口盘点](delisting-evidence-inventory.zh.md)核对到 50 个 USDT 合约终止事件，盘点所用市场快照币池涉及 2 个；完整结算价／算法输入证据与所核查账本快照的正式生命周期包均为 0。官方公告时钟已取得，不等于结算价齐全或已接入回放。当前 30 合约导入范围／24 个窗口成员与历史全池 208 合约的关系继续保留为范围缺口；未据此改规则或认定验收通过。
