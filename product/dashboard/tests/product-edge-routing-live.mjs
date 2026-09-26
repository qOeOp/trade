// Resolves one routing key through the Dashboard's own client against a live Product Edge
// routing read port and prints the observation as one JSON line. The ordered Owner chain runs it
// (crates/product_edge_routing_api/src/postgres_tests.rs) so the client that gates a fresh RUN is
// the one judging the bytes Product Edge serves. It is not a `*.test.mjs` file: without the
// chain's environment it has nothing to resolve, and it refuses rather than passing empty.
import { resolveProductEdgeRoutingV1 } from "../lib/product-edge-routing-client.ts";

const required = [
  "PRODUCT_EDGE_ROUTING_READ_API_URL",
  "PRODUCT_EDGE_ROUTING_READ_API_TOKEN",
  "PRODUCT_EDGE_DEPLOYMENT_IDENTITY",
  "PRODUCT_EDGE_ROUTING_LIVE_OPERATION",
  "PRODUCT_EDGE_ROUTING_LIVE_VERSION",
  "PRODUCT_EDGE_ROUTING_LIVE_CHANNEL",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`missing ${missing.join(", ")}`);
  process.exit(2);
}

const observation = await resolveProductEdgeRoutingV1({
  operation: process.env.PRODUCT_EDGE_ROUTING_LIVE_OPERATION,
  version: Number(process.env.PRODUCT_EDGE_ROUTING_LIVE_VERSION),
  channel: process.env.PRODUCT_EDGE_ROUTING_LIVE_CHANNEL,
});
console.log(JSON.stringify(observation));
