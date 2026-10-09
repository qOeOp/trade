# Trade 研究文档

这里记录当前可运行的 Nautilus 原生研究架构、R1 回放证据与研发过程中确认的产品发现。

- [当前架构](architecture.zh.md)：策略、原生回测、数据与账户的职责。
- [R1 迁移与配对回放](plans/nautilus-upstream-poc.zh.md)：同一年度 37 币回放的订单和经济结果。
- [研发发现](plans/r1-native-rd-findings.zh.md)：后续产品设计需要保留的发现和边界。
- [投研记录设计与效能试点](plans/research-record-contract.zh.md)：外部依据、Git 记录与本机封存形态，以及已做试点和后续效能验收边界。
- [投研产物单机验收](plans/research-artifact-custody-acceptance.zh.md)：冻结运行、输入校验、封存、第二目录恢复与原生配对的真实结果。
- [投研记录检索效率](plans/research-record-efficiency.zh.md)：命令层基准与八题隔离 Agent 对照；运行身份更准，速度和研究决策未见收益。
- [F01 四格原生回放](plans/r1-factorial-line-cancel-result.zh.md)：两项可开关研究方向的 00/10/01/11 配对、账户结果与记录读回。

可运行入口与本地数据要求见 [仓库 README](https://github.com/qOeOp/trade/blob/main/README.md)。研究回测不连接交易账户，也不会下实盘订单。
