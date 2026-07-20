# Research Source Contract

## Status

P0 contract implementation. It defines identity and validation semantics only; it does not select a parser, store, model, retrieval provider, or tool count.

## Owns

- Canonical JSON and SHA-256 identity rules for research sources and derived knowledge
- Exact source revision construction from bytes
- Deterministic page-aware chunk-set construction
- Code-owned citation resolution and cited finding-set construction
- Create-or-identical conflict classification

## Inputs

- Exact source bytes and source availability facts
- Parser-produced chunk text with page/block spans
- Typed model finding drafts with chunk/page/quote citation drafts
- Versioned producer contracts and invocation receipts

## Outputs

- `trade.research-source-revision.v1`
- `trade.research-source-acquisition.v1`
- `trade.research-chunk-set.v1`
- `trade.cited-finding-set.v1`
- Canonical refs and content hashes

## Invariants

- Source revisions are content-addressed from exact bytes.
- Source locator and availability facts are append-only acquisition receipts; repeated acquisition cannot mutate a content revision.
- Local source locators are repository-relative; absolute local paths are rejected.
- Chunk members and sets are deterministic and create-or-identical.
- Models propose citations but cannot mint canonical chunk or citation IDs.
- A citation quote must be an exact substring of the cited chunk and its page must belong to that chunk.
- Semantic finding-set identity includes canonical content and a producer invocation receipt; different model output cannot overwrite an existing identity.
- Search projections, persistence, R&D queue writes, experimental evidence, and promotion are outside this contract.

## Forbidden

- Reading or writing `data_catalog.db` or `rd_state.db`
- Fetching PDFs or calling a model
- Defining strategy validity or promotion state
- Treating literature findings as empirical strategy evidence
