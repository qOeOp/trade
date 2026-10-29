# 2026-10-29 bars 登记无条件导出未消费报价

| Item | Value |
|---|---|
| Sessions | Codex chat `01a1856b-3b36-7503-a066-1922397920cc`，2026-10-29；未读取会话转录文件 |
| Audit session | 本研究会话内聚焦诊断，GPT-6，不是完整审计 |
| Checkout / ledger | `12f87f9cdd2bce7c0719f5a9e53f7b9e8c80f10a`；选线 `ovrkohc8kb6p24ie4hl06ha04mmq9e7e`，终止后 `a9lnkim1skrun490sp5kejusk01p9cme` |
| Coverage | registration 输入准备、market 导出、engine 实际消费及 replay 历史复现；不扩展至其他会话或研究选择 |
| Time split | 观察到命令已运行 5 分 58 秒、工作进程约一个 CPU 核；诊断/研究/等待时间无法准确拆分，未量完整耗时或节省 |
| Invalid trials caused by the product | 本次 0；登记尚未写入，没有打开正式研究 trial |
| Findings by action | fix 1，authority 1（本次宿主进程终止，用户已批准）；其他 0 |
| Recurred items | 索引未找到同根因；历史 quote 表、网格和覆盖问题不属于本项 |
| Found by the user first | 0 |
| Net change | 存储字段、拒绝、审计机制、skill 文字均不增加；既有执行方式传至导出器，增加一个内部投影条件；历史复现从原凭证派生报价需求，缓存键区分范围；不另建缓存、旁路或策略开关 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261029-07 | bars 登记与回放无条件转换未消费的逐笔报价，A 线多年窗口停在输入准备 | 当前 `registration-ema-entrynotional-multiyear-root-20261029` 选择 BTCUSDT、`[2020-09-01,2026-10-01)`、market `1kcbv73ptu3l3clg37g0f0k77c370kk8`、bars。`registration/inputs.py:206-207` 没有传执行方式；`market/export.py:374-379` 无条件转换报价；`engine/run.py:683-699,909-910` 在 bars 不消费 quote 事件、不计入迭代数 | fix：投影实际消费类型，保持原检查 | 观察到约 886 MB 中间缓存；后续快照 695 个 quote 文件，时间范围推进到 2022-07-22。不是最终成本或节省估计 | open，用户已授权 |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 无条件准备报价 | quotes 撮合输入与可重建内容身份 | 既有执行方式、原转换校验和全内容指纹 | bars 明确不读取报价，登记与回放仍重复转换 | 只准备该环境消费的事件，quotes 路径保留 |
| 历史全量导出身份 | 旧记录不能被重写或放宽核对 | 原 capture 的 export receipts 已有 quote 数量，原指纹比较保留 | 一律省略历史报价会使复现指纹不同 | 从原凭证派生历史复现范围，不加字段 |

## Decisions

2026-10-29，用户明确选择“授权修复并终止本次导出”：终止本会话启动的注册/导出，按执行环境准备输入，保留现有指纹、可比性及审计检查，完成隔离验证并创建 PR，不合并，之后继续 A 线。只向经过命令身份核验的注册 Python 进程及其工作子进程发送 SIGTERM。旧研究线、新线、预检 trial 215、独立复核和历史市场数据保留；终止后只读查询确认该登记 bundle 不存在。

继续等待当前路径仍可运行，但不能消除以后登记/回放的重复转换。缩短窗口或换输入改变已授权研究，不是修复。修复按已经存在的执行方式删去无用转换；不改判断哪些已消费数据必须一致的规则。旧封存结果须按其既有凭证和指纹复现；旧锁定登记若实际导出内容不同，仍由现有身份检查拒绝，不迁移或重写登记。

适配器行为保持必须经隔离 Dolt 的配对原生验证，核对事件与因果时钟、订单和保护、费用、资金费和账户结果；检查完成前不声称 parity。后续状态写索引，不改本诊断记录。
