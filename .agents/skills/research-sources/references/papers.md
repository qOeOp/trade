# Paper indexes

Select fields and cap results in the request, then cut the response with `jq` before reading it.

## OpenAlex — default index

- `GET https://api.openalex.org/works`, key as `-H "Authorization: Bearer $(key OPENALEX_API_KEY)"`.
  The key buys a daily dollar budget, reported in the `x-ratelimit-*-usd` response headers: a
  search costs about ten times a filter-only list, a single-work lookup (`/works/doi:10....`) is
  free, and a keyless call gets a tenth of the budget.
- Default query: `filter=title_and_abstract.search:` with a URL-encoded boolean expression, e.g.
  `("funding rate" OR basis) AND (perpetual OR cryptocurrency)`; results come relevance-ranked.
  `search=` adds full text and returns hundreds of times more, mostly noise: use it only to widen.
  `title.search:` finds a known title; `search.semantic=` takes a question in plain words.
- Combine filters with `,` (AND) and `|` inside one filter (OR): `publication_year:>2019`,
  `type:article`, `cites:W...`, `locations.source.id:S...`. Sorting by citations without a source
  or venue filter surfaces spam. Topic assignments change when OpenAlex retrains its classifier;
  prefer words and sources.
- `select=id,doi,display_name,publication_year,cited_by_count,primary_location,locations,ids,is_retracted`
  and `per-page=` (up to 100); beyond 10,000 results page with `cursor=*`, then `meta.next_cursor`.
- Working papers: `locations.source.id:S4210172589|S2809516038|S4306401271` is SSRN, NBER and
  RePEc (`locations`, not `primary_location`, also catches secondary copies). SSRN DOIs start
  `10.2139/ssrn.` and often lack an abstract here. arXiv preprints carry the DOI
  `10.48550/arxiv.{id}`. Resolve other source IDs with `GET /sources?search=NAME`.
- Look up many DOIs in one cheap call with `filter=doi:10.1/a|10.2/b`; an arXiv DOI often resolves
  to the journal work it was merged into.
- Rebuild an abstract from `abstract_inverted_index` with
  `jq '[(.abstract_inverted_index // {}) | to_entries[] | .key as $w | .value[] | [., $w]] | sort_by(.[0]) | map(.[1]) | join(" ")'`.

## Semantic Scholar — second index, versions, citations and passages

- Base `https://api.semanticscholar.org`, key as `-H "x-api-key: $(key SEMANTIC_SCHOLAR_API_KEY)"`
  (a wrong key gets 403). HTTP 429 is frequent even with the key and slow pacing: space calls at
  least 3 s apart, back off 5, 15 and 45 s, then log the call as not searched.
- `/graph/v1/paper/search/bulk?query=...&fields=title,year,venue,externalIds,citationCount,openAccessPdf`
  accepts `"phrase"`, `+`, `|`, `-` and `sort=citationCount:desc` and pages by `token`; the
  relevance search `/graph/v1/paper/search` drifts off topic on multi-word queries.
- `POST /graph/v1/paper/batch?fields=title,year,externalIds` with `{"ids": [...]}` (up to 500;
  `DOI:...`, `ARXIV:...`, `CorpusId:...`) costs one call. `externalIds` links an arXiv ID to one
  DOI of the same work but does not list SSRN copies, and SSRN DOIs often resolve to null; match
  those through OpenAlex.
- `/graph/v1/snippet/search?query=...` returns matched passages with their paper; use it to find
  which paper states a specific claim, then read that paper.
- `/graph/v1/paper/{id}/citations` and `/references`; `POST /recommendations/v1/papers` with
  `positivePaperIds` for similar papers.

## arXiv — newest preprints

- `GET https://export.arxiv.org/api/query` (Atom XML, no key; parse it with `python3 -I` and
  `xml.etree.ElementTree`, not `jq`). One request every three seconds.
- Always restrict by category, since keywords alone match physics and computer science:
  `search_query=cat:q-fin*+AND+abs:"order book"`; prefixes `ti:`, `abs:`, `au:`, `cat:`, `all:`;
  quantitative finance is `q-fin.CP|EC|GN|MF|PM|PR|RM|ST|TR`; related: `econ.*`, `stat.ML`.
- `sortBy=submittedDate&sortOrder=descending` for recent work. A sporadic HTTP 406 clears on a
  slow retry. Full text: `https://arxiv.org/pdf/{id}`.

## CORE — open-access full text, weak for discovery

- `GET https://api.core.ac.uk/v3/search/works/?q=...&limit=` with
  `-H "Authorization: Bearer $(key CORE_API_KEY)"`; the trailing slash matters (otherwise 301).
- Elasticsearch-style queries: `title:"order flow" AND yearPublished>=2015`. A lone quoted phrase
  is matched loosely (millions of hits) until another clause is ANDed to it. Some valid-looking
  queries (`_exists_:` among them) return HTTP 500 with "status code 0"; simplify the query rather
  than retrying it. Ranking is loose, so read titles before trusting `totalHits`. Personal keys
  allow about 1,000 requests a day and 25 a minute.
- Each result embeds `fullText` (can be hundreds of kilobytes). Always project with `jq`
  (`{title, yearPublished, doi, downloadUrl}`). The embedded text sometimes belongs to another
  document: check the title and authors appear in it before quoting.

## Full text

- Try the arXiv PDF and repository copies first: OpenAlex `locations[].pdf_url` (more than
  `best_oa_location`), Semantic Scholar `openAccessPdf`, CORE `fullText` or `downloadUrl`.
  Working-paper series of central banks and research institutes are fine when they serve the file
  directly; publisher links usually answer with a bot check.
- Download with `curl -sSL -o FILE -w '%{http_code} %{content_type}'` and run `pdftotext -layout`
  only on `application/pdf`; read long papers by section, not whole.
- A bot check, challenge or login page means stop: never work around it, and never scrape SSRN or
  publisher pages. Ask the user for the PDF of any paper that decides something.
