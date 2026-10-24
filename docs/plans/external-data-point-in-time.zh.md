# 外部研究数据：历史可见时点与产品能力分开

2026-10-25。用户逐项确认：回放环境简述外部研究数据的历史可见时点要求，详细规则继续引用 `research-sources` 的数据参考；从待定清单移除这一项。本轮只收敛文档。

## 已定边界

- 历史决策只引用当时已发布且可获得的数据版本，区分统计所属日期、发布时间与修订版本，说明可见时刻的证据和假设。仅有发布日期不能证明盘中精确可见。
- 详细来源规则保留在 `.agents/skills/research-sources/references/data.md`；回放环境只作简述与链接，不复制各来源的取数步骤。
- Agent 的来源核对和独立源码审查负责检查上述要求。规则已定不代表产品已有通用外部数据接入或自动时点校验能力。
- 不新增数据管道、持久化字段、运行时机制或拒绝／审计检查；不改原生依赖或现有 skill 规则。

## 现有依据

- `research-sources/references/data.md` 已要求只使用历史时刻前已发布的值，并以当时已知的 vintage 处理修订；最新值仅供描述。
- `docs/rd/design-skill-research-sources.zh.mdx` 的 `references/data.md` 段落已解释按发布时刻对齐与 vintage；本次回放环境链接到该段落。
- `engine/run.py::STREAM_TYPES` 当前列出标记价、报价、资金费、K 线及生命周期事件；没有通用经济或持仓数据加载与时点校验接口。本轮不扩大该能力。

## 验证

- `npm run check:i18n --prefix docs-site`：47 组双语章节通过。回放环境、待定清单、审计页的英文待翻译镜像与中文正文一致。
- `npm run build --prefix docs-site`：静态构建通过，日志 `/tmp/trade-pit-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望路由与导出路由通过，94 个本地化页面有导航父级。
- 解析中英文入口的导出 HTML：历史可见时点要求、产品能力限制均已输出；详细参考链接分别指向对应语言的设计页，目标锚点存在。回放环境与总待定清单的四个入口均不再列出旧待定条目。
- `git diff --check`：通过。

没有运行外部数据导入或策略回放，没有修改 skill、产品代码、检查或存储结构；没有写活动账本、市场库或 canonical Catalog。本轮没有新增运行时能力，不以文档构建结果声称自动时点校验已实现。
