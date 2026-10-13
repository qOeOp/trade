# P010–P013 实现与工程验收

2026-10-13；测试分支 `codex/rd-proposals-test-20261013`。批准的冻结设计：P010-r2、P011-r1、P012-r1、P013-r1 及各自独立架构回执；原件/hash 已核对并保存于隔离工程账本。起始提交 `fbb19684911da7c3ea7ee6420cbc8ebc669125a7`；运行代码构建提交 `08e565efe45951b8954e1cdb46fd21733157410a`；宿主代码补全提交 `e74e4b4c8b4d60b288f8a9528fe353d1bb007b71`。原 P001–P009 验收仍保留，不能把 v6 当成本次 runner。

| 提案 | 结果与证据 |
|---|---|
| P010 | report/candidate/compare/status/tables 共用当前经济证据检查，保留历史 audit/status。真实 fills 及匹配原生记录才输出经济读数；零成交仅诊断，不输出净改善/p/CI或成为更优候选。零费用/零资金费、小样本、低频、亏损、非显著都不构成经济排除。故障/零活动父源码可修复派生，比较控制可暂缺。 |
| P011 | 发布精确源码后，正式登记需要 v7 实际 CI 镜像原生预检及单独归属 Agent 的 API/因果/活动/就绪审查。工程用途在 trial 启动前固定，仅同源码同镜像预检可豁免暴露；任意 exploration 不可事后改名。源码承担完成信息的 decision→later order/fill 时钟，G 不重建信号。 |
| P012 | trial 与开始回执同事务；原 runner/auditor stdout/stderr、命令/退出、源码/hash及显式异常追加封存。构造器及 Python 源码回调异常可靠非零退出，普通 WARN 不按文本判错。captured-empty/missing/not-started 分开；中断在 finally 捕获，SIGKILL 无法保证最终捕获，不能拿后来的探针补旧 stderr。保留原目录/开始回执，恢复材料只能另标注追加。 |
| P013 | 固定 market commit 的成员月份、完整输入区间、原始 1m LAST/MARK 缺口/对齐/零量、funding 时刻进入 export receipt，并随新执行捕获 `input-coverage.json` 到既有 evidence。首末数据仅代理，不冒充上市/退市事实；实际指标就绪由源码诊断与 Agent 审查。没有静默缩窗、删币、填数据或新调度器。 |

无 SQL 新列/新表；独立存储审阅见 [字段决定](p010-p013-storage-review.zh.md)。保护、账户审计与三个目标未因结果改变。确认/main 镜像保护保持原样；本分支未合并 main。

## 已完成检查

- 规定完整 unittest：166 项通过，Dolt 2.4.2 集成未跳过；compileall、两个 skill quick_validate、PR title 格式、diff 检查通过。
- [CI 构建成功](https://github.com/qOeOp/trade/actions/runs/38406723339)：`ghcr.io/qoeop/trade-runtime@sha256:a687a619ea557cb753b86f8c8f57d3db13d2f68ccbe6df5204a7b2d9b95d2503`，linux/arm64，`r1-native-v7`，Nautilus 2.0.0rc3。镜像内 load/run/report/audit/uv.lock 与构建 Git 逐一哈希相符；宿主补全不改 backtest、锁文件或镜像依赖。
- 新镜像真实 1m BTC 工程输入为 2026-09-01 至 09-04、交易 09-03 至 09-04：构造器异常失败；`expire_time=datetime` 的真实原生 on_bar TypeError 即使 actor 捕获，runner 仍失败；整数纳秒修复 API 用例通过。普通 WARN 的真实成交亏损用例经济可用；零活动仅诊断。没有研究改善、达标或独立确认主张。
- 同一 RSI 源码、固定市场、BTC/ETH、一交易日 v6/v7 配对：原生订单、成交、持仓、账户、费用、资金费、returns、exposures、时钟和诊断比较通过。该窗口 funding adjustment 为零；不是非零资金费结算、所有策略或 full-pool 的普遍 parity 证明。
- 单元/隔离 Dolt 检查还覆盖：真实零费用/零资金费成交可用、缺记录不可用、暴露不可回填、失败预检拒绝、保留命名防占用、中断原始部分日志与退出未知；经济亏损或非显著仍可派生。

## 旧反例只读检查

固定旧 tag `closed/RD10-V6-BTCETH-20261013` / `lqke0tpncrr5ucrsf60io5pofk0qehpl`：12 个历史 passed 保持不变。当前视图识别 root/run1 和 H01/run2 的已保留同钟因果失败，H06/run8 与 H10/run12 的零成交不再提供经济读数或比较；当前 8 个经济可用含修复根与 7 项假设。H03/run5 的原 p=0.3344 保持，区间仍跨零。所有旧原始 stderr 缺失仍标 missing；H10 后验 API 探针不能证明旧进程曾吞异常。

## 可恢复隔离工程 fixture

- profile home：`/Users/vx/.local/share/trade/p010-013-engineering-20261013/profiles`；ledger `p010-013-engineering`；DB `p010_013_eng_20261013`。
- 固定 tag `closed/P010-P013-ENG-20261013`，commit `75ifhotnvsjmrtpbqu6de7rrl8va4cj7`；备份位于该工程目录的 `dolt_backup/p010_013_eng_20261013`。
- 5 个预检、2 个登记工程根回放、2 个配对探索、1 个覆盖封存工程检查；10 个原始 execution capture 全部按 trial/source/image/hash 读回。两项登记仅 1 项经济可用、1 项诊断。不是新十轮研发。
- `ledger audit` 无发现；备份已同步并恢复至 `/tmp/rd-p010-013-eng-20261013/backup_restored` 读回 99 个证据文件、5 个完整源码，哈希全符；Dolt 2.4.2 CLI 对 BLOB 调用 SHA2 曾 panic，改用只读 HEX 导出并在宿主 SHA256 核验，未改产品检查。证据与完整源码永久在 Dolt，工作材料在 `/tmp/rd-p010-013-eng-20261013`。

## 尚未完成 full-pool 验收

对同一 market commit `ebg4rg1g7pmtlj8vfk6tu8hdlql4gbkr`，只读诊断原输入 2025-10-07 至 2026-10-07 08:30 UTC：AIA 缺 675 个 LAST 分钟（MARK 完整）；LIT 缺 1050 个 LAST、978 个 MARK，72 个时刻不齐；BAKE/HIFI 各有完整 526110 分钟但 LAST 全部零成交量、funding 记录为零。零量/无 funding 不自动证明经济无效；仍需以权威上市退市事实、成员有效期、策略暖机/实际就绪及可能继续持仓区间解释覆盖。只检查这些已知阻塞合约，并未验收全池。BTC/ETH 工程通过不能代替 full-pool；下一测试不得静默删币、缩窗、伪造数据或放宽审计。
