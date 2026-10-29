import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/translationCache.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function policy(globals = {}) {
  const warnings = [], exports = {};
  runInNewContext(code, { URL, exports, console: { warn: (...args) => warnings.push(args) }, ...globals });
  return { ...exports, warnings };
}

function storage(urls) {
  const entries = new Map(urls.map((url) => [url, new Request(url)]));
  const deleted = [], opened = [];
  const cache = {
    keys: async () => [...entries.values()],
    delete: async (request) => { deleted.push(request.url); return entries.delete(request.url); },
    match: () => assert.fail("cleanup must not read or copy model bodies"),
  };
  return {
    entries, deleted, opened,
    keys: async () => ["transformers-cache", "unrelated-cache"],
    open: async (name) => { opened.push(name); assert.equal(name, "transformers-cache"); return cache; },
  };
}

test("remove retired trials, old revisions and other quantizations; reuse current q4 files", async () => {
  const { TRANSLATION_MODEL: model, pruneTranslationCache } = policy();
  const base = `https://huggingface.co/${model.id}/resolve/`;
  const current = `${base}${model.revision}/`;
  const retained = [
    `${current}config.json`, `${current}tokenizer.json`, `${current}generation_config.json`,
    `${current}onnx/model_q4.onnx`, `${current}onnx/model_q4.onnx_data`, `${current}onnx/model_q4.onnx_data_1`,
  ];
  const obsolete = [
    "https://huggingface.co/Xenova/opus-mt-en-zh/resolve/046f55aec303cdee3e0318604406d4df20f1e8ea/onnx/encoder_model_quantized.onnx",
    `${base}old-revision/onnx/model_q4.onnx_data`, `${base}old-revision/tokenizer.json`,
    `${current}onnx/model_q4f16.onnx`, `${current}onnx/model_q4f16.onnx_data`,
    `${current}onnx/model_q4f16.onnx_data_1`, `${current}onnx/model_fp16.onnx`,
  ];
  const cache = storage([...retained, ...obsolete]);
  await pruneTranslationCache("transformers-cache", cache);
  assert.deepEqual(cache.deleted.sort(), obsolete.sort());
  assert.deepEqual([...cache.entries.keys()].sort(), retained.sort());
  assert.deepEqual(cache.opened, ["transformers-cache"]);
  await pruneTranslationCache("transformers-cache", cache);
  assert.equal(cache.deleted.length, obsolete.length, "a second run deletes no further files");
});

test("leave unrelated models, hosts, paths, runtime files and cache namespaces untouched", async () => {
  const { TRANSLATION_MODEL: model, pruneTranslationCache } = policy();
  const untouched = [
    "https://huggingface.co/Xenova/another-model/resolve/main/onnx/model.onnx",
    "https://huggingface.co/Xenova/opus-mt-en-zh-other/resolve/main/onnx/model.onnx",
    `https://other.example/${model.id}/resolve/main/onnx/model.onnx`,
    `https://huggingface.co.evil.example/${model.id}/resolve/main/onnx/model.onnx`,
    `https://huggingface.co/${model.id}/blob/main/onnx/model.onnx`,
    "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  ];
  const cache = storage(untouched);
  await pruneTranslationCache("transformers-cache", cache);
  assert.deepEqual(cache.deleted, []);
  assert.deepEqual(cache.opened, ["transformers-cache"]);
  assert.deepEqual([...cache.entries.keys()], untouched);
});

test("first visits do not create caches, and unavailable storage does not block translation", async () => {
  const { pruneTranslationCache, warnings } = policy();
  await pruneTranslationCache("transformers-cache");
  await pruneTranslationCache("transformers-cache", {
    keys: async () => [], open: () => assert.fail("must not create an empty cache"),
  });
  await pruneTranslationCache("transformers-cache", {
    keys: async () => { throw new Error("storage denied"); },
  });
  assert.equal(warnings.length, 1);
});

test("a failed deletion leaves all retained files intact and does not fail model loading", async () => {
  const { pruneTranslationCache, warnings } = policy();
  const cache = storage(["https://huggingface.co/Xenova/opus-mt-en-zh/resolve/main/config.json"]);
  const originalOpen = cache.open;
  cache.open = async (name) => ({ ...await originalOpen(name), delete: async () => { throw new Error("cache unavailable"); } });
  await pruneTranslationCache("transformers-cache", cache);
  assert.equal(warnings.length, 1);
  assert.equal(cache.entries.size, 1);
});
