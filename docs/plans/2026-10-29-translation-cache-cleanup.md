# Translation model cache cleanup

The user requested automatic removal of obsolete browser model downloads so the
translation experiment does not accumulate large unused weights.

Before initializing TranslateGemma, the translation worker prunes the existing
Transformers.js cache using the runtime's configured cache name. It removes only
Hugging Face download entries belonging to this feature:

- Retired `Xenova/opus-mt-en-zh` trial files.
- Revisions of `onnx-community/translategemma-text-4b-it-ONNX` other than the pinned revision.
- Other weight variants under that pinned revision, including the unsuccessful q4f16 trial.

The selected model ID, revision and dtype live beside the cleanup policy and are
shared with model loading. Current q4 graph, external weight shards and metadata
are retained, so existing successful downloads remain reusable. When switching
to a different repository, add the replaced repository to the retired list.

Cleanup enumerates request keys and deletes individual obsolete entries; it never
reads, copies or downloads large response bodies. Other model repositories,
origins, runtime assets and cache namespaces are left alone. Missing or denied
storage and deletion errors are best-effort and do not block translation. A
cancelled worker can leave cleanup incomplete; the next initialization retries.

Cleanup is lazy, triggered by the first translation in a worker, rather than by
opening the page. Browser origin isolation means the production site cannot
delete caches belonging to an old preview port, another hostname or another
browser profile. This does not clear the browser's own native translator models.

Validation uses small synthetic cache entries: removal of retired models, old
revisions and quantizations; retention of all three q4 files and metadata;
idempotence; unrelated models/hosts/cache namespaces; absent or denied storage;
and deletion failure. No model weights or research data are needed for these tests.
