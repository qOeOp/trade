# 平台架构文档覆盖核对

2026-10-23。范围是文档导航、定义覆盖、实现入口和页面消费；不改变研究契约、运行时技能或数据库模式。

## 对照来源与结果

| 来源 | 核对范围 | 结果 |
|---|---|---|
| `cli/`、`market/`、`engine/`、`runtime/`、`ledger/`、`registration/`、`qualification/`、`replay/`、`report/`、`services/` | 59 个非初始化 Python 模块，495 个按模块去重的公开顶层函数或类；重载按同一入口计 | 每个模块和入口有对应设计说明或实际签名、源码链接；补充 291 个此前未列出的实现入口 |
| `ledger/schema.sql`、`market/schema.sql` | 17 张账本表、5 张市场表及其字段 | 22 张表分入九类职责页，保留原表定义；业务视图和研究史视图归读取职责 |
| `.agents/skills/` | 六个技能的入口与全部运行文件 | 原五个技能的文件覆盖齐全；补充 `video-evidence` 的技能、参考文件、资源和既有评测入口 |

此前没有模块设计节的实现包括 `engine/native_csv.py`、`ledger/reproduction.py`、三个领域的 `seams.py`、`report/profit.py`。视频校验服务另增独立 Code 页，与视频 Skill 页互相引用。

代码目录核对还发现两个名称误表述：`registration_id` 是参数，实际报告入口是 `report.validation_report`；CLI 的 `line close` 直接分发到 `ledger.lines.close_line`，没有独立 `line_close` 函数。已修正文档和预览。

## 导航与资源

- 「四、平台架构」包含「架构总览」及 Code、Database、Skill 三个可折叠分组；Skill 按研究职责排序，卡片保留技能原名。
- 数据库总览保留两张全库关系图，九个职责页承接定义；原 Ref 身份不变，预览指向新页，原总览片段保留定义入口。
- 根目录图标移动到 `docs/assets/icon.svg`，暗色资源为 `docs/assets/icon-dark.svg`，K 线白色、外框红色；构建复制到原公开 URL，CI 的 `docs/**` 覆盖资源变化。
- 修正内容准备脚本：保留以 `/` 开头的站内 Markdown 链接，避免误改写到 GitHub 仓库根。

## 验证

- 标准 Python 测试：465 项，222 项跳过，结果通过。
- 文档构建、类型检查、中英页面检查和静态路由检查通过：46 对页面，96 条导出路由，92 个本地化文档入口。
- 临时核对脚本检查模块与公开入口、技能文件、表字段、预览目标和重复定义锚点；未发现遗漏。此脚本保留在 `/tmp`，不增加产品检查。
- 浏览器核对 1440 像素桌面与 390 像素手机布局、明暗主题图标、折叠目录、职责页跳转、数据库两张关系图及原片段入口。页面无横向溢出；观察到的控制台错误为空。
- 安全升级：`next` 从 16.4.0 升至 16.4.2，Mermaid 的间接依赖 `dompurify` 从 3.4.16 升至 3.4.17；Next 的配套 env/SWC 包一并更新。DOMPurify 在上游既有版本范围内更新锁文件，不新增 override。升级后 `npm audit` 报告零漏洞。
- 升级后从锁文件执行 `npm ci`，重跑构建、类型、中英页面、静态路由与依赖审计均通过；浏览器再次确认两张数据库关系图渲染成功、旧定义锚点存在、站内链接没有被误写到 GitHub 根、手机三组卡片与六个 Skill 入口可见且无横向溢出，未观察到控制台错误。

## 依赖升级依据

- [Next.js 官方安全公告](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) 将 16.4.0 列为受影响版本，16.4.1 开始修复；本次采用同一小版本线的 [16.4.2 补丁版](https://github.com/vercel/next.js/releases/tag/v16.4.2)。
- [DOMPurify 官方安全公告](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7) 将 3.4.4 至 3.4.16 列为受影响版本，修复版本为 3.4.17；[3.4.17 发布说明](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) 同时说明模板、原位处理和 XHTML 清理修复。

实现入口覆盖核对提供目录、符号和链接的证据。这里没有声称逐一重新验证全部函数行为或执行技能评测。
