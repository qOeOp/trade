import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(
  new URL("../../rd-workbench/docker-compose.yml", import.meta.url),
  "utf8",
);
const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

function serviceBlock(serviceName) {
  const marker = `  ${serviceName}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `${serviceName} service is missing`);
  const remainder = compose.slice(start + marker.length);
  const nextService = remainder.search(/^  [a-z0-9][a-z0-9-]*:\n/m);
  return remainder.slice(0, nextService === -1 ? undefined : nextService);
}

test("Dashboard image and migration are opt-in Compose services", () => {
  const migration = serviceBlock("dashboard-run-store-migrate");
  const dashboard = serviceBlock("dashboard-web");
  const worker = serviceBlock("dashboard-shadow-worker");
  const scheduler = serviceBlock("dashboard-shadow-scheduler");
  const effectWorker = serviceBlock("dashboard-effect-worker");

  for (const block of [migration, dashboard, worker, scheduler, effectWorker]) {
    assert.match(block, /profiles: \["dashboard-preview"\]/);
    assert.match(block, /image: trade-dashboard:\$\{DASHBOARD_IMAGE_TAG:-preview\}/);
    assert.match(block, /DASHBOARD_DATABASE_URL: \$\{DASHBOARD_DATABASE_URL:-\}/);
  }

  assert.doesNotMatch(migration, /\n\s+build:/);
  assert.match(migration, /pull_policy: never/);
  assert.match(migration, /command: \["npm", "run", "run-store:migrate"\]/);
  assert.match(dashboard, /context: \.\./);
  assert.match(dashboard, /dockerfile: dashboard\/Dockerfile/);
  assert.match(dashboard, /dashboard-run-store-migrate:\n\s+condition: service_completed_successfully/);
  assert.match(dashboard, /127\.0\.0\.1:\$\{DASHBOARD_PORT:-3100\}:3100/);
  assert.match(dashboard, /RD_OWNER_API_URL: \$\{RD_OWNER_API_URL:-http:\/\/rd-owner-api:8080\}/);
  assert.match(dashboard, /read_only: true/);
  assert.match(dashboard, /cap_drop:\n\s+- ALL/);

  assert.match(worker, /command: \["npm", "run", "shadow-runtime", "--", "worker"\]/);
  assert.match(worker, /dashboard-run-store-migrate:\n\s+condition: service_completed_successfully/);
  assert.match(worker, /rd-owner-api:\n\s+condition: service_healthy/);
  assert.match(worker, /DASHBOARD_SHADOW_WORKER_TOKEN: \$\{DASHBOARD_SHADOW_WORKER_TOKEN:-\}/);
  assert.match(worker, /test -f \/tmp\/dashboard-shadow-worker\.ready/);
  assert.match(scheduler, /command: \["npm", "run", "shadow-runtime", "--", "scheduler"\]/);
  assert.match(scheduler, /DASHBOARD_SHADOW_SCHEDULES_JSON:/);
  assert.match(scheduler, /DASHBOARD_SCHEDULER_CAPABILITY_DIGEST:/);
  assert.match(scheduler, /test -f \/tmp\/dashboard-shadow-scheduler\.ready/);
  assert.match(effectWorker, /command: \["npm", "run", "effect-runtime"\]/);
  assert.match(effectWorker, /rd-owner-api:\n\s+condition: service_healthy/);
  assert.match(effectWorker, /DASHBOARD_EFFECT_WORKER_TOKEN:/);
  assert.match(effectWorker, /DASHBOARD_EFFECT_WORKER_ID: \$\{DASHBOARD_EFFECT_WORKER_ID:-\}/);
  assert.match(effectWorker, /DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST: \$\{DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST:-\}/);
  assert.match(effectWorker, /DASHBOARD_DISPOSABLE_ARTIFACT_EXECUTION: \$\{DASHBOARD_DISPOSABLE_ARTIFACT_EXECUTION:-\}/);
  assert.match(effectWorker, /DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION:[\s\S]+\$\{DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION:-\}/);
  assert.match(effectWorker, /DASHBOARD_DISPOSABLE_EXPLORATORY_REPLAY_EXECUTION:[\s\S]+\$\{DASHBOARD_DISPOSABLE_EXPLORATORY_REPLAY_EXECUTION:-\}/);
  assert.match(effectWorker, /DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION:[\s\S]+\$\{DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION:-\}/);
  assert.match(dashboard, /DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION:[\s\S]+\$\{DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION:-\}/);
  assert.doesNotMatch(effectWorker, /PRODUCT_EDGE_ROUTING_READ_API_(?:URL|TOKEN)/);
  assert.match(effectWorker, /test -f \/tmp\/dashboard-effect-worker\.ready/);
  assert.doesNotMatch(dashboard, /DEEPSEEK_API_KEY/);
  assert.doesNotMatch(dashboard, /DASHBOARD_EFFECT_WORKER_(?:ID|TOKEN|ARTIFACT_DIGEST)/);
  assert.match(effectWorker, /DEEPSEEK_API_KEY:/);
  assert.doesNotMatch(effectWorker, /DASHBOARD_(?:LOCAL_OPERATOR_LOGIN_TOKEN|SESSION_HMAC_KEY|MCP_API_TOKEN|OPERATOR_API_TOKEN)/);
  for (const block of [worker, scheduler, effectWorker]) {
    assert.match(block, /pull_policy: never/);
    assert.match(block, /read_only: true/);
    assert.match(block, /cap_drop:\n\s+- ALL/);
    assert.doesNotMatch(block, /ports:/);
  }
});

test("effect worker image command resolves to the packaged bounded runtime", () => {
  assert.equal(packageManifest.scripts?.["effect-runtime"], "node scripts/run-effect-worker.mjs");
});

test("effect and MCP capabilities are scoped to their exact runtime roles", () => {
  const dashboard = serviceBlock("dashboard-web");
  const effectWorker = serviceBlock("dashboard-effect-worker");

  for (const name of [
    "DASHBOARD_EFFECT_WORKER_ID",
    "DASHBOARD_EFFECT_WORKER_TOKEN",
    "DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST",
    "DEEPSEEK_API_KEY",
  ]) assert.equal(effectWorker.match(new RegExp(`^\\s{6}${name}:`, "gmu"))?.length, 1, name);
  for (const name of [
    "DASHBOARD_MCP_API_TOKEN",
    "DASHBOARD_MCP_PRINCIPAL_REF",
    "DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS",
    "DASHBOARD_MCP_ALLOWED_HOSTNAMES",
    "DASHBOARD_MCP_ALLOWED_ORIGIN_HOSTNAMES",
  ]) {
    assert.match(dashboard, new RegExp(`^\\s{6}${name}:`, "mu"), name);
    assert.doesNotMatch(effectWorker, new RegExp(`^\\s{6}${name}:`, "mu"), name);
  }
});

test("Artifact and Research reads share one GET-only Dashboard Compose service", () => {
  const dashboardRead = serviceBlock("rd-dashboard-owner-read-api");
  const dashboard = serviceBlock("dashboard-web");

  assert.match(dashboardRead, /profiles: \["dashboard-preview"\]/);
  assert.match(dashboardRead, /strategy-factory-rd-dashboard-read-api/);
  assert.match(dashboardRead, /RD_DASHBOARD_OWNER_READ_DATABASE_URL:/);
  assert.match(dashboardRead, /RD_DASHBOARD_OWNER_READ_API_TOKEN:/);
  assert.match(dashboardRead, /RD_DASHBOARD_SOURCE_INTAKE_PRODUCT_EDGE_DATABASE_URL:/);
  assert.match(dashboardRead, /RD_DASHBOARD_SOURCE_INTAKE_REQUEST_PROOF:/);
  assert.match(
    dashboardRead,
    /authority-custody-migrate:\n\s+condition: service_completed_successfully/,
  );
  assert.match(dashboardRead, /expose:\n\s+- 8082/);
  assert.doesNotMatch(dashboardRead, /ports:/);
  assert.match(dashboardRead, /read_only: true/);
  assert.match(dashboardRead, /cap_drop:\n\s+- ALL/);

  assert.match(dashboard, /rd-dashboard-owner-read-api:\n\s+condition: service_healthy/);
  assert.match(
    dashboard,
    /RD_DASHBOARD_OWNER_READ_API_URL:[\s\S]*http:\/\/rd-dashboard-owner-read-api:8082/,
  );
  assert.match(
    dashboard,
    /RD_DASHBOARD_OWNER_READ_API_TOKEN: \$\{RD_DASHBOARD_OWNER_READ_API_TOKEN:-\}/,
  );
  assert.doesNotMatch(compose, /rd-(?:artifact|research)-owner-read-api:/);
  assert.doesNotMatch(compose, /RD_(?:ARTIFACT|RESEARCH)_OWNER_READ_API_/);
});

test("Windmill remains independent of the opt-in Dashboard profile", () => {
  const server = serviceBlock("windmill-server");
  const worker = serviceBlock("windmill-worker");

  assert.doesNotMatch(server, /dashboard-(?:web|run-store-migrate|shadow-worker|shadow-scheduler|effect-worker)/);
  assert.doesNotMatch(worker, /dashboard-(?:web|run-store-migrate|shadow-worker|shadow-scheduler|effect-worker)/);
  assert.doesNotMatch(server, /profiles:/);
  assert.doesNotMatch(worker, /profiles:/);
  assert.match(server, /MODE: server/);
  assert.match(worker, /MODE: worker/);
});
