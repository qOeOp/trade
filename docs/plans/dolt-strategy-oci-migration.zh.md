# 完整策略源码与固定原生环境迁移

本次迁移按用户已确认的边界实施：策略在临时目录开发，Dolt 保存完整单文件源码及其版本、衍生关系；专用 OCI 镜像固定 Python、Nautilus、共享回放和审计代码。产品 Git 维护这些共享能力的构建输入与测试。研究仍由 Agent 选择问题、方法和下一步，Nautilus 仍独占撮合、订单、成交、风控与账户事实。

## 第一个迁移切片

H19a 已在此前收拢为完整单文件。迁移逻辑身份为 `r1.broad-two-tier`，family 为 `r1`，入口类为 `R1Strategy`，运行合同为 `r1-native-v1`。迁移原文是 Git `24a8461586abac914a496fd68c1fb6d1c0e95137` 的 `strategies/r1.py`，精确 SHA-256 为 `8b708592a27732311071b0b00d237001b6e6bb96725bcc3a842cf35ae2184b4a`。这个历史 commit 只说明原文来源；新运行以实际 Dolt 源码绑定及镜像 manifest digest 为执行身份。

`strategy publish/list/show/lineage/export` 复用既有 Dolt 对象、追加 revision、版本守卫和持久操作回执。完整字节保存在策略对象中，不依赖原草稿路径继续存在。同一策略后续 revision 保留 ID；衍生策略使用新 ID，指向父策略的固定 revision，并写清差异。记录的研究 attempt 引用独立于策略父关系，不能由相同文件名、Git 父提交或共用代码推断。

当前原生适配合同只支持 H19a 的 broad-two-tier / tier-target-b、25-bp 总止损风险、5% 单币名义上限和固定 100,000 USDT 共享保证金账户。其 37 个合约仍组成一个策略/账户。H18a、H23a–H27a 等多模块变体保留旧来源身份，尚未逐个收拢为完整 Dolt 策略。当前入口不会导入旧变体或静默回退到 Git 源码。

## 登记与执行

初始实验使用 v2 attempt：`contract` 保存 `scope/plan`，`registration` 只含 `status`，第一次事前发表必须为 `pending/pending`。Dolt 原子发表返回真实初始 ID/revision/commit，执行前绑定该回执。合同和 `strategy_binding` 在同一 attempt 内冻结，改变意图或源码须登记新实验；后续只修订决策、证据和实际对照索引。Git 不再保存新实验凭证文件，也没有元数据后端或旧登记兼容入口。

已有封存报告保留原始字节、路径、哈希和当时身份；不能用本次迁移补造早年的启动登记或事前预测。固定历史原文仍通过 `research/records/history.json` 和历史证据引用读取，资料导入只负责归档保管。

新回放继续走 `research.records.artifacts run`，先从固定 Dolt commit/revision 导出策略，再核对镜像实际 manifest digest、平台、镜像内依赖和共享代码身份，解析实际默认配置并计算配置 digest。镜像内 `BacktestNode` 回放及同镜像审计只挂载只读策略和规范输入、可写报告目录。隔离约束与环境版本固定是两件独立能力，二者均记录实际观察。

## 验收与恢复合同

这份文档记录迁移合同，不代替实际运行与恢复验收回执。先核对 Dolt 导出字节，再检查 BTC/ETH 和全年 37 币配对的订单、成交、持仓、费用、资金费、账户序列、收益序列与逐币诊断，并检查原生订单完整性及审计。普通新运行对比需相同镜像、平台和实际配置；跨旧/新保管合同的实现比较须显式 `--engineering-audit`。已暴露年度上的实现一致性不是策略独立资格。

首次本机迁移的外置根目录为 `/Users/vx/.local/share/trade/strategy-migration/20261009`，其下分别保存数据库备份、源码导出、验证资料、registry 数据与镜像归档。该路径是本机保管位置，不是策略源码或产品运行的固定依赖。正式数据库、镜像和封存结果不放 Git 或 `/tmp`。

完整回放恢复需要四部分：保留真实 commit/revision 的 Dolt 历史与策略字节、可恢复的精确镜像 manifest/platform 字节、共享保存的规范 Catalog 输入，以及封存报告与其绑定。只恢复报告证明报告可读；只保存 digest 证明不了镜像仍可访问。恢复验收应在当前产品 Git 工作树不可用时，导出固定源码并通过固定镜像重新执行。异机或独立故障域恢复另行验收，本机第二目录不能代替灾备。

## 本机验收记录（2026-10-09）

迁移登记为 Dolt `D103-dolt-oci-20261009`，初始 pending 回执是
`794gpmj7qpru25ieosc2o0qbff77uhb0` 的 revision 1。H19a 完整源码发布为
`r1.broad-two-tier@1`，绑定源码 commit
`rpt92n73bf09k0maitsqjhj5k14vh7oh`。实际镜像 manifest 是
`sha256:b751d5a7e2e9c2922bdcbd7b85f25dd3d7737537b3e746114fc79f52664e35a6`，
平台为 `linux/arm64`；镜像内 Python 3.14.8、Nautilus 2.0.0rc3。

`D103-OCI-PILOT-20261009` 与 `D103-OCI-37-20261009` 已通过封存、登记和本机备份。
完整 37 币回放与保留的单文件控制逐列匹配：17,665 个订单、1,722 笔成交、
507 条持仓、13,470 次资金费调整、52,019 条账户记录及 366 个收益点。
最终权益同为 111,664.46988783 USDT，逐币诊断完全相同，原生审计 findings 为空。
源码更换了保管位置，H19a 原先未达经济 Goal 的结论保持不变。

恢复演练从本机第二目录恢复 Dolt 原生备份，按固定 commit 导出精确源码；
删除验收镜像后，从完整镜像归档加载并重新发布到本机 registry，manifest digest 保持不变。
随后在产品工作树之外、无产品 Git 挂载、无网络的容器内重新跑 BTC/ETH，
888 个订单、66 笔成交、439 次资金费调整与已封存 pilot 匹配，同镜像审计通过。
Docker 加载无 tag 的归档后需要恢复 registry 引用并重新核对 digest，不能将 Docker 配置 ID 当作 manifest。
这是本机恢复演练，尚未验证异机灾备。

维护验收回执见 `backtest/r1/receipts/parity-dolt-oci-h19a.json`；原始报告位于
`/Users/vx/.local/share/trade/research-artifacts-acceptance`，镜像、Dolt/报告备份与复建包位于上述外置迁移根。
`research/strategy-history.json` 记录已移出产品目录的历史源码路径和哈希，外置
`legacy-source.bundle` 保存包含原来源 commit 的完整 Git 历史。其余多模块变体尚未发表为完整 Dolt 策略。

## 剩余范围与工作台发现

受影响任务是完整源码迁移和后继 Agent 的冻结版本回放。旧产品目录同时承载策略、变体、回放和证据身份，造成开发临时文件与产品提交混杂；如果只改目录或只存哈希，后继 Agent 仍需寻找源码闭包、宿主 Python 与临时输入。迁移以 H19a 单切片验证共享接口，避免在没有完整规则与配对证据时将其他模块组合登记成当前策略。

剩余工作按每个变体独立进行：核对原来源与规则闭包，收拢一个完整文件，明确父 revision 和差异，发表后做原生配对。复杂或不可独立切换的规则不强行登记成平行策略。镜像、输入与 Dolt 备份的异机恢复，以及策略研究的独立确认，也不由当前本机迁移自动完成。具体运行 ID、观察、成本和下一步决定留在迁移 attempt/run 中；共享能力不增加调度器、策略语言或交易账本。
