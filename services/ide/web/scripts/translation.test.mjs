import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
}).outputText;

function client() {
  const workers = [];
  class Worker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage?.({ data }); }
  }
  const exports = {};
  runInNewContext(source("../src/lib/translation.ts"), {
    exports, require: () => ({ default: Worker }),
  });
  const run = (text, controller) => exports.translateToChinese([text], () => {}, controller.signal);
  return { run, workers };
}

const result = (worker, id, text) => worker.reply({ id, kind: "result", result: { texts: [text], elapsedMs: 1 } });

test("cancelling one card group leaves another queued translation intact", async () => {
  const { run, workers } = client();
  const a = new AbortController(), b = new AbortController();
  const first = run("Change", a), second = run("Conclusion", b);
  assert.equal(workers.length, 1);
  const worker = workers[0];
  const [requestA, requestB] = worker.messages;
  const cancelled = assert.rejects(first, /翻译已取消/);
  a.abort();
  await cancelled;
  assert.equal(worker.terminated, false);
  assert.equal(worker.messages.at(-1).kind, "cancel");
  assert.equal(worker.messages.at(-1).id, requestA.id);
  result(worker, requestA.id, "stale response");
  result(worker, requestB.id, "结论");
  assert.deepEqual((await second).texts, ["结论"]);
  b.abort();
  assert.equal(worker.terminated, false, "a settled request must detach its abort listener");
});

test("cancelling the last request stops its worker and a retry creates a fresh worker", async () => {
  const { run, workers } = client();
  const controller = new AbortController();
  const pending = run("Change", controller);
  const cancelled = assert.rejects(pending, /翻译已取消/);
  controller.abort();
  await cancelled;
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].onmessage, null);
  const retry = run("Conclusion", new AbortController());
  assert.equal(workers.length, 2);
  result(workers[1], workers[1].messages[0].id, "重试成功");
  assert.deepEqual((await retry).texts, ["重试成功"]);
});

test("a worker failure rejects all waiting groups and permits a fresh retry", async () => {
  const { run, workers } = client();
  const first = run("Change", new AbortController()), second = run("Conclusion", new AbortController());
  const failed = Promise.all([assert.rejects(first, /无法运行/), assert.rejects(second, /无法运行/)]);
  workers[0].onerror();
  await failed;
  assert.equal(workers[0].terminated, true);
  const retry = run("Conclusion", new AbortController());
  result(workers[1], workers[1].messages[0].id, "结论");
  assert.deepEqual((await retry).texts, ["结论"]);
});

test("long prose chunks preserve word order and numeric identifiers within the input budget", () => {
  const context = { exports: {}, self: {}, Intl };
  runInNewContext(source("../src/lib/translation.worker.ts"), context);
  const tokenizer = { encode: (text) => text.trim().split(/\s+/) };
  const text = Array.from({ length: 120 }, (_, i) => `Keep EMA10/20 and 40000 USDT in sentence ${i}.`).join(" ");
  const chunks = context.chunks(text, { tokenizer });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(" "), text);
  assert.ok(chunks.every((chunk) => tokenizer.encode(chunk).length <= 384));
});
