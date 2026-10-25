// node src/main.ts --product=ROOT --ledger=PROFILE [--market=PROFILE] --data=DIR [--host=127.0.0.1] [--port=8766]
//
// The trade IDE's chat service. `ide.py serve --agent=http://HOST:PORT` forwards the page's
// /api/agent requests here. DIR holds the agents (with their keys) and the threads; it is created
// 0700 and never published.
import { serve } from "@hono/node-server";
import { parseArgs } from "node:util";
import { AgentStore } from "./agents.ts";
import { app } from "./app.ts";
import { languageModel, listModels } from "./providers.ts";
import { ThreadStore } from "./threads.ts";
import { productTools } from "./tools.ts";
import { privateDir } from "./files.ts";

const { values } = parseArgs({
  options: {
    product: { type: "string" }, ledger: { type: "string" }, market: { type: "string" },
    data: { type: "string" }, host: { type: "string", default: "127.0.0.1" }, port: { type: "string", default: "8766" },
  },
});
if (!values.product || !values.ledger || !values.data) {
  console.error("usage: node src/main.ts --product=ROOT --ledger=PROFILE [--market=PROFILE] --data=DIR [--host=H] [--port=P]");
  process.exit(2);
}
const port = Number(values.port);
const data = privateDir(values.data);
const product = { root: values.product, ledger: values.ledger, market: values.market ?? null };
const hosts = new Set([`${values.host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`]);

serve({
  fetch: app({
    agents: new AgentStore(data), threads: new ThreadStore(data), hosts,
    chat: { model: languageModel, tools: productTools(product) },
    probe: { list: listModels, model: languageModel },
  }).fetch,
  hostname: values.host, port,
}, () => console.error(`trade IDE agents on ${product.ledger} at http://${values.host}:${port}/api/agent`));
