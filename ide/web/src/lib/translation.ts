import TranslationWorker from "./translation.worker?worker&inline";
import type { TranslationReply, TranslationResult } from "./translation.worker";

type Pending = { resolve: (result: TranslationResult) => void; reject: (error: Error) => void; status: (message: string) => void };
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();

function reset(error: Error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  stopWorker();
}

function stopWorker() {
  if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = undefined; }
}

/** One lazily started model for the page. Its worker is inlined so exported HTML works too. */
export function translateToChinese(texts: string[], status: Pending["status"], signal: AbortSignal): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("翻译已取消。")); return; }
    if (!worker) {
      worker = new TranslationWorker();
      worker.onmessage = ({ data }: MessageEvent<TranslationReply>) => {
        const request = pending.get(data.id);
        if (!request) return;
        if (data.kind === "status") request.status(data.message);
        else {
          pending.delete(data.id);
          if (data.kind === "result") request.resolve(data.result);
          else {
            const error = new Error(data.message);
            request.reject(error);
            reset(error);
          }
        }
      };
      worker.onerror = () => reset(new Error("翻译模型无法运行，请重试。"));
    }
    const id = ++sequence;
    const abort = () => {
      pending.delete(id);
      reject(new Error("翻译已取消。"));
      if (pending.size) worker?.postMessage({ kind: "cancel", id });
      else stopWorker();
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    pending.set(id, {
      resolve: (result) => { cleanup(); resolve(result); },
      reject: (error) => { cleanup(); reject(error); }, status,
    });
    signal.addEventListener("abort", abort, { once: true });
    status(pending.size > 1 ? "等待本地翻译…" : "正在准备本地翻译…");
    worker.postMessage({ kind: "translate", id, texts });
  });
}
