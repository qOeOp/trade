# 安装

安装只建立可复现的开发基础，不会激活策略、连接实盘执行适配器，也不会授予产生外部交易效果的权限。

## 前置条件

- 与当前仓库版本匹配的 Python 和 Rust 工具链。
- 用于文档站点的 Node.js。
- 只为明确选择的数据或执行适配器配置凭据。
- 用于生成策略代码和探索工作的隔离环境。

始终使用仓库当前的 Makefile 与 CI 工作流，不要复制旧文档中的历史命令。

## Credential 前置矩阵

本表只记录当前 consumer 和边界明确的候选。环境变量存在不代表 connector 已准入 数据许可成立
交易获得授权或产品能力已经实现。

| 环境变量                                                              | Owner 或用途                               | 何时需要                                                       | 状态                                                                                                              | 缺失处置                                                                                 | Secret 处理                                                           |
| --------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 无                                                                    | 仓库构建与文档                             | build test 文档生成与本地预览                                  | current 无 key                                                                                                    | 正常工作                                                                                 | 无 secret                                                             |
| `DATABENTO_API_KEY`                                                   | Market Data Data Client                    | 显式配置 Databento 数据适配器或 example                        | current optional                                                                                                  | adapter `NOT_CONFIGURED` 或数据 `UNAVAILABLE`，不能返回零观测                            | 仅 ignored local secret                                               |
| `BINANCE_API_KEY` + `BINANCE_API_SECRET`                              | Market Data 与 Execution Binance adapter   | 获得明确授权的实盘连通 probe 或交易部署                        | current optional external effect                                                                                  | adapter 不准入且不产生实盘效果                                                           | 仅 ignored local secret，不能用于文档或研究发现                       |
| `SILICONFLOW_API_KEY` + `SILICONFLOW_BASE_URL`                        | R&D media Source Intake                    | 显式配置 BiliNote 媒体 connector profile                       | 本地已准备；optional connector                                                                                    | connector `NOT_CONFIGURED` 或 `UNAVAILABLE`，不能伪装为空来源证据                        | key 仅 ignored local secret；base URL 是非 secret 配置但仍须绑定请求  |
| `VIBE_PATH`                                                           | 本地 catalog storage 配置                  | 显式选择本地 catalog 路径                                      | current optional                                                                                                  | 使用已准入本地默认值或明确配置失败                                                       | 本地路径配置，receipt 不复制其值                                      |
| `VIBE_TEST_DATA_BASE_URL`                                             | testkit 与 CI fixture                      | 测试明确获取已配置 fixture base 时                             | current optional                                                                                                  | 测试按自身 policy 明确 skip 或失败                                                       | 非 secret 配置，仍不能改写 receipt                                    |
| `OPENALEX_API_KEY`                                                    | planned R&D 学术 connector                 | 未来已准入 OpenAlex connector 确实要求时                       | 本地已准备；connector candidate                                                                                   | `CONNECTOR_NOT_CONFIGURED` 或 `UNAVAILABLE`，不能返回零结果                              | 仅 ignored local secret                                               |
| `CORE_API_KEY`                                                        | planned R&D 开放全文 connector             | 未来已准入 CORE connector                                      | 本地已准备；connector candidate                                                                                   | `CONNECTOR_NOT_CONFIGURED` 或 `UNAVAILABLE`，不能返回零结果                              | 仅 ignored local secret                                               |
| `SEMANTIC_SCHOLAR_API_KEY`                                            | planned R&D 学术发现 connector             | 未来已准入 Semantic Scholar connector                          | 本地已准备；connector candidate                                                                                   | `CONNECTOR_NOT_CONFIGURED` `RATE_LIMITED` 或 `UNAVAILABLE`                               | 仅 ignored local secret                                               |
| `STACKEXCHANGE_KEY`                                                   | planned R&D Q&A 发现 connector             | 未来已准入 Stack Exchange connector                            | 本地已准备；connector candidate                                                                                   | `CONNECTOR_NOT_CONFIGURED` `RATE_LIMITED` 或 `UNAVAILABLE`                               | 仅 ignored local secret                                               |
| `FIRECRAWL_API_KEY`                                                   | planned R&D web Source Intake connector    | 只用于通过 Source Acquisition Binding 准入的有界 fetch profile | 本地已准备；connector candidate                                                                                   | `CONNECTOR_NOT_CONFIGURED` `POLICY_UNAVAILABLE` 或 `TERMS_OR_LICENSE_BLOCKED`            | 仅 ignored local secret；不授予任意 crawl 权威                        |
| `KAGGLE_API_TOKEN`                                                    | planned Market Data 或 R&D dataset 获取    | 只用于已准入且绑定 dataset/version/license 的 fetch            | 本地已准备；connector candidate                                                                                   | `CONNECTOR_NOT_CONFIGURED` `UNAVAILABLE` 或 `TERMS_OR_LICENSE_BLOCKED`                   | 仅 ignored local secret；数据集权利另行判断                           |
| `FRED_API_KEY`                                                        | planned Market Data 经济序列 connector     | 未来已准入 FRED 或 ALFRED market-data connector                | 本地 credential 已存在且通过只读 metadata 认证 probe；connector 尚不存在；归档/回测用途为 `LEGAL_REVIEW_REQUIRED` | `CONNECTOR_NOT_CONFIGURED` `UNAVAILABLE` 或 `TERMS_OR_LICENSE_BLOCKED`，不能替换为当前值 | 仅 ignored local secret；credential 存在不等于取得存储 训练或回测权利 |
| `OPENAI_API_KEY` `ANTHROPIC_API_KEY` `ARK_API_KEY` `DEEPSEEK_API_KEY` | optional R&D 或 Agent Shell 模型 connector | 仅用于显式选择且绑定 manifest 的 model/tool profile            | 本地已准备；不是通用项目前置                                                                                      | connector `NOT_CONFIGURED` 或请求 `POLICY_UNAVAILABLE`，绝不削弱确定性 Owner gate        | 仅 ignored local secret；模型输出是不可信输入，不是交易证据或权威     |

通用 LLM key 仅为前置发现列出，不是项目架构前置条件。没有当前 code consumer 的本地 key 既不是安装证据，也不是承诺
connector。secret 值只保存在 ignored local secret 环境，绝不提交 打印 记录或复制到 request receipt
artifact 文档 截图或审计包。增加 Research connector 前先阅读[研究来源接入指南](../source-intake/)，
准入 data provider 或 dataset 前阅读[市场数据接入指南](../market-data-intake/)。

## 构建基础能力

在仓库根目录使用当前构建入口：

```bash
make build-debug
```

构建和测试通过只证明本地软件基础可复现，不证明数据适用、策略有效、资格成立、资金获批、
实盘连通或恢复安全。

## 使用数据之前

配置 Market Data 适配器，并验证标的身份、时间戳、覆盖范围、历史修订、许可和 PIT 可用时间。
事实缺失或含义不明确时，依赖它的研究、回测、扫描、估值或交易都必须停止。

## 模拟或实盘之前

产品链必须具备已通过资格评估的工件、Governance 部署决定、Risk 政策、Execution 适配器、
对账和 Recovery 路径。模拟与实盘使用相同的意图、风控、订单和反馈语义，只替换执行适配器。

实盘是明确的外部效果配置。仅安装项目绝不会自动启用实盘。
