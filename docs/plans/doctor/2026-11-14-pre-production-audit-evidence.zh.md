# 2026-11-14 上线前全面审计：证据附录

[审计记录](2026-11-14-pre-production-audit.zh.md)的附录。`/tmp/trade-audit-20261114/` 开头的路径是审计工作目录，重启后会丢；这里记下它们是为了说明每条证据当时在哪里、怎样得到。

## 检索日志

来源：`/tmp/trade-audit-20261114/phaseA/searchlog-*.jsonl`，共 10 个文件，382 行非空。统计脚本：`/tmp/trade-audit-20261114/report/tools/searchlog_stats.py`。这些路径在 `/tmp` 下，重启后会丢失。

### 归一规则

- 日志字段名不统一。共有两种行结构：多数行为 `date, index, query, filters, hits, read_depth, access_limit`（facets 文件另有 `facet`，facets-1-7 另有 `phrasing`）；`searchlog-facetcheck-III.jsonl` 为 `ts, index, query, url, key, curl_exit, bytes`，没有命中数、读取层和 access_limit 字段。
- 日期取 `date`，没有则取 `ts` 的日期部分。
- 索引按 `index` 字段归类：含 `openalex`（不分大小写）归 OpenAlex；含 `crossref` 归 Crossref；以 `s2` 开头或含 `semantic` 归 Semantic Scholar；其余（`web`、`web-search`、`fetch`、`author-page-*`、`publisher-*`、`arXiv`、`vendor-docs` 等）归“其他”。`searchlog-6.jsonl` 里有 9 行字段错位（`index` 为 `metadata`，`query` 为 `GET metadata`，URL 落在 `read_depth`），按错位还原：URL 作查询词，读取层记 `metadata`；其中 URL 含 `api.crossref.org` 的 1 行归 Crossref，其余归“其他”。
- 命中数：整数照录；`null`、`"null"`、缺失记为空；字符串数字按原样（如 `"1"`）。
- 访问限制状态由 `access_limit` 文本判断（facetcheck-III 由 `curl_exit` 判断）：含 `429` 或 `Too Many Requests` 记“限流”；含 `http 000`、`curl_rc` 非 0、HTTP 4xx/5xx（429 除外）、`error`、`challenge`、`bot-check` 记“其他失败”；含 `not retrieved`、`not scraped`、`not pursued`、`excluded`、`not read`、`forbids`、`truncated` 记“未取（受限或策略）”；其余记“无”。这是按文本关键词的机械归类，一行只归一类，先到先得。
- 分组：facets 文件按 `facet` 字段分组（facets-1-7 为面 1 至 7，facets-8-13 为面 F8 至 F13，字段值照录）；其余文件按文件名后缀分组（`1` 至 `6`、`facetcheck-III`、`facetcheck-IV`）。
- 表中查询词、读取层、访问限制超过 110 个字符的截断，末尾加 `…`。查询词里的原文在 JSONL 中。

### 解析情况

- 严格 JSON 解析失败 4 行（查询词里有未转义的双引号）：6 第 60 行、6 第 61 行、6 第 62 行、facetcheck-III 第 4 行。
- 其中 4 行用正则按字段位置还原后计入统计，表中查询词后标 `*`；完全无法还原 0 行（不计入统计）。

- 计入统计的行数：382。

### 按索引统计

| 索引 | 查询数 | 限流 | 其他失败 | 未取（受限或策略） |
|---|---|---|---|---|
| OpenAlex | 124 | 1 | 2 | 6 |
| Crossref | 67 | 0 | 0 | 0 |
| Semantic Scholar | 77 | 23 | 0 | 0 |
| 其他 | 114 | 12 | 35 | 8 |
| 合计 | 382 | 36 | 37 | 14 |

“其他”索引内的细分：

| index 字段值 | 查询数 | 限流或其他失败 |
|---|---|---|
| publisher-pm | 9 | 9 |
| metadata | 8 | 3 |
| web-search | 8 | 0 |
| author-page-hansen | 6 | 6 |
| web | 5 | 0 |
| arXiv API | 5 | 0 |
| author-or-repository-probe | 5 | 4 |
| web_search | 4 | 0 |
| fetch | 4 | 0 |
| WebFetch (binance.com official) | 4 | 0 |
| author-page-lopez | 4 | 1 |
| author-page-wiecki | 4 | 2 |
| institutional-repo-unc | 4 | 4 |
| WebSearch | 3 | 0 |
| author-page-harvey | 3 | 1 |
| publisher-jbes | 3 | 2 |
| vendor-docs | 3 | 0 |
| direct_fetch | 2 | 0 |
| figshare | 2 | 0 |
| direct download | 2 | 2 |
| publisher-jpm | 2 | 2 |
| publisher-joi | 2 | 2 |
| institution-or-author-copy | 2 | 2 |
| fed | 2 | 0 |
| nber_direct_url | 1 | 0 |
| ssrn_landing | 1 | 1 |
| web_fetch | 1 | 1 |
| author homepage | 1 | 0 |
| publisher/repository probe | 1 | 1 |
| SSRN | 1 | 1 |
| GARP landing page | 1 | 0 |
| arXiv | 1 | 0 |
| arxiv | 1 | 0 |
| skipped | 1 | 0 |
| author-page-ra | 1 | 1 |
| author-pdf-harvey | 1 | 0 |
| repec-jbes | 1 | 1 |
| author-page-quantopian | 1 | 1 |
| sec/lii | 1 | 0 |
| federalreserve.gov | 1 | 0 |
| fia.org-pdf | 1 | 0 |
| sec.gov-faq | 1 | 0 |

### 按文件与面分组的查询数

| 分组 | 来源文件 | 查询数 | OpenAlex | Crossref | Semantic Scholar | 其他 | 限流 | 其他失败 |
|---|---|---|---|---|---|---|---|---|
| 1 | searchlog-1.jsonl | 22 | 9 | 0 | 4 | 9 | 2 | 2 |
| 2 | searchlog-2.jsonl | 22 | 8 | 5 | 2 | 7 | 0 | 2 |
| 3 | searchlog-3.jsonl | 23 | 10 | 1 | 1 | 11 | 0 | 0 |
| 4 | searchlog-4.jsonl | 23 | 10 | 3 | 3 | 7 | 4 | 0 |
| 5 | searchlog-5.jsonl | 64 | 30 | 13 | 14 | 7 | 0 | 4 |
| 6 | searchlog-6.jsonl | 64 | 4 | 1 | 0 | 59 | 12 | 29 |
| facetcheck-III | searchlog-facetcheck-III.jsonl | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| facetcheck-IV | searchlog-facetcheck-IV.jsonl | 6 | 0 | 0 | 0 | 6 | 0 | 0 |
| 面 1 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 1 | 0 |
| 面 1-7 | searchlog-facets-1-7.jsonl | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| 面 2 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 0 | 0 |
| 面 3 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 0 | 0 |
| 面 4 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 0 | 0 |
| 面 5 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 1 | 0 |
| 面 6 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 0 | 0 |
| 面 7 | searchlog-facets-1-7.jsonl | 9 | 3 | 3 | 3 | 0 | 0 | 0 |
| 面 F8 | searchlog-facets-8-13.jsonl | 17 | 5 | 5 | 7 | 0 | 4 | 0 |
| 面 F9 | searchlog-facets-8-13.jsonl | 11 | 5 | 3 | 3 | 0 | 0 | 0 |
| 面 F10 | searchlog-facets-8-13.jsonl | 13 | 4 | 4 | 5 | 0 | 2 | 0 |
| 面 F11 | searchlog-facets-8-13.jsonl | 15 | 4 | 4 | 5 | 2 | 2 | 0 |
| 面 F12 | searchlog-facets-8-13.jsonl | 13 | 4 | 3 | 4 | 2 | 1 | 0 |
| 面 F13 | searchlog-facets-8-13.jsonl | 21 | 5 | 4 | 8 | 4 | 7 | 0 |

searchlog-1 至 6 对应 `phaseA/papers-1-protocol.md` 至 `papers-6-seeds-retry.md` 的论文检索批次（文件名对应关系，未在日志内标注）。

### 访问限制文本分布

| 索引 | 状态 | access_limit（前 70 字） | 行数 |
|---|---|---|---|
| OpenAlex | 其他失败 | error http 400 | 2 |
| OpenAlex | 未取(受限或策略) | full text not retrieved: paywalled/SSRN not scraped | 6 |
| OpenAlex | 限流 | no key; HTTP 429 | 1 |
| Semantic Scholar | 限流 | key; error: {"message": "Too Many Requests. Please wait and try again  | 16 |
| Semantic Scholar | 限流 | no key; HTTP 429 | 3 |
| Semantic Scholar | 限流 | key present; HTTP 429 | 2 |
| Semantic Scholar | 限流 | key; HTTP 429 after back-offs | 2 |
| 其他 | 其他失败 | http 404 curl_rc 0 type text/html | 8 |
| 其他 | 其他失败 | http 403 curl_rc 0 type text/html | 2 |
| 其他 | 其他失败 | http 403 type text/xml | 2 |
| 其他 | 其他失败 | http 000 type cannot open `hansen2005-unc-cdr.pdf' (No such file or di | 2 |
| 其他 | 其他失败 | http 000 | 2 |
| 其他 | 其他失败 | http 404 curl_rc 0 | 2 |
| 其他 | 其他失败 | http 000 curl_rc 28 | 2 |
| 其他 | 其他失败 | HTTP 403; not scraped further | 1 |
| 其他 | 其他失败 | HTTP 403 | 1 |
| 其他 | 其他失败 | HTTP 202 text/html challenge-like response; not pursued | 1 |
| 其他 | 其他失败 | HTTP 403; skill forbids scraping SSRN; not pursued | 1 |
| 其他 | 其他失败 | HTTP 202 empty body (bot challenge); not worked around | 1 |
| 其他 | 其他失败 | HTTP 202 empty body (bot challenge); not worked around; read via WebFe | 1 |
| 其他 | 其他失败 | http 000 curl_rc 6 type cannot open `fulltext/retry6/hansen-brown.html | 1 |
| 其他 | 其他失败 | http 404 curl_rc 0 type text/xml | 1 |
| 其他 | 其他失败 | http 000 curl_rc 28 type cannot open `hansen2005-unc-cdr.pdf' (No such | 1 |
| 其他 | 其他失败 | http 000 curl_rc 28 type cannot open `hansen2005-unc-record.html' (No  | 1 |
| 其他 | 其他失败 | http 000 curl_rc 28 type cannot open `quantopian-home.html' (No such f | 1 |
| 其他 | 其他失败 | http 302 curl_rc 28 | 1 |
| 其他 | 其他失败 | 1st probe (-o /dev/null) http 200; 2nd fetch http 403 bot-check inters | 1 |
| 其他 | 其他失败 | http 403 bot-check interstitial | 1 |
| 其他 | 其他失败 | http 000 curl_rc 6 | 1 |
| 其他 | 未取(受限或策略) | smallake.kr third-party mirror excluded; SSRN 403 to scripted fetch | 1 |
| 其他 | 未取(受限或策略) | third-party mirror (smallake.kr) excluded; GARP white-paper page revie | 1 |
| 其他 | 未取(受限或策略) | developers page truncated | 1 |
| 其他 | 未取(受限或策略) | no key needed; third-party hits (typeset.io, zendy, scribd) excluded | 1 |
| 其他 | 未取(受限或策略) | no author/publisher copy in results; spam PDFs excluded | 1 |
| 其他 | 未取(受限或策略) | GARP, scribd, aitopics hits are third-party; excluded | 1 |
| 其他 | 未取(受限或策略) | not read | 1 |
| 其他 | 未取(受限或策略) | SEC rate threshold page on direct fetch | 1 |
| 其他 | 限流 | http 429 curl_rc 0 type text/plain | 8 |
| 其他 | 限流 | http 429 type text/plain | 4 |

### 全部查询

列：日志（文件后缀:行号）、日期、索引（归类后；原字段值不同时括注）、查询词、命中数、读到哪层、访问限制。`*` 表示该行经正则还原，`s` 表示字段错位已还原。

| 日志 | 日期 | 索引 | 查询词 | 命中 | 读取层 | 访问限制 |
|---|---|---|---|---|---|---|
| 1:1 | 2026-11-14 | OpenAlex | works/doi:10.3905/jfds.2019.1.064 | 1 | metadata | key present |
| 1:2 | 2026-11-14 | OpenAlex | works/doi:10.1093/rfs/hhv059 | 1 | metadata | key present |
| 1:3 | 2026-11-14 | OpenAlex | title.search:A Backtesting Protocol in the Era of Machine Learning | 1 | metadata | key present |
| 1:4 | 2026-11-14 | OpenAlex | works/doi:10.3905/jfds.2019.1.064 abstract_inverted_index | 1 | abstract only | key present |
| 1:5 | 2026-11-14 | OpenAlex | title.search:and the Cross-Section of Expected Returns | 29 | metadata | key present |
| 1:6 | 2026-11-14 | OpenAlex | title.search:Backtesting; publication_year:2015\|2016 | 98 | metadata | key present |
| 1:7 | 2026-11-14 | OpenAlex | doi:10.1093/rfs/hhv059\|10.2139/ssrn.2249314 | 2 | metadata | key present |
| 1:8 | 2026-11-14 | OpenAlex | doi:10.3905/jfds.2019.1.064\|10.2139/ssrn.3275654\|10.3905/jpm.2015.42.1.013 | 2 | metadata | key present |
| 1:9 | 2026-11-14 | OpenAlex | title.search:Backtesting; author Harvey; year 2015 (first form, shell error, no result) | 0 | none | key present |
| 1:10 | 2026-11-14 | Semantic Scholar (semantic_scholar) | Backtesting Harvey Liu (search; shell error, no result) | 0 | none | key present |
| 1:11 | 2026-11-14 | Semantic Scholar (semantic_scholar) | paper/DOI:10.3905/jpm.2015.42.1.013 | 1 | metadata | key present |
| 1:12 | 2026-11-14 | Semantic Scholar (semantic_scholar) | paper/DOI:10.3905/jfds.2019.1.064 | 0 | none (429 after retries not done) | key present; HTTP 429 |
| 1:13 | 2026-11-14 | Semantic Scholar (semantic_scholar) | paper/DOI:10.1093/rfs/hhv059 | 0 | none | key present; HTTP 429 |
| 1:14 | 2026-11-14 | 其他 (nber_direct_url) | http://www.nber.org/papers/w20592.pdf (from OpenAlex location of ssrn.2249314) | 1 | full text (NBER WP 20592, Oct 2014 version) read via pdftotext | none |
| 1:15 | 2026-11-14 | 其他 (ssrn_landing) | papers.ssrn.com/sol3/papers.cfm?abstract_id=3275654 and ssrn.com/abstract=2345489 | 0 | none | HTTP 403; not scraped further |
| 1:16 | 2026-11-14 | 其他 (web_search) | "A Backtesting Protocol in the Era of Machine Learning" Arnott Harvey Markowitz pdf | 0 | metadata/snippets | web |
| 1:17 | 2026-11-14 | 其他 (web_search) | Backtesting Harvey Liu 2015 Journal of Portfolio Management pdf people.duke.edu charvey | 1 | snippets; full text from direct fetch | web |
| 1:18 | 2026-11-14 | 其他 (direct_fetch) | https://people.duke.edu/~charvey/Research/Published_Papers/P120_Backtesting.PDF | 1 | full text (JPM Fall 2015 version) | none |
| 1:19 | 2026-11-14 | 其他 (web_search) | Arnott Harvey Markowitz Backtesting Protocol pdf site:people.duke.edu OR researchaffiliates.com OR nber.org | 0 | snippets | web |
| 1:20 | 2026-11-14 | 其他 (direct_fetch) | researchaffiliates.com/insights/journal-papers/702-a-backtesting-protocol-in-the-era-of-machine-learning | 1 | landing page only; no PDF link found | none |
| 1:21 | 2026-11-14 | 其他 (web_search) | Harvey Liu Zhu ...and the Cross-Section of Expected Returns RFS 2016 pdf Duke | 0 | snippets | web |
| 1:22 | 2026-11-14 | 其他 (web_fetch) | alphaarchitect.com/protocol-to-prevent-quants-gone-wild | 0 | none | HTTP 403 |
| 2:1 | 2026-11-14 | OpenAlex | title.search: Pseudo-Mathematics and Financial Charlatanism backtest overfitting | 2 | metadata only | none (key used) |
| 2:2 | 2026-11-14 | OpenAlex | title.search: The Probability of Backtest Overfitting | 3 | metadata only | none (key used) |
| 2:3 | 2026-11-14 | OpenAlex | title.search: The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality | 2 | metadata only | none (key used) |
| 2:4 | 2026-11-14 | OpenAlex | title.search: The 10 Reasons Most Machine Learning Funds Fail | 1 | metadata only | none (key used) |
| 2:5 | 2026-11-14 | Semantic Scholar | paper/batch DOI x4 (fields title,year,venue,externalIds,openAccessPdf) | 4 | metadata only | key used |
| 2:6 | 2026-11-14 | OpenAlex | single-work locations W3123133461 (10 Reasons) | 1 | metadata only | none |
| 2:7 | 2026-11-14 | 其他 (WebSearch) | "The 10 Reasons Most Machine Learning Funds Fail" Lopez de Prado pdf | 10 | result list only | smallake.kr third-party mirror excluded; SSRN 403 to scripted fetch |
| 2:8 | 2026-11-14 | Crossref | works/10.1090/noti1105 | 1 | metadata | none; mailto used (not printed) |
| 2:9 | 2026-11-14 | Crossref | works/10.21314/jcf.2016.322 | 1 | metadata | none; mailto used (not printed) |
| 2:10 | 2026-11-14 | Crossref | works/10.3905/jpm.2014.40.5.094 | 1 | metadata | none; mailto used (not printed) |
| 2:11 | 2026-11-14 | Crossref | works/10.3905/jpm.2018.44.6.120 | 1 | metadata | none; mailto used (not printed) |
| 2:12 | 2026-11-14 | OpenAlex | works/W3123133461 abstract_inverted_index | 1 | abstract only | none |
| 2:13 | 2026-11-14 | 其他 (author homepage) | davidhbailey.com/dhbpapers/ index; backtest-pseudo.pdf, backtest-prob.pdf, deflated-sharpe.pdf | 3 | full text (author copies, titles confirmed on p.1) | none |
| 2:14 | 2026-11-14 | OpenAlex | title.search: Pseudo-Mathematics..., The Probability of Backtest Overfitting, The Deflated Sharpe Ratio..., T… | 2,3,2,1 | metadata only | none (key used) |
| 2:15 | 2026-11-14 | OpenAlex | works/{id} open_access and locations for 5 works | 5 | metadata only | none (key used) |
| 2:16 | 2026-11-14 | Crossref | works/{doi} for 4 DOIs (title, container, volume, pages) | 4 | metadata | contact address sent to Crossref only; no abstracts returned |
| 2:17 | 2026-11-14 | Semantic Scholar | paper/batch DOI x4 (title,year,venue,externalIds,openAccessPdf) | 3 | metadata only | key used; JCF DOI not indexed by S2 |
| 2:18 | 2026-11-14 | 其他 (publisher/repository probe) | escholarship.org/uc/item/4w1110bb (PBO OA copy from OpenAlex) | 0 | none | HTTP 202 text/html challenge-like response; not pursued |
| 2:19 | 2026-11-14 | 其他 (SSRN) | papers.ssrn.com abstract_id=2460551 (DSR SSRN copy) and 3104816 (10 Reasons) | 0 | none | HTTP 403; skill forbids scraping SSRN; not pursued |
| 2:20 | 2026-11-14 | 其他 (WebSearch) | "The 10 Reasons Most Machine Learning Funds Fail" Lopez de Prado pdf | 10 | result list only | third-party mirror (smallake.kr) excluded; GARP white-paper page reviewed, PDF rights not established, not do… |
| 2:21 | 2026-11-14 | 其他 (GARP landing page) | garp.org/white-paper/the-10-reasons-most-machine-learning-funds-fail (HTML read) | 1 | landing page only | offers PDF link; not downloaded (not an author, publisher or institution copy per brief) |
| 2:22 | 2026-11-14 | 其他 (arXiv) | arxiv.org/abs/2305.08384 (unrelated probe, no use) | 0 | none | none; not a source for this task |
| 3:1 | 2026-11-14 | OpenAlex | title.search: A Reality Check for Data Snooping | 4 | metadata only | key |
| 3:2 | 2026-11-14 | OpenAlex | title.search: A Test for Superior Predictive Ability | 12 | metadata only | key |
| 3:3 | 2026-11-14 | OpenAlex | title.search: Data-Snooping, Technical Trading Rule Performance, and the Bootstrap | 2 | metadata only | key |
| 3:4 | 2026-11-14 | OpenAlex | title.search: Technical trading revisited: False discoveries, persistence tests, and transaction costs | 2 | metadata only | key |
| 3:5 | 2026-11-14 | OpenAlex | title.search: All That Glitters Is Not Gold: Comparing Backtest and Out-of-Sample Performance on a Large Coho… | 1 | metadata only | key |
| 3:6 | 2026-11-14 | OpenAlex | title.search: Data Snooping Technical Trading Rule Performance Bootstrap | 16 | metadata only | key |
| 3:7 | 2026-11-14 | OpenAlex | doi batch: 10.1111/1468-0262.00152\|10.1198/073500105000000063\|10.1111/0022-1082.00163\|10.1016/j.jfineco.20… | 5 | metadata + OA location fields | key |
| 3:8 | 2026-11-14 | OpenAlex | title.search: Glitters Gold backtest Out-of-Sample (re-check of Wiecki) | 1 | metadata only | key |
| 3:9 | 2026-11-14 | OpenAlex | works/doi:10.3905/joi.2016.25.3.069 abstract_inverted_index | 1 | metadata; abstract elided by publisher | key |
| 3:10 | 2026-11-14 | OpenAlex | works/doi:10.1198/073500105000000063 (abstract) | 1 | abstract read | key |
| 3:11 | 2026-11-14 | Crossref | works/10.2139/ssrn.2745220 and works/10.3905/joi.2016.25.3.069 (abstract) | 2 | metadata; no abstract | no key (polite mailto not sent) |
| 3:12 | 2026-11-14 | Semantic Scholar | graph/v1/paper/DOI:{Hansen2005,White2000,Wiecki2016,Bajgrowicz2012}?fields=openAccessPdf,externalIds,abstract… | 4 | metadata; tldr (auto summary) for Wiecki only | no key |
| 3:13 | 2026-11-14 | 其他 (arxiv) | export.arxiv.org api search_query ti:"All That Glitters Is Not Gold" | 0 | none | no key |
| 3:14 | 2026-11-14 | 其他 (web) | "A Test for Superior Predictive Ability" Hansen 2005 pdf author copy | 10 | search snippets only | none |
| 3:15 | 2026-11-14 | 其他 (web) | White 2000 "A Reality Check for Data Snooping" Econometrica pdf | 10 | search snippets only; one copy fetched (see fetch rows) | none |
| 3:16 | 2026-11-14 | 其他 (web) | Wiecki Campbell Lent Stauth "All That Glitters Is Not Gold" pdf arXiv OR Quantopian | 18 | search snippets only; no relevant hit | none |
| 3:17 | 2026-11-14 | 其他 (web) | Bajgrowicz Scaillet "Technical trading revisited" pdf author HEC Geneva | 10 | search snippets; Geneva record fetched | none |
| 3:18 | 2026-11-14 | 其他 (web) | "888" trading algorithms backtest out-of-sample Sharpe correlation Quantopian Wiecki paper | 11 | snippets only; secondary summaries (CXO Advisory, Quantpedia, hedgefundalpha) not used as paper facts | none |
| 3:19 | 2026-11-14 | 其他 (fetch) | users.ssc.wisc.edu/~bhansen/718/White2000.pdf (course-page copy of White 2000) | 1 | full text (pages 1097-1126 in header) | none |
| 3:20 | 2026-11-14 | 其他 (fetch) | eprints.lse.ac.uk/119144/1/dp303.pdf (LSE Financial Markets Group DP 303, Oct 1998; Sullivan Timmermann White) | 1 | full text of 1998 discussion paper, not the JF 1999 print version | none |
| 3:21 | 2026-11-14 | 其他 (fetch) | archive-ouverte.unige.ch/unige:79889 -> access.archive-ouverte.unige.ch metadata download (Bajgrowicz-Scaille… | 1 | full text (author accepted manuscript) | none |
| 3:22 | 2026-11-14 | 其他 (fetch) | unige:79889 record page (citation_pdf_url meta) | 1 | metadata | none |
| 3:23 | 2026-11-14 | 其他 (skipped) | not fetched: SSRN 1095202, SSRN 2745220, typeset.io, zendy.io, mql5 PDF, scribd, bashtage course copy, cdr.li… | 0 | none | none |
| 4:1 | 2026-11-14 | OpenAlex | doi:10.48550/arxiv.2504.14765 | 1 | record only | no key; HTTP 200 |
| 4:2 | 2026-11-14 | OpenAlex | doi:10.48550/arxiv.2512.23847 | 1 | record only | no key; HTTP 200 |
| 4:3 | 2026-11-14 | OpenAlex | doi:10.48550/arxiv.2309.17322 | 1 | record only | no key; HTTP 200 |
| 4:4 | 2026-11-14 | OpenAlex | doi:10.48550/arxiv.2502.21206 | 1 | record only | no key; HTTP 200 |
| 4:5 | 2026-11-14 | OpenAlex | doi:10.48550/arxiv.2505.15155 | 1 | record only | no key; HTTP 200 |
| 4:6 | 2026-11-14 | OpenAlex | (memorization OR memorize OR lookahead OR "look-ahead") AND ("large language model" OR LLM) AND (forecast OR … | 117 | record only (titles) | no key; HTTP 200 |
| 4:7 | 2026-11-14 | OpenAlex | ("look-ahead bias" OR "lookahead bias" OR "training leakage" OR "data contamination") AND ("language model" O… |  | record only (titles) | no key; HTTP 429 |
| 4:8 | 2026-11-14 | OpenAlex | title.search: R&D-Agent | 146 | record only (titles) | no key; HTTP 200 |
| 4:9 | 2026-11-14 | OpenAlex | ("look-ahead bias" OR "training leakage") AND ("language model" OR LLM) AND (trading OR finance) | 42 | record only (titles) | no key; HTTP 200 |
| 4:10 | 2026-11-14 | OpenAlex | title.search: Chronologically Consistent Large Language Models | 3 | record only (titles) | no key; HTTP 200 |
| 4:11 | 2026-11-14 | Crossref | The Memorization Problem: Can We Trust LLMs Economic Forecasts | 10 | record only (titles) | no key; HTTP 200 |
| 4:12 | 2026-11-14 | Crossref | Assessing Look-Ahead Bias in Stock Return Predictions Generated by GPT Sentiment Analysis | 10 | record only (titles) | no key; HTTP 200 |
| 4:13 | 2026-11-14 | Crossref | look-ahead bias large language model backtest stock returns | 10 | record only (titles) | no key; HTTP 200 |
| 4:14 | 2026-11-14 | Semantic Scholar | memorization large language model economic forecasts pre-cutoff | 0 | record only (titles) | no key; HTTP 429 |
| 4:15 | 2026-11-14 | Semantic Scholar | R&D-Agent-Quant multi-agent factor model joint optimization | 0 | record only (titles) | no key; HTTP 429 |
| 4:16 | 2026-11-14 | 其他 (figshare) | author search: Christopher Helm | 72 | record only (titles) | no key (public API) |
| 4:17 | 2026-11-14 | 其他 (figshare) | series titles: What Did Not Work; From Pre-Announcement to Verified Facts | 0 | record only (titles) | no key (public API); 0 matches for both titles |
| 4:18 | 2026-11-14 | 其他 (arXiv API) | id_list=2504.14765 | 1 | record only (title); full text downloaded from arxiv.org/pdf | none |
| 4:19 | 2026-11-14 | 其他 (arXiv API) | id_list=2512.23847 | 1 | record only (title); full text downloaded from arxiv.org/pdf | none |
| 4:20 | 2026-11-14 | 其他 (arXiv API) | id_list=2309.17322 | 1 | record only (title); full text downloaded from arxiv.org/pdf | none |
| 4:21 | 2026-11-14 | 其他 (arXiv API) | id_list=2502.21206 | 1 | record only (title); full text downloaded from arxiv.org/pdf | none |
| 4:22 | 2026-11-14 | 其他 (arXiv API) | id_list=2505.15155 | 1 | record only (title); full text downloaded from arxiv.org/pdf | none |
| 4:23 | 2026-11-14 | Semantic Scholar | memorization large language model economic forecasts pre-cutoff | 0 | record only (titles) | no key; HTTP 429 |
| 5:1 | 2026-11-14 | OpenAlex | ("funding rate" OR "funding rates") AND (perpetual OR cryptocurrency OR bitcoin) | 88 | record only |  |
| 5:2 | 2026-11-14 | Crossref | perpetual futures funding rate crypto | 732408 | record only |  |
| 5:3 | 2026-11-14 | Semantic Scholar | perpetual futures funding rate arbitrage | 70 | record only |  |
| 5:4 | 2026-11-14 | OpenAlex | "perpetual futures" AND (pricing OR basis OR arbitrage) | 170 | record only |  |
| 5:5 | 2026-11-14 | OpenAlex | (carry OR "cash-and-carry" OR "basis trade") AND (bitcoin OR cryptocurrency) AND (futures OR swap) | 104 | record only |  |
| 5:6 | 2026-11-14 | OpenAlex | "perpetual swap" AND (funding OR basis OR predictab*) |  | record only | error http 400 |
| 5:7 | 2026-11-14 | Crossref | perpetual swap basis bitcoin | 258663 | record only |  |
| 5:8 | 2026-11-14 | Crossref | funding carry cryptocurrency futures arbitrage returns | 208145 | record only |  |
| 5:9 | 2026-11-14 | Crossref | perpetual futures pricing no-arbitrage | 79765 | record only |  |
| 5:10 | 2026-11-14 | Semantic Scholar | funding rate predictability bitcoin perpetual | 9 | record only |  |
| 5:11 | 2026-11-14 | Semantic Scholar | crypto carry trade futures basis | 139 | record only |  |
| 5:12 | 2026-11-14 | Semantic Scholar | perpetual swap basis cryptocurrency | 18 | record only |  |
| 5:13 | 2026-11-14 | OpenAlex | (liquidation OR liquidations) AND (cascade OR cascades) AND (crypto* OR bitcoin OR perpetual) |  | record only | error http 400 |
| 5:14 | 2026-11-14 | OpenAlex | "forced liquidation" AND (leverage OR margin) AND (bitcoin OR cryptocurrency OR crypto) | 11 | record only |  |
| 5:15 | 2026-11-14 | OpenAlex | "margin call" AND (cryptocurrency OR bitcoin) AND (derivatives OR futures) | 3 | record only |  |
| 5:16 | 2026-11-14 | Crossref | liquidation cascade crypto perpetual futures leverage price impact | 2364074 | record only |  |
| 5:17 | 2026-11-14 | Crossref | forced liquidations leverage cryptocurrency market crash | 592293 | record only |  |
| 5:18 | 2026-11-14 | Crossref | auto-deleveraging insurance fund crypto exchange | 733077 | record only |  |
| 5:19 | 2026-11-14 | Semantic Scholar | liquidation cascades leveraged crypto derivatives | 7 | record only |  |
| 5:20 | 2026-11-14 | Semantic Scholar | forced liquidation margin call bitcoin futures | 30 | record only |  |
| 5:21 | 2026-11-14 | Semantic Scholar | backtest ignoring liquidation leveraged crypto trading | 9 | record only |  |
| 5:22 | 2026-11-14 | OpenAlex | ("wash trading" OR "fake volume" OR "inflated volume") AND (cryptocurrency OR bitcoin OR crypto) | 70 | record only |  |
| 5:23 | 2026-11-14 | OpenAlex | "survivorship bias" AND (cryptocurrency OR crypto OR bitcoin) | 16 | record only |  |
| 5:24 | 2026-11-14 | OpenAlex | (data AND (gaps OR revisions OR discrepancies OR quality)) AND (cryptocurrency AND exchanges) | 288 | record only |  |
| 5:25 | 2026-11-14 | Crossref | wash trading cryptocurrency exchanges | 112616 | record only |  |
| 5:26 | 2026-11-14 | Crossref | fake trading volume bitcoin exchanges unregulated | 1869143 | record only |  |
| 5:27 | 2026-11-14 | Crossref | survivorship bias cryptocurrency data | 3218628 | record only |  |
| 5:28 | 2026-11-14 | Semantic Scholar | wash trading crypto exchanges | 672 | record only |  |
| 5:29 | 2026-11-14 | Semantic Scholar | cryptocurrency data quality exchange price discrepancies historical data | 294 | record only |  |
| 5:30 | 2026-11-14 | Semantic Scholar | survivorship bias cryptocurrency delisted coins backtest | 2 | record only |  |
| 5:31 | 2026-11-14 | OpenAlex | ("technical trading rules" OR "technical analysis" OR "trading rules") AND (bitcoin OR cryptocurrency OR cryp… | 8 | record only |  |
| 5:32 | 2026-11-14 | OpenAlex | ("trend following" OR "moving average" OR breakout OR momentum) AND (bitcoin OR cryptocurrency) AND ("out-of-… | 99 | record only |  |
| 5:33 | 2026-11-14 | OpenAlex | "Dow theory" AND (bitcoin OR cryptocurrency OR crypto OR stock) | 67 | record only |  |
| 5:34 | 2026-11-14 | Crossref | technical trading rules bitcoin data snooping reality check | 4297305 | record only |  |
| 5:35 | 2026-11-14 | Crossref | profitability of technical analysis cryptocurrency out-of-sample transaction costs | 7973897 | record only |  |
| 5:36 | 2026-11-14 | Crossref | trend following cryptocurrency out-of-sample | 1164484 | record only |  |
| 5:37 | 2026-11-14 | Semantic Scholar | reality check bitcoin trading rules data snooping | 69 | record only |  |
| 5:38 | 2026-11-14 | Semantic Scholar | technical trading rules cryptocurrency false discovery rate | 86 | record only |  |
| 5:39 | 2026-11-14 | Semantic Scholar | crypto trend following momentum out-of-sample Sharpe | 4 | record only |  |
| 5:40 | 2026-11-14 | OpenAlex | (liquidation OR liquidations) AND (cascade OR cascades) AND (crypto OR cryptocurrency OR bitcoin OR perpetual) | 43 | record only |  |
| 5:41 | 2026-11-14 | OpenAlex | "auto-deleveraging" OR "insurance fund" OR "forced liquidations" AND (perpetual OR bitcoin OR crypto) | 20 | record only |  |
| 5:42 | 2026-11-14 | OpenAlex | "perpetual swap" AND (funding OR basis OR predictability) | 16 | record only |  |
| 5:43 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | 10.1111/mafi.70018 / arXiv 2310.11771v2 | 1 | full text (arXiv) |  |
| 5:44 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | arXiv 2212.06888v7 | 1 | full text (arXiv) |  |
| 5:45 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | arXiv 2102.04591v1 | 1 | full text (arXiv) |  |
| 5:46 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | arXiv 2108.10984 (Jul 2021 draft) | 1 | full text (arXiv) |  |
| 5:47 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | 10.1287/mnsc.2021.01448 | 1 | full text (DCU repository) |  |
| 5:48 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | 10.2139/ssrn.4287573 | 1 | full text (Univ. St. Gallen repository) |  |
| 5:49 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | 10.1007/s10479-019-03357-1 | 1 | full text (Reading CentAUR, CC-BY) |  |
| 5:50 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup + OA pdf_url) | 10.2139/ssrn.4401552 | 1 | full text (Ghent University repository preprint) |  |
| 5:51 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup) | 10.1016/j.irfa.2026.105464 | 1 | abstract only (OpenAlex/Semantic Scholar abstract field) | full text not retrieved: paywalled/SSRN not scraped |
| 5:52 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup) | 10.2139/ssrn.6579278 | 1 | abstract only (OpenAlex/Semantic Scholar abstract field) | full text not retrieved: paywalled/SSRN not scraped |
| 5:53 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup) | 10.1016/j.ejor.2022.07.037 | 1 | abstract only (OpenAlex/Semantic Scholar abstract field) | full text not retrieved: paywalled/SSRN not scraped |
| 5:54 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup) | 10.1016/j.irfa.2022.102061 | 1 | abstract only (OpenAlex/Semantic Scholar abstract field) | full text not retrieved: paywalled/SSRN not scraped |
| 5:55 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup) | 10.1016/j.intfin.2022.101601 | 1 | abstract only (OpenAlex/Semantic Scholar abstract field) | full text not retrieved: paywalled/SSRN not scraped |
| 5:56 | 2026-11-14 | OpenAlex (OpenAlex DOI lookup) | 10.1016/j.frl.2020.101655 | 1 | abstract only (OpenAlex/Semantic Scholar abstract field) | full text not retrieved: paywalled/SSRN not scraped |
| 5:57 | 2026-11-14 | Semantic Scholar (SemanticScholar DOI lookup) | 10.1016/j.frl.2020.101655 (and two others) | 3 | abstract only |  |
| 5:58 | 2026-11-14 | 其他 (direct download) | sussex figshare/sro PDF for 10.1016/j.ejor.2022.07.037 | 1 | none | HTTP 202 empty body (bot challenge); not worked around |
| 5:59 | 2026-11-14 | 其他 (direct download) | binance.com support FAQ 360033525031 and 360033525271 via curl | 2 | none | HTTP 202 empty body (bot challenge); not worked around; read via WebFetch instead |
| 5:60 | 2026-11-14 | 其他 (WebSearch) | Binance USDⓈ-M futures leverage and margin maintenance margin rate tiers notional value support faq | 9 | titles/URLs only |  |
| 5:61 | 2026-11-14 | 其他 (WebFetch (binance.com official)) | https://www.binance.com/en/support/faq/360033525031 | 1 | page read through WebFetch summarizer (not verbatim) |  |
| 5:62 | 2026-11-14 | 其他 (WebFetch (binance.com official)) | https://www.binance.com/en/support/faq/360033525271 | 1 | page read through WebFetch summarizer (not verbatim) |  |
| 5:63 | 2026-11-14 | 其他 (WebFetch (binance.com official)) | https://www.binance.com/en/support/faq/leverage-and-margin-of-usd%E2%93%A2-m-futures-360033162192 | 1 | page read through WebFetch summarizer (not verbatim) |  |
| 5:64 | 2026-11-14 | 其他 (WebFetch (binance.com official)) | https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Notional-and-Leverage-… | 1 | page read through WebFetch summarizer (not verbatim) | developers page truncated |
| 6:1 | 2026-11-14 | 其他 (author-page-harvey) | GET https://people.duke.edu/~charvey/ |  | metadata | http 200 curl_rc 0 type text/html |
| 6:2 | 2026-11-14 | 其他 (author-page-harvey) | GET https://people.duke.edu/~charvey/Research.htm |  | metadata | http 200 curl_rc 0 type text/html |
| 6:3 | 2026-11-14 | 其他 (author-page-harvey) | GET https://people.duke.edu/~charvey/Published_Papers.htm |  | metadata | http 404 curl_rc 0 type text/html |
| 6:4 | 2026-11-14 | 其他 (author-page-ra) | GET https://www.researchaffiliates.com/en_us/publications/articles/700_a_backtesting_protocol_in_the_era_of_m… |  | metadata | http 404 curl_rc 0 type text/html |
| 6:5 | 2026-11-14 | 其他 (publisher-pm) | GET https://pm-research.com/content/iijjfds/1/1/64 |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:6 | 2026-11-14 | 其他 (publisher-pm) | GET https://doi.org/10.3905/jfds.2019.1.064 |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:7 | 2026-11-14 | 其他 (author-page-lopez) | GET https://www.quantresearch.org/ |  | metadata | http 200 curl_rc 0 type text/html |
| 6:8 | 2026-11-14 | 其他 (author-page-lopez) | GET https://www.quantresearch.org/Papers.htm |  | metadata | http 404 curl_rc 0 type text/html |
| 6:9 | 2026-11-14 | 其他 (publisher-jpm) | GET https://doi.org/10.3905/jpm.2018.44.6.120 |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:10 | 2026-11-14 | 其他 (author-page-wiecki) | GET https://twiecki.io/ |  | metadata | http 200 curl_rc 0 type text/html |
| 6:11 | 2026-11-14 | 其他 (author-page-wiecki) | GET https://twiecki.io/blog/2016/07/02/all-that-glitters/ |  | metadata | http 404 curl_rc 0 type text/html |
| 6:12 | 2026-11-14 | 其他 (publisher-joi) | GET https://doi.org/10.3905/joi.2016.25.3.069 |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:13 | 2026-11-14 | 其他 (author-page-hansen) | GET https://www.econ.brown.edu/fac/peter_hansen/ |  | metadata | http 000 curl_rc 6 type cannot open `fulltext/retry6/hansen-brown.html' (No such file or directory) |
| 6:14 | 2026-11-14 | 其他 (author-page-hansen) | GET https://www.unc.edu/~phansen/ |  | metadata | http 404 curl_rc 0 type text/html |
| 6:15 | 2026-11-14 | 其他 (publisher-jbes) | GET https://doi.org/10.1198/073500105000000063 |  | metadata | http 403 curl_rc 0 type text/html |
| 6:16 | 2026-11-14 | 其他 (author-pdf-harvey) | GET https://people.duke.edu/~charvey/Research/Published_Papers/P138_A_backtesting_protocol.pdf |  | full-text-candidate | http 200 curl_rc 0 type application/pdf |
| 6:17 | 2026-11-14 | 其他 (author-page-lopez) | GET https://www.quantresearch.org/LeftFrame.htm |  | metadata | http 200 curl_rc 0 type text/html |
| 6:18 | 2026-11-14 | 其他 (author-page-lopez) | GET https://www.quantresearch.org/Intro.htm |  | metadata | http 200 curl_rc 0 type text/html |
| 6:19 | 2026-11-14 | 其他 (author-page-wiecki) | GET https://twiecki.io/blog.html |  | metadata | http 200 curl_rc 0 type text/html |
| 6:20 | 2026-11-14 | 其他 (repec-jbes) | GET https://ideas.repec.org/a/bes/jnlbes/v23y2005i4p365-380.html |  | metadata | http 404 curl_rc 0 type text/html |
| 6:21 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijjfds/1/1/64 |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:22 | 2026-11-14 | 其他 (publisher-jpm) | GET https://www.pm-research.com/content/iijpormgmt/44/6/108 |  | metadata | http 404 curl_rc 0 type text/xml |
| 6:23 | 2026-11-14 | 其他 (publisher-joi) | GET https://jai.pm-research.com/content/25/3/69 |  | metadata | http 404 curl_rc 0 type text/html |
| 6:24 | 2026-11-14 | 其他 (publisher-jbes) | GET https://www.tandfonline.com/doi/abs/10.1198/073500105000000063 |  | metadata | http 403 curl_rc 0 type text/html |
| 6:25 | 2026-11-14 | 其他 (publisher-jbes) | GET https://www.jstor.org/stable/27638817 |  | metadata | http 200 curl_rc 0 type text/html |
| 6:26 | 2026-11-14 | 其他 (metadata) | https://www.quantresearch.org/Publications.htm s |  | metadata | http 200 curl_rc 0 type text/html |
| 6:27 | 2026-11-14 | 其他 (metadata) | https://www.quantresearch.org/Lectures.htm s |  | metadata | http 200 curl_rc 0 type text/html |
| 6:28 | 2026-11-14 | 其他 (metadata) | https://www.quantresearch.org/Innovations.htm s |  | metadata | http 200 curl_rc 0 type text/html |
| 6:29 | 2026-11-14 | 其他 (metadata) | https://www.orie.cornell.edu/faculty-directory/marcos-lopez-de-prado s |  | metadata | http 200 curl_rc 0 type text/html |
| 6:30 | 2026-11-14 | 其他 (metadata) | https://www.lopezdeprado.org s |  | metadata | http 200 curl_rc 0 type text/html |
| 6:31 | 2026-11-14 | 其他 (metadata) | https://www.pm-research.com/content/iijjfds/1/1/64 s |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:32 | 2026-11-14 | 其他 (metadata) | https://doi.org/10.3905/jpm.2018.44.6.120 s |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:33 | 2026-11-14 | Crossref (metadata) | https://api.crossref.org/works/10.3905/jpm.2018.44.6.120 s |  | metadata | http 200 curl_rc 0 type application/json |
| 6:34 | 2026-11-14 | 其他 (metadata) | https://www.pm-research.com/content/iijpormgmt/44/6/120 s |  | metadata | http 429 curl_rc 0 type text/plain |
| 6:35 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijpormgmt/44/6/120 |  | metadata | http 429 type text/plain |
| 6:36 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijpormgmt/44/6/120 |  | metadata | http 429 type text/plain |
| 6:37 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijjfds/1/1/64 |  | metadata | http 429 type text/plain |
| 6:38 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijjfds/1/1/64 |  | metadata | http 429 type text/plain |
| 6:39 | 2026-11-14 | OpenAlex | works/doi:10.3905/joi.2016.25.3.069 (locations for author/repository copies only) |  | metadata | no key; http 200 |
| 6:40 | 2026-11-14 | OpenAlex | works/doi:10.3905/jpm.2018.44.6.120 (locations for author/repository copies only) |  | metadata | no key; http 200 |
| 6:41 | 2026-11-14 | OpenAlex | works/doi:10.1198/073500105000000063 (locations for author/repository copies only) |  | metadata | no key; http 200 |
| 6:42 | 2026-11-14 | OpenAlex | works/doi:10.3905/jfds.2019.1.064 (locations for author/repository copies only) |  | metadata | no key; http 200 |
| 6:43 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijpormgmt/44/6/120.full.pdf |  | metadata | http 403 type text/xml |
| 6:44 | 2026-11-14 | 其他 (publisher-pm) | GET https://www.pm-research.com/content/iijpormgmt/44/6/120.full.pdf |  | metadata | http 403 type text/xml |
| 6:45 | 2026-11-14 | 其他 (institutional-repo-unc) | GET https://cdr.lib.unc.edu/downloads/zp38wf793 |  | full-text-candidate | http 000 curl_rc 28 type cannot open `hansen2005-unc-cdr.pdf' (No such file or directory) |
| 6:46 | 2026-11-14 | 其他 (institutional-repo-unc) | GET https://cdr.lib.unc.edu/record/uuid:6efab9da-0a4d-4783-b498-0017a9edcdac |  | metadata | http 000 curl_rc 28 type cannot open `hansen2005-unc-record.html' (No such file or directory) |
| 6:47 | 2026-11-14 | 其他 (author-page-quantopian) | GET https://www.quantopian.com/ |  | metadata | http 000 curl_rc 28 type cannot open `quantopian-home.html' (No such file or directory) |
| 6:48 | 2026-11-14 | 其他 (author-page-wiecki) | GET https://twiecki.io/blog/2016/07/05/ |  | metadata | http 404 curl_rc 0 type text/html |
| 6:49 | 2026-11-14 | 其他 (institutional-repo-unc) | GET https://cdr.lib.unc.edu/downloads/zp38wf793 |  | full-text-candidate | http 000 type cannot open `hansen2005-unc-cdr.pdf' (No such file or directory) |
| 6:50 | 2026-11-14 | 其他 (institutional-repo-unc) | GET https://cdr.lib.unc.edu/downloads/zp38wf793 |  | full-text-candidate | http 000 type cannot open `hansen2005-unc-cdr.pdf' (No such file or directory) |
| 6:51 | 2026-11-14 | 其他 (author-page-hansen) | GET https://www.econ.brown.edu/fac/peter_hansen/ |  | metadata | http 000 |
| 6:52 | 2026-11-14 | 其他 (author-page-hansen) | GET https://www.econ.brown.edu/ |  | metadata | http 000 |
| 6:53 | 2026-11-14 | 其他 (author-or-repository-probe) | GET https://doi.org/10.17615/wehz-da64 |  | metadata | http 302 curl_rc 28 |
| 6:54 | 2026-11-14 | 其他 (author-or-repository-probe) | GET https://phansen.web.unc.edu/ |  | metadata | http 200 curl_rc 0 |
| 6:55 | 2026-11-14 | 其他 (author-or-repository-probe) | GET https://ideas.repec.org/f/pha56.html |  | metadata | http 404 curl_rc 0 |
| 6:56 | 2026-11-14 | 其他 (author-or-repository-probe) | GET https://ideas.repec.org/a/bes/jnlbes/v23y2005i4p365-380.html |  | metadata | http 404 curl_rc 0 |
| 6:57 | 2026-11-14 | 其他 (author-or-repository-probe) | GET https://www.quantopian.com/ |  | metadata | http 000 curl_rc 28 |
| 6:58 | 2026-11-14 | 其他 (author-page-hansen) | GET https://phansen.web.unc.edu/ |  | metadata | 1st probe (-o /dev/null) http 200; 2nd fetch http 403 bot-check interstitial ("Checking connection"), not wor… |
| 6:59 | 2026-11-14 | 其他 (author-page-hansen) | GET https://phansen.web.unc.edu/ (2nd fetch to file) |  | metadata | http 403 bot-check interstitial |
| 6:60 | 2026-11-14 | 其他 (web-search) | Hansen "A Test for Superior Predictive Ability" working paper pdf * | 10 | metadata | no key needed; third-party hits (typeset.io, zendy, scribd) excluded |
| 6:61 | 2026-11-14 | 其他 (web-search) | Wiecki Campbell Lent Stauth "All That Glitters Is Not Gold" pdf * | 10 | metadata | no author/publisher copy in results; spam PDFs excluded |
| 6:62 | 2026-11-14 | 其他 (web-search) | Lopez de Prado "The 10 Reasons Most Machine Learning Funds Fail" pdf author * | 10 | metadata | GARP, scribd, aitopics hits are third-party; excluded |
| 6:63 | 2026-11-14 | 其他 (institution-or-author-copy) | GET https://chico.pstc.brown.edu/~phansen/Papers/spa.pdf |  | metadata | http 000 curl_rc 6 |
| 6:64 | 2026-11-14 | 其他 (institution-or-author-copy) | GET https://cdr.lib.unc.edu/concern/articles/hd76s214m?locale=en |  | metadata | http 000 curl_rc 28 |
| facetcheck-III:1 | 2026-11-14 | OpenAlex | doi 10.2139/ssrn.7353678 (A Real Edge that Loses) |  | (无此字段) | curl_exit=0 bytes=11988 key=none |
| facetcheck-III:2 | 2026-11-14 | OpenAlex | doi 10.2139/ssrn.7424681 (Measuring Backtest-Live Fidelity) |  | (无此字段) | curl_exit=0 bytes=15916 key=none |
| facetcheck-III:3 | 2026-11-14 | OpenAlex | (out-of-sample\|holdout) AND (trading strategies\|backtest) AND (live\|paper trading) |  | (无此字段) | curl_exit=0 bytes=18405 key=none |
| facetcheck-III:4 | 2026-11-14 | OpenAlex | "sample size" AND "sharpe ratio" AND "track record" * |  | (无此字段) | curl_exit=0 bytes=3502 key=none |
| facetcheck-IV:1 | 2026-11-14 | 其他 (vendor-docs) | https://platform.claude.com/docs/en/about-claude/models/overview (via docs.claude.com 302) | 1 | full page via WebFetch summary-free markdown | none |
| facetcheck-IV:2 | 2026-11-14 | 其他 (vendor-docs) | https://developers.openai.com/api/docs/models (via platform.openai.com 301) | 1 | WebFetch answer listing flagship knowledge cutoffs (model-summarised, not raw page) | none |
| facetcheck-IV:3 | 2026-11-14 | 其他 (vendor-docs) | https://ai.google.dev/gemini-api/docs/models | 0 | redirect to aistudio.google.com not followed | not read |
| facetcheck-IV:4 | 2026-11-14 | 其他 (sec/lii) | https://www.law.cornell.edu/cfr/text/17/275.206(4)-1 (17 CFR 275.206(4)-1; ecfr.gov redirected to a block pag… | 1 | WebFetch model-summarised answer with paragraph numbers; not raw text | none |
| facetcheck-IV:5 | 2026-11-14 | 其他 (fed) | https://www.federalreserve.gov/supervisionreg/srletters/SR2602a1.pdf | 1 | PDF downloaded, pdftotext -> phaseA/fulltext/sr26-2a1.txt, read relevant sections directly | none |
| facetcheck-IV:6 | 2026-11-14 | 其他 (fed) | https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm | 1 | WebFetch summary | none |
| facets-1-7:1 面1 | 2026-11-14T07:06:43Z | OpenAlex | look ahead bias backtest point-in-time data | 12 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:2 面1 | 2026-11-14T07:06:45Z | Crossref | look ahead bias backtest point-in-time data | 5461482 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:3 面1 | 2026-11-14T07:07:09Z | Semantic Scholar | look ahead bias backtest point-in-time data | 46 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:4 面1 | 2026-11-14T07:07:09Z | OpenAlex | survivorship bias delisted coins backtest | 0 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:5 面1 | 2026-11-14T07:07:10Z | Crossref | survivorship bias delisted coins backtest | 153317 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:6 面1 | 2026-11-14T07:08:19Z | Semantic Scholar | survivorship bias delisted coins backtest | 0 | result list only (title, year, venue, citations, DOI) | key; HTTP 429 after back-offs |
| facets-1-7:7 面1 | 2026-11-14T07:08:20Z | OpenAlex | data revision vintage historical data backtest bias | 0 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:8 面1 | 2026-11-14T07:08:21Z | Crossref | data revision vintage historical data backtest bias | 4060569 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:9 面1 | 2026-11-14T07:08:30Z | Semantic Scholar | data revision vintage historical data backtest bias | 209 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:10 面2 | 2026-11-14T07:08:31Z | OpenAlex | Sharpe ratio standard error sample length | 6 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:11 面2 | 2026-11-14T07:08:33Z | Crossref | Sharpe ratio standard error sample length | 1224940 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:12 面2 | 2026-11-14T07:08:37Z | Semantic Scholar | Sharpe ratio standard error sample length | 19152 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:13 面2 | 2026-11-14T07:08:37Z | OpenAlex | minimum track record length Sharpe ratio | 6 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:14 面2 | 2026-11-14T07:08:39Z | Crossref | minimum track record length Sharpe ratio | 1003616 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:15 面2 | 2026-11-14T07:08:43Z | Semantic Scholar | minimum track record length Sharpe ratio | 2402 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:16 面2 | 2026-11-14T07:08:44Z | OpenAlex | statistical power trading strategy effect size | 154 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:17 面2 | 2026-11-14T07:08:45Z | Crossref | statistical power trading strategy effect size | 6547662 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:18 面2 | 2026-11-14T07:08:49Z | Semantic Scholar | statistical power trading strategy effect size | 39568 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:19 面3 | 2026-11-14T07:08:49Z | OpenAlex | backtest execution assumptions bar-based bias | 0 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:20 面3 | 2026-11-14T07:08:51Z | Crossref | backtest execution assumptions bar-based bias | 7031802 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:21 面3 | 2026-11-14T07:09:00Z | Semantic Scholar | backtest execution assumptions bar-based bias | 251 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:22 面3 | 2026-11-14T07:09:01Z | OpenAlex | slippage model market impact backtest | 12 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:23 面3 | 2026-11-14T07:09:04Z | Crossref | slippage model market impact backtest | 5416655 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:24 面3 | 2026-11-14T07:09:28Z | Semantic Scholar | slippage model market impact backtest | 223 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:25 面3 | 2026-11-14T07:09:29Z | OpenAlex | transaction costs anomaly profitability net of costs | 17 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:26 面3 | 2026-11-14T07:09:30Z | Crossref | transaction costs anomaly profitability net of costs | 429791 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:27 面3 | 2026-11-14T07:10:39Z | Semantic Scholar | transaction costs anomaly profitability net of costs | 273 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:28 面4 | 2026-11-14T07:10:40Z | OpenAlex | multiple testing correction trading strategies | 186 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:29 面4 | 2026-11-14T07:10:42Z | Crossref | multiple testing correction trading strategies | 2659607 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:30 面4 | 2026-11-14T07:11:06Z | Semantic Scholar | multiple testing correction trading strategies | 4580 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:31 面4 | 2026-11-14T07:11:06Z | OpenAlex | p-hacking backtest overfitting data snooping | 1 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:32 面4 | 2026-11-14T07:11:08Z | Crossref | p-hacking backtest overfitting data snooping | 3081349 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:33 面4 | 2026-11-14T07:11:11Z | Semantic Scholar | p-hacking backtest overfitting data snooping | 29 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:34 面4 | 2026-11-14T07:11:11Z | OpenAlex | researcher degrees of freedom forking paths | 19 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:35 面4 | 2026-11-14T07:11:14Z | Crossref | researcher degrees of freedom forking paths | 270048 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:36 面4 | 2026-11-14T07:11:17Z | Semantic Scholar | researcher degrees of freedom forking paths | 1653 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:37 面5 | 2026-11-14T07:11:18Z | OpenAlex | adaptive data analysis reusable holdout | 7 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:38 面5 | 2026-11-14T07:11:19Z | Crossref | adaptive data analysis reusable holdout | 9816487 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:39 面5 | 2026-11-14T07:12:28Z | Semantic Scholar | adaptive data analysis reusable holdout | 0 | result list only (title, year, venue, citations, DOI) | key; HTTP 429 after back-offs |
| facets-1-7:40 面5 | 2026-11-14T07:12:29Z | OpenAlex | out-of-sample decay anomalies publication | 19 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:41 面5 | 2026-11-14T07:12:31Z | Crossref | out-of-sample decay anomalies publication | 1054760 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:42 面5 | 2026-11-14T07:12:35Z | Semantic Scholar | out-of-sample decay anomalies publication | 355 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:43 面5 | 2026-11-14T07:12:35Z | OpenAlex | walk-forward validation overfitting out-of-sample | 29 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:44 面5 | 2026-11-14T07:12:36Z | Crossref | walk-forward validation overfitting out-of-sample | 1039409 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:45 面5 | 2026-11-14T07:12:45Z | Semantic Scholar | walk-forward validation overfitting out-of-sample | 101 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:46 面6 | 2026-11-14T07:12:45Z | OpenAlex | LLM self-evaluation bias | 800 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:47 面6 | 2026-11-14T07:12:47Z | Crossref | LLM self-evaluation bias | 3485245 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:48 面6 | 2026-11-14T07:12:52Z | Semantic Scholar | LLM self-evaluation bias | 30902 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:49 面6 | 2026-11-14T07:12:52Z | OpenAlex | LLM as judge reliability | 1129 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:50 面6 | 2026-11-14T07:12:53Z | Crossref | LLM as judge reliability | 434492 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:51 面1-7 | 2026-11-14T07:13:15Z | OpenAlex | batch doi filter (21 DOIs chosen from facet searches) | 21 | abstract reconstructed from abstract_inverted_index | key |
| facets-1-7:52 面6 | 2026-11-14T07:13:18Z | Semantic Scholar | LLM as judge reliability | 784 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:53 面6 | 2026-11-14T07:13:18Z | OpenAlex | AI scientist automated research evaluation | 424 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:54 面6 | 2026-11-14T07:13:19Z | Crossref | AI scientist automated research evaluation | 12487780 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:55 面6 | 2026-11-14T07:13:23Z | Semantic Scholar | AI scientist automated research evaluation | 10475 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:56 面7 | 2026-11-14T07:13:24Z | OpenAlex | optional stopping sequential testing alpha spending | 3 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:57 面7 | 2026-11-14T07:13:25Z | Crossref | optional stopping sequential testing alpha spending | 977591 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:58 面7 | 2026-11-14T07:13:29Z | Semantic Scholar | optional stopping sequential testing alpha spending | 222 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:59 面7 | 2026-11-14T07:13:29Z | OpenAlex | stopping rule strategy search | 227 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:60 面7 | 2026-11-14T07:13:31Z | Crossref | stopping rule strategy search | 1105670 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:61 面7 | 2026-11-14T07:13:34Z | Semantic Scholar | stopping rule strategy search | 11720 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:62 面7 | 2026-11-14T07:13:35Z | OpenAlex | probability of backtest overfitting number of trials | 4 | result list only (title, year, venue, citations, DOI) | key |
| facets-1-7:63 面7 | 2026-11-14T07:13:36Z | Crossref | probability of backtest overfitting number of trials | 828935 | result list only (title, year, venue, citations, DOI) | no key (polite pool) |
| facets-1-7:64 面7 | 2026-11-14T07:13:40Z | Semantic Scholar | probability of backtest overfitting number of trials | 12 | result list only (title, year, venue, citations, DOI) | key |
| facets-8-13:1 面F8 | 2026-11-14T07:06:51Z | OpenAlex | regime change trading strategy | 2734 | result list only (titles, years, DOIs) | key |
| facets-8-13:2 面F8 | 2026-11-14T07:06:51Z | Crossref | regime change trading strategy | 1876788 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:3 面F8 | 2026-11-14T07:06:53Z | Semantic Scholar (s2) | regime change trading strategy |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:4 面F8 | 2026-11-14T07:06:57Z | OpenAlex | structural break backtest out-of-sample | 10 | result list only (titles, years, DOIs) | key |
| facets-8-13:5 面F8 | 2026-11-14T07:06:57Z | Crossref | structural break backtest out-of-sample | 1603471 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:6 面F8 | 2026-11-14T07:06:58Z | Semantic Scholar (s2) | structural break backtest out-of-sample | 1281 | result list only (titles, years, DOIs) | key |
| facets-8-13:7 面F8 | 2026-11-14T07:07:02Z | OpenAlex | time-varying anomalies market regimes cryptocurrency | 2 | result list only (titles, years, DOIs) | key |
| facets-8-13:8 面F8 | 2026-11-14T07:07:02Z | Crossref | time-varying anomalies market regimes cryptocurrency | 2511173 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:9 面F8 | 2026-11-14T07:07:04Z | Semantic Scholar (s2) | time-varying anomalies market regimes cryptocurrency | 2957 | result list only (titles, years, DOIs) | key |
| facets-8-13:10 面F8 | 2026-11-14T07:07:33Z | Semantic Scholar (s2) | regime change trading strategy |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:11 面F8 | 2026-11-14T07:07:37Z | OpenAlex | momentum crashes market regime | 49 | result list only (titles, years, DOIs) | key |
| facets-8-13:12 面F8 | 2026-11-14T07:07:37Z | Crossref | momentum crashes market regime | 649512 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:13 面F8 | 2026-11-14T07:07:41Z | Semantic Scholar (s2) | momentum crashes market regime |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:14 面F9 | 2026-11-14T07:07:44Z | OpenAlex | paper trading forward test | 1510 | result list only (titles, years, DOIs) | key |
| facets-8-13:15 面F9 | 2026-11-14T07:07:45Z | Crossref | paper trading forward test | 1396353 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:16 面F9 | 2026-11-14T07:07:47Z | Semantic Scholar (s2) | paper trading forward test | 95868 | result list only (titles, years, DOIs) | key |
| facets-8-13:17 面F9 | 2026-11-14T07:07:50Z | OpenAlex | strategy decay live trading performance | 13 | result list only (titles, years, DOIs) | key |
| facets-8-13:18 面F9 | 2026-11-14T07:07:51Z | Crossref | strategy decay live trading performance | 3284526 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:19 面F9 | 2026-11-14T07:07:54Z | Semantic Scholar (s2) | strategy decay live trading performance | 737 | result list only (titles, years, DOIs) | key |
| facets-8-13:20 面F9 | 2026-11-14T07:07:57Z | OpenAlex | implementation shortfall live versus backtest performance gap | 0 | result list only (titles, years, DOIs) | key |
| facets-8-13:21 面F9 | 2026-11-14T07:07:58Z | Crossref | implementation shortfall live versus backtest performance gap | 3859414 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:22 面F9 | 2026-11-14T07:07:59Z | Semantic Scholar (s2) | implementation shortfall live versus backtest performance gap | 30 | result list only (titles, years, DOIs) | key |
| facets-8-13:23 面F10 | 2026-11-14T07:08:03Z | OpenAlex | replication crisis finance | 319 | result list only (titles, years, DOIs) | key |
| facets-8-13:24 面F10 | 2026-11-14T07:08:03Z | Crossref | replication crisis finance | 807565 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:25 面F10 | 2026-11-14T07:08:05Z | Semantic Scholar (s2) | replication crisis finance | 43107 | result list only (titles, years, DOIs) | key |
| facets-8-13:26 面F10 | 2026-11-14T07:08:09Z | OpenAlex | replicating anomalies Hou Xue Zhang | 6 | result list only (titles, years, DOIs) | key |
| facets-8-13:27 面F10 | 2026-11-14T07:08:09Z | Crossref | replicating anomalies Hou Xue Zhang | 5257112 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:28 面F10 | 2026-11-14T07:08:11Z | Semantic Scholar (s2) | replicating anomalies Hou Xue Zhang |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:29 面F10 | 2026-11-14T07:08:14Z | OpenAlex | data snooping backtest overfitting trading rules preregistration | 0 | result list only (titles, years, DOIs) | key |
| facets-8-13:30 面F10 | 2026-11-14T07:08:15Z | Crossref | data snooping backtest overfitting trading rules preregistration | 3268347 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:31 面F10 | 2026-11-14T07:08:17Z | Semantic Scholar (s2) | data snooping backtest overfitting trading rules preregistration |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:32 面F11 | 2026-11-14T07:08:20Z | OpenAlex | uncertainty communication decision making | 9440 | result list only (titles, years, DOIs) | key |
| facets-8-13:33 面F11 | 2026-11-14T07:08:20Z | Crossref | uncertainty communication decision making | 2767903 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:34 面F11 | 2026-11-14T07:08:22Z | Semantic Scholar (s2) | uncertainty communication decision making |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:35 面F11 | 2026-11-14T07:08:25Z | OpenAlex | backtest presentation investors overconfidence | 0 | result list only (titles, years, DOIs) | key |
| facets-8-13:36 面F11 | 2026-11-14T07:08:25Z | Crossref | backtest presentation investors overconfidence | 213738 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:37 面F11 | 2026-11-14T07:08:28Z | Semantic Scholar (s2) | backtest presentation investors overconfidence |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:38 面F11 | 2026-11-14T07:08:31Z | OpenAlex | hypothetical performance disclosure | 199 | result list only (titles, years, DOIs) | key |
| facets-8-13:39 面F11 | 2026-11-14T07:08:31Z | Crossref | hypothetical performance disclosure | 2466869 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:40 面F11 | 2026-11-14T07:08:33Z | Semantic Scholar (s2) | hypothetical performance disclosure | 52588 | result list only (titles, years, DOIs) | key |
| facets-8-13:41 面F12 | 2026-11-14T07:08:36Z | OpenAlex | model risk management independent validation | 8606 | result list only (titles, years, DOIs) | key |
| facets-8-13:42 面F12 | 2026-11-14T07:08:37Z | Crossref | model risk management independent validation | 9400652 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:43 面F12 | 2026-11-14T07:08:39Z | Semantic Scholar (s2) | model risk management independent validation | 95844 | result list only (titles, years, DOIs) | key |
| facets-8-13:44 面F12 | 2026-11-14T07:08:43Z | OpenAlex | separation of duties investment research | 65 | result list only (titles, years, DOIs) | key |
| facets-8-13:45 面F12 | 2026-11-14T07:08:44Z | Crossref | separation of duties investment research | 10297472 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:46 面F12 | 2026-11-14T07:08:45Z | Semantic Scholar (s2) | separation of duties investment research | 43 | result list only (titles, years, DOIs) | key |
| facets-8-13:47 面F12 | 2026-11-14T07:08:48Z | OpenAlex | red team quantitative model review SR 11-7 | 1 | result list only (titles, years, DOIs) | key |
| facets-8-13:48 面F12 | 2026-11-14T07:08:49Z | Crossref | red team quantitative model review SR 11-7 | 17466712 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:49 面F12 | 2026-11-14T07:08:51Z | Semantic Scholar (s2) | red team quantitative model review SR 11-7 |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:50 面F13 | 2026-11-14T07:08:54Z | OpenAlex | algorithmic trading operational risk | 1361 | result list only (titles, years, DOIs) | key |
| facets-8-13:51 面F13 | 2026-11-14T07:08:54Z | Crossref | algorithmic trading operational risk | 1993021 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:52 面F13 | 2026-11-14T07:08:56Z | Semantic Scholar (s2) | algorithmic trading operational risk |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:53 面F13 | 2026-11-14T07:08:59Z | OpenAlex | Knight Capital software failure trading | 5 | result list only (titles, years, DOIs) | key |
| facets-8-13:54 面F13 | 2026-11-14T07:08:59Z | Crossref | Knight Capital software failure trading | 1561709 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:55 面F13 | 2026-11-14T07:09:01Z | Semantic Scholar (s2) | Knight Capital software failure trading |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:56 面F13 | 2026-11-14T07:09:04Z | OpenAlex | kill switch pre-trade risk controls automated trading | 2 | result list only (titles, years, DOIs) | key |
| facets-8-13:57 面F13 | 2026-11-14T07:09:05Z | Crossref | kill switch pre-trade risk controls automated trading | 3086735 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:58 面F13 | 2026-11-14T07:09:07Z | Semantic Scholar (s2) | kill switch pre-trade risk controls automated trading |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:59 面F8 | 2026-11-14T07:09:31Z | OpenAlex | "momentum crashes" | 177 | result list only (titles, years, DOIs) | key |
| facets-8-13:60 面F8 | 2026-11-14T07:09:31Z | Crossref | Momentum crashes Daniel Moskowitz | 187375 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:61 面F9 | 2026-11-14T07:09:32Z | OpenAlex | "Does academic research destroy stock return predictability" | 6 | result list only (titles, years, DOIs) | key |
| facets-8-13:62 面F9 | 2026-11-14T07:09:33Z | OpenAlex | "implementation shortfall" backtest live trading | 0 | result list only (titles, years, DOIs) | key |
| facets-8-13:63 面F10 | 2026-11-14T07:09:34Z | OpenAlex | "...and the cross-section of expected returns" Harvey Liu Zhu | 0 | result list only (titles, years, DOIs) | key |
| facets-8-13:64 面F10 | 2026-11-14T07:09:34Z | Crossref | ...and the Cross-Section of Expected Returns Harvey Liu Zhu | 6371127 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:65 面F11 | 2026-11-14T07:09:36Z | OpenAlex | "Pseudo-mathematics and financial charlatanism" | 3 | result list only (titles, years, DOIs) | key |
| facets-8-13:66 面F11 | 2026-11-14T07:09:36Z | Crossref | Pseudo-Mathematics and Financial Charlatanism backtest overfitting | 1800236 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:67 面F13 | 2026-11-14T07:09:37Z | OpenAlex | "flash crash" high frequency trading | 240 | result list only (titles, years, DOIs) | key |
| facets-8-13:68 面F13 | 2026-11-14T07:09:38Z | Crossref | Kirilenko Flash Crash high-frequency trader market | 4298991 | result list only (titles, years, DOIs) | polite pool (contact sent to Crossref only) |
| facets-8-13:69 面F13 | 2026-11-14T07:09:39Z | OpenAlex | "ultrafast machine ecology" financial black swans | 1 | result list only (titles, years, DOIs) | key |
| facets-8-13:70 面F12 | 2026-11-14T07:09:40Z | OpenAlex | "model risk" management governance validation | 164 | result list only (titles, years, DOIs) | key |
| facets-8-13:71 面F8 | 2026-11-14T07:10:05Z | Semantic Scholar (s2) | regime change trading strategy |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:72 面F8 | 2026-11-14T07:10:34Z | Semantic Scholar (s2) | momentum crashes market regime | 1254 | result list only (titles, years, DOIs) | key |
| facets-8-13:73 面F10 | 2026-11-14T07:11:03Z | Semantic Scholar (s2) | replicating anomalies Hou Xue Zhang | 187 | result list only (titles, years, DOIs) | key |
| facets-8-13:74 面F10 | 2026-11-14T07:11:31Z | Semantic Scholar (s2) | data snooping backtest overfitting trading rules preregistration | 12 | result list only (titles, years, DOIs) | key |
| facets-8-13:75 面F11 | 2026-11-14T07:12:00Z | Semantic Scholar (s2) | uncertainty communication decision making | 206717 | result list only (titles, years, DOIs) | key |
| facets-8-13:76 面F11 | 2026-11-14T07:12:28Z | Semantic Scholar (s2) | backtest presentation investors overconfidence | 22 | result list only (titles, years, DOIs) | key |
| facets-8-13:77 面F12 | 2026-11-14T07:12:57Z | Semantic Scholar (s2) | red team quantitative model review SR 11-7 | 182 | result list only (titles, years, DOIs) | key |
| facets-8-13:78 面F13 | 2026-11-14T07:13:25Z | Semantic Scholar (s2) | algorithmic trading operational risk |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:79 面F13 | 2026-11-14T07:13:54Z | Semantic Scholar (s2) | Knight Capital software failure trading | 56 | result list only (titles, years, DOIs) | key |
| facets-8-13:80 面F13 | 2026-11-14T07:14:16Z | Semantic Scholar (s2) | Knight Capital software failure trading |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:81 面F13 | 2026-11-14T07:14:22Z | Semantic Scholar (s2) | kill switch pre-trade risk controls automated trading |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:82 面F13 | 2026-11-14T07:15:00Z | Semantic Scholar (s2) | algorithmic trading operational risk |  | result list only (titles, years, DOIs) | key; error: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limi… |
| facets-8-13:83 面F12 | 2026-11-14 | 其他 (web-search) | SR 11-7 Supervisory Guidance on Model Risk Management federalreserve.gov | 10 | search snippets only; SR 11-7 text not read | none |
| facets-8-13:84 面F12 | 2026-11-14 | 其他 (federalreserve.gov) | https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm | 1 | page text via summariser; attachment SR2602a1.pdf not read | none; SR11-7 direct URL returned 404 |
| facets-8-13:85 面F13 | 2026-11-14 | 其他 (web-search) | FIA Best Practices for Automated Trading Risk Controls and System Safeguards | 10 | search snippets; PDF full text read separately (see fulltext/) | none |
| facets-8-13:86 面F13 | 2026-11-14 | 其他 (fia.org-pdf) | FIA_WP_AUTOMATED TRADING RISK CONTROLS 2024-07 PDF | 1 | full text (24 pp), sections 1.5 and 5 read | none |
| facets-8-13:87 面F13 | 2026-11-14 | 其他 (web-search) | EU Delegated Regulation 2017/589 RTS 6 algorithmic trading testing | 10 | search snippets only; EUR-Lex article text not obtained (JS-rendered page) | none |
| facets-8-13:88 面F13 | 2026-11-14 | 其他 (web-search) | SEC Knight Capital Americas order Release 70694 market access rule 15c3-5 | 10 | search snippets only; SEC order PDF returned rate-limit HTML page | SEC rate threshold page on direct fetch |
| facets-8-13:89 面F11 | 2026-11-14 | 其他 (sec.gov-faq) | marketing-compliance-frequently-asked-questions | 1 | page text via summariser: one footnote on hypothetical performance; no backtest FAQ found | none |
| facets-8-13:90 面F11 | 2026-11-14 | 其他 (web-search) | SEC marketing rule 206(4)-1 hypothetical performance FAQ | 10 | search snippets only | none |

## 论文阅读深度

### 论文阅读深度表

范围：A 线（外部文献）各抽取文件里出现过的论文。本节只汇编已有抽取，不重新检索、不新增结论。读取日期除注明外均为 2026-11-14。表中“来源未记”表示来源文件没有写这一项，不是补猜。“没读到”是来源文件原话，表示读者试过没取到。

表的列：作者 年份 短题｜标识｜状态｜市场、窗口、频率｜样本外？扣成本？｜读到哪层（来源文件）｜读的版本与出版版是否不同。

来源文件简称（均在 `/tmp/trade-audit-20261114/phaseA/`）：P1 至 P6 指 `papers-1-protocol.md` 至 `papers-6-seeds-retry.md`；F1 指 `facets-1-7.md`；F8 指 `facets-8-13.md`；FC-I 至 FC-IV 指 `facet-check-I.md` 至 `facet-check-IV.md`；LR 指 `ledger-readings.md`。

#### 表 A：读到摘要或更深的论文（51 行）

| 作者 年份 短题 | 标识 | 状态 | 市场、窗口、频率 | 样本外？扣成本？ | 读到哪层（来源文件） | 读的版本与出版版是否不同 |
|---|---|---|---|---|---|---|
| Arnott, Harvey, Markowitz 2019 回测协议 | DOI 10.3905/jfds.2019.1.064；SSRN 3275654 | 期刊（Journal of Financial Data Science，Winter 2019） | 协议文章；唯一数据例是美股市场中性多空策略，样本内 1963–1988、样本外 1989–2015（Exhibit 1）；正文谈的数据为月度、季度、宏观 | 协议文章，样本外不适用；主张样本内外都要计成本（类别 4）；Exhibit 1 没有扣成本的数字 | 全文：作者 Duke 主页 PDF（people.duke.edu/~charvey/Research/Published_Papers/P138_A_backtesting_protocol.pdf，HTTP 200）；清单为 7 类 22 条（Exhibit 2，期刊 p.73），正文 pp.68–73。取自 P6；P1 只读到 OpenAlex 摘要，已被 P6 取代；FC-II 另核对了本地抽取文本 | 来源称为作者主页的 Published_Papers 副本，引用的是期刊页码；与出版版是否逐字一致，来源未记。Exhibit 2 的文字层有字符偏移，P6 已解码并与正文标题核对 |
| Harvey, Liu 2015 Backtesting | DOI 10.3905/jpm.2015.42.1.013；SSRN 2345489 | 期刊（Journal of Portfolio Management，Fall 2015） | 美股横截面多空策略 E/P、MOM、BAB；示例为月度、T=240；数据窗口没读到 | 不是样本外检验，是对 Sharpe 做多重检验折扣；否，原文称其为 before-costs | 全文：Duke 作者副本 P120_Backtesting.PDF，印刷页 12–22 正文读完；p.22 之后的附录与程序页未读。取自 P1 | 读的是 Fall 2015 印刷版式的作者副本；2015 年 7 月工作论文版只从搜索摘要得知，未读 |
| Harvey, Liu, Zhu 2016 …and the Cross-Section of Expected Returns | DOI 10.1093/rfs/hhv059；NBER w20592；SSRN 2249314 | 期刊（Review of Financial Studies 2016）；读的是 NBER 工作论文 | 美股横截面因子；摘要称自 1967 年首批实证至今并外推 20 年；316 个因子（PDF 页 26）；频率来源未记 | 否；NBER 版正文未查到直接的成本扣除段落 | 全文：NBER w20592（2014 年 10 月版，PDF 101 页，pdftotext）。取自 P1；F8 只读到 OpenAlex 摘要，取 P1 | 是。读的是 NBER 工作论文，不是 RFS 正式版；RFS 版的页码和数字可能不同，未核对 |
| Bailey, Borwein, López de Prado, Zhu 2014 Pseudo-Mathematics | DOI 10.1090/noti1105；OpenAlex W3125595766 | 期刊（Notices of the AMS 61(5)） | 无真实市场；独立正态 SR 试验模拟；Example 8.1 为随机游走 1000 个日价格（约 4 年）上的月度规则 | 样本外不适用；成本没读到（论文未讨论） | 全文：作者稿 2014-04-01（davidhbailey.com/dhbpapers/backtest-pseudo.pdf）。取自 P2；FC-II 重读了第 2–3 节本地文本；F8、FC-IV 记为仅摘要首段，取 P2 | 读的是作者稿；与出版版的差异没核对 |
| Bailey, Borwein, López de Prado, Zhu 2016 Probability of Backtest Overfitting | DOI 10.21314/JCF.2016.322；SSRN 2326253 | 期刊（Journal of Computational Finance） | 模拟：随机游走 1000 个日价格（约 4 年）上的月度季节规则；第 3 节“真实策略”例的市场与窗口没读到 | CSCV 内部做样本内外划分，数据均为事后给定；成本没读到 | 全文：作者稿，修订版 2015-02（davidhbailey.com/dhbpapers/backtest-prob.pdf）；附录与 Exhibit 图像只读了正文与关键页。取自 P2；F1 只读到摘要，取 P2 | 读的是作者稿；出版版的页码、数字可能不同，未核对 |
| Bailey, López de Prado 2014 Deflated Sharpe Ratio | DOI 10.3905/jpm.2014.40.5.094；SSRN 2460551 | 期刊（JPM 40(5)，pp.94–107） | 无实证策略；示例为假设的国债拍卖策略，年化 SR 2.5，5 年日频 T=1250；Exhibit 1 为模拟 | 不适用；成本没读到 | 全文：作者稿 2014-07-31（davidhbailey.com/dhbpapers/deflated-sharpe.pdf）；式 (2) 与附录 A.3 由页面图像读取。取自 P2；F1 只读到摘要，取 P2；FC-II 重读了式 (2)、停止检验一节、附录 A.3 | 读的是标有 Forthcoming 的作者稿；差异没核对 |
| López de Prado 2018 The 10 Reasons Most ML Funds Fail | DOI 10.3905/jpm.2018.44.6.120；SSRN 3104816 | 期刊（JPM 44(6)，pp.120–133） | 没读到 | 没读到 | 仅元数据（Crossref、OpenAlex、作者论文列表页）。取自 P2、P6；两轮均未取到全文，十条清单未列出 | 没读到任何版本 |
| White 2000 A Reality Check for Data Snooping | DOI 10.1111/1468-0262.00152；OpenAlex W2135606128 | 期刊（Econometrica 68(5)，pp.1097–1126） | §4 示例为 S&P 500 指数日收益的一步预测，窗口 1988-03-29 至 1994-05-31；日频 | 预测评估的 758 点相对前 803 点为样本外；无交易成本概念 | 全文：users.ssc.wisc.edu/~bhansen/718/White2000.pdf（大学课程页副本，不是作者主页或出版方）。取自 P3 | 来源称正文页码与期刊页码一致；是课程页副本，与出版版是否逐字一致未核对 |
| Sullivan, Timmermann, White 1999 Data-Snooping, Technical Trading Rules | DOI 10.1111/0022-1082.00163 | 期刊（Journal of Finance 1999） | 道琼斯工业指数日数据 1897–1996；样本内 1897–1986，样本外 1987–1996；另有 S&P 500 期货 | 样本外：是；成本只做盈亏平衡分析（DJIA 最优规则每笔 0.27%），无扣成本结果 | 全文：LSE 讨论稿 DP303（eprints.lse.ac.uk/119144/1/dp303.pdf）。取自 P3 | 是。读的是 1998 年 10 月 LSE 讨论稿，不是 JF 印刷版；数字和页码可能不同，JF 版未核对 |
| Bajgrowicz, Scaillet 2012 Technical trading revisited | DOI 10.1016/j.jfineco.2012.06.001；SSRN 1095202 | 期刊（JFE 106(3)，pp.473–491） | DJIA 日数据 1897-01 至 2011-07，分 6 个子期；STW 的 7,846 条规则 | 样本外：是（§5 每月重组）；扣成本：是（Table 2 报告使样本内超额表现消失的最低交易成本，Table 3 按单边 12.5 个基点计入成本，Table 5 报告使样本外表现消失的盈亏平衡成本；Table 4 是零交易成本下的持续性对照，不是扣成本的结果） | 全文：作者接受稿（archive-ouverte.unige.ch/unige:79889）。取自 P3 | 是。读的是作者接受稿，页码为稿件页码，不是 JFE 印刷页 |
| Hansen 2005 A Test for Superior Predictive Ability | DOI 10.1198/073500105000000063；SSRN 264569 | 期刊（JBES）；卷期页 23(4) 365–380 只来自一条二手搜索摘要，未核实 | 摘要中的例子是美国年度通胀的回归预测对随机游走；窗口未读 | 摘要称有实证比较，窗口未读；与成本无关 | 仅摘要（OpenAlex 出版方摘要）。取自 P3；P6 再试多条路径仍未取到全文，且只记了元数据 | 只读了摘要，正文版本没读到 |
| Wiecki, Campbell, Lent, Stauth 2016 All That Glitters | DOI 10.3905/joi.2016.25.3.069；SSRN 2745220 | 期刊（Journal of Investing） | 没读到（二手搜索摘要称 888 个 Quantopian 算法，未核对，不可引用） | 没读到 | 仅元数据，外加 Semantic Scholar 的一句自动生成概括（非原文摘要）；出版方摘要被撤下。取自 P3、P6 | 没读到任何版本 |
| Lopez-Lira, Tang, Zhu 2025 Memorization Problem | arXiv 2504.14765 v2（2025-12-16）；SSRN 10.2139/ssrn.5217505 | 工作论文（预印本） | 美国宏观指标、指数、CRSP 个股月末价（1990–2024）、WSJ 头版标题（1990–2025）；GPT-4o 截止 2023-10；月度、日度、月末 | 不是策略回测，不适用；不适用 | 全文主体：arxiv.org/pdf/2504.14765；附录 A（提示）与 §4 数据只浏览。取自 P4 | 读的是 arXiv v2；是否有出版版，来源未记 |
| Gao, Jiang, Yan 2026 Detecting Lookahead Bias in LLM Forecasts | arXiv 2512.23847 v2（2026 年 6 月）；SSRN 5985277；前稿题 A Test of Lookahead Bias in LLM Forecasts | 工作论文（预印本） | 美股；新闻样本内 2012-01 至 2023-12，安慰剂 2024 年；财报电话会 2006Q1–2020Q4 与 2023Q3–2024Q1；Llama-3.3-70B 截止 2023-12；日度收益、季度资本开支 | 样本外安慰剂：是；否（报告回归系数） | 全文主体：arxiv.org/pdf/2512.23847；§2.2、§3.3–3.4 回归细节只浏览。取自 P4 | 读的是 arXiv v2；是否有出版版，来源未记 |
| Glasserman, Lin 2023 GPT 情绪分析的前视偏差 | arXiv 2309.17322 v1（2023-09-29）；DOI 10.3905/jfds.2023.1.143（OpenAlex 所示期刊版）；SSRN 4586726 | 期刊（OpenAlex 所示 JFDS）；读的是 arXiv 预印本 | 美股 CRSP 日度；样本内 2015-01 至 2021-09，样本外 2021-10 至 2022-12；日度 | 样本外：是；否（样本外也忽略成本与卖空约束，§2.3 p.5） | 全文主体：arxiv.org/pdf/2309.17322；附录与 §3.4–3.6 只浏览。取自 P4 | 是。读的是 arXiv v1，期刊版未取得原刊 |
| He, Lv, Manela, Wu 2025 Chronologically Consistent LLMs | arXiv 2502.21206 v3（2025-07-06）；SSRN 5159615 | 工作论文（预印本） | 美股道琼斯新闻，2008-01 至 2023-07；次日收益，日度再平衡 | 样本外：是；否（多空组合 Sharpe 为未扣成本数值） | 全文主体：arxiv.org/pdf/2502.21206；§2.1–2.2 与附录只浏览。取自 P4 | 读的是 arXiv v3；是否有出版版，来源未记 |
| Li 等 2025 R&D-Agent-Quant | arXiv 2505.15155 v2（2025-09-25） | 预印本 | 主实验 CSI 300：训练 2008–2014、验证 2015–2016、测试 2017-01-01 至 2020-08-01；扩展实验 CSI 500 与 NASDAQ 100，测试 2024-01-01 至 2025-06-30；日度 | 样本外：是；扣成本：是，但 CSI 300 的成本写法不一致（附录 C.4.2 买 0.05%、卖 0.15%；附录 D.1 另写 0.5%），来源未核对 | 全文主体：arxiv.org/pdf/2505.15155；其余只浏览。取自 P4 | 读的是 arXiv v2；OpenAlex 未见期刊版或 SSRN 版 |
| Helm 2026 运行自主 AI Agent 做量化研究的方法报告 | figshare 10.6084/m9.figshare.34781541.v1 | 自述报告（作者称是 field report，不是对照研究） | 方法文章，无交易窗口；项目为个人股票策略研究 | 不适用；不适用 | 全文约 2/3：摘要、§1–2、§5–8（p.1–10）；§3、§4、§9–12 未读。PDF ndownloader.figshare.com/files/70636377。取自 P4 | 读的是 v1；是否有其他版本，来源未记 |
| Helm 2026 三个预注册赌注的一次性样本外检验 | figshare 10.6084/m9.figshare.34781529.v1 | 自述报告（自我执行的预注册） | ETF 与美股；开发数据至 2026-03-01，一次性样本外 2026-03-02 至 2026-10-23（165 个交易日）；日度信号，次日开盘执行 | 样本外：是（一次性）；摘要称含完整成本模型，但 §6 称样本外成本按交易日折算、未实测 | 全文主体：附录 A–E、G–H 未读（PDF ndownloader.figshare.com/files/70636365）。取自 P4 | 读的是 v1；是否有其他版本，来源未记 |
| Ackerer, Hugonnier, Jermann 2025 Perpetual Futures Pricing | DOI 10.1111/mafi.70018；NBER w32936；SSRN 4603820；arXiv 2310.11771 | 期刊（Mathematical Finance）；读的是 arXiv 预印本 | 理论，无估计样本；图 1 用 2019-01-01 至 2023-12-10 永续 BTC 合约日成交量 | 不适用（无回测）；无成本 | 全文：arxiv.org/pdf/2310.11771，第 1–3 节与结论；证明部分没读。取自 P5 | 读的是 arXiv v2（2024-09-03）；与期刊版的差异，来源未记 |
| He, Manela, Ross, von Wachter Fundamentals of Perpetual Futures | SSRN 4301150（DOI 10.2139/ssrn.4301150）；arXiv 2212.06888 | 工作论文、预印本；没查到期刊版 | Binance 的 BTC、ETH、BNB、DOGE、ADA 永续与现货，1 小时；BTC、ETH 自 2020-01-08 至 2024-03-11，各 36,578 个观测 | 读到的部分没有单独的样本外切分；成本按 Binance 公布的分档手续费加有效买卖价差 | 部分：摘要、第 1 节、第 2 节前半、第 4.1、4.3、4.4 开头及强平风险段（arxiv.org/pdf/2212.06888）。取自 P5 | 读的是 arXiv v7（2026-09-17）；没有期刊版可比 |
| Inan 2026 Predictability of funding rates | DOI 10.1016/j.irfa.2026.105464；SSRN 10.2139/ssrn.5576424 | 期刊（International Review of Financial Analysis）；评审情况没查 | 摘要：Binance 与 Bybit 的 BTC 永续资金费，一步向前预测；窗口、频率没读到 | 摘要称样本外；不涉及交易成本 | 仅摘要（OpenAlex）。取自 P5；出版方页面未试，SSRN 不抓取 | 只读了摘要 |
| Cheng, Deng, Wang, Yu 2021 Liquidation, leverage and optimal margin | DOI 10.1080/00036846.2021.1922597；SSRN 3781646；arXiv 2102.04591 | 期刊（Applied Economics）；读的是 arXiv 预印本 | BitMEX 永续 BTC；极值分析 5 分钟价 2017-01-01 至 2021-02-06；强平与杠杆用 Coinalyze 日度 2020-01-29 至 2021-02-03 | 否；无成本（描述性极值统计） | 全文：arxiv.org/pdf/2102.04591，21 页。取自 P5 | 是。读的是 arXiv v1（2021-02-09），期刊版可能有改动 |
| Lim 2026 Anatomy of a crypto cascade | SSRN 6579278（DOI 10.2139/ssrn.6579278）；OpenAlex 另列 10.1504/ijbc.2026.10081004（疑似期刊版，没核对） | 工作论文（SSRN），单作者，未见同行评审证据 | 摘要：Binance 与 Bybit 的 BTC、ETH、SOL 现货、永续、标记价，分钟级；围绕 2025-10-10 事件 | 事件研究，不适用；不适用 | 仅摘要（OpenAlex）。取自 P5；全文未取，SSRN 不抓取 | 只读了摘要 |
| Alexander, Deng, Zou 2022 Hedging with automatic liquidation | DOI 10.1016/j.ejor.2022.07.037 | 期刊（European Journal of Operational Research） | 摘要：分钟级，五家交易所的直接与反向 BTC 对冲工具；窗口没读到 | 没读到 | 仅摘要（OpenAlex）。取自 P5；Sussex 机构库返回 HTTP 202 空体，未绕过 | 只读了摘要 |
| Cong, Li, Tang, Yang Crypto Wash Trading | DOI 10.1287/mnsc.2021.02709（OpenAlex 记 2022）；NBER w30783；SSRN 3530220、4312030；arXiv 2108.10984 | 期刊（Management Science）；读的是 arXiv 早期稿 | 29 家交易所，2019-07-09 至 2019-11-03，BTC、ETH、XRP、LTC 逐笔共 448,475,535 笔 | 不适用（取证性研究）；不适用 | 部分：摘要、第 1 节、第 2 节数据、第 4.2 与 5.2 节片段、附录交易所表（arxiv.org/pdf/2108.10984）。取自 P5；FC-IV 记为仅摘要，取 P5 | 是。读的是 2021-07 的 arXiv 早期稿，数字以期刊版为准 |
| Aloosh, Li 2024 Direct Evidence of Bitcoin Wash Trading | DOI 10.1287/mnsc.2021.01448；SSRN 3362153 | 期刊（Management Science） | Mt.Gox 内部交易记录，2011-06-26 至 2013-05-20 | 不适用；不适用 | 部分：摘要、第 2 节、第 3 节标题、结论（doras.dcu.ie/32898）。取自 P5；FC-IV 记为仅摘要，取 P5 | 读的是 DCU 机构库版本（日期 2023-08-28）；与出版版差异来源未记 |
| Ammann, Burdorf, Liebi, Stöckl 2022 Survivorship and Delisting Bias in Crypto | DOI 10.2139/ssrn.4287573（OpenAlex W7025043959） | 工作论文（2022-11-28 稿）；没查到期刊版 | CoinMarketCap 的 3,904 个币，2014-01-07 至 2021-12-28，周收益 | 不适用（偏差估计）；无成本 | 部分：摘要、第 1 节、数据与退市收益部分、结果开头（圣加仑大学机构库 alexandria.unisg.ch）。取自 P5 | 读的是 2022-11-28 稿；没有期刊版可比 |
| Hudson, Urquhart 2021 Technical trading and cryptocurrencies | DOI 10.1007/s10479-019-03357-1 | 期刊（Annals of Operations Research 297:191–220） | 日频；CoinDesk BTC 指数自 2010-07-18、Bitstamp 自 2012-12-01，另有 Litecoin、Ethereum、Ripple；样本内至 2017-12-31 | 样本外只有 2018 年上半年；成本以盈亏平衡给出，不是净收益 | 全文：雷丁大学 CentAUR（centaur.reading.ac.uk/85715），逐节读了第 2、5、6.2、6.4、6.5、7 节。取自 P5 | 读的是开放获取出版版本（CC-BY），来源未提与其他版本的差异 |
| Deprez, Frömmel 2024 Simple technical trading rules in bitcoin | DOI 10.1016/j.iref.2024.05.003；SSRN 4401552 | 期刊（International Review of Economics & Finance）；读的是预印本 | Bitstamp BTC/USD 逐笔 2012–2022，重采样为日线与 60、30、10 分钟；2013 年前用于初始化 | 样本外：是（2014-01 起月度滚动，共 2,922 个交易日）；扣成本：是 | 全文：根特大学机构库预印本（biblio.ugent.be），第 1–6 节与附录部分页。取自 P5 | 是。读的是 2024-05-01 的预印本，期刊版可能有差别 |
| Anghel 2020 Reality check on trading rules: ML vs technical analysis | DOI 10.1016/j.frl.2020.101655（OpenAlex W3036304463） | 期刊（Finance Research Letters） | 没读到 | 摘要称控制了数据窥探和市场摩擦，做法没读到 | 仅摘要（Semantic Scholar 摘要字段；openAccessPdf 标为 CLOSED）。取自 P5 | 只读了摘要。注：Deprez–Frömmel 把它引作 2022，OpenAlex 记 2020 |
| Hard to Fool 2026 Bounded LLM Research Loop | arXiv 2611.06607；SSRN 10.2139/ssrn.7682019 | 预印本，独立研究者自述 | 来源称主要是股指期权等非加密资产，未进一步抽取 | 来源未记 | 部分：摘要与引言（fulltext/arxiv-2611.06607.txt）。摘要称一个发现期与验证期夏普接近 3 的 LLM 候选，在一次性留出集降到 0.26（自述，未核验）。取自 P5 的“其余候选”表 | 来源未记 |
| Fonseca 2026 Look-Ahead-Freedom | arXiv 2607.04958 | 预印本（页眉为 ACM TOSEM 格式，未标明已接收） | 通用流水线形式化，未针对具体市场 | 已读节中未确认 | 部分：摘要、§2.1、§2.4；§3–§8 形式化部分未读。取自 F1 | 来源未记 |
| Mathematics 2026 Point-in-Time Backtesting of Momentum-Trend Equity | DOI 10.3390/math14122182 | 期刊（MDPI Mathematics 2026） | 摘要称股票；窗口未读 | 未读 | 仅摘要（OpenAlex 重建摘要）；OA PDF 链接已取得，未下载。取自 F1 | 只读了摘要 |
| Sharpe Ratio Inference 2026 | DOI 10.3905/jpm.2026.1.837 | 期刊（JPM 2026） | 未读 | 未读 | 仅摘要（OpenAlex 重建摘要），无 OA 全文。取自 F1 | 只读了摘要 |
| MinervaScore 2026 Equity Strategy Backtesting | arXiv 2608.23808 | 预印本 | 合成环境与一项真实市场研究（§7）；频率与窗口在已读节中未确认 | §7 为预注册的真实市场研究；成本未读 | 部分：摘要、§6.7、§9.2、§9.6（arXiv PDF）。取自 F1 | 来源未记 |
| Novy-Marx, Velikov 2016 Taxonomy of Anomalies and Trading Costs | DOI 10.1093/rfs/hhv063；NBER w20721 | 期刊（RFS 2016）；读的是 NBER 工作论文 | 美国股票；月度换手；Table 1 注释称成本回归按年、1963–2013 | 样本外未读；扣成本：是（研究扣成本后的价差） | 部分：NBER 全文的摘要段与 Table 1 注释（nber.org/system/files/working_papers/w20721/w20721.pdf）。取自 F1 | 是。读的是 NBER 工作论文，与 RFS 版差异来源未记 |
| Chordia, Goyal, Saretto 2020 Anomalies and False Rejections | DOI 10.1093/rfs/hhaa018；SSRN 3017677 | 期刊（RFS 2020） | 美股（摘要中的策略由真实数据随机生成）；窗口、频率未读 | 未读 | 仅摘要（OpenAlex 重建摘要）；SSRN 副本未下载。取自 F1 | 只读了摘要 |
| Dwork 等 2015 The reusable holdout | DOI 10.1126/science.aaa9375；arXiv 1506.02629 | 期刊（Science 2015）；读的是 arXiv 版 | 方法论文，无市场数据；对象为 i.i.d. 样本 | 不适用；不适用 | 部分：arXiv PDF p.1–4（摘要、§1、§1.1.1、§1.2）。取自 FC-III；F1 标为“全文”但只读了摘要段，取 FC-III | 是。读的是 arXiv 版；Science 版摘要只经 OpenAlex |
| When do systematic strategies decay? 2022 | DOI 10.1080/14697688.2022.2098810 | 期刊（Quantitative Finance） | 来源未记（摘要以发表后期间衡量异象收益衰减） | 样本外：是（发表后期间，见摘要）；成本未读 | 仅摘要（OpenAlex 重建摘要）；T&F 需访问权限，未下载。取自 F1 | 只读了摘要 |
| Self-Preference Bias in LLM-as-a-Judge 2024 | arXiv 2410.21819 | 预印本 | 不适用（对话与文本评估） | 不适用；不适用 | 部分：摘要段（PDF 第 1 页）与正文第 76 行附近一句。取自 F1 | 来源未记 |
| The Unreliable Judges 2026 | DOI 10.64898/2026.06.15.26355670 | 预印本（medRxiv） | 临床文本，与金融无关 | 不适用；不适用 | 仅摘要（OpenAlex 重建摘要）；OA PDF 未下载。取自 F1 | 只读了摘要 |
| Daniel, Moskowitz 2016 Momentum Crashes | DOI 10.1016/j.jfineco.2015.12.002；NBER w20439；SSRN 2371227 | 期刊（JFE）；读的是 NBER 工作论文 | 美国与国际股票及其他资产类别的动量组合；样本自 1927:01 至 2013:03；月度 | 稳健性跨多个期间与市场；图 1 明确假设无交易成本，动态策略是否扣费未核实 | 全文：NBER w20439（2014 年 8 月版，nber.org/system/files/working_papers/w20439/w20439.pdf）；节号未逐一核对，按文本行号引用。取自 F8 | 是。读的是 NBER 工作论文，与正式版差异未核实 |
| Alexander, Fabozzi Measuring Strategy-Decay Risk | DOI 10.3905/jpm.2025.1.807；arXiv 2604.08356 | 预印本；期刊版 DOI 来自 OpenAlex 与 arXiv 首页，未另行核对 | 多个因子策略，沿用 Jensen、Kelly、Pedersen 2023 的因子数据集；窗口与频率未逐一核对 | 未核实 | 全文：arXiv 作者版（arxiv.org/pdf/2604.08356）。取自 F8 | 读的是 arXiv 版；与 JPM 版差异来源未记 |
| McLean, Pontiff 2016 Does Academic Research Destroy Predictability | DOI 10.1111/jofi.12365；SSRN 2080900 等多个版本 | 期刊（Journal of Finance） | 97 个已发表的收益预测变量，美国股票；窗口与频率未核实 | 摘要说明样本外与发表后收益；成本处理未核实 | 仅摘要（OpenAlex）。取自 F8 | 只读了摘要 |
| A Real Edge that Loses 2026（回测到实盘落差，加密永续） | SSRN DOI 10.2139/ssrn.7353678 | 预印本（SSRN，单作者） | 来源未记（题名称加密永续）；没读到 | 没读到 | 仅元数据；OpenAlex、Crossref 均无摘要，FC-III 复查仍无摘要。取自 P5、F8、FC-III | 没读到任何版本 |
| Jensen, Kelly, Pedersen Is There a Replication Crisis in Finance | DOI 10.1111/jofi.13249；NBER w28432 | 期刊（Journal of Finance）；读的是 NBER 工作论文 | 全球 153 个因子、93 个国家；以美国因子为主样本；月度 | 摘要称在 93 国新数据集上样本外；成本未核实 | 全文：NBER w28432（2021 年 2 月版，nber.org/system/files/working_papers/w28432/w28432.pdf）。取自 F8 | 是。读的是 NBER 工作论文，与正式版差异未核实 |
| Hou, Xue, Zhang Replicating Anomalies | DOI 10.1093/rfs/hhy131；SSRN 2961979；NBER w23394 | 期刊（RFS） | 452 个异象，美国股票，市值加权与 NYSE 断点；窗口与频率未核实 | 摘要称单独检验 trading frictions；成本处理未核实 | 仅摘要（OpenAlex）。取自 F8 | 只读了摘要 |
| Johnson 等 2012 Financial black swans, ultrafast machine ecology | arXiv 1202.1448；SSRN 2003874 | 预印本；期刊版未核实 | 摘要：2006–2011 年 18,520 个超快黑天鹅事件，股票价格 | 不适用；不适用 | 部分：只读首段摘要，未逐节读正文（arXiv 作者版）。取自 F8 | 读的是 arXiv 作者版；期刊版未核实 |
| Kirilenko, Kyle, Samadi, Tuzun 2017 The Flash Crash | DOI 10.1111/jofi.12498；SSRN 1686004 | 期刊（Journal of Finance） | 2010-05-06 E-mini S&P 500 期货闪崩，单日事件 | 不适用；不适用 | 仅摘要（OpenAlex，摘要被截断）。取自 F8 | 只读了摘要 |
| 大模型前视偏差的推理时修正（题名来源未记；来源以此描述） | arXiv 2512.06607 | 预印本 | 来源未记 | 来源未记 | 仅摘要（OA 摘要）；PDF 可下载，未下载。取自 F1 的“值得读未读”表 | 只读了摘要 |

#### 表 B：只到元数据、未读摘要的文献（62 行）

来源对这些条目没有记录市场、窗口、样本外、版本；该部分一律为“来源未记”，这里不逐格重复。“读到哪层”均为仅元数据（检索索引中的题名、年份、标识），除非另注。

| 作者 年份 短题 | 标识 | 状态 | 来源文件与未读原因 |
|---|---|---|---|
| Gornall, Rinaldi, Xiao 2025 Funding Payments Crisis-Proofed Bitcoin's Perpetual Futures | SSRN 10.2139/ssrn.5036933 | SSRN 工作论文 | P5；OpenAlex 无摘要，未读；P5 建议后续补读 |
| Perpetual Futures Pricing with Stochastic Rates and Clamp 2025 | SSRN 10.2139/ssrn.5481866；10.2139/ssrn.5610430 | SSRN | P5；讨论 clamp，未读 |
| Pricing Perpetual Futures 2023 | SSRN 10.2139/ssrn.4573912 | SSRN | P5；纯定价理论，未读 |
| Pricing Power Perpetual Futures 2023 | SSRN 10.2139/ssrn.4422657 | SSRN | P5；纯定价理论，未读 |
| Designing funding rates for perpetual futures 2025 | arXiv 2506.08573 | 预印本 | P5；机制设计，未读 |
| Funding Discontinuities and Arbitrage-Free Pricing of Perpetual Futures 2026 | SSRN 10.2139/ssrn.7321823 | SSRN | P5；理论，未读 |
| The Two-Tiered Structure of Cryptocurrency Funding Rate Markets 2026 | 10.3390/math14020346 | 期刊（MDPI Mathematics） | P5；期刊层级低于入选标准，未读 |
| Conditional Arbitrage Capacity: Crypto Perpetual Funding Rates 2026 | SSRN 10.2139/ssrn.7520320 | SSRN | P5；与 He 等重叠，未读 |
| Limits to Coordination: Funding Drag 2026 | SSRN 10.2139/ssrn.7529458 | SSRN | P5；未读 |
| Anatomy of Cryptocurrency Perpetual Futures Returns 2026 | SSRN 10.2139/ssrn.6365329；10.2139/ssrn.6795783（两个 SSRN 版本） | SSRN | P5；未读 |
| Arbitrage, contract design, and market structure in Bitcoin futures markets 2022 | 10.1002/fut.22305 | 期刊（Journal of Futures Markets） | P5；摘要未核对是否含永续，未读 |
| BitMEX Funding Correlation with Bitcoin Exchange Rate 2019 | arXiv 1912.03270 | 预印本 | P5；短预印本，未读 |
| Reconciling Open Interest with Traded Volume in Perpetual Swaps 2023–24 | 10.5195/ledger.2024.325 | 期刊（Ledger） | P5；数据口径问题，未读 |
| Futures As Prelude: Bitcoin Price Forecasting From Perpetual Futures Data 2022 | SSRN 10.2139/ssrn.4097789 | SSRN | P5；预测价格而非资金费，未读 |
| Two-Regime Liquidity Recovery After a Perpetual Futures Liquidation Cascade 2026 | SSRN 10.2139/ssrn.6636998 | SSRN | P5；Hyperliquid 而非 Binance，未读 |
| Anatomy of the Oct 10–11, 2025 Crypto Liquidation Cascade 2025 | SSRN 10.2139/ssrn.5611392 | SSRN | P5；同一事件，已选 Lim，未读 |
| Cross-coin Heterogeneity in Liquidation Cascade Dynamics 2026 | SSRN 10.2139/ssrn.6883362 | SSRN | P5；山寨币永续，未读 |
| Hidden Liquidity, Displayed Depth, and Execution Risk During a Bitcoin Perpetual Futures Liquidation Cascade 2026 | SSRN 10.2139/ssrn.6891658 | SSRN | P5；未读 |
| Forced Liquidation Cascades in Unregulated Perpetual Futures Markets 2026 | Zenodo 10.5281/zenodo.19975148 | Zenodo 自发布 | P5；未读 |
| Funding as a Coupon 2026 | SSRN 10.2139/ssrn.7256541 | SSRN | P5；理论，未读 |
| Delayed Marks, Funding Memory, and Forecasting Liquidation-Tail Risk 2026 | 10.3390/forecast8050076 | 期刊（MDPI Forecasting） | P5；未读 |
| Measuring the engine of a liquidation cascade 2026 | arXiv 2608.03616 | 预印本 | P5；未读 |
| Wash trading at cryptocurrency exchanges 2021 | 10.1016/j.frl.2021.101982 | 期刊（Finance Research Letters） | P5；与 Cong 等主题重复，未读 |
| Do cryptocurrency exchanges fake trading volumes? 2022 | 10.1016/j.physa.2021.126405 | 期刊（Physica A） | P5；未读 |
| Detecting and Quantifying Wash Trading on Decentralized Cryptocurrency Exchanges 2021 | 10.1145/3442381.3449824 | 会议或期刊（ACM，来源未记具体） | P5；去中心化交易所，未读 |
| Trading Volume Manipulation and Competition Among Centralized Crypto Exchanges 2025 | 10.1287/mnsc.2021.02903 | 期刊（Management Science） | P5；理论为主，未读，可作后续 |
| On the Quality of Cryptocurrency Markets: Centralized vs. Decentralized Exchanges 2026 | 10.1287/mnsc.2024.07703 | 期刊（Management Science） | P5；未读，可作后续 |
| Vidal-Tomás 2022 Which cryptocurrency data sources should scholars use? | 10.1016/j.irfa.2022.102061 | 期刊（International Review of Financial Analysis） | P5；摘要在三个索引里都为空，未取全文；P5 建议后续补读 |
| Competition and Product Quality: Fake Trading on Crypto Exchanges 2020 | SSRN 10.2139/ssrn.3745617 | SSRN 工作论文 | P5；未读 |
| Liquidity Jump, Liquidity Diffusion, and Crypto Wash Trading 2024 | arXiv 2411.05803 | 预印本 | P5；未读 |
| Svogun, Bazán-Palomino 2022 Technical analysis in crypto: transaction costs and bubbles | 10.1016/j.intfin.2022.101601 | 期刊 | P5；摘要在索引里为空，未取全文；二手转述见 Deprez–Frömmel PDF 页 7、页 11 |
| Technical Analysis and Cryptocurrencies 2019 | SSRN 10.2139/ssrn.3387950 | SSRN | P5；未读 |
| Profitability and Data-Snooping Tests of Four Technical Trade Strategies for Cryptocurrencies 2023 | 10.33423/jaf.v23i4.6453 | 期刊（Journal of Accounting and Finance） | P5；期刊层级较低，未读 |
| Size and Weak-form Efficiency in Cryptocurrency Markets 2026 | SSRN 10.2139/ssrn.7639561 | SSRN | P5；未读 |
| Optimizing the moving average trade rule for cryptocurrencies 2024 | 10.1080/13504851.2024.2394211 | 期刊 | P5；检索结果只涉及均线带宽，未见多重检验，未读 |
| Momentum and contrarian effects on the cryptocurrency market 2019 | 10.1016/j.physa.2019.02.057 | 期刊（Physica A） | P5；未读 |
| Trend-following Strategies for Crypto Investors 2023 | SSRN 10.2139/ssrn.4551518 | SSRN | P5；未读 |
| The Dow Theory: William Peter Hamilton's Track Record Reconsidered 1998 | 10.1111/0022-1082.00054 | 期刊（Journal of Finance） | P5；股票市场、非加密，是检索道氏理论时的唯一学术结果，未读 |
| Summoning the Oracle to Slay It: Mitigating Look-Ahead Bias with LLM 2026 | DOI 10.18653/2026.emnlp-main.510 | 会议 | P4；OpenAlex 检索命中，只记题名与标识，未读 |
| Temporal Leakage in LLM Backtesting 2026 | arXiv 2608.02985 | 预印本 | P4；同上 |
| DatedGPT: Preventing Lookahead Bias with Time-Aware Pretraining 2026 | arXiv 2603.11838 | 预印本 | P4；同上 |
| MemGuard-Alpha 2026 | SSRN 6881781 | SSRN | P4；同上 |
| Helm 2026 系列之一（题名来源未记） | figshare 34781523 | 自述报告 | P4；按作者检索命中，未读 |
| Helm 2026 系列之二（题名来源未记） | figshare 34781526 | 自述报告 | P4；同上 |
| Helm 2026 系列之三（题名来源未记） | figshare 34781535 | 自述报告 | P4；同上 |
| Helm 2026 系列之四（题名来源未记） | figshare 34781538 | 自述报告 | P4；同上 |
| Perold 1988 The implementation shortfall: Paper versus reality | 10.3905/jpm.1988.409150 | 期刊（JPM） | F8；OpenAlex 无摘要，未读正文，未核对其定义 |
| Governance and organizational requirements for effective model risk management 2017 | 10.21314/jrmv.2017.188 | 期刊（Journal of Risk Model Validation） | F8；摘要未取到 |
| How Much Sharpe is Illusory? Backtest Overfitting in Crypto Factor Strategies 2026 | SSRN 10.2139/ssrn.7350238 | 预印本（SSRN） | F8；只有题名与元数据 |
| Measuring Backtest-Live Fidelity: A Pre-Registered Framework 2026 | SSRN 10.2139/ssrn.7424681 | 预印本（SSRN） | F8；FC-III 复查 OpenAlex 仍无摘要 |
| Adversarial Backtest Verification 2026 | SSRN 10.2139/ssrn.7338919 | 预印本（SSRN） | F8；只有题名与元数据 |
| High Frequency Trading and the Risk Monitoring of Automated Trading | SSRN 2285407 | SSRN | F8；Crossref 仅有题名，摘要与正文均未读 |
| 加密货币算法交易风险控制论文（题名来源未记） | 10.67546/mu.th.6437969 | 来源未记 | F8；Crossref 只有元数据 |
| Look-Ahead Bias Has No Deflator: Same-Bar Execution Error 2026 | SSRN 10.2139/ssrn.7654039 | 预印本（SSRN） | F1；仅元数据，未读摘要 |
| More Strategies, Same Zero 2026 | SSRN 10.2139/ssrn.7257858 | 预印本（SSRN） | F1；仅元数据 |
| Underpowered by Construction 2026 | SSRN 10.2139/ssrn.7486559 | 预印本（SSRN） | F1；仅元数据 |
| 肥尾下的最短跟踪记录长度（题名来源未记） | SSRN 10.2139/ssrn.7024958 | 预印本（SSRN） | F1；仅元数据 |
| Who Counts the Trials? A Committed Trial Ledger for Enforcing the Deflated Sharpe Ratio 2026 | SSRN 10.2139/ssrn.7187319 | 预印本（SSRN） | F1；仅元数据 |
| The more you automate, the less you see: Hidden pitfalls of autonomous AI scientists 2026 | DOI 10.1073/pnas.2610214123 | 期刊（PNAS） | F1；未取摘要 |
| 幸存者偏差经典论文（QREF 1996，题名来源未记） | DOI 10.1016/s1062-9769(96)90021-6 | 期刊 | F1；仅在检索结果中出现，未读摘要 |
| Construction of a Continuous Stopping Boundary from an Alpha Spending Function 1998 | DOI 10.2307/2533857 | 期刊（Biometrics） | F1；OpenAlex 与 Crossref 有记录，未读摘要 |
| The Safe Logrank Test 2021 | arXiv（编号来源未记） | 预印本 | F1；仅 OpenAlex 标题 |

另有两处来源记录了“没找到”或“排除”，不计入上表：Detzel 等（加密与股票的技术分析学习）在 P5 的检索里没有出现，只在 Deprez–Frömmel PDF 页 1 的转述中得知；F1 面 4 的一条 essoar 结果（10.1002/essoar.10500564.1）为古气候文献，领域不符，未采用。P4 称 Helm 系列共 8 篇，其中 “What Did Not Work” 与 “From Pre-Announcement to Verified Facts” 按题名检索 0 匹配。

#### 账本证据包里引用的来源（产品自己的记录，不是本审计的阅读）

来源 LR §8。账本里没有论文专用记录类型；文献以 `evidence_bundle` 的 agent 包存在。下面的“读到哪层”是账本包里自称的，本审计没有核对。这 5 条不计入表 A、表 B 的行数。

| 来源 | 账本包名 | 状态与读到哪层（按账本记录） |
|---|---|---|
| Hamilton 1922 The Stock Market Barometer | source-hamilton-1922-dow-theory、source-hamilton-line-2026-11-12 | 书，非同行评审，Internet Archive；LR 未写读到哪层 |
| Harvey 等 2018 波动率目标 | source-volatility-targeting-2026-11-12 | 同行评审期刊（JPM）；读了全文作者版 |
| Grossman–Zhou 1993 等；Howden–Andreev 2026 | source-drawdown-control-2026-11-12 | 仅读摘要；Howden–Andreev 为 SSRN 工作论文 |
| Clare 等 2013 等 | source-trailing-stops-2026-11-12 | 检索日志；读到哪层来源未记 |
| 分批入场方向 | source-staged-entry-2026-11-12 | 检索词与摘录；LR 未列具体文献 |

### 汇总说明三项

#### (1) 种子文献里没取到全文的

以下三篇是种子文献，经两轮（P2/P3 与 P6）仍没有取到全文。

| 文献 | 实际读到 | 试过的途径与结果（来源 P2、P3、P6） |
|---|---|---|
| López de Prado 2018（JPM） | 仅元数据；十条清单没读到 | doi.org 返回 429（两次）；pm-research.com 的文章页 429（三次），全文 PDF 403；SSRN 3104816 返回 403，按技能规定不抓取；作者站 quantresearch.org 的 Publications、Lectures 等页 200 但无该文 PDF，Lectures 页只有题为 7 Reasons 的另两份材料（SSRN 3031282、3373116），不是同一份；lopezdeprado.org 200 无 PDF；Cornell 教员页的 PDF 与本文无关；GARP 页提供 PDF 但不是作者、出版方或机构库副本，版权未确认，未下载；smallake.kr 镜像不用 |
| Wiecki 等 2016（Journal of Investing） | 无可引用文字（只有一句自动生成概括，出版方摘要被撤下） | doi.org 429；jai.pm-research.com 404；twiecki.io 主页与博客索引 200 但无本文，猜测的博文路径 404；quantopian.com 连接超时；arXiv 查无此文；SSRN 不抓取；mql5、scribd 等镜像不用；网页检索未找到作者或出版方副本 |
| Hansen 2005（JBES） | P3 读到 OpenAlex 出版方摘要；全文没读到 | doi.org 403；tandfonline.com 403；JSTOR 返回 Client Challenge 页（且该条目编号是猜测的，不作来源）；ideas.repec.org 404；Brown 大学旧主页与工作论文地址无法连接或解析；phansen.web.unc.edu 首探 200、正式抓取 403 人机验证页；UNC 机构库多个地址超时；SSRN 副本按技能规定未抓取；typeset.io、zendy 为第三方镜像，不用 |

补充：Arnott–Harvey–Markowitz 2019 在 P1、P2 两轮没取到，P6 经作者 Duke 主页取到全文，已在表 A 记为全文。表 A 中只到摘要的论文（Hansen、Inan、Lim、Alexander–Deng–Zou、Anghel、Mathematics 2026、Sharpe Ratio Inference 2026、Chordia 等、QF 2022、Unreliable Judges、McLean–Pontiff、Hou 等、Kirilenko 等、arXiv 2512.06607）和只到元数据的论文，见各行“读到哪层”。

#### (2) 读的不是出版版的

来源明确写了读的是工作论文、讨论稿、预印本、接受稿或课程页副本的：

- Harvey–Liu–Zhu：读 NBER w20592（2014 年 10 月版），不是 RFS 2016（P1）。
- Sullivan–Timmermann–White：读 1998 年 10 月 LSE 讨论稿 DP303，不是 JF 1999 印刷版（P3）。
- Bajgrowicz–Scaillet：读作者接受稿，页码为稿件页码（P3）。
- White 2000：读大学课程页上的副本，来源称与期刊页码一致（P3）。
- Bailey 等 2014（Notices）、2016（JCF）、Bailey–López de Prado 2014（JPM）：均读作者稿（2014-04-01、2015-02 修订版、2014-07-31），与出版版的差异没核对（P2）。
- Harvey–Liu 2015：读作者副本，印刷版式；2015 年 7 月工作论文版未读（P1）。
- Arnott–Harvey–Markowitz 2019：读作者主页 PDF，引用期刊页码；与出版版是否逐字一致来源未记（P6）。
- Ackerer 等：读 arXiv v2，期刊版为 Mathematical Finance（P5）。
- He–Manela–Ross–von Wachter：读 arXiv v7；没有期刊版（P5）。
- Cheng 等 2021：读 arXiv v1，期刊版可能有改动（P5）。
- Cong 等：读 2021-07 的 arXiv 早期稿，数字以期刊版为准（P5）。
- Aloosh–Li：读 DCU 机构库版本（2023-08-28）（P5）。
- Ammann 等 2022：读 2022-11-28 稿，工作论文，没查到期刊版（P5）。
- Deprez–Frömmel 2024：读预印本，期刊版可能有差别（P5）。
- Glasserman–Lin：读 arXiv v1，期刊版未取得原刊（P4）。
- Lopez-Lira 等、Gao 等、He–Lv–Manela–Wu、Li 等：读 arXiv 版；Li 等没找到期刊版或 SSRN 版（P4）。
- Novy-Marx–Velikov：读 NBER w20721（F1）。
- Daniel–Moskowitz：读 NBER w20439（2014 年 8 月）（F8）。
- Jensen–Kelly–Pedersen：读 NBER w28432（2021 年 2 月）（F8）。
- Dwork 等：读 arXiv 版（F1、FC-III）。
- Alexander–Fabozzi：读 arXiv 版（F8）。

读到出版版的只有 Hudson–Urquhart 2021（雷丁大学开放获取出版版本，P5）。其余只读摘要的论文没有读正文，无从比较版本。

#### (3) 交易所与规范文档

| 文档 | URL | 读取日期 | 读取方式 | 来源 |
|---|---|---|---|---|
| Binance USDⓈ-M 资金费率说明（Introduction to Binance Futures Funding Rates） | https://www.binance.com/en/support/faq/360033525031 | 2026-11-14 | 经摘要工具（WebFetch），未逐字核对；curl 直连返回 HTTP 202 空体（挑战页），未绕过 | P5 §3.1 |
| Binance 强平协议（Binance Futures Liquidation Protocols） | https://www.binance.com/en/support/faq/360033525271 | 2026-11-14 | 经摘要工具（WebFetch），未逐字核对；curl 返回 HTTP 202 | P5 §3.2 |
| Binance USDⓈ-M 杠杆与保证金（页面更新 2026-03-27） | https://www.binance.com/en/support/faq/leverage-and-margin-of-usd%E2%93%A2-m-futures-360033162192 | 2026-11-14 | 经摘要工具（WebFetch），未逐字核对；分档表是图片或另一页面，BTCUSDT 的具体分档数字没读到 | P5 §3.3 |
| Binance 开发者文档 Notional-and-Leverage-Brackets | https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Notional-and-Leverage-Brackets | 2026-11-14 | 经摘要工具（WebFetch），加载被截断；未调用该端点（需用户鉴权，不碰交易所凭证） | P5 §3.3 |
| Binance 分档调整公告（2022-09-13、2023-12-19、2024-08-02、2024-10-14、2024-10-31 等） | 来源未记 URL | 2026-11-14 | 只看了搜索结果里的公告标题，未读公告正文 | P5 §3.3 |
| SEC Division of Investment Management，Marketing Compliance FAQ（页面注明更新 2026-01-15） | https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/marketing-compliance-frequently-asked-questions | 2026-11-14 | 读取工具来源未记；只读到一处脚注（hypothetical performance），回测业绩的 FAQ 条目在该页未找到 | F8 面 11 |
| SEC 营销规则最终规则 IA-5653（2020） | 来源未记 URL | 2026-11-14 | 没读到：抓取返回 HTML 限流页 | F8 面 11 |
| 17 CFR 275.206(4)-1 | https://www.law.cornell.edu/cfr/text/17/275.206(4)-1（Cornell LII） | 2026-11-14 | 经摘要工具（WebFetch）取得带段号的摘录，不是原文逐字；官方 ecfr.gov 被重定向到拦截页 | FC-IV（检索日志） |
| 美联储 SR 26-2 信函 | https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm | 2026-11-14 | 经摘要工具（WebFetch），未直接读全文 | F8 面 12；FC-IV |
| 美联储 SR 26-2 附件 SR2602a1.pdf | https://www.federalreserve.gov/supervisionreg/srletters/SR2602a1.pdf | 2026-11-14 | 直接取到原文：下载并 pdftotext，读了相关节（fulltext/sr26-2a1.txt） | FC-IV |
| 美联储 SR 11-7（2011；“已被 SR 26-2 取代”只见于 WebSearch 摘要，直接读到的 SR 26-2 附件原文里 grep `11-7`、`supersed`、`replace`、`rescind` 均无命中，不作事实引用） | https://www.federalreserve.gov/boarddocs/srletters/2011/sr1107.pdf | 2026-11-14 | 没读到原文，只有 WebSearch 摘要 | F8 面 12；FC-IV |
| FIA Best Practices for Automated Trading Risk Controls and System Safeguards（2024 年 7 月，24 页） | https://fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf | 2026-11-14 | 直接取到原文：下载并 pdftotext 全文（fulltext/fia-automated-trading-risk-controls-2024.txt） | F8 面 13；FC-IV |
| 欧盟 Delegated Regulation (EU) 2017/589 | EUR-Lex（具体 URL 来源未记） | 2026-11-14 | 没读到：只返回导航页；WebSearch 摘要提到的条款号未核对，不能引用 | F8 面 13 |
| SEC Knight Capital 命令（Release No. 70694，2013-10-16） | 来源未记 URL | 2026-11-14 | 没读到：SEC 网站返回限流页；只有 WebSearch 摘要 | F8 面 13 |
| Anthropic 模型总览页 | https://platform.claude.com/docs/en/about-claude/models/overview（经 docs.claude.com 302） | 2026-11-14 | 经 WebFetch 取得完整页面，检索日志记为无摘要的 markdown；逐字与否来源未记 | FC-IV（检索日志） |
| OpenAI 模型页 | https://developers.openai.com/api/docs/models（经 platform.openai.com 301） | 2026-11-14 | 经摘要工具（WebFetch），模型摘录，不是原页逐字 | FC-IV（检索日志） |
| Google Gemini 模型页 | https://ai.google.dev/gemini-api/docs/models | 2026-11-14 | 没读到：重定向到 aistudio.google.com 未跟随 | FC-IV（检索日志） |
| DeepSeek 截止期页 | 来源未记 | 来源未记 | 未查（IDE 聊天 Agent 可选提供商） | FC-IV |

### 来源之间的矛盾

处理规则：两处读法不同，取读得最深的一次，在此写明。

1. Arnott–Harvey–Markowitz 2019：P1 与 P2 称没取到全文，只有摘要；P6 称从作者 Duke 主页取到全文并抽出 7 类 22 条清单。取 P6。FC-II 另核对了本地全文文本，与 P6 一致。P1 里“二手摘要称七条”与 P6 的 7 类一致，但 P1 当时标为未核实。
2. Bailey 等 2014（Notices）：P2 为全文（作者稿）；F8 与 FC-IV 记为仅摘要首段、正文判别方法没读到。取 P2。FC-IV §11.2 沿用了 F8 的说法，会低估本审计实际读到的深度。
3. Bailey 等 2016（PBO）与 Bailey–López de Prado 2014（DSR）：P2 为全文（作者稿）；F1 记为仅摘要，并把二者列入“值得读全文但没读”。取 P2。
4. Harvey–Liu–Zhu：P1 为 NBER 版全文（101 页）；F8 记为仅摘要，并列入“值得读全文但没读”。取 P1，并注明读的是 NBER 版。
5. Dwork 等 2015：F1 写“全文 arXiv 版”但实际只读了摘要段（第 1 页）；FC-III 读了 p.1–4（摘要、§1、§1.1.1、§1.2）。取 FC-III，记为部分。
6. Cong 等与 Aloosh–Li：P5 为部分全文（章节清单见表 A）；FC-IV 的 13.1 清单标为仅摘要。取 P5。
7. Hansen 2005：P3 读到 OpenAlex 出版方摘要；P6 的记录是仅 OpenAlex 与 Crossref 的元数据，没有摘要。取 P3（摘要）。
8. Gao, Jiang, Yan 的年份：P4 写 2026（arXiv v2，2026 年 6 月）；FC-III 的表格写作 Gao 等 2025。表 A 沿用 P4，不另判断。
9. Anghel 的年份：P5 查到 OpenAlex 记 2020；P5 同时说 Deprez–Frömmel 把它引为 2022。表 A 取 2020，注明被引为 2022。
10. “A Real Edge that Loses” 的标识：P5 写 10.2139/ssrn.7353678，F8 写 SSRN 7353678，同一编号，无冲突；P5、F8、FC-III 都只到元数据。

来源文件内部的数字不一致（不是来源之间的矛盾，记在此处供引用时留意）：

- PBO 作者稿正文写 S=16 时“12, 780”个组合，P2 按 C(16,8) 算得 12,870，判为稿件印刷错误；引用时不要用 12,780（P2）。
- Li 等的 CSI 300 成本在附录 C.4.2 与附录 D.1 写法不同，P4 未核对来源（P4）。
- Lopez-Lira 等关于“只在一侧提示约束”的截止后准确率，正文写 96%，结论写 98%，表 6 有一行为 98.00，P4 照录未判断（P4）。
- Hansen 2005 的卷期页 23(4) 365–380 只来自二手搜索摘要，未核实（P3）。
- PBO 第 3.2 节“真实策略”两个 PBO 数字（0.04% 与 74%），后者位置未逐页核对（P2）。

## 视频证据包

## 附录：视频证据包

### 1. 说明

视频在这次审计里只用来提出问题和说明业界做法。没有一条审计发现以视频为依据；报告里凡是引用视频的地方，都写成"某视频讲者称……"，并且只出现在"提问点"一类的位置。

状态标注：

- 画面核实：claims.json 里带帧引用，复核者打开过帧原图。
- ASR-only：数字只来自语音识别，没有截帧核对。
- 口述，无数字：引文不含数字，只靠转录和时间戳，没有画面。它同样没有经过画面核实。

证据包在 `~/.local/share/video-evidence/bundles/youtube-<ID>/`，其中的 `claims.json` 是每条引用的原始记录（逐字 ASR 引文、段编号、帧引用）。本节不抄原文，只给中文转述。

来源文件（审计工作目录 `/tmp/trade-audit-20261114/phaseA/`）：`video-candidates.md`（搜索与选择）、`video-V1.md`、`video-V2.md`（制作者记录）、`video-review.md`（洁净上下文复核）。

### 2. 搜索与选择

- 检索 46 次（`yt-dlp --flat-playlist` 加 `ytsearch<N>:` 前缀，一次一条，只取元数据，没有下载）。其中 45 条是下表的不同查询，另 1 次是为看返回 JSON 形状而重复的 `Asness factor investing`。
- 返回 0 条且无错误输出的 10 次（下表标 0）。制作者没有把它们当作"没有视频"，但同时并行发出的几条检索曾出现 0 条，后改为逐条串行。
- 元数据探测 17 次（每次一个视频，取上传日期、频道、章节、最高分辨率）：B05Hs2pAAfE、BtiqH_7d2es、n7X49dxOUGA、pmsi5YcCgYQ、-aT55uRJI8Q、BYk538tAysU、cDud_g3-6yU、7She6jj8-cA、__teQiAK0dg、UR4mE6dzmAA、P3rDSh187TE、jtTl_QKxyq4、fOCzNFwmM7Y、8UP7n79Zghw、XZVJ83GLjr0、knPPeV58gHM、vGhzvJbJzEc。无一次探测失败。
- 选择只依据元数据，覆盖面的判断要读过转录才能确认（第 5 节已按转录改写）。入选 7 段，合计 24184 s（约 6 小时 43 分）。其中第 1 段 Harvey 2015 年演讲（B05Hs2pAAfE）没成包（第 6 节），按预定的后备顺序换成同一作者的 Lucky Factors（BtiqH_7d2es）。
- 制作者自己指出的两处做法风险：技能只授权了 `--flat-playlist` 的列表写法，没有单独写 `ytsearch`，制作者把 `ytsearch<N>:` 当作该写法的 URL，旗标集不变；技能写"不要用脚本重复检索或探测"，检索和探测是逐条手动发出，探测用了一个只处理单个 ID 的辅助脚本 `probe1.sh`，同一轮里有时并行发了两条。没有收到 412 或限流。出处：`video-candidates.md` 第 7 节第 1、2 条。
- 去重：本机已有 6 个包（BRUlSm4gdQ4、UD92QBqA8Eo、8Buvxe72evU、rjy6kpS1sTY 复用；7REU98IjHAw、nQDY2sJKx2s 不计入任何面，前者转录只有几个词，后者与本审计无关）。账本里的 `evidence_bundle`、`evidence`、`evidence_content` 三张表没有视频来源（未查 `source_review`、`judgment`、`research_registration` 的文字列，所以只能说"证据包表里没有"）。
- 落选清单（后备、同作者、同一场另一份上传、第三方 Nautilus 教学、带货频道、案例解说频道等）见 `/tmp/trade-audit-20261114/phaseA/video-candidates.md` 第 5 节；后备顺序见第 7 节第 3 条。

搜索日志（日期均为 2026-11-14；N 为 12，s24 为 15）：

| 编号 | 查询词 | 返回 |
|---|---|---|
| s01 | Lopez de Prado backtest overfitting lecture | 12 |
| s02 | Campbell Harvey backtesting and the cross-section of expected returns lecture | 0 |
| s02b | Campbell Harvey backtesting lecture | 10 |
| s03 | deflated Sharpe ratio multiple testing Bailey | 8 |
| s04 | NautilusTrader live trading deployment talk | 12 |
| s05 | Ernest Chan backtest pitfalls look-ahead bias survivorship bias talk | 0 |
| s06 | Chris Sellers Nautilus Trader | 12 |
| s07 | LLM lookahead bias memorization financial forecasting backtest talk | 0 |
| s07b | large language models look-ahead bias finance lecture | 12 |
| s07c | Lopez-Lira LLM look-ahead bias ChatGPT stock return predictability | 6 |
| s07d | lookahead bias in large language models finance research | 12 |
| s08 | Robert Carver systematic trading backtesting overfitting | 12 |
| s09 | Nautilus Trader open source trading platform presentation | 12 |
| s10 | backtest vs live performance gap alpha decay strategy monitoring kill switch | 0 |
| s11 | nautilus_trader Rust event-driven backtest live parity Sellers | 4 |
| s12 | backtest execution assumptions slippage market impact transaction costs lecture | 12 |
| s13 | perpetual futures funding rate liquidation engine explained crypto derivatives talk | 9 |
| s14 | Ackerer perpetual futures pricing funding conference seminar | 0 |
| s14b | perpetual futures funding rate arbitrage seminar academic | 12 |
| s15 | regime change non-stationarity financial markets machine learning lecture | 12 |
| s16 | AI agents autonomous research data snooping finance seminar | 0 |
| s16b | Stefan Zohren LLM agents financial markets seminar | 1 |
| s17 | minimum backtest length sample size statistical power Sharpe ratio estimation error lecture | 2 |
| s18 | Cliff Asness data mining replication factor research talk | 0 |
| s18b | Asness replication crisis factor investing data mining | 0 |
| s18c | Asness factor investing | 12 |
| s19 | David Bailey pseudo-mathematics financial charlatanism backtest | 8 |
| s20 | alpha decay strategy crowding live trading performance degradation quant talk | 1 |
| s20b | quant trading alpha decay | 12 |
| s21 | QuantCon backtest overfitting out of sample live performance Quantopian lessons | 11 |
| s22 | algorithmic trading system failure Knight Capital kill switch risk controls | 12 |
| s23 | Andrew Lo adaptive markets hypothesis lecture | 12 |
| s24 | NautilusTrader | 15 |
| s25 | Nautilus Trader creator talk meetup Python Rust trading engine | 0 |
| s26 | Nautilus Trader Chris Sellers interview | 12 |
| s27 | optional stopping p-hacking researcher degrees of freedom lecture | 5 |
| s28 | quantitative research process hedge fund how to avoid false discoveries panel | 2 |
| s29 | Marcos Lopez de Prado causal factor investing ADIA lecture | 9 |
| s30 | market impact square root law Bouchaud lecture | 0 |
| s30b | Bouchaud market impact | 12 |
| s31 | October 10 crypto liquidation cascade auto-deleveraging Binance analysis | 5 |
| s32 | perpetual futures design mark price insurance fund auto-deleveraging explained | 1 |
| s33 | Wiecki comparing backtest and out-of-sample performance 888 algorithms Quantopian | 1 |
| s34 | Thomas Wiecki backtest overfitting Quantopian | 12 |
| s35 | reproducible research quantitative finance experiment tracking versioning backtest | 2 |

### 3. 证据包身份表

列说明：检查器一列写"制作时 / 复核重跑"，结论以复核者用当前检查器重跑的结果为准；"复核结论"一列逐包照抄 `phaseA/video-review.md` 第 14 节汇总表（2026-11-14 18:08 的版本，第 13 节转录重跑结果已填入，没有未替换的占位符）。4 个复用包的存盘 `check.json` 由旧版检查器（blob `1083cf2b…`）写出，当前检查器（blob `68601c5c…`，与快照及本地 `origin/main` 引用相同）重跑 `ok: true`，各项相同，只是 `flags` 少一项。claims 条数以包内 `claims.json` 为准（见第 9 节自查）。"画面核实的条数"指 claims.json 里带帧引用的条数。时长单位为秒。

| 包 | 标题 | 频道 | 上传日期 | 时长 | 媒体 SHA-256（视频，前 16 位） | 新做或复用 | 检查器（制作时 / 复核重跑） | 转录重跑是否逐字节相同 | claims 条数 | 其中画面核实的条数 | 复核结论 | 实际覆盖的面 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| youtube-BtiqH_7d2es | Lucky Factors | Jacobs Levy Center at the Wharton School | 20180205 | 4203 | 83408b67d56c4265… | 新做（B05 的后备） | ok:true / ok:true | 是 | 41 | 5 | 可引用 | 4、7 为主；5、10、11、12 覆盖；2、3 顺带；8、9 弱 |
| youtube-8UP7n79Zghw | All That Glitters is Not Gold - Thomas Wiecki and Justin Lent | Quantopian | 20160505 | 2470 | 4e81b841984fa3e5… | 新做 | ok:true / ok:true | 是 | 34 | 4（其中 C8 复核认为是读图，不是画面文字） | 可引用 | 4、5 为主；9、2 部分；8、10、12 零星；没有 1、3、6 |
| youtube-cDud_g3-6yU | LLM look-ahead bias and potential solutions | Sean Cao_Fintech | 20250517 | 1752 | 6a76c36df9316d2a… | 新做 | ok:true / ok:true | 是 | 25 | 3 | 可引用（引为"该视频讲者称"；ASR 差） | 1、6 为主（6 限于前视记忆）；2、5 顺带；11 一条 |
| youtube-jtTl_QKxyq4 | Annanay Kapila – Perpetual Futures Everywhere and All the Time (S7E24) | Flirting with Models | 20251229 | 3951 | 10943636a0a65ad0… | 新做 | ok:true / ok:true | 是 | 32 | 0 | 仅作提问用 | 13 为主；3 顺带（交易所自述）；8、11、6 弱 |
| youtube-vGhzvJbJzEc | "3 ways traders kill their trading strategies (and how to avoid them)" - Rob Carver | Better System Trader | 20210222 | 4335 | 593ffdb892ab97cd… | 新做 | ok:true / ok:true | 是 | 29 | 1 | 可引用 | 4 为主；1、3、8、2、5、9；6、11、12 间接或一句；没有 10、13，7 只有间接一条 |
| youtube-7She6jj8-cA | Kevin Webster: "How Price Impact Distorts Accounting P&L" | Cornell Financial Engineering Manhattan CFEM | 20220216 | 3737 | 66c2cb0474be351f… | 新做 | ok:true / ok:true | 是 | 22 | 2 | 可引用（讲大持仓的理论冲击，不能直接套用） | 3 为主；9、8、11、13 少量 |
| youtube-__teQiAK0dg | Adaptive Markets: Financial Evolution At The Speed Of Thought \| Andrew W. Lo \| Talks at Google | Talks at Google | 20170914（画面标题页写演讲日 2017-08-28） | 3566 | c7f99c5036e25ecb… | 新做 | ok:true / ok:true | 是 | 17 | 0 | 可引用（信息密度低，通论性叙事） | 8 为主；2、9、11；6、4 间接 |
| youtube-BRUlSm4gdQ4 | The 7 Reasons Most Machine Learning Funds Fail Marcos Lopez de Prado from QuantCon 2018 | Quantopian | 20190425 | 4416 | ec4b286c2e2dab55… | 复用 | ok:true（存盘为旧版检查器输出）/ ok:true | 是 | 10 | 0 | 可引用 | 4 为主；5、12、10、7；2、3、1、8 带过；没有 6、9、11、13 |
| youtube-UD92QBqA8Eo | "Optimizing Trading Strategies without Overfitting" by Dr. Ernest Chan - QuantCon 2018 | Quantopian | 20181218 | 2777 | ee7dc79021ca435f… | 复用 | ok:true（存盘为旧版检查器输出）/ ok:true | 是 | 5 | 0（制作者与复核各另看 2 张帧，不在 claims.json 里） | 可引用 | 4、8、2、5；3 只有一个成本数 |
| youtube-8Buvxe72evU | LLM-Mined Alpha Factors: How to Kill Lookahead Bias and Overfitting | DeepQuant | 20261026 | 542 | d1bb347151666feb… | 复用 | ok:true（存盘为旧版检查器输出）/ ok:true | 是 | 5 | 0（另有 1 张帧不在 claims.json 里，内容是示例数字） | 仅作提问用 | 1、4、5、6、7、10 |
| youtube-rjy6kpS1sTY | Qlib+RD-Agent深度拆解：AI研究员真的能发现Alpha吗？量化研究平台与自动研究流程全解析（中文） | ApexQuant顶点量化 | 20260712 | 532 | eaca560ffe66942f… | 复用 | ok:true（存盘为旧版检查器输出）/ ok:true | 是（语言 zh） | 8 | 6（其中 5 张支持所述内容，C8 的帧不支持） | 仅作提问用 | 6、1、4、7、10、12；9、3、5 各一句 |
| youtube-B05Hs2pAAfE | The Risks of Historical Backtests | Campbell Harvey | 20150722 | 4373 | 312ca149b217c6a2… | 没成包（原定第 1 段） | ok:false（4 项）/ ok:false（4 项，复核者重跑；制作者记录同） | 复核者没有重跑；制作者重跑一次，与首次逐字节相同（复核者核对两份 SHA-256 相同） | 0（没有 claims.json） | 0 | 不可引用 | 无（没读转录） |

制作者与复核者的核对范围：11 个成包的媒体 SHA-256 由复核者用 `shasum -a 256` 逐行对 `media/SHA256SUMS` 重算，全部一致（11 包共 22 个文件，加 B05 的 2 个）；`claims.json` 的 `transcript_sha256` 等于转录实际 SHA-256。11 个成包的 ASR 由复核者按 `transcribe.md` 的 Reviewer rerun 重跑，语言检测和 PCM SHA-256 与 `run.json` 一致，`cmp` 无输出。

### 4. 复核发现的瑕疵

复核没有发现一条"不符"（引文不在原文、转述不忠实、帧上没有所称内容），发现 11 条瑕疵（引用规范或标注问题，不改变所述事实）：

| 序号 | 包 | claim | 问题 |
|---|---|---|---|
| 1 | 8UP7n79Zghw | C8 | claims.json 标成非 ASR-only 的数字（2.5）。幻灯片是期望最大夏普对试验数的曲线，N=100 处读数约 2.5，但画面上没有"2.5"这个文字；应改写为"读图"，不是画面文字核实。制作者自己在 V1 里写了"目测"。 |
| 2 | 8UP7n79Zghw | C32 | 引文末尾落在被标记（too_dense）的 E645；技能规定被标记段不作引文。claim 的 limitation 自己承认了。 |
| 3 | 8UP7n79Zghw | C25 | 引用范围 E431–E440 内含被标记的 E433、E436，limitation 只写了 E440，没有点名这两段。 |
| 4 | 8UP7n79Zghw | C33 | 转述里"少回测"出自被标记的 E687；引文本身只用了 E684。 |
| 5 | jtTl_QKxyq4 | C16（E544） | 转述写了"指定做市商触及仓位上限"，该内容出自被标记的 E541；claim 只引了 E544，limitation 写了前面几段"大多被标记未引用"，但转述用了它。 |
| 6 | jtTl_QKxyq4 | C5（E603） | 转述里"BitMEX 时代定下"出自被标记的 E604；V1 表里标了 E604 被标记未引用，转述仍写了该内容。 |
| 7 | vGhzvJbJzEc | C15（E607） | "15 万次回测"是讲者在假设的投资委员会对话里的台词，不是他陈述自己跑过的次数；V2 表没有点明是假设对话。claim 标 ASR-only，正确。 |
| 8 | vGhzvJbJzEc | C19（E702–E704） | ASR 丢了动词（"by a factor of two"前后），"抬高夏普约两倍"的方向来自 E700–E701，动词是推断。 |
| 9 | __teQiAK0dg | C5（E361） | 转述"太好的夏普本身是警报"是对"要小心"的引申，原话只说该基金夏普很高但不真实（上文是 Madoff 相关基金）。 |
| 10 | BRUlSm4gdQ4 | V2 表 E679–E692（不在 claims.json 内） | V2 表的引号把 ASR 原文的 "sharp" 改写成 "Sharpe"，与"引文是转录原样"的自述不符。 |
| 11 | rjy6kpS1sTY | C8 | 引用的帧只显示结尾页"本期总结"的标题，要点文字在淡入，帧上读不到 claim 的内容；该条只有语音支撑。 |

另外 8UP7n79Zghw 的 C1 引用范围含被标记的 E023，limitation 已写"仅作上下文"，复核没有计入瑕疵。

限定与未解决的事：

- 讲者身份判断不了：`cDud_g3-6yU` 的讲者没有自报姓名（画面只有一个参会者名牌，与频道名不同），频道名含 Sean Cao，幻灯片列了 "Cao et al. (2024)"，讲者说"我的论文"，与讲者是 Cao 一致但不构成证明。引用写"该视频讲者称"。
- `8Buvxe72evU`：小频道，旁白像脚本，没有署名讲者，判断不了作者是谁；视频不引任何论文，来源弱。
- `rjy6kpS1sTY`：每张帧右下角水印写的名字与频道名不同，视频内没有说两者的关系，判断不了频道是否是原作者或原始发布者；结尾有荐股、配资类招揽，该段没有被引用。
- 利益相关方：`jtTl_QKxyq4` 的嘉宾是所讲交易所的创始人，在节目里推介自家候补名单（C32），内容是利益相关方的自述，设计声明没有数据；视频只用来问机制，不当事实，也不能当作 Binance 的机制。
- `BtiqH_7d2es`：视频里没有口述讲者姓名，由幻灯片页脚确认；页脚年份是版权年，不是演讲日期，没有演讲日期；主办方只到频道名这一层。讨论人 López de Prado 与 BRUlSm4gdQ4 的讲者是同一人，作者只算一次；Quantopian 频道的三个包（8UP7n79Zghw、BRUlSm4gdQ4、UD92QBqA8Eo）是同一发布方的三位不同讲者。
- `UD92QBqA8Eo` 的讲者姓名只来自标题，视频内自述的是其团队；`vGhzvJbJzEc` 的讲者姓名由标题和主持人口述确认，没有自报姓名；`8UP7n79Zghw` 的 Lent 在这一场没有讲话，"主办方"由频道和开场介绍推断。
- 复核者比对检查器 blob 用的是本地 `origin/main` 引用，没有 fetch，远端当前值没核。
- 4 个复用包的存盘 `check.json` 是旧版检查器输出，引用其 `check.json` 前应让制作者用当前检查器重写（复核者没有改）。
- 技能要求的"洁净上下文复核"这次由没有参与制作的复核者做了；制作者的检查器运行不算独立复核。

### 5. 各面的视频覆盖

下表只算已成包且复核为"可引用"或"仅作提问用"的包。面的覆盖按读过转录后的结果写，与候选阶段按章节名推断的不同（尤其是 B05 本来被推断覆盖 2、4、5、7、11、12，没成包后由 BtiqH_7d2es 部分接替）。

| 面 | 有哪些包涉及 | 没找到时用过的查询 |
|---|---|---|
| 1 数据与时点 | cDud_g3-6yU（主线）、vGhzvJbJzEc（幸存者、日期戳、坏数据）、8Buvxe72evU 与 rjy6kpS1sTY（仅提问）、BRUlSm4gdQ4（取样频率，间接） | 无专题缺口 |
| 2 统计功效与样本长度 | vGhzvJbJzEc（样本长度的平方根规律、宽比长）、UD92QBqA8Eo（信号数远少于价格点）、8UP7n79Zghw（至少半年样本外，零星）、cDud_g3-6yU 与 __teQiAK0dg（顺带）、BtiqH_7d2es（短样本一句）。没有专讲功效或最小样本长度的视频，也没有功效计算 | s17（只返回 2 条短教程）；s03、s19 返回的是短讲解 |
| 3 成交真实性 | 7She6jj8-cA（主，大持仓理论冲击）、vGhzvJbJzEc（成本被低估）、jtTl_QKxyq4（交易所自述的清算成交，仅提问）、UD92QBqA8Eo（单边成本数，画面可见）、BRUlSm4gdQ4、BtiqH_7d2es、rjy6kpS1sTY（各一句或概念层）。没找到针对加密永续、订单簿回放、延迟与滑点的专题视频 | s04、s12、s22、s30、s30b |
| 4 多重检验与回测过拟合 | BtiqH_7d2es、vGhzvJbJzEc、8UP7n79Zghw、BRUlSm4gdQ4、UD92QBqA8Eo、8Buvxe72evU（最充分）；__teQiAK0dg 一句 | 无专题缺口 |
| 5 留出与样本外 | BtiqH_7d2es、8UP7n79Zghw、BRUlSm4gdQ4、vGhzvJbJzEc、cDud_g3-6yU、UD92QBqA8Eo、8Buvxe72evU、rjy6kpS1sTY | 无专题缺口 |
| 6 LLM/Agent 研究的认知局限 | cDud_g3-6yU（限于前视记忆，有学术来源的讲座）、vGhzvJbJzEc（默会过拟合与机器学习的类比，间接）、8Buvxe72evU 与 rjy6kpS1sTY（仅提问）、__teQiAK0dg（比喻）。没有专讲 Agent 自评、自己写的结果自己审的视频 | s07、s07b、s07c、s07d、s16、s16b |
| 7 停止规则 | BtiqH_7d2es（对一批候选的统计停止规则，不是"何时停止研究"的组织规则）、BRUlSm4gdQ4（回测不是研究工具、该放弃）、8Buvxe72evU（失败即弃，仅提问）。没找到专讲何时停止研究或序贯检验的视频 | s27、s28（返回无关结果） |
| 8 非平稳与制度变化 | __teQiAK0dg（主，通论）、vGhzvJbJzEc、UD92QBqA8Eo、8UP7n79Zghw（样本外时段集中）、7She6jj8-cA（冲击系数随波动和流动性变）；来源偏通论 | 无专题缺口；s15 的两个结果未入选 |
| 9 验证到上线 | 8UP7n79Zghw（回测与实盘不符、回测里波动率和回撤可信而收益不可信）、vGhzvJbJzEc（回测高估、公开规则衰减）、__teQiAK0dg、rjy6kpS1sTY（仿真实盘一关，仅提问）、UD92QBqA8Eo（持续重估）、7She6jj8-cA（账面与兑现的落差）。没找到策略衰减监测、kill switch 的合格视频 | s10、s20、s20b、s22（只返回零售或案例解说） |
| 10 可复现 | BRUlSm4gdQ4（自动记录每次访问数据）、BtiqH_7d2es（永远不知道真实试验数）、8UP7n79Zghw（论文不披露试验数）、vGhzvJbJzEc、8Buvxe72evU、rjy6kpS1sTY。没有专讲可复现的视频 | s35（只返回 2 条短教学） |
| 11 向用户呈现不确定性 | BtiqH_7d2es（追问试验数、错误取舍与投资者商量）、__teQiAK0dg、vGhzvJbJzEc、7She6jj8-cA、cDud_g3-6yU、jtTl_QKxyq4（各一两句）。没有专题视频；制作者没有查"不确定性呈现、决策界面"类关键词，只能说没搜到，不能说没有 | 没有针对这一面的查询 |
| 12 研究组织与独立验证 | BtiqH_7d2es、BRUlSm4gdQ4、8UP7n79Zghw、vGhzvJbJzEc、rjy6kpS1sTY、__teQiAK0dg（各一两条）。没找到讲独立验证或模型风险审查的视频 | s28（只返回 2 条无关） |
| 13 其他 | jtTl_QKxyq4（资金费、清算引擎、保险基金与自动减仓、标记价，仅提问）、vGhzvJbJzEc（坏数据）、7She6jj8-cA（讲者自述只熟悉股票）、BRUlSm4gdQ4（论文撤回率）。没找到 NautilusTrader 官方或作者本人的分享，只有第三方教程；没找到合格的"自动化交易系统运行故障"视频 | Nautilus：s04、s06、s09、s11、s24、s25、s26；运行故障：s22 |

### 6. 没成包的一段：youtube-B05Hs2pAAfE（审计记录 20261114-40）

事实（制作者记录加复核者重核）：

- 身份：Harvey，The Risks of Historical Backtests，频道 Campbell Harvey，上传日 20150722，时长 4373 s，1080p；探测、下载、解码检查、媒体阶段检查器、帧网格（730 帧）都通过。
- 转录用技能的 argv 一次跑通，产出 `asr/transcript.json`（1,172,920 字节）。879 段、语言 en。全文只有两处非有限数，都在字段 `avg_logprob` 上，值是 `NaN` 字面量：第 0 段（0.0–0.26 s，文本为一个感叹号）和第 1 段（28.58–29.98 s，文本为 Backtesting 一词）。其余 877 段该字段是有限的负数，`compression_ratio` 和 `words[].probability` 全部有限。Python `json.loads` 默认读得进来。
- 检查器重跑：exit 1，`ok: false`，2986 项里 4 项失败：`bundle readable_json:asr/transcript.json`（non-finite number NaN）、`asr schema_known`、`asr transcript_nonempty`、`asr detected_language`（en detected vs None transcribed）。后三项是第一项的连带。
- 原因：`check_bundle.py:76-86` 的严格 JSON 加载器（`finite()` 加 `parse_constant`）对非有限数抛 ValueError，写一条失败的 `readable_json` 检查，并把该文档当作空 `{}` 返回；第 70 行文档字符串写明"重复键和非有限数一律拒绝"，这是有意的严格；第 529 行对包内所有 JSON 一视同仁。后三项失败来自 `asr_checks()`（第 374–388 行）拿到空文档。`check_bundle.py` 里没有任何地方读 `avg_logprob`（grep 0 处）；`asr_schema()`（第 261–270 行）只要求 `compression_ratio` 和 `words` 的数字字段。也就是说，被拒绝的字段本身不参与任何判断。
- 重跑一次：制作者删掉 `asr/` 重跑了一次完整转录（温度 0），与首次逐字节相同，同样 4 项失败；留存副本 `/tmp/trade-audit-20261114/phaseA/B05-asr-run1.json`，复核者核对其 SHA-256 与现存转录相同。没有第二次重跑。
- 技能对此没有规定：`SKILL.md`、`references/bundle.md`、`transcribe.md` 里没有关于 NaN、非有限数或 `avg_logprob` 的说明；`acquire.md` 的 Failures 表只列下载与探测的症状，没有 ASR 或检查器失败这一行，适用"无对应行：最多再跑一次"，制作者符合。`tests/video_evidence/test_check_bundle.py:248` 有一例非有限数（把 `end` 换成 `1e999`），没有 NaN 的 `avg_logprob` 用例；`.agents/evals/video-evidence` 里没有 NaN 用例（grep 无命中，复核者没有通读测试文件）。
- 制作者没有编辑转录，没有给 ASR 加配方之外的参数，没有留 `asr/FAILED`（该约定针对阶段本身没产出的情形），没有读这份转录，因此没有 claims。
- 复核者的判断：从包内证据下不了定论的两点是"转录不可用"（没有证据，但没有读其内容）和"检查器拒绝了一个没有被用到的字段"（是事实）。放宽加载器、只对 `avg_logprob` 容忍 NaN、还是换转录方式，都是对检查规则的修改，属 `AGENTS.md` 里需要用户授权的事项，审计中没有做。
- 影响：这条的 claims 没有，第 1 段的位置由 BtiqH_7d2es 接替，面 2、4、5、7、11、12 的覆盖按第 5 节为准。只在这一条上复现（同批其余三条 NaN 计数 0），不知道其他视频会不会触发。

### 7. claims 清单

编号用 claims.json 里的顺序 C1、C2……（与制作者表格同号）；时间是制作者表格所列行的起点，claim 本身引的段可能略晚；"面"为 1–13 编号。每包最多列 15 条与审计面最相关的：11 个包共 228 条 claims，本节列出 133 条，每条都标了核实状态，其中画面核实 19 条、ASR-only 22 条、口述无数字 91 条、帧读不到所称内容 1 条（按本节各表"核实状态"一列计数）。也就是说，列出的条目里数字只来自语音的有 22 条，带帧引用并经复核者看过原图的有 19 条。没有列出的 95 条的状态只在包内 `claims.json` 与制作者记录里。涉及被标记段的条目在转述后注明。原文片段在包内 `claims.json` 的 `quote` 字段。

#### 7.1 youtube-BtiqH_7d2es（Harvey，Lucky Factors；claims 41 条，列 15 条）

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E092） | 07:28 | 4 | 讲者在一次内部研讨会见到的回测：日频、夏普约 1、回撤小，看起来很漂亮 | 画面核实（幻灯片 SR=1，来源 AHL Research） |
| C5（E116–E117） | 09:34 | 4 | 按试验次数（此例 100）和样本长度给夏普打折，而不是笼统打五折 | 画面核实（Number of tests = 100） |
| C7（E126–E127） | 10:20 | 4 | 试验数要按相关性折算，一百个高度相关的策略不算一百次独立检验 | ASR-only |
| C10（E187） | 15:21 | 4 | 两个标准差规则检验 100 个变量，几乎必有一个靠运气显得显著 | 画面核实 |
| C12（E277–E279） | 23:10 | 7 | 停止规则：真实数据里最好的 t 值不超过自助法零分布的 95 分位就停手 | 口述，无数字 |
| C13（E294–E295） | 24:35 | 7 | 序贯程序：每宣布一个真因子就剔除并重做，直到真实 t 值不再超过门槛 | 口述，无数字 |
| C16（E354–E355） | 29:09 | 4 | 共同基金：控制非正态、相关性和数据挖掘后约 8% 显著跑输 | 画面核实 |
| C17（E375） | 30:45 | 4 | 对 293 个因子用该方法，只有 15 个存活（293 在 E362，只有 ASR） | 画面核实（15 个存活） |
| C18（E382–E383） | 31:14 | 3 | 换到大中盘后同批因子都不显著，显著性主要来自极小盘股 | 口述，无数字 |
| C21（E493–E494） | 41:09 | 4 | 金融经济学已报告的实证发现一半以上很可能是假的（论文名要回到论文核对） | ASR-only |
| C29（E625） | 53:11 | 11 | 收到带漂亮回测的提案不代表什么，要追问试验了多少次 | 口述，无数字 |
| C30（E634） | 53:47 | 10 | 人们并不知道实际试验数，别人的试验会以信息泄露形式传给你 | 口述，无数字 |
| C32（E671–E672） | 56:55 | 5 | 留出法可以反复跑到想要的结果，因为不控制试验次数 | 口述，无数字 |
| C35（E682） | 57:58 | 8 | 投资者不断改变博弈，所以信号总是很弱（López de Prado 的发言） | 口述，无数字 |
| C36（E698–E700） | 59:06 | 12 | 制药业十次试验九次失败不披露，类比金融研究不披露试验 | ASR-only |

另有 26 条见包内 claims.json。

#### 7.2 youtube-8UP7n79Zghw（Wiecki，All That Glitters is Not Gold；claims 34 条，列 15 条）

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C2（E025–E030） | 02:03 | 9 | 一个参赛算法回测两年盈利 800%、几乎无亏损月 | ASR-only |
| C3（E043–E046） | 02:51 | 9 | 该算法上线后实盘与回测承诺不符，促使团队研究回测过拟合 | 口述，无数字 |
| C8（E134） | 07:51 | 4 | 论文图：真实夏普为零时，试验约一百次就很可能得到约 2.5 的最大夏普 | 读图（claims.json 标非 ASR-only，复核认为画面上没有该数字文字，见第 4 节瑕疵 1） |
| C9（E151） | 08:41 | 10 | 学术论文不披露跑了多少次回测，无法复现 | 口述，无数字 |
| C10（E160–E161） | 09:17 | 4 | 平台有 7 万多用户、300 多万次带时间戳的回测 | 画面核实 |
| C13（E237） | 13:41 | 2 | 清洗后只剩 888 个算法（约 7000 个初始，E187） | 画面核实（888） |
| C14（E208–E210） | 12:07 | 2 | 只保留至少半年样本外的策略 | ASR-only |
| C19（E312–E315） | 17:57 | 9 | 回测里的波动率和回撤可信，收益不可信 | 口述，无数字 |
| C20（E339–E340） | 19:45 | 4 | 回测天数总量（试验量代理）与样本外夏普负相关 | 口述，无数字 |
| C21（E347–E348） | 20:10 | 4 | 试验量越大，样本内外夏普差越大 | 口述，无数字 |
| C24（E424–E425） | 25:10 | 5 | 机器学习结果是跨策略随机切分，训练集看到了"未来"，讲者承认是局限 | 口述，无数字 |
| C26（E459–E467） | 27:21 | 2 | 线性预测样本外夏普的 R² 只有 0.02 | 画面核实（0.02；0.17 在 C27，ASR-only） |
| C29（E536–E538） | 32:07 | 8 | 局限：样本外多从 2015 年起，下半年市场动荡可能驱动结果 | ASR-only |
| C32（E644–E645） | 38:16 | 7 | 听众担心用户对公开的过拟合检测指标本身过拟合，讲者承认可能（引文末尾落在被标记段，见瑕疵 2） | 口述，无数字 |
| C34（E693–E694） | 40:36 | 4 | 提到把回测次数计入的 deflated Sharpe ratio，说可以用这批数据检验，尚未做 | 口述，无数字 |

另有 19 条见包内 claims.json。

#### 7.3 youtube-cDud_g3-6yU（Cao，LLM look-ahead bias；claims 25 条，列 15 条）

ASR 质量差（GPT 写成 GBT、GPD、phone 等），引文保留原样，转述按幻灯片与上下文纠正，limitations 里已标明。

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E018–E020） | 01:09 | 1 | 用预训练 LLM 站在 2019 年预测 2020 年，模型参数里已含事后信息，等于已知答案去预测答案 | 口述，无数字 |
| C2（E015） | 00:54 | 6 | 举例的模型训练截止到 2023 年 10 月 | 画面核实 |
| C4（E062–E063） | 03:57 | 6 | 在提示词里叫模型别用未来信息无效，未来信息已在参数里 | 口述，无数字 |
| C5（E073–E075） | 04:42 | 6 | 讲者明确说提示词禁止使用未来信息不起作用 | 口述，无数字 |
| C7（E107–E108） | 06:58 | 1 | 去掉公司名后预测表现显著下降（没有给幅度） | 口述，无数字 |
| C8（E117–E118） | 07:24 | 1 | 去名只能缓解，不能完全消除前视偏差 | 口述，无数字 |
| C10（E181） | 11:22 | 1 | 站在知识截止日之后预测之后的事，没有来自该模型的前视偏差（讲者断言） | 口述，无数字 |
| C11（E195） | 12:17 | 1 | 模型若带联网搜索，会拿到事后信息，要关掉 | 口述，无数字 |
| C12（E200） | 12:37 | 2 | 截止日之后只有约两年可测 | ASR-only |
| C14（E232） | 14:29 | 1 | 解法二：只在知识截止日之后做预测，局限是测试期很短 | 口述，无数字 |
| C15（E244） | 15:27 | 5 | 解法三：自己训练模型控制训练、验证、留出的时间线（幻灯片列了相关论文与滚动表） | 画面核实 |
| C18（E285–E286） | 18:14 | 6 | 做预测就用解法二或三，都是控制训练样本时间线 | 画面核实 |
| C21（E318） | 20:15 | 6 | 更稳妥的用法：让 LLM 做研究助理（读文本、分类、抽特征），不直接做预测 | 口述，无数字 |
| C22（E373） | 24:39 | 6 | 讲者承认做分类时模型同样带前视信息 | 口述，无数字 |
| C25（E432） | 28:55 | 6 | 告诉模型要预测什么后它是否会用相关信息：讲者答"可能会，可能不会"，即不确定 | 口述，无数字 |

另有 10 条见包内 claims.json。

#### 7.4 youtube-jtTl_QKxyq4（Kapila，Perpetual Futures；claims 32 条，列 15 条；仅作提问用）

全部数字 ASR-only，视频无幻灯片，没有任何画面核实；嘉宾是所讲交易所创始人，内容是设计自述。

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C2（E133–E134） | 11:13 | 13 | 资金费机制：合约相对标的溢价或折价时，多空之间互相付费，激励套利拉回 | 口述，无数字 |
| C3（E596–E598） | 42:09 | 13 | 资金费结算频率的权衡：太长做市商锁资本久，太短瞬间闪崩也要大额付费 | 口述，无数字 |
| C5（E603） | 42:45 | 13 | 加密永续常见的利率分量为每 8 小时 1 个基点（转述里"BitMEX 时代定下"来自被标记段，见瑕疵 6） | ASR-only |
| C7（E621） | 44:00 | 13 | 用户疑问：为什么持有股票永续多头要付年化约 10%；讲者归因于硬编码利率 | ASR-only |
| C9（E494–E495） | 35:45 | 13 | 清算分阶段：下单门槛、代为平仓门槛、closeout 门槛 | 口述，无数字 |
| C10（E514–E516） | 37:02 | 13 | closeout 门槛的目的：避免穿仓，否则要动用准备金 | 口述，无数字 |
| C11（E517–E518） | 37:12 | 3 | 紧急平仓时订单簿上往往已无流动性，所以要预先约定的接盘方 | 口述，无数字 |
| C12（E502） | 36:07 | 3 | 该交易所清算先内部撮合，按中间价或标记价成交，不冲击订单簿（交易所自述，不是成交真实性的实证） | 口述，无数字 |
| C13（E523–E524） | 37:29 | 3 | 指定做市商事先签约承接清算成交，极端行情下可要更大价差 | 口述，无数字 |
| C16（E544） | 39:07 | 13 | 保险基金耗尽时用自动减仓（ADL，传统市场叫 tear-up）作为最后手段（转述用了被标记段的内容，见瑕疵 5） | 口述，无数字 |
| C19（E414–E415） | 29:44 | 13 | 周末标的不交易时，标记价向标的最后已知价格偏置 | 口述，无数字 |
| C22（E445） | 32:07 | 13 | 价格带太窄，周末大幅波动会造成跳空，可能出现负余额 | 口述，无数字 |
| C24（E745） | 52:29 | 13 | 标记价公式：本所最新成交价与买卖价，加上与标的基差的指数滑动平均 | 口述，无数字 |
| C26（E434–E435） | 31:15 | 11 | 创始人承认周末标记价做法与多数交易所不同，对错待观察 | 口述，无数字 |
| C32（E297–E298） | 21:11 | 11 | 讲者是该交易所创始人并推介自家候补名单，立场有利益 | 口述，无数字 |

另有 17 条见包内 claims.json。

#### 7.5 youtube-vGhzvJbJzEc（Carver；claims 29 条，列 15 条）

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E075–E076） | 5:15 | 8 | 回测失效的第一类原因：世界会变，未来不像过去 | 口述，无数字 |
| C3（E095） | 6:37 | 1 | 日期戳错：以为某时点已有的数据其实晚几分钟到几天才有 | 口述，无数字 |
| C5（E106） | 7:28 | 3 | 成交假设：实际市场冲击比预想大得多 | 口述，无数字 |
| C6（E262–E263） | 18:31 | 9、4 | 过拟合的后果之二：回测业绩被高估（不同于实盘差） | 口述，无数字 |
| C9（E332） | 22:27 | 3、8 | 成本按风险调整后度量；回溯数十年成本无从得知 | 口述，无数字 |
| C12（E440–E441） | 29:38 | 5 | 滚动（walk-forward）：每步只让计算机看过去 | 口述，无数字 |
| C13（E507） | 34:02 | 4 | 隐性拟合：自己改规则、重跑、选更好的一个，就是拟合 | 口述，无数字 |
| C14（E603） | 40:03 | 4、10、12 | 大公司研究系统记录研究员每一次回测，事后可据此折扣 | 口述，无数字 |
| C15（E607） | 40:23 | 4 | 假设的投资委员会对话里的台词，研究员已跑 15 万次回测（不是讲者自述，见瑕疵 7） | ASR-only |
| C16（E615） | 40:59 | 4 | 测 500 个模型、99% 阈值，靠运气会有约 5 个过线（口述举例） | ASR-only |
| C18（E666） | 44:49 | 4、6 | 默会过拟合：研究者凭已发表论文和业界常识知道什么管用，等于用了别人试过的结果 | 口述，无数字 |
| C19（E702–E704） | 46:53 | 4 | 例：只允许快线快于慢线，自测夏普被抬高约两倍（动词是推断，见瑕疵 8） | ASR-only |
| C22（E921） | 58:21 | 9、8 | 公开的规则一旦被人发现就失效，高频策略衰减很快 | 口述，无数字 |
| C24（E989–E990） | 62:26 | 2 | 参数估计的精度随时间平方根改善（10 年比 5 年好 1.44 倍，数字未核） | 口述，无数字 |
| C29（E183–E184） | 13:37 | 4、5 | 幻灯片图：样本外误差随模型复杂度先降后升（出处 Hastie 等 2009 图 2.11） | 画面核实 |

另有 14 条见包内 claims.json。

#### 7.6 youtube-7She6jj8-cA（Webster，价格冲击与账面 P&L；claims 22 条，列 15 条）

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E032–E034） | 3:17 | 3 | 幻灯片引 Caccioli、Bouchaud、Farmer（2012）：按当前成交价盯市有缺陷，应按清算冲击重估，去掉"利润幻觉" | 画面核实 |
| C2（E262–E263） | 19:54 | 3、9 | 账面（盯中价）P&L 高估持仓最终平仓的 P&L | 口述，无数字 |
| C3（E374） | 28:52 | 3 | "持仓膨胀"：即使计入清算成本，账面 P&L 仍有偏差 | 口述，无数字 |
| C4（E494–E496） | 36:16 | 3 | 即便价格是鞅且计入交易成本，建仓阶段账面上也会机械地"盈利"（推高全额，只付一半冲击） | 画面核实 |
| C8（E322–E323） | 24:10 | 3 | 看到中价成交不等于自己能以此价成交 | 口述，无数字 |
| C9（E324） | 24:24 | 3 | 不同交易者因算法和延迟，实际成交价不同 | 口述，无数字 |
| C10（E340） | 25:52 | 3 | 账面 P&L 按中价盯市，优点是不依赖模型、易达成共识 | 口述，无数字 |
| C12（E617） | 43:43 | 3、9 | 最优执行引擎最大化的"基本面"P&L 与风控看到的账面回撤不一致 | 口述，无数字 |
| C13（E689） | 47:51 | 3、11 | 讲者自述持仓膨胀只在两类情形下证明过，一般性是猜想 | ASR-only |
| C16（E709） | 50:28 | 3、8 | 冲击模型在尾部（大小和持续时间）上分歧 | 口述，无数字 |
| C17（E710） | 50:39 | 3 | 口述举例：一个拟合模型的时标约两三天，另一些以月计 | ASR-only |
| C19（E726） | 53:27 | 11、9 | 对交易员主要是沟通工具：别为尚不可持续的盈利提前庆祝 | 口述，无数字 |
| C20（E827–E828） | 59:46 | 3、8 | 冲击系数通常随波动率上升、随订单簿流动性反比变化 | 口述，无数字 |
| C21（E830） | 59:56 | 3 | 危机期数据不足以单独拟合危机模型，只能假设系数随波动与流动性缩放 | 口述，无数字 |
| C22（E842） | 60:44 | 13 | 讲者承认自己只熟悉股票，不确定是否适用于其他资产 | 口述，无数字 |

另有 7 条见包内 claims.json。该讲的是大持仓的理论冲击，本产品是小额合约，只能用来问"成交假设在哪个规模失效"。

#### 7.7 youtube-__teQiAK0dg（Lo，Adaptive Markets；claims 17 条，列 15 条）

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E079–E080） | 5:11 | 8 | 稳定环境里传统投资框架合理，只在那种环境里 | 口述，无数字 |
| C2（E085–E086） | 5:37 | 8、9 | 不稳定环境中，动态政策要取代静态投资政策 | 口述，无数字 |
| C3（E272） | 16:31 | 8 | 市场不是有效或无效，而是适应变化的条件（讲者自己的假说，视频没有检验） | 口述，无数字 |
| C4（E240） | 14:51 | 8 | 例：手机覆盖前鱼价波动大得多，技术改变市场结构（引 Jensen 2007，未核） | 口述，无数字 |
| C5（E361） | 21:09 | 4、9 | 四条资产中一条（Madoff 相关基金）夏普很高但不真实；"太好的夏普是警报"是转述引申（见瑕疵 9） | 口述，无数字 |
| C6（E420–E421） | 24:39 | 12、5 | Peltzman 效应争论多年，直到有人用能控制混杂的情形才定论 | 口述，无数字 |
| C8（E663） | 39:44 | 6、2 | 人的判断像稀疏数据上的模式匹配，会系统性出错（比喻） | 口述，无数字 |
| C9（E838–E839） | 49:57 | 8 | 口述：人类行为过去六万年变化不大，环境因技术而变 | ASR-only |
| C10（E940） | 55:12 | 2、6 | 数据少要靠很多假设，数据大几乎不需要 | 口述，无数字 |
| C11（E952） | 55:45 | 2 | 宏观经济学家只有二三十年的季度 GDP 数据 | ASR-only |
| C12（E954） | 55:57 | 2、4 | 样本少时必须加的假设效果不好 | 口述，无数字 |
| C13（E966–E968） | 56:34 | 11 | 投资前先了解自己，设问"你能承受吗" | 口述，无数字 |
| C14（E970–E971） | 56:50 | 11 | 问投资者：组合一周内可能亏二三成，你准备好了吗 | ASR-only |
| C15（E999–E1000） | 58:14 | 8、9 | 波动率低时 Peltzman 效应起作用：人们把消失的风险补回去 | 口述，无数字 |
| C17（E1011） | 58:50 | 9 | 市场是动态的，持仓监控也要同样动态 | 口述，无数字 |

另有 2 条（C7、C16）见包内 claims.json。该包没有任何一条经画面核实（画面是讲者镜头，没有图表）。

#### 7.8 youtube-BRUlSm4gdQ4（López de Prado，复用；claims 10 条，全列）

全部没有画面（讲者加讲台，无幻灯片）；数字类说法都是口述。

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E128） | 10:04 | 4、12 | 研究小组常见产出是回测过拟合：跑上百万次模拟，把最好的报给投委会 | ASR-only |
| C2（E174） | 13:00 | 3、12 | 团队按职能分工，回测专员关心交易成本、能否成交、以什么价成交 | 口述，无数字 |
| C3（E716–E717） | 48:52 | 4 | 对不可预测序列做一千次回测，期望最大夏普约 3；百万次约 5 | ASR-only |
| C4（E727） | 50:43 | 4、12 | 顶刊论文的试验次数无人记录，检验按单次试验设阈值 | 口述，无数字 |
| C5（E817） | 56:43 | 4、7、10 | 研究平台自动记录每次访问数据，访问越多越被惩罚 | 口述，无数字 |
| C6（E819–E820） | 56:43 | 4、7、10 | 示例：访问 500 次、一万次试验后才拿到夏普 5；"在某点上该放弃"（数字为口述举例，引文本身不含） | 口述，无数字 |
| C7（E928） | 64:56 | 4、5、7 | 回测不是研究工具：一旦进入回测，研究就已结束 | 口述，无数字 |
| C8（E933–E934） | 64:56 | 4、5、7 | 不能先从回测里学了再复用其结论 | 口述，无数字 |
| C9（E937） | 64:56 | 4、5、7 | 若一定要复用，须控制试验数并折算夏普（制作者表同一行） | 口述，无数字 |
| C10（E1039） | 72:47 | 4、12 | 要警惕在同一数据集上是否已用尽运气；社区平台可替大家记录实验次数 | 口述，无数字 |

#### 7.9 youtube-UD92QBqA8Eo（Chan，复用；claims 5 条，全列）

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E023） | 2:00 | 2、4 | 交易信号数远少于价格数据点，按历史优化参数极易挑樱桃 | 口述，无数字 |
| C2（E028） | 2:00 | 2、4 | 同上，所得模型对样本外没有预测力 | 口述，无数字 |
| C3（E057） | 3:45 | 8 | 制度和微观结构变化使旧数据对优化失去意义（以配对交易为例） | 口述，无数字 |
| C4（E394） | 27:14 | 4 | 拟合时间序列模型可以，拟合交易模型不行 | 口述，无数字 |
| C5（E617） | 39:07 | 2、5 | 优化的是 1 万条模拟路径的平均夏普，一条真实路径的最优参数可以不同，样本外像飞镖落点 | 口述，无数字 |

claims.json 之外，V2 与复核者各看过 2 张帧（模拟序列约 3.7 年、1 万条、单边 1.8 bps；最优 k 的两个取值），内容与口述一致，但没有写进 claims.json。

#### 7.10 youtube-8Buvxe72evU（DeepQuant，复用；claims 5 条，全列；仅作提问用）

小频道、旁白像脚本、无引用、无数据。

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1（E004） | 0:16 | 6、1 | LLM 训练文本写于事件之后，提出的因子可能已编码后续结果 | 口述，无数字 |
| C2（E013） | 0:47 | 4、6 | 让模型给一千个候选，样本内最佳必然漂亮，因为取了搜索空间的最大值 | 口述，无数字 |
| C3（E077） | 5:17 | 5、7 | 留出集只用一次，冻结定义、事先写好决策规则 | 口述，无数字 |
| C4（E082） | 5:17 | 5、7 | 失败就弃，不调；打开五次的留出集已是第五个验证集 | 口述，无数字 |
| C5（E108） | 8:06 | 6 | LLM 是快速的假设生成器，不是证据来源 | 口述，无数字 |

#### 7.11 youtube-rjy6kpS1sTY（ApexQuant，Qlib+RD-Agent，中文，复用；claims 8 条，全列；仅作提问用）

claims.json 里这 8 条只有 `value`（中文要点），没有 `quote`。

| claim | 时间 | 面 | 转述 | 核实状态 |
|---|---|---|---|---|
| C1 | 0:30 | 无 | 标题页帧（Qlib + RD-Agent深度拆解），无引文 | 画面核实（仅标题页） |
| C2（E062） | 2:48 | 1 | 第一关：时点。财报修订、指数成分调整、退市；只用今天的最终库会把未来信息带回过去 | ASR-only |
| C3（E095） | 4:02 | 2、4 | IC、Rank IC、ICIR 好不代表组合赚钱，可能只在小市值、高换手或与既有因子重复 | ASR-only |
| C4（E114） | 4:40 | 6、12 | RD-Agent 循环读材料、提假设、写代码、跑实验、反馈，降低提出和验证想法的成本 | 画面核实 |
| C5（E138） | 5:30 | 6、4 | 人一天十个想法时纪律靠人维持；AI 一天一千个且无更严验证，就成了自动找历史巧合的机器（十个、一千个为口述） | 画面核实 |
| C6（E156） | 6:07 | 7、10、5、8 | 六道关：数据审计、研究集与失败记录、独立样本外、滚动验证、组合与成本、仿真实盘 | 画面核实 |
| C7（E189） | 7:16 | 9 | 第六关：仿真实盘只记录不下单，观察信号延迟、数据缺失、调仓稳定性和可成交价格 | 画面核实 |
| C8（E213） | 8:13 | 6、12 | 研究自动化后研究员的价值转向设问、证伪标准、数据审计和风险边界 | 复核认为帧读不到所称内容，只有语音支撑（见瑕疵 11） |

### 8. 没做的

- 论文核对：讲者提到的论文没有回到原文核对，除非该论文在报告的论文阅读深度表里（例如 Bailey 等的 Pseudomathematics and Financial Charlatanism、Harvey 与 Liu 的 Haircut Sharpe ratio 和 Lucky Factors、Gu-Kelly-Xiu 2020 等，视频里只有题名或 ASR 转写）。
- 联网查证频道与讲者身份：复核者没有联网，身份判断只依据包内证据（第 4 节）。
- 备份：没有设置 `VIDEO_EVIDENCE_BACKUP`，没有做备份步骤。
- `note.md`：7 个新包都没有写（任务没有要求）；`youtube-7REU98IjHAw` 与 `youtube-rjy6kpS1sTY` 原有 `note.md`，复核和制作者都没有依赖它。
- 其他：没有做 `--restored` 子集检查（技能的 retained subset 属研究回合）；B05Hs2pAAfE 没有读转录，没有 claims；检查器没有因此被改（改动需要用户授权）。

### 9. 自查：claims 条数

条数由脚本逐包读取 `claims.json` 的 `claims` 数组得到，与第 3 节身份表逐一核对；结果写在本节末尾。

脚本自查结果（身份表 claims 条数 / 包内 claims.json 条目数 / 第 7 节列出条数，身份表共 12 行）：BtiqH_7d2es 41/41/15；8UP7n79Zghw 34/34/15；cDud_g3-6yU 25/25/15；jtTl_QKxyq4 32/32/15；vGhzvJbJzEc 29/29/15；7She6jj8-cA 22/22/15；__teQiAK0dg 17/17/15；BRUlSm4gdQ4 10/10/10；UD92QBqA8Eo 5/5/5；8Buvxe72evU 5/5/5；rjy6kpS1sTY 8/8/8；B05Hs2pAAfE 0/0/0。B05Hs2pAAfE 没有 claims.json（0/0/0）；其余 11 个包的身份表条数与 claims.json 条目数全部一致，没有不一致。

## 探针与脚本

这些脚本、输出和中间文件都在 `/tmp/trade-audit-20261114/` 下，重启后会丢失；本清单只记录路径与用途，生成清单时没有重跑任何脚本；哪些脚本后来在快照上重跑过，见下一节。清单由 `/tmp/trade-audit-20261114/report/tools/probe_inventory.py` 生成。

### 这些探针跑的是哪份产品代码（独立复核后补）

审计“读”代码一律读钉住提交 `65a3c129` 的导出快照；“跑”的并不都是。下面按来源分开，行号是审计工作目录里脚本的行号。

从主检出（别的会话在用、审计期间被切到过别的分支）导入产品模块的：

- `probes/` 顶层有 24 个脚本把主检出放在 `sys.path` 最前：`C1-chunk-size-independence.py`、`C1-chunk-unaligned-control.py`、`C1-memory-node-vs-stream.py`、`C2-later-event-submit.py`、`C2-matching-harness.py:3`、`C3-harness.py:4`、`C5-*.py` 8 个、`C6-terms-history.py`、`C9-*.py` 9 个。其余 `C2-*`、`C3-*` 探针与 `O-gtd-660.py` 经这两个 harness 导入，来源相同。`C4-risk-engine.py` 不导入产品模块，但文件头写的运行方式是在主检出目录里 `uv run`（用主检出的解释器环境）。
- Live 进程内故障注入的原始一轮（`phaseB/B2/`）：`harness.py:46` 把主检出放在 `sys.path` 最前，`run.sh` 先 `cd` 到主检出再 `uv run`。核实阶段的重跑（`phase6/L-rerun/`）用的是快照：`harness.py:46` 指向快照，`runall.sh` 用 `--project` 快照；两份 `harness.py` 除这一行路径外逐字相同。发现表引用的进程内输出是 `phase6/L-rerun/out/` 这一份。
- Paper 审计运行（`phaseB/B1/`）的宿主侧：`env.sh:8` 的 `cli()` 与 `autocollect.sh:15` 在主检出里跑 `python -m cli.main` 与导出脚本，所以 `paper start`、`stop`、`resume`、封存这些宿主侧代码来自主检出。容器内的 runner 来自运行镜像，见下。

从快照导入的：`phaseB/B3/lib.py:20`（回放进程内）、`phase6/L-rerun/`、`phase6/X-rerun/*.py`、`phase6/A2-rerun/*.py`。Live 回环（`probes/loopback/run.sh:11`）与 Redis 探针（`probes/C8r-run.sh:10`）把快照的 `engine/` 只读挂进容器并优先导入；容器镜像是本机较旧的 `exec-main`（修订标签 `b6892067`），被换掉的只有 `engine/`。

核对了什么、核对不了什么：

- 主检出当时的已提交内容：B1 开始时记的 HEAD 是 `d1da7b251`；复核者列出审计期间主检出到过的提交 `26eda2995`、`b2d6e0095`、`0cedc4d21`、`b1c60923e`、`52ec1a690`。对这 6 个提交逐个跑 `git diff --stat 65a3c129 <提交> -- engine paper cli live runtime ledger replay shared market report registration qualification`（只读 Git 元数据，2026-11-14 修订时重跑），输出全部为空：它们与钉住提交在产品目录没有差异，差异只在 `deploy/` 与文档。每个探针运行时主检出具体停在哪个提交没有记录。
- 主检出当时未提交的工作区修改看不到，无法核对。
- Paper 审计运行的镜像：按摘要拉取的注册表 `exec-main`（`sha256:4597cba3…`），`docker image inspect` 读到的 `org.opencontainers.image.revision` 是 `cbb6204fe06b…`。它是钉住提交的祖先（`git merge-base --is-ancestor`），两者在上述产品目录没有差异。所以 Paper 的证据是“修订 `cbb6204fe` 的镜像加主检出的宿主侧代码”，按已提交内容看与钉住提交等价，不是钉住提交本身构建的镜像。
- 在快照上重跑、结果与保存输出一致的（都用 `env -i` 加 `--project` 快照，脚本副本把 `sys.path` 改指快照）：R2 复核者重跑 `C4-risk-engine`、`C5-liquidation-on-bars`、`C7-effective-live-config`、`C9-timer-name-order`、`C9-timer-vs-data-same-stamp`、`C9-timer-zoned-unguarded`（plain 与 zoned），输出在 `review/R2-probes/out/`；R3 复核者重跑 `O-gtd-660`（与 `phase6/O-out/O-gtd-660.out` 逐字相同）、`x_expire_types`、`x_gtd_stop` 与 `phase6/L-rerun/` 的 `p01`、`p02`、`p03`、`p04`、`p05`、`p06`、`p09`、`p10`、`p12`、`q01` 共 10 个（`p02`、`p06`、`q01` 0 行不同，其余只差订单列表先后与随机的客户端订单号），输出在 `review/R3-probes/`；R3 的子复核另重跑 `C2-gtd-expiry-order`、`C2-mark-trigger`、`C3-gtd-fill-after-expiry`、`C3-mark-trigger`、`C4-risk-engine`、`C9-timer-*` 三个、`O-gtd-660` 共 9 个脚本 10 次运行，输出在 `review/R3-probes/sub-D/`。没有在快照上重跑的：上面 24 个里的 `C1-*`、`C5-*` 其余 7 个、`C6-terms-history`、`C9-*` 其余 6 个，以及 `phaseB/B2/` 的原始一轮（已由 `phase6/L-rerun/` 取代）；回环、Redis 探针与 B1 没有重跑，只核对了保存的输出。

### 范围与规则

- 扫描目录：probes、phaseB/B2、phaseB/B3、phase6/O-out、phase6/M-rerun、phase6/A1-recalc、phase6/A2-rerun、phase6/L-rerun、phaseA/work、phaseA/work-II（扩展名 `.py .sh .js .mjs`，跳过 `__pycache__`）。共 547 个脚本文件。
- 其中 `probes/run-snapshots/` 下 304 个、`phaseB/B3/work/*/probe.py` 84 个是运行时写进各次运行目录的脚本副本，不逐个列出，见“副本”一节；其余 159 个逐行列出。
- `phase6/A2-src/` 是从账本导出的策略源码，不是探针脚本，不在清单内。
- “回答的问题”取脚本的模块文档字符串或头部注释；脚本没有的，取引用它的结果文件里首次出现该脚本名的那一行，并标“引用处”；两者都没有的写“未找到”。长于约 200 个字符（引用处 130 个字符）的截断。文字里的本机主检出路径换成 `<主检出>`，Nautilus 源码路径去掉 `nautilus-rc7/` 前缀。
- “保存的输出”按同目录同名 `.out/.txt/.json/.err`、`out/` 子目录、`phase6/O-out/`、`phase6/M-rerun/`（文件名带 `B3-`、`B2-` 或脚本名前缀）、`A1-recalc` 的 `NN_out.txt` 匹配；匹配不到不代表没有输出，只代表没有按文件名对上的文件。
- “引用它的文件”：在 CONTEXT/PROGRESS、`phase0,1,5` 与 `phase6/BRIEF.md`、`phase6/cards-*.md`、`phaseA/*.md`、`phaseB/*.md` 与各 `RESULT.md`、`phaseC/*.md` 里按脚本文件名（含扩展名）做字符串搜索；没有命中再按不含扩展名的主干名搜索，命中的标“（主干名）”。引用文件一栏最多列 6 个。

### probes/（顶层）

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `probes/C1-catalog-files-and-ties.py` | C1 probe: what ParquetDataCatalog.query(files=...) does in 2.0.0rc7, and whether rows with equal ts_init keep file order. Input: one instrument, TradeTicks, 12 files of 4,000 ticks each (4 ticks per m | 无同名文件 | cards-T.md, C1-backtest-catalog.md |
| `probes/C1-chunk-size-independence.py` | C1 probe: does the streamed replay's result depend on the chunk size or the session window? Input: the fixture of tests/engine/test_stream.py (3 contracts, 2 days of minutes, gaps, a non-ASCII name, a | 无同名文件 | cards-T.md, C1-backtest-catalog.md |
| `probes/C1-chunk-unaligned-control.py` | C1 probe (POSITIVE CONTROL variant: chunks NOT aligned to ts_init, i.e. split one timestamp across engine.run calls): does the streamed replay's result depend on the chunk size or the session window?  | 无同名文件 | C1-backtest-catalog.md |
| `probes/C1-memory-node-vs-stream.py` | C1 probe: is the README's reason for hand-streaming ("BacktestNode loads every configuration whole") true on rc7? Usage: C1-memory-node-vs-stream.py gen \| node \| stream Input: 6 contracts x 700,000 on | 无同名文件 | C1-backtest-catalog.md |
| `probes/C2-gap-slip-limit.py` | 引用处：\| DefaultFillModel 概率语义 \| `models/fill.rs:286-345`（`DefaultFillModel`），`fill.rs:211-222` `event_success`：概率 ≤0 直接 false，不取随机数。`is_ | phase6/O-out/C2-gap-slip-limit.out, probes/C2-gap-slip-limit.out | C2-matching-fill.md |
| `probes/C2-gtd-expiry-order.py` | 引用处：\| GTD 过期与撮合先后 \| `iterate_with_mode`（`mod.rs:4200-4320`）先做买卖盘匹配（`FillLimit`/`TriggerStop`，`mod.rs:4235-4262`），**之后**才检查 GTD 过期（`pos | phase6/O-out/C2-gtd-expiry-order.out, probes/C2-gtd-expiry-order.out | C2-matching-fill.md |
| `probes/C2-gtd-expiry.py` | 引用处：\| GTD 过期与撮合先后 \| `iterate_with_mode`（`mod.rs:4200-4320`）先做买卖盘匹配（`FillLimit`/`TriggerStop`，`mod.rs:4235-4262`），**之后**才检查 GTD 过期（`pos | phase6/O-out/C2-gtd-expiry.out, probes/C2-gtd-expiry.out | C2-matching-fill.md |
| `probes/C2-latency.py` | 引用处：\| 延迟模型 \| `StaticLatencyModel`（`execution/__init__.pyi:265`），`add_venue(latency_model=...)`（`backtest/__init__.pyi:466`）、`SandboxEx | phase6/O-out/C2-latency.out, probes/C2-latency.out | C2-matching-fill.md |
| `probes/C2-later-event-submit.py` | Product contract: decide on bar N close, submit on a later event (the next MARK, which precedes its bar). | phase6/O-out/C2-later-event-submit.out, probes/C2-later-event-submit.out | C2-matching-fill.md |
| `probes/C2-liq-queue.py` | 引用处：\| `liquidity_consumption` / `queue_position` \| `apply_liquidity_consumption`（`mod.rs:347-437`）；`queue_position` 在 bar 路径下 `determi | phase6/O-out/C2-liq-queue.out, probes/C2-liq-queue.out | C2-matching-fill.md |
| `probes/C2-mark-trigger.py` | 引用处：- 探针：`C2-mark-trigger.py`：MARK 恒为 100.00，bar 低点 99.00，止损 99.50：DEFAULT/LAST_PRICE/MARK_PRICE 三种都在 99.50 成交。 | phase6/O-out/C2-mark-trigger.out, probes/C2-mark-trigger.out | C2-matching-fill.md |
| `probes/C2-market-stop-fills.py` | 引用处：- 本产品上的证据：`C2-market-stop-fills.py` 末段（重跑：量 0.002 的 bar，市价买成交 101.00 而收盘 100.00）。频率：BTC/ETH 一分钟 bar 量远大于 4 个步长（0.004），本审计没有读市场目录，这 | phase6/O-out/C2-market-stop-fills.out, probes/C2-market-stop-fills.out | cards-O.md, C2-matching-fill.md |
| `probes/C2-matching-harness.py` | Shared harness for C2 probes: native BacktestEngine with the product's add_venue/ACCOUNT_CONTRACT. | 无同名文件 | C2-matching-fill.md |
| `probes/C2-precision-mismatch.py` | instrument price_precision=2. Bars given with 3 decimals ("100.000") -> venue's check_price_precision fails | phase6/O-out/C2-precision-mismatch.out, probes/C2-precision-mismatch.out | C2-matching-fill.md |
| `probes/C2-stop-in-market.py` | 引用处：\| 止损单入场的"已在市场内" \| `reject_stop_orders` 为 true 时 `process_stop_market_order`（`mod.rs:3962-3985`）拒单 \| 回放、Paper 都设 `False`（`engine/co | phase6/O-out/C2-stop-in-market.out, probes/C2-stop-in-market.out | C2-matching-fill.md |
| `probes/C3-bracket-rc7.py` | Q: does a native bracket (MARKET entry + SL + TP, HEDGING, product venue) still misbehave on rc7 when the entry's fill bar already reaches the stop/target? (README says rc7 fixed #5248/#5159; rc8 note | phase6/O-out/C3-bracket-rc7.out | C3-orders.md |
| `probes/C3-close-position-bypass.py` | Q: do Strategy.close_position / market_exit (Rust) go through the product's Python OrderRules.submit_order override? Uses the product's OrderRules + Subscriptions mixins over a native Strategy in a Ba | phase6/O-out/C3-close-position-bypass.out | C3-orders.md |
| `probes/C3-gtd-fill-after-expiry.py` | Q: in rc7's matching engine (replay + Sandbox share it), can a resting GTD limit fill on a bar whose timestamp is at/after its expire_time? (rc9 release notes: 'resting GTD orders filling after expiry | phase6/O-out/C3-gtd-fill-after-expiry.out | C3-orders.md |
| `probes/C3-harness.py` | Shared harness for C3 probes: native BacktestEngine, product add_venue/ACCOUNT_CONTRACT, product source_config. Read-only on the repo; no network, no credentials. | 无同名文件 | C3-orders.md |
| `probes/C3-mark-trigger.py` | Q: a reduce-only SELL STOP_MARKET with trigger_type=MARK_PRICE (Binance workingType=MARK_PRICE on Live): does rc7's replay/Sandbox matching engine trigger it from MARK updates? Bars stay at 100 (low 9 | phase6/O-out/C3-mark-trigger.out | C3-orders.md |
| `probes/C3-reduce-only-stops.py` | Q1: replay/Sandbox matching engine (rc7) with HEDGING + use_reduce_only: what happens to a position's resting reduce-only stop when (a) the position is partly reduced by another reduce-only order, (b) | phase6/O-out/C3-reduce-only-stops.out | C3-orders.md |
| `probes/C4-risk-engine.py` | C4 probes: rc7 RiskEngine behaviours on a margin HEDGING account, via BacktestEngine (v2, no network). Run: cd <主检出> && uv run --frozen python -I /tmp/trade-audit-20261114/p | phase6/M-rerun/C4-risk-engine.out, probes/C4-risk-engine.out | cards-M.md, C4-risk.md |
| `probes/C5-equity-price-source.py` | C5 probe 7: which price does rc7's Portfolio use to value an open position when a bar close and a MARK both exist (product bars env: bars + MARK stream, no quotes)? Inputs: long 1000 filled at bar 2 ( | phase6/M-rerun/C5-equity-price-source.out, probes/C5-equity-price-source.out | C5-position-account.md |
| `probes/C5-funding-settlement.py` | C5 probe 1: how rc7's BacktestEngine settles FundingRateUpdate with the product's venue (engine.run.add_venue). Inputs: market long 1000 at bar 2, MARK stamped at each bar close (value differs from th | phase6/M-rerun/C5-funding-settlement.out, probes/C5-funding-settlement.out | C5-position-account.md |
| `probes/C5-funding-vs-ledger-settle.py` | C5 probe 4: ledger.paper.settle (the product's Paper-seal funding, which claims to be Nautilus's formula) against the native rc7 BacktestEngine settlement, over random positions, marks and rates incl. | phase6/M-rerun/C5-funding-vs-ledger-settle.out, probes/C5-funding-vs-ledger-settle.out | cards-M.md, C5-position-account.md |
| `probes/C5-hedge-margin-netting.py` | C5 probe 3: HEDGING positions and margin in rc7 (product bars account: margin rates 1/1, leverage 3, balance 100000). Inputs: bar 2 market BUY 2900 @100 (margin 96666.67 of 100000 free); bar 4 market  | phase6/M-rerun/C5-hedge-margin-netting.out, probes/C5-hedge-margin-netting.out | C5-position-account.md |
| `probes/C5-leverage-times-loader-margin.py` | C5 probe 5: is Paper's workaround (Sandbox leverage = L x 0.1 on the loader's margin rates 0.1/0.1) equivalent, to the 8-dp Money, to the replay's rates 1/1 at leverage L, for order (initial) margin a | phase6/M-rerun/C5-leverage-times-loader-margin.out, probes/C5-leverage-times-loader-margin.out | C5-position-account.md |
| `probes/C5-liquidation-on-bars.py` | C5 probe 8: does rc7's native liquidation fire in the product's `bars` account if switched on (liquidation_enabled True, default LeveragedMarginModel, rates 1/1, leverage 3, bar execution on, bars + M | phase6/M-rerun/C5-liquidation-on-bars.out, probes/C5-liquidation-on-bars.out | C5-position-account.md |
| `probes/C5-ruin-without-liquidation.py` | C5 probe 2: what rc7 does with the product's `bars` account (liquidation_enabled False, default LeveragedMarginModel, margin rates 1/1, leverage 3) when a position loses more than the account holds. I | phase6/M-rerun/C5-ruin-without-liquidation.out, probes/C5-ruin-without-liquidation.out | C5-position-account.md |
| `probes/C5-standard-model-ignores-leverage.py` | C5 probe 6: in the product's `quotes` environment (StandardMarginModel, rates from --initial-margin/--maintenance-margin) does --leverage (default_leverage in the effective config) change anything? Sa | phase6/M-rerun/C5-standard-model-ignores-leverage.out, probes/C5-standard-model-ignores-leverage.out | C5-position-account.md |
| `probes/C6-make-price-qty.py` | C6 probe A: what rc7 make_price / make_qty / notional_value do (no network, no ledger). | 无同名文件 | cards-T.md, C6-instruments.md |
| `probes/C6-replay-min-notional.py` | C6 probe B: which risk checks a replay (BacktestEngine + product add_venue + product build_instrument) applies to precision, tick grid, min_quantity and min_notional. No network, no ledger, no files o | 无同名文件 | cards-T.md, C6-instruments.md |
| `probes/C6-terms-history.py` | C6 probe C (read-only): the stored terms rows (market 'instrument' table) of BTCUSDT/ETHUSDT: how many rows, observed_at, and whether terms ever differ between rows. Reads the market directory only. | 无同名文件 | cards-T.md, C6-instruments.md |
| `probes/C7-effective-live-config.py` | Probe: effective values of the LiveExecutionEngineConfig / LiveDataEngineConfig / Binance client configs the product builds (engine/live_node.py:36-70), printed from the rc7 Python bindings. No networ | 无同名文件 | C7-live-node-binance.md |
| `probes/C7-sigwait-vs-node-signal.py` | Probe: product's engine/live.py signal scheme (SIGTERM/SIGINT blocked in every thread, one sigwait thread) against rc7 LiveNode.run(), which on the main thread installs its own Python signal handlers  | 无同名文件 | C7-live-node-binance.md |
| `probes/C8-config-defaults.py` | C8 probe: what the Paper Sandbox config and CacheConfig actually carry on rc7 (no network, no credential). | 无同名文件 | C8-cache-sandbox.md |
| `probes/C8-redis-unreachable.py` | C8 probe: what the rc7 Python RedisCacheDatabase raises when no server answers (loopback, nothing listening). | 无同名文件 | cards-L.md, C8-cache-sandbox.md |
| `probes/C8r-env-introspect.py` | C8r: what the exec-main image exposes (no network, no credential). | 无同名文件 | 无 |
| `probes/C8r-fakebinance.py` | C8r: a loopback fake of Binance USD-M public data (HTTP exchangeInfo + a WebSocket that accepts SUBSCRIBE and lets the probe push kline/markPrice frames). Runs inside the audit container on 127.0.0.1  | 无同名文件 | 无 |
| `probes/C8r-import-check.py` | 未找到 | 无同名文件 | 无 |
| `probes/C8r-lib.py` | C8r shared library: a LiveNode built the way engine/paper.py:688-745 builds Paper's (Sandbox exec client, same SandboxExecutionClientConfig, CacheConfig, Redis cache factory, reconciliation on restore | 无同名文件 | 无 |
| `probes/C8r-mountcheck.py` | 未找到 | 无同名文件 | 无 |
| `probes/C8r-node.py` | C8r node child: one LiveNode process (Sandbox + Redis cache + loopback fake Binance) running a scripted scenario. argv[1] = JSON {tag, redis_port, phase, scenario, syms, base_min, restore, end ('stop' | 无同名文件 | 无 |
| `probes/C8r-p1-stop-restart.py` | P1 (C8-1 / P-E): Sandbox restart with a position and a resting reduce-only STOP_MARKET. Orchestrator, one run per variant: phase A (open 0.4, stop @90 resting) -> end A (stop = handle.stop+dispose, ki | 无同名文件 | 无 |
| `probes/C8r-p2-position-id.py` | P2 (C8-2 / P-C): position ids after a Sandbox restart on the same Redis. Phase A opens and fully closes a position (BTC, and for 'two' also ETH after it), the node stops normally (flat, only terminal  | 无同名文件 | 无 |
| `probes/C8r-p3-readback-hang.py` | P3 (C8-4 / P-F): engine/paper_redis.py NativeCache.snapshot read-back when its Redis child is SIGSTOPped or SIGKILLed before the read. Product code, product redis child (engine.redis_child), loopback  | 无同名文件 | 无 |
| `probes/C8r-p3-run.py` | P3 orchestrator: healthy control, SIGSTOP, SIGKILL each in its own interpreter and process group with a hard cap (the product's redis child inherits the child's stderr, so the group is killed after ea | 无同名文件 | 无 |
| `probes/C8r-p4-live-cache.py` | P4b (Live): engine/live_cache.py LiveCache (product redis child, AOF always) under Redis faults, driven in-process. No Binance client, no credential, no node. Cases: kill \| stop (SIGSTOP) \| fsync-conf | 无同名文件 | 无 |
| `probes/C8r-p4-paper-redis-dies.py` | P4a (Paper): the Redis child of engine/paper_redis.py NativeCache is SIGKILLed while a Sandbox node (config of engine/paper.py:build_node, loopback fake Binance, scripted source) keeps running. Record | 无同名文件 | 无 |
| `probes/C8r-p4-supervise.py` | Run one C8r-p4-paper-redis-dies.py mode as a child process under an external cap (a native call that holds the GIL cannot be supervised from inside), report whether it exited and when, then sync the c | 无同名文件 | 无 |
| `probes/C8r-p5-child.py` | P5 child (P-G, C8-7 analogue without a Binance execution client): Sandbox node + the audit's AOF-always Redis with Live's connection settings; kills ITSELF with SIGKILL at a chosen point after submit_ | 无同名文件 | 无 |
| `probes/C8r-p5-run.py` | P5 orchestrator (P-G analogue): N trials per (kill_at, delay). After each SIGKILL, read the Redis the dead process left (a fresh RedisCacheDatabase.load_all) and compare with what the process had appl | 无同名文件 | 无 |
| `probes/C8r-redis.py` | C8r orchestrator helpers: the audit's own Redis from the pinned runtime (engine.redis_child), SAVE/restart from RDB. | 无同名文件 | 无 |
| `probes/C8r-run.sh` | usage: C8r-run.sh <name> <script> [args...] One throwaway container (name audit-c8-<name>), --network none, auto-removed. The probes are first copied to a fresh directory because the Docker Desktop bi | 无同名文件 | 无 |
| `probes/C8r-smoke.py` | C8r smoke: does the product's Binance data client + Sandbox client connect to the loopback fake? | 无同名文件 | 无 |
| `probes/C8r-summarize.py` | Host-side: print the compact view of a C8r-node JSON (snapshots, events, notes). | 无同名文件 | 无 |
| `probes/C9-aggregate-delivery.py` | Probe C9-1: in the product's own replay (engine.run.replay), at which clock time does a strategy receive the 5-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL bar, in what order relative to the 1-minute bars,  | 无同名文件 | C9-bars-clock-reports.md |
| `probes/C9-aggregate-gap.py` | Probe C9-2 (variant of C9-1: a gap of ten minutes in the exported minutes, and the alert registered BEFORE the aggregation is subscribed). Original docstring: Probe C9-1: in the product's own replay ( | 无同名文件 | cards-T.md, C9-bars-clock-reports.md |
| `probes/C9-cancel-timers-isolation.py` | Probe C9-5: does a source calling self.clock.cancel_timers() (or cancel_timer on the aggregator timer name) stop the data engine's aggregation timers in the product replay? Original: Probe C9-1: in th | 无同名文件 | C9-bars-clock-reports.md |
| `probes/C9-late-minute-with-build-delay.py` | Probe C9-8: BacktestEngine, time_bars_build_delay=5 s as Paper/Live set it. One 1-minute bar (the last of the first 5-minute bucket) reaches the data engine 7 s after its close (ts_init = ts_event + 7 | 无同名文件 | cards-T.md, C9-bars-clock-reports.md |
| `probes/C9-sharpe-cagr-vs-native.py` | Probe C9-6: product's own report.measures.sharpe_365 / annual_return and engine.report.summary_statistics against the native nautilus_trader.analysis SharpeRatio / CAGR / MaxDrawdown on the same daily | 无同名文件 | C9-bars-clock-reports.md |
| `probes/C9-timer-name-order.py` | Probe C9-3 (C9-2 with the user alerts named A0.. so they sort before TIME_BAR_..., and no gap). Probe C9-2 (variant of C9-1: a gap of ten minutes in the exported minutes, and the alert registered BEFO | 无同名文件 | cards-T.md, C9-bars-clock-reports.md |
| `probes/C9-timer-vs-data-same-stamp.py` | Probe C9-9 (alert at exactly a 1-minute bar/MARK instant, T-1ms: order of timer vs MARK vs bar in the replay). Based on C9-3: Probe C9-3 (C9-2 with the user alerts named A0.. so they sort before TIME_ | 无同名文件 | cards-T.md, C9-bars-clock-reports.md |
| `probes/C9-timer-zoned-unguarded.py` | Probe C9-4: does an exception in a callback registered through clock.set_timer_zoned (not in engine.strategy.CLOCK_CALLBACK_APIS) leave a receipt / fail the replay as set_timer does? Original: Probe C | 无同名文件 | cards-T.md, C9-bars-clock-reports.md |
| `probes/C9-warm-request-empty-bucket.py` | Probe C9-7: trade start in the middle of a 5-minute bucket whose earlier minutes the export lacks (warm-up request [floor(T,P), T) finds no 1-minute bar). Does the source still receive aggregated bars | 无同名文件 | cards-T.md, C9-bars-clock-reports.md |
| `probes/O-gtd-660.py` | O1: dow62 timing. Entry submitted in on_bar at bar 2 with expire = clock.timestamp_ns() + 660 s (strategy.py enter()). Bar 2 stamp is START+2*BAR-1ms, so expire == the stamp of bar 13 exactly (not who | phase6/O-out/O-gtd-660.out | cards-O.md |

### probes/loopback/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `probes/loopback/C10-backtest-cache-in-order-event.py` | Does reading self.cache inside on_order_event(OrderInitialized/OrderSubmitted) raise in a BacktestEngine too? Live (loopback probe `smoke`, first run) raised RuntimeError("Already mutably borrowed") t | 无同名文件 | C10-live-loopback.md |
| `probes/loopback/batch.sh` | Run several scenarios in parallel, each in its own one-shot container; wait for all. | 无同名文件 | phase5/timeline-e70e87b9-full.md, C10-live-loopback.md |
| `probes/loopback/fakex.py` | Loopback fake Binance USD-M Futures venue (REST + WebSocket) for the audit's Live probes. Standard library only; listens on 127.0.0.1 inside a `--network none` container. It models what the auditor un | 无同名文件 | cards-L.md, C10-live-loopback.md |
| `probes/loopback/harness.py` | Scenario harness for the loopback Live probes; runs inside the one-shot `--network none` container. Starts the fake venue and the product's runner (run_live.py), drives control commands, and mirrors t | 无同名文件 | cards-L.md, cards-M.md, B2/RESULT.md, C10-live-loopback.md, C2-matching-fill.md, C3-orders.md |
| `probes/loopback/probe_source.py` | 引用处：- 源码：`probes/loopback/probe_source.py`，一个过得了产品源码检查（`engine/load.py` 的 `source_findings`）的探针策略：每根 1 分钟 K 线的成交量是假交易所给的"命令码"（2 = 市价性限 | 无同名文件 | C10-live-loopback.md |
| `probes/loopback/run.sh` | One scenario in a one-shot container with no network (loopback only). Usage: run.sh <scenario> [docker -e VAR=...] The scripts are copied to a fresh directory first: Docker Desktop's file sharing serv | 无同名文件 | B2/RESULT.md, C10-live-loopback.md |
| `probes/loopback/run_live.py` | Audit wrapper: the product's engine.live entry point with its three Binance origins pointed at the loopback fake. Patches (destinations and observability only; no product or Nautilus logic is replaced | 无同名文件 | C10-live-loopback.md |
| `probes/loopback/scenarios.py` | Loopback Live probe scenarios; `python scenarios.py <name>` inside the one-shot container. | 无同名文件 | cards-L.md, C10-live-loopback.md |
| `probes/loopback/timeline.py` | Merge one scenario's records into a time-ordered text timeline (host side, reads out-loopback/<name>/). | 无同名文件 | C10-live-loopback.md |

### phaseB/B1/

Paper 审计运行的脚本与输出（隔离 Paper 库 `audit-paper`，容器只属于这次审计；记录在 `phaseB/B1/RESULT.md`，故障注入部分写于 2026-11-14 11:40 UTC，第 3.1 节是 16:12 UTC 的人工复查，第 10 节是收集脚本在 2026-11-15 00:13:49 UTC 自动追加的午夜读数、没有人复核过；11:40 的草稿另存为 `RESULT.draft-1140.md`，过程笔记在 `NOTES.md`）。宿主侧命令经 `env.sh` 在主检出里跑 `python -m cli.main`（见本节首“这些探针跑的是哪份产品代码”）；两个进程内探针 `probes/*.py` 也把主检出插在 `sys.path` 最前，没有在快照上重跑。24 条审计运行都已结束；长跑 A（运行 1）与日线观察运行 8 在 2026-11-15 00:12 UTC 由收集脚本停止并封存，输出在 `longrun-A/` 与 `midnight/`。

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phaseB/B1/env.sh` | 审计用的环境与 `cli()` 包装：隔离账本目录、运行目录、按摘要引用的运行镜像 | 无同名文件 | B1/RESULT.md |
| `phaseB/B1/audit-churn/strategy.py`（另 `terms.json`、`universe.json`） | 长跑 B 的源码 `audit-churn@1`：短周期进出场、挂远的 GTD 单、定时离场，用来产生大量订单事件 | `start-B.json`、`publish-churn.json`、`longrun-B/` | B1/RESULT.md 第 1、3 节 |
| `phaseB/B1/audit-fast/f1.py` 至 `f8.py`、`norecovery.py`、`reject.py`、`breach.py`、`nostop.py` | 故障注入用的快节奏源码各变体（声明或不声明恢复协议、故意被拒、故意越订单规则、不挂止损） | `faults/start-*.json` 与各 `faults/F*/` 目录 | B1/RESULT.md 第 2 节 |
| `phaseB/B1/audit-agg/strategy.py`、`pause-variant.py` | 订多个周期聚合 bar 的源码，记录每根聚合 bar 的送达时刻 | `faults/G2-pause-phase/`、`faults/G3-agg-after-clock-step/` | B1/RESULT.md 第 5 节；20261114-30 |
| `phaseB/B1/interrupt.sh` | 对自己的审计运行 `docker kill` 或 `docker stop`，再试 `paper resume`，保存前后状态 | `faults/F1-…`、`F2-…`、`F3-…`、`F3c-…`、`F3d-…`、`F4-…`、`F4b-…`、`F5-…` 各目录的 `before.txt`、`resume.json`、`timeline.txt` 等 | 20261114-33、20261114-42；故障矩阵第 5 类 |
| `phaseB/B1/monitor.py` | 每 60 秒采样审计账本的 Paper 容器（内存、状态）与各运行的事件日志 | `monitor.csv`（每次采样每个运行一行）、`bars.csv`（每根 bar 的日志延迟） | B1/RESULT.md 第 3 节；故障矩阵长跑小节 |
| `phaseB/B1/monsum.py` | 按运行汇总 `monitor.csv` 与 `bars.csv` | `longrun-B/monsum-at-1138.txt`、`midnight/monsum.txt` | 故障矩阵长跑小节；待证实 T-04 |
| `phaseB/B1/jsum.py` | 压缩查看一个 Paper 事件日志（bar 与快照只计数） | 无同名文件 | B1/RESULT.md |
| `phaseB/B1/churn_report.py` | 核对 `audit-churn` 日志里的订单、成交、手续费、到期、止损与余额 | `longrun-B/churn-report.txt` | 故障矩阵第 4 类与长跑小节 |
| `phaseB/B1/agg_report.py` | 每根聚合 bar 送达源码的时刻对桶末，以及哪些分钟 bar 能拼出它 | `faults/G2-pause-phase/agg-report.txt`、`faults/G3-agg-after-clock-step/agg-report.txt`、`midnight/agg-report.txt`（运行 8 跨午夜的全部聚合 bar） | 20261114-30；故障矩阵“其他”组与长跑小节 |
| `phaseB/B1/sealed.py` | 从审计 Paper 库把一个已封存运行的文件导出到目录（只读） | `sealed/1`、`2`、`3`、`4`、`5`、`7`、`8`、`9`、`14`、`17`、`20`、`21`、`24`（运行 16、22 没有导出） | 20261114-33、-34、-38、-43 |
| `phaseB/B1/autocollect.sh` | 2026-11-15 00:12 UTC 自动停止并封存运行 8 与运行 1，导出午夜前后的聚合 bar 读数并追加到 RESULT | `autocollect.log`（末行 `autocollect done 2026-11-15T00:13:49Z`）、`longrun-A/`（`stop.json`、`compare-attempt.json`、`events-before-stop.jsonl`）、`midnight/`（`agg-report.txt`、`monsum.txt`、`stop.json`、`events-before-stop.jsonl`）、`sealed/1`、`sealed/8` | 故障矩阵长跑小节 |
| `phaseB/B1/probes/dup_out_of_order_bars.py` | 重复或乱序的 1 分钟 bar 在产品的数据引擎设置下怎样处理（进程内，回测引擎，不是真实 Paper 运行） | `probes/dup_out_of_order_bars.out` | 待证实 T-15；故障矩阵第 7 类 |
| `phaseB/B1/probes/journal_failure_skips_source.py` | 日志写入抛 `ENOSPC` 时源码的通用订单回调还会不会被调到（进程内，只调产品的回调包装） | `probes/journal_failure_skips_source.out` | 20261114-43 |
| 手工步骤（没有脚本） | Redis 子进程被杀（F6）、磁盘写满（F10c，`hdiutil` 建 10 MB 映像）、出口容器被停（F7、F7c）、内存上限（F10b）、发版屏障（F9）、对账尝试 | `faults/F6-redis/`、`F10c-disk/`、`F7-egress-outage/`、`F7c-long-outage/`、`F10a-…`、`F10b-oom/`、`F8-rest-warmup/`、`F9-release-lock/`、`F9b-container-image/`、`F12-orders/`、`F13-no-stop/`、`F1d-daemon-auto-resume/`；`compare-5.refusal.json`、`longrun-B/compare-attempt.txt` | 故障矩阵各类；20261114-34、-41、-43 |

### phaseB/B2/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phaseB/B2/flows.py` | Shared steps of the B2 probes on harness.Harness (the candidate's real flow). | 无同名文件 | B2/RESULT.md |
| `phaseB/B2/harness.py` | B2 audit harness: drive engine/live*.py in-process on Nautilus's BacktestEngine (simulated venue), no network, no credential. Modeled on tests/engine/test_live_entry.py NativeEntryTests.setUp and test | 无同名文件 | cards-L.md, cards-M.md, B2/RESULT.md, C10-live-loopback.md, C2-matching-fill.md, C3-orders.md |
| `phaseB/B2/p00_baseline.py` | Baseline: the candidate's real order flow on the Live wrappers, no fault. Entry GTD limit -> account check -> dispatch -> fill -> reduce-only stop; Observer ticks; daily exit decision. | phaseB/B2/out/p00_baseline.txt | 无 |
| `phaseB/B2/p01_bars_gap.py` | Item 1: market WebSocket drops and reconnects, bars missed while it was down. A flat run: gap -> entries_closed(bars_missing) -> source sees nothing -> two agreeing comparisons -> rewarming. B the dec | phaseB/B2/out/p01_bars_gap.txt | B2/RESULT.md |
| `phaseB/B2/p01d_hold_timing.py` | Item 1 side branch: a socket is renewed or reconnects just before the candidate's daily decision (00:01:00 UTC). The entry is held at the closed gate; it must leave within 55 s (GTD 660 s minus the 60 | phaseB/B2/out/p01d_hold_timing.txt | B2/RESULT.md |
| `phaseB/B2/p01e_daily_bar.py` | Item 1 side branch: the candidate's daily close comes from Nautilus's INTERNAL aggregation of the one-minute bars. With a position open the source keeps receiving bars after a gap. If the minute that  | phaseB/B2/out/p01e_daily_bar.txt | B2/RESULT.md （主干名） |
| `phaseB/B2/p02_rest_errors.py` | Item 2: REST errors, 429, timeouts. A the product's own REST reader (engine.live_venue.BinanceReadOnly.get) under HTTP 429/418/5xx, a timeout, a reset and malformed bodies: its opener is replaced, not | phaseB/B2/out/p02_rest_errors.txt | B2/RESULT.md |
| `phaseB/B2/p02c_slow_orders.py` | Item 2, order side (simulated analog): the venue answers new orders very late (a submit whose outcome stays unknown: a timeout, or the adapter retrying through a 429). The simulated venue's latency mo | phaseB/B2/out/p02c_slow_orders.txt | B2/RESULT.md |
| `phaseB/B2/p03_rejections.py` | Item 3: rejected orders, with the candidate's real callbacks on the simulated venue. A an entry the native risk engine denies (limit above the instrument's maximum price: a price-filter rejection), fl | phaseB/B2/out/p03_rejections.txt | B2/RESULT.md |
| `phaseB/B2/p04_partial_gtd.py` | Item 4: partial fill, the rest ended; GTD expiry. A partial fills (the venue consumes the offered size), the candidate's stop follows the position; the rest expires at the venue's GTD time (the simula | phaseB/B2/out/p04_partial_gtd.txt | B2/RESULT.md |
| `phaseB/B2/p05_restart.py` | Item 5: the runner is interrupted or killed with a position open, then started again (engine.live.execute, the control's own rule for starting it again read from the same files). A SIGTERM while flat  | phaseB/B2/out/p05_restart.txt | cards-L.md, B2/RESULT.md |
| `phaseB/B2/p05d_phantom.py` | Item 5 side branch (product side only): the native cache holds a position and its stop that Binance no longer has (closed at Binance while the runner was down, and native reconciliation did not match  | phaseB/B2/out/p05d_phantom.txt | B2/RESULT.md |
| `phaseB/B2/p06_cache.py` | Item 6: the native cache (Redis AOF) is lost before a start, or fails during a run. A a start again finds no retained native cache (real engine.live_cache.LiveCache rule; FakeCache applies the same ru | phaseB/B2/out/p06_cache.txt | B2/RESULT.md |
| `phaseB/B2/p07_bar_order.py` | Item 7: the same bar twice; an old bar arriving late. Run with the Live data engine's sequence validation on (as engine.live_node configures it) and off (what the product's own continuity check does i | phaseB/B2/out/p07_bar_order.txt | B2/RESULT.md |
| `phaseB/B2/p08_funding.py` | Item 8: funding settlement at the moment of an order. In-process part only: the cadence the Live source applies to funding updates (engine.cadence), and the brake's equity when a settlement lands with | phaseB/B2/out/p08_funding.txt | B2/RESULT.md |
| `phaseB/B2/p09_terms_status.py` | Item 9: the contract's tick or step changes while the run is on; the contract stops trading; the contract is gone. A Binance's tick size changes (exchangeInfo) while a position is open; the candidate  | phaseB/B2/out/p09_terms_status.txt | B2/RESULT.md |
| `phaseB/B2/p10_clock.py` | Item 10: the local clock drifts or steps (virtual wall clock; the venue's time stays true). A 1.2 s ahead at an entry's own read. B 1.2 s ahead found by the periodic comparison, then corrected. C a fo | phaseB/B2/out/p10_clock.txt | B2/RESULT.md |
| `phaseB/B2/p12_stop_brake.py` | Item 12: stop and brake with orders in flight; a cancel that never confirms; a rejected close; the end of the start. A `live stop` (the STOP file) with a position, its stop and a working add entry. B  | phaseB/B2/out/p12_stop_brake.txt | cards-L.md, B2/RESULT.md |
| `phaseB/B2/run.sh` | Run one B2 probe with a whitelisted environment (no exchange credential variable reaches the process) and offline uv. usage: run.sh <script.py> [args]   -> output also kept in out/<script>.txt | 无同名文件 | B2/RESULT.md, C10-live-loopback.md |

### phaseB/B3/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phaseB/B3/lib.py` | B3 shared harness: a synthetic market export (market.export writers, the product's Catalog layout), the real `engine.run.main` in process (no network, no ledger, no docker), then the product's native  | 无同名文件 | B3/RESULT.md |
| `phaseB/B3/p1_funding_timing.py` | B3 probe 1: funding settlement at / around the instant of an entry fill and of a stop fill. | phase6/M-rerun/B3-p1_funding_timing.out, phaseB/B3/p1_funding_timing.out | B3/RESULT.md |
| `phaseB/B3/p1b_funding_hedge_missing.py` | B3 probe 1b: HEDGING long+short positions and a later entry across one funding; and the same run with the funding row absent. | phase6/M-rerun/B3-p1b_funding_hedge_missing.out, phaseB/B3/p1b_funding_hedge_missing.out | B3/RESULT.md |
| `phaseB/B3/p2_dup_disorder.py` | B3 probe 2: duplicated / out-of-order market events. (a) product export writers' guards; (b) the real runner (engine.run.main) fed a mutated event stream (stands for a corrupt Catalog that passed expo | phaseB/B3/p2_dup_disorder.out | B3/RESULT.md |
| `phaseB/B3/p2b_dup_unguarded.py` | B3 probe 2b: what the ENGINE does with the mutated streams once the receipt-count guard is neutralised (receipt counts edited to the consumed count). Shows why the guard matters. | phaseB/B3/p2b_dup_unguarded.out | B3/RESULT.md |
| `phaseB/B3/p2c_bar_mark_order.py` | B3 probe 2c: bar and MARK at the same timestamp: callback order, and which mark a funding settlement at that timestamp uses. | phaseB/B3/p2c_bar_mark_order.out | B3/RESULT.md |
| `phaseB/B3/p3_missing_bars.py` | B3 probe 3: a ten-minute hole in the one-minute LAST bars (minutes 10..19), with MARK continuing / also missing. | phaseB/B3/p3_missing_bars.out | B3/RESULT.md |
| `phaseB/B3/p3b_daily_aggregation.py` | B3 probe 3b: native daily aggregation (1-DAY-LAST-INTERNAL@1-MINUTE-EXTERNAL) when one-minute bars are missing. | phaseB/B3/p3b_daily_aggregation.out | B3/RESULT.md |
| `phaseB/B3/p4_partial_gtd.py` | B3 probe 4: (A) partial fills under the product's fill config; (B) GTD expiry vs the next bar's match. | phaseB/B3/p4_partial_gtd.out | B3/RESULT.md |
| `phaseB/B3/p5_rejections.py` | B3 probe 5: orders the venue / risk engine refuses, a stop left on a flat position, a stop triggered at submission. | phaseB/B3/p5_rejections.out | B3/RESULT.md |
| `phaseB/B3/p5b_margin.py` | B3 probe 5b: margin insufficient. Two contracts, each entry 2900 x 100 = 290k notional (inside each strategy's 3x equity rule), account 100k, leverage 3 (locks 1/3 of notional). Also 1 contract with a | phase6/M-rerun/B3-p5b_margin.out, phaseB/B3/p5b_margin.out | B3/RESULT.md |
| `phaseB/B3/p6_same_bar.py` | B3 probe 6: entry and stop in one bar, stop vs exit limit in one bar (tie), and gaps over the stop. | phaseB/B3/p6_same_bar.out | B3/RESULT.md |
| `phaseB/B3/p7_lifecycle.py` | B3 probe 7: delisting / settlement inside the window (the product's lifecycle episodes), positions and orders at termination. | phaseB/B3/p7_lifecycle.out | B3/RESULT.md |
| `phaseB/B3/p7e_tick_grid.py` | B3 probe 7e: an instrument whose tick (0.10) is coarser than the data (an off-grid minute bar): does the native matching engine ignore the bar (docs/plans/trust-boundary-deferred.zh.md says it does)?  | phaseB/B3/p7e_tick_grid.out | B3/RESULT.md |
| `phaseB/B3/p8_liquidation.py` | B3 probe 8: a leveraged long that should have been liquidated; the bar environment ('Liquidation is not modelled'). | phase6/M-rerun/B3-p8_liquidation.out, phaseB/B3/p8_liquidation.out | B3/RESULT.md |
| `phaseB/B3/p8d_metrics.py` | B3 probe 8d: the ledger's sealing reading (ledger.metrics.metrics, pure computation, no ledger) on the negative-equity runs. | phase6/M-rerun/B3-p8d_metrics.out, phaseB/B3/p8d_metrics.out | B3/RESULT.md |
| `phaseB/B3/p9_chunks.py` | B3 probe 9: stream chunk boundaries (engine.run.stream, ACCOUNT_CONTRACT['chunk_size']) landing inside an order's life and on funding. | phaseB/B3/p9_chunks.out | B3/RESULT.md |
| `phaseB/B3/smoke.py` | 未找到 | 无同名文件 | 无 |

### phase6/L-rerun/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phase6/L-rerun/c10_events.py` | Cluster L reader of C10 raw outputs: the runner's own events (probes/out-loopback/<scenario>/run*/events.jsonl), compact. | 无同名文件 | cards-L.md |
| `phase6/L-rerun/flows.py` | Shared steps of the B2 probes on harness.Harness (the candidate's real flow). | 无同名文件 | B2/RESULT.md |
| `phase6/L-rerun/harness.py` | B2 audit harness: drive engine/live*.py in-process on Nautilus's BacktestEngine (simulated venue), no network, no credential. Modeled on tests/engine/test_live_entry.py NativeEntryTests.setUp and test | 无同名文件 | cards-L.md, cards-M.md, B2/RESULT.md, C10-live-loopback.md, C2-matching-fill.md, C3-orders.md |
| `phase6/L-rerun/p00_baseline.py` | Baseline: the candidate's real order flow on the Live wrappers, no fault. Entry GTD limit -> account check -> dispatch -> fill -> reduce-only stop; Observer ticks; daily exit decision. | phase6/L-rerun/out/p00_baseline.txt | 无 |
| `phase6/L-rerun/p01_bars_gap.py` | Item 1: market WebSocket drops and reconnects, bars missed while it was down. A flat run: gap -> entries_closed(bars_missing) -> source sees nothing -> two agreeing comparisons -> rewarming. B the dec | phase6/L-rerun/out/p01_bars_gap.txt | B2/RESULT.md |
| `phase6/L-rerun/p01d_hold_timing.py` | Item 1 side branch: a socket is renewed or reconnects just before the candidate's daily decision (00:01:00 UTC). The entry is held at the closed gate; it must leave within 55 s (GTD 660 s minus the 60 | phase6/L-rerun/out/p01d_hold_timing.txt | B2/RESULT.md |
| `phase6/L-rerun/p01e_daily_bar.py` | Item 1 side branch: the candidate's daily close comes from Nautilus's INTERNAL aggregation of the one-minute bars. With a position open the source keeps receiving bars after a gap. If the minute that  | phase6/L-rerun/out/p01e_daily_bar.txt | B2/RESULT.md （主干名） |
| `phase6/L-rerun/p02_rest_errors.py` | Item 2: REST errors, 429, timeouts. A the product's own REST reader (engine.live_venue.BinanceReadOnly.get) under HTTP 429/418/5xx, a timeout, a reset and malformed bodies: its opener is replaced, not | phase6/L-rerun/out/p02_rest_errors.txt | B2/RESULT.md |
| `phase6/L-rerun/p02c_slow_orders.py` | Item 2, order side (simulated analog): the venue answers new orders very late (a submit whose outcome stays unknown: a timeout, or the adapter retrying through a 429). The simulated venue's latency mo | phase6/L-rerun/out/p02c_slow_orders.txt | B2/RESULT.md |
| `phase6/L-rerun/p03_rejections.py` | Item 3: rejected orders, with the candidate's real callbacks on the simulated venue. A an entry the native risk engine denies (limit above the instrument's maximum price: a price-filter rejection), fl | phase6/L-rerun/out/p03_rejections.txt | B2/RESULT.md |
| `phase6/L-rerun/p04_partial_gtd.py` | Item 4: partial fill, the rest ended; GTD expiry. A partial fills (the venue consumes the offered size), the candidate's stop follows the position; the rest expires at the venue's GTD time (the simula | phase6/L-rerun/out/p04_partial_gtd.txt | B2/RESULT.md |
| `phase6/L-rerun/p05_restart.py` | Item 5: the runner is interrupted or killed with a position open, then started again (engine.live.execute, the control's own rule for starting it again read from the same files). A SIGTERM while flat  | phase6/L-rerun/out/p05_restart.txt | cards-L.md, B2/RESULT.md |
| `phase6/L-rerun/p05d_phantom.py` | Item 5 side branch (product side only): the native cache holds a position and its stop that Binance no longer has (closed at Binance while the runner was down, and native reconciliation did not match  | phase6/L-rerun/out/p05d_phantom.txt | B2/RESULT.md |
| `phase6/L-rerun/p06_cache.py` | Item 6: the native cache (Redis AOF) is lost before a start, or fails during a run. A a start again finds no retained native cache (real engine.live_cache.LiveCache rule; FakeCache applies the same ru | phase6/L-rerun/out/p06_cache.txt | B2/RESULT.md |
| `phase6/L-rerun/p07_bar_order.py` | Item 7: the same bar twice; an old bar arriving late. Run with the Live data engine's sequence validation on (as engine.live_node configures it) and off (what the product's own continuity check does i | phase6/L-rerun/out/p07_bar_order.txt | B2/RESULT.md |
| `phase6/L-rerun/p08_funding.py` | Item 8: funding settlement at the moment of an order. In-process part only: the cadence the Live source applies to funding updates (engine.cadence), and the brake's equity when a settlement lands with | phase6/L-rerun/out/p08_funding.txt | B2/RESULT.md |
| `phase6/L-rerun/p09_terms_status.py` | Item 9: the contract's tick or step changes while the run is on; the contract stops trading; the contract is gone. A Binance's tick size changes (exchangeInfo) while a position is open; the candidate  | phase6/L-rerun/out/p09_terms_status.txt | B2/RESULT.md |
| `phase6/L-rerun/p10_clock.py` | Item 10: the local clock drifts or steps (virtual wall clock; the venue's time stays true). A 1.2 s ahead at an entry's own read. B 1.2 s ahead found by the periodic comparison, then corrected. C a fo | phase6/L-rerun/out/p10_clock.txt | B2/RESULT.md |
| `phase6/L-rerun/p12_stop_brake.py` | Item 12: stop and brake with orders in flight; a cancel that never confirms; a rejected close; the end of the start. A `live stop` (the STOP file) with a position, its stop and a working add entry. B  | phase6/L-rerun/out/p12_stop_brake.txt | cards-L.md, B2/RESULT.md |
| `phase6/L-rerun/q00_c8_unreachable.sh` | 引用处：- 本产品上的证据：重跑 `probes/C8-redis-unreachable.py`（`L-rerun/out/q00_c8_unreachable.txt`）：回环端口上没有服务时，构造 `RedisCacheDatabase` 75 秒内没有返回也没 | phase6/L-rerun/out/q00_c8_unreachable.txt | cards-L.md （主干名） |
| `phase6/L-rerun/q01_final_not_flat.py` | Phase 6 cluster L supplementary probe (not a B2 script): a start that stopped for a failure and is natively flat, whose final account read then (a) fails, or (b) shows the venue not flat. Reads the re | phase6/L-rerun/out/q01_final_not_flat.txt | cards-L.md |
| `phase6/L-rerun/runall.sh` | 未找到 | 无同名文件 | 无 |

### phase6/A1-recalc/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phase6/A1-recalc/01_hcompare.py` | Independent recompute over the 40 stored `hypothesis compare` outputs. Input: /tmp/trade-audit-20261114/phaseA/ledger-raw/hcompare/*.json (ledger commit en606...). No candidate script is read. | 无同名文件 | cards-A1.md |
| `phase6/A1-recalc/02_series_stats.py` | Independent recompute from the 41x1096 daily native returns (ledger sql, read-only, commit en606...). Sharpe, Sharpe SE (iid / Mertens / Lo-autocorr), mean correlation, N-hat, cross-sectional variance | phase6/A1-recalc/02_out.txt | cards-A1.md |
| `phase6/A1-recalc/03_rc_pbo.py` | Independent rough White Reality Check (stationary bootstrap, benchmark = 0) and CSCV/PBO on the 41x1096 matrix. Written without reading phaseA/work-II scripts. | phase6/A1-recalc/03_out.txt | cards-A1.md |
| `phase6/A1-recalc/04_years.py` | Per development-year returns from the 41x1096 matrix (years cut at trade_start anniversaries: 365/365/366 days). | 无同名文件 | cards-A1.md |
| `phase6/A1-recalc/05_segments.py` | Pure-function probe of the period rules (no ledger access): ledger.lines.development_period / history_segments. | 无同名文件 | cards-A1.md |
| `phase6/A1-recalc/06_holdout_sim.py` | Rough illustration (iid normal daily returns; estimate, not a product reading): chance that a 2-year holdout path meets the two targets (annual >= 20%, max drawdown <= 15% on daily closes) for given t | 无同名文件 | cards-A1.md |
| `phase6/A1-recalc/rgx.sh` | rg over the snapshot with the audit's forbidden paths excluded | 无同名文件 | cards-A1.md |

### phase6/A2-rerun/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phase6/A2-rerun/g.sh` | 未找到 | 无同名文件 | 无 |
| `phase6/A2-rerun/mark1m.py` | 引用处：- 自己写的新探针（只读）：`mark1m.py`（开发窗口里 MARK 一分钟变动分布，给 A2-14 的影响上界）、`repro_pairs.py`（`registration.reproduction.matches` 对 explore 与研究运行配对 | phase6/A2-rerun/mark1m.out | cards-A2.md |
| `phase6/A2-rerun/repro_pairs.py` | 引用处：- 自己写的新探针（只读）：`mark1m.py`（开发窗口里 MARK 一分钟变动分布，给 A2-14 的影响上界）、`repro_pairs.py`（`registration.reproduction.matches` 对 explore 与研究运行配对 | phase6/A2-rerun/repro_pairs.out | cards-A2.md |

### phase6/M-rerun/、phase6/O-out/

（该目录下没有脚本文件）

### phaseA/work/ 与 work-II/

| 路径 | 回答的问题 | 保存的输出 | 引用它的文件 |
|---|---|---|---|
| `phaseA/work-II/path_tests.py` | Audit group II probe (read-only): search-path corrections computed from the ledger's stored daily returns. Input: run_return of the passed research runs at ledger commit en606j7h57iromf419tm9mflddrok7 | 无同名文件 | A/facet-check-II.md |
| `phaseA/work-II/sim_emax.py` | Simulation (audit group II): expected maximum of M equicorrelated no-skill Sharpe estimates, versus the product's benchmark SR0 = sqrt(cross-sectional variance) * Emax(N_hat), N_hat = rho + (1-rho) M. | 无同名文件 | A/facet-check-II.md |
| `phaseA/work/I/ledger_readings.py` | Facet I: re-derive the ledger numbers cited in facet-check-I.md from phaseA/ledger-raw/report/t*.json (read-only). | phaseA/work/I/ledger_readings.out | cards-A2.md, A/facet-check-I.md |
| `phaseA/work/I/members.py` | 引用处：- 进程内只读市场目录：`members.py`（每月成员与条款来源）、`spikes3.py`（LAST 与 MARK 同分钟偏离）。 | 无同名文件 | A/facet-check-I.md |
| `phaseA/work/I/spikes.py` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/I/spikes2.py` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/I/spikes3.py` | 引用处：- `spikes3.py`（LAST 对 MARK 同分钟偏离）：计数与候选表一致（见 A2-05）。 | 无同名文件 | cards-A2.md, A/facet-check-I.md |
| `phaseA/work/lib.sh` | 引用处：text(await tools.exec_command({cmd:"cat > /tmp/pa-author-volume.py <<'PY'\nimport json,re,hashlib\nfrom pathlib import Path\nfrom  | 无同名文件 | phase5/timeline-01a1a755.md, phase5/timeline-01a1b620.md, phase5/timeline-40c3cc0b.md, phase5/timeline-b5788262.md |
| `phaseA/work/s1.sh` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/s2.sh` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/s3.sh` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/s4.sh` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/s5.sh` | 未找到 | 无同名文件 | 无 |
| `phaseA/work/s813.sh` | usage: s813.sh FACET INDEX QUERY   (keys read inside the command, never printed) | 无同名文件 | A/facets-8-13.md |
| `phaseA/work/search17.sh` | 未找到 | 无同名文件 | 无 |

### 副本

- `probes/run-snapshots/`：304 个脚本，分布在 18 个以时间戳命名的目录，25 种不同内容（md5），18 种文件名，文件名都以 `C8r-` 开头（是）。`probes/C8r-run.sh:6` 在运行时创建该时间戳目录（读到的是脚本创建目录的语句，副本内容与 `probes/C8r-*.py` 是否逐字相同没有逐个比对）。
- `phaseB/B3/work/<案例>/probe.py`：84 个，47 种不同内容（md5），分布在 84 个案例目录（每个案例目录下另有 `reports/` 等运行产物，不在本清单）。`phaseB/B3/lib.py:268` 把 `probe.py` 写入各案例目录，应为各探针脚本为每个案例生成的单案例脚本（未逐个核对生成关系）；案例目录名前缀对应 B3 脚本（如 `p1_`、`p2_`、`p3_`）。案例目录前缀计数：p1×6、p1b×2、p2×5、p2b×2、p2c×2、p3×6、p3b×2、p4×11、p5×11、p5b×2、p6a×1、p6b×1、p6c×6、p6d×2、p6e×2、p7a×1、p7b×1、p7c×1、p7d×1、p7e×7、p8a×2、p8b×1、p8c×1、p9×7、smoke×1。
- `phase6/L-rerun/` 里与 `phaseB/B2/` 同名的 18 个脚本中，内容（md5）相同 17 个，不同 1 个（不同：harness.py）；L-rerun 独有的脚本：c10_events.py、q00_c8_unreachable.sh、q01_final_not_flat.py、runall.sh。

## 故障注入记录与对账

故障注入与探针的原始记录都在审计工作目录，按手段分。下表的“记录”一列是各手段自己的结果文件；审计记录里“故障矩阵和对账结果”一节是按它们汇编的，其中 Paper 各行按 `phaseB/B1/RESULT.md` 的最终版本写（故障注入部分写于 2026-11-14 11:40 UTC；第 10 节是收集脚本在 2026-11-15 00:13:49 UTC 自动追加的午夜读数，没有人复核过，矩阵用到它的数字都对着原始文件重算过）。

| 手段 | 记录 | 脚本与输出 |
|---|---|---|
| 回放，进程内（真实 `engine.run.main` 加合成市场，产品审计跑在输出上） | `/tmp/trade-audit-20261114/phaseB/B3/RESULT.md` | 同目录 `p1`–`p9` 脚本与 `.out`、`tests/existing_tests.out` |
| Paper，隔离 Paper 库上的真实运行与故障注入 | `/tmp/trade-audit-20261114/phaseB/B1/RESULT.md`、`NOTES.md` | 见下面“B1 的脚本与输出” |
| Live，进程内（真实产品模块加桩，回测引擎充当场所） | `/tmp/trade-audit-20261114/phaseB/B2/RESULT.md` | 同目录 `p*.py`、`out/`；核实时的重跑在 `/tmp/trade-audit-20261114/phase6/L-rerun/` |
| Live，对本地假交易所回环（真实 `engine.live.main` 加 rc7 的 Binance 适配器，无网络容器；策略是探针源码） | `/tmp/trade-audit-20261114/phaseC/C10-live-loopback.md` | `/tmp/trade-audit-20261114/probes/loopback/`、`probes/out-loopback/<情形>/`（`summary.json`、`run/events.jsonl`、`runner-1.log`） |
| Redis 探针（执行镜像一次性容器，钉住提交的 `engine/` 挂入，脚本策略；不是 Paper 或 Live 的产品链路） | `/tmp/trade-audit-20261114/phaseC/C8-redis-probes.md` | `/tmp/trade-audit-20261114/probes/C8r-*.py`、`probes/out-c8/` |
| Nautilus 原生探针（本机，无网络） | `/tmp/trade-audit-20261114/phaseC/C1…C9` 各文件第 3 节 | `/tmp/trade-audit-20261114/probes/C1-*`…`C9-*` |

### B1 的脚本与输出

都在 `/tmp/trade-audit-20261114/phaseB/B1/` 下（2026-11-14 11:45 UTC 核对目录）。宿主侧命令从主检出运行：B1 §0 记开始时 HEAD 为 `d1da7b251`，08:06 至 08:12 别的会话把检出切到 `main` 并快进到 `52ec1a690`，两个提交之间 `engine/`、`paper/`、`ledger/`、`cli/`、`runtime/`、`replay/`、`market/`、`shared/` 没有变化；runner 容器用注册表上 `exec-main` 当时的摘要 `sha256:4597cba3…`。

| 内容 | 位置 |
|---|---|
| 结果与笔记 | `RESULT.md`（最终版）、`RESULT.draft-1140.md`、`NOTES.md` |
| 审计策略源码 | `audit-churn/strategy.py`（长跑 B）；`audit-fast/`（8 分钟变体 `f1.py` 至 `f8.py`，`norecovery.py`、`reject.py`、`breach.py`、`nostop.py`）；`audit-agg/strategy.py` 与 `pause-variant.py`（聚合 bar 观察）；`smoke-1/`（冒烟） |
| 驱动与汇总脚本 | `env.sh`、`interrupt.sh`（kill 或 stop 后 resume）、`monitor.py`（每 60 秒采样）、`monsum.py`、`jsum.py`、`churn_report.py`、`agg_report.py`、`sealed.py`（从审计 Paper 库只读导出封存文件）、`autocollect.sh`（午夜后自动停止、封存、汇总） |
| 监测输出 | `monitor.csv`（每次采样每运行一行）、`bars.csv`（每根日志里的 K 线一行）、`monitor.log`、`autocollect.log` |
| 启动回执 | `start-A.json`、`start-B.json`、`publish-churn.json`、`faults/start-*.json` |
| 各故障的原始记录（时间线、恢复或封存的 JSON、杀前杀后的事件日志） | `faults/` 下 22 个子目录：`F1-kill-with-position-run4`、`F1d-daemon-auto-resume`、`F2-kill-flat-run3`、`F3-sigterm-flat-run5`、`F3c-single-contract-run20`、`F3d-single-contract-two-resumes`、`F4-sigterm-with-position-run18`、`F4b-sigterm-with-position-run19`、`F5-kill-norecovery-dow61`、`F6-redis`、`F7-egress-outage`、`F7c-long-outage`、`F8-rest-warmup`、`F9-release-lock`、`F9b-container-image`、`F10a-memory-admission`、`F10b-oom`、`F10c-disk`、`F12-orders`、`F13-no-stop`、`G2-pause-phase`、`G3-agg-after-clock-step` |
| 已导出的封存运行（`events.jsonl`、`runner.log`、`seal.json`，部分带 `reports/`） | `sealed/<paper_id>/`：运行 1、2、3、4、5、7、8、9、14、17、20、21、24。运行 16、18、19、22、23 等没有导出，可用 `sealed.py <paper_id> <目录>` 导出 |
| 长跑 B 的收尾 | `longrun-B/`：`stop.json`（封存读数）、`churn-report.txt`（订单与成交统计）、`monsum-at-1138.txt`（三条长时间运行的监测汇总）、`events-before-stop.jsonl`、`compare-attempt.txt`（比对被拒的原文）、`timeline.txt` |
| 进程内探针 | `probes/dup_out_of_order_bars.{py,out}`（重复与乱序的 K 线）、`probes/journal_failure_skips_source.{py,out}`（日志写失败时源码通用回调被跳过） |
| 对账尝试 | `compare-5.refusal.json`（运行 5）、`longrun-B/compare-attempt.txt`（运行 2）、`longrun-A/compare-attempt.json`（运行 1，午夜后），三次都是 `PAPER_COMPARE_UNCOVERED` |
| 午夜采集（长跑 A 与日线观察的收尾，2026-11-15 00:12 UTC） | `longrun-A/`：`stop.json`（运行 1 的封存读数）、`events-before-stop.jsonl`、`compare-attempt.json`（第三次比对被拒的原文）、`export.txt`；`midnight/`：`agg-report.txt`（运行 8 全部 558 根聚合 bar 的送达表）、`monsum.txt`（运行 1、8 的监测汇总）、`stop.json`、`events-before-stop.jsonl`、`export.txt`；`autocollect.log` |

没有留存原始输出、只有来源叙述的：B1 F9a 里 `resume` 被挡的秒数（`faults/F9-release-lock/barrier.out` 只有屏障的持有与释放两行）；B1 F2c（运行 16）恢复后丢成交的 runner 日志；B1 F7c（运行 22）断线期间的日志内容与封存读数（`faults/F7c-long-outage/` 只有断开与恢复两个时刻）；B1 F4b（运行 19）的封存读数；B1 F13（运行 23）`protection_gap` 的时刻（在 `NOTES.md` 里）；回环第 6 类那一次健康探测超时（`C10-live-loopback.md` §0.3 自述没有保留）。

对账：见审计记录“故障矩阵和对账结果”一节。到 2026-11-15 00:13 UTC，`paper compare` 对运行 5、运行 2、运行 1 各试过一次，三次都被 `PAPER_COMPARE_UNCOVERED` 拒绝（市场目录最新日是 2026-11-13，还没有 11-14 当天的数据），Paper 与回放的对账没有任何结果；待市场覆盖后重跑的命令在 `phaseB/B1/RESULT.md` §6。

### 审计留下的东西

2026-11-15 00:50 UTC 只读核对的现状（`docker ps -a` 与 `docker network ls` 按标签 `trade.paper.ledger=e4a618ac4959` 过滤、进程号文件对应的进程是否还在、`mount`）。都是审计自建的；用户部署的 `trade-ide-*` 容器、既有的其他 Paper 与 Live 网络、活动账本、活动市场都没有碰过。

- **审计运行**：24 条全部结束。留到午夜的运行 1（长跑 A）与运行 8（日线观察）已在 2026-11-15 00:12 UTC 由 `autocollect.sh` 停止并封存（`autocollect.log` 末行 `autocollect done 2026-11-15T00:13:49Z`）。带审计标签的容器与网络现在都是 0 个。
- **监测与收集进程**：`monitor.py` 与 `autocollect.sh` 都已退出（进程号文件还在，对应的进程不在了）。
- **Dolt 审计服务**：仍在运行，没有动。服务根是 `/tmp/trade-audit-20261114/dolt-audit`（里面有进程号文件、服务配置文件和套接字文件；服务配置文件按边界没有读）。两个库：`audit_research`（审计策略的候选）与 `audit_paper`（24 条运行）。审计结束后停服务、删目录即可，与用户的账本服务无关；停进程属于终止宿主进程，要用户来做或授权。
- **一个卸不掉的磁盘映像挂载，还在**：F10c 用的 10 MB 映像 `phaseB/B1/faults/F10c-disk/disk.dmg` 仍挂在 `/tmp/trade-audit-20261114/dolt-audit/paper/audit_paper/17`（空目录，`mount` 里还有这一行）。B1 记卸载时系统报“资源忙”：Docker Desktop 的虚拟化进程还握着已删除容器的绑定挂载句柄。审计没有强制卸载（不碰 Docker 的进程）。处理方法：Docker 下次重启之后，对这个路径执行 `hdiutil detach`，再删掉空目录；留着不影响别的运行。
- **镜像**：按摘要拉取了 `ghcr.io/qoeop/trade-runtime@sha256:4597cba3…`（当时注册表上的 `exec-main`），本机的 `exec-main` 标签没有移动。
- **已清理的**：全部 24 条运行的容器、网络、运行目录都随封存删除（`audit_paper/` 下只剩上面那个挂载点）；两次审计守护进程（`paper serve`，端口 18767）和发版屏障进程都已退出；F9b 用的假容器已删。
- **一次不该做的尝试**：2026-11-14 08:44 UTC 为确认容器内能否改时钟，B1 在自己的 runner 2 里调用了一次 `clock_settime`，被内核拒绝，没有任何效果。B1 自己记：这一步只读权限位就够，不该真调用，若成功会改到与用户容器共用的 VM 时钟。

## Nautilus 源码与文档引用

来源：`/tmp/trade-audit-20261114/phaseC/C1` 至 `C10` 的 `.md` 与 `/tmp/trade-audit-20261114/phase6/cards-{A1,A2,L,M,O,T}.md`，共 16 个文件。引用路径都相对 `nautilus_trader v2.0.0rc7`（标签 v2.0.0rc7，提交 55c0e820），已去掉本机前缀 `nautilus-rc7/`。这些路径在 `/tmp` 下，重启后会丢失。脚本：`/tmp/trade-audit-20261114/report/tools/nautilus_refs.py`。

### 提取规则

- 只提取写成 `nautilus-rc7/<路径>:<行号>` 的引用。行号写法按“单个行号”“区间 a-b”“逗号或顿号分隔的多个”拆成单条；区间保留为一条（行号区间），逗号分隔的拆成多条。
- 各文件里还有只写文件名的简写引用（例如 `fill.rs:211-222`、`mod.rs:4200-4320`、`.pyi` 位置），没有 `nautilus-rc7/` 前缀，路径不完整，没有列入下表，也没有验证。
- 引用者取该引用所在的最近标题：核实卡写卡号（如 T-05），`§N` 表示卡外的第 N 节；C 文件写 `C<n> §<节号>`，候选问题写 `C<n> §2 候选<k>`。同一条引用在多处出现时合并引用者。
- 验证：文件存在于 `/tmp/trade-audit-20261114/nautilus-rc7/` 下，且区间终点（或单行号）不超过文件行数（按字节流数换行符，最后一行无换行时也计一行）。

### 总数

- 含 `nautilus-rc7/<文件>:行号` 的出现 90 处（含无行号的 5 处）；拆成单条后 98 次，去重后 87 条，涉及 41 个文件。
- 87 条的位置都存在（文件在、行号不越界），位置不存在的 0 条。本节只验证位置存在，不验证该位置的内容是否支持引用处的说法；内容核对见审计记录“独立复核”一节（复核者 R2 只凭 rc7 源码逐条读过发现表、待证实表与用法表里的 Nautilus 依据），其中位置存在但内容与转述不对应的 5 处列在下面“内容核对后更正的位置”。
- 只有文件、没有行号的引用 5 处（去重 4 个文件），见末尾“无行号的引用”。
- 写成目录、通配、花括号或其他不含行号的路径的出现 12 处，见末尾“目录、通配与其他写法”。

### 位置核对不过的引用

没有。

### 内容核对后更正的位置（独立复核 R2）

下面 5 处在报告草稿里位置存在、但所指内容与转述不对应，其中两处引到了测试代码。更正后的位置都重新打开 rc7 源码读过。前 4 处不带 `nautilus-rc7/` 前缀或出自汇编阶段，所以不都在下面按文件分组的表里。

| 用在哪里 | 草稿原引 | 原引实际是什么 | 更正为 | 更正处的内容 |
|---|---|---|---|---|
| 发现 20261114-35（T-06），Live 事件循环的次序 | `crates/live/src/runner.rs:448-476` | 独立的 `AsyncRunner::run`，产品用的 `LiveNode.run` 走不到 | `crates/live/src/node/mod.rs:1838-1941` | `LiveNode` 自己的循环，`select!` 带 `biased`，分支次序为定时事件、系统事件、执行事件、执行命令、数据事件、数据命令 |
| 发现 20261114-35（T-07），回调异常只记日志 | `crates/common/src/clock/api.rs:377-406` | `set_timer_zoned` 的签名与日历调度的建立，没有异常处理 | 签名 `crates/common/src/clock/api.rs:377-396`；吞异常 `crates/common/src/timer.rs:208-211` | `log::error!("Python time event callback raised exception…")` 后继续 |
| 待证实 O-02 与用法表“入场类型与 Live 适配器的类型映射”行，校验失败转 `OrderDenied` | `crates/adapters/binance/src/futures/http/client.rs:3903-3925` | 测试模块里的限速器用例（该文件 `mod tests` 从第 3772 行起） | `crates/adapters/binance/src/futures/execution.rs:3903-3912` 与 `:3244-3250` | `validate_order` 把类型映射失败转成 `UnsupportedOrderType`；`emit_order_denied` |
| 用法表“重开入场的栅栏”行，`SubmissionRecoveryExhausted` 只在 Rust 一侧 | `crates/live/src/node/mod.rs:7024` | 测试代码（该文件 `mod tests` 从第 3439 行起） | `crates/live/src/execution/submission.rs:60-66` 与 `crates/live/src/execution/manager.rs:419-470` | 类型的文档注释与产生处；Python 绑定目录 `crates/{live,trading,common}/src/python/` 里 grep 无命中 |
| 发现 20261114-25 与用法表“用户流断线、listenKey 轮换”行，轮换时丢弃什么 | `crates/live/src/socket.rs:480-525` 与 `recovery.rs:199-265`，转述为“旧代事件丢弃” | `publish_if_current` 只过滤旧代的连接状态变化，不涉及订单与成交事件；`recovery.rs:239-256` 把旧流里排队的事件排干，不是丢弃 | 闸门不动：`crates/live/src/socket.rs:480-494`；缺口里的成交不补：`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:290-300` 加 `crates/live/src/execution/manager.rs:2439-2468` | 补发只含仍挂着的单（源码注释自述）；`open_check_open_only` 下“缓存有、交易所无”只记 debug |

发布说明的 4 处行号或版本归属也在同一轮复核里更正（`RELEASES-rc9.md` 第 1 行起 rc9、第 394 行起 rc8、第 751 行起 rc7）：“Added custom Python margin models…”在第 419 行、属 rc8（原写第 40 行、rc9）；“Fixed matching-engine restarts reusing position IDs…”在第 519 行、属 rc8（原写 rc9）；版本风险一行的行号列改为 `14,25,45,64,164,219,239,240,583`（原列的第 40 行无关）；“HALTED 会拒止损单”不再拿 rc8 的第 465 行作 rc7 行为的依据，改引 rc7 源码 `crates/risk/src/engine/mod.rs:1894-1915`。

### 位置核对通过的引用（按文件分组）

每个文件一行；括号内是引用该行（区间）的编号。路径前省略 `nautilus_trader v2.0.0rc7`。

| 文件 | 行号（引用者） |
|---|---|
| `MIGRATION_V2.md` (1097 行) | 53 [C7 §0] |
| `crates/adapters/binance/src/common/credential.rs` (595 行) | 54-106 [L-24] |
| `crates/adapters/binance/src/common/http.rs` (88 行) | 25-39 [L-07] |
| `crates/adapters/binance/src/common/parse.rs` (2836 行) | 364 [C4 §2 候选3, M-03]; 386-387 [C4 §2 候选3] |
| `crates/adapters/binance/src/config.rs` (835 行) | 203 [C10 §0 0.1]; 208 [C10 §0 0.1]; 218-229 [T-08]; 354 [C10 §0 0.1]; 354-358 [C7 节外]; 358 [C10 §0 0.1] |
| `crates/adapters/binance/src/futures/conversions.rs` (247 行) | 70-86 [M-11] |
| `crates/adapters/binance/src/futures/data.rs` (3306 行) | 185-191 [L-24]; 1407-1429 [§0]; 1407-1450 [T-08] |
| `crates/adapters/binance/src/futures/execution.rs` (5071 行) | 219-229 [L-24]; 583-587 [C2 §2 候选3]; 583-590 [O-05]; 1661-1668 [O-01]; 1663-1669 [§0]; 1727-1728 [M-13]; 2887-3000 [C7 §1] |
| `crates/adapters/binance/src/futures/websocket/streams/client.rs` (948 行) | 739-753 [T-02] |
| `crates/adapters/binance/src/futures/websocket/streams/dispatch.rs` (3820 行) | 1386-1409 [O-09]; 1418-1441 [L-10] |
| `crates/adapters/binance/src/futures/websocket/streams/parse_data.rs` (1080 行) | 480 [§0] |
| `crates/adapters/sandbox/src/execution.rs` (1899 行) | 638-660 [L-14]; 946-988 [L-14]; 988-1015 [C2 §0]; 990-1018 [L-15] |
| `crates/backtest/src/engine.rs` (4591 行) | 420-433 [C1 §1]; 1904-1948 [M-12, T-17] |
| `crates/backtest/src/exchange.rs` (2389 行) | 474-505 [C2 §0]; 1380-1410 [M-10] |
| `crates/backtest/src/node.rs` (1569 行) | 446-592 [T-16] |
| `crates/common/src/clock/api.rs` (549 行) | 377-406 [T-07]（内容更正见上一节：签名在 377-396，吞异常在 `timer.rs:208-211`） |
| `crates/common/src/live/timer.rs` (1529 行) | 463-471 [T-01, §0] |
| `crates/common/src/timer.rs` (1372 行) | 388-394 [T-06] |
| `crates/data/src/aggregation.rs` (9558 行) | 296-330 [T-05]; 1496-1608 [C9 §1]; 1678-1689 [§0]; 1890-1900 [T-05] |
| `crates/data/src/engine/config.rs` (89 行) | 33-62 [T-01]; 51-53 [C7 §1] |
| `crates/data/src/engine/dispatch.rs` (497 行) | 471-495 [T-04, T-15] |
| `crates/execution/src/engine/mod.rs` (5769 行) | 968-1000 [C7 §1]; 1370-1373 [L-09]; 1461-1463 [L-09] |
| `crates/execution/src/matching_core.rs` (2056 行) | 580-595 [O-05] |
| `crates/execution/src/matching_engine/ids_generator.rs` (858 行) | 156-171 [C5 §1]; 236-250 [L-15] |
| `crates/execution/src/matching_engine/mod.rs` (12937 行) | 1472-1481 [T-11]; 1561-1590 [T-11]; 2303-2305 [O-11]; 2573-2598 [T-10]; 3962-3993 [O-04]; 4235-4262 [O-03]; 6035-6095 [O-08]; 7787-7850 [O-10] |
| `crates/infrastructure/src/redis/cache.rs` (1985 行) | 193-205 [L-17]; 668-700 [L-20]; 760-830 [L-20] |
| `crates/live/src/execution/manager.rs` (7938 行) | 1996-2010 [L-11]; 2007-2011 [C10 §2 2.5, C10 节外, L-05]; 2439-2468 [C10 §2 2.1, L-10]; 4711 [C7 §1, L-09] |
| `crates/live/src/node/config.rs` (2368 行) | 480-482 [C10 §2 2.1, L-10]; 785-802 [L-13] |
| `crates/live/src/node/mod.rs` (12738 行) | 435-560 [C7 §1]; 1536 [§0]; 1617-1620 [§0]; 2504-2515 [§0] |
| `crates/live/src/python/config.rs` (1449 行) | 333-343 [A2-13] |
| `crates/live/src/python/node.rs` (5433 行) | 1131-1136 [C7 §0] |
| `crates/live/src/socket.rs` (1015 行) | 480-525 [C7 §1]（内容更正见上一节：只过滤连接状态事件，对应 480-494） |
| `crates/model/src/accounts/margin_model.rs` (744 行) | 238-274 [C5 §2 候选4, M-08] |
| `crates/model/src/instruments/mod.rs` (2269 行) | 358-378 [T-12]; 483-505 [T-12] |
| `crates/model/src/types/fixed.rs` (2600 行) | 840-876 [C5 §3] |
| `crates/portfolio/src/manager.rs` (5740 行) | 217-290 [M-04] |
| `crates/risk/src/engine/mod.rs` (3067 行) | 206-250 [M-01]; 1751-1795 [M-05]; 2420-2445 [M-05] |
| `crates/risk/src/python/mod.rs` (34 行) | 25-31 [C4 §0] |
| `crates/trading/src/strategy/mod.rs` (7644 行) | 1126-1170 [O-07] |
| `python/nautilus_trader/backtest/__init__.pyi` (572 行) | 457-488 [C2 §0] |
| `python/nautilus_trader/execution/__init__.pyi` (307 行) | 77 [C2 §0] |

### 无行号的引用

| 文件 | 文件是否存在 | 引用者 |
|---|---|---|
| `crates/adapters/sandbox/src/config.rs` | 是 | O-06 |
| `crates/data/src/engine/responses.rs` | 是 | T-14 |
| `crates/execution/src/matching_engine/mod.rs` | 是 | C2 §0, C3 §0 |
| `crates/risk/src/engine/mod.rs` | 是 | C4 §0 |

### 目录、通配与其他写法

| 写法（已去前缀） | 目录或文件是否存在 | 引用者 |
|---|---|---|
| `（仅前缀）` | 否 | C7 节外, 卡外 |
| `crates/` | 是 | C6 §0, C8 节外 |
| `crates/adapters/binance/src/futures/{execution.rs` | 含花括号或占位，未验证 | C3 §0 |
| `crates/adapters/binance/test_data/futures/` | 是 | C10 §0 0.1 |
| `crates/adapters/sandbox/src` | 是 | M-10 |
| `crates/trading/src/strategy/{mod.rs` | 含花括号或占位，未验证 | C3 §0 |

### rc8 与 rc9 发布说明引用

来源：`/tmp/trade-audit-20261114/phase0/newer-fixes.md`，其“RELEASES 行号”指 `/tmp/trade-audit-20261114/phase0/RELEASES-rc9.md` 的行号（该文件 L1-L391 为 rc9，L394-L749 为 rc8，据来源文件第 5–7 行）。条目为来源文件里的原文节选。来源里 rc7 的 33 行不在本次范围，未列；来源第四节的 GitHub issue 表不是发布说明，也未列。

| 版本 | 条目（原文节选） | RELEASES-rc9.md 行号 | 相关组件 | 来源行 |
|---|---|---|---|---|
| rc9 | "Added `OrderPriorityResetPolicy` for sandbox and backtests (#5503)" | L26 | Sandbox、回测撮合 | newer-fixes.md:20 |
| rc9 | "Added sandbox execution matching against `OrderBookDepth` snapshots (#5436)" | L41 | Sandbox 撮合 | newer-fixes.md:21 |
| rc9 | "Added warnings for bounded startup fills without position coverage (#5541)" | L16 | 对账 | newer-fixes.md:22 |
| rc9 | "Added `OrderModifyDenied` and `OrderCancelDenied` events" | L25 | 订单修改/撤单事件 | newer-fixes.md:23 |
| rc9 | "Added `LiveExecutionEngineConfig.purge_from_database` support in Python and live nodes" | L22 | LiveNode、缓存 | newer-fixes.md:24 |
| rc9 | "Added `Cache` lazy instrument and synthetic loads, saved component-state deletion, and explicit heartbeat writes" | L19 | Redis 缓存 | newer-fixes.md:25 |
| rc9 | "Added `BacktestNodeBuilder` with custom catalog factories for instrument loading and replay" | L18 | BacktestNode、目录 | newer-fixes.md:26 |
| rc9 | "Added Python `ParquetDataCatalog.query_instrument_statuses` and `query_instrument_closes`" | L28 | ParquetDataCatalog | newer-fixes.md:27 |
| rc9 Breaking | "Removed Python `RedisCacheDatabase` and `PostgresCacheDatabase`; configure cache persistence through node factories" | L45 | Redis 缓存、节点工厂 | newer-fixes.md:28 |
| rc9 Breaking | "Removed Python `RedisMessageBusBacking`; configure external message bus backing through node factories" | L46 | Redis 消息总线 | newer-fixes.md:29 |
| rc9 Breaking | "Changed Parquet consolidation to reject gaps by default" | L50 | ParquetDataCatalog | newer-fixes.md:30 |
| rc9 Breaking | "Changed Redis message retries to at-least-once delivery; deduplicate messages (#5491)" | L54 | Redis 消息总线 | newer-fixes.md:31 |
| rc9 Breaking | "Changed `BacktestEngine::reset` to return trader reset errors" | L63 | BacktestEngine | newer-fixes.md:32 |
| rc9 Breaking | "Changed local modify/cancel refusals to denied events" | L64 | 改单/撤单拒绝 | newer-fixes.md:33 |
| rc9 Breaking | "Changed `OrderMatchingEngineConfig` literals; add `order_priority_reset_policy`" | L61 | 撮合配置 | newer-fixes.md:34 |
| rc9 Breaking | "Changed `SimulatedVenueConfig` literals; add `order_priority_reset_policy`" | L62 | 回测 venue 配置 | newer-fixes.md:35 |
| rc9 Breaking | "Changed `SandboxExecutionClientConfig` literals; add `order_priority_reset_policy`" | L133 | Sandbox 配置 | newer-fixes.md:36 |
| rc9 Breaking | "Changed ordinary cache persistence failures to log and continue" | L84 | Redis 缓存持久化 | newer-fixes.md:37 |
| rc9 Breaking | "Changed raw `Price` and `Quantity` construction and decoding to reject digits beyond precision" | L75 | 精度 | newer-fixes.md:38 |
| rc9 Breaking | "Changed `Price.from_decimal` and `Quantity.from_decimal` to round excess decimal places half even" | L76 | 精度 | newer-fixes.md:39 |
| rc9 Breaking | "Changed Binance non-GET REST requests to fail at quota gates" | L86 | Binance 执行 REST | newer-fixes.md:40 |
| rc9 Breaking | "Changed Binance REST to block on 418 without `Retry-After`" | L88 | Binance REST | newer-fixes.md:41 |
| rc9 Security | "Fixed Parquet consolidation hiding gaps, misordering rows, and duplicating data after cleanup errors" | L138 | ParquetDataCatalog | newer-fixes.md:42 |
| rc9 Security | "Fixed `Throttler` timer deadline overflow that could panic during order submission" | L140 | 下单节流、时钟 | newer-fixes.md:43 |
| rc9 Fixes | "Fixed historical bar requests losing aggregation after live unsubscribe (#5597)" | L151 | K 线聚合 | newer-fixes.md:44 |
| rc9 Fixes | "Fixed L1 slippage exceeding limit and protection prices (#5612)" | L152 | 撮合、滑点、保护价 | newer-fixes.md:45 |
| rc9 Fixes | "Fixed L1 trade-only matching using stale passive-side prices (#5573)" | L153 | 撮合（trade 数据） | newer-fixes.md:46 |
| rc9 Fixes | "Fixed simulated order modifications filling while markets are not open (#5610)" | L155 | 撮合、改单 | newer-fixes.md:47 |
| rc9 Fixes | "Fixed unmatched triggered limit-style `IOC` and `FOK` orders resting on the book (#5608)" | L156 | 撮合、TIF | newer-fixes.md:48 |
| rc9 Fixes | "Fixed backtest funding settlement for single-currency accounts (#5581)" | L157 | 资金费、单币种账户 | newer-fixes.md:49 |
| rc9 Fixes | "Fixed Python `open_check_lookback_mins=None` ignoring unbounded lookback (#5540)" | L158 | 对账（Python 配置） | newer-fixes.md:50 |
| rc9 Fixes | "Fixed orders losing the initialization event's reconciliation flag (#5523)" | L159 | 对账 | newer-fixes.md:51 |
| rc9 Fixes | "Fixed matching engines retaining stale instrument definitions during replay (#5505)" | L161 | 回测撮合、replay | newer-fixes.md:52 |
| rc9 Fixes | "Fixed Redis message publishing stopping after retryable write errors (#5491)" | L163 | Redis 消息总线 | newer-fixes.md:53 |
| rc9 Fixes | "Fixed live data disrupting historical bar aggregator warm-up (#5469)" | L164 | K 线聚合、LiveNode | newer-fixes.md:54 |
| rc9 Fixes | "Fixed pending orders reusing closing position quantity before venue acknowledgement" | L165 | 仓位、reduce-only | newer-fixes.md:55 |
| rc9 Fixes | "Fixed cache persistence failures interrupting memory updates, order submission, and event processing" | L172 | Redis 缓存 | newer-fixes.md:56 |
| rc9 Fixes | "Fixed data and execution client connection failures waiting for timeouts instead of aborting node startup" | L173 | LiveNode 启动 | newer-fixes.md:57 |
| rc9 Fixes | "Fixed `Portfolio` skipping restored-order reservations when instrument, account, or price data arrives" | L181 | Portfolio、保证金 | newer-fixes.md:58 |
| rc9 Fixes | "Fixed `Portfolio` venue-wide margin equity reusing stale PnL after price or exchange rate changes" | L182 | Portfolio 保证金 | newer-fixes.md:59 |
| rc9 Fixes | "Fixed native strategy startup skipping GTD timer reactivation and expired-order cancellation" | L184 | GTD | newer-fixes.md:60 |
| rc9 Fixes | "Fixed emulated orders sharing a trigger instrument triggering from the wrong quote or trade source" | L188 | 触发、emulated | newer-fixes.md:61 |
| rc9 Fixes | "Fixed resting GTD orders filling after expiry in backtests and sandbox execution" | L189 | GTD、回测、Sandbox | newer-fixes.md:62 |
| rc9 Fixes | "Fixed dynamically added backtest components starting at epoch time and missing timer deadlines" | L191 | 时钟 timer、回测 | newer-fixes.md:63 |
| rc9 Fixes | "Fixed `Strategy::market_exit` skipping emulated and active-local orders during cancellation" | L194 | 平仓、撤单 | newer-fixes.md:64 |
| rc9 Fixes | "Fixed bounded reconciliation leaving retained positions open after explicit closing fills" | L195 | 对账、仓位 | newer-fixes.md:65 |
| rc9 Fixes | "Fixed closed-order and position purges ignoring `purge_from_database` in execution timers" | L199 | 执行定时器、缓存清理 | newer-fixes.md:66 |
| rc9 Fixes | "Fixed Redis order and position deletion leaving routine snapshots and restoring purged positions" | L200 | Redis 缓存 | newer-fixes.md:67 |
| rc9 Fixes | "Fixed built-in Redis cache records ignoring `timestamps_as_iso8601`" | L201 | Redis 缓存格式 | newer-fixes.md:68 |
| rc9 Fixes | "Fixed Redis cache bulk loads ignoring `bulk_read_batch_size`" | L204 | Redis 缓存加载 | newer-fixes.md:69 |
| rc9 Fixes | "Fixed Redis cache decoding of v1 Cython currencies, instruments, accounts, and component state" | L205 | Redis 缓存解码（旧格式） | newer-fixes.md:70 |
| rc9 Fixes | "Fixed `Cache` indexing closed positions as open and excluding them from purging after insertion" | L207 | 缓存仓位索引 | newer-fixes.md:71 |
| rc9 Fixes | "Fixed NETTING realized PnL for cycles with equal PnL and after fill voids (#5534)" | L208 | NETTING 盈亏 | newer-fixes.md:72 |
| rc9 Fixes | "Fixed command refusals clearing unrelated pending operations or rolling back later order state" | L211 | 订单命令 | newer-fixes.md:73 |
| rc9 Fixes | "Fixed historical time bar boundary assignment for ticks sharing a timestamp" | L215 | K 线边界 | newer-fixes.md:74 |
| rc9 Fixes | "Fixed composite time bars closing before their final source bar at a shared deadline" | L216 | K 线聚合 | newer-fixes.md:75 |
| rc9 Fixes | "Fixed queued timer callbacks logging missing-actor errors or targeting reused actor IDs" | L217 | 时钟 timer | newer-fixes.md:76 |
| rc9 Fixes | "Fixed backtest timer cancellation across data gaps and tail flushes" | L218 | 回测 timer | newer-fixes.md:77 |
| rc9 Fixes | "Fixed backtest liquidation on bar and trade data (#5538)" | L219 | 爆仓、回测 | newer-fixes.md:78 |
| rc9 Fixes | "Fixed `BacktestEngine` reset hiding component reset failures" | L220 | BacktestEngine | newer-fixes.md:79 |
| rc9 Fixes | "Fixed streaming backtests failing to resume when the first batch has only data before the start time" | L222 | 流式回测 | newer-fixes.md:80 |
| rc9 Fixes | "Fixed false WebSocket heartbeat timeouts while receiving fragmented messages" | L232 | 行情/用户 WebSocket | newer-fixes.md:81 |
| rc9 Fixes | "Fixed startup reconciliation failing when execution clients publish recovered instruments" | L233 | 启动对账 | newer-fixes.md:82 |
| rc9 Fixes | "Fixed reconciliation double-counting order-report fills already covered by venue positions" | L234 | 对账 | newer-fixes.md:83 |
| rc9 Fixes | "Fixed startup margin calculations overwriting reported account balances" | L235 | 保证金账户 | newer-fixes.md:84 |
| rc9 Fixes | "Fixed Binance Futures initial margin underestimation (#5531)" | L239 | Binance USD-M 保证金 | newer-fixes.md:85 |
| rc9 Fixes | "Fixed Binance startup reconciliation omitting closed orders from selected instruments" | L240 | Binance 对账 | newer-fixes.md:86 |
| rc9 Fixes | "Fixed Binance Futures instrument `ts_event` and `ts_init` defaulting to zero" | L241 | Binance USD-M 合约定义 | newer-fixes.md:87 |
| rc9 Fixes | "Fixed Binance REST requests ignoring 429 and 418 cooldowns from other requests" | L242 | Binance REST 限流 | newer-fixes.md:88 |
| rc9 Fixes | "Fixed Binance cancellations and COIN-M modifications consuming order-count quota" | L243 | Binance 撤单、限流 | newer-fixes.md:89 |
| rc9 Fixes | "Fixed Binance REST pacing ignoring endpoint weights and USD-M funding and open-interest limits" | L245 | Binance USD-M 资金费/限流 | newer-fixes.md:90 |
| rc9 Fixes | "Fixed Binance Futures sided cancel-all selecting other accounts' orders (#5467)" | L246 | Binance 撤单 | newer-fixes.md:91 |
| rc8 Enh. | "Added custom fee models for sandbox execution clients (#5328)" | L416 | Sandbox、手续费 | newer-fixes.md:99 |
| rc8 Enh. | "Added custom Python fill models in backtest venue and sandbox configuration" | L418 | 撮合 fill model | newer-fixes.md:100 |
| rc8 Enh. | "Added custom Python margin models in backtest venue and sandbox configuration" | L419 | 保证金模型 | newer-fixes.md:101 |
| rc8 Enh. | "Added Python-subclassable latency models with command and clock time context" | L417 | 延迟模型 | newer-fixes.md:102 |
| rc8 Enh. | "Added optional venue-reported liquidation prices to `PositionStatusReport`" | L415 | 爆仓、对账报告 | newer-fixes.md:103 |
| rc8 Enh. | "Added accumulation of fractional `Money` commissions beyond currency precision" | L414 | 手续费、精度 | newer-fixes.md:104 |
| rc8 Enh. | "Added `ReplaySource` and `DataIterator::add_source` for fallible replay with pending frontiers" | L401 | 回测流式 replay | newer-fixes.md:105 |
| rc8 Enh. | "Added `LiveNode::add_python_strategy_from_config` for embedded Python strategies" | L410 | LiveNode、Python 策略 | newer-fixes.md:106 |
| rc8 Breaking | "Removed `instrument_expiration` and `has_unprocessed_instrument_expiration` (#5407)" | L440 | 合约到期 | newer-fixes.md:107 |
| rc8 Breaking | "Removed Cap'n Proto codecs and `capnp` features; use JSON or MessagePack" | L438 | 序列化、消息总线 | newer-fixes.md:108 |
| rc8 Breaking | "Changed simulated `MARK_PRICE` triggers to require mark updates" | L446 | 撮合触发 | newer-fixes.md:109 |
| rc8 Breaking | "Changed `DataIterator::{peek, next, next_stream_item}` to return `Result<ReplayPoll<_>>`" | L448 | 回测流式 | newer-fixes.md:110 |
| rc8 Breaking | "Changed backtest registration to reject conflicting definitions for an instrument ID (#5407)" | L456 | 回测合约注册 | newer-fixes.md:111 |
| rc8 Breaking | "Changed `nautilus-pyo3` without default features to omit standard adapter bindings" | L457 | Python 绑定（PyO3） | newer-fixes.md:112 |
| rc8 Breaking | "Changed `Money` deserialization to reject excess precision instead of rounding" | L461 | 精度、缓存反序列化 | newer-fixes.md:113 |
| rc8 Breaking | "Changed `BusMessage` to add `source`; use `BusMessage::new` to construct" | L463 | 消息总线 | newer-fixes.md:114 |
| rc8 Breaking | "Changed `PositionStatusReport` literals: add `liquidation_price: None` or use `new`" | L464 | 爆仓、对账报告 | newer-fixes.md:115 |
| rc8 Breaking | "Changed emulated releases to undergo risk checks; use `REDUCING` for eligible exits" | L465 | RiskEngine、emulated 退出 | newer-fixes.md:116 |
| rc8 Breaking | "Changed order-list validation to deny unsent siblings; retry with new IDs (#5336)" | L466 | 订单列表、bracket | newer-fixes.md:117 |
| rc8 Breaking | "Changed `OrderMatchingEngine` expiration to wait for queued fills" | L468 | 撮合到期、GTD | newer-fixes.md:118 |
| rc8 Breaking | "Changed `LatencyModel` operation methods; accept `(command, ts_now)` and return `Result`" | L469 | 延迟模型 | newer-fixes.md:119 |
| rc8 Breaking | "Changed Python `BacktestVenueConfig` model and module argument order; pass them by keyword" | L470 | 回测 venue 配置 | newer-fixes.md:120 |
| rc8 Breaking | "Changed Python `BacktestEngine.add_venue()` model argument order; pass models by keyword" | L471 | BacktestEngine | newer-fixes.md:121 |
| rc8 Breaking | "Changed Python `SandboxExecutionClientConfig` argument order; pass models and matching options by keyword" | L472 | Sandbox 配置 | newer-fixes.md:122 |
| rc8 Breaking | "Changed `MarginModelAny` with the `python` feature enabled; add the `Python` variant" | L473 | 保证金模型 | newer-fixes.md:123 |
| rc8 Breaking | "Changed `SandboxExecutionClientConfig` literals; add `margin_model: None`" | L474 | Sandbox 配置 | newer-fixes.md:124 |
| rc8 Breaking | "Changed unsupported post-only denials to `UNSUPPORTED_POST_ONLY`; update reason string matching" | L478 | 拒单原因字符串（post-only） | newer-fixes.md:125 |
| rc8 Breaking | "Changed unsupported quote-quantity denials to `UNSUPPORTED_QUOTE_QUANTITY`" | L477 | 拒单原因字符串 | newer-fixes.md:126 |
| rc8 Fixes | "Fixed backtest aborts on non-time execution bars (#5271)" | L517 | bar 撮合 | newer-fixes.md:127 |
| rc8 Fixes | "Fixed order fills accepting cumulative commissions beyond `Money` bounds" | L518 | 成交、手续费 | newer-fixes.md:128 |
| rc8 Fixes | "Fixed matching-engine restarts reusing position IDs for independent hedging orders" | L519 | HEDGING 仓位 ID | newer-fixes.md:129 |
| rc8 Fixes | "Fixed Parquet period consolidation and delete losing rows when rewrites share a file name (#5422)" | L523 | ParquetDataCatalog | newer-fixes.md:130 |
| rc8 Fixes | "Fixed Parquet catalog queries reading NaN floats back as another row's value (#5422)" | L524 | ParquetDataCatalog | newer-fixes.md:131 |
| rc8 Fixes | "Fixed Parquet promotion rejecting bar replays and skipping cleanup (#5400)" | L534 | ParquetDataCatalog、bar | newer-fixes.md:132 |
| rc8 Fixes | "Fixed backtest `MARK_PRICE` triggers ignoring mark prices (#5264)" | L535 | 撮合触发 | newer-fixes.md:133 |
| rc8 Fixes | "Fixed NETTING PnL statistics losing cycles with the same open timestamp (#5288)" | L536 | NETTING 统计 | newer-fixes.md:134 |
| rc8 Fixes | "Fixed unavailable `OrderFilled` commissions displaying as zero" | L538 | 手续费显示 | newer-fixes.md:135 |
| rc8 Fixes | "Fixed live bulk order reconciliation timeouts discarding finalized adapter reports" | L539 | LiveNode 对账 | newer-fixes.md:136 |
| rc8 Fixes | "Fixed live timer backlogs starving data events and commands (#5431)" | L540 | 时钟、LiveNode | newer-fixes.md:137 |
| rc8 Fixes | "Fixed position reconciliation timeouts discarding finalized snapshots and authoritative fills" | L542 | 对账 | newer-fixes.md:138 |
| rc8 Fixes | "Fixed Python `LiveNode.add_strategy_from_config` accepting strategies when the node is not idle" | L543 | LiveNode Python | newer-fixes.md:139 |
| rc8 Fixes | "Fixed targeted order reconciliation discarding accepted statuses and fills after timeout" | L546 | 对账 | newer-fixes.md:140 |
| rc8 Fixes | "Fixed OUO sibling resizes converting base quantities twice when quote-denominated stops trigger" | L547 | OUO、stop | newer-fixes.md:141 |
| rc8 Fixes | "Fixed matching engine bracket exit rejections cascading to valid siblings (#5460)" | L548 | 撮合 bracket | newer-fixes.md:142 |
| rc8 Fixes | "Fixed LAST and MID bar execution skipping positive volume when OHLC prices repeat" | L549 | bar 撮合 | newer-fixes.md:143 |
| rc8 Fixes | "Fixed matching engine liquidity overconsumption with market-to-limit, reduce-only, and queue position tracking" | L550 | 撮合、reduce-only、队列 | newer-fixes.md:144 |
| rc8 Fixes | "Fixed expiration settlement missing final-tick fills when position updates are deferred" | L551 | 到期结算 | newer-fixes.md:145 |
| rc8 Fixes | "Fixed reduce-only FOK orders canceling when liquidity covered the remaining position" | L552 | reduce-only、FOK | newer-fixes.md:146 |
| rc8 Fixes | "Fixed `MarketToLimit` first-level fills and FOK/IOC handling (#5408)" | L553 | 撮合 | newer-fixes.md:147 |
| rc8 Fixes | "Fixed reconciliation leaving amended orders in `PendingUpdate` after working reports confirm" | L558 | 对账、改单 | newer-fixes.md:148 |
| rc8 Fixes | "Fixed startup reconciliation leaving orders partially filled after venue quantity reductions" | L559 | 启动对账 | newer-fixes.md:149 |
| rc8 Fixes | "Fixed risk denials for released orders and cleanup of their contingent orders" | L560 | RiskEngine、contingent | newer-fixes.md:150 |
| rc8 Fixes | "Fixed sandbox restarts reviving closed OTO children while the cache still shows them open" | L567 | Sandbox 重启 | newer-fixes.md:151 |
| rc8 Fixes | "Fixed sandbox position checks creating spurious closing trades (#5357)" | L568 | Sandbox | newer-fixes.md:152 |
| rc8 Fixes | "Fixed Binance Futures funding-fee account updates discarding symbol attribution" | L577 | Binance USD-M 资金费 | newer-fixes.md:153 |
| rc8 Fixes | "Fixed Binance USD-M and COIN-M aggregate trade requests rejecting history between 24 and 48 hours old" | L576 | Binance aggTrades | newer-fixes.md:154 |
| rc8 Fixes | "Fixed Binance Futures HTTP order reports using update time as acceptance time" | L578 | Binance USD-M 订单报告 | newer-fixes.md:155 |
| rc8 Fixes | "Fixed Binance Futures recovery stalling on expired listen keys (#5446)" | L583 | Binance 用户数据流 | newer-fixes.md:156 |
| rc8 Fixes | "Fixed Binance Spot and Futures overlapping instrument-status updates losing or duplicating changes" | L575 | Binance USD-M 合约状态 | newer-fixes.md:157 |
| rc8 Internal | "Optimized passive limit matching and L1 queue tracking with many orders behind the BBO" | L683 | 撮合队列 | newer-fixes.md:158 |
| rc8 Internal | "Optimized virtual hedging fill-history checks during execution and reconciliation" | L687 | HEDGING | newer-fixes.md:159 |
| rc8 Internal | "Upgraded `pyo3` crate to v0.30.1" | L717 | Python 绑定（PyO3） | newer-fixes.md:160 |

## Nautilus 用法表（完整版）

范围：回放（`engine/run.py` 一系）、Paper（`engine/paper*.py`、`paper/`）、Live（`engine/live*.py`、`live/`）三条链路对 `nautilus_trader v2.0.0rc7` 的用法，对照钉住提交（`65a3c12990c4`）的代码与 rc7 源码。产品 import 的是 v2 的 Rust 核心加 PyO3 层，不是 v1 的 Cython。

读法：

- 分类只用六种：正确使用、重复实现（理由成立的写“有理由的重复实现”）、该用未用、用法错误、版本风险、未验证的假设。每行一种分类；一个来源行里有两种分类的，已拆成两行。每组末尾的“查过无问题的点”“没查的”两行是汇总，分类栏写“不分类”，不计入分类行数。
- 凡分类为“用法错误”或“重复实现”的行，同时给出 Nautilus 源码位置和产品代码位置；缺一的已在证据格写明缺什么，并降为“未验证的假设”。
- “用法错误”收的是“产品现在的配置或规则，加上 rc7 的实际行为，会得到与设计不符的结果”，包含三种情形，各行证据格写明是哪一种：产品传给 Nautilus 的配置或调用本身不合适；产品自己的调用没有错，缺的是规则层没有挡住候选这样写（订单组的类型、时效、GTD、触发价类型各行）；产品依赖了 rc7 上有缺陷、上游已在后续版本修掉的原生行为（Sandbox 重启后的仓位 id）。
- “有理由的重复实现”里有几行严格说不是重复实现，仍按六种分类归在这里并在证据格注明：联动单是“Nautilus 提供、产品有理由不用”；交易状态、重开入场的栅栏是“rc7 不提供、产品自己补”。
- 本表在独立复核（R2 只凭 rc7 源码、R3 产品证据）之后改过 19 行：改分类 1 行（合约状态与下架（Paper），该用未用改为未验证的假设）、更正 Nautilus 引用位置 6 行（其中两处原引到测试代码）、更正发布说明行号与版本 1 行、按后出的证据改写 5 行（Paper 读回的连接参数、Sandbox 重启后的仓位 id、GTD 过期与撮合先后、`filter_unclaimed_external_orders`、Live 止损放在交易所）、补说明或措辞 5 行、转义 1 行。
- “核实卡 O-、M-、T-、L-”指第 6 阶段的逐条核实卡编号。核实卡把某条驳回或判已覆盖的，对应行的分类与措辞已按卡的结论改动，并在证据格写明。
- 探针名（如 C2-gap-slip-limit）指审计期间的临时脚本，不在仓库里。“C1 至 C9”指按组件分的九份比对笔记。
- 表里的行号取自钉住提交的快照；Nautilus 的行号取自标签 v2.0.0rc7（55c0e820）的源码；`RELEASES-rc9.md:行号` 指 rc9 发布说明（rc9 在第 1 至 393 行，rc8 在第 394 至 750 行，rc7 从第 751 行起）。
- 第 10 份笔记（Live 回环）没有用法行，没有并入本表；它的探针结果作为证据出现在核实卡 L-03、L-09、L-10、L-11 等行里。

| 组件 | Nautilus 提供什么（源码位置） | 产品怎么做（file:line） | 分类 | 证据 |
| --- | --- | --- | --- | --- |
| 回测引擎与数据目录：BacktestEngine 流式加载（add_data、run(streaming=True)、end） | nautilus_trader v2.0.0rc7：add_data 对每块做稳定的 `sort_by_key(ts_init)`，成一个命名流：`crates/backtest/src/engine.rs:420-433`；run 在 `crates/backtest/src/engine.rs:701-760`；文档要求每个流式批包含某个 ts_init 的全部数据：`crates/backtest/src/engine.rs:679-690`；回放迭代器按 replay_key 稳定排序，key 只有 ts_init：`crates/data/src/replay/iterator.rs:60-68` | 回放：`engine/run.py:658-685` 的 `stream()`，每块 50,000 条并延伸到同一 ts_init 的最后一条，`add_data(chunk, None, False, True)`、`run(start, end, RUN_ID, True)`、`clear_data()`，末尾 `engine.end()` | 正确使用 | 与 `crates/backtest/src/node.rs:544-592` 的 `stream_chunks`、`take_aligned_chunk` 同构（首块 start=None，之后 start=上块 end，最后一块 end 取 None，结尾 `end()`）。探针 C1-chunk-size-independence：块大小 1、3、50、50000，窗口 6 小时、1 天，共 8 组，订单、成交、持仓、账户、策略所见、观察者、敞口全相同；对照探针 C1-chunk-unaligned-control（不对齐 ts_init 的块）能测出 `seen` 差异 |
| 回测引擎与数据目录：同 ts_init 的事件顺序 | nautilus_trader v2.0.0rc7：引擎内部只做稳定排序（同上），同 ts_init 的先后等于传入列表顺序：`crates/backtest/src/engine.rs:428`、`crates/data/src/replay/iterator.rs:60-68` | 回放：`engine/run.py:586-655` 的 `market_events`，每个 ts_init 一组，按（合约序，类型序 MARK、报价、成交、metrics、资金费、K 线、状态、收盘）稳定排序后交给引擎；排序规则见 `engine/run.py:534-537,619-631` | 正确使用 | 自己实现的顺序规则，依赖 Nautilus 的稳定排序。`tests/engine/test_stream.py:569-601` 与 BacktestNode 同输入比对（块大小 1，含“资金费压在 bar 收盘”）。这个比对证明“顺序与 node 一致”，不证明“顺序语义正确”。同刻次序对策略可见的部分见核实卡 T-06 |
| 回测引擎与数据目录：同 ts 上资金费的结算时点 | nautilus_trader v2.0.0rc7：`process_funding_rate_deferred` 只入队：`crates/backtest/src/exchange.rs:1198-1207`；`finalize_timestamp` 先 `settle_venues` 再 `settle_funding_rates`：`crates/backtest/src/engine.rs:1841-1880`；边界等于 `next_funding_ns`：`crates/backtest/src/exchange.rs:1596-1600`；价格取缓存里最新 MARK，无仓位则不取价：`crates/backtest/src/exchange.rs:1574-1583,1340-1356` | `market/export.py:223-254` 的 `write_funding`：`next_funding_ns`、`ts_event`、`ts_init` 都等于结算时刻，`interval=None` | 正确使用 | 结算由引擎在该 ts 全部数据与成交之后统一做，与资金费行在流里的位置无关；流里位置只决定策略 `on_funding_rate` 回调与 MARK 的先后。失败不静默：`crates/backtest/src/engine.rs:1904-1948` 的 `fail_funding` 让运行报错 |
| 回测引擎与数据目录：导出 Catalog 的 bars、marks、quotes、trades | nautilus_trader v2.0.0rc7：`write_*` 在 `crates/persistence/src/python/backend/parquet/catalog.rs:227-394`；bar 的 Arrow 布局 `crates/serialization/src/arrow/bar.rs:153-161`；mark 价格 Decimal128(38,16)：`crates/serialization/src/arrow/mark_price.rs:124` | `market/export.py:157-163` 的 `nautilus_decimal`（decimal128(38,16)）；`market/export.py:165-197` 的 `write_bars`（经 BarDataWrangler）；`market/export.py:200-220` 的 `write_marks`；quotes 与 trades 写入在 `market/export.py:257,324` | 正确使用 | schema 与 rc7 解码器一致；读回由 `tests/engine/test_stream.py`、`tests/market/test_store.py:255-292` 覆盖。raw 值全部先过 `_exact`（`market/export.py:154`），所以 rc9 的 Price、Quantity raw 超精度拒绝（`RELEASES-rc9.md:75`）不会触发 |
| 回测引擎与数据目录：导出 Catalog 的 funding_rates | nautilus_trader v2.0.0rc7：rc7 的 Python `ParquetDataCatalog` 没有资金费写入方法，只有 quote、trade、order_book、bar、mark_price、index_price、option_greeks、instrument_status、instrument_close、custom_data、record_arrow_bytes：`crates/persistence/src/python/backend/parquet/catalog.rs:227-491,909,1137`；读侧 `query(NautilusDataType.FundingRateUpdate)` 有：`crates/persistence/src/python/backend/parquet/catalog.rs:1416`；Arrow 列定义：`crates/serialization/src/arrow/funding.rs:25-31` | `market/export.py:223-254` 手写 Parquet：`data/funding_rates/<instrument>/<first>_<last>.parquet`，列 rate（utf8）、interval（u64 可空）、next_funding_ns、ts_event、ts_init（纳秒 UTC 时间戳）、identifier，元数据 `type_name`、`instrument_id`；回放读取在 `engine/run.py:513-516`；文件命名复刻 `market/lifecycle.py:137-142` | 有理由的重复实现 | 理由在 rc7 成立：`write_record_arrow_bytes` 属 record 家族，不属 data 家族；列、类型、元数据与 `crates/serialization/src/arrow/funding.rs:25-31` 一致。rc9 发布说明 `RELEASES-rc9.md:14`“Added Python Parquet funding rate write and query methods (#5555)”：升级到 rc9 后理由不再成立，应改用原生写入并重做导出缓存键。该升级项见核实卡 M-06、T-13（只在升级时相关） |
| 回测引擎与数据目录：Catalog 读取（流式分日查询） | nautilus_trader v2.0.0rc7：`ParquetDataCatalog.query(data_type, identifiers, start, end, where_clause, files, optimize_file_loading=True)`：`crates/persistence/src/python/backend/parquet/catalog.rs:1372-1415`；SQL 为 `ORDER BY ts_init`，start、end 作用在 ts_init，闭区间：`crates/persistence/src/common/datafusion.rs:423-465`；注册表时声明 `file_sort_order=ts_init`：`crates/persistence/src/common/datafusion.rs:220-226`；`files=` 在默认 `optimize_file_loading=True` 时按父目录注册表：`crates/persistence/src/backend/parquet/catalog/query.rs:650-692` | `engine/run.py:519-531` 的 `_windowed`：每个 SESSION_WINDOW（1 天）每种类型查一次，`files=` 传“含该日行的文件”（`_bounds` 读 row group 统计，`engine/run.py:467-474`）；`heapq.merge` 按 ts_init 合并 | 正确使用 | 探针 C1-catalog-files-and-ties：`files=[1 个文件]` 且默认 `optimize_file_loading=True` 时返回整个目录的 48,000 行（该文件仅 4,000 行），`optimize_file_loading=False` 才是 4,000 行。产品总带 start、end，结果仍对；但 `engine/README.md:218-220` 的“只查含该日行的文件”不是 rc7 的行为，只是靠 ts_init 谓词剪枝，这条文档不符见核实卡 T-16（确认）。同 ts_init 的行在多文件目录里保持文件序（成交 ID 严格升调）。C1 候选 P4（以 `held[0]` 的 Catalog 根为根）被核实卡 T-18 驳回 |
| 回测引擎与数据目录：小事件（资金费、状态、收盘）与 metrics 的读取 | nautilus_trader v2.0.0rc7：同上 `query`；CustomData 的 ts_init 取 Python 对象属性并缓存：`crates/model/src/data/custom.rs:77-104` | `engine/run.py:513-516` 整文件读；`engine/run.py:575-583` 的 metrics 用 pyarrow 逐批读（metrics 是产品手写文件，`market/export.py:408-424`，不走 Catalog 读） | 正确使用 | metrics 为产品自有布局，不经 Nautilus 读写；产品的 `Metrics` 与 TradeTick 包装满足 ts_init 属性约定 |
| 回测引擎与数据目录：BacktestNode（对照用，不跑生产） | nautilus_trader v2.0.0rc7：流式运行：每个 BacktestDataConfig 一个 `query_batch_session`（`crates/persistence/src/backend/parquet/catalog/mod.rs:450-470`，分页懒读），`merge_streams` 合并：`crates/backtest/src/node.rs:446-592` | 产品不用 node 跑生产，只在 `tests/engine/test_stream.py:304-380` 当对照；理由写在 `engine/README.md:214-219`（“node 把每个配置整块加载并排序，内存随窗口增长”） | 有理由的重复实现 | 结论成立，机制描述不准确。探针 C1-memory-node-vs-stream（合成 Catalog，无策略）：6 合约 4.2M、8.4M、16.8M 事件，node 峰值 RSS 651、789、1180 MiB，流式 302、360、506 MiB；40 合约 3 个月（10.4M 事件）node 1604 MiB、流式 428 MiB；40 合约 6 个月（20.8M）node 2232 MiB、流式 475 MiB。node 在 rc7 不是整块加载（它分页读），但内存仍随窗口线性增长（约 60 MiB 每百万事件），约为流式的 3.7 至 4.7 倍；流式更慢（20.8M 事件 38 秒对 16 秒）。README 的数字（2.8、5.3 GiB）含策略和 40 合约真实数据，量级高于本探针，方向一致 |
| 回测引擎与数据目录：BacktestEngineConfig、DataEngineConfig、CacheConfig、RiskEngineConfig、add_venue | nautilus_trader v2.0.0rc7：add_venue 全部关键字：`python/nautilus_trader/backtest/__init__.pyi:457-493`；`validate_data_sequence` 只在新 bar 的 ts_event 或 ts_init 小于上一根时丢弃并 warn：`crates/data/src/engine/dispatch.rs:471-497` | `engine/run.py:809-824,757-774`；`engine/config.py:140-144` | 正确使用 | add_venue 除前四个位置参数外全用关键字（rc8 的“BacktestVenueConfig、add_venue 模型参数顺序变更”不影响）。`validate_data_sequence=True` 的丢弃只记 warn，不进 `result.iterations` 的差额；产品所有 bar 严格升序，写入前拒绝 `BARS_UNSORTED`、`MARK_UNSORTED`（`market/export.py:174,209`） |
| 回测引擎与数据目录：引擎推进的事件计数核对 | nautilus_trader v2.0.0rc7：引擎循环内每条数据 `self.iteration += 1`，结果里 `result.iterations`：`crates/backtest/src/engine.rs:701-760` | `engine/run.py:874-879` 的 `DATA_COUNT_MISMATCH`：与导出回执计数之和比对 | 正确使用 | `tests/engine/test_stream.py:595-597`；探针 8 组都达到期望数 |
| 回测引擎与数据目录：回放历史请求 Catalog（`catalogs=[DataCatalogConfig]`、`write_bars`） | nautilus_trader v2.0.0rc7：`BacktestEngineConfig(catalogs=[DataCatalogConfig])`、`ParquetDataCatalog.write_bars(data, start, end, skip_disjoint_check)`：`crates/persistence/src/python/backend/parquet/catalog.rs:227-394` | 回放 `engine/run.py:688-712`（派生周期 bar 写入临时 Catalog）、`engine/run.py:821-822`；Paper `engine/paper.py:702`；Live `engine/live_node.py:45`、`engine/history.py:94` | 未验证的假设 | 本组只看到 Catalog 侧：写入的 bar 以关闭时刻减 1 ms 打戳，与导出一致（`engine/klines.py:1-9,47-49`）；请求与聚合语义归 C9 组（见时间 bar 聚合行与预热行）。没查到 Paper、Live 路径上这一步的原生探针（查了 `tests/engine/`、`engine/README.md`） |
| 回测引擎与数据目录：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | 块边界不改变事件顺序（`engine/run.py:658-685` 对 `crates/backtest/src/node.rs:544-592`、`crates/backtest/src/engine.rs:679-690`，探针 8 组一致）；同 ts 排序由产品在入引擎前做（`engine/run.py:622-652`）加引擎稳定排序（`crates/backtest/src/engine.rs:428`、`crates/data/src/replay/iterator.rs:60-68`）；资金费手写布局与 rc7 解码列一致（`crates/serialization/src/arrow/funding.rs:25-31`），`next_funding_ns` 为空时 `interval` 才起作用（`crates/backtest/src/exchange.rs:1596-1600`），产品填了 `next_funding_ns`；资金费符号与金额（`crates/backtest/src/exchange.rs:1380-1410`）多头为负、金额等于名义乘费率，多个对冲仓位逐个结算；账户为 USDT 基础币、USDT 结算，rc9 修复 #5581（USD 基础币账户交易 USDT 永续时结算失败）不适用；回执计数核对对应每条数据 `iteration += 1`（`engine/run.py:874-879`）；`validate_data_sequence` 只在严格倒退时丢弃，产品数据严格升序（`market/export.py:174,209,239`）；导出十进制 decimal128(38,16) 与 rc7 解码一致，rc9 的 Price、Quantity 超精度拒绝与 Parquet 合并默认拒绝间隙不受影响；每个 Catalog 文件不跨毫秒或月（`market/export.py:324-370`），与 rc7 要求文件区间不相交一致 |
| 回测引擎与数据目录：没查的 | 汇总行 | 汇总行 | 不分类 | 订单撮合、bar 执行、成交模型、账户保证金归撮合与账户组（rc8、rc9 中“LAST、MID bar 执行价相同时跳过正量”“GTD 到期后仍成交”“L1 仅成交撮合陈旧价”“回测强平”对回放的版本风险，本组未核对影响）；历史请求、时间 bar 聚合与预热（`engine/history.py`、`engine/warmup.py`，rc9 的历史时间 bar 同时间戳边界、回测定时器跨数据空洞取消）归 C9 组；Paper、Live 的数据路径只看了 `engine/klines.py` 与 `engine/history.py:94` 的 Catalog 写入；市场目录到导出的上游（`market/` 读取、coverage、series）归市场组；rc8 把 `BacktestDataConfig` 改为 `catalog: DataCatalogConfig`、`DataIterator` 返回 Result，只影响 `tests/engine/test_stream.py` 的 node 对照代码，未单独验证（核实卡 T-13 列为升级项） |
| 撮合与成交模型：DefaultFillModel 的概率语义 | nautilus_trader v2.0.0rc7：`DefaultFillModel`：`crates/execution/src/models/fill.rs:286-345`；`event_success` 在概率小于等于 0 时直接返回 false，不取随机数：`crates/execution/src/models/fill.rs:211-222`；`is_limit_filled` 只在限价单“at_limit”（成交价正好等于限价）时查：`crates/execution/src/matching_engine/mod.rs:4990-5018`；`is_slipped` 在 L1 book 的每一笔成交上查，包括限价、止损、市价：`crates/execution/src/matching_engine/mod.rs:5337-5345` | 回放、Paper 都构造 `DefaultFillModel(prob_fill_on_limit=0, prob_slippage=0)`：`engine/fill.py:6-9`，值来自 `engine/config.py:135-136`；回放 `engine/run.py:771`，Paper `engine/paper.py:736` | 正确使用 | 核对了 `event_success` 在概率 0 时不触碰随机数（所以不需要 seed）；`tests/engine/test_fill_model.py:136-139` 覆盖“触价不成交、穿价按限价成交”；探针 C2-market-stop-fills、C2-gap-slip-limit 在 rc7 上复现；核实卡 O 的重跑与候选一致 |
| 撮合与成交模型：`fill_model` 合同字段 | 无对应 Nautilus 接口；产品构造 `DefaultFillModel` 的位置见上一行 | `ACCOUNT_CONTRACT["fill_model"] = "DefaultFillModel"`（`engine/config.py:134`）写进有效配置，但 `engine/fill.py:6-9` 不读它，固定构造 `DefaultFillModel` | 未验证的假设 | 查了 `account["fill_model"]`、`"fill_model"`：只在 `engine/config.py` 定义和 `AccountContract` 类型里出现，没有读取者。改合同字符串不会改撮合，只会改指纹。核实卡 O-06 确认（潜在漂移，无当前影响，本产品证据缺） |
| 撮合与成交模型：滑点 tick 数与适用订单类型 | nautilus_trader v2.0.0rc7：`slipped_price` 固定一个 `price_increment`：`crates/execution/src/matching_engine/mod.rs:5511-5520`；概率命中时对 L1 book 上的限价、市价、止损成交都加：`crates/execution/src/matching_engine/mod.rs:5337-5345`，所以概率大于 0 时限价买单会成交在限价之上 | 概率恒为 0，不启用 | 正确使用 | 保持不启用是对的。探针 C2-gap-slip-limit：`prob_slippage=1`，限价买 99.50 成交在 99.51（越过限价）。rc9 发布说明 `RELEASES-rc9.md:152`“Fixed L1 slippage exceeding limit and protection prices (#5612)”确认这是 rc7 的缺陷；“Nautilus 支持只对吃单滑点时再议”（`docs/rd/strategy-file.zh.mdx:578`）的前提在 rc7 上仍不成立 |
| 撮合与成交模型：回放里“静态滑点”的来源 | nautilus_trader v2.0.0rc7：没有静态滑点参数。固有机制：L1 book 每个价位只有该 bar 成交量的约四分之一，市价单与止损市价单超出部分按最后成交价再差一个 tick 成交，且不受量限制：`crates/execution/src/matching_engine/mod.rs:5444-5480` | 产品没有另加滑点。`engine/README.md:60-63` 与 `docs/rd/replay-environment.zh.mdx:622` 如实写“市价单吃完最优一档（K 线成交量的四分之一）后，剩余量差一档成交” | 正确使用 | 限制已文档化。探针 C2-market-stop-fills：量 40，市价买 25 得 10@100.00 加 15@100.01；买 100 得 10@100.00 加 90@100.01；止损卖 50 得 10@99.50 加 40@99.49。大单参与率可远超 100%，由 `participation@1` 读数覆盖（`docs/plans/participation-field-review.zh.md`）。核实卡 O-12 判已覆盖（部分成交语义产品文字已写明，仓库测试未锁定） |
| 撮合与成交模型：bar 撮合把 OHLC 拆成价格路径 | nautilus_trader v2.0.0rc7：`process_bar`：`crates/execution/src/matching_engine/mod.rs:1879-1982` 到 `process_trade_ticks_from_bar`：`crates/execution/src/matching_engine/mod.rs:1984-2054`：开（仅当与上一价不同，即跳空）、高低（顺序见下一行）、收；每腿一个 TradeTick，量取 `BarTickSizes::from_volume`（约各四分之一）：`crates/execution/src/matching_engine/mod.rs:7787-7850`；只处理 `PriceType::Last`、`Mid`，MARK 价 bar 警告后忽略：`crates/execution/src/matching_engine/mod.rs:1936-1943`；Internal 聚合 bar 忽略：`crates/execution/src/matching_engine/mod.rs:1905-1908`；只让最小周期的外部 bar 驱动撮合：`crates/execution/src/matching_engine/mod.rs:1945-1973` | 回放：一分钟 `LAST-EXTERNAL` bar，`bar_execution=True`（`engine/config.py:123`），MARK 走 `MarkPriceUpdate` 不走 bar 撮合；日线 bar 只作历史，不重放（`engine/run.py:611`）；成交 TradeTick 包成 `CustomData`，不进撮合（`engine/run.py:540-545`）。Paper：Sandbox 订阅 bar，优先级 10，先于策略（`crates/adapters/sandbox/src/execution.rs:317`） | 正确使用 | 日线即使到达也被忽略；日线不重放进一步保证 |
| 撮合与成交模型：`bar_adaptive_high_low_ordering` | nautilus_trader v2.0.0rc7：`bar_high_first`：未开自适应则高先；开了则 `high-open < open-low` 才高先，相等时低先：`crates/execution/src/matching_engine/mod.rs:2303-2305` | 回放、Paper 都开：`engine/config.py:133`、`engine/run.py:771`、`engine/paper.py:734`；`tests/engine/test_fill_model.py:141-148` 覆盖“离开盘价近的极值先走” | 正确使用 | 读了 `crates/execution/src/matching_engine/mod.rs:2303-2305`；探针 C2-market-stop-fills 的高低等距 bar 走低先。平局总是低先、多空不对称，核实卡 O-11 判可能（低，频率无读数） |
| 撮合与成交模型：`bar_execution` 与 `book_type` | nautilus_trader v2.0.0rc7：`process_bar` 开头 `!bar_execution \|\| book_type != L1_MBP` 直接返回，bar 撮合只支持 L1：`crates/execution/src/matching_engine/mod.rs:1892-1894` | `book_type = L1_MBP`（`engine/config.py:112`）；quotes 环境显式 `bar_execution=False`（`engine/config.py:160`）；回放与 Paper 同值 | 正确使用 | 读了 `crates/execution/src/matching_engine/mod.rs:1892-1894`。“必须显式关闭 bar 撮合”的理由记在 `docs/plans/binance-aggtrades-quotes-liquidation-plan.zh.md:36-37` |
| 撮合与成交模型：止损单在 bar 内的触发与成交价（默认与 LAST 触发） | nautilus_trader v2.0.0rc7：触发用 `market_price_for_trigger`：`crates/execution/src/matching_core.rs:580-595`，`LastPrice` 用最新价，`Default`、`BidAsk` 及其他用买卖价；成交价：开腿（跳空）按市场价，高、低、收腿且 StopMarket、MarketIfTouched、Trailing 按触发价：`crates/execution/src/matching_engine/mod.rs:4703-4740` | 产品不设 `trigger_type`；入场类型只许 LIMIT、STOP_MARKET：`engine/order_rules.py:42` | 正确使用 | 探针：跳空开盘 98.00 穿过 98.50 的止损成交 98.00；bar 内触发成交 98.50（触发价）。`tests/engine/test_fill_model.py:129-130`。查了 `trigger_type`、`TriggerType`（`engine/`、`tests/`、`.agents/skills`）：只有两个测试里的 `emulation_trigger`。MARK_PRICE 触发类型见订单组的 working type 行 |
| 撮合与成交模型：同一 bar 内开仓与止损的先后 | nautilus_trader v2.0.0rc7：bar 在 Sandbox 与回放里先于策略撮合完（Sandbox 订阅优先级 10：`crates/adapters/sandbox/src/execution.rs:314-317`），新单要等下一个数据点才参与路径；市价单按当前 L1 簿（该 bar 收盘）成交 | 产品要求“在后续事件里提交”（`.agents/skills/research-round/references/strategy-authoring.md:79-80`、`docs/rd/strategy-file.zh.mdx:313-317`），MARK 在回放里先于 bar | 正确使用 | 探针 C2-later-event-submit：on_bar 决策、下一个 MARK 提交的市价单成交价等于决策 bar 收盘价 100.00，时间戳是下一根 bar 的 `00:02:59.999`；同一 bar 内提交则同时间戳成交。成交晚于决策靠时间戳规则，价格仍是上一根收盘价 |
| 撮合与成交模型：已在市场内的止损入场（`reject_stop_orders`） | nautilus_trader v2.0.0rc7：`reject_stop_orders` 为 true 时 `process_stop_market_order` 拒单：`crates/execution/src/matching_engine/mod.rs:3962-3985`；为 false 立即按市价成交（同处）；Sandbox 与 backtest 默认都是 true：`crates/adapters/sandbox/src/config.rs:107`、`crates/execution/src/matching_engine/config.rs:37,78` | 回放、Paper 都设 `False`：`engine/config.py:121`，传入 `engine/run.py:769`、`engine/paper.py:735`；没有找到决策记录 | 未验证的假设 | 探针 C2-stop-in-market：买入止损触发价 99.00 低于市价，回放立即按市价成交（`STOP_MARKET FILLED @100.00`）。Live 里 Binance 对这种条件单的处理仓库内没有读数（没查到：查了 `reject_stop_orders`、`-2021`、`immediately`，范围 `engine/ docs/plans docs/rd tests .agents`）。C3 的“价内条件单”行（原分类用法错误加未验证的假设）并入此行；C2 原分类为“用法错误或该用未用（待定）”，核实卡 O-04 判可能（回放侧事实确认，Live 侧无证据），故降为未验证的假设；改取值要改拒绝行为，需用户授权 |
| 撮合与成交模型：限价单撮合（穿价、分批） | nautilus_trader v2.0.0rc7：限价单成交量受该腿簿量约束，`at_limit` 才问 `prob_fill_on_limit`：`crates/execution/src/matching_engine/mod.rs:4990-5018`；穿价时按限价成交：`crates/execution/src/matching_engine/mod.rs:4600-4635`，跳空穿价也按限价 | 概率 0；`tests/engine/test_fill_model.py:136-139` | 正确使用 | 探针：限价买 99.50、量 25、bar 量 40（低点 99.00）得 10 加 10 加 5，分三根 bar 成交；`docs/plans/participation-field-review.zh.md` 已记录同样结论（rc3 探测，rc7 复现） |
| 撮合与成交模型：`liquidity_consumption` 与 `queue_position` | nautilus_trader v2.0.0rc7：`apply_liquidity_consumption`：`crates/execution/src/matching_engine/mod.rs:347-437`；`queue_position` 在 bar 路径下 `determine_trade_fill_qty`：`crates/execution/src/matching_engine/mod.rs:818` | 回放传 False、False：`engine/run.py:773`，值在 `engine/config.py:137-138`；Paper 不传（Sandbox 默认 False） | 正确使用 | `engine/config.py:128-133` 的理由（开了会拒绝重复市价单、限价单永不成交）在 rc7 复现：探针 C2-liq-queue：`liquidity_consumption=True` 时第三张连续市价单 REJECTED；`queue_position=True` 时限价单穿价仍 ACCEPTED 不成交。注释写的是 rc3，行为在 rc7 仍成立 |
| 撮合与成交模型：延迟模型 | nautilus_trader v2.0.0rc7：`StaticLatencyModel`：`python/nautilus_trader/execution/__init__.pyi:265`；`add_venue(latency_model=...)`：`python/nautilus_trader/backtest/__init__.pyi:466`；`SandboxExecutionClientConfig.latency_model`：`python/nautilus_trader/adapters/sandbox/__init__.pyi:43` | 不用：`engine/run.py:765-774` 与 `engine/paper.py:727-737` 都不传；“延迟不启用”记在 `docs/rd/strategy-file.zh.mdx:578`、`docs/rd/replay-environment.zh.mdx:622` | 正确使用 | 有理由的不用，不算该用未用。探针 C2-latency：加 500 ms 插入延迟，在 bar N 收盘提交的市价单变成在 bar N+1 的收盘价成交（102.00 对 100.00），加 61 秒则 bar N+2 的收盘价；一分钟 bar 下延迟只能整根地移，不能表达亚秒延迟 |
| 撮合与成交模型：Paper Sandbox 与回放是否同一套撮合代码与配置 | nautilus_trader v2.0.0rc7：同一个 `OrderMatchingEngine`：回放 `crates/backtest/src/exchange.rs:474-505`，Paper `crates/adapters/sandbox/src/execution.rs:988-1015` 的 `ensure_matching_engine`，配置由 `crates/adapters/sandbox/src/config.rs:129-155` 转换；两处 `OrderMatchingEngineConfig` 字段集相同，只有默认值与数据通路不同 | Paper 显式传的与回放相同：`engine/paper.py:727-737` 对 `engine/run.py:757-774`；Paper 没有 `liquidity_consumption`、`queue_position`、`trade_execution` 实参，`ACCOUNT_CONTRACT` 的前两项对 Paper 不起作用；Paper 只送一分钟 bar（策略不订阅成交，`engine/paper.py:481-484`） | 正确使用 | 有漂移风险：合同改这两项时 Paper 静默不跟（核实卡 O-06 确认，当前值都是 False，无当前影响）。读了 `crates/adapters/sandbox/src/config.rs:129-155` 与 `crates/backtest/src/exchange.rs:474-491`；`docs/plans/paper-trading-design.zh.md` 第 6.1、6.2 节记录了一轮真实对账。仓库里没有在本机无网络跑 Sandbox 与 BacktestEngine 同输入对比的测试（见探针提案 P1） |
| 撮合与成交模型：GTD 过期与撮合先后 | nautilus_trader v2.0.0rc7：`iterate_with_mode` 先做买卖盘匹配（FillLimit、TriggerStop）：`crates/execution/src/matching_engine/mod.rs:4200-4320,4235-4262`，之后才检查 GTD 过期：`crates/execution/src/matching_engine/mod.rs:7742-7767`，过期判断在 `crates/execution/src/matching_engine/mod.rs:4283-4300` | 回放、Paper 开 `support_gtd_orders=True`（`engine/config.py:119`），策略不管理 GTD（`engine/strategy.py:124-127`）；策略编写参考称“原生过期在该 bar 能成交之前触发”（`.agents/skills/research-round/references/strategy-authoring.md:137-139`） | 版本风险 | 核实卡 O-03 确认（20261114-36）：到期那根 bar 上先撮合后过期。复核后更正规则的说法：到期那根 bar 上第一个价格与上一跳不同的数据点仍可成交，该点之后立刻过期；开盘不等于上一根收盘时这个点就是开盘，只有开盘跳空穿价才成交，开盘等于上一根收盘时才轮到先处理的那条腿（复核者的两个变体 `review/R3-probes/sub-D/D-extra-gtd-660-*.out`；探针 C2-gtd-expiry-order 四个情形的开盘都等于上一根收盘，看不出这个条件）。不是新根因：技能这句话是索引已有行 20261112-05（上一轮 20261107-37）的修复写进去的。对当前候选影响很小。探针 C2-gtd-expiry、C2-gtd-expiry-order，都在 `BacktestEngine` 上，Paper（Sandbox）一侧按共用撮合引擎推断。rc9 发布说明 `RELEASES-rc9.md:189`“Fixed resting GTD orders filling after expiry in backtests and sandbox execution”：升级才改变，需做配对回放 |
| 撮合与成交模型：bar 与合约精度不一致 | nautilus_trader v2.0.0rc7：`process_bar` 对 OHLC、量的精度逐项检查，不一致只警告并跳过该 bar：`crates/execution/src/matching_engine/mod.rs:1896-1932`，`log_precision_mismatch`：`crates/execution/src/matching_engine/mod.rs:1494-1516`；数据引擎仍把 bar 发给策略 | 导出器按合约精度写 bar：`market/instrument.py:73-102`；`engine/run.py:874-879` 的计数核对是数据引擎的计数，不是撮合侧 | 未验证的假设 | 探针 C2-precision-mismatch（核实卡 O 重跑一致）：bar 3 位小数对合约 2 位，策略收到 5 根 bar，撮合引擎 0 根，限价单一直 ACCEPTED，无报错。查了 `precision mismatch`、`Skipping bar`、`consecutive_precision`（产品代码与文档）：无命中；`engine/audit.py` 不核撮合侧消费。导出器是否可能写出不一致精度未核（核实卡 O 注明留给其他簇） |
| 撮合与成交模型：quotes 执行环境撮合 | nautilus_trader v2.0.0rc7：L1 簿由 QuoteTick 驱动，数量取 `max_quantity` 即整笔成交，`bar_execution=False`：`crates/execution/src/matching_engine/mod.rs:4996-5016` | `engine/config.py:148-162`；`docs/plans/binance-aggtrades-quotes-liquidation-plan.zh.md:21-37` 已写明“不模拟深度、按最优价全成交” | 正确使用 | 限制已声明。读了计划与 `engine/config.py`；本次未跑 quotes 探针（见没查的） |
| 撮合与成交模型：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | `DefaultFillModel` 概率 0 的确定性（`crates/execution/src/models/fill.rs:211-222`；`engine/fill.py:6-9` 不传 seed）；概率 0 下“触价不成交、穿价按限价成交”（`crates/execution/src/matching_engine/mod.rs:4990-5018,4600-4635`，`tests/engine/test_fill_model.py`）；日线 bar 不进撮合（`engine/run.py:611`，`crates/execution/src/matching_engine/mod.rs:1945-1973`）；TradeTick 不进场所撮合（`engine/run.py:540-545`）；回放与 Paper 撮合代码同一份、配置同字段（`crates/backtest/src/exchange.rs:474-491` 对 `crates/adapters/sandbox/src/config.rs:129-155`，`price_protection_points` 两边都归 None）；bar 先于策略撮合（Sandbox 订阅优先级 10，`crates/adapters/sandbox/src/execution.rs:314-317`）；未传参数 `use_market_order_acks`、`oto_full_trigger`、`use_random_ids` 两边默认一致（`crates/execution/src/matching_engine/config.rs:45-53`、`crates/adapters/sandbox/src/config.rs:120-139`），订单列表与 OTO 被 `FORBIDDEN_ORDER_APIS`（`engine/load.py:190`）与 `engine/order_rules.py` 挡掉；固定一个 tick 的余量滑点（`crates/execution/src/matching_engine/mod.rs:5444-5480`）与 README、rd 文档一致 |
| 撮合与成交模型：没查的 | 汇总行 | 汇总行 | 不分类 | quotes 执行环境撮合细节只读了配置与计划文档，没跑探针，`prob_fill_on_limit=0` 下 quote 驱动限价单的语义按源码推断（`crates/execution/src/matching_engine/mod.rs:4996-5016`）；Live 侧没有撮合，只核了触发类型映射，真实订单行为不碰账户，没验证；rc8、rc9 对 bar 撮合的其他改动（#5573 L1 trade-only 过期价、#5610、#5608、“LAST 与 MID bar 执行跳过正量”）只读了发布说明，没逐条在 rc7 复现；`engine/report.py:158-205` 报告里关于成交近似的文字与 `ledger.metrics.participation` 的实现属报告组件，没读；保证金、强平、资金费不在本组范围 |
| 订单：策略配置（OMS、UUID id、管理开关） | nautilus_trader v2.0.0rc7：`StrategyConfig` 字段 `oms_type`、`use_uuid_client_order_ids`、`manage_stop`、`manage_gtd_expiry`、`manage_contingent_orders`、`market_exit_reduce_only`：`crates/trading/src/strategy/config.rs:55-104`；配置必须在 `Strategy.__new__` 进入 | 三条链路都用 `Strategy.__new__(cls, source_config(...))`，HEDGING、UUID、三个 manage 全关、market_exit 只减仓：`engine/strategy.py:121-135`；构造后核对：`engine/strategy.py:138-152` | 正确使用 | 字段名、默认值与 `crates/trading/src/strategy/config.rs:55-104` 一致；构造后 `require_source_config` 防止 `super().__init__(config)` 覆盖，对应 `docs/plans/binance-live-hedge-design.zh.md` 末段的 rc7 事实 |
| 订单：订单规则包装（入场类型、敞口、reduce-only、GTD 下限、联动单） | nautilus_trader v2.0.0rc7：`Strategy.submit_order` 等是可覆盖的 Python 方法；订单字段 `emulation_trigger`、`contingency_type`、`order_list_id`、`parent_order_id`、`linked_order_ids`、`exec_algorithm_id`、`is_quote_quantity`、`would_reduce_only`；Rust 内部的 `close_position`、`close_all_positions`、`market_exit` 直接调 Rust 的 `submit_order`，不经 Python 覆盖：`crates/trading/src/strategy/mod.rs:1126-1170,1173-1260,1731-1800` | `OrderRules` 作为 mixin 覆盖 `submit_order`、`submit_order_list`、`modify_order*`、`cancel_*`、`close_position`、`close_all_positions`：`engine/order_rules.py:70-200`，三条链路相同；源码文本出现 `submit_order_list`、bracket、`add_exec_algorithm`、`close_all_positions` 在加载时拒绝：`engine/load.py:190,215-221` | 正确使用 | 旁路是 `close_position`、`market_exit`（探针 C3-close-position-bypass：两次调用后 Python 覆盖的 `submit_order` 计数为 0）。核实卡 O-07 驳回：机制属实，不构成缺陷（`close_position` 自己查所有权，`market_exit` 只发 reduce-only 市价并先 `cancel_all_orders(strategy_only=True)`，没找到借此增仓的路径） |
| 订单：联动单（bracket、OTO、OCO、order list） | nautilus_trader v2.0.0rc7：回放与 Sandbox 撮合：`support_contingent_orders` 默认 true：`crates/execution/src/matching_engine/config.rs:41`；Binance 适配器：带联动或带条件单的订单列表一律 OrderDenied：构建 `crates/adapters/binance/src/futures/execution.rs:1524-1541`，发出 denied `crates/adapters/binance/src/futures/execution.rs:3311-3345` | 产品不用：规则 4 加源码文本拒绝（`engine/load.py:190,215-221`）；理由写在 `engine/README.md:454-457` 和 `docs/plans/binance-live.zh.md:47` | 有理由的重复实现 | 严格说是“有理由的不用”：产品没有实现任何联动逻辑，只是禁用，自己管止损配对。README 引用的三条 rc7 之前的缺陷在 rc7 已修（`RELEASES-rc9.md:851,853,854`），真正仍成立的理由是 Live 适配器拒绝联动订单列表（`crates/adapters/binance/src/futures/execution.rs:1524-1541`）。探针 C3-bracket-rc7（核实卡 O 重跑）：入场、止损成交、止盈撤销，行为正确。核实卡 O 的结论：属文档措辞不一致，不是缺陷 |
| 订单：联动模拟开关 | nautilus_trader v2.0.0rc7：`manage_contingent_orders`：`crates/trading/src/strategy/config.rs:70-72`；撮合侧 `support_contingent_orders` 让 reduce-only 兄弟单同步：`crates/execution/src/matching_engine/mod.rs:5813,5972` | 策略侧关；撮合侧 `ACCOUNT_CONTRACT["support_contingent_orders"]=True`（`engine/config.py:120`），回放与 Sandbox 都传入：`engine/run.py:770`、`engine/paper.py:735` | 正确使用 | 产品不提交联动单，该开关对产品只影响 reduce-only 同步里的 OUO 分支，无实际作用 |
| 订单：模拟单 OrderEmulator | nautilus_trader v2.0.0rc7：`emulation_trigger` 订单交 `OrderEmulator`；`ExecutionAlgorithm.deny_order` 发布 OrderDenied：`crates/trading/src/algorithm/mod.rs:205-221`，对已关闭订单幂等：`crates/trading/src/algorithm/mod.rs:227-232` | 规则 4 拒绝 `emulation_trigger`；Live 用 `ExecutionAlgorithm.deny_order` 做原生拒单工具：`engine/live_node.py:24,83-84`、`engine/live_connection.py:146-171` | 正确使用 | 有测试：`tests/engine/test_live_entry.py:140` |
| 订单：入场类型与 Live 适配器的类型映射 | nautilus_trader v2.0.0rc7：Binance 映射：Limit 到 LIMIT，StopMarket 到 STOP_MARKET（走 Algo Service），StopLimit 到 STOP，MIT 到 TAKE_PROFIT_MARKET，LIT 到 TAKE_PROFIT，TrailingStopMarket 到 TRAILING_STOP_MARKET，其余 `Unsupported`：`crates/adapters/binance/src/futures/http/client.rs:3744-3775`；校验失败转 OrderDenied：`crates/adapters/binance/src/futures/execution.rs:3903-3912`（`validate_order` 把映射失败转成 `UnsupportedOrderType`）与 `crates/adapters/binance/src/futures/execution.rs:3244-3250`（`emit_order_denied`） | 入场只许 LIMIT、STOP_MARKET：`engine/order_rules.py:42,99-100`；出场（reduce-only）任何类型都放行：`engine/order_rules.py:88-100`；止损类型集合含 TRAILING_STOP_LIMIT：`engine/protection.py:22` | 用法错误 | 产品自己的调用没有错，缺的是规则没有挡住候选用这些类型。出场类型在 Live 无预检，适配器会 OrderDenied；回放与 Paper 对这些组合全部通过。核实卡 O-02 确认（当前候选不受影响；Live 侧无实跑，O-02 在待证实表）。复核后更正引用：原引的 `crates/adapters/binance/src/futures/http/client.rs:3903-3925` 是测试模块里的限速器用例，不是实现 |
| 订单：时效 GTC、IOC、FOK（及 DAY 等） | nautilus_trader v2.0.0rc7：`TimeInForce` 到 `BinanceTimeInForce` 只映射 GTC、IOC、FOK、GTD，DAY 等 bail：`crates/adapters/binance/src/common/enums.rs:385-401` | 规则只限制入场类型，不查 `TimeInForce`、post-only：`engine/order_rules.py:76-101` | 用法错误 | C3 原判正确使用；核实卡 O-02 确认“DAY 等产品允许、Live 适配器会拒”，故改判。`tests/engine/test_order_rules.py:113-136` 只覆盖 LIMIT 的 GTD；Live 侧无实跑 |
| 订单：GTD 到期由谁执行（Live） | nautilus_trader v2.0.0rc7：交易所路径：适配器 `use_gtd=true` 默认：`crates/adapters/binance/src/python/config.rs:220`，映射 `crates/adapters/binance/src/futures/execution.rs:1615-1705`；本地定时器 `manage_gtd_expiry`：`crates/trading/src/strategy/config.rs:73-76` | Live：`use_gtd` 未显式设置，取默认 true；`manage_gtd_expiry=False`：`engine/strategy.py:127`；到期不取整，规则 5 只查 `到期 - 现在 >= 600 s`：`engine/order_rules.py:85-86`；Live 发出前再要求剩余 605 秒以上：`engine/live_connection.py:256-260` | 用法错误 | 核实卡 O-01 确认（20261114-26）：非整秒到期在 Live 被适配器 OrderDenied，回放与 Paper 照收；产品自己不生成到期时间，缺的是规则没有挡住候选；`dow-theory@51` 与 `@62` 的到期写法相同，都必碰。卡写成时 Live 侧无实跑（源码、上游单测、已装二进制字符串互相印证），之后回环 C10 `s6_gtd_fraction` 已实测到适配器的 `OrderDenied`。代价等级 `unknown`（预期 hours） |
| 订单：GTD 到期由谁执行（回放、Paper） | nautilus_trader v2.0.0rc7：撮合引擎 `support_gtd_orders`：`crates/execution/src/matching_engine/mod.rs:4283-4300,7742-7767` | 回放、Paper：`ACCOUNT_CONTRACT["support_gtd_orders"]=True`（`engine/config.py:119`），本地定时器关（`engine/strategy.py:127`） | 版本风险 | 回放到期晚于成交，见撮合组 GTD 过期行与核实卡 O-03；探针 C3-gtd-fill-after-expiry、O-gtd-660（核实卡 O 新写） |
| 订单：GTD 到 Binance USD-M 的映射 | nautilus_trader v2.0.0rc7：`determine_futures_order_lifetime`：只许 Limit、StopLimit、LimitIfTouched，post-only 不许，整秒精度，必须大于现在加 600 秒（严格大于），小于 `BINANCE_GTD_MAX_MILLIS`：`crates/adapters/binance/src/futures/execution.rs:1615-1705`（整秒检查 `crates/adapters/binance/src/futures/execution.rs:1661-1668`，常量 `crates/adapters/binance/src/futures/execution.rs:156,158`） | 规则 5：`engine/order_rules.py:85-86`；Live 发送时再要求剩余 605 秒以上（`SEND_MARGIN_NS`）：`engine/live_connection.py:62,256-260` | 用法错误 | 整秒、类型限制、“大于等于 600”与“严格大于 600”的错位：核实卡 O-01 确认；GTD 的类型限制属 O-02。dow62 的 660 秒加决策后至多 55 秒的 `deadline()`（`engine/live_connection.py:221-225`）自洽，不触发错位 |
| 订单：reduce-only 语义（回放、Sandbox） | nautilus_trader v2.0.0rc7：`use_reduce_only` 默认 true；提交时无仓位则拒：`crates/execution/src/matching_engine/mod.rs:3260-3290`；触发或成交时仓位消失则取消：`crates/execution/src/matching_engine/mod.rs:4824,5039,5124-5136`；兄弟 reduce-only 单在每次成交后按剩余仓位缩量或取消：`crates/execution/src/matching_engine/mod.rs:5759-5960,6035-6095` | 回放与 Paper 不改默认；审计显式容忍 Paper 上“场所先取消”：`engine/audit.py:226-251` | 正确使用 | 探针 C3-reduce-only-stops：部分平仓后止损 `OrderUpdated` 缩到 0.600，全平后 `OrderCanceled` |
| 订单：reduce-only 语义（Binance 适配器，HEDGING） | nautilus_trader v2.0.0rc7：hedge 模式下不发 wire `reduceOnly`，改发 `positionSide`（平仓腿：卖对 LONG，买对 SHORT）：`crates/adapters/binance/src/futures/conversions.rs:53-86`；`is_hedge_mode` 连接时查询一次：`crates/adapters/binance/src/futures/execution.rs:490,1861` | `use_position_ids=False`、`oms_type=HEDGING`：`engine/live_node.py:70`；预检要求 `dualSidePosition`：`engine/live_venue.py:194`；README 已写明无 wire reduceOnly：`engine/README.md:672` | 正确使用 | 产品语义由 positionSide 保证不增仓。仓位平掉或部分平掉后挂着的止损在交易所怎么处理，见下一行 |
| 订单：仓位被部分平掉或已平后挂着的止损（Live） | nautilus_trader v2.0.0rc7：回放侧自动缩量或撤销：`crates/execution/src/matching_engine/mod.rs:6035-6095`；适配器 hedge 下只发 `positionSide`，无对应缩量逻辑：`crates/adapters/binance/src/futures/conversions.rs:53-86` | 规则 3 只在提交时约束同一仓位止损总量不超过仓位：`engine/order_rules.py:94-99`；Live 覆盖判定是止损量不小于仓位量：`engine/protection.py:46-60`；技能已写“模拟场所会缩量，Binance 不会”：`.agents/skills/research-round/references/strategy-authoring.md:128-135` | 未验证的假设 | 没有把“Binance 不缩量”锁住的测试（查了 `reduceOnly`、`positionSide`、`stops_held`、`sync_reduce_only`，范围 `engine tests docs/plans`）；Binance 对数量大于仓位的 positionSide 平仓条件单触发时的处理，错误码页没有说明。核实卡 O-08 判可能（回放侧源码，Binance 侧无证据） |
| 订单：Live 止损放在交易所（Algo Service），不做本地模拟 | nautilus_trader v2.0.0rc7：STOP_MARKET 等条件单走 Binance Algo Service：`crates/adapters/binance/src/futures/http/client.rs:3744-3756`、`crates/adapters/binance/src/futures/execution.rs:542,680-701`；触发后换成普通订单 id；触发、取消、拒绝由 `dispatch_algo_update` 转成事件：`crates/adapters/binance/src/futures/websocket/streams/dispatch.rs:1330-1520`（ALGO_UPDATE 状态 New 发 OrderAccepted：`crates/adapters/binance/src/futures/websocket/streams/dispatch.rs:1386-1409`） | 产品不做本地模拟止损；停止与对账走 `/fapi/v1/openAlgoOrders`：`engine/live_venue.py:73,124`；`engine/protection.py:7-9` 的注释写“REST 接受的止损没有 WebSocket 事件”，据此 `LIVE_DETECTION_NS`（`engine/protection.py:21`）多给 30 秒 | 正确使用 | 止损在交易所。核实卡 O-09 原判可能（低）：该注释与适配器源码 `crates/adapters/binance/src/futures/websocket/streams/dispatch.rs:1386-1409` 不一致。复核后改为驳回：回环 C10 `s6_algo_no_new_event`（P6-e）已实测，交易所不推 `ALGO_UPDATE NEW` 时约 5 秒后由在途查询生成 `OrderAccepted`，推 NEW 时同一毫秒确认，两种情形都在 30 秒容忍内，保护判断不受影响；剩下的只是注释措辞。Binance 实际推不推 NEW 仍没有读数 |
| 订单：条件单触发价类型（working type） | nautilus_trader v2.0.0rc7：Binance：Default、LastPrice 映射 ContractPrice，MarkPrice 映射 MarkPrice：`crates/adapters/binance/src/futures/execution.rs:583-590`；撮合核心：LastPrice 用最新价，其余（含 Default、MarkPrice）用 bid、ask：`crates/execution/src/matching_core.rs:580-595` | 规则不检查 `trigger_type`：`engine/order_rules.py:76-101`；回放、Paper、Live 都放行 | 用法错误 | 核实卡 O-05 确认（20261114-36；产品缺口，当前候选不碰）：产品三条链路自己都不设 `trigger_type`，对 Nautilus 的调用没有错，缺的是规则没有挡住候选设 `MARK_PRICE`。候选这样写时回放与 Paper 按 bar 价触发，Live 按标记价。探针 C2-mark-trigger（三种 trigger_type 都在 99.50 成交，MARK 恒 100）、C3-mark-trigger（MARK 跌到 80、bar 在 99 以上，三种都不触发）。查了 `trigger_type`、`TriggerType`、`MARK_PRICE`、`working.?type`：无规则、无技能说明、无测试 |
| 订单：条件单触发价类型在 rc8 的语义变化 | rc8 发布说明：回放 MARK_PRICE 触发改按标记价更新触发，Sandbox 的标记价触发仍不支持：`RELEASES-rc9.md:535,446` | 同上一行（规则不检查 `trigger_type`） | 版本风险 | 核实卡 O-05：升级到 rc8 后回放与 Paper 在这一点上分叉，只在升级时相关，当前锁定版本不受影响；记入配对回放清单 |
| 订单：订单状态机与事件顺序 | nautilus_trader v2.0.0rc7：事件 Initialized、Submitted、Accepted、Denied、Rejected、Canceled、Expired、Filled 等；撮合引擎 `use_market_order_acks` 默认 false：`crates/execution/src/matching_engine/config.rs:49,84` | 审计用事件重建状态：`engine/audit.py:336-480`；Live 把非登记的 `OrderDenied`、`OrderRejected` 视为原生失败并停止：`engine/live_source.py:265-270` | 正确使用 | 探针（C3 3.3 Q2）：被价内止损立即成交的单只有 Submitted、Filled，没有 Accepted。审计的 `STATUS_EVENTS`、`PASSIVE_EVENTS` 对这种序列未逐行核（见没查的）；`tests/engine/test_native_audit.py` 有对这种序列的测试，未重跑 |
| 订单：client order id | nautilus_trader v2.0.0rc7：`use_uuid_client_order_ids`；`encode_broker_id` 把 UUID 压成 base62，总长不超过 36：`crates/adapters/binance/src/common/encoder.rs:167-221`（UUID 分支 `crates/adapters/binance/src/common/encoder.rs:198-206`） | UUID id：`engine/strategy.py:126-127`；设计文档明确“不自建短 ID”：`docs/plans/binance-live-hedge-design.zh.md` 第 5 节 | 正确使用 | rc9 修的“自动 order id tag 碰撞”（`RELEASES-rc9.md:193`）因产品用显式 StrategyId 加 UUID 而不涉及 |
| 订单：`cancel_all_orders` | nautilus_trader v2.0.0rc7：`strategy_only=true` 时逐单撤自己的单；`false` 时发实例级 CancelAll，Binance 适配器无 side 时调 `DELETE allOpenOrders` 与 Algo 全撤：`crates/trading/src/strategy/mod.rs:923-1010`、`crates/adapters/binance/src/futures/execution.rs:3721-3754` | `OrderRules.cancel_all_orders` 强制 `strategy_only=True`：`engine/order_rules.py:187-190` | 正确使用 | 防止撤到别的策略或手工的单，理由与 `docs/plans/binance-live.zh.md:52-54` 一致 |
| 订单：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | 策略配置注入与构造后复核（`engine/strategy.py:121-152`，与 `crates/trading/src/strategy/config.rs:55-104` 一致，含 `market_exit_reduce_only` 默认 true 被显式保持）；`cancel_all_orders` 强制 `strategy_only=True`（`crates/adapters/binance/src/futures/execution.rs:3721-3754`）；client order id 走 UUID 分支（`crates/adapters/binance/src/common/encoder.rs:167-221`）；hedge 模式 reduce-only 的 wire 形态（`crates/adapters/binance/src/futures/conversions.rs:76-86`，`engine/README.md:672`）；`use_position_ids=False` 避免 `validate_submit_position_id` 报冲突（`crates/adapters/binance/src/futures/execution.rs:1500-1520`）；`use_ws_trading=False`，条件单本来就走 HTTP Algo（`crates/adapters/binance/src/futures/execution.rs:542-543`）；Live 止损确实在交易所，用 `openAlgoOrders` 对账（`engine/live_venue.py:73,124`）；订单列表与联动单在 Live 由适配器拒绝（`crates/adapters/binance/src/futures/execution.rs:1524-1541`），产品在上游挡掉，没有静默拆单；提交时无仓位的 reduce-only 被撮合引擎拒绝（`crates/execution/src/matching_engine/mod.rs:3260-3290`），与规则 3 同向；没有路径给订单设置 `emulation_trigger`；Live 入场拒单走 `ExecutionAlgorithm.deny_order`（`crates/trading/src/algorithm/mod.rs:205-250`），先加入 `session.denied`，不进 `native_order_failure`（`engine/live_connection.py:159-163`、`engine/live_source.py:265-270`）；订单提交速率配置（10 笔每秒的原生探针记录在 `docs/plans/r1-runtime-contract-20261110.zh.md:27`，取值的后果见风控组限频行） |
| 订单：没查的 | 汇总行 | 汇总行 | 不分类 | 订单状态机的逐事件审计重建（`engine/audit.py:336-480` 只读了 `uncovered_intervals` 主体）；rc5 一栏发布说明里 OTO 子单数量的缺陷（只核了 rc7 一栏，对结论无影响）；rc8 的 #5460 bracket 级联问题（没构造复现）；Binance 适配器自己的 GTD 单元测试用例（`crates/adapters/binance/src/futures/execution.rs:4466-4583`，只确认存在）；Binance 真实行为（价内条件单、hedge 下超量或已平止损、REST 条件单是否有 WS NEW、GTD 到期事件是 EXPIRED 还是 CANCELED，`treat_expired_as_canceled` 默认 false：`crates/adapters/binance/src/python/config.rs:236`，而 `engine/README.md:642` 记录试验中 GTD 到期返回 CANCELED，两者关系未查）；quotes 环境下 Default 触发用 bid、ask 与 Live 最新价的差异交撮合组；Sandbox 的 GTD 到期是否与回放完全相同（只读了配置传递，未在 Sandbox 复跑）；`OrderRules.close_position` 在 HEDGING 加 Live 下的 `position_id` 与适配器 positionSide 推导的联动（靠 `crates/adapters/binance/src/futures/conversions.rs:53-73` 推导，没有端到端演示） |
| 风控引擎：配置总览与 `bypass` | nautilus_trader v2.0.0rc7：`RiskEngineConfig` 字段只有六个：`bypass`、`max_order_submit_rate`、`max_order_modify_rate`、`max_notional_per_order`、`full_position_exit_venues`、`debug`：`crates/risk/src/engine/config.rs:42-66`；`bypass` 为真时 `handle_submit_order` 直接发执行引擎，跳过全部检查：`crates/risk/src/engine/mod.rs:587-591`；Python 只暴露配置类：`crates/risk/src/python/mod.rs:25-31` | 三条链路只传提交限频：回放 `engine/run.py:819`（`engine/config.py:143`）、Paper `engine/paper.py:723`、Live `engine/live_node.py:61`；`bypass` 都用默认 False | 正确使用 | Live 有断言测试：`tests/engine/test_live_entry.py:1344-1345`（bypass False、max_notional 空）；回放与 Paper 的风控配置无测试断言（查了 `LiveRiskEngineConfig`、`max_order_submit_rate`，范围 `tests/`，只命中 `tests/engine/test_live_entry.py`、`tests/engine/test_stream.py:354`） |
| 风控引擎：价格与数量精度、正数、最小与最大数量、GTD 过期 | nautilus_trader v2.0.0rc7：`check_order`、`check_price`、`check_quantity`：`crates/risk/src/engine/mod.rs:1139-1216,1725-1795`，价格精度超过合约、非正价格、数量精度、max、min quantity、GTD 缺到期时间或已过期，一律 OrderDenied | 全靠原生；源码用 `make_price`、`make_qty`；GTD 另有产品规则 5：`engine/order_rules.py:85-86`；Live 入场前另比对合约条款：`engine/live_venue.py:257-262` | 正确使用 | 探针 C4-risk-engine P1：OrderDenied 带 reason。产品规则 5 是 Binance 的 600 秒限制，不是原生检查的重复 |
| 风控引擎：单笔名义上限 `max_notional_per_order` | nautilus_trader v2.0.0rc7：对每个提交订单（含 reduce-only）判 `notional > max`，只有 `full_position_exit`（`full_position_exit_venues` 加 `params close_position` 加 STOP_MARKET 或 MIT 加 reduce-only 加触发价）才豁免：`crates/risk/src/engine/mod.rs:2406-2490,667-725` | 不设；Live 用自己的“3 倍权益”入场检查：`engine/order_rules.py:41,70-108`（提交时，三条链路）、`engine/live_commands.py:165-173`（派发时，Live，用该次入场自己的账户快照） | 正确使用 | 非重复实现，理由在 rc7 成立：理由文档 `docs/plans/binance-live-hedge-implementation.zh.md:94`。探针 P4：上限 400、入场名义 350 通过，reduce-only 退出名义 420 被 `NOTIONAL_EXCEEDS_MAX_PER_ORDER` 拒（`crates/risk/src/engine/mod.rs:2459-2474`）；产品的限制随权益变动且按累计敞口算，原生上限是每合约一个静态数、构建时固定，Python 没有 `set_max_notional_per_order`。豁免路径需要 `params`，而规则 4 禁止 order params（`engine/order_rules.py:76-78`）。核实卡 M-16 判已覆盖（3 倍权益规则按合约算） |
| 风控引擎：下单前保证金与余额检查（保证金账户） | nautilus_trader v2.0.0rc7：保证金账户走 `check_margin`：`crates/risk/src/engine/mod.rs:2123-2190,2537-2680`，算 `calculate_initial_margin`，要求不超过账户 free，同一批命令累计也不超过，通过后预留：`crates/risk/src/engine/mod.rs:1253-1292`；仓位缩减单跳过：`crates/risk/src/engine/mod.rs:2754-2770` | 三条链路都开着；回放与 Paper 靠账户常数让保证金等于名义除以杠杆（`engine/config.py:123-129`；Paper 的 `LOADER_MARGIN` 补偿 `engine/paper.py:111-116,732`）；Live 靠 Binance 账户状态里的 free，并在每次入场自己读账户来刷新：`engine/live_lifecycle.py:16-19` | 正确使用 | 探针 P1：free 1000、杠杆 3、保证金率 1，名义 4000 的入场被 `INITIAL_MARGIN_EXCEEDS_FREE_BALANCE: free=1000, margin=1333.33` 拒绝。三条链路的口径不同：Live 本地要求恒为 0.1 乘名义，与声明杠杆无关，核实卡 M-03 判可能（读源码成立，影响只在杠杆大于 10 或至少 4 个合约满仓；Live 无实跑）。入场上限基数在 Live 取钱包与可用余额的较小者，核实卡 M-02 判可能 |
| 风控引擎：reduce-only（带 position_id） | nautilus_trader v2.0.0rc7：`crates/risk/src/engine/mod.rs:595-625`：位置不存在为 `PositionNotFound`；`order.would_reduce_only(side, qty)` 为假为 `ReduceOnlyWouldIncreasePosition`：`crates/model/src/orders/mod.rs:1595-1607` | 规则 3 在提交前自己查：必须有 position_id、是本策略的开仓、`would_reduce_only`（调用原生函数）、同一仓位止损合计不超过仓位：`engine/order_rules.py:86-101`；违反走 `_breach`（回放与 Paper 记录并拒绝整次运行，Live 抛出） | 有理由的重复实现 | 产品的检查比原生多一层归属（`position.strategy_id`、合约、止损合计）。原生那一层在 `position_id` 缺省时不查：探针 P6 reduce-only SELL 0.03 不带 position_id 被接受并成交，带 position_id 且 0.08 大于 0.05 被拒。所以规则 3 的“必须带 position_id”是补原生没查的缺口 |
| 风控引擎：reduce-only 与 HEDGING 持仓抵消（对向入场跳过保证金检查） | nautilus_trader v2.0.0rc7：`available_position_quantity` 把该账户、该合约、对向的所有未平仓位量求和再减去对向挂单剩余量，不按策略或 OMS 过滤：`crates/risk/src/engine/mod.rs:1457-1495`；新单数量累计不超过它就视为缩减单，保证金检查被跳过：`crates/risk/src/engine/mod.rs:2754-2770` | 账户 HEDGING，每笔入场自己开一个仓位：`engine/order_rules.py:7-10`；规则 2 把同合约多空两侧敞口相加后限制不超过 3 倍权益：`engine/order_rules.py:99-136` | 正确使用 | 核实卡 M-04 判已覆盖：规则 2 加 `docs/plans/cross-line-fusion-20261111.zh.md:161` 已记的已知差异（C4 原判未验证的假设）。探针 P2：已有多头 0.05 时，再提交 SELL 入场 0.05（需保证金 833，free 约 167）被接受并成交；同样的 BUY 被拒；多头上挂着 reduce-only SELL 止损 0.05 时 SELL 入场也被拒。探针只在原生引擎上，Binance 一侧保证金口径未核 |
| 风控引擎：reduce-only 退出的最小数量约束与 `full_position_exit_venues` | nautilus_trader v2.0.0rc7：`check_quantity` 与 `check_order_limits` 对 reduce-only 也判 `min_quantity`，仅 `full_position_exit` 豁免：`crates/risk/src/engine/mod.rs:1751-1795,2420-2445` | 三处风控配置都不设 `full_position_exit_venues`：`engine/live_node.py:61`、`engine/paper.py:723`、`engine/run.py:819`；规则 4 禁止 order params | 未验证的假设 | 查了 `min_quantity`、`QUANTITY_BELOW_MINIMUM`、`full_position_exit`（`engine/`、`tests/`、`docs/plans`）无命中，无探针。入场部分成交后剩余量小于 `min_quantity` 时退出会被拒；BTC、ETH 的步长等于最小量是候选的说法，未在仓库核合约条款。核实卡 M-05 判可能（低），无实跑证据 |
| 风控引擎：交易状态 ACTIVE、REDUCING、HALTED | nautilus_trader v2.0.0rc7：一个全账户的 `trading_state`：`crates/risk/src/engine/mod.rs:78`；HALTED 拒绝所有新提交与修改：`crates/risk/src/engine/mod.rs:1894-1915`；REDUCING 只放行能识别到已开仓位且数量不超过它的 reduce-only 提交：`crates/risk/src/engine/mod.rs:723-733`；只能 Rust 侧 `set_trading_state`：`crates/risk/src/engine/mod.rs:421`；总线上没有改交易状态的端点：`crates/risk/src/engine/mod.rs:132-203` | 不用。Live 的“关闭入场”全部在产品层：入场闸门 `engine/live_source.py:64-125`、`engine/live_connection.py`、停止意图 `engine/live_source.py:65-69`、回撤刹车 `engine/live_brake.py`；拒绝入场时借 `ExecutionAlgorithm.deny_order` 造原生 OrderDenied：`engine/live_connection.py:147-170`（`crates/trading/src/algorithm/mod.rs:205-245`） | 有理由的重复实现 | 理由在 `docs/plans/binance-live-hedge-design.zh.md:120-123`（没有公开 setter）与 `docs/plans/paper-monthly-membership-20261111.zh.md:22`（REDUCING 是全账户的）；rc7 上两条都成立（Python 无 setter、无总线端点、`trading_state` 单字段）。严格说这一行是补 rc7 不提供的功能，不是重复实现。文档没写的一点：HALTED 下任何新提交都被拒，止损单也在内（rc7 源码 `crates/risk/src/engine/mod.rs:1894-1915`；rc8 说明 `RELEASES-rc9.md:465` 写的是同一点，复核后改引 rc7 源码），产品要的“只关入场、保护单照常”只有 REDUCING 能做。rc8、rc9 说明里没查到新增 Python setter（查了 `REDUCING`、`HALTED`、`trading.state`、`set_trading_state`，只命中 `RELEASES-rc9.md:465,1744-1745`），理由到 rc9 仍成立 |
| 风控引擎：回撤刹车与现金底线 | nautilus_trader v2.0.0rc7：RiskEngine 没有亏损、回撤字段：`crates/risk/src/engine/config.rs:42-66` | `engine/live_brake.py`：每 15 秒读 REST 账户，权益从峰值回撤到份额即 `begin_stop("drawdown")`；平仓走原生 `close_position` | 正确使用 | 不是重复实现；理由 `docs/plans/live-release.zh.md:77`（固定版 `LiveRiskEngineConfig` 没有亏损字段）成立 |
| 风控引擎：提交限频 | nautilus_trader v2.0.0rc7：超限的提交不排队，直接 `OrderDenied(RATE_LIMIT_EXCEEDED)`：`crates/risk/src/engine/mod.rs:206-250`；`Throttler` 带丢弃回调：`crates/common/src/throttler.rs:424-451`；窗口按时钟，整个引擎共用一个，只算提交不算撤单 | 回放与 Paper 200 每秒，Live 10 每秒：`engine/live_node.py:61`、`engine/config.py:143`、`engine/paper.py:723`；Live 停止路径在一个 tick 里对所有未平仓位调用 `close_position`，并无条件 `session.exits.add(pid)`：`engine/live_lifecycle.py:173-179`；被拒的平仓经 `engine/live_source.py:267-270` 记为原生失败，30 秒后 `native_exit_timeout` 失败结束：`engine/live_lifecycle.py:186-189`、`engine/live_session.py:25` | 用法错误 | 核实卡 M-01 确认：机制由源码与探针证实，当前线不触发（每合约至多 4 个仓位）。探针 P3：10 每秒下同一时刻 15 笔提交，10 笔 Accepted、5 笔 OrderDenied，不排队；P8：12 个 HEDGING 仓位各 `close_position`，2 笔被拒。探针在 BacktestEngine 上，没有走产品的停止循环，“不重发”来自读 `engine/live_lifecycle.py:173-190`。决策 A7 的理由“Live 只能跑一个合约”（`docs/plans/r1-runtime-contract-20261110.zh.md:185-197`）在 Live 多合约（`live/configuration.py:75-126`）之后不成立。订单组也列过这一项（提交速率限制），并入此行 |
| 风控引擎：OrderDenied 事件与策略如何得知 | nautilus_trader v2.0.0rc7：拒绝时产生 `OrderDenied`，进缓存，回调 `on_order_denied` 与 `on_order_event`：`crates/risk/src/engine/mod.rs:1827-1862`；`python/nautilus_trader/trading/__init__.pyi:453` | 回放：运行结束后 `report.py` 把任何 DENIED、REJECTED 记为 `ORDERS_DENIED_OR_REJECTED` 使运行无效：`engine/report.py:276-288`；Paper：`engine/paper.py:752,782` 同样汇总时记；Live：`engine/live_source.py:267-270` 的 `on_order_event` 包装把非闸门产生的 OrderDenied、OrderRejected 记为 `native_order_failure` 并开始停止，`engine/live_lifecycle.py:24-30` 再按缓存复核 | 正确使用 | 策略源码自己不需要处理拒绝（技能只要求预检时确认“none was denied or rejected”：`.agents/skills/research-round/references/strategy-authoring.md:196-198`）；`tests/engine/test_live_entry.py:483,530,645` 覆盖 Live 的包装与回调内再提交 |
| 风控引擎：回调内再提交（重入） | nautilus_trader v2.0.0rc7：Python `Strategy` 提交走 `risk_engine_queue_execute`：`crates/trading/src/python/strategy.rs:5428,5517,5566,6598`；Live 有命令发送器排到下一轮，没有发送器（回测）则直接调度：`crates/risk/src/engine/mod.rs:158-175` | 回放与 Paper 未特别处理 | 正确使用 | 探针 P9：BacktestEngine 里在 `on_order_event(OrderDenied)` 内再提交两单，运行正常结束，无 panic |
| 风控引擎：市价单无价格 | nautilus_trader v2.0.0rc7：市价单要缓存里有 bid、ask、last 或外部 K 线收盘价，否则 `MARKET_PRICE_UNAVAILABLE`：`crates/risk/src/engine/mod.rs:1574-1612,2241-2270` | 入场只能是 LIMIT、STOP_MARKET：`engine/order_rules.py:42`；退出可以是 `close_position`（市价 reduce-only）：`engine/order_rules.py:158-163`，Live 停止循环 `engine/live_lifecycle.py:178` | 未验证的假设 | 回放与 Paper 有 K 线可回落；Live 靠缓存里的外部 K 线收盘价。探针 P7 想验证“缓存为空时被拒”，但 `on_start` 里提交的市价单成交了，探针没有区分力。查了 `MARKET_PRICE_UNAVAILABLE`、`MarketPriceUnavailable`：全仓只命中旧计划文档，没有 Live 缓存无价格时停止平仓的测试 |
| 风控引擎：保护单（止损）与风控 | nautilus_trader v2.0.0rc7：止损单是 reduce-only，保证金检查跳过：`crates/risk/src/engine/mod.rs:2754-2770`；仍受 min_quantity 与 max_notional 约束：`crates/risk/src/engine/mod.rs:2420-2445` | `engine/protection.py` 只读缓存判断覆盖，不另做风控；规则 3 限制止损合计不超过仓位 | 正确使用 | 探针 P4 说明若设了 max_notional 止损也会被拒，所以 Live 不设是对的 |
| 风控引擎：rc9 的 OrderModifyDenied、OrderCancelDenied | rc9 把本地改单、撤单拒绝改为 denied 事件，新增两种事件：`RELEASES-rc9.md:25,64` | `engine/audit.py:425` 对未知订单事件类型抛 `EventPayloadInvalid`（`ENDING_EVENTS`、`STATUS_EVENTS`、`PASSIVE_EVENTS` 未含这两个）；Live 的 `on_order_event` 包装只认 OrderDenied、OrderRejected：`engine/live_source.py:267`；技能只提 OrderCancelRejected：`.agents/skills/research-round/references/strategy-authoring.md:149-152` | 版本风险 | 核实卡 M-06 判可能（版本风险，只在升级时相关，当前锁定版本不受影响）：升级后源码对已结束订单的一次撤单会让整份报告审计失败，失败闭合。只 grep 了 `OrderCancelDenied`、`OrderModifyDenied`（`engine/audit.py`、`engine/live_source.py`、`tests/`、`.agents/`）无命中，没在 rc9 上跑 |
| 风控引擎：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | bypass 三条链路都为 False（`engine/run.py:819`、`engine/paper.py:723`、`engine/live_node.py:61`，Live 另有测试断言 `tests/engine/test_live_entry.py:1344-1345`）；`max_notional_per_order` 不设是对的（P4 证明设了会拦减仓）；3 倍权益入场上限与回撤刹车、现金底线都不是重复实现（RiskEngineConfig 无权益相对与亏损字段：`crates/risk/src/engine/config.rs:42-66`）；交易状态不可达（Python 无 setter、无总线端点）；限频语义是丢弃不排队（`crates/risk/src/engine/mod.rs:206-250`、P3）；OrderDenied 对策略可见且三条链路都当失败处理（`engine/report.py:276-288`、`engine/paper.py:752`、`engine/live_source.py:267-270`、`engine/live_lifecycle.py:24-30`）；产品自己造的 denial 按 `session.denied` 区分（`engine/live_connection.py:158,171-186`）；回调内再提交无 panic（`crates/risk/src/engine/mod.rs:158-175`、P9）；价格与数量精度、GTD 过期由原生检查，产品只补 Binance 的 600 秒规则与合约条款一致性（`engine/live_venue.py:257-262`）；保护单在原生保证金检查里被当缩减单跳过（`crates/risk/src/engine/mod.rs:2754-2770`）；重复提交预留余额的修复已含在 rc7（`RELEASES-rc9.md:858`），产品不依赖它 |
| 风控引擎：没查的 | 汇总行 | 汇总行 | 不分类 | Binance 适配器如何把交易所账户状态翻译成 `AccountState`（RiskEngine 读 `balance_free`：`crates/risk/src/engine/mod.rs:2076-2096`）归执行客户端组；`ExecutionAlgorithm.deny_order` 的订单入缓存与事件发布顺序、`session.entry_gate` 的正确性归执行算法组，只确认该函数存在（`crates/trading/src/algorithm/mod.rs:205-245`）；`Portfolio.equity` 的口径（`engine/order_rules.py` 的 `usdt_equity`，rc9“Portfolio venue-wide margin equity reusing stale PnL”`RELEASES-rc9.md:182`）归组合与账户组；Live 多合约时 10 每秒对正常突发的实际占用没有 Live 日志可看，不能量化；没有联网，没有读凭证，没有运行 Live、Paper 或回放入口 |
| 仓位与账户：回放 venue 的 OMS 类型 | nautilus_trader v2.0.0rc7：`BacktestEngine.add_venue(oms_type=…)`，匹配引擎在 HEDGING 下每单生成 venue 仓位 ID：`crates/execution/src/matching_engine/ids_generator.rs:156-171`；NETTING 下 ID 从首个开仓位取：`crates/execution/src/matching_engine/ids_generator.rs:172-183` | 回放：`ACCOUNT_CONTRACT["oms_type"]="HEDGING"`（`engine/config.py:110`）传入 `add_venue`：`engine/run.py:764`；产品从不使用 NETTING（查了 `OmsType.NETTING`、`NETTING`，范围 `engine/ cli/ replay/ paper/ live/`：只有注释和文档） | 正确使用 | `docs/plans/cross-line-fusion-20261111.zh.md:160` 记了“交易所 NETTING 加策略 HEDGING 时虚拟空仓的 reduce-only 被撤”的原生观察，所以三处 venue 都用 HEDGING；探针 1、3 日志 `Registered OMS::Hedging`，三个仓位各自成立 |
| 仓位与账户：策略 OMS | nautilus_trader v2.0.0rc7：`StrategyConfig(oms_type=…)`，`Strategy.__new__` 才读进核心：`crates/trading/src/strategy/config.rs:55-104` | 三条链路：`source_config` 给每个源 `OmsType.HEDGING`、`use_uuid_client_order_ids`、`manage_stop=False` 等：`engine/strategy.py:126-128`；`engine/order_rules.py` 要求出场是 reduce-only 且点名自己的 position | 正确使用 | 探针 1、2、3 都按此配置建策略，每笔入场单一个 `P-…` 仓位（positions 报告） |
| 仓位与账户：Paper Sandbox 的 OMS | nautilus_trader v2.0.0rc7：`SandboxExecutionClientConfig.oms_type`，默认 NETTING：`crates/adapters/sandbox/src/config.rs:58`；`use_position_ids` 默认 true：`python/nautilus_trader/adapters/sandbox/__init__.pyi:32` | `oms_type=getattr(OmsType, account["oms_type"])`（`engine/paper.py:731`）即 HEDGING；`use_position_ids` 未传，取默认 true | 正确使用 | 默认 true 在 HEDGING 下由匹配引擎按单生成 venue 仓位，与回放同一匹配代码；未单独探针 Sandbox 路径（见没查的）。重启后仓位 id 计数归零的后果见缓存与 Sandbox 组的 Sandbox 重启行 |
| 仓位与账户：Live Binance 适配器的 OMS | nautilus_trader v2.0.0rc7：`BinanceExecutionClientConfig.oms_type`，USD-M 缺省 NETTING：`crates/adapters/binance/src/factories.rs:190`；Hedge 模式下 `determine_position_side`、`reduce_only_param` 不向 Binance 发 `reduceOnly`：`crates/adapters/binance/src/futures/conversions.rs:53-86` | `OmsType.HEDGING, use_position_ids=False, futures_leverages=None, futures_margin_types=None`：`engine/live_node.py:70`；`require_account_mode` 要求 `dualSidePosition` 为真：`engine/live_venue.py:194` | 未验证的假设 | 配置本身与源码一致。同一 LONG 或 SHORT 腿上多个虚拟仓位：产品自己的记录写“阶段 A 反例未闭合、同向迟到保护成交复现原生成交与持仓不一致”（`docs/plans/binance-live-hedge-design.zh.md:10,94-97,337`）和“没有测”（`docs/plans/cross-line-fusion-20261111.zh.md:165`），而 `engine/order_rules.py:6-8` 已放行同合约多笔同向持仓。查了 `reduceOnly`、`shared leg`、`同向并发`、`账户腿`、`tests/engine/test_live*.py`：无针对该竞态的用例。核实卡 M-11 判可能（已知，未闭合，不是新发现；无实跑证据） |
| 仓位与账户：`MarginAccount` 与账户类型 | nautilus_trader v2.0.0rc7：`AccountType.MARGIN`，`MarginAccount::new` 默认杠杆 1：`crates/model/src/accounts/margin.rs:101` | 三条链路都 `AccountType.MARGIN`、`base_currency=USDT`：`engine/run.py:764-766`、`engine/paper.py:731-732`；Live 的账户由适配器按交易所回报建（`base_currency` 不设）：`crates/adapters/binance/src/factories.rs:196-203` | 正确使用 | 探针 1：账户报告 total、locked、free 与手算一致 |
| 仓位与账户：杠杆（回放） | nautilus_trader v2.0.0rc7：`add_venue(default_leverage=…)`；默认 `LeveragedMarginModel`：保证金等于名义除以杠杆再乘比率：`crates/model/src/accounts/margin_model.rs:298-340` | `bars` 环境：杠杆取 `--leverage`，合约比率 1、1：`engine/run.py:767,777-787`、`engine/config.py:118,126-127`，所以锁定等于名义除以杠杆，与 Binance 公式同 | 正确使用 | 探针 5：杠杆 1 到 125 共 39 例，下单（初始）与持仓（维持）锁定与“0.1 比率乘 0.1 倍杠杆”逐位相同，样本 L=7 锁定 1.76357143、7623.0375 |
| 仓位与账户：杠杆（Paper） | nautilus_trader v2.0.0rc7：`SandboxExecutionClientConfig.default_leverage`：`crates/adapters/sandbox/src/config.rs:64-65`；`margin_account.set_default_leverage`：`crates/adapters/sandbox/src/execution.rs:432`；Python 配置没有 `leverages`、`margin_model` | 比率是加载器的 0.1、0.1（`crates/adapters/binance/src/common/parse.rs:364-412`），所以 `default_leverage=Decimal(leverage)*LOADER_MARGIN`：`engine/paper.py:116,732`；加载比率不是 0.1 则 `TERMS_CHANGED` 停止：`engine/paper.py:538-552` | 版本风险 | 探针 5 证明算术等价。rc9 的“Fixed Binance Futures initial margin underestimation (#5531)”（`RELEASES-rc9.md:239`）会改加载器的比率，产品遇到会 `TERMS_CHANGED` 停下而不是悄悄错锁；rc8 起 Sandbox 配置有自定义 Python 保证金模型（`RELEASES-rc9.md:419,474`），`LOADER_MARGIN` 变通理由在 rc8 部分不再成立。`docs/plans/r1-2d-leverage-terms-20261111.zh.md:64` 已写“升级后去掉 `LOADER_MARGIN`”。核实卡 M-06 判可能（版本风险，只在升级时相关）；核实卡 M-09（`LEVERAGE_MISMATCH` 只比两个声明）已驳回 |
| 仓位与账户：杠杆（Live） | nautilus_trader v2.0.0rc7：适配器只在配置 `futures_leverages` 时对交易所 `set_leverage`：`crates/adapters/binance/src/futures/execution.rs:1353-1372`；本地账户杠杆无来源，`MarginAccount.default_leverage` 初值 1：`crates/model/src/accounts/margin.rs:101,174-180` | 产品传 `None`，只核对交易所杠杆等于声明值：`engine/live_venue.py:196-203`；本地账户杠杆从不设置、从不回读 | 未验证的假设 | 查了 `set_default_leverage`、`set_leverage`、`default_leverage`（rc7 `crates/adapters/binance`、`crates/live`、`crates/common`、`crates/execution`）：只有 `crates/adapters/binance/src/futures/execution.rs:1362`；产品 `engine/*.py` 只有配置文件和回放、Paper。`MarginAccount.default_leverage` 在 rc7 Python 层可读（`python/nautilus_trader/model/__init__.pyi:2824`），产品没读。核实卡 M-03 判可能：Live 本地保证金检查恒为 0.1 乘名义，与声明杠杆无关，读源码成立，影响只在杠杆大于 10 或至少 4 个合约满仓；无 Live 实跑 |
| 仓位与账户：保证金模型（bars 环境） | nautilus_trader v2.0.0rc7：默认 `LeveragedMarginModel`：`MarginModelAny::default`：`crates/model/src/accounts/margin_model.rs:199-203` | `margin_model=None`：`engine/run.py:768` | 正确使用 | 探针 5 |
| 仓位与账户：保证金模型（quotes 环境） | nautilus_trader v2.0.0rc7：`StandardMarginModel`：名义乘比率，忽略杠杆（参数名 `_leverage`）：`crates/model/src/accounts/margin_model.rs:238-274` | `StandardMarginModel()`：`engine/run.py:768`；比率来自 `--initial-margin`、`--maintenance-margin`：`engine/config.py:160-162`；`--leverage` 仍记入 `default_leverage`：`engine/run.py:767` | 正确使用 | 探针 6：杠杆 1、3、20 锁定完全相同，`--leverage` 在该环境不起作用。C5 原判用法错误（低严重）；核实卡 M-08 判已覆盖：`engine/README.md:120-121` 与 `add_venue` 文档串已写明“maintenance = notional x the rate, not divided by leverage”，残余是有效配置里的 `leverage` 字段在该环境有误导性。`margin_rates_of` 只要求 0 小于维持不超过初始小于 1（`engine/config.py:467-484`） |
| 仓位与账户：初始与维持保证金怎么算 | nautilus_trader v2.0.0rc7：下单：每张未成交非 reduce-only 订单按挂单价逐张累加：`crates/portfolio/src/manager.rs:675-712`；持仓：同一合约所有未平仓位折成净额，在净均价上算一次：`crates/portfolio/src/manager.rs:217-290` | 产品直接用；`report.fixed_limitations` 对 quotes 声明“维持保证金按入场名义、不随行情重估”：`engine/report.py:202-206`，`engine/README.md:127-129` 同 | 正确使用 | 探针 3：多 2900 加空 2900 后 locked 由 96666.67 变 0.00；探针 1 同。净额折叠使对冲时锁定保证金低估，核实卡 M-04 判已覆盖（规则 2 加已记的已知差异），Binance 一侧“两侧相加”未核实 |
| 仓位与账户：保证金检查（风控） | nautilus_trader v2.0.0rc7：`RiskEngine::check_margin`：required 大于 free 则 DENIED：`crates/risk/src/engine/mod.rs:2537-2680`；开仓单若不超过同合约已开反向仓量，被当减仓免检：`crates/risk/src/engine/mod.rs:2754-2771,1457-1498` | 回放里 DENIED 记为 `ORDERS_DENIED_OR_REJECTED`，运行整体不通过：`engine/report.py:276,287`；规则 2 另限敞口不超过 3 倍权益：`engine/order_rules.py:41,104-108` | 正确使用 | 探针 2、3；缺口见上一行与核实卡 M-04、M-07 |
| 仓位与账户：余额不足、负余额与 `frozen_account` | nautilus_trader v2.0.0rc7：`frozen_account` 为真则不调账户；`AccountBalance` 允许负总额：`crates/model/src/types/balance.rs:115-175` | `frozen_account` 不传，默认 false（`python/nautilus_trader/backtest/__init__.pyi:487`）；`summary_statistics` 对最终权益不超过 0 输出空年化并记 `statistics_notes`：`engine/report.py:171-177`；回撤用 `(peak-equity)/peak`，可超过 1：`ledger/metrics.py:682-694` | 正确使用 | 探针 2：账户总额为负（约负七万）无报错，报告可读。核实卡 M-07 判已覆盖：规则 2 用含未实现盈亏的 `portfolio.equity`（`engine/order_rules.py:58-62`），权益为负时入场被拒；读数保护在 `ledger/metrics.py:682-694`、`engine/report.py:171-177`、`report/history.py:88-111`；残余是 `report/history.py:96-99` 的 `worst_annual_return` 与中位数不含破产年 |
| 仓位与账户：强平（quotes 环境） | nautilus_trader v2.0.0rc7：`liquidation_enabled`、`liquidation_trigger_ratio`（默认 1.0）、`liquidation_cancel_open_orders`（默认 true）：`crates/backtest/src/python/engine.rs:123-131,166-168,281-282`；触发：权益（余额加按缓存买卖价算的未实现盈亏）不超过维持保证金乘比率，撤全部挂单并以市价 IOC reduce-only 单平掉该币种全部仓位：`crates/backtest/src/exchange.rs:1774-1875`、`crates/execution/src/matching_engine/mod.rs:2867-2985`；每个时间戳末尾运行：`crates/backtest/src/engine.rs:1877,2144-2166` | `liquidation_enabled=True` 加 `StandardMarginModel` 加实际比率；触发比和撤单取默认，没有显式传参：`engine/run.py:774`；`engine/README.md:120-121` 声明 1.0 与撤单 | 正确使用 | 默认值在 `crates/backtest/src/python/engine.rs:281-282` 读到；`tests/engine/test_stream.py:607` 在 rc7 上验证强平发生且与 `BacktestNode` 一致；`docs/plans/binance-aggtrades-quotes-liquidation-plan.zh.md:103-107` 有真实数据的原生验证（含跳空后负权益），其依据版本是 rc3，rc7 的默认值已核 |
| 仓位与账户：强平（bars 环境） | nautilus_trader v2.0.0rc7：同上，但 `calculate_unrealized_pnl` 需要缓存报价，没有则本品种“推迟”：`crates/backtest/src/exchange.rs:1823-1842` | `liquidation_enabled=False`：`engine/config.py:124`；`engine/report.py:210` 写“Liquidation is not modelled” | 正确使用 | 探针 8：开了强平，只有 K 线加 MARK，权益跌破维持保证金后永不强平，警告 `no quotes`；产品“只在 quotes 环境强平”的理由在 rc7 成立。C5 原判版本风险；核实卡 M-07 判已覆盖（报告声明不建模，读数标记破产运行），升级项另列下一行 |
| 仓位与账户：rc9 对 bars 强平的改动 | rc9 发布说明“Fixed backtest liquidation on bar and trade data (#5538)”：`RELEASES-rc9.md:219` | `liquidation_enabled=False`（`engine/config.py:124`）；升级后改变账户经济，要新契约版本 | 版本风险 | 核实卡 M-06、M-07：只在升级时相关，当前锁定版本不受影响；补强平建模要新契约版本 |
| 仓位与账户：强平（Paper） | nautilus_trader v2.0.0rc7：Sandbox 用匹配引擎，不经过 `SimulatedExchange`；sandbox crate 没有 `liquidat` 字样（`crates/adapters/sandbox/src` 内查了 `liquidat`，无命中） | 无 | 正确使用 | 无爆仓是 Paper 的限制；rc8、rc9 说明里没查到 Sandbox 强平条目 |
| 仓位与账户：资金费数据类型与导出布局 | nautilus_trader v2.0.0rc7：`FundingRateUpdate(instrument_id, rate: Decimal, ts_event, ts_init, interval, next_funding_ns)`；Catalog Arrow 布局 `rate` 为 Utf8：`crates/serialization/src/arrow/funding.rs:28-34` | 导出：手写 Parquet，`interval` 空，`next_funding_ns`、`ts_event`、`ts_init` 都等于结算时刻，一条一次结算：`market/export.py:223-251` | 有理由的重复实现 | 理由：rc7 Python Catalog 没有资金费写入（`python/nautilus_trader/persistence/__init__.pyi:161-231` 只有 quote、trade、delta、bar、depth、mark、index、greeks、status、close、instruments、custom；`market/README.md:327` 同）。布局与 `crates/serialization/src/arrow/funding.rs:28-34` 逐字段一致，回放消费它并通过 `DATA_COUNT_MISMATCH` 检查。rc9 新增 `RELEASES-rc9.md:14`“Python Parquet funding rate write and query methods (#5555)”，理由到 rc9 不再成立（核实卡 M-06、T-13，只在升级时相关）。同一事项在回测组导出行 |
| 仓位与账户：回放的资金费结算 | nautilus_trader v2.0.0rc7：`SimulatedExchange::settle_funding_rate`：对每个未平仓位名义等于 `position.try_notional_value(价)`，金额等于名义乘费率乘（多头负、空头正），经 `Money::from_decimal`（银行家舍入）记入仓位与账户余额，发布 `FundingSettlement`：`crates/backtest/src/exchange.rs:1289-1572`；结算价等于缓存 MARK，否则买卖中价：`crates/backtest/src/exchange.rs:1574-1583`；边界等于 `next_funding_ns`，或 `interval` 整除 `ts_event`：`crates/backtest/src/exchange.rs:1596-1600`；在该时间戳所有事件处理完后结算：`crates/backtest/src/engine.rs:1870,1881-1941`；HEDGING 的每个虚拟仓位各结算一条 | 完全交给原生；产品只写数据；审计用原生报告的调整，不做基于费率的重算：`engine/audit.py:780`；对账：调整是 FUNDING 且等于账户余额变动（`FUNDING_BALANCE_MISMATCH`）：`engine/audit.py:893-1014` | 正确使用 | 探针 1：多 1000（开于 100）遇 MARK 105、费率 0.0001 得 -10.50；之后费率 -0.0003、MARK 110 得多头 +33.00、对冲空头 400 得 -13.20；与公式逐位相同，用的是 MARK 不是 K 线收盘，账户余额同步变动；MARK 在分钟收盘 `.999` 打戳（`market/export.py:208-216`）。月内缺结算行时回放不报警：核实卡 M-12 判已覆盖（上游月文件检查、`market coverage` 的 `missing_settlements` 加技能），核实卡 T-17 判可能（机制成立，对当前线无后果），两卡结论不同；独立复核后 T-17 并入已覆盖与驳回表的 M-12 一行，作为该行的残余 |
| 仓位与账户：Paper 的资金费 | nautilus_trader v2.0.0rc7：Sandbox 无资金费订阅：`crates/adapters/sandbox/src/execution.rs:314-320` 订阅的是 book deltas、quotes、trades、bars、status、close、position events | Recorder 订阅 `subscribe_funding_rates` 并按回放节奏记 `funding_settlement`：`engine/paper.py:395-400,483,525-537`；封存时按 Binance 公布的费率和 MARK K 线补算：`ledger/paper.py:257-262,289-315` | 有理由的重复实现 | 理由成立：源码无订阅，`docs/plans/paper-trading-design.zh.md:384` 的实测“持多 0.01 BTC 跨过 08:00 UTC，账户总额前后不变”。探针 4 比较 `ledger.paper.settle` 与原生回放，63 例（含 9 位小数费率舍入平局）差异 0，但自报 native 非零只有 1 例，判别力弱。核实卡 M-10 判已覆盖（设计有意、失败闭合，取不到源时拒绝封存）；运行中余额不含资金费，核实卡 L-18 判驳回（已知并有意保留） |
| 仓位与账户：Live 的资金费 | nautilus_trader v2.0.0rc7：适配器没有资金费结算路径；rc7 `crates/adapters/binance/src` 无 `FUNDING_FEE` 处理（查了 `FUNDING_FEE`：仅 REST 查询参数和模型注释） | Live 钱包里由交易所实际扣；`live compare` 的资金费是按 Binance 公布费率补算，取证包不含实际扣费：`live/compare.py:20-22`，`docs/plans/live-evidence-pack-20261110.zh.md:19-20` | 未验证的假设 | 无法在本机无凭证验证。Live 的 Nautilus 仓位 `realized_pnl` 不含资金费，回放的含（探针 1），两者对照靠 `live/compare.py` 补算。核实卡 M-14 确认（Live 实收资金费没有留档也没有核对，已知，低严重度，查了 `income`、`FUNDING_FEE`、`commission`：`live/`、`engine/live*.py`） |
| 仓位与账户：手续费模型 | nautilus_trader v2.0.0rc7：`MakerTakerFeeModel(maker, taker, overrides)`：成交额乘费率，需要流动性方：`crates/execution/src/models/fee.rs:314-368`；签名在 `python/nautilus_trader/execution/__init__.pyi:190-197` | 回放：默认费率取第一个合约，逐合约 `overrides`：`engine/run.py:750-754`；Paper：`MakerTakerFeeModel(*fees)`：`engine/paper.py:737`；审计按回执费率重算每笔佣金：`engine/audit.py:736` | 正确使用 | 探针 1：佣金 50.00 等于 1000×100×0.0005，20.00 等于 400×100×0.0005；审计对每笔重算（`COMMISSION_RATE_MISMATCH`）。Live 费率不与回放假设比对：核实卡 M-15 判已覆盖（`live compare` 读账户费率与回放假设比：`replay/comparison.py:458-470`） |
| 仓位与账户：已实现、未实现盈亏与权益 | nautilus_trader v2.0.0rc7：`Portfolio.equity()`：保证金账户等于余额总额加各仓位未实现盈亏：`crates/portfolio/src/portfolio.rs:809-868,1322-1380`；估值价取 MARK | 规则 2 用 `Strategy.portfolio.equity`：`engine/order_rules.py:58-62`；最终权益取 `build_snapshot`：`engine/report.py:42,265`；曝光表用 `Position.unrealized_pnl` 在 MARK（`engine/run.py` 的 `CapitalObserver`） | 正确使用 | 探针 7：K 线收盘 100、MARK 105 时 `portfolio.equity` 等于余额 99950 加 5000，即 104950（按 MARK），`build_snapshot` 同；与曝光表、回撤路径同口径 |
| 仓位与账户：账户报告 | `generate_account_report`，每次账户状态一行 total、locked、free | 回放写 `account.csv`：`engine/report.py:233-243`；审计 `ACCOUNT_REPORT_INCONSISTENT`（total 等于 locked 加 free） | 正确使用 | 探针 1、2、3 的账户行均满足 total 等于 locked 加 free（含负总额） |
| 仓位与账户：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | 回放资金费结算的公式、结算价、符号、对冲不净额化、舍入（`crates/backtest/src/exchange.rs:1289-1583`，探针 1、4）；资金费边界与时序（`market/export.py:244` 的 `next_funding_ns=ts_event=ts_init` 且 `interval=None`，`crates/backtest/src/exchange.rs:1596-1600`，`crates/backtest/src/engine.rs:1870,1881-1941`，晚到边界会让运行失败 `crates/backtest/src/engine.rs:1897-1903`，流式输入按 ts_init 排序 `engine/run.py:447-454`）；Funding Parquet 布局与 `crates/serialization/src/arrow/funding.rs:28-34` 逐字段相同；手续费签名与审计逐笔重算（`python/nautilus_trader/execution/__init__.pyi:190-197`、`crates/execution/src/models/fee.rs:350-368`）；回放杠杆与保证金公式（bars 环境，比率 1、1：`crates/model/src/accounts/margin_model.rs:298-340`，探针 5）；强平默认值与语义（`crates/backtest/src/python/engine.rs:281-282`、`crates/backtest/src/exchange.rs:1774-1875`、`crates/execution/src/matching_engine/mod.rs:2867-2985`、`tests/engine/test_stream.py:607`）；`frozen_account` 产品不使用；`portfolio.equity` 按 MARK 与曝光表、回撤路径一致（探针 7）；余额为负时报告与统计的行为（`engine/report.py:171-177`、`ledger/metrics.py:682-694`、`report/history.py:88-111`）；Live 账户模式核对要求 Hedge、多资产、全仓、杠杆等于声明、不自动加保证金，不修改交易所设置（`engine/live_venue.py:194-203`、`engine/live_node.py:70`、`crates/adapters/binance/src/futures/execution.rs:1353-1392`）；Hedge 模式 `reduce_only` 不上线、按方向选 positionSide（`crates/adapters/binance/src/futures/conversions.rs:53-86`） |
| 仓位与账户：没查的 | 汇总行 | 汇总行 | 不分类 | Sandbox 路径的实际运行（HEDGING、`use_position_ids=true`、资金费订阅被丢弃）需要网络，只读了 Sandbox 源码和产品 2026-10 的实测记录；Live 的任何运行行为（本地账户杠杆、同向虚拟仓位竞态、资金费实际扣费）不能启动 Live、不读凭证；Binance 真实分档保证金（MMR 档位、清算费、保险基金）与回放的差异（产品用声明费率覆盖，`engine/report.py:206-207` 写明“rates are declared values, not Binance's tiers”；`engine/README.md:116-117` 的“最大仓位所在档位”取法未核）；Binance 保证金 FAQ 只读了页面摘要，未用真实账户核对；多币种、COIN-M、现货账户路径；回放里 `use_position_ids`、`use_reduce_only`、`trade_execution` 等未传参数的默认值归匹配与订单组；`engine/audit.py` 的整个对账逻辑与 `live/compare.py` 的比较算法只读了相关部分；候选的现场验证涉及凭证和真实订单，须用户另行授权，本审计未做 |
| 合约与精度：`CryptoPerpetual` 定义（回放） | nautilus_trader v2.0.0rc7：PyO3 构造器，字段含 `price_precision`、`size_precision`、`price_increment`、`size_increment`、`min_quantity`、`max_quantity`、`min_notional`、`margin_init`、`margin_maint`、`multiplier`、`lot_size`；Money 金额走 f64；Nautilus 自己的 `parse_futures_min_notional` 同为 f64：`crates/adapters/binance/src/common/parse.rs:178-187` | `market/instrument.py:61-104` 由 exchangeInfo 条款造合约，`multiplier=1`、`lot_size=size_increment`、保证金取 `ASSUMED` 的 0.1（`market/instrument.py:22,99`）；`engine/run.py:777-789` 的 `with_margins` 再按账户契约换保证金率；不设 `maker_fee`、`taker_fee`，手续费走 `MakerTakerFeeModel`：`engine/run.py:750-757` | 正确使用 | 探针 B（C6）：造出的合约在回放的 RiskEngine 里按 `min_notional=50`、`min_quantity=0.001` 生效；`min_notional` 经 `float(Decimal(...))` 进 Money，与 `parse_futures_min_notional` 同为 f64 |
| 合约与精度：条款来源（回放） | nautilus_trader v2.0.0rc7：无。Nautilus 不带历史合约条款，BacktestEngine 里只有 Sandbox 会调用撮合引擎的 `update_instrument`：`crates/adapters/sandbox/src/execution.rs:604` | 取最新观测的一行，回执标 `CURRENT_SNAPSHOT_APPROXIMATION`：`market/instrument.py:30-39`；声明点：`market/instrument.py:23`、`engine/load.py:424,461-473`、`market/README.md:300-306` | 正确使用 | 整个开发期回放用的是 2026-10 的 tick、步长、最小数量、最小名义（探针 C6-terms-history；BTC 最小名义 50、ETH 20 来自 `market coverage`）。没有任何文件说明 2021-10 至 2024-10 间这些值，“当前值近似历史值”没有证据；但近似已声明。C6 原判未验证的假设，核实卡 T-11 判已覆盖（已知并有意保留；对当前候选 tick 差约 1e-6 相对价格，最小名义不起作用）。查了 `min_notional`、`最小名义`、`CURRENT_SNAPSHOT`（`docs/plans`、`docs/rd`、`engine/README.md`、`market/README.md`、`tests/`） |
| 合约与精度：tick 放宽（回放） | nautilus_trader v2.0.0rc7：撮合引擎对 K 线要求精度严格相等 `check_price_precision`：`crates/execution/src/matching_engine/mod.rs:1472-1481`，K 线路径 `crates/execution/src/matching_engine/mod.rs:1904-1928`，不相等的整根 K 线跳过只记 warn；resting 订单要求在 tick 网格上：`crates/execution/src/matching_engine/mod.rs:1561-1590` | `market/export.py:122-139,508-513` 加 `market/instrument.py:82`：窗口内有刻度外价格就把合约刻度放到价格精度的最细一档（BTC 为 0.01） | 正确使用 | 有已记录的偏差：探针 B 同一合约，`on_grid=False` 时 65000.05 的限价单成交，`on_grid=True`（tick 0.10）时 `OrderRejected ... not a multiple of ... price increment 0.10`，放宽后回放比 Paper、Live 的 0.10 松。记录在 `docs/plans/trust-boundary-deferred.zh.md:36-45`；核实卡 T-11 判已覆盖（`price_precision_widened` 进回执与对照：`market/export.py:556`、`replay/comparison.py:474-486`） |
| 合约与精度：精度、数量上下限、最小名义（回放） | nautilus_trader v2.0.0rc7：`check_price`：`crates/risk/src/engine/mod.rs:1725-1748`；`check_quantity`：`crates/risk/src/engine/mod.rs:1751-1798`；账户风险里的 `min_notional`（reduce-only 与整仓退出豁免）：`crates/risk/src/engine/mod.rs:2496-2512`；`max_notional`：`crates/risk/src/engine/mod.rs:2514-2530` | 回放用 `RiskEngineConfig(max_order_submit_rate=...)`：`engine/run.py:819`，其余全是原生默认；`engine/order_rules.py:1-34` 的 8 条规则里没有这几项 | 正确使用 | 探针 B 实测：名义 49 小于 50 的限价单与 STOP_MARKET 入场单都是 `OrderDenied: NOTIONAL_BELOW_MINIMUM`；名义同样很小的 reduce-only 单成交；小数位超过合约精度被 `PRICE_PRECISION_EXCEEDS_MAXIMUM` 拒绝（核实卡 T-11 重跑一致） |
| 合约与精度：精度、数量上下限、最小名义（Paper） | nautilus_trader v2.0.0rc7：同一 Rust RiskEngine，经 `LiveRiskEngineConfig`；Sandbox 撮合引擎只管 tick 网格与精度，最小名义只在 RiskEngine：`crates/execution/src/matching_engine/mod.rs:1561-1590` | `engine/paper.py:723`，合约来自 Binance 加载器（无密钥），不是市场导出的合约 | 正确使用 | 源码同上 |
| 合约与精度：精度、数量上下限、最小名义（Live） | 同一 RiskEngine，加上 Binance 自己的过滤器 | `engine/live_node.py:61` 只设提交频率；产品自己再加两道：`LIVE_MINIMUM_SIZE`（最小名义与 `minQty` 乘标记价不得超过 3 倍权益）：`engine/live_venue.py:264-270`，和入场 3 倍权益上限：`engine/order_rules.py:98-103` | 正确使用 | 两道检查是产品自己的信任边界，Nautilus 不知道产品的 3 倍上限，没有重复 Nautilus 的 `min_notional` |
| 合约与精度：最小名义由谁做（汇总） | nautilus_trader v2.0.0rc7：回放、Paper、Live 都是 RiskEngine：`crates/risk/src/engine/mod.rs:2496-2512` | 回放：市场条款里的 `min_notional`（`inferred` 条款没有该字段）；Paper：启动时加载器读的 Binance 值，之后每小时刷新；Live：同上加交易所，外加产品的准入检查；脚手架的 `order_quantity`（`cli/research_commands.py:127-143`）是策略侧预检，三条链路相同 | 正确使用 | `tests/` 里没有任何用例断言原生的 `NOTIONAL_BELOW_MINIMUM` 或 tick 拒绝（查了 `NOTIONAL_BELOW`、`NotionalBelow`、`not a multiple`、`PRICE_PRECISION`，范围 `tests`、`engine`、`docs/plans`、`.agents`），只有本次探针 B 实测过。`inferred` 条款无数量与名义检查，核实卡 T-11 判已覆盖（`docs/rd/design-database-market.zh.mdx:66` 行规则） |
| 合约与精度：合约提供者（Paper） | nautilus_trader v2.0.0rc7：`BinanceInstrumentProviderConfig(load_all, load_ids)`，选择器 `crates/adapters/binance/src/futures/http/client.rs:2122-2200`；非 TRADING 的符号被跳过：`crates/adapters/binance/src/common/parse.rs:327-333`；显式 `load_ids` 的符号解析失败只记 warn：`crates/adapters/binance/src/futures/http/client.rs:3724-3737` | `engine/paper.py:727-728`，`load_all=False`、`load_ids=planned` | 正确使用 | 一个已停止交易的符号启动时不会报错，只是没有合约 |
| 合约与精度：合约提供者（Live） | nautilus_trader v2.0.0rc7：同上，数据客户端与执行客户端各一份；`format_instrument_id`：`crates/adapters/binance/src/common/symbol.rs:35-51` | `engine/live_node.py:33,63-68`，两个客户端共用同一个 provider；`engine/config.py:43-46` 的 `instrument_id()` 拼 `{symbol}-PERP.BINANCE` | 正确使用 | 合约 id 拼写与适配器一致 |
| 合约与精度：条款比对（Paper） | 无。Nautilus 不知道产品的市场目录 | `engine/paper.py:539-554`，`on_start` 时比较 tick、步长、最小名义和保证金率，不一致就 `TERMS_CHANGED` 停机：`engine/paper.py:471` | 正确使用 | 只在启动时。设计依据 `docs/plans/r1-2d-leverage-terms-20261111.zh.md:59`；启动后的变化见运行中 tick 与步长变化行 |
| 合约与精度：条款比对（Live） | 无。Nautilus 没有“与外部条款比对”的功能（没查到对应的 Nautilus 源码位置） | `engine/live_venue.py:250-263`：每次入场准入读 exchangeInfo 比对市场条款，不一致抛 `TERMS_CHANGED`；`engine/live_commands.py:226-236` 把任何准入异常变成 `entry_admission_failed` 停机 | 未验证的假设 | C6 原判有理由的重复实现；缺 Nautilus 源码位置（没有对应功能可引），按汇编规则降为未验证的假设。产品自带只读 REST 客户端（`engine/live_venue.py:68-130`）而不用 Nautilus 已加载的合约：Nautilus 没有“与外部条款比对”的功能（来源写的位置 `docs/plans/r1-2d-leverage-terms-20261111.zh.md` 第 75 行超出文件长度，位置待核），比对对象是市场目录。比对的是 REST 快照，不是 RiskEngine 与策略实际读到的缓存合约（核实卡 T-08 判可能）。Live 条款变化终止整个运行并以 `unresolved` 结束，核实卡 T-09 判已覆盖（`docs/plans/r1-runtime-contract-20261110.zh.md:128-131`） |
| 合约与精度：`make_price` | nautilus_trader v2.0.0rc7：`Instrument::make_price` 按 `min_price_increment_precision` 取小数位，MidpointNearestEven：`crates/model/src/instruments/mod.rs:358-361,372-378` | 产品不做价格取整；技能要求策略用 `make_price`：`.agents/skills/research-round/references/strategy-authoring.md:156` | 未验证的假设 | 探针 A（C6）：按小数位取整，不按 tick 的倍数：tick 0.5 时 `make_price(100.07)=100.1`，tick 0.25（精度 2）时 `make_price(100.33)=100.33`，均不在网格上。当前宇宙全部是 10 的幂（探针 C），今天没有实际后果；依赖“tick 是 10 的幂”这一假设没有测试。核实卡 T-12 确认（文档串不符，后果为假设） |
| 合约与精度：`make_qty` | nautilus_trader v2.0.0rc7：`make_qty(value, round_down)` 同样按小数位；`round_down=True` 为向零取整；舍入后为零则抛 `ValueError`：`crates/model/src/instruments/mod.rs:483-505` | 脚手架 `order_quantity`：`cli/research_commands.py:127-143` 先排除小于 `size_increment`，再 `make_qty(round_down=True)`，再查 `min_quantity`、`min_notional` | 正确使用 | 同样依赖 10 的幂。探针 A：`make_qty(0.0004, round_down=True)` 抛 `ValueError`，与产品注释一致；`tests/cli/test_scaffold.py:58-62` 覆盖这几个边界。`order_quantity` 的文档串写“rounded down to the size increment”（`cli/research_commands.py:128`），对步长 0.5 或 10 不成立（步长 10 时 `make_qty(14, round_down=True)=14`），核实卡 T-12 确认 |
| 合约与精度：产品自己的取整 | 无对应的 Nautilus 接口（没查到对应的 Nautilus 源码位置） | 价格与数量取整：`engine/klines.py:50-51`（Paper、Live 预热 K 线，用 `f"{Decimal:.{precision}f}"` 压到合约精度，ROUND_HALF_EVEN）、`engine/warmup.py:107`、`market/export.py:264`（报价数量 `quantize`）；资金取整：`engine/live_brake.py:70,103`、`report/measures.py:80` | 未验证的假设 | C6 原判有理由的重复实现；缺 Nautilus 源码位置，按汇编规则降级。这些是数据适配（把交易所数据放进 Nautilus 的精度），不是下单取整；精度取自 `instrument.price_precision`（`engine/history.py:150`），预热 K 线与合约来自同一份，不会把交易所价格压粗。没有把“精度比数据窄”这种情况报出来的检查 |
| 合约与精度：运行中 tick 与步长变化（Paper） | nautilus_trader v2.0.0rc7：数据客户端默认每 3600 秒整体刷新合约目录（`crates/adapters/binance/src/futures/data.rs:408-465,1407-1450`，间隔默认 `crates/adapters/binance/src/config.rs:220-229`），新合约进缓存覆盖同 id：`crates/data/src/engine/dispatch.rs:29-45`，执行引擎转给 Sandbox：`crates/execution/src/engine/mod.rs:324-346`、`crates/adapters/sandbox/src/execution.rs:600-609`；Sandbox 撮合引擎 `update_instrument`：精度或 tick 变了就重置订单簿与排队状态，并取消所有不再兼容的挂单，只有一条 `log::warn!`：`crates/execution/src/matching_engine/mod.rs:1415-1456,1518-1556` | 无处理。条款只在启动时比对：`engine/paper.py:471`；两处配置都没传 `instrument_refresh_interval_secs`、`instrument_status_poll_secs`：`engine/paper.py:724-728`；没有订阅或检查合约更新；没有测试 | 未验证的假设 | 查了 `instrument_refresh`、`update_instrument`、`on_instrument\b`、`instrument_status_poll`（`engine/`、`tests/`、`docs/plans`、`.agents`）无命中。核实卡 T-08 判可能（源码链路证实，无实跑，本产品证据缺） |
| 合约与精度：运行中 tick 与步长变化（Live） | nautilus_trader v2.0.0rc7：数据与执行客户端各自每小时刷新：`crates/adapters/binance/src/futures/execution.rs:2115-2139` 只更新执行客户端自己的 HTTP 缓存 | 每次入场准入读 REST 并与市场比对，不一致停机；出场单（止损）不经此检查；配置未传刷新间隔：`engine/live_node.py:33,63-68` | 有理由的重复实现 | 理由成立（条款比对（Live）行）；剩余缺口：下单检查看的是缓存里最多 1 小时前的合约（核实卡 T-08 判可能，无实跑）。复核后补：数据客户端每次刷新都覆盖缓存里的合约（`crates/adapters/binance/src/futures/data.rs:408-465`、`crates/data/src/engine/dispatch.rs:29-45`），RiskEngine 每张单现读缓存；核实卡 X-03 据回环 C10 `s8_tick_change` 说“源码与风控用旧的合约表”，但那次观察分辨不了新旧合约（两个 tick 字符串解析出的价格精度都是 2），没有依据，见待证实表 |
| 合约与精度：合约状态与下架（回放） | nautilus_trader v2.0.0rc7：原生 `InstrumentStatus`（PRE_CLOSE、CLOSE）与 `InstrumentClose`（CONTRACT_EXPIRED），由 Catalog 写入、BacktestEngine 投递，撮合引擎据此关市并结算：`crates/execution/src/matching_engine/mod.rs:2573-2598` | `market/lifecycle.py` 校验清单并经 Catalog 写事件；`engine/run.py:454-455,617` 投递；`engine/load.py:477-582` 核对原生计数 | 正确使用 | `tests/engine/test_stream.py:278-325`、`tests/engine/test_entry_membership.py:128-138` 用原生引擎端到端覆盖 PRE_CLOSE、CLOSE、InstrumentClose；本组没有重新核对 BacktestEngine 的结算语义，沿用这些测试 |
| 合约与精度：合约状态与下架（Paper） | nautilus_trader v2.0.0rc7：数据客户端每 3600 秒轮询 exchangeInfo，用 `diff_and_emit_statuses` 发 `InstrumentStatus`：`crates/adapters/binance/src/common/status.rs:45-85`，轮询 `crates/adapters/binance/src/futures/data.rs:1347-1400`，间隔默认值 `crates/adapters/binance/src/config.rs:225-228`；状态映射：`crates/adapters/binance/src/common/enums.rs:577-600`（`Settling`、`Delivering`、`Delivered`、`Close` 到 Close，`TradingHalt`、`TradingCancelOnly`、`Halt` 到 Halt，`Break` 到 Pause）；Sandbox 自己订阅状态并转给撮合引擎：`crates/adapters/sandbox/src/execution.rs:309,318,1096-1110`；撮合引擎的 `process_status` 对 Pause、Suspend、Halt、Close 都关市，`NotAvailableForTrading` 落入 `_` 分支被忽略：`crates/execution/src/matching_engine/mod.rs:2573-2598`；只有 `market_status == Open` 才撮合挂单：`crates/execution/src/matching_engine/mod.rs:4238`；非 Open 时新单被拒（“Market … is …, cannot accept order”）：`crates/execution/src/matching_engine/mod.rs:3040-3049`；Binance 适配器从不发 `InstrumentClose` | `engine/paper.py:484,492-494`：订阅状态，只写日志；没有 `InstrumentClose` 订阅；产品没有另加状态闸门 | 未验证的假设 | 复核后改判（原判“该用未用”，原文写“`process_status` 只在 Halt、Close 时关市”“Paper 继续撮合”，与 rc7 源码不符）。Paper 的状态闸门由 rc7 的 Sandbox 原生提供：状态事件到达后撮合引擎自己停撮合并拒新单，产品不需要再做一道。核实卡 T-10 的残余有三点，都是读源码的推断，没有 Sandbox 实跑：(1) 状态轮询默认 3600 秒，最长晚一小时；(2) 目录刷新（`crates/adapters/binance/src/futures/data.rs:408-465`）若先于状态轮询，非 TRADING 的合约被解析器丢掉（`crates/adapters/binance/src/common/parse.rs:327-333`），状态表里查不到它，`diff_and_emit_statuses` 只发 `NotAvailableForTrading`（`crates/adapters/binance/src/common/status.rs:63-78`），撮合引擎不关市；两个定时器都是 3600 秒，先后是竞态，若刷新总是先到，Paper 就确实不会关市；(3) 不结算，下架后权益按最后标记价。当前候选不受影响 |
| 合约与精度：合约状态（Live） | nautilus_trader v2.0.0rc7：同上，数据客户端 3600 秒轮询：`crates/adapters/binance/src/config.rs:223-228`，`diff_and_emit_statuses`：`crates/adapters/binance/src/common/status.rs:45-85`；rc8 修了“Binance Spot and Futures overlapping instrument-status updates losing or duplicating changes”：`RELEASES-rc9.md:575` | `engine/live_connection.py:456-479` 自己用准入读到的 exchangeInfo 看状态，不是 TRADING 就按合约关入场；轮询间隔 300 秒，状态异常时 60 秒：`engine/live_connection.py:48,58,414-452`；不订阅原生状态 | 有理由的重复实现 | 理由成立：原生轮询默认 3600 秒；rc7 的状态更新有 rc8 修掉的丢失或重复缺陷。升到 rc8、rc9 后默认 3600 秒的问题仍在，可改成配置旋钮，产品的 REST 检查不依赖它 |
| 合约与精度：保证金率（Paper） | nautilus_trader v2.0.0rc7：rc7 Binance 解析器把 `margin_init`、`margin_maint` 固定写成 0.1：`crates/adapters/binance/src/common/parse.rs:344-441`（`default_margin` 在 `crates/adapters/binance/src/common/parse.rs:371`），Sandbox 配置没有按合约的保证金率 | `engine/paper.py:112-116,732`：杠杆乘 0.1，并要求加载的合约保证金率等于 0.1，否则 `TERMS_CHANGED` | 版本风险 | rc9 发布说明“Fixed Binance Futures initial margin underestimation (#5531)”（`RELEASES-rc9.md:239`）与 rc8 发布说明“Added custom Python margin models in backtest venue and sandbox configuration”（`RELEASES-rc9.md:419`，属 rc8 一节，不是 rc9；复核后更正，原写第 40 行）。升级后加载器的保证金率变了，`LOADER_MARGIN` 校验会让所有 Paper 运行以 `TERMS_CHANGED` 停机（推断：没有读 rc9 源码，不知道新值）。产品文档已写明“升级后去掉 `LOADER_MARGIN`”（`docs/plans/r1-2d-leverage-terms-20261111.zh.md:64`）；核实卡 M-06、T-13 判可能（只在升级时相关） |
| 合约与精度：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | 回放 RiskEngine 对精度、`min_quantity`、`min_notional`、reduce-only 豁免与 STOP_MARKET 入场的处理（`crates/risk/src/engine/mod.rs:1725-1798,2496-2512`，探针 B）；回放与 Sandbox 对网格外价格的拒绝（`crates/execution/src/matching_engine/mod.rs:1561-1590`，探针 B）；合约 id 拼写（`engine/config.py:43-46` 对 `crates/adapters/binance/src/common/symbol.rs:35-51`）；回放导出合约与 Binance 解析器在 tick 精度、步长精度、`lot_size=step`、`multiplier` 上一致（`crates/adapters/binance/src/common/parse.rs:344-441`、`market/instrument.py:84-99`）；`make_qty(round_down=True)` 小于一个步长抛 `ValueError`，脚手架已先挡掉（探针 A，`tests/cli/test_scaffold.py:58-62`）；Live 与 Paper 不改交易所设置、不自带下单取整（`engine/live_venue.py:68-92` 只允许 GET，`engine/live_node.py:68` 的 `futures_leverages=None`）；产品没有把自己的价格或数量取整用在下单上（查了 `make_price`、`make_qty`、`quantize`、`ROUND_`、`Price(`、`Quantity(`，范围 `engine/`）；`max_notional` 适配器不填（`crates/adapters/binance/src/common/parse.rs:344-441`），入场 3 倍权益上限使 Binance 杠杆分层额度缺席在当前规模下无实际影响（推断） |
| 合约与精度：没查的 | 汇总行 | 汇总行 | 不分类 | 历史最小名义、最小数量、最大数量、tick 的实际变化记录（没有可用来源，本机只有 2026-10 的两行，没有联网）；`MARKET_LOT_SIZE` 与 STOP_MARKET 入场的数量过滤器（需要交易所文档或测试网）；BacktestEngine 内部对 `InstrumentClose` 的结算语义（只沿用已有测试）；rc9 的 #5531 修复后保证金率的新值（没读 rc9 源码）；Live 下架实况（SETTLING 到 DELIVERED，需要交易所）；三条链路的手续费属别的组件组 |
| 实盘节点与 Binance 客户端：LiveNode 构建与启动顺序 | nautilus_trader v2.0.0rc7：先连数据客户端、再连执行客户端、等引擎就绪、启动对账、最后 `start_trader`：`crates/live/src/node/mod.rs:435-560`（启动对账在 `start_trader` 之前：`crates/live/src/node/mod.rs:528-544`）；对账超时默认 30 秒，连接超时默认 60 秒：`crates/live/src/node/config.rs:785-802`。产品 import 的是 v2 的 `LiveNode`，rc7 里没有 `TradingNode`（`MIGRATION_V2.md:53`） | Live：`engine/live_node.py:40-71` 用 builder，不改超时；对账完成前 Observer 不放行订单命令：`engine/live_commands.py:74-79`。Paper：`engine/paper.py:681-740`；版本钉死：`engine/live.py` 的 `LIVE_RUNTIME_VERSION` 检查 | 正确使用 | 产品“原生启动后再复核账户”的顺序与源码一致。产品没设 `timeout_*`（见没查的） |
| 实盘节点与 Binance 客户端：信号处理 | nautilus_trader v2.0.0rc7：`run()` 在主线程装 SIGINT、SIGTERM 处理，收到就 `handle.stop()`：`crates/live/src/python/node.rs:1131-1136` | Live：阻塞信号并开 sigwait 线程：`engine/live.py:14-15,251-256` | 正确使用 | 产品要“中断但不平仓”，所以自己接管信号。探针 C7-sigwait-vs-node-signal：信号被 sigwait 线程收到，节点没有自己停（3 秒内仍在跑）。探针只在 macOS 上跑，未在 Linux 容器里跑 |
| 实盘节点与 Binance 客户端：启动对账配置（`reconciliation`、`reconciliation_lookback_mins`、`reconciliation_instrument_ids`） | nautilus_trader v2.0.0rc7：`reconciliation=True` 默认；`lookback=None` 时 Binance `generate_mass_status` 取“完整起点等于现在减 12 小时减一个间隔”以来的订单与成交，并把 `reports_complete=false`：`crates/adapters/binance/src/futures/execution.rs:2887-3000`（`USER_TRADES_MAX_TS_INIT_AGE=12h` 在 `crates/adapters/binance/src/futures/execution.rs:154`）；`reconciliation_startup_delay_secs` 只是首次周期检查的推迟：`crates/live/src/node/mod.rs:1467-1473` | Live：`reconciliation=True`、`reconciliation_instrument_ids` 为本次运行的合约、lookback 不设：`engine/live_node.py:51-57`。Paper：只有带 checkpoint session 才开：`engine/paper.py:716` | 正确使用 | 探针 1（C7）打印了实际生效值（lookback `None`、startup delay 10 秒） |
| 实盘节点与 Binance 客户端：启动对账在 rc9 的修复 | rc9 修了“Binance 启动对账对选定合约漏掉已关闭订单”：`RELEASES-rc9.md:240` | 产品正好设了 `reconciliation_instrument_ids`：`engine/live_node.py:51-57` | 版本风险 | 核实卡 L-12 判可能（只在升级 Nautilus 时相关，当前锁定版本不受影响；发布说明未逐行复核） |
| 实盘节点与 Binance 客户端：`filter_unclaimed_external_orders` | nautilus_trader v2.0.0rc7：`True` 时没有策略认领的外部订单事件被丢弃；合成的对账单不丢：`crates/live/src/execution/manager.rs:4711`；无订单的成交也丢：`crates/execution/src/engine/mod.rs:1372-1376,1461` | Live：`True`，不用 `external_order_claims`：`engine/live_node.py:54`（查了 `external_order_claims`、`claim_external`，范围 `engine .agents`，无结果） | 正确使用 | 有后果：产品自己 2026-11-07 的回环探针（`docs/plans/live-release.zh.md:133-134`）：手动平仓的成交被丢弃，约 60 秒后生成 EXTERNAL 市价单和 EXTERNAL 空仓。核实卡 L-09 原判已覆盖。复核后改为并入发现 20261114-25（连同 M-13）：README 的“运行期间不要手动交易、事后用 `reconcile` 处置”只管事后与手动情形，不管强平和 ADL；运行中没有机制管住。回环 C10 `s2_external_manual`、`s2_external_liquidation` 实测：外部平仓后新入场仍通过全部检查并成交，周期比对约 5 分钟后才发现（手动一例），STOP 时平仓打在真实新仓位上或被拒，留下孤儿条件单，以 `unresolved` 结束 |
| 实盘节点与 Binance 客户端：周期检查与在途检查参数 | nautilus_trader v2.0.0rc7：默认：inflight 每 2 秒检查、阈值 5 秒、重试 5 次；open_check 阈值 5 秒、missing 重试 5 次、`open_only=True`；position 阈值 5 秒、重试 3 次；`generate_missing_orders=True`；`RESOLVE_LOCALLY`：`crates/live/src/node/config.rs:409-520`、`crates/live/src/execution/manager.rs:1932-2030` | Live：`open_check_interval_secs=10`、`position_check_interval_secs=30`，其余全默认：`engine/live_node.py:54`（查了 `inflight_check`、`generate_missing_orders`、`submission_recovery`、`RETAIN_UNRESOLVED`，范围 `engine`，无结果） | 正确使用 | 探针 1 打印生效值。`open_only=True` 时回看分钟数不参与（`crates/adapters/binance/src/futures/execution.rs:2466-2490`），所以 `open_check_lookback_mins=60` 不会漏掉久远的 GTC 止损 |
| 实盘节点与 Binance 客户端：内存清理 `purge_account_events_*`、`purge_closed_*` | nautilus_trader v2.0.0rc7：引擎定时器按间隔清内存里的账户事件，只清内存：`crates/execution/src/engine/mod.rs:968-1000`、`crates/common/src/cache/mod.rs:2010-2030`；Python `__new__` 不暴露 `purge_from_database`，固定为 false：`crates/live/src/python/config.rs` | Live：账户事件每 60 分钟清一次、保留 24 小时：`engine/live_node.py:25-26,56-57`；订单、持仓不清 | 正确使用 | 定时器只调 `cache.purge_account_events`，不碰 Redis，与 README“内存里清、Redis 不裁”一致 |
| 实盘节点与 Binance 客户端：`LiveDataEngineConfig` 的 `time_bars_build_delay` | nautilus_trader v2.0.0rc7：`time_bars_build_delay` 单位是微秒：`crates/data/src/engine/config.rs:51-53` | Live、Paper：`time_bars_build_delay=history.BUILD_DELAY_US`（5 秒）：`engine/history.py:42`、`engine/paper.py:697`、`engine/live_node.py:39`；回放不设：`engine/run.py:814-818` | 正确使用 | 单位核对无误。Live、Paper 与回放在聚合 K 线时间戳上有 5 秒的刻意差异（`engine/history.py:38-42` 注释） |
| 实盘节点与 Binance 客户端：数据客户端配置 | nautilus_trader v2.0.0rc7：`recv_window_ms=5000`、`max_retries=3`、重试 1 至 10 秒、`instrument_refresh_interval_secs=3600`、`instrument_status_poll_secs=3600`：`crates/adapters/binance/src/config.rs:223-247` | Live、Paper：只设 `product_type`、`environment`、`instrument_provider(load_all=False, load_ids)`、`proxy_url`，不给 key：`engine/live_node.py:63-65`、`engine/paper.py:722-728` | 正确使用 | 探针 1 |
| 实盘节点与 Binance 客户端：执行客户端配置 | nautilus_trader v2.0.0rc7：`use_ws_trading` 默认 true；`use_gtd` 默认 true；`use_position_ids` 默认 true；`futures_leverages`、`margin_types` 才会改交易所设置；`treat_expired_as_canceled=false`：`crates/adapters/binance/src/config.rs:364-435`；WS 交易主机只在 `use_ws_trading=true` 时用：`crates/adapters/binance/src/common/consts.rs:53,98-104,130` | Live：`use_ws_trading=False`、`oms_type=HEDGING`、`use_position_ids=False`、`futures_leverages=None`、`futures_margin_types=None`：`engine/live_node.py:66-70`；出口白名单只剩 `fapi.binance.com`、`fstream.binance.com`：`engine/egress.py:16` | 正确使用 | `use_position_ids=False` 与适配器的“虚拟对冲”说明一致（`crates/adapters/binance/src/futures/execution.rs:1495` 的报错文字） |
| 实盘节点与 Binance 客户端：行情 WebSocket 订阅与重连 | nautilus_trader v2.0.0rc7：数据流池断线后无限重连（`reconnect_max_attempts: None`，0.5 至 5 秒指数退避），20 秒心跳、心跳超时默认三个间隔即 60 秒：`crates/adapters/binance/src/futures/websocket/streams/client.rs:629-633`、`crates/network/src/websocket/config.rs:170-183`；重连后重新订阅全部主题：`crates/adapters/binance/src/futures/websocket/streams/client.rs:739-753`；不补发断线期间错过的 K 线 | Live：Observer 订阅 socket 状态，断线就关入场：`engine/live_lifecycle.py:64,87-95`、`engine/live_connection.py:294-309`；缺根不补数据，空仓后结束本次启动，由控制重启并用 REST 公开 K 线重新预热：`engine/live_connection.py:311-354`；Paper：只记 `data_gap`，源码继续收后续 K 线：`engine/paper.py:192-203,500-503` | 正确使用 | 重连与重新订阅由 Nautilus 做，产品没有重造；“Nautilus 不补缺根”在 rc7 源码上成立，rc8、rc9 说明里没查到补缺根条目。产品的缺根检测与重新预热是 Nautilus 没有的功能。核实卡 T-02 确认（缺根后重新预热会永久丢掉恰在缺口或重启窗口里的每日决策，机制已知并有意保留）；Paper 与 Live 缺根处理不同，核实卡 T-03 判已覆盖，核实卡 L-27 判驳回（已知并有意保留） |
| 实盘节点与 Binance 客户端：用户数据流（listenKey）保活与恢复 | nautilus_trader v2.0.0rc7：每 30 分钟 PUT 保活，连续失败 1 次就轮换 key：`crates/adapters/binance/src/futures/execution.rs:138-142,1984-2030`；`listenKeyExpired` 或传输层重连都触发恢复：新建 key、用 REST 补发当前所有挂单与条件单的状态报告、连新 socket、关旧 socket：`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:199-265`（触发点 `crates/adapters/binance/src/futures/websocket/streams/dispatch.rs:243-259`）；补发不包括缺口期间已成交或已撤的单，由定期对账修复：`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:298-300`；rc7 的 `close_recovery_listen_key` 在关旧的未提交 key 失败时直接返回错误，下一轮重试又先关它，可永久卡住：`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:208,276-292`、`crates/adapters/binance/src/futures/http/client.rs:1053-1061` | Live：不重造用户流；只靠 socket 状态事件关入场，加上“REST 读取与原生缓存比对两次一致”才重开：`engine/live_connection.py:17-25,357-411,481-523` | 版本风险 | rc8 修了“Binance Futures 恢复在 listenKey 过期时卡死”（`RELEASES-rc9.md:583`），rc7 上仍在。核实卡 L-12 判可能（只在升级时相关） |
| 实盘节点与 Binance 客户端：用户数据流断线、listenKey 轮换、止损在无事件期间触发（真实交易所） | nautilus_trader v2.0.0rc7：轮换时新代 `sink()` 取代旧代，旧连接迟到的连接状态事件不再发布（`publish_if_current` 只过滤 socket 状态变化，不涉及订单与成交事件）：`crates/live/src/socket.rs:480-494`；缺口里已成交或已撤的单不在 REST 补发范围（补发只含仍挂着的单，源码注释自己写明）：`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:290-300`；周期对账在 `open_check_open_only=true` 下对“缓存有、交易所无”只记 debug：`crates/live/src/execution/manager.rs:2439-2468`；所以 rc7 对不上这笔成交，缓存里的仓位成了幻影（核实卡 L-10） | Observer 只会看到一个 CONNECTED、没有 DISCONNECTED，关入场的门不会动：`engine/live_connection.py:294-309,576-588` | 未验证的假设 | 产品自己写明“真实账户的用户流断线与重连没有验证”（`docs/plans/live-continuous-step3-disconnect-20261113.zh.md`“没有验证”一行）；回环上的机制由核实卡 L-10 确认（回环探针 C10 的 P1-b、P3-b、P3-c），真实交易所未验证。发现 20261114-25；复核后同一条还并入了被 `filter_unclaimed_external_orders` 过滤掉的外部成交（L-09、M-13） |
| 实盘节点与 Binance 客户端：socket 状态事件与主动换连接 | nautilus_trader v2.0.0rc7：`SocketControl`、`SocketControlFactory` 带代数：`crates/live/src/socket.rs:480-525`；`reconnect_socket(client_id, endpoint)`：`python/nautilus_trader/trading/__init__.pyi:991`；端点名 `binance-futures-market-streams`、`binance-futures-public-streams`：`crates/adapters/binance/src/futures/data.rs:119-120`，`binance-futures-user-streams`：`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:104-107` | Live：`subscribe_socket_state(client_id=BINANCE)`；账户空仓且连接超过 23 小时时在分钟第 20 至 40 秒调 `reconnect_socket`：`engine/live_connection.py:576-588` | 正确使用 | 数据端点用 2026-11-12 探针测过（`docs/plans/live-continuous-step3-disconnect-20261113.zh.md`“原生探针结果”）；用户流端点在 rc7 里确有 `reconnect_socket` 注册（`crates/adapters/binance/src/futures/websocket/streams/recovery.rs:104-107`），本机没有办法测 |
| 实盘节点与 Binance 客户端：REST 的 429、418 与重试（产品自己的只读客户端） | nautilus_trader v2.0.0rc7：GET 最多重试 `max_retries=3`，退避 1 至 10 秒，总时长上限 180 秒，`Retry-After` 作为最小等待：`crates/adapters/binance/src/common/error.rs:93-97`、`crates/adapters/binance/src/common/http.rs:25-37`、`crates/adapters/binance/src/futures/http/client.rs:560-605`；非 GET 只发一次：`crates/adapters/binance/src/futures/http/client.rs:566-568`；下单类 429、418、5xx 归为“结果不明”：`crates/adapters/binance/src/common/failure.rs:60-79`；限速是每请求一个令牌，不按权重：`crates/adapters/binance/src/futures/http/client.rs:111,264-350,760-800`；rc7 的 Python 绑定里没有 Binance HTTP 客户端，`query_account` 取不到 `dualSidePosition`、`multiAssetsMargin`、`symbolConfig`、algo 单：`crates/adapters/binance/src/futures/execution.rs:489-493` | Live：产品另有只读 REST 客户端 `BinanceReadOnly`（urllib），用于准入、每笔入场、比对、回撤刹车：`engine/live_venue.py:72-104`；没有重试、不看 `Retry-After`、HTTPError 一律抛 `LIVE_ACCOUNT_UNAVAILABLE`：`engine/live_venue.py:97-103` | 有理由的重复实现 | 理由成立（rc7 Python 绑定里没有 HTTP 客户端，rc8、rc9 说明里没有新增）。缺口是产品这一份没有重试：核实卡 L-07 确认（无重试、无退避、空仓时读取全部失败没有通知是事实；封禁风险部分为可能，没有权重数据）；读取遇到“HTTP 200 但形状不对”抛 KeyError，核实卡 L-06 确认（机制，频率未知） |
| 实盘节点与 Binance 客户端：REST 限速与冷却在 rc9 的变化 | rc9 修了“REST 请求忽略其他请求的 429、418 冷却”“重试绕过权重节流”“节流忽略接口权重”：`RELEASES-rc9.md:242,244,245`；rc9 还把 418 无 `Retry-After` 改成阻塞、非 GET 在配额门处失败：`RELEASES-rc9.md:86-88` | 同上行（产品 REST 客户端不依赖 Nautilus 的限速） | 版本风险 | rc7 上这些都没有。核实卡 L-12 判可能（只在升级时相关） |
| 实盘节点与 Binance 客户端：时间同步 | nautilus_trader v2.0.0rc7：没有。签名请求用本机 `Timestamp::now()` 加 `recv_window_ms=5000`：`crates/adapters/binance/src/futures/http/client.rs:623-640`；查了 `server_time`、`time_offset`、`-1021`（`crates/adapters/binance/src`）只有数据模型，无偏移校正 | Live：runner 每次预检、启动、每笔入场、每次比对用 REST 测三次服务器时间，限提前不超过 1000 ms、落后不超过 2500 ms：`engine/live_venue.py:28-30,105-115,136-150` | 正确使用 | 这是 Nautilus 没有的功能；数值与 `recv_window_ms=5000` 的一半、Binance 提前上限一致，来自 `engine/live_venue.py:28-29` 与 `docs/plans/live-release.zh.md:100-110` |
| 实盘节点与 Binance 客户端：产品的 REST 与缓存比对（重开入场的栅栏） | nautilus_trader v2.0.0rc7：rc7 没有“恢复完成”信号（查了 `recovery_complete`、`reconciliation_complete`、`on_reconcil`，范围 `crates/trading/src/python`、`crates/live/src/python`，无结果）；`SubmissionRecoveryExhausted` 只在 Rust 一侧：类型与语义 `crates/live/src/execution/submission.rs:60-66`（节点在处理完对账事件后发布），产生处 `crates/live/src/execution/manager.rs:419-470`；在 `crates/{live,trading,common}/src/python/` 下 grep `SubmissionRecoveryExhausted\|recovery_exhausted` 无命中 | Live：断线、缺根、未知单后，两次间隔至少 31 秒的 REST 读取与原生缓存一致才重开：`engine/live_connection.py:46-48,357-411,481-523` | 有理由的重复实现 | 严格说是补 rc7 不提供的功能。复核后更正引用：原引的 `crates/live/src/node/mod.rs:7024` 在该文件的测试模块里（`mod tests` 从第 3439 行起），不是实现。理由：`docs/plans/live-continuous-operation-design-20261110.zh.md` 第 3.2 节末段“rc7 没有恢复完成信号”；rc8、rc9 说明里没查到新增（对 `recovery`、`reconcil` 的行逐条看过）。比对是原生对账的补充而不是替代 |
| 实盘节点与 Binance 客户端：在途订单检查 | nautilus_trader v2.0.0rc7：`check_inflight_orders`：超过阈值先 `query_order`，重试满 5 次后对仍是 SUBMITTED 的单生成 `OrderRejected("INFLIGHT_TIMEOUT")`：`crates/live/src/execution/manager.rs:1932-2030` | Live：不重做；比对里把 `SUBMITTED`、`PENDING_*` 视为“在途”：`engine/live_connection.py:64,399-401`；任何 `OrderRejected` 都按 `native_order_failure` 结束运行：`engine/live_source.py:263-270` | 正确使用 | 与源码一致。下单或撤单请求结果不明时，rc7 约 30 秒后在本地判拒绝或判已撤，交易所上的单可能还活着：核实卡 L-11 确认（机制，回环实跑） |
| 实盘节点与 Binance 客户端：外部订单、仓位与接管 | nautilus_trader v2.0.0rc7：启动对账把交易所上缓存不认识的订单与仓位生成 EXTERNAL 策略的单与仓位：`crates/live/src/execution/manager.rs:4680-4760` | Live：账户首次必须空仓；重启后账户有仓位或挂单就进入“只观察”模式 `held`，直到交易所空仓：`engine/live.py:200-210`、`engine/live_connection.py:545-573`；对账模式读到整账户空仓就记 `venue_flat` 释放账户槽：`engine/live.py:149-165`；不使用 external order claim（设计里写明不配：`docs/plans/binance-live-hedge-design.zh.md:134-136`）；“接管运行中 runner”（step6）已于 2026-11-14 被取代，代码里没有（查了 `ADOPT_INSPECT`、`RUNNER_CONTRACT`，范围 `*.py`，无结果） | 正确使用 | 产品对原生对账“对不上就卡”的回避，有 2026-11-07 回环探针支持（`docs/plans/live-release.zh.md:133-135`）。带持仓的重启不核实止损是否存在，核实卡 L-03 确认 |
| 实盘节点与 Binance 客户端：取消全部（未知单路径） | nautilus_trader v2.0.0rc7：`cancel_all_orders(order_side=None)` 为 HTTP 全撤普通单加全撤条件单，失败只记日志、不回报：`crates/adapters/binance/src/futures/execution.rs:3721-3754`；带 `order_side` 时按缓存里的单分批撤：`crates/adapters/binance/src/futures/execution.rs:966-1025` | Live：未知单出现时对该合约调 `Strategy.cancel_all_orders(source, contract, None, None, False)`：`engine/live_connection.py:514`；撤单重试用按方向的全撤：`engine/live_session.py:246` | 正确使用 | 参数顺序与签名一致（`python/nautilus_trader/trading/__init__.pyi:583-590`：`instrument_id, order_side, client_id, strategy_only, params`）。“只记日志”：429、418、网络失败时调用方得不到失败信息，产品靠下一轮比对重发（每 5 分钟，`PERIODIC_SECONDS`），未知单留在交易所最长约 5 分钟 |
| 实盘节点与 Binance 客户端：拒单入口 | nautilus_trader v2.0.0rc7：rc7 的 Python `Strategy` 没有 `deny_order`，只有 `ExecutionAlgorithm.deny_order`：`crates/trading/src/python/algorithm.rs:1174-1177`；Rust 的 `Strategy::deny_order`（`crates/trading/src/strategy/mod.rs:2083`）没有 Python 绑定 | Live：注册 `LIVE-GATE` 执行算法，用它的 `deny_order` 拒单：`engine/live_node.py:24,82-84`、`engine/live_connection.py:146-168` | 有理由的重复实现 | 理由成立（查了 `deny_order`，范围 `crates/trading/src/python`，只命中 `algorithm.rs`）；rc8、rc9 说明里没查到给 Python Strategy 加 `deny_order`。rc9 新增 `OrderModifyDenied`、`OrderCancelDenied`（`RELEASES-rc9.md:25`）会改变本地撤单拒绝的表现，升级时要重新核对 |
| 实盘节点与 Binance 客户端：历史预热的 REST | nautilus_trader v2.0.0rc7：数据客户端 `request_bars` 失败只记日志，不给应答：`crates/adapters/binance/src/futures/data.rs:2742-2763` | Live、Paper：`engine/klines.py` 自己读 `fapi/v1/klines` 写进临时 Catalog，再让原生 `request_bars` 从 Catalog 读：`engine/history.py:1-30`（`docs/plans/r1-runtime-contract-20261110.zh.md:250`）；`engine/klines.py` 的 `get_json` 没有重试，重试靠 `engine/history.py:159-160` 每 2 秒重来到期限 | 有理由的重复实现 | 理由：三条链路共用一条预热流程；原生请求失败无应答，无法在 T+45 秒内判超时，rc7 源码上成立。rc9 有“实时数据扰乱历史 K 线聚合器预热（#5469）”的修复（`RELEASES-rc9.md:164`），产品靠“T 之前订阅不到实时分钟线”回避，没有对应探针 |
| 实盘节点与 Binance 客户端：Paper 的行情与对账 | 同上 | Paper：只有带 checkpoint session 才开对账：`engine/paper.py:716`；`on_socket_state` 只记日志：`engine/paper.py:488-490` | 正确使用 | Paper 没有执行客户端，对账与 listenKey 问题不适用；数据端点与重连行为同 Live |
| 实盘节点与 Binance 客户端：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | 订单 ID、GTD、止损：`use_gtd=True` 默认走交易所侧 GTD，`BinanceExecutionClientConfig` 其余默认没有被产品意外改动（探针 1）；`recv_window_ms=5000` 与产品时钟限值 `CLOCK_BEHIND_MS=2500`、`CLOCK_AHEAD_MS=1000`（`engine/live_venue.py:28-30`，`crates/adapters/binance/src/config.rs:404-405`）；出口白名单与 rc7 的 URL 常量一致（`crates/adapters/binance/src/common/consts.rs:53,98-104`，`engine/egress.py:16`）；半开连接由 Nautilus 自己按三个心跳间隔（60 秒）重连（`crates/network/src/websocket/config.rs:170-183`）；`time_bars_build_delay` 单位（`crates/data/src/engine/config.rs:51-53`，`engine/history.py:42`）；取消全部的参数顺序与签名一致；`reconnect_socket` 的注册（数据端点有探针，用户流端点 `crates/adapters/binance/src/futures/websocket/streams/recovery.rs:104-107`）；信号（探针 2）；清理只清内存（`crates/live/src/python/config.rs`）；step6 已被取代；`with_reconciliation(True)` 后再被 `with_exec_engine_config(... reconciliation=True)` 整个替换，两处都是 True，那一行冗余（`engine/live_node.py:51-57`）；产品没有重造的功能：行情重连与重新订阅、listenKey 保活与轮换、在途订单检查、挂单与仓位周期对账、启动对账、账户事件清理 |
| 实盘节点与 Binance 客户端：没查的 | 汇总行 | 汇总行 | 不分类 | Binance 各接口的请求权重与 429、418 封禁时长（不在仓库，也不在 rc7 源码里，rc7 只有每请求一个令牌的限速 `BINANCE_FAPI_RATE_LIMITS` 2400 每分钟）；Redis 缓存是否真的“从不裁剪、每次启动整读”归缓存组件；`ExecutionAlgorithm.deny_order` 对没有经过该算法的订单的行为（只核对了 Python 绑定存在，没有重跑）；下单、撤单、改单在适配器里的完整路径归订单组；真实 Binance 行为（清算报文、listenKey 过期、429、418）需要凭证或真实连接；`docs/plans/live-continuous-step7a/7b/step8` 等其余 Live 设计文档没有读全文 |
| 缓存、消息总线与 Sandbox：`CacheConfig`（Paper） | nautilus_trader v2.0.0rc7：字段与默认值：`flush_on_start=false`、`use_trader_prefix=true`、`use_instance_id=false`、`tick_capacity`、`bar_capacity` 为 10000、`buffer_interval_ms=None`、`persist_account_events=true`、`save_market_data=false`：`crates/common/src/cache/config.rs:44-82` | Paper：`CacheConfig(use_instance_id=False, bar_capacity=...)`：`engine/paper.py:703`，其余默认；读回侧 `RedisCacheDatabase` 用同样的 `use_instance_id=False`、默认 trader 前缀：`engine/paper_redis.py:64-67` | 正确使用 | 键前缀 `trader-<id>`（`crates/infrastructure/src/redis/cache.rs:1205-1217`）读写两侧一致；`buffer_interval_ms=None` 在写任务里按 0 处理，每条命令立即排空（`crates/infrastructure/src/redis/cache.rs:676-690`）；探针 C8-config-defaults 印出实际默认值 |
| 缓存、消息总线与 Sandbox：`CacheConfig`（Live） | nautilus_trader v2.0.0rc7：同上；`flush_on_start` 仅在 `prepare_cache` 里读：`crates/live/src/node/mod.rs:2043`，为 false 才走 `load_cache`：`crates/live/src/node/mod.rs:2043-2063` | `CacheConfig(use_instance_id=False, flush_on_start=False, bar_capacity=...)` 加 `load_cache=True`：`engine/live_node.py:47-53`；trader_id 来自 manifest，续跑同一个 id | 正确使用 | `use_instance_id=False` 让重启后键不变 |
| 缓存、消息总线与 Sandbox：`persist_account_events` | nautilus_trader v2.0.0rc7：字段存在，但 `crates/` 全部非测试 `.rs` 里除配置结构与 Python 绑定外无读取，删除账户事件也是空操作：`crates/infrastructure/src/redis/cache.rs:640-644` | 产品没设 | 正确使用 | 在 rc7 里该开关是死字段，不设不影响（查了 `persist_account_events`） |
| 缓存、消息总线与 Sandbox：清理（purge），Live | nautilus_trader v2.0.0rc7：`LiveExecutionEngineConfig.purge_account_events_*` 只清内存：`crates/live/src/execution/manager.rs:3492-3505`、`crates/common/src/cache/mod.rs:2010-2030`；`purge_from_database` 有字段但 `crates/live/src` 里没有读取：`crates/execution/src/engine/config.rs:98` | 只设账户事件清理 60 分钟、24 小时回看，订单和持仓清理不设：`engine/live_node.py:52-57`，测试 `tests/engine/test_live.py:310-314` | 正确使用 | 产品注释“rc7 never trims Redis”成立。订单与持仓永不清、Redis 里账户事件列表只增不减：核实卡 L-19 判驳回（已知并有意保留） |
| 缓存、消息总线与 Sandbox：rc9 对数据库清理与持久化错误的改动 | nautilus_trader v2.0.0rc7：rc9 才让 `purge_from_database` 生效：`RELEASES-rc9.md:22,199`；rc7 里 `Cache::add_order` 把数据库入队错误向上返回：`crates/common/src/cache/mod.rs:2889-2891`，rc9 改为记日志继续：`RELEASES-rc9.md:84,172`；rc9 另有恢复订单 GTD 定时器与 Portfolio 保留恢复订单的修复：`RELEASES-rc9.md:184,181` | 产品设计依赖 `health()` 在存储故障时让运行停下：`engine/live_source.py:66`、`engine/live_lifecycle.py:125`；`engine/live_node.py:52-57` | 版本风险 | 升级后“数据库写不进去会让订单提交报错”这一层不复存在，只剩产品自己的 `health()` 探针。核实卡 L-12 判可能（只在升级 Nautilus 时相关，当前锁定版本不受影响；发布说明未逐行复核） |
| 缓存、消息总线与 Sandbox：Redis 缓存后端（Live） | nautilus_trader v2.0.0rc7：`RedisCacheConfig` 加 `with_cache_database_factory`：`crates/live/src/node/builder.rs:324`；落盘持久性由 Redis 服务负责；Nautilus 默认连接参数 20 秒、20 秒、100 次重试：`crates/infrastructure/src/redis/cache.rs:192-206` | 子进程 Redis，AOF always，自带 health 探针与锁存：`engine/live_cache.py`；连接参数 1 秒、1 秒、0 重试：`engine/live_cache.py:28-29`；`close()` 先 `node.dispose()` 再 SIGTERM Redis：`engine/live.py:270-290` | 正确使用 | 产品显式改为快速失败是对的；`close()` 先 `node.dispose()`（`crates/common/src/cache/mod.rs:2093-2100` 到 `crates/infrastructure/src/redis/cache.rs:379-404` 排空写队列）。健康探针一次 1 秒超时就永久锁存失败，运行随即平仓并以 unresolved 结束：核实卡 L-21 判可能（机制是事实且有意，敏感度没有数据）。写入经异步队列、SIGKILL 会丢已入队未写的几条，见下方行 |
| 缓存、消息总线与 Sandbox：Live 缓存写入的异步队列 | nautilus_trader v2.0.0rc7：无界通道加后台写任务，`buffer_interval_ms=None` 时每条命令立刻处理，但仍有“入队到发出”的窗口；连接错误只记日志：`crates/infrastructure/src/redis/cache.rs:668-700,760-830` | `appendfsync always` 只保证 Redis 已确认的命令落盘：`engine/live_cache.py:46`；产品把重试设为 0：`engine/live_cache.py:28-29`；`health()` 用另一条连接探测，探不到：`engine/live_cache.py:70-76` | 未验证的假设 | 产品自己的文档串承认观察的是后端当下，不是更早原生写入的完整性（`engine/live_cache.py:70-76`）；跨重启试验清单（`docs/plans/live-continuous-step4-resume-20261113.zh.md`，来源写的第 220-230 行超出文件长度，位置待核）里没有“SIGKILL 时刻正在提交订单”的用例。核实卡 L-20 判可能（无实跑证据，依据未复核） |
| 缓存、消息总线与 Sandbox：Redis 缓存后端（Paper）与 RDB 冻结点 | nautilus_trader v2.0.0rc7：原生有 Redis 缓存适配器（订单事件列表、仓位、账户事件）与 `load_cache`；原生没有与外部 journal 绑定的快照点：`save_state` 只在停止时调用一次：`crates/system/src/kernel.rs:863-880,975-990`；适配器 `drain_buffer` 里序列化与写错误只 `log::error`：`crates/infrastructure/src/redis/cache.rs:760-830`；Redis 读重建订单时丢 `liquidity_side`：`crates/infrastructure/src/redis/cache.rs:1676-1702` | `--save "" --appendonly no`，到切点时先 `cache.add` 一个唯一 marker，等同一条 FIFO 排空，`load_all()` 读回与属主对象逐项比对，再 `SAVE`，最后原子发布 RDB 加 manifest：`engine/paper_redis.py:86-163`、`engine/paper_checkpoint.py:97-120` | 有理由的重复实现 | 缓存读写本身用原生，自制的只是“切点”。理由在 rc7 成立：没有周期保存，适配器吞写错误所以只有读回比对才能证明写成功；#2882 的放宽与 `restore_open_order` 注释一致：`crates/execution/src/matching_engine/mod.rs:3470-3480` |
| 缓存、消息总线与 Sandbox：策略状态保存与载入 | nautilus_trader v2.0.0rc7：`Strategy.save`、`load` 到 `Trader::save_state`、`load_state`，只在 kernel 启动、停止各调一次：`crates/system/src/trader.rs:1578-1700`；`with_load_state(True)` 在原生 `strategy:` 键为空时不触发回调：`crates/system/src/trader.rs:1595-1610` | `with_save_state(False)`；用自己的 `strategy.save()` 字节随 marker 一起进缓存：`engine/paper_session.py:155-159`、`engine/paper.py:709`；`with_load_state(bool(saved))` 同时手工 `strategy.load`：`engine/paper_session.py:111-117` | 有理由的重复实现 | 原生保存发生在节点停止时，SIGKILL 或崩溃没有，也不与 journal 切点同屏障；`with_load_state(True)` 在键为空时等于空操作，无害 |
| 缓存、消息总线与 Sandbox：读回用的 Python `RedisCacheDatabase` | rc7 导出但 `.pyi` 里没有；rc9 删除它：`RELEASES-rc9.md:45` | `read`、`insert`、`load_all` 三个方法都在用：`engine/paper_redis.py:75,92,142,149`；注释：`engine/paper_redis.py:21-22` | 版本风险 | 升级到 rc9 会让 Paper 检查点读回整体失效（Paper 恢复被关闭），要另想办法；没有版本升级预检（查了 `RedisCacheDatabase`，只在 `engine/paper_redis.py` 和一个注释）。核实卡 L-12 判可能（只在升级时相关） |
| 缓存、消息总线与 Sandbox：Paper 读回的连接参数 | nautilus_trader v2.0.0rc7：默认 `connection_timeout=20`、`response_timeout=20`、`number_of_retries=100`、`max_delay=1000`：`crates/infrastructure/src/redis/cache.rs:192-206`；读回在 LiveNode 回调线程里会中止的断言：`crates/infrastructure/src/redis/cache.rs:649-661` | `RedisCacheConfig(host, port)` 只给 host、port，读写两侧均用默认：`engine/paper_redis.py:62-67`；快照由节点线程调用并同步等待 I/O 线程：`engine/paper_redis.py:104`；读回循环里每次 `reader.read` 没有超时：`engine/paper_redis.py:142-143`；`try_cut` 只捕获 `Refusal`：`engine/paper_session.py:103-109` | 用法错误 | Live 的同类配置显式用 1 秒、1 秒、0 重试（`engine/live_cache.py:28-29`）。探针 C8-redis-unreachable：在无服务端的回环端口上构造 `RedisCacheDatabase`，120 秒超时后仍未返回（退出码 124）。核实卡 L-17 写成时判可能（默认参数是事实，构造阶段已测，运行中的后果没测）。复核后按发现 20261114-34（X-02、L-17）改写，主证据是真实 Paper 运行：隔离 Paper 库上的审计运行 14（B1 F6a，`phaseB/B1/faults/F6-redis/timeline.txt`、`stop-14.json`、`sealed/14/events.jsonl`、`sealed/14/runner.log:71,98`），08:26:31Z 杀掉 runner 容器内的 Redis 子进程后，运行的事件日志不再前进、检查点不再更新（节点内部是否仍在处理行情没有证据；事件日志停在 08:26:00 的两条 bar，之后没有 bar、快照、订单，也没有拒绝记录），进程不退出，只有 runner 日志里的 `redis::cache: broken pipe` 与定时器回调的 `RuntimeError: broken pipe`；`paper stop` 实测 91 秒（STOP 文件 60 秒无响应、SIGTERM 30 秒无响应、SIGKILL）；封存 `status complete`、`reasons []`、`stop_reason KILLED`。旁证是执行镜像一次性容器里的 Redis 探针（C8r P3、P4，不是产品完整路径）：读回在 Redis 被挂起时 20 秒后抛 `RuntimeError`、被杀时立即抛；Redis 死后节点继续运行并继续成交、`node.dispose()` 不返回。两者现象不同（探针里节点继续跑，真实运行里不再处理事件），原因没有证实为同一机制 |
| 缓存、消息总线与 Sandbox：`MessageBusConfig` 与外部流 | 外部流、Redis 流、`types_filter` 等 | 产品完全不配置，没有外部消息总线；LiveNode 用默认内部总线 | 正确使用 | 查了 `MessageBus`、`msgbus`、`external_stream`、`streams_prefix`，范围 `engine/ shared/ paper/ live/ tests/ runtime/ .agents/ docs/rd/`，无命中；没有需要持久化的总线状态 |
| 缓存、消息总线与 Sandbox：Sandbox 与回测是不是同一个撮合引擎 | nautilus_trader v2.0.0rc7：`SandboxExecutionClientConfig::to_matching_engine_config`：`crates/adapters/sandbox/src/config.rs:129-155`；`ensure_matching_engine`：`crates/adapters/sandbox/src/execution.rs:996-1000`；回测交易所用同一个类型：`crates/backtest/src/exchange.rs:497` | Paper 把回放的 fill model、book type、bar_execution、bar 排序、合约参数照搬：`engine/paper.py:729-737` | 正确使用 | 同一个 `OrderMatchingEngine`，差别只在外围：Sandbox 有入站队列与时延模型（产品不用）、没有资金费、没有强平、有 `trade_execution`（默认 true；Paper 不推 trade：`engine/paper.py:34-35`）。撮合参数细节见撮合组 |
| 缓存、消息总线与 Sandbox：Sandbox 配置项 | nautilus_trader v2.0.0rc7：字段：`crates/adapters/sandbox/src/config.rs:40-170`；`fee_model` 必填：`crates/adapters/sandbox/src/execution.rs:142-148` | `starting_balances`、`base_currency`、`oms_type=HEDGING`、`account_type=MARGIN`、`default_leverage=leverage×0.1`、`book_type=L1_MBP`、`bar_execution`、`bar_adaptive_high_low_ordering`、`reject_stop_orders=False`、GTD 与 contingent 支持、`fill_model`、`fee_model`：`engine/paper.py:729-737`；其余用默认 | 正确使用 | 每个字段名与 Rust 结构一致；`default_leverage` 乘 0.1 的原因见仓位与账户组的杠杆（Paper）行（本次未复核）。`use_position_ids` 没设，默认 true（探针实测 `use_position_ids True`），而 Live 显式设 False（`engine/live_node.py:70`），这是下一行的前提 |
| 缓存、消息总线与 Sandbox：Sandbox 重启后的仓位 id（Paper 恢复） | nautilus_trader v2.0.0rc7：`IdsGenerator.position_count` 初值 0，只增不从缓存播种，id 形如 `{venue}-{raw_id}-{count}`：`crates/execution/src/matching_engine/ids_generator.rs:41-43,73,236-250`；`raw_id` 按“首次创建撮合引擎”的顺序分配：`crates/adapters/sandbox/src/execution.rs:996-1000,990-1018`；`get_position_id` 取到 id 后用 `cache.position(id)` 找现成仓位：`crates/execution/src/matching_engine/mod.rs:5189-5199`；执行引擎里已有 closed 的同 id 仓位走 `Action::Reopen`，不同合约撞 id 则 `validate_fill_for_position` 丢掉这笔成交：`crates/execution/src/engine/mod.rs:4614-4650,3764-3778`；rc8 修了“撮合引擎重启后为独立对冲订单复用仓位 id”：`RELEASES-rc9.md:519` | Paper 的 Sandbox 默认 `use_position_ids=true`，`oms_type=HEDGING`：`engine/paper.py:729-737`；Live 显式 `use_position_ids=False`，不受影响：`engine/live_node.py:70` | 用法错误 | 核实卡 L-15 确认（20261114-33）。这一行属于“依赖了 rc7 上有缺陷的原生行为”：上游在 rc8 把它当缺陷修掉（`RELEASES-rc9.md:519`，位于 rc8 一节）。复核后查清了原因并改写范围：出问题的是挂着的限价进场单（含 GTD），它的仓位号由 Sandbox 撮合引擎的生成器给出（`use_position_ids=True`，HEDGING 下先查 `cache.position_id(client_order_id)`，没有才生成：`crates/execution/src/matching_engine/ids_generator.rs:149-170`），计数每进程从 0 起；市价单的成交不经过这个生成器。Redis 探针 C8r P2 用市价进场，没走到这条路径，所以它“没有复现”不构成反证（独立复核 R2 的 `BacktestEngine` 探针 `review/R2-probes/p01_position_ids.py`、`p01b_position_ids_noids.py`：市价进场的仓位号是 `P-…`，两种设置相同；挂着的限价进场在 `use_position_ids=True` 下是 `BINANCE-1-n`，False 下是 `P-…`）。实测（审计隔离 Paper 库）：共 4 笔成交被丢。运行 3 两个合约空仓时 SIGKILL 后恢复，runner 日志两条 `instrument_id mismatch` 的 ERROR（`phaseB/B1/sealed/3/runner.log:425,427`），两张进场单的成交被丢，封存 `complete`、审计通过、无原因码；运行 5 SIGTERM 暂停后恢复，1 次仓位号复用并顶掉旧仓位记录（`sealed/5/runner.log:6,8`，走 `crates/execution/src/engine/mod.rs:4795-4809` 的“archiving closed cycle”一支），第二次恢复后又两笔成交被丢（`sealed/5/runner.log:1963,1965`），封存为 `AUDIT_FINDINGS`（6 条发现来自仓位号复用，对被丢的成交本身没有发现）。范围不限多合约：成交被丢一支要两个以上合约且引擎创建顺序变化；同合约撞到已平仓位的一支与合约数无关，单合约的审计运行已实跑（B1 F3c、F3d，运行 20、21）：不丢成交；恢复一次时旧仓位被归档成快照行保留，封存审计通过；连续恢复两次后最早一轮的仓位记录从仓位报告里消失，封存报 5 条对不上的发现。修法 `use_position_ids=False` 的旁证：上面的探针显示此时限价进场改由执行引擎的生成器给 `P-…`，C8r P2 显示这个生成器的计数跨重启延续；仍需在产品路径上用限价进场加重启验证一次。当前候选没声明恢复协议，现在碰不到。无 `use_position_ids`、`raw_id` 的测试（查了 `position_id`、`use_position_ids`、`raw_id`、`reus`） |
| 缓存、消息总线与 Sandbox：Sandbox 账户初始化 | nautilus_trader v2.0.0rc7：`connect()` 用 `config.starting_balances` 生成 AccountState（free 等于 total、locked 为 0、无保证金）：`crates/adapters/sandbox/src/execution.rs:701-708,560-566`；`get_current_account_balances` 只在 `query_account` 用：`crates/adapters/sandbox/src/execution.rs:413-421,828-832` | 恢复时把 `starting_balances` 设成检查点的 `balance_total`，并开 `with_reconciliation(True)` 让 `initialize_positions` 重建保证金：`engine/paper.py:711-721` | 未验证的假设 | rc7 行为与 `docs/plans/paper-native-recovery.zh.md:27,63-64` 描述一致；带仓加保证金路径只有仓库外的临时探针，仓库里没有；`tests/engine/test_paper_*.py` 查了 `starting_balances`、`balance_total`，只有单测级 mock，没有走 `LiveNode`。已知局限写在 `docs/plans/paper-native-recovery.zh.md:119`（仅正常停机、无工作单） |
| 缓存、消息总线与 Sandbox：Sandbox 对账接口 | nautilus_trader v2.0.0rc7：`generate_*_reports` 返回空，`generate_mass_status` 返回空对象：`crates/adapters/sandbox/src/execution.rs:841-897`；空 mass status 下对账只是触发 `initialize_orders`、`initialize_positions`：`crates/live/src/node/mod.rs:1039-1040` | Paper 恢复开 `reconciliation=True`，其余 `LiveExecutionEngineConfig` 用默认：`engine/paper.py:721` | 正确使用 | 与 `docs/plans/paper-native-recovery.zh.md:87` 的说法一致；默认的 `inflight_check_interval_ms=2000`、`open_check_interval_secs=None`、`position_check_interval_secs=None`（`crates/live/src/node/config.rs`）对 Sandbox 的影响属执行引擎组，未查 |
| 缓存、消息总线与 Sandbox：Sandbox 恢复挂单（原生功能） | nautilus_trader v2.0.0rc7：`load_open_orders`、`restore_open_order` 从缓存读本 venue、本账户、非 emulated 的 open orders，保留 Accepted、PartiallyFilled、Triggered 状态：`crates/adapters/sandbox/src/execution.rs:638-660,946-988`、`crates/execution/src/matching_engine/mod.rs:3455-3498`；顺序是 `prepare_cache` 在客户端 start 之前：`crates/live/src/node/mod.rs:446-455` | 产品不依赖：Paper 检查点要求缓存里没有任何非终态订单：`engine/paper_session.py:142-143,177-181`（测试 `tests/engine/test_paper_session.py:65-72`）；没声明 `PAPER_RECOVERY=1` 的策略完全不可恢复：`engine/paper_session.py:37-38`、`engine/README.md:503` | 未验证的假设 | 带 reduce-only 止损的仓位重启后止损还在不在，产品没有恢复过，也没有原生探针；原生源码上说得通。查了 `restore_open_order`、`load_open_orders`、`reduce_only.*recover`（`tests/`）与 `止损.*恢复`、`stop.*resume`（`docs/plans/`）无命中；`docs/plans/paper-native-recovery.zh.md:71` 自述“未在本机执行”。核实卡 L-14 判可能：拒绝是已知并有意的，新的只有技能没告知这一协议（独立复核后列入契约不一致 20261114-42） |
| 缓存、消息总线与 Sandbox：Sandbox 的资金费 | nautilus_trader v2.0.0rc7：回测交易所有原生资金费结算：`crates/backtest/src/exchange.rs:1179-1191`；Sandbox 没有（订阅只有 deltas、quotes、trades、bars、status、close、position：`crates/adapters/sandbox/src/execution.rs:200-270`） | Paper 的 journal 记每个结算，封存时 `ledger/paper.py:265-286` 按交易所公布的利率和 MARK 重算 | 有理由的重复实现 | rc7 源码上 Sandbox 确实不处理；rc8、rc9 对 Sandbox 的条目（`RELEASES-rc9.md:41,133,189,337,567`）没有资金费，理由在 rc9 仍成立。运行中 Sandbox 账户余额不含资金费，核实卡 L-18 判驳回（已知并有意保留；残余一句解读提示） |
| 缓存、消息总线与 Sandbox：Live 的执行客户端 OMS | Binance 执行客户端 `use_position_ids` | `oms_type=HEDGING, use_position_ids=False`，UUID client order id：`engine/live_node.py:70`、`engine/README.md:559` | 正确使用 | 本地虚拟仓位加 UUID 订单号，避开了 Sandbox 的 id 计数器重启问题和 `OrderFactory` 计数器重启后撞 id（`crates/common/src/cache/mod.rs:2787-2794` 同 id 会报错） |
| 缓存、消息总线与 Sandbox：Paper 的 OrderFactory 计数器 | nautilus_trader v2.0.0rc7：无持久化；计数器重启后撞 id 会报错：`crates/common/src/cache/mod.rs:2787-2794` | 两个计数器随 marker 保存、恢复后写回：`docs/plans/paper-native-recovery.zh.md:135`、`engine/paper_session.py:84`（测试 `tests/engine/test_paper_session.py:84`） | 有理由的重复实现 | `Strategy.save` 不会自动存 Python 属性（探针见 `docs/plans/paper-native-recovery.zh.md:29`）；rc9 另有“自动订单号 tag 删除后冲突”的修复（`RELEASES-rc9.md:193`），不影响此设计 |
| 缓存、消息总线与 Sandbox：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | Paper 读写两侧的键前缀一致（`engine/paper.py:703`、`engine/paper_redis.py:64-67`，`crates/infrastructure/src/redis/cache.rs:1205-1217`）；Live 启动顺序 `prepare_cache` 到 `load_cache` 到客户端 start 到对账到 `start_trader`（`crates/live/src/node/mod.rs:446-455,528,543`）；Live 缓存目录续跑缺 AOF 直接拒绝，不开空缓存（`engine/live_cache.py:39-40`，`tests/engine/test_live_cache.py:24`）；Live 关闭顺序先 `node.dispose()` 再终止 Redis，不 SIGKILL（`crates/infrastructure/src/redis/cache.rs:379-404`，`engine/live_cache.py:103-111`）；Live `appendfsync` 变更检测、AOF 可写检测与写探针（`engine/live_cache.py:70-92`，`tests/engine/test_live_cache.py:30-96`）；`persist_account_events`、`purge_from_database`、账户事件删除在 rc7 里无效，产品没依赖；产品没使用 `event_store`（`crates/live/src/python/config.rs:1215` 固定 `None`，Python 层无入口）；Sandbox 与回放用同一个 `OrderMatchingEngine`，`fill_model`、`fee_model` 由回放同一函数构造（`engine/paper.py:735-737`、`engine/fill.py`）；Paper 切点的 `liquidity_side` 放宽与 `restore_open_order` 的注释和 Redis 事件列表重建一致（`crates/execution/src/matching_engine/mod.rs:3470-3480`，`crates/infrastructure/src/redis/cache.rs:1676-1702`）；Paper 读回在 LiveNode 回调线程里会中止的断言与 `blocking_recv` 注释一致（`crates/infrastructure/src/redis/cache.rs:649-661`），产品改成单独 I/O 线程有依据 |
| 缓存、消息总线与 Sandbox：没查的 | 汇总行 | 汇总行 | 不分类 | Binance 条件单（algo orders）在 rc7 适配器的对账里是否进入 mass status（产品自己的账户观察单独读 `algo_orders`：`engine/live_venue.py:162`）；Paper 的 `inflight_check` 对 Sandbox 空状态报告的影响，以及 rc9 的“Sandbox 的 open-order 检查误拒绝挂单”（`RELEASES-rc9.md:337`）；Sandbox 保证金与杠杆的 0.1 因子数学；策略是否读取账户余额；运行镜像里 Redis 的版本与编译选项；Live 对账窗口 `reconciliation_lookback_mins` 未设的耗时与限频；所有需要 Redis 的探针（P-C、P-E、P-F、P-G，本机无 `redis-server`，起 Docker 超出边界） |
| 指标、K 线聚合、时钟、报告：时间 bar 聚合（`5-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL`） | nautilus_trader v2.0.0rc7：`TimeBarAggregator`，由时钟定时器在桶边界触发 `build_bar`：结构与构造 `crates/data/src/aggregation.rs:1496-1608`，启动定时器 `crates/data/src/aggregation.rs:1609-1733`，`build_bar` `crates/data/src/aggregation.rs:1735-1797`；配置项：`crates/data/src/engine/config.rs:33-62`；回放里 `VirtualClock` 的推进：`crates/data/src/aggregation.rs:1799-1846` | 三条链路都用原生聚合，产品没有自己聚合 bar：回放 `engine/run.py:811-818`，Paper `engine/paper.py:694-697`，Live `engine/live_node.py:36-39`；`engine/klines.py` 只取历史，不聚合 | 正确使用 | 回放探针 C9-1：5 分钟 bar 在时钟等于 T 时交给策略，位于桶内最后一根 1 分钟 bar 之后，不等下一根数据（`ts_event=300.0`，最后一根分钟 bar `299.999`）；已核对 `crates/data/src/aggregation.rs:1735-1745` |
| 指标、K 线聚合、时钟、报告：Paper、Live 里日线（及更高周期）聚合的收盘时刻 | nautilus_trader v2.0.0rc7：日线是 86400 秒定长定时器：`crates/data/src/aggregation.rs:1678-1689`，收盘由 Rust 定时器在桶边界加 `time_bars_build_delay` 触发 | Paper、Live 不重新对齐、检测或记录日线送达时刻：`engine/paper.py:697`、`engine/live_node.py:39`、`engine/history.py:42`（查了 `native_daily`、`drift`、`skew`，范围 `engine paper live ledger replay report cli`，只命中无关项） | 未验证的假设 | 产品依赖“聚合 bar 在桶边界后 5 秒交付”，仓库里没有对应的原生探针或测试。核实卡 T-01 确认（20261114-30）：收盘由单调时钟上的定长定时器决定（`Fixed` 用 `interval_at`：`crates/common/src/live/timer.rs:463-471`）。复核后把触发条件说准：单调时钟本身停走的暂停（主机休眠、VM 被暂停，Docker Desktop 的 Linux VM 属此类）之后边界漂移；进程被停住而单调时钟照走时（SIGSTOP、长 GC、宿主在跑的 `docker pause`），定长 interval 会补发错过的 tick，相位不变，只是那一根晚到（后一半是读源码与 tokio 默认行为的推断，没有探针）。远程 Linux 主机上前一类暂停是否发生没有记录。产品没有针对聚合 bar 送达时刻的检测；证据是旧代码运行读数，当前镜像尚无实测 |
| 指标、K 线聚合、时钟、报告：`time_bars_timestamp_on_close`、`skip_first_non_full_bar`、`validate_data_sequence` | nautilus_trader v2.0.0rc7：同上配置：`crates/data/src/engine/config.rs:33-62`；rc7 `build_bar` 在 LeftOpen 加 `timestamp_on_close` 下 `ts_event = event.ts_event`：`crates/data/src/aggregation.rs:1735-1752`；`validate_data_sequence` 只丢 ts_event 或 ts_init 早于上一根的 bar：`crates/data/src/engine/dispatch.rs:471-495` | 三处都取 `ACCOUNT_CONTRACT`：`engine/config.py:140-142`，值为 True、False、True | 正确使用 | 探针 C9-1 的 `ts_event=300.0` 与此一致；同值不丢 |
| 指标、K 线聚合、时钟、报告：`time_bars_build_delay` 与聚合 bar 的时刻差 | nautilus_trader v2.0.0rc7：聚合在边界后再等 N 微秒：`crates/data/src/aggregation.rs:1540,1631-1633` | 回放不设（0）；Paper、Live 设 `history.BUILD_DELAY_US=5_000_000`：`engine/history.py:42`、`engine/paper.py:697`、`engine/live_node.py:39` | 正确使用 | 理由见 `engine/history.py:39-41`、`engine/README.md:100-102`（Binance 的最后一根分钟 bar 在桶结束后到，试验里最长 0.47 秒）。探针 C9-8：延迟只有 5 秒，晚于 5 秒到的分钟 bar 进下一个桶，核实卡 T-05 判可能（机制已探针重跑证实，真实触发概率无证据）。回放里聚合 bar 的 `ts_event=T`，Paper、Live 为 T 加 5 秒，对在聚合 bar 上读 `bar.ts_event` 做时间判断的源码有影响，技能已提示，对填单无影响 |
| 指标、K 线聚合、时钟、报告：`time_bars_build_with_no_updates`、`time_bars_interval_type` | nautilus_trader v2.0.0rc7：默认 True、LeftOpen：`crates/data/src/engine/config.rs:37-50` | 三处都没设，靠默认值：`engine/config.py:140-142`、`engine/run.py:814-818` | 正确使用 | 探针 C9-2：数据缺 10 分钟时，空桶照样出一根 `volume=0`、OHLC 全等于上一收盘的 5 分钟 bar（`ts_event=600.0`）。C9 原判未验证的假设（依赖默认值且没写进文档）；核实卡 T-14 判已覆盖：“1 分钟数据有缺口时照样送”是有意取舍（`docs/plans/r1-runtime-contract-20261110.zh.md:80`），事前事实在 `market coverage`。查了 `build_with_no_updates`、`flat`、`零成交`、`zero-volume`（`engine/ docs/plans docs/rd .agents tests`），只有 `docs/plans/r1-runtime-contract-20261110.zh.md:111` 讲零成交分钟的桶，没提空桶出合成 bar |
| 指标、K 线聚合、时钟、报告：1 分钟 LAST EXTERNAL bar 的来源 | nautilus_trader v2.0.0rc7：回放：Catalog。Paper、Live：Binance 适配器订阅 `{symbol}@kline_1m`，只在 `is_closed` 时产出 bar，`ts_event = close_time`、`ts_init = 接收时刻`：`crates/adapters/binance/src/futures/data.rs:1726-1751`、`crates/adapters/binance/src/futures/websocket/streams/parse_data.rs:473-524` | 回放：`market/export.py:176-190` 写 `ts_event=ts_init=ts_open+1 min-1 ms`；Paper、Live：不自己订阅 WebSocket，策略和 `Recorder`、`WarmupActor` 用原生 `subscribe_bars`：`engine/paper.py:481`、`engine/history.py:308-311` | 正确使用 | `ts_event` 约定三处一致；内容是否一致由 `replay/comparison.py:346-372` 事后核对（missing、late、differing）。适配器只在 `is_closed` 时出 bar，策略收到的是已收盘 K 线 |
| 指标、K 线聚合、时钟、报告：零成交分钟的收盘 kline、WebSocket 终值与归档终值、重复推送（真实交易所） | nautilus_trader v2.0.0rc7：适配器解析：`crates/adapters/binance/src/futures/websocket/streams/parse_data.rs:479,506`；数据引擎对相同 ts_event 的分钟 bar 不去重（`validate_data_sequence` 只拦倒序：`crates/data/src/engine/dispatch.rs:471-495`） | Live：`engine/live_connection.py:311-329` 只对 1 分钟 EXTERNAL 判相邻缺口；重复 ts_event 不被丢弃 | 未验证的假设 | 零成交分钟 Binance 是否推收盘 kline 没有证据；离线无法复现 LiveNode 的真实 WebSocket 路径。核实卡 T-15 判可能（机制在源码里成立，有 11,000 个 bar 的反面样本，没有触发证据） |
| 指标、K 线聚合、时钟、报告：`request_bars` 历史预热 | nautilus_trader v2.0.0rc7：数据引擎在注册了 Catalog 时走 `dispatch_date_range_request`：`crates/data/src/engine/mod.rs:1148-1156`；带 `bar_types` 加 `update_subscriptions` 的请求把 1 分钟历史灌进聚合器，聚合器键与实时订阅同一个：`crates/data/src/engine/requests.rs:43-56,314`、`crates/data/src/engine/bar.rs:104-225` | 三链路同一套：`engine/history.py:190-209` 发请求，`engine/history.py:285-290` 的 `warm` 带 `update_subscriptions: True`、`skip_first_non_full_bar: False`；源码的 `on_historical_bars`、`on_start` 被推迟到预热完成：`engine/strategy.py:63-68` | 正确使用 | 回放测试 `tests/engine/test_warmup.py:141-165` 证明首根聚合 bar 完整；`docs/plans/r1-runtime-contract-20261110.zh.md` 第 2 节是 rc7 的原生探针。LiveNode 路径只有试运行记录，没有自动测试（查了 `LiveNode`、`BUILD_DELAY`、`build_delay`，范围 `tests/`：只有 `BacktestEngine` 里的 `WarmupActor(live=True)`），核实卡 T-19 判可能（事实成立，当前无后果）。回放首根聚合 bar 在桶开头缺数据时残缺，核实卡 T-14 判已覆盖 |
| 指标、K 线聚合、时钟、报告：预热与聚合在 rc8、rc9 的改动 | rc8 加了 `on_data_response` 对部分失败的钩子：`RELEASES-rc9.md:404`；rc9 修“实时数据扰乱历史 K 线聚合器预热（#5469）”：`RELEASES-rc9.md:164`；rc9 “历史时间 bar 同时间戳边界”“回测定时器跨数据空洞取消” | 预热依赖 rc7 的请求聚合内部语义：`engine/history.py:190-209,285-290` | 版本风险 | 核实卡 T-13 判可能（只在升级时相关，当前锁定版本不受影响）：产品靠“T 之前订阅不到实时分钟线”回避，没有对应探针 |
| 指标、K 线聚合、时钟、报告：Paper、Live 的历史来源（`engine/klines.py` 与 `history.fetch`） | nautilus_trader v2.0.0rc7：`BinanceFuturesDataClient.request_bars` 经 HTTP 取 kline：`crates/adapters/binance/src/futures/data.rs:2716-2767`；失败时只 `log::error!("Bar request failed")` 且不发响应：`crates/adapters/binance/src/futures/data.rs:2762` | 产品自己用 `urllib` 取 `fapi/v1/klines`，写进临时 Catalog，再让原生去请求：`engine/history.py:76-107`、`engine/klines.py:34-55`；取数线程重试网络错误、`SETTLE_NS` 15 秒、`DEADLINE_NS` 45 秒、逐根核对 `expected`：`engine/history.py:111-119,211-226` | 有理由的重复实现 | 原生请求不重试、不等 kline 定稿（产品实测收盘后 5 至 10 秒内还会变，`docs/plans/r1-runtime-contract-20261110.zh.md:251`）、无超时，三条理由在 rc7 成立。rc8 的 `on_data_response` 钩子使“失败可见”弱化，15 秒定稿等待和逐根相等仍成立 |
| 指标、K 线聚合、时钟、报告：回放的非 1 分钟、日线历史（`warmup.derive`） | nautilus_trader v2.0.0rc7：无。Catalog 里没有这些周期，Nautilus 没有“从分钟 bar 写出外部周期 bar”的函数，只有实时聚合器；原生聚合器 `update_bar` 把零成交分钟算进开盘与高低：`crates/data/src/aggregation.rs:296-330` | `engine/warmup.py:85-107`：按市场的日线规则（有成交分钟的开盘、高低、末收盘、成交量总和）派生，写临时 Catalog | 有理由的重复实现 | 理由在 `docs/plans/r1-runtime-contract-20261110.zh.md:104-111`：派生与 Binance 同周期 kline 逐根相同（358 根、26,524 根），原生聚合在含零成交分钟的桶里差一个价位（8 根每 14,879 根）。理由成立 |
| 指标、K 线聚合、时钟、报告：策略时钟的受守卫 API（`set_timer`、`set_time_alert` 等） | nautilus_trader v2.0.0rc7：回测用 `VirtualClock`，同时刻事件按（`ts_event`，名字，`ts_init`，事件 ID）排序：`crates/common/src/timer.rs:388-394`；`allow_past` 默认 True：`crates/common/src/clock/mod.rs:130,405` | 产品包装策略的 `clock`：`engine/strategy.py:269-300`（`GuardedClock`），受保护的 API：`set_timer`、`set_timer_ns`、`set_time_alert`、`set_time_alert_ns`、`register_default_handler`；运行器自己的定时器 `runner-warmup`、`runner-warmup-wait`（`engine/history.py:134-147`）、`paper-stop`（`engine/paper.py:470`）、`live-observe`（`engine/live_lifecycle.py:67`） | 正确使用 | 同刻定时器按名字排序，产品自己的定时器名都是小写开头，排在 `TIME_BAR_` 之后；`allow_past` 默认 True，`Warming.on_start` 的“检查再设闹钟”之间没有竞态问题 |
| 指标、K 线聚合、时钟、报告：`set_timer_zoned` 注册的回调 | nautilus_trader v2.0.0rc7：`set_timer_zoned(name, interval, start_time, stop_time, callback, ...)`，回调在第 5 位：`python/nautilus_trader/common/__init__.pyi:673-682`；签名与日历调度的建立：`crates/common/src/clock/api.rs:377-396`、`crates/common/src/python/clock.rs:306-330`；Python 回调抛异常时原生只记一行 ERROR 然后继续：`crates/common/src/timer.rs:208-211` | `CLOCK_CALLBACK_APIS` 没有它，`GuardedClock` 不包装这条路径：`engine/strategy.py:269-300` | 用法错误 | 产品的包装漏了这个 API。探针 C9-4：同样抛异常的回调，经 `set_timer` 注册留下 `('set_timer:boom','ValueError',46)` 的失败记录，经 `set_timer_zoned` 注册只在 stderr 打 ERROR，`FAILURES` 为空。核实卡 T-07 确认（C9-1）；“原生吞掉的回调错误只落日志”泛化为可能 |
| 指标、K 线聚合、时钟、报告：策略与数据引擎的时钟隔离 | 聚合器的定时器在数据引擎的时钟里，不在策略的时钟里 | 源码拿到的是 `GuardedClock` 包的策略自己的时钟：`engine/strategy.py:269-300` | 正确使用 | 探针 C9-5：源码调 `self.clock.cancel_timers()` 或 `cancel_timer("TIME_BAR_...")`，收到的 5 分钟 bar 数不变（563 根），`timer_names()` 恒为空 |
| 指标、K 线聚合、时钟、报告：同一时刻的定时器与数据事件先后 | nautilus_trader v2.0.0rc7：回放里同时刻的 MARK、bar、用户定时器、聚合定时器的次序由引擎推进规则和 `cmp_time_events` 决定：`crates/common/src/timer.rs:388-394`；Live 用真实时钟，没有这个保证：`LiveNode.run` 自己的事件循环在 `crates/live/src/node/mod.rs:1838-1941`，`select!` 分支带 `biased`，次序是定时事件、系统事件、执行事件、执行命令、数据事件、数据命令（`crates/live/src/runner.rs:440-476` 是独立的 `AsyncRunner::run`，产品走不到） | 产品没有处理，也没有文档 | 未验证的假设 | 探针 C9-9：用户 alert 设在 T 减 1 ms 时，回放顺序是 MARK、bar、alert；探针 C9-3：alert 设在 T，名字取 `A0` 排在聚合定时器前则 alert 先于 5 分钟 bar，取 `a0` 则在其后；Live 里聚合 bar 在 T 加 5 秒。核实卡 T-06 确认（20261114-35；对使用定时器的策略；对当前候选无影响；回放探针，Live 次序为源码推断；技能只写了回放这一半）。`biased` 只决定同时就绪时的先后，定时器与约 0.1 至 1 秒后才到的 K 线之间本来就按到达先后 |
| 指标、K 线聚合、时钟、报告：MARK 与资金费的节奏 | nautilus_trader v2.0.0rc7：MARK 流 `@markPrice@1s`，MARK、指数价、资金费共用一个流，按引用计数订阅：`crates/adapters/binance/src/futures/data.rs:1766-1830` | `engine/cadence.py:17-24`：每分钟第一个 MARK 通过；回放的 MARK 是 MARK 价分钟线的收盘，打在 T 减 1 ms：`market/export.py:200-220` | 未验证的假设 | 回放 MARK 在 T 减 1 ms 且先于同刻 bar；Live 是 T 之后第一秒内的第一个 MARK，与收盘 kline 先后不定。`.agents/skills/research-round/references/strategy-authoring.md:77-79` 只写了回放的次序。核实卡 T-06 确认（Live 次序为源码推断） |
| 指标、K 线聚合、时钟、报告：1 日及 8、12 小时桶 | nautilus_trader v2.0.0rc7：UTC 对齐：`time_bars_time_zone` 默认 UTC：`crates/data/src/engine/config.rs:51` | 无特别处理 | 正确使用 | Binance 的 kline 同样 UTC 对齐；产品对 3m、5m、15m、1h 的逐根核对在 `docs/plans/r1-runtime-contract-20261110.zh.md:104-111`，未核对 8h、12h，1d（见没查的） |
| 指标、K 线聚合、时钟、报告：报告生成（`ReportProvider.generate_*_report`） | nautilus_trader v2.0.0rc7：纯 Python，pandas：`python/nautilus_trader/analysis/reporter.py:56-194` | 回放用 `BacktestEngine` 的报告：`engine/report.py:260-262`；Paper 终了与 Live 证据用 `ReportProvider` 直接生成：`engine/report.py:235-246`，同一个 `write_reports` 写 CSV：`engine/report.py:220-232` | 正确使用 | `tests/engine/test_live_evidence.py` 断言缓存报告与回放报告逐字节相同（`docs/plans/live-evidence-pack-20261110.zh.md:55`） |
| 指标、K 线聚合、时钟、报告：夏普（镜像内） | nautilus_trader v2.0.0rc7：`SharpeRatio(period).calculate_from_returns`：按 UTC 日复利合并，样本标准差，乘根号 period：`crates/analysis/src/statistics/sharpe_ratio.rs:73-90`、`crates/analysis/src/statistic.rs:122-148` | 镜像内 `summary_statistics` 用原生类：`engine/report.py:175` | 正确使用 | 探针 C9-6：N=30、365、1096 的随机日收益上，原生与 `measures.sharpe_365` 差不超过 3e-15 |
| 指标、K 线聚合、时钟、报告：夏普（账本侧） | nautilus_trader v2.0.0rc7：同上：`crates/analysis/src/statistics/sharpe_ratio.rs:73-90`；原生没有 Lo 与去膨胀夏普 | 账本侧 `report/measures.py:144-149` 自己算 | 有理由的重复实现 | 账本要对每次运行重算、对任意子窗口、加 Lo 与去膨胀夏普（原生没有）；两者公式相同。`.agents/skills/nautilus-report-analysis/references/ratios.md:3-10` 要求用原生类；自算这一条没有单独的决策记录（查了 `PortfolioAnalyzer`、`MaxDrawdown`、`SharpeRatio`，范围 `docs/plans docs/rd engine/README.md .agents/skills`：只有技能与评测提到原生类，没有解释账本为何自算） |
| 指标、K 线聚合、时钟、报告：年化收益 | nautilus_trader v2.0.0rc7：`CAGR(period)` 按非空日 bin 数年化：`crates/analysis/src/statistics/cagr.rs:71-97` | `engine/report.py:168-172` 与 `report/measures.py:137-142`：`(终值/初值)^(365/窗口天数)-1`，窗口天数取精确值 | 有理由的重复实现 | 探针 C9-6：整日窗口两者相同；窗口从日中起算时（100.5 天）产品 0.22606 与 CAGR 0.22731 不同，产品按真实天数更贴近“年化”。理由写在 `summary_statistics` 文档串：`engine/report.py:156-160`；没有单独决策记录 |
| 指标、K 线聚合、时钟、报告：最大回撤 | nautilus_trader v2.0.0rc7：`MaxDrawdown.calculate_from_returns`，在日收益序列上：`crates/analysis/src/statistics/max_drawdown.rs:67-96` | `ledger/metrics.py:682-695` 的 `mark_drawdown`：K 线收盘的 MARK 权益路径（账户总额加敞口表的未实现盈亏：`ledger/metrics.py:600-625`） | 有理由的重复实现 | 原生版只看日收益，看不到日内回撤；用户目标是最大回撤，产品取分钟级路径（`docs/plans/new-ledger-redesign-20261110.zh.md:196`）。`engine/README.md:322-327` 的理由“rc3 里 5 分钟定时器让很多挂单的运行慢 10 倍”是 rc3 的数字，rc7 上没复测；没找到把原生 `MaxDrawdown` 与产品回撤比较的文档或测试 |
| 指标、K 线聚合、时钟、报告：`PortfolioAnalyzer`、`create_tearsheet_from_stats` | 有 | 产品只在技能里引用（`nautilus-report-analysis`），不在 `engine/ report/ ledger/` 里用（查了 `PortfolioAnalyzer`、`create_tearsheet`，范围 `engine report ledger replay cli live paper`：无命中） | 正确使用 | 按产品规则：研究侧从 `tables()` 取日收益再用原生类 |
| 指标、K 线聚合、时钟、报告：内置指标库 | `nautilus_trader.indicators` | 允许导入：`engine/load.py:48`；产品不管指标，只给 `WARMUP` 与 `on_historical_bars`；`request_bars`、`register_indicator_for_bars` 类调用被禁：`engine/strategy.py:42-45` | 正确使用 | 技能 `.agents/skills/research-round/references/strategy-authoring.md:85-95` 讲收敛期；指标在三处按相同 bar 序列更新由三处 bar 序列相同决定 |
| 指标、K 线聚合、时钟、报告：日志配置 | `LoggerConfig(stdout_level, print_config)` | 三处都 `stdout_level=WARNING`、`print_config=False`，无文件日志：`engine/run.py:811`、`engine/paper.py:720`、`engine/live_node.py:46` | 未验证的假设 | 原生 ERROR 与 WARN 行只落在容器 stdout 与 stderr；查了 `\[ERROR\]`、`ERROR`，范围 `engine replay cli paper live ledger report` 的 `.py`，没有扫描日志判定运行的代码，原生未抛到 Python 的错误不会让回放失败。核实卡 T-07 把这一泛化判为可能 |
| 指标、K 线聚合、时钟、报告：数据丢失与迟到的检测 | nautilus_trader v2.0.0rc7：`Bar` 没有序号；`validate_data_sequence` 只拦倒序：`crates/data/src/engine/dispatch.rs:471-495` | Live：`engine/live_connection.py:311-329` 只对 1 分钟 EXTERNAL 判相邻缺口，缺口则 `bars_missing` 关入场（重新预热）；Paper：`Recorder.on_bar` 记 `data_gap`、`late_bar`（`LATE_BAR_NS=2 s`）：`engine/paper.py:496-508`；事后 `replay/comparison.py:346-372` | 正确使用 | 缺口只在下一根分钟 bar 到时才发现，聚合 bar 在桶后 5 秒就交给策略（核实卡 T-05 判可能）。Paper 缺根只记日志、Live 关入场并重启，核实卡 T-03 判已覆盖（`replay/comparison.py:521-545`）。Paper 不检测本地时钟与 Binance 的偏差，核实卡 T-04 判可能（机制与旧运行读数成立，当前代码不受影响） |
| 指标、K 线聚合、时钟、报告：报告比对 `engine/compare_reports.py` | 无 | 产品自有（语义比较，UUID 掩码）：`engine/compare_reports.py:1-21` | 正确使用 | 信任边界，Nautilus 不提供等价物；文档串说明 Nautilus 无稳定标识 |
| 指标、K 线聚合、时钟、报告：查过无问题的点 | 汇总行 | 汇总行 | 不分类 | 聚合触发方式（回放里聚合 bar 在时钟等于 T 由定时器交付，不依赖下一根数据：`crates/data/src/aggregation.rs:1735-1752,1799-1846`）；回放首根聚合 bar 完整（`tests/engine/test_warmup.py:141-165`）；1 分钟 bar 的 `ts_event` 约定三处一致（`crates/adapters/binance/src/futures/websocket/streams/parse_data.rs:506`、`market/export.py:176-190`、`engine/klines.py:50-53`）；适配器只在 `is_closed` 时出 bar（`crates/adapters/binance/src/futures/websocket/streams/parse_data.rs:479`）；更高周期全部用 Nautilus 聚合器，产品只对回放历史用 `warmup.derive`；`allow_past` 默认 True（`crates/common/src/clock/mod.rs:130,405`）；同刻定时器按名字排序，产品定时器名排在 `TIME_BAR_` 之后（`crates/common/src/timer.rs:388-394`）；`time_bars_skip_first_non_full_bar=False` 三处一致（`engine/history.py:290`）；缓存容量 `bar_capacity` 取声明根数加 1440（`engine/history.py:325-327`，`engine/run.py:813`，`engine/paper.py:703`，`engine/live_node.py:48`）；夏普与年化与原生一致（探针 C9-6）；日收益逐日齐全并复利到最终权益（`ledger/metrics.py:557-577` 的 `RETURN_COMPOUNDING_MISMATCH`）；报告生成与比对（`engine/report.py:220-232`、`engine/compare_reports.py`）；晚到分钟 bar 的事后检测（`replay/comparison.py:346-372`）；数据引擎对 EXTERNAL 订阅按引用计数保留（`crates/data/src/engine/mod.rs:975-990`，未做运行时探针，凭读源码） |
| 指标、K 线聚合、时钟、报告：没查的 | 汇总行 | 汇总行 | 不分类 | `LiveNode` 的真实 WebSocket 路径（零成交分钟、终值差异、MARK 先后、重复 kline）没有网络，行为放在探针提案；8 小时、12 小时、1 日聚合桶与 Binance 对应 kline 的逐根一致性（需要真实月数据）；回放 `time_bars_origin_offset`、`time_bars_time_zone` 非默认值（产品不使用）；`engine/README.md:322-327` 中“rc3 里 5 分钟定时器使运行慢 10 倍”在 rc7 上是否仍成立（没做性能测量，若不成立，`capital_observer` 就是对原生定时器能力的可替换重复实现，属成本问题）；`Strategy.unsubscribe_bars` 路径（`engine/paper.py:275-278`）上是否会误断共享流（只读了 `crates/data/src/engine/mod.rs:1041-1100`、`crates/data/src/engine/bar.rs:332-390`）；指标库本身的收敛与一致性；`live_evidence.py` 之外的 Live 报告路径 |

## 核实卡

每条发现、待证实和已覆盖条目背后的核实卡（现状、已有机制排查、依据、本产品上的证据、影响、修法、结论七项）在审计工作目录：

| 簇 | 文件 | 卡数 |
|---|---|---|
| O 订单语义 | `/tmp/trade-audit-20261114/phase6/cards-O.md` | 12 |
| M 风控、保证金、账户 | `/tmp/trade-audit-20261114/phase6/cards-M.md` | 16 |
| T 条款、K 线、时钟 | `/tmp/trade-audit-20261114/phase6/cards-T.md` | 19 |
| L Live 节点、恢复、停止；Paper 恢复 | `/tmp/trade-audit-20261114/phase6/cards-L.md` | 27 |
| A1 功效、多重检验、留出、验证 | `/tmp/trade-audit-20261114/phase6/cards-A1.md` | 15 |
| A2 数据、呈现、组织、会话行为 | `/tmp/trade-audit-20261114/phase6/cards-A2.md` | 22 |
| X 后出的实跑结果与补充候选 | `/tmp/trade-audit-20261114/phase6/cards-X.md` | 11 |
| P8 已有索引条目的补查 | `/tmp/trade-audit-20261114/phase8/cards-P8.md` | 6 |

各阶段的中间结果：流程表 `phase1/`，文献与逐面比对 `phaseA/`，组件比对 `phaseC/`，会话与运行记录细读 `phase5/`，对照已有记录 `phase8/`，独立复核 `review/`。
