export const TRANSLATION_MODEL = {
  id: "onnx-community/translategemma-text-4b-it-ONNX",
  revision: "f7874a1ac60758872a4f78aac0df95b17b776994",
  dtype: "q4",
} as const;

// Only repositories used by this feature belong to its cleanup policy. Other
// Transformers.js consumers can share the same browser cache.
const RETIRED_MODELS = new Set(["Xenova/opus-mt-en-zh"]);
const CURRENT_WEIGHTS = new Set([
  "onnx/model_q4.onnx", "onnx/model_q4.onnx_data", "onnx/model_q4.onnx_data_1",
]);

function obsolete(url: string): boolean {
  const resource = new URL(url);
  if (resource.origin !== "https://huggingface.co") return false;
  const match = /^\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/u.exec(resource.pathname);
  if (!match) return false;
  const [, model, revision, file] = match;
  if (!model || !revision || !file) return false;
  if (RETIRED_MODELS.has(model)) return true;
  if (model !== TRANSLATION_MODEL.id) return false;
  if (revision !== TRANSLATION_MODEL.revision) return true;
  return file.startsWith("onnx/") && !CURRENT_WEIGHTS.has(file);
}

/** Delete obsolete translation downloads without reading/copying GB-sized bodies.
 * Cache access is best-effort: a browser storage restriction must not prevent inference.
 * Call before model loading, using the runtime's cache name so retained files are reused.
 */
export async function pruneTranslationCache(cacheName: string, storage?: CacheStorage): Promise<void> {
  try {
    storage ??= globalThis.caches;
    if (!storage) return;
    // Do not create an empty cache on a first visit.
    if (!(await storage.keys()).includes(cacheName)) return;
    const cache = await storage.open(cacheName);
    for (const request of await cache.keys()) {
      if (obsolete(request.url)) await cache.delete(request);
    }
  } catch (error) {
    console.warn("Unable to clean obsolete translation model cache", error);
  }
}
