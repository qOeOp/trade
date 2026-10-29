# 2026-10-29 IDE 画布与源码评审显示修复验收

对应诊断：[20261029-120、20261029-121](doctor/2026-10-29-ide-canvas-source-reviews.zh.md)。用户已要求全部修复并测试。修改基于 `773ac59b4`，位于 `codex/ide-canvas-source-review-fixes` 工作区；本记录不表示已合入或部署。

## 修复

- 谱系画布使用当前视图的 `axis.min` 与图中实际 trial 范围计算边界。初始定位、聚焦节点、平移限制和 Home 返回起点共用同一边界。保留真实 trial 编号，较早的预检和较晚的重跑仍可到达。范围之前的底色也限制在内容边界内。
- 图提取在已有 `note` 中保留 API、causal、activity、readiness 四项的状态和原说明，以空行分隔；不再只取失败项。原说明的段落、列表和措辞保留。
- Source Reviews 正文复用 Conclusion 的 `Prose`，支持段落、列表、折叠、长标识与中文行高。没有新增存储字段、schema 版本、拒绝规则或 skill 规则，没有修改历史正文。
- 新增 4 项几何行为回归，随 `npm run check` 和构建运行；现有浏览器验收改为读取当前线的边界，不再把 trial 0 写死在期望中。图提取的隔离集成测试覆盖通过项、失败项、`no_opportunity` 及原始段落和列表。

## 验证结果

| 检查 | 结果 |
|---|---|
| `RESEARCH_DOLT_BINARY=/tmp/trade-dolt-2.4.2.ItujDp/dolt-darwin-arm64/bin/dolt uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'` | 660 项通过，410.853 秒，无跳过，无 ResourceWarning |
| `uv run --frozen python -m unittest tests.report.test_graph tests.research_graph.test_research_graph`（同一 Dolt 环境变量） | 9 项通过；只使用测试创建的隔离 Dolt |
| `npm run build`（`services/ide/web/`） | TypeScript、结构规则、4 项几何回归、Vite 单文件构建全部通过 |
| `uv run --frozen ruff check .` | 通过 |
| `uv run --frozen mypy` | 90 个源码文件通过 |
| `git diff --check` | 通过 |
| 专项浏览器验收 | 4 组场景通过，无未捕获异常：1600px 明暗主题、1000px 窄窗口、长研究线 Home 返回起点 |
| 现有 `scripts/verify.mjs` 完整 IDE 验收 | 全部不变量通过；4 个面板、139 条 VersionLine，包含平移到边界、聚焦、侧栏开关、源码打开与差异视图 |

## 浏览器证据与范围

专项验收从隔离 Dolt 中经产品 `research graph` 提取真实测试评审，再生成 trial 编号平移到 200 之后的布局夹具；未写活动账本。浏览器核实通过项说明存在、展开后四项状态和说明完整、两个列表项以真实 `li` 呈现、段落保留、收起有效，以及窄窗口正文不溢出详情面板。长线水平平移后内容左边界位于屏幕外 1174px，按 Home 后偏移为 0，垂直位置保持不变。

现有完整 IDE 验收使用 `/tmp/research-graph-source/graph.json` 的历史工作副本作为布局夹具，适配其格式名称和已退役的 `kept_reference` 状态到现有 schema；没有改动原文件或产品校验。验收调用临时副本时仅替换 CDP 端口为本次可用端口，以免干扰已有浏览器。

浏览器连接器的共享 Chrome 已被其他会话占用，故使用独立临时 profile 运行项目的 headless Chrome 验收，只关闭本次测试创建的进程。所有派生夹具、脚本、日志和截图留在 `/tmp/ide-canvas-review-verification/`，其中 `browser-report.json`、`1600-dark.png`、`1000-dark.png` 和 `shell-shots/report.json` 为本次证据。全量测试日志为 `/tmp/ide-canvas-full-tests.log`。

未部署运行中的 IDE，未验证用户当前线上页面已更新。没有改动运行镜像或宿主设置，研究与行情账本没有本次写入。
