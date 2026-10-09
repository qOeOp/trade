# R-1 研究记录索引

本索引只整理现有记录的归属和检索，不新增研发框架、实验状态机或产品模块。原始 H/D/S/F 编号、事前登记、后写结果、失败尝试和证据文件仍在原处。**索引建于 S46 后；索引本身不是任何历史试验的事前登记。** 当前可用的结构化读回是 [`research.records`](../records/README.md)，其中 H25a/H26a/H27a 是**事后转录**；原始登记时间线仍以 [`RD_EXPERIMENTS.md`](RD_EXPERIMENTS.md)、[`SOURCE_CASES.md`](SOURCE_CASES.md) 和 [`results/`](results/) 为准。未迁移的历史 H/D/S 仍可从原台账检索，不能补称为事前结构化登记。现行 Nautilus Strategy 和原生回放入口在 [`strategies/r1/`](../../strategies/r1/)；旧研究脚本只按各自的历史依赖和来源使用。

## 谁保存什么

| 内容 | 权威位置 | 读回边界 |
| --- | --- | --- |
| 来源原片、时间、画面、作者话语与研究者解释 | `SOURCE_CASES.md` 中的 C 案例和 `RD_EXPERIMENTS.md` 中的 S 记录；哈希回执在 `results/` | 来源吻合不等于订单已发或策略有收益。S46 是 H27a 后的纠错。 |
| 策略假设、反证条件、数据窗口、运行预算、实现/原生结果、失败与下一步 | 优先读 [`research.records`](../records/README.md) 中已转录 attempt/run，再读 `RD_EXPERIMENTS.md` 对应 H/D 段及其 `results/` | 结构化历史转录不取代原登记时间线；已看年度的改善仍是开发证据。 |
| 共用研究工作台的产品/流程能力候选 | [`docs/plans/r1-native-rd-findings.zh.md`](../../docs/plans/r1-native-rd-findings.zh.md) 顶部的优先核对 | 必须列受影响 attempt、Agent 受阻任务、证据、迭代成本、绕行和最小共用能力；不按 F 编号开发。 |
| F01–F97 的历史观察正文 | 同一 findings 文件，下表每项有稳定锚点 | 历史混合正文保留供溯源；策略结论以 H/D/S 原记录为准。 |

## 当前研究链

| 主题 | 证据顺序 | 当前判断 |
| --- | --- | --- |
| 先前 A 支撑与保护止损 | C02/C18/C20 → D18/D45 → D90 → D94 → H27a → D95 → S46 | H27a 的 A 外止损是研究者代理，年度净收益失败；S46 事后收窄 C02 来源归因。 |
| 先前 A / 先前 B 准入 | D90 → H25a → D91 → H26a → D92/D93 | H25a/H26a 原生结果均未满足联合 Goal；新增机会的机制问题仍可深挖。 |
| 入场后支撑证据 | D53/D55/D93 → [D96](../records/attempts/D96/attempt.json) | 预设 61.8% 档下首根完成收盘的描述性提前退出容量门槛失败，30 笔后来仍到 B；该精确价位退出子方向停止。 |
| 已见年度与独立验证 | 多轮 H01 至 H27a 的各自状态见原记录；D95/S46/D96 为只读复核 | 同一 2025-10 至 2026-10 年度已多次暴露；目前没有经独立验证的 >20%/近 60% 版本。 |

## F 编号到权威研究记录

“共用能力候选证据”只表示该旧 F 可支持顶部的**聚合能力问题**，不是单独功能需求；“既有输入/原生契约”先查 Nautilus 与当前数据适配；“历史研究/过程结论”回归对应 attempt。右栏列 F 正文显式提到的最多五个 H/D/S，加上少数已核实的补充关系，供搜索定位；它不声称所有提及都是该 F 的因果证据，也不重判原试验的事前性。

| 历史 F | 归属 | 优先结构化 attempt | 对应 H/D/S 检索 ID |
| --- | --- | --- | --- |
| [F01](../../docs/plans/r1-native-rd-findings.zh.md#f01) | 共用能力候选证据 | — | S01, S02, S03, S04 |
| [F02](../../docs/plans/r1-native-rd-findings.zh.md#f02) | 既有输入/原生契约 | — | D01 |
| [F03](../../docs/plans/r1-native-rd-findings.zh.md#f03) | 共用能力候选证据 | — | D04 |
| [F04](../../docs/plans/r1-native-rd-findings.zh.md#f04) | 既有输入/原生契约 | — | D09 |
| [F05](../../docs/plans/r1-native-rd-findings.zh.md#f05) | 共用能力候选证据 | [H19a](../records/attempts/H19a/attempt.json), [H27a](../records/attempts/H27a/attempt.json) | H19a, H27a, D95 |
| [F06](../../docs/plans/r1-native-rd-findings.zh.md#f06) | 共用能力候选证据 | — | D04 |
| [F07](../../docs/plans/r1-native-rd-findings.zh.md#f07) | 共用能力候选证据 | [H27a](../records/attempts/H27a/attempt.json) | S01, D94, H27a, S46, S41 |
| [F08](../../docs/plans/r1-native-rd-findings.zh.md#f08) | 历史研究/过程结论 | — | H02, H03 |
| [F09](../../docs/plans/r1-native-rd-findings.zh.md#f09) | 共用能力候选证据 | [H19a](../records/attempts/H19a/attempt.json), [H27a](../records/attempts/H27a/attempt.json) | H19a, H27a |
| [F10](../../docs/plans/r1-native-rd-findings.zh.md#f10) | 历史研究/过程结论 | — | D04, H03, D05, D06, D10 |
| [F11](../../docs/plans/r1-native-rd-findings.zh.md#f11) | 既有输入/原生契约 | — | H03 |
| [F12](../../docs/plans/r1-native-rd-findings.zh.md#f12) | 共用能力候选证据 | — | H03 |
| [F13](../../docs/plans/r1-native-rd-findings.zh.md#f13) | 共用能力候选证据 | — | S06, S40 |
| [F14](../../docs/plans/r1-native-rd-findings.zh.md#f14) | 共用能力候选证据 | — | H04, D11, D12, D13 |
| [F15](../../docs/plans/r1-native-rd-findings.zh.md#f15) | 共用能力候选证据 | — | D14, H04 |
| [F16](../../docs/plans/r1-native-rd-findings.zh.md#f16) | 共用能力候选证据 | — | H04 |
| [F17](../../docs/plans/r1-native-rd-findings.zh.md#f17) | 共用能力候选证据 | — | H04 |
| [F18](../../docs/plans/r1-native-rd-findings.zh.md#f18) | 共用能力候选证据 | — | S01, S02 |
| [F19](../../docs/plans/r1-native-rd-findings.zh.md#f19) | 共用能力候选证据 | — | S09, S24 |
| [F20](../../docs/plans/r1-native-rd-findings.zh.md#f20) | 历史研究/过程结论 | — | D16, D17, D18 |
| [F21](../../docs/plans/r1-native-rd-findings.zh.md#f21) | 历史研究/过程结论 | — | D18, D19, D20 |
| [F22](../../docs/plans/r1-native-rd-findings.zh.md#f22) | 历史研究/过程结论 | — | S09 |
| [F23](../../docs/plans/r1-native-rd-findings.zh.md#f23) | 共用能力候选证据 | — | H02, D16, D17, D18, D20 |
| [F24](../../docs/plans/r1-native-rd-findings.zh.md#f24) | 既有输入/原生契约 | — | H06, D21 |
| [F25](../../docs/plans/r1-native-rd-findings.zh.md#f25) | 共用能力候选证据 | — | H01, H03, H04, H06, H08b |
| [F26](../../docs/plans/r1-native-rd-findings.zh.md#f26) | 共用能力候选证据 | — | H10, H01 |
| [F27](../../docs/plans/r1-native-rd-findings.zh.md#f27) | 历史研究/过程结论 | [H13](../records/attempts/H13/attempt.json), [H13c](../records/attempts/H13c/attempt.json) | H13, S24, H13c |
| [F28](../../docs/plans/r1-native-rd-findings.zh.md#f28) | 历史研究/过程结论 | [H13](../records/attempts/H13/attempt.json), [H13c](../records/attempts/H13c/attempt.json) | H13, S27, H13c, S24, D36 |
| [F29](../../docs/plans/r1-native-rd-findings.zh.md#f29) | 历史研究/过程结论 | [H13c](../records/attempts/H13c/attempt.json) | H13c, H13d, S24, S27, H13e |
| [F30](../../docs/plans/r1-native-rd-findings.zh.md#f30) | 历史研究/过程结论 | [H13c](../records/attempts/H13c/attempt.json) | H13c, D36, H13d, H13e, S32 |
| [F31](../../docs/plans/r1-native-rd-findings.zh.md#f31) | 共用能力候选证据 | — | S33, S34 |
| [F32](../../docs/plans/r1-native-rd-findings.zh.md#f32) | 历史研究/过程结论 | — | H13f |
| [F33](../../docs/plans/r1-native-rd-findings.zh.md#f33) | 历史研究/过程结论 | [H13c](../records/attempts/H13c/attempt.json) | H13f, H13c |
| [F34](../../docs/plans/r1-native-rd-findings.zh.md#f34) | 历史研究/过程结论 | — | H13f, D37 |
| [F35](../../docs/plans/r1-native-rd-findings.zh.md#f35) | 历史研究/过程结论 | — | D37, H13f, S35 |
| [F36](../../docs/plans/r1-native-rd-findings.zh.md#f36) | 历史研究/过程结论 | — | H13f, D37, D38 |
| [F37](../../docs/plans/r1-native-rd-findings.zh.md#f37) | 历史研究/过程结论 | [H13c](../records/attempts/H13c/attempt.json) | H13c, H13f, S36, D40, D41 |
| [F38](../../docs/plans/r1-native-rd-findings.zh.md#f38) | 历史研究/过程结论 | — | D40, D41, S37, D42 |
| [F39](../../docs/plans/r1-native-rd-findings.zh.md#f39) | 历史研究/过程结论 | — | S38, S39 |
| [F40](../../docs/plans/r1-native-rd-findings.zh.md#f40) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | H14a, H13f, D43, D44, H15a |
| [F41](../../docs/plans/r1-native-rd-findings.zh.md#f41) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | H14a, D45, H15a, S27 |
| [F42](../../docs/plans/r1-native-rd-findings.zh.md#f42) | 共用能力候选证据 | [H15a](../records/attempts/H15a/attempt.json) | H15a |
| [F43](../../docs/plans/r1-native-rd-findings.zh.md#f43) | 共用能力候选证据 | [H15a](../records/attempts/H15a/attempt.json) | H15a |
| [F44](../../docs/plans/r1-native-rd-findings.zh.md#f44) | 共用能力候选证据 | [H15a](../records/attempts/H15a/attempt.json) | H15a, H14a |
| [F45](../../docs/plans/r1-native-rd-findings.zh.md#f45) | 共用能力候选证据 | [H15a](../records/attempts/H15a/attempt.json) | H15a |
| [F46](../../docs/plans/r1-native-rd-findings.zh.md#f46) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | H15a, D47 |
| [F47](../../docs/plans/r1-native-rd-findings.zh.md#f47) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | H16a, H15a, D49, D48 |
| [F48](../../docs/plans/r1-native-rd-findings.zh.md#f48) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | H15a, H14a, H16a, D51, D52 |
| [F49](../../docs/plans/r1-native-rd-findings.zh.md#f49) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | D53, H15a, D54, S27, S35 |
| [F50](../../docs/plans/r1-native-rd-findings.zh.md#f50) | 历史研究/过程结论 | [H18a](../records/attempts/H18a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | D55, D56, H18a, H15a, D57 |
| [F51](../../docs/plans/r1-native-rd-findings.zh.md#f51) | 历史研究/过程结论 | — | S42, D53 |
| [F52](../../docs/plans/r1-native-rd-findings.zh.md#f52) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | S43, H15a, D55 |
| [F53](../../docs/plans/r1-native-rd-findings.zh.md#f53) | 历史研究/过程结论 | — | S43, D58, D55 |
| [F54](../../docs/plans/r1-native-rd-findings.zh.md#f54) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | S44, H15a |
| [F55](../../docs/plans/r1-native-rd-findings.zh.md#f55) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | S44, D59, H15a, S27 |
| [F56](../../docs/plans/r1-native-rd-findings.zh.md#f56) | 历史研究/过程结论 | [H15a](../records/attempts/H15a/attempt.json) | D59, H15a, S44, D60, S27 |
| [F57](../../docs/plans/r1-native-rd-findings.zh.md#f57) | 共用能力候选证据 | [H15a](../records/attempts/H15a/attempt.json) | H14a, H15a, H16a, D53, D55 |
| [F58](../../docs/plans/r1-native-rd-findings.zh.md#f58) | 共用能力候选证据 | [H19a](../records/attempts/H19a/attempt.json), [H18a](../records/attempts/H18a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | H19a, H18a, H15a |
| [F59](../../docs/plans/r1-native-rd-findings.zh.md#f59) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a, D62 |
| [F60](../../docs/plans/r1-native-rd-findings.zh.md#f60) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a |
| [F61](../../docs/plans/r1-native-rd-findings.zh.md#f61) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a, D63 |
| [F62](../../docs/plans/r1-native-rd-findings.zh.md#f62) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H18a](../records/attempts/H18a/attempt.json) | H19a, H18a, D64 |
| [F63](../../docs/plans/r1-native-rd-findings.zh.md#f63) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H18a](../records/attempts/H18a/attempt.json) | D65, H19a, H18a |
| [F64](../../docs/plans/r1-native-rd-findings.zh.md#f64) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H18a](../records/attempts/H18a/attempt.json) | D66, H19a, H18a |
| [F65](../../docs/plans/r1-native-rd-findings.zh.md#f65) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | H19a, D67, H15a |
| [F66](../../docs/plans/r1-native-rd-findings.zh.md#f66) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H20a, H19a, D60, H12 |
| [F67](../../docs/plans/r1-native-rd-findings.zh.md#f67) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H18a](../records/attempts/H18a/attempt.json) | D68, H19a, H18a, D66 |
| [F68](../../docs/plans/r1-native-rd-findings.zh.md#f68) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D69, H19a |
| [F69](../../docs/plans/r1-native-rd-findings.zh.md#f69) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H21a, H19a |
| [F70](../../docs/plans/r1-native-rd-findings.zh.md#f70) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D70, H19a, D68 |
| [F71](../../docs/plans/r1-native-rd-findings.zh.md#f71) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | H21a, H22a, H19a, H15a |
| [F72](../../docs/plans/r1-native-rd-findings.zh.md#f72) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | D71, H19a, H15a, H22a |
| [F73](../../docs/plans/r1-native-rd-findings.zh.md#f73) | 既有输入/原生契约 | [H19a](../records/attempts/H19a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | D72, H19a, H15a |
| [F74](../../docs/plans/r1-native-rd-findings.zh.md#f74) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | D72, D71, D73, H19a, H15a |
| [F75](../../docs/plans/r1-native-rd-findings.zh.md#f75) | 既有输入/原生契约 | — | D74 |
| [F76](../../docs/plans/r1-native-rd-findings.zh.md#f76) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json), [H15a](../records/attempts/H15a/attempt.json) | D71, D75, H19a, H15a, H22a |
| [F77](../../docs/plans/r1-native-rd-findings.zh.md#f77) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a, D76, D71 |
| [F78](../../docs/plans/r1-native-rd-findings.zh.md#f78) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a, D77, D71, D75, D76 |
| [F79](../../docs/plans/r1-native-rd-findings.zh.md#f79) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D78, H19a |
| [F80](../../docs/plans/r1-native-rd-findings.zh.md#f80) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D79, H19a, D80, S45 |
| [F81](../../docs/plans/r1-native-rd-findings.zh.md#f81) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a, D80, S45 |
| [F82](../../docs/plans/r1-native-rd-findings.zh.md#f82) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H19a, D80, D81 |
| [F83](../../docs/plans/r1-native-rd-findings.zh.md#f83) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D82, H19a, D78, D83 |
| [F84](../../docs/plans/r1-native-rd-findings.zh.md#f84) | 历史研究/过程结论 | — | D83, D84 |
| [F85](../../docs/plans/r1-native-rd-findings.zh.md#f85) | 历史研究/过程结论 | — | D84, D82, D83, D78, H23a |
| [F86](../../docs/plans/r1-native-rd-findings.zh.md#f86) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H23a, H19a, D85 |
| [F87](../../docs/plans/r1-native-rd-findings.zh.md#f87) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D85, H19a, H23a, D86 |
| [F88](../../docs/plans/r1-native-rd-findings.zh.md#f88) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D86, H19a, H24a |
| [F89](../../docs/plans/r1-native-rd-findings.zh.md#f89) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | H24a, H19a, D86, D87 |
| [F90](../../docs/plans/r1-native-rd-findings.zh.md#f90) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D87, H24a, H19a, D88 |
| [F91](../../docs/plans/r1-native-rd-findings.zh.md#f91) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D88, H19a, D80, D89 |
| [F92](../../docs/plans/r1-native-rd-findings.zh.md#f92) | 历史研究/过程结论 | [H19a](../records/attempts/H19a/attempt.json) | D90, H19a, D81, D88, D89 |
| [F93](../../docs/plans/r1-native-rd-findings.zh.md#f93) | 历史研究/过程结论 | [H25a](../records/attempts/H25a/attempt.json), [H19a](../records/attempts/H19a/attempt.json) | H25a, H19a, D91 |
| [F94](../../docs/plans/r1-native-rd-findings.zh.md#f94) | 历史研究/过程结论 | [H26a](../records/attempts/H26a/attempt.json), [H25a](../records/attempts/H25a/attempt.json), [H19a](../records/attempts/H19a/attempt.json) | H26a, H25a, H19a |
| [F95](../../docs/plans/r1-native-rd-findings.zh.md#f95) | 历史研究/过程结论 | [H26a](../records/attempts/H26a/attempt.json) | H26a, D92 |
| [F96](../../docs/plans/r1-native-rd-findings.zh.md#f96) | 历史研究/过程结论 | [H26a](../records/attempts/H26a/attempt.json), [H25a](../records/attempts/H25a/attempt.json) | D93, H26a, H25a, D92 |
| [F97](../../docs/plans/r1-native-rd-findings.zh.md#f97) | 历史研究/过程结论 | [H27a](../records/attempts/H27a/attempt.json), [H25a](../records/attempts/H25a/attempt.json) | D94, H27a, D95, S46, H25a |
