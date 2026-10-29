import type { TextGenerationPipeline } from "@huggingface/transformers";

export type TranslationResult = { texts: string[]; elapsedMs: number };
export type TranslationRequest = { kind: "translate"; id: number; texts: string[] } | { kind: "cancel"; id: number };
export type TranslationReply = { id: number } & (
  | { kind: "status"; message: string }
  | { kind: "result"; result: TranslationResult }
  | { kind: "error"; message: string }
);

// Keep the runtime external to the single-file page; input text only crosses the local worker boundary.
const RUNTIME = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js";
// Same turn structure as the published template, with the domain glossary in its translator instruction.
const TRADING_TEMPLATE = `{{ bos_token }}<start_of_turn>user
You are a professional English (en) to Chinese (zh) translator. Translate financial trading research accurately.
Use these trading meanings: long = 多头; short/shorts = 空头/做空; bullish = 看涨; bearish = 看跌;
long entries = 多头入场; long exits = 多头退出; flat cash = 空仓持有现金; notional = 名义金额;
variance sizing = 基于方差的仓位调整; drawdown = 回撤; annual return = 年化收益;
next trial = 下一次试验; native = 原生. Preserve all numbers and identifiers exactly.
Produce only the Chinese translation, without explanations or commentary. Translate the following English text:

{{ messages[0]['content'][0]['text'] | trim }}<end_of_turn>
<start_of_turn>model
`;
let translator: TextGenerationPipeline | undefined;
let queue = Promise.resolve();
const cancelled = new Set<number>();
const scheduled = new Set<number>();
const send = (reply: TranslationReply) => self.postMessage(reply);

/** Chunk long prose on sentence/word boundaries, leaving room for Chinese output. */
function chunks(text: string, model: TextGenerationPipeline): string[] {
  const result: string[] = [];
  let current = "";
  for (const { segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)) {
    for (const word of segment.match(/\S+\s*/gu) ?? []) {
      if (current && model.tokenizer.encode(current + word).length > 384) {
        result.push(current.trim()); current = "";
      }
      current += word;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

async function translate({ id, texts }: Extract<TranslationRequest, { kind: "translate" }>) {
  try {
    if (cancelled.has(id)) return;
    if (!("gpu" in navigator)) throw new Error("当前浏览器不支持 WebGPU，无法运行 TranslateGemma。");
    if (!translator) {
      send({ id, kind: "status", message: "正在准备 TranslateGemma 4B，首次需下载约 3.1 GB 模型…" });
      const { env, pipeline }: typeof import("@huggingface/transformers") = await import(/* @vite-ignore */ RUNTIME);
      env.allowLocalModels = false;
      const loaded = new Map<string, number>();
      let lastProgress = 0;
      translator = await pipeline("text-generation", "onnx-community/translategemma-text-4b-it-ONNX", {
        revision: "f7874a1ac60758872a4f78aac0df95b17b776994",
        device: "webgpu", dtype: "q4",
        progress_callback: (p) => {
          if (p.status === "progress") {
            loaded.set(p.file, p.loaded);
            const now = performance.now();
            if (now - lastProgress < 100) return;
            lastProgress = now;
            const mb = Math.floor([...loaded.values()].reduce((sum, bytes) => sum + bytes, 0) / 1e6);
            send({ id, kind: "status", message: `下载 TranslateGemma 模型 ${mb} MB / 约 3112 MB` });
          } else if (p.status === "done") send({ id, kind: "status", message: "正在加载 TranslateGemma 模型…" });
        },
      });
    }
    const start = performance.now();
    const translated: string[] = [];
    for (const [index, text] of texts.entries()) {
      if (cancelled.has(id)) return;
      if (!text.trim()) { translated.push(""); continue; }
      send({ id, kind: "status", message: `TranslateGemma 正在本地翻译 ${index + 1}/${texts.length}…` });
      const paragraphs: string[] = [];
      for (const paragraph of text.trim().split(/\n\s*\n/u)) {
        const parts: string[] = [];
        for (const text of chunks(paragraph, translator)) {
          if (cancelled.has(id)) return;
          const messages = [{ role: "user", content: [{ type: "text", source_lang_code: "en", target_lang_code: "zh", text }] }];
          const output = await translator(messages, { max_new_tokens: 1024, do_sample: false, chat_template: TRADING_TEMPLATE });
          const first = output[0];
          const generated = first && "generated_text" in first ? first.generated_text : undefined;
          const content = Array.isArray(generated) ? generated.at(-1)?.content : undefined;
          if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回译文，请重试。");
          parts.push(content.trim());
        }
        paragraphs.push(parts.join(""));
      }
      translated.push(paragraphs.join("\n\n"));
    }
    if (!cancelled.has(id)) send({ id, kind: "result", result: { texts: translated, elapsedMs: performance.now() - start } });
  } catch (error) {
    send({ id, kind: "error", message: error instanceof Error ? error.message : "本地翻译失败，请重试。" });
  } finally { cancelled.delete(id); scheduled.delete(id); }
}

self.onmessage = ({ data }: MessageEvent<TranslationRequest>) => {
  if (data.kind === "cancel") { if (scheduled.has(data.id)) cancelled.add(data.id); }
  else { scheduled.add(data.id); queue = queue.then(() => translate(data)); }
};
