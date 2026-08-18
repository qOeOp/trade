# Install

Installation establishes a reproducible development foundation. It does not activate a strategy,
connect a live execution adapter, or grant authority to create external trading effects.

## Prerequisites

- A supported Python and Rust toolchain for the repository revision being built.
- Node.js for the documentation site.
- Credentials only for the data or execution adapters you deliberately configure.
- An isolated environment for generated strategy code and exploratory work.

Always follow the repository's current Makefile and CI workflows rather than copying historical commands
from older documentation.

## Credential prerequisite matrix

The table records current consumers and explicitly bounded candidates. It does not claim that an environment key
creates an admitted connector, data license, trading authorization, or product capability.

| Environment name                                                         | Owner or use                                   | Required for                                                             | Status                                                                                                                                       | Missing disposition                                                                                         | Secret handling                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| none                                                                     | repository build and documentation             | build, tests, docs generation, and local docs preview                    | current, no key                                                                                                                              | work normally                                                                                               | no secret                                                                                           |
| `DATABENTO_API_KEY`                                                      | Market Data Data Client                        | an explicitly configured Databento data adapter or example               | current optional                                                                                                                             | adapter `NOT_CONFIGURED` or data `UNAVAILABLE`; never zero observations                                     | ignored local secret only                                                                           |
| `BINANCE_API_KEY` + `BINANCE_API_SECRET`                                 | Market Data and Execution Binance adapters     | an explicitly authorized live connectivity probe or trading deployment   | current optional external effect                                                                                                             | adapter not admitted and no live effect                                                                     | ignored local secret only; never use for docs or research discovery                                 |
| `SILICONFLOW_API_KEY` + `SILICONFLOW_BASE_URL`                           | R&D media Source Intake                        | an explicitly configured BiliNote media connector profile                | locally prepared; optional connector                                                                                                         | connector `NOT_CONFIGURED` or `UNAVAILABLE`; never empty source evidence                                    | key is an ignored local secret; base URL is non‑secret configuration but still request‑bound        |
| `VIBE_PATH`                                                              | local catalog‑storage configuration            | an explicitly selected local catalog path                                | current optional                                                                                                                             | use the admitted local default or fail configuration                                                        | local path configuration; no credential value in receipts                                           |
| `VIBE_TEST_DATA_BASE_URL`                                                | testkit and CI fixtures                        | tests that deliberately fetch the configured fixture base                | current optional                                                                                                                             | test skips or fails explicitly under its test policy                                                        | non‑secret configuration, still do not rewrite receipts                                             |
| `OPENALEX_API_KEY`                                                       | planned R&D scholarly connector                | only a future admitted OpenAlex connector that actually requires it      | locally prepared; connector candidate                                                                                                        | `CONNECTOR_NOT_CONFIGURED` or `UNAVAILABLE`; never zero results                                             | ignored local secret only                                                                           |
| `CORE_API_KEY`                                                           | planned R&D open‑full‑text connector           | only a future admitted CORE connector                                    | locally prepared; connector candidate                                                                                                        | `CONNECTOR_NOT_CONFIGURED` or `UNAVAILABLE`; never zero results                                             | ignored local secret only                                                                           |
| `SEMANTIC_SCHOLAR_API_KEY`                                               | planned R&D scholarly discovery connector      | only a future admitted Semantic Scholar connector                        | locally prepared; connector candidate                                                                                                        | `CONNECTOR_NOT_CONFIGURED`, `RATE_LIMITED`, or `UNAVAILABLE`                                                | ignored local secret only                                                                           |
| `STACKEXCHANGE_KEY`                                                      | planned R&D Q&A discovery connector            | only a future admitted Stack Exchange connector                          | locally prepared; connector candidate                                                                                                        | `CONNECTOR_NOT_CONFIGURED`, `RATE_LIMITED`, or `UNAVAILABLE`                                                | ignored local secret only                                                                           |
| `FIRECRAWL_API_KEY`                                                      | planned R&D web Source Intake connector        | only an admitted bounded fetch profile behind Source Acquisition Binding | locally prepared; connector candidate                                                                                                        | `CONNECTOR_NOT_CONFIGURED`, `POLICY_UNAVAILABLE`, or `TERMS_OR_LICENSE_BLOCKED`                             | ignored local secret; never grants arbitrary crawl authority                                        |
| `KAGGLE_API_TOKEN`                                                       | planned Market Data or R&D dataset acquisition | only an admitted dataset/version/license‑specific fetch                  | locally prepared; connector candidate                                                                                                        | `CONNECTOR_NOT_CONFIGURED`, `UNAVAILABLE`, or `TERMS_OR_LICENSE_BLOCKED`                                    | ignored local secret; dataset rights are evaluated separately                                       |
| `FRED_API_KEY`                                                           | planned Market Data economic‑series connector  | only a future admitted FRED or ALFRED market‑data connector              | local credential present and authenticated by a read‑only metadata probe; connector absent; `LEGAL_REVIEW_REQUIRED` for archive/backtest use | `CONNECTOR_NOT_CONFIGURED`, `UNAVAILABLE`, or `TERMS_OR_LICENSE_BLOCKED`; never substitute current values   | ignored local secret only; credential presence does not admit storage, training, or backtest rights |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ARK_API_KEY`, `DEEPSEEK_API_KEY` | optional R&D or Agent Shell model connectors   | only an explicitly selected, manifest‑bound model/tool profile           | locally prepared; no general project prerequisite                                                                                            | selected connector `NOT_CONFIGURED` or request `POLICY_UNAVAILABLE`; never weaken deterministic Owner gates | ignored local secrets; model output remains untrusted input, never trading evidence or authority    |

General LLM keys are listed for prerequisite discovery but are not a project-architecture prerequisite. A local key with no current code consumer is neither
installation evidence nor a promised connector. Secret values stay only in an ignored local secret environment;
never commit, print, log, or copy them into requests, receipts, artifacts, documentation, screenshots, or audit
packets. See the [Source Intake Playbook](./source-intake/) before adding a Research connector and the
[Market Data Intake Playbook](./market-data-intake/) before admitting a data provider or dataset.

## Build the foundation

From the repository root, use the current build entrypoint:

```bash
make build-debug
```

Build and test success proves only that the local software foundation is reproducible. It does not prove
data fitness, strategy validity, qualification, capital approval, live connectivity, or safe recovery.

## Before using data

Configure a Market Data adapter and verify instrument identity, timestamps, coverage, corrections,
licensing, and point-in-time availability. Missing or ambiguous facts must stop dependent research,
backtest, scan, valuation, or trading work.

## Before paper or live trading

The product path must provide a qualified artifact, a Governance deployment decision, a Risk policy,
an Execution adapter, reconciliation, and a Recovery path. Paper and live use the same intent, risk,
order, and feedback semantics; only the Execution adapter changes.

Live trading is an explicit external-effect configuration. Installing the project alone never enables it.
