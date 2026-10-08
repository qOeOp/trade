# Trade 研究文档

这里记录当前可运行的 Nautilus 原生研究架构、R1 回放证据与研发过程中确认的产品发现。

- [当前架构](architecture.zh.md)：策略、原生回测、数据与账户的职责。
- [R1 迁移与配对回放](plans/nautilus-upstream-poc.zh.md)：同一年度 37 币回放的订单和经济结果。
- [研发发现](plans/r1-native-rd-findings.zh.md)：后续产品设计需要保留的发现和边界。
- [投研记录设计与效能试点](plans/research-record-contract.zh.md)：外部依据、拟议记录格式、已实现的只读样例与尚待执行的量化验收。
- [F01 四格原生回放](plans/r1-factorial-line-cancel-result.zh.md)：两项可开关研究方向的 00/10/01/11 配对、账户结果与记录读回。

可运行入口与本地数据要求见 [仓库 README](https://github.com/qOeOp/trade/blob/main/README.md)。研究回测不连接交易账户，也不会下实盘订单。
