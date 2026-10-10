# 研究来源检索：用一个 skill 统一，不建服务

状态：已决定，随 `research-sources` skill 落地。日期 2026-10-10。

问题：论文检索（OpenAlex、Semantic Scholar、arXiv、CORE）和其他研究来源（FRED、Kaggle、Stack Exchange）
能否统一成一个服务、能否拆成 skill；前提是先确认开源社区没有已经做得更好的现成项目。

## 结论

1. **统一入口是一个 skill，不是服务。** `.agents/skills/research-sources/`：SKILL.md 放路由表、
   检索与阅读规则，两份按需参考（`papers.md`、`data.md`）放各 API 的端点、限额和已知故障。
   Agent 用 `curl` + `jq` 直接调官方 API。零新增产品代码，也不引入第三方 MCP。
2. **没有现成项目明显更好。** 唯一真正跨源统一的 openags/paper-search-mcp 有硬伤（见下表）；
   其余要么只覆盖单一来源，要么是不同问题（对本地 PDF 问答）。可借鉴的设计已吸收进 skill。
3. **按"代码或 Agent"三条准则审过：**
   - 信任边界：检索结果本身不是 Agent 给自己打分的考卷；决策引用的论文内容走现有
     `material retain`（`research-round` 已规定），不需要新的托管路径。
   - 修现有缺陷：不涉及。
   - Agent 做不到：不成立。7 个来源全部用 curl 实测打通（见"实测"），限速靠顺序调用即可满足。
   - 历史教训：仓库曾有 Rust 写的 Source Intake、OpenAlex 执行器、来源托管和 CI 健康探针，
     #1458 已整体退役；不再重建。

## 开源对比（2026-10-10 核对）

| 项目 | 是什么 | 不直接采用的原因 |
|---|---|---|
| openags/paper-search-mcp（2.8k★，MIT） | 20+ 来源的 MCP + CLI + skill | `config.py` 把整个 `.env` 灌进进程环境（本机 `.env` 与交易所凭证同文件）；57–74 个工具；去重只比 DOI 或标题+作者，预印本与正式版不合并；无跨源排序；Google Scholar/SSRN 靠抓取，可选 Sci-Hub；PyPI 0.1.4 在 mcp 2.x 下起不来（#152） |
| blazickjp/arxiv-mcp-server（3.2k★） | 只有 arXiv，19 个工具 | 单一来源 |
| Future-House/paper-qa（9.3k★） | 对本地 PDF 文件夹做带引用的问答 | 不是多源检索；需要 LLM key；索引反序列化有未关 issue |
| AI2 asta-paper-finder / Asta MCP | 论文查找代理 / 托管 MCP | 前者已声明不再维护；后者另需申请 key，能力与 S2 snippet 重叠 |
| OpenAlex 官方 MCP | 16 个工具，OAuth | 5 个工具会改作者档案；REST 已能拿到同样数据（含 `search.semantic`） |
| Kaggle 官方 MCP | 71 个工具 | 含提交竞赛、改数据集等写操作；需求只有搜索和下载，CLI 已够 |
| Stack Overflow 官方 MCP | 2 个工具 | 每天 100 次，只覆盖 Stack Overflow，不含 quant |
| stefanoamorelli/fred-mcp-server | 3 个工具 | AGPL；三个调用 curl 一行即可 |
| K-Dense-AI scientific-agent-skills `paper-lookup`（48k★，MIT） | 路由 SKILL.md + 18 份 API 参考 + 4 个解析脚本 | 偏生物医学，无 SSRN/NBER/RePEc；正文 316 行偏长 |

## 吸收了什么

- K-Dense：路由表 + 每类 API 一份按需参考；只读指名的 key、不回显；先看总数再翻页；记录查询出处。
- openags：SSRN 走 OpenAlex 的 source 过滤而不是抓取；某个来源失败不能报成"零结果"；开放全文的回退顺序。
- arxiv-mcp：检索结果默认精简，全文只对选中的论文分段读。
- PaperQA2：多来源元数据互补，剔除撤稿（OpenAlex `is_retracted`）。
- 各家共同缺口，本 skill 补上：预印本与正式发表版本的合并（arXiv DOI `10.48550/arxiv.*` 视作 arXiv ID，经 S2 `externalIds` 关联）。
- 与本仓库研究流程的衔接：已有论文研究过的窗口对该机制是开发数据，不能当留出；文献结论是假设，按 `research-round` 检验。

## 实测（用本机 key，各 1–3 次请求）

| 来源 | 鉴权 | 结果与坑 |
|---|---|---|
| OpenAlex | `Authorization: Bearer` | 通；按美元日预算计费（响应头可见，检索约 $0.001/次，单篇查询免费）；SSRN `S4210172589`、NBER `S2809516038`、RePEc `S4306401271` 过滤可用；SSRN 条目常缺摘要 |
| Semantic Scholar | `x-api-key` | 通（假 key 返回 403，说明本机 key 被识别）；但即使间隔 3 秒仍约四成请求 429，属共享容量限流，不是 key 问题；bulk、batch、snippet、推荐均可用 |
| arXiv | 无 | 通；`cat:q-fin*` 可用；3 秒一次 |
| CORE | Bearer | 端点缺尾斜杠返回 301；部分查询（如 `_exists_:`）返回 500；每条结果内嵌全文（两条约 650 KB），必须先用 jq 投影 |
| FRED | `api_key` 查询参数 | 通；ALFRED 取历史版本可用（某季度 GDP 首发值与当前修订值不同）；`output_type=4` 必须带全时段 realtime 区间，否则报错 |
| Stack Exchange | `key` 查询参数 | 通；响应 gzip，需 `--compressed`；`site=quant` 可用 |
| Kaggle | Bearer / CLI 读 `KAGGLE_API_TOKEN` | 通；数据集血缘未经验证，只作线索 |

OpenAlex 的 `search=` 含全文，噪声大（同一布尔式 14 万条 vs `title_and_abstract.search` 351 条），skill 默认用后者。

SSRN 无公开 API 且条款禁止自动抓取，RePEc/IDEAS API 需邮件申请且无检索功能，NBER 无 API；三者都经 OpenAlex 的 source 过滤覆盖。

## 试用

子 Agent 只读 skill、按真实问题各做一轮（约 30 次调用），skill 据反馈修订：

- 第一轮（资金费率能否预测收益）：key 规则可照做、无泄露；暴露出 S2 频繁 429 而"重试一次"太少、
  OpenAlex `search=` 噪声、arXiv 不加分类会混入物理和 CS、CORE 内嵌全文有时是另一篇文档、
  同一论文有 3 个 DOI 时按 DOI 合并失效、只拿到摘要时无处标注、对 HTML 跑了 pdftotext、
  Unpaywall 需要邮箱而 skill 没说用哪个、Stack Exchange `q=` 偏题。均已改进 skill；
  Unpaywall 当时先去掉，用户给出联系邮箱后恢复（见"接入范围"）。
- 第二轮（订单流不平衡 + FRED 历史版本，19 次调用）：key 规则、"仅摘要"标注、版本合并、
  FRED 当时已知值与现值对比都按规则做到；S2 退避到 45 秒那一档才通过。新暴露的问题均已修改：
  OpenAlex 可用 `filter=doi:a|b` 一次核对多个版本；S2 `externalIds` 不列 SSRN 副本；
  出版社 PDF 通常被人机验证拦下，应先找 arXiv 和机构库副本；CORE 单独一个引号短语会被宽松匹配；
  arXiv 返回 Atom XML，要用 Python 解析；子 Agent 每次调用都会重置工作目录。

暂不加 `claude plugin eval` 用例：试用已覆盖本轮规则；若某条规则在后续使用中反复不被遵守，再按
`research-round` 的做法补回归用例。

## 接入范围（用户 10-10 定）

- **第一档，免 key，已接入：** Crossref（DOI 元数据、`relation` 版本关系）、OpenCitations（S2 限流时的引用关系）、
  NBER 元数据 TSV（工作论文及其正式发表去向）、EconBiz（含 RePEc 记录）、Zenodo（复现包与数据集）、
  CFTC 持仓报告（CME 比特币/以太坊与 Coinbase 永续式合约，按交易者类别）、财政部 TGA 余额、
  纽约联储 SOFR 与逆回购。
- **第二档，需要联系邮箱，已接入：** Crossref polite 池、Unpaywall、SEC EDGAR。邮箱放在本机 `.env` 的
  `RESEARCH_CONTACT_EMAIL`，不进 Git（仓库公开）。
- **不申请任何新 key 或提额。** Semantic Scholar 继续靠退避；CORE 维持个人档。
- **不接：** Google Scholar（无 API，robots 禁止）、BASE（需登记 IP，禁止未经许可的自动检索）、Sci-Hub、
  Scopus/WoS/IEEE（付费）、生物医学各源、IACR、Asta（许可证限学术非商业）、RePEc IDEAS API 与批量数据
  （无检索功能；排除商业用途）、IDEAS/EconPapers 检索页（robots）、Coin Metrics 社区版（CC BY-NC）、
  DefiLlama Pro（付费）、Alpha Vantage、BEA/BLS（ALFRED 已有其历史版本）、CoinGecko（行情归市场数据线）。

- **Academic Torrents（用户 10-10 加入 `.env`，已调查）：** 社区运营的科研数据 BitTorrent 目录，约 2,900 条。
  没有加密行情、订单簿或资金费率数据；对本项目有用的只有 Crossref 官方公开数据文件的镜像和 Reddit 月度转储。
  没有检索 API，按官方文档下载每晚重建的 `database.xml` 离线检索；条目详情 `apiv2/entry/{infohash}` 免 token。
  `.env` 里的 token 实为账号登录 cookie（`uid=…;pass=…`），只有上传才需要，读取不用，skill 规定不用它。
  上传无人审核，多数条目没有许可证，目录里还有已被 DMCA 下架却未标记的条目；BitTorrent 下载会公开本机 IP，
  单个条目常有数十 GB 到数 TB。所以 skill 只读目录，任何下载都先向用户报告 infohash、大小、上传者、许可证和
  目标路径并等确认，优先找原发布方的副本。

数据源的时点规则写进 skill：CFTC 周二持仓、周五 15:30 ET 发布，遇假日顺延；TGA 次一工作日 16:00 ET 前发布；
SOFR 次一工作日约 08:00 ET 发布、14:30 ET 前可修订；EDGAR 以 `acceptanceDateTime` 为公开时点。
实测中的坑：CFTC 合约代码会在交易所之间迁移（同一代码先属 LMX 后属 Coinbase）；TGA 余额只在
`open_today_bal` 列；EDGAR 不带联系 User-Agent 返回 403。

## 安全

研究 key 与 `BINANCE_API_KEY/SECRET` 同在主 checkout 的 `.env`。skill 要求每条命令只读所需的那一个 key、
不 `source`、不打印；这是提示层约束。若要结构上隔离，可把研究 key 移到单独文件，由用户决定。
