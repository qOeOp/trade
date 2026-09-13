import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const dashboardRoot = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve(new URL("../node_modules/next/server.js", import.meta.url).href, context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, dashboardRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const route = await import("../app/api/rd/develop-composer/route.ts");
const TOKEN = "dashboard-composer-route-test-capability-0001";

function request(body, { authorization = `Bearer ${TOKEN}`, contentLength } = {}) {
  const text = JSON.stringify(body);
  return new Request("http://127.0.0.1/api/rd/develop-composer", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: text,
  });
}

test("Composer route fails closed without the independent operator capability", async (t) => {
  delete process.env.DASHBOARD_OPERATOR_API_TOKEN;
  t.after(() => delete process.env.DASHBOARD_OPERATOR_API_TOKEN);
  const response = await route.POST(request({ action: "RUN", research_request_locator: "research-1" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).unavailable_reason,
    "OPERATOR_CAPABILITY_CONFIGURATION_UNAVAILABLE");
});

test("Composer route bounds and strictly validates request bytes before dispatch", async (t) => {
  process.env.DASHBOARD_OPERATOR_API_TOKEN = TOKEN;
  t.after(() => delete process.env.DASHBOARD_OPERATOR_API_TOKEN);
  const oversized = await route.POST(request({ action: "RUN", research_request_locator: "research-1" },
    { contentLength: 4_097 }));
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).unavailable_reason, "EXECUTION_REQUEST_INVALID");
  const loose = await route.POST(request({
    action: "RUN", research_request_locator: "research-1", smuggled: true,
  }));
  assert.equal(loose.status, 400);
  assert.equal((await loose.json()).unavailable_reason, "EXECUTION_REQUEST_INVALID");
});
