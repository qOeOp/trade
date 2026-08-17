# Source Intake Playbook

This playbook gives a future implementation Agent a high-ROI path for building Research Source Intake. It is a
development baseline, not a new business authority. Connector products, protocols, persistence, queues, and scoring
formulas remain replaceable implementation choices.

## Responsibility and boundary

Source Intake admits papers, articles, notes, media, community discussions, tool output, and facts already committed
by another Owner. Every external payload is `UNTRUSTED_EXTERNAL_DATA`: prompts, commands, role claims, tool requests,
and trading advice embedded in it have no execution authority.

Its durable output is a traceable Source Candidate joined to the existing Research Source Provenance Record. Source
Intake cannot create a Strategy Artifact, request a replay, qualify or deploy a strategy, allocate capital, or trade.
Only a frozen Research Intent can admit the interpreted source into the formal research loop. A source may motivate a
hypothesis; it cannot prove Alpha, qualification, or deployability.

The boundary with [Market Data](../../owners/market-data/) is semantic:

- papers, API documentation, field definitions, methodology, and research commentary belong to Source Intake;
- price observations, macroeconomic vintages, filing facts, event calendars, and instrument state actually consumed by
  research, replay, or scanning belong to Market Data;
- Source Intake may preserve a dataset or API reference, but it cannot become a second market-data catalog or fact
  store.

## Source classes and ROI

The tier is a discovery priority, not an evidence grade or admission decision.

| Tier | Source class                                 | Best use                                                              | Evidence posture                                     | Main risk                                    | Direct Intent |
| ---- | -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- | ------------- |
| S    | Academic identity and citation graph         | Discover mechanisms, authors, related work, and prior tests           | Strong identity; claims still require interpretation | Metadata or citation errors                  | Never         |
| S    | Open full text and working papers            | Inspect assumptions, methods, falsifiers, and limitations             | Primary research text, not trading proof             | Revision drift and selective reporting       | Never         |
| S    | Primary institutional facts                  | Discover testable economic events and official definitions            | Strong origin; PIT availability still must be proven | Revision, release, and rights semantics      | Never         |
| A    | Paper-linked code and datasets               | Reproduce methods and expose implementation assumptions               | Useful engineering evidence                          | Mutable dependencies, license, survivorship  | Never         |
| A    | Institutional quantitative research          | Discover economic mechanisms and realistic constraints                | Expert research input                                | Marketing selection and inaccessible details | Never         |
| B    | Professional Q&A and open-source communities | Find formula boundaries, implementation failures, and counterexamples | Corroborating discovery only                         | Context loss and popularity bias             | Never         |
| C    | General communities, video, and social media | Discover vocabulary, practitioner failures, and external links        | Weak discovery signal                                | Unverifiable claims and prompt injection     | Never         |

Before any source can support a Research Intent, Research must preserve provenance, a bounded interpretation,
plausible alternatives, a differentiating prediction, and a falsifier. Source rank never bypasses that sequence.

## Connector candidates

These are replaceable first-stage candidates, not permanent dependencies or business authorities:

1. [OpenAlex API](https://docs.openalex.org/) for scholarly identity, topic, author, and citation discovery.
2. [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) for DOI and publication
   identity resolution.
3. [arXiv](https://info.arxiv.org/) for preprint identity, versions, metadata, and permitted open content.
4. [GitHub commit APIs](https://docs.github.com/en/rest/commits/commits) for paper-linked code resolved to immutable
   commit identity, content digest, history, tests, and license evidence.
5. [FRED and ALFRED](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) for discovering official
   economic series and their real-time or vintage semantics; consumed observations still enter through Market Data.
6. [SEC EDGAR data](https://www.sec.gov/dera/data/financial-statement-data-sets) for filing accession, acceptance
   time, amendment, and primary filing identity; consumed filing facts still enter through Market Data.

[Unpaywall](https://unpaywall.org/products/api) is an optional legal-open-copy resolver. Other scholarly indexes,
professional Q&A, institutional feeds, and media extraction may follow only when a concrete research bottleneck
justifies their acquisition and rights cost. Prefer official APIs, feeds, repositories, or author-maintained indexes;
generic crawling is a fallback that must preserve the same identity, rights, and terminal-outcome evidence.

## Pre-fetch admission

R&D commits one Source Acquisition Binding before any external network invocation. The binding is
request-bound and Agent Operation Manifest-bound and identifies the connector implementation and version, allowed
URI scheme and origin, DNS and resolved-address policy, complete redirect policy and hop limit, opaque credential
handle audience and least-privilege scope, response media/size/time/content bounds, network-egress policy, rights
and retention policy, shared Time Evidence, and the complete read-only outbound request identity: normalized method,
endpoint path and query, canonical allowed-header digest, credential placement by opaque handle/audience only, and
either an explicit absent-body marker or the exact body digest, media type, and size. Its admission state is exactly `ADMITTED`, `REJECTED`, or
`POLICY_UNAVAILABLE`.

Rights and retention are admission inputs, not post-fetch annotations. Research decides whether the requested
bytes may be acquired and retained before opening the network path. `REJECTED`, `POLICY_UNAVAILABLE`, or later
rights drift therefore produces zero invocation, zero response bytes, and zero provenance.

Only exact `ADMITTED` permits one bounded acquisition attempt. Every redirect hop creates and admits a new
normalized successor request binding, repeating scheme, origin, DNS, resolved address, method, endpoint path/query,
header/body disposition, credential audience, response bounds, egress, and rights checks before the next invocation.
Loopback, private, link-local, disallowed or changed addresses, DNS rebinding, unlisted redirects, cross-origin
credential forwarding, unknown policy, and rights uncertainty invoke no network request and create no provenance.
Credentials remain opaque and never enter source content, logs, prompts, receipts, or generated artifacts. A
changed connector, method, endpoint, query, header/body digest, origin, resolution, redirect sequence, credential audience, response bound, rights policy, or
time cut requires a successor binding; conflicting replay is rejected.

## Internal capability sequence

The following are capabilities inside Source Intake, not new Flow nodes or Owners:

`Connectors → Discovery → Identity Resolution → Admission → Fetch → Normalization → Provenance → Triage → Research Queue`

| Capability  | Required semantics                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover`  | Return stable Source References for a bounded query, source class, time cut, and connector restrictions.                                      |
| `resolve`   | Resolve DOI, arXiv ID, URL, repository commit, author, or post reference to a canonical Source Identity.                                      |
| `fetch`     | After exact `ADMITTED`, retrieve only permitted content and record retrieval time, response identity, access basis, and acquisition terminal. |
| `normalize` | Produce a Source Candidate without changing meaning; retain the raw-content digest and transformation identity.                               |
| `capture`   | Create or join the immutable Research Source Provenance Record; changed content creates a successor or rejection.                             |
| `health`    | Report reachability, authorization, quota, rights change, and last successful retrieval; unavailable is not empty.                            |

No connector can create a Research Intent, Strategy Artifact, Candidate, Eligibility Fact, deployment decision, or
external trading effect.

## Acquisition terminals

Every bounded acquisition attempt ends once as one of:

| Terminal                   | Meaning                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `RETRIEVED`                | Identified content and required acquisition evidence were captured.                       |
| `NOT_FOUND`                | The requested canonical identity does not resolve at this cut.                            |
| `AUTH_REQUIRED`            | Authentication is required and no admitted credential capability was available.           |
| `ACCESS_DENIED`            | The source rejected the admitted principal or scope.                                      |
| `RATE_LIMITED`             | Quota or throttling prevented a conclusive fetch; this is not `NOT_FOUND`.                |
| `TERMS_OR_LICENSE_BLOCKED` | Acquisition or intended retention is not permitted by the current rights basis.           |
| `MALFORMED`                | A response arrived but could not satisfy the declared source format or identity contract. |
| `UNAVAILABLE`              | Reachability or connector state was insufficient for any stronger terminal.               |

Exact replay joins the earlier attempt terminal. Only exact `ADMITTED` plus `RETRIEVED` may create or join a
Research Source Provenance Record; the other seven acquisition terminals create no provenance record. A changed
query, source identity, connector policy, retrieval cut, or content digest creates a new attempt identity. Missing
or prose-only failure evidence remains `UNAVAILABLE` and cannot silently produce an empty discovery result.

## Provenance record

Use the existing Research Source Provenance Record; do not create a second registry. The record binds:

- canonical source identity and location, immutable content digest, source class, and trust class;
- author or originating system, publication time when available, revision or version, and linked code or dataset references;
- retrieval cut, shared Time Evidence, `valid-through`, connector identity and version, and the exact `RETRIEVED`
  acquisition terminal;
- license and attribution basis, including the allowed acquisition and retention scope;
- bounded interpretation identity and digest, plausible alternative set, differentiating predictions, and falsifier.

A change to content, retrieval cut, license basis, or interpretation produces a successor record. A Source Candidate
without its record is not handoffable.

## Triage and admission

Triage orders reading and experimentation; it never measures strategy quality. A policy may compare falsifiability,
expected decision value, data availability, reproducibility, economic relevance, novelty, acquisition cost, rights
risk, and implementation cost. The policy version and deterministic tie-break must be recorded, while the formula
and transport remain implementation choices.

The handoff is:

`Source Candidate → provenance and interpretation → alternatives → differentiating prediction → falsifier → frozen Research Intent`

If market observations are needed, Research requests them from Market Data and correlates the terminal result to
the same Research lineage. Before the first handoff, Research freezes one PIT Market Snapshot Request binding its
Research Request, Intent, TrialFamily, instrument or universe scope, four-time decision cut, required provenance,
license, correction frontier, stable correlation, and Time Evidence. `PREPARED` and `SUBMITTED_OR_UNKNOWN` are not
market facts. Market Data alone returns the correlated snapshot disposition, repeating the exact request identity,
content digest, scope, cut, provenance, license, correction, and correlation bindings. Changed meaning requires a
successor request; transport success, silence, or a prior snapshot never implies `AVAILABLE` or a terminal negative.
Source Intake never repairs or stores those market facts itself.

## Failure cases

- Treating an external prompt, repository instruction, or tool response as an executable request is a security failure.
- Treating `UNAVAILABLE`, `RATE_LIMITED`, or `AUTH_REQUIRED` as an empty result is an evidence failure.
- Fetching current FRED values for a historical decision without ALFRED-style vintage semantics is a PIT failure.
- Referring to a mutable branch or URL when an immutable commit or content digest exists is an identity failure.
- Retaining content without an acquisition and license basis is a rights failure.
- Copying price, filing, macro, or instrument facts into Source Intake creates a forbidden second Market Data store.
- Advancing a popular source directly to artifact, replay, Qualification, Governance, or trading is an authority failure.

## Development acceptance

- Contract tests cover every acquisition terminal, exact replay, successor content, connector unavailability, and rights change.
- Contract tests prove only exact `ADMITTED` plus `RETRIEVED` creates or joins provenance; every other acquisition
  terminal leaves provenance absent.
- Fixture tests prove normalization preserves meaning, raw digest, source identity, and transformation identity.
- Security tests prove source content cannot invoke tools, commands, credentials, Owner ports, or effect ports.
- Pre-fetch tests prove a direct private URL, an allowed-origin redirect to private or link-local space, DNS
  rebinding, cross-origin credential forwarding, unknown policy, and rights uncertainty produce no network
  invocation and no provenance; one exact safe same-origin request may proceed once.
- PIT tests prove publication, retrieval, effective, and revision cuts cannot be replaced by observation time alone.
- Boundary tests prove consumed market facts enter through Market Data and no connector writes Research Intent.
- Handoff tests prove an initial PIT Market Snapshot response is correlated to the exact frozen Research request;
  submission, transport success, mismatched response, or an earlier snapshot cannot stand in for that terminal.
- End-to-end proof shows one admitted source becomes a traceable Source Candidate and only Research can freeze its successor Intent.
