# 2026-10-29 bars 输入导出修复与隔离验收

对应 doctor finding `20261029-07`，诊断见 [未消费报价导出](doctor/2026-10-29-bars-unused-quote-export.zh.md)。用户已授权本修复、终止此次未完成的注册导出、隔离验证与 PR；未授权合并。

## 改动

沿已有 `--execution` 将输入范围传到原导出器。bars 不读、不转换逐笔报价；quotes 继续原转换与完整性校验。LAST、MARK、资金费、每日预热、合约规格、成员和生命周期输入不变，缓存键区分报价范围。

完整导出文件仍进入原内容指纹，可比性、重试、运行绑定、复现及原生审计检查不变。新记录不增加字段。历史复现从原 execution capture 的 export receipts 内已有 quote 数量派生其原始导出是否含报价，再严格核对原输入及报告指纹；不迁移历史记录。旧的未执行登记如要求含报价的旧输入，当前新导出与它不同，原检查仍拒绝，不自动换绑。

## 隔离原生配对

参考宿主检出：`12f87f9cdd2bce7c0719f5a9e53f7b9e8c80f10a`；候选宿主：本 PR。engine、Nautilus 和依赖未改，双方使用同一已发布 CI 镜像 `ghcr.io/qoeop/trade-runtime@sha256:b0b2337df0c5836e058e4c3c9429966abe3328511843070948d29da16171f4e4`。本项改变宿主适配器，不需要新的运行器镜像；不是跨镜像升级验证。

夹具通过 `tests.market.dolt.TemporaryMarket` 创建独立 Dolt 2.4.2 服务、独立 market 与 research 数据库，采用 `tests/engine/test_stream.py` 的 Probe、确定性分钟数据和带成交的成员日前一日数据，MARK 成交量为零，并加入有效报价及 8 小时资金费。交易窗口 `[2026-01-01,2026-01-03)`。所有原生执行均走 CLI `replay explore --ledger <isolated> --market <isolated> --execution bars`；没有写活动账本或活动市场。

先分别验证 BTC、ETH，再共同运行完整两合约夹具。用 `engine.compare_reports` 比较每张原生表及资金费调整，用 `engine.compare.report_fingerprint` 核对全部七类报告的语义指纹。原始策略和运行回执未放入 Git；可再生成的工作文件位于 `/tmp/research-a-bars-native-parity-v4/`，夹具脚本在 `/tmp/research-a-bars-native-parity.py`。

| 范围 | 参考／候选导出 quote 行 | 每侧订单／成交／持仓报告行 | 原生审计 | 原生比较及七类语义指纹 |
|---|---:|---:|---|---|
| BTC | 5,760／0 | 151／151／76 | 双方通过 | 一致 |
| ETH | 5,760／0 | 151／151／76 | 双方通过 | 一致 |
| BTC + ETH | 11,520／0 | 302／302／152 | 双方通过 | 一致 |

订单及事件历史中的提交和成交时钟、数量、价格、减仓和保护状态均随原指纹比较；账户、手续费、资金费、收益及敞口表一致。全合约配对包含每侧 4 次资金费调整，逐项相同。夹具来源的输入时钟行为保持不等于某研究策略的独立因果复核，本次没有变更 A 的已发布源码。

这证明上述隔离场景的适配行为保持，不证明真实多年窗口的账户存续或清算、其他未覆盖策略分支或跨主机行为。短场景包含启动和缓存差异，不作速度 benchmark；多年转换节省仍未量化。A 的正式报告尚未产生，研究须在修复合入 main 后继续。

## 检查

- 定向 52 项测试通过，Dolt 2.4.2 集成项无跳过；补充连续性 11 项通过，原重试/输入改变拒绝断言未改。
- 最终全量 `RESEARCH_DOLT_BINARY=/tmp/trade-dolt-2.4.2.ItujDp/dolt-darwin-arm64/bin/dolt uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：638 项通过，无跳过。首次全量发现一个测试替身缺少内部关键字参数转发，修复仅转发参数，不改变断言。
- `uv run --frozen ruff check .`、`uv run --frozen mypy` 通过。
- docs-site `check:i18n`、`build`、`check:routes` 通过。
- `git diff --check` 通过。
