# Papers

## OpenAlex — default index

- `GET https://api.openalex.org/works`, key as `-H "Authorization: Bearer $(key OPENALEX_API_KEY)"`.
  The key buys a daily dollar budget and a keyless call a smaller one; both are reported in the
  `x-ratelimit-*-usd` response headers. What a search, a filter-only list and a single-work lookup
  cost changes: read it from those headers on one call before a large run. Keyless `page=` paging
  works, but `cursor=` past the first page needs the key (401 without it).
- Default query: `filter=title_and_abstract.search:` with a URL-encoded boolean expression, e.g.
  `("funding rate" OR basis) AND (perpetual OR cryptocurrency)`; results come relevance-ranked.
  `search=` adds full text and returns far more, mostly noise: use it only to widen.
  `title.search:` finds a known title (strip `?`, `:` and `,` from it); `search.semantic=` takes a
  question in plain words.
- Combine filters with `,` (AND) and `|` inside one filter (OR): `publication_year:>2019`,
  `type:article`, `locations.source.id:S...`. Sorting by citations without a source or venue
  filter surfaces spam. Topic assignments change when OpenAlex retrains its classifier; prefer
  words and sources.
- Citations: `cites:W...` lists works citing a work and `cited_by:W...` its references; combine
  with a search filter to find, say, crypto papers that cite a method paper. `cited_by_count` is
  the count.
- `select=id,doi,display_name,publication_year,cited_by_count,primary_location,locations,ids,is_retracted`
  and `per-page=` (up to 100); beyond 10,000 results page with `cursor=*`, then `meta.next_cursor`.
- Working papers: `locations.source.id:S4210172589|S2809516038|S4306401271` is SSRN, NBER and
  RePEc (`locations`, not `primary_location`, also catches secondary copies). SSRN DOIs start
  `10.2139/ssrn.`, NBER `10.3386/`; SSRN records often lack an abstract here. Versions of one paper
  are usually separate works: look up many DOIs in one cheap call with `filter=doi:10.1/a|10.2/b`.
- Rebuild an abstract from `abstract_inverted_index` with
  `jq '[(.abstract_inverted_index // {}) | to_entries[] | .key as $w | .value[] | [., $w]] | sort_by(.[0]) | map(.[1]) | join(" ")'`.

## Crossref — second ranker

- `GET https://api.crossref.org/works?query.bibliographic=...&rows=20&select=DOI,title,author,issued,container-title,type,abstract`
  with `mailto=$(key RESEARCH_CONTACT_EMAIL)` (the polite pool; check `x-api-pool` and the
  rate-limit headers before a large run). No key. Its ranking differs from OpenAlex's and surfaces relevant papers OpenAlex
  leaves out of its top results.
- `filter=prefix:10.2139` restricts to SSRN and `prefix:10.3386` to NBER; add `from-pub-date:YYYY`.
  Abstracts, when present, are JATS XML: strip the tags; SSRN abstracts missing from OpenAlex are
  often here. Its `relation` field is almost always
  empty; do not rely on it for versions.

## Semantic Scholar — passages, similar work, version links

- Base `https://api.semanticscholar.org`, key as `-H "x-api-key: $(key SEMANTIC_SCHOLAR_API_KEY)"`
  (a wrong key gets 403). Keyless calls share one public pool and get 429 more often. HTTP 429 is
  frequent even with the key: pace calls and back off 5, 15 and 45 s.
- `/graph/v1/paper/search?query=...&limit=&fields=title,year,venue,externalIds,abstract,citationCount`
  ranks by relevance.
- `/graph/v1/snippet/search?query=...` returns matched passages with their paper.
- A lookup by title or ID can land on a different version of the paper than the one you mean:
  check year and venue before using its citation count. `externalIds` links an arXiv ID to one DOI of the same work but does not list SSRN copies.

## Full text

- Try the arXiv copy first (`https://arxiv.org/pdf/{id}`, the ID from an `10.48550/arxiv.` DOI or
  `externalIds.ArXiv`), then every OpenAlex `locations[].pdf_url` (more than `best_oa_location`),
  then Semantic Scholar `openAccessPdf`. Many listed links do not return a PDF.
- A bot check, challenge or login page means stop: never work around it, and never scrape SSRN or
  publisher pages. Ask the user for the PDF of any paper that decides something.
