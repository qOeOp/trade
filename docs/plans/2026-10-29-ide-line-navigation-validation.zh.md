# 2026-10-29 研究线切换实现与验证

发现 20261029-24，诊断见 [历史线入口](doctor/2026-10-29-ide-line-navigation.zh.md)。

- `line list --at` 在一个钉住的账本提交上从现有声明和关闭标签派生全部线及状态；不读市场、不写账本。
- `/api/lines` 通过产品 CLI 读取列表，沿用 IDE Host/跨站检查。
- Research line 菜单显示所有线、开发窗口、Open/Closed 与当前选中标记。
  切换保留明确的 `at`，移除旧线的 `since` 与版本 fragment；导航不执行 `line select`。
  没有默认图时也给出全部线入口，包括所有线都已关闭的情形；离线 HTML 不请求服务。
- 没有新增存储字段/表、策略、研究登记、试验或规则；未改其他发现的 grader。

验证：

- Dolt 2.4.2：完整 `unittest discover -s tests -t . -p 'test_*.py'`，662 项通过、无跳过。
- 补齐全关闭场景后定向 `tests.ledger.test_lines tests.research_graph.test_serve`，22 项通过。
- `uv run --frozen ruff check .`、`uv run --frozen mypy`、前端 `npm run build` 通过。
- 隔离 Chrome、无账户/持久浏览器状态：基于只读捕获的 5 条线列表与图快照，检查
  菜单 5 项（2 Closed、3 Open）、当前项、旧线导航、保留 at/清除 since 和 hash，以及
  首页无开放线时的 5 个历史导航入口；均通过。截图工作副本在 `/tmp/ide-line-preview/menu.png`。
- `line list` 在真实活动账本上只读验证了 5 条记录；工程写入测试仅用抛弃式库。

限制：浏览器验收用本地隔离服务与捕获快照，未把尚未合并的 UI 部署到 compose。
市场同步的实际修复和验证属于独立发现 20261029-25。
