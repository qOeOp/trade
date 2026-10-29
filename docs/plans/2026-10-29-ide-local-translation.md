# Browser-local translation experiment

User decision after the comparison: use TranslateGemma q4 with trading glossary instructions.
The final icon calls that engine directly. The Chrome adapter and engine selector were removed;
comparison observations below describe the completed experiment. No model training or source-text
rewriting is involved: the glossary is part of the inference prompt.

User scope: add a translation icon to the Details panel's Change and hypothesis heading and try
English-to-Chinese translation of What changed and Hypothesis with Transformers.js in the browser.
The selected implementation also covers Conclusion's Interpretation and decision. Both headings
use the same translated-card component, with independent toggle, progress, retry and cancellation
state and one shared worker/model. Registration identifiers and duties remain outside translation.
An AbortSignal scopes cancellation to its own card group; the worker is stopped only when no
other group is waiting. Long prose is translated in token-bounded chunks with paragraph breaks.

The icon toggles derived Chinese text beneath the unchanged originals. Loading starts only on click.
A single inline Web Worker owns the model and serializes inference; React owns display state and
discards results when the source changes. Translation never writes to the research ledger.

Selected implementation: Transformers.js 4.3.2, fetched on demand
from jsDelivr, with `onnx-community/translategemma-text-4b-it-ONNX`, revision
`f7874a1ac60758872a4f78aac0df95b17b776994`, q4, WebGPU. The latter downloads approximately
3.1 GB of weights from Hugging Face; only local worker messages contain the source text. The
TranslateGemma prompt follows its published user/model turn structure with English-to-Chinese
instructions and a trading glossary, greedy decoding and a 1024-token output limit. Engine
results stay in React state for showing/hiding; downloads and inference can be cancelled.
The runtime remains external to keep the existing single-file HTML around 3 MB; bundling the
runtime and its transitive assets increased it to approximately 75 MB.

## Observed quality

The original trial used `Xenova/opus-mt-en-zh`, revision
`046f55aec303cdee3e0318604406d4df20f1e8ea`, q8, single-threaded WASM.
Browser inference completed for both paragraphs from the user's screenshot. This small model
mistranslated financial terminology: bearish shorts became a phrase containing “熊短裤”. It also
changed the source amount `40000 USDT` to `4000 USDT`. Trying four beams did not improve these
outputs; that setting was removed. This is a working interaction prototype, not evidence that
this model is suitable for research text. Original English remains visible for comparison.

Chrome's built-in translator completed both paragraphs locally. It preserved `40000 USDT` and
translated shorts as “空头”, but mistranslated long entries as “长条目”, variance sizing as
“差异大小”, and native long exits as “原生长退出”. Its inference duration rounded to 0.0 seconds
in the first UI build; the current UI reports subsecond durations in milliseconds.
The final browser comparison measured 108 ms for the two native translations, excluding model setup.

The initial TranslateGemma q4f16 variant (about 2.7 GB) loaded on WebGPU but returned empty
assistant content on two attempts. The comparison was switched to q4, matching the community
demo's dtype. A related upstream issue reports fp16 activation-range overflows in Gemma 3
([ONNX Runtime #26732](https://github.com/microsoft/onnxruntime/issues/26732)); this is a plausible
explanation for the observed symptom, not a confirmed diagnosis of this particular export.

The q4 version successfully translated both paragraphs in 2.6 seconds, excluding model setup.
Without a glossary, it still mistranslated shorts as “短线” and long as “长期”, and rendered flat
cash as “平价现金交易”. Numeric amount `40000 USDT` was preserved. The final comparison adds
explicit financial senses for long, short, entries, exits, flat cash, notional and variance sizing
to the translator instruction; it keeps the source paragraph itself unchanged.

With that glossary, the two paragraphs completed in 5.5 seconds. Key terms became “空仓持有现金”,
“EMA10/20多头入场”, “基于方差的仓位调整” and “原生多头退出”, while preserving `40000 USDT`.
This improved the observed terminology substantially. The output is still not exact: the first
paragraph drops the decision qualifier on the notional budget, and the second does not explicitly
retain the bearish qualifier. These are two fixture paragraphs, not a general translation benchmark.

## Validation

- `npm run build --prefix services/ide/web`: passed, including TypeScript and structural rules.
- Required Python unittest discovery after rebasing onto main: 667 tests run successfully, including 318 skipped.
- `npm audit --prefix services/ide/web`: zero vulnerabilities after selecting 4.3.2.
- Browser: real model download and inference, hide/show without reinference, source selection
  clearing the previous translation, and disabled action for empty declarations.
- Comparison: native Chrome translation, two empty q4f16 attempts, successful q4 inference without
  a glossary, and successful q4 inference with the trading glossary. Both final engine results
  were selectable without running the model again. Times exclude download and model loading.
- Browser preview used an isolated fixture with the screenshot's paragraphs, without a database.
  No ledger records, runtime images, host configuration or existing services were changed.
- The Conclusion fixture completed independently while Change and hypothesis was cancelled.
  The final glossary includes drawdown, annual return and next trial after the conclusion fixture
  exposed an incorrect rendering of drawdown. This only changes translation instructions.
- Eight frontend tests pass, including shared-worker cancellation/retry and long-text chunking.
