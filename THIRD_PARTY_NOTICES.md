# Third-party notices

The code in this repository is under the MIT License ([`LICENSE`](LICENSE)). It is not the licence of what is listed
here: each of these keeps its own terms, and the published images (`ghcr.io/qoeop/trade-ide`,
`trade-service`, `trade-runtime` and `trade-docker-api`) carry them as built. The exact versions are pinned in
`uv.lock`, the `package-lock.json` files, `deploy/Dockerfile` and `engine/runtime/Dockerfile`; each package's own
licence text ships inside it (`.venv/lib/python3.14/site-packages/*.dist-info`, `node_modules/*/LICENSE*`).

## Market data

| What | Terms |
|---|---|
| Binance Vision archives ([data.binance.vision](https://data.binance.vision)): klines, aggTrades, funding, metrics | [Binance Vision Dataset Terms](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md) v1.0, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/); attribution and the readings derived from it: [`README.md`](README.md#licence-and-data-attribution) |

No image contains market data: a deployment downloads it into its own market directory.

## Python packages (every image)

`uv sync --frozen --no-dev` installs these; the replay runtime, the services and the IDE images all carry them.

| Package | Licence |
|---|---|
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) (`nautilus-trader`) | LGPL-3.0-only; installed unmodified from its published wheel, so it can be replaced by another build |
| numpy | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| pandas | BSD-3-Clause |
| pyarrow | Apache-2.0 |
| python-dateutil | Apache-2.0 AND BSD-3-Clause |
| tzdata | Apache-2.0 |
| packaging | Apache-2.0 OR BSD-2-Clause |
| attrs, jsonschema, jsonschema-specifications, narwhals, plotly, pymysql, referencing, rpds-py, six | MIT |

## Binaries in the images

| Component | Where | Licence |
|---|---|---|
| Python 3.14 (`python:3.14-slim`, Debian packages beneath it) | all images | PSF-2.0; Debian packages under their own terms (`/usr/share/doc/*/copyright` in the image) |
| [Dolt](https://github.com/dolthub/dolt) 2.7.2 | service, IDE | Apache-2.0 |
| [uv](https://github.com/astral-sh/uv) 0.12.1 | all images | MIT OR Apache-2.0 |
| [Redis](https://github.com/redis/redis) 8.2.1 (`redis-server` and the Alpine musl libraries it links) | runtime (Paper's cache) | Redis Source Available License 2.0, SSPLv1 or AGPLv3, at the user's choice; used unmodified as a local cache, not offered as a service. musl: MIT |
| Docker CLI 29.1.3 | service | Apache-2.0 |
| Node.js 24 (`node` binary) | IDE | MIT, with the bundled-dependency notices in its `LICENSE` |
| Go standard library (the Docker API proxy) | docker-api | BSD-3-Clause |
| git, ca-certificates, procps (Debian) | service, IDE | GPL-2.0 and others, per `/usr/share/doc/*/copyright` |

## The IDE page and its chat service

The page (`ide/web`) bundles its npm dependencies into one HTML file: 313 packages, all permissive (MIT 273,
ISC 24, Apache-2.0 9, BSD-3-Clause 2, 0BSD, Unlicense, AFL-2.1 OR BSD-3-Clause, MIT and ISC), plus the fonts
below; list the packages with `npm ls --omit=dev --all` in `ide/web`. The chat service (`ide/agent`) installs 16 packages
(Apache-2.0 9, MIT 6, AFL-2.1 OR BSD-3-Clause 1). Icons and brand marks: [`ide/web/src/icons/NOTICE.md`](ide/web/src/icons/NOTICE.md),
with their licence texts beside it.

## Fonts

| Font | Where | Licence |
|---|---|---|
| [PP Supply Mono](https://pangrampangram.com/products/supply-mono) (`ide/web/fonts/Supply-*.otf`) | IDE page, research-chain site | Pangram Pangram, all rights reserved; subject to the foundry's [licence terms](https://pangrampangram.com/pages/eula) |
| [Inter](https://github.com/rsms/inter) (`@fontsource-variable/inter`, Latin subset) | IDE page | SIL Open Font License 1.1, text in the npm package |
| HarmonyOS Sans SC | IDE page, research-chain site | not shipped: the browser loads its slices from jsDelivr (`harmonyos-sans-sc-webfont-splitted@1.1.0`) under Huawei's HarmonyOS Sans Fonts License Agreement; the repository keeps only the generated CSS that names them |

## Fetched by the viewer's browser, not shipped

The IDE's optional translation downloads [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.2
(Apache-2.0) from jsDelivr and the `onnx-community/translategemma-text-4b-it-ONNX` weights from Hugging Face, under
Google's Gemma Terms of Use. Coin logos load from Binance's static host and remain Binance's (trademarks: §8 of the
dataset terms). The model providers' APIs the chat service calls are under each provider's own terms.
