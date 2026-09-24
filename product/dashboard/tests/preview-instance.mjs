// Starting a Dashboard server for a test, and knowing that the server answering is that one.
//
// A preview used to listen on a port the suite picked - a fixed number, or one free a moment
// before - and was taken as ready once anything on that port answered 200. Two suites running on
// one machine then shared a port: the second server exited with EADDRINUSE, and its test went on
// driving the first suite's server. Here the server takes a port the system assigns (`-p 0`), the
// test reads the port the server announces, and it is ready only when its health route echoes the
// nonce this start gave it.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export const INSTANCE_NONCE_HEADER = "x-dashboard-instance-nonce";

const ANNOUNCED = /- Local:\s+(http:\/\/127\.0\.0\.1:(\d+))/u;

export function newInstanceNonce() {
  return randomBytes(16).toString("hex");
}

/**
 * Resolves the origin a Next server announces on its stdout, which must be piped. Everything the
 * server writes is forwarded to `forward` as well, so its log stays where it was.
 */
export function announcedOrigin(child, { timeoutMs = 120_000, label = "preview", forward = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    let seen = "";
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", exited);
      settle(value);
    };
    const exited = (code) => finish(reject, new Error(`${label} exited with ${code} before announcing its address`));
    const timer = setTimeout(
      () => finish(reject, new Error(`${label} announced no address in ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      forward?.write(chunk);
      if (settled) return;
      seen = `${seen}${chunk}`.slice(-4_096);
      const match = ANNOUNCED.exec(seen);
      if (match) finish(resolve, match[1]);
    });
    child.once("exit", exited);
  });
}

/**
 * Waits until `origin` answers as the server started with `nonce`. An answer from any other server
 * fails at once: that is the case this exists to catch, and waiting longer would not change it.
 */
export async function waitForOwnInstance(origin, child, nonce, { timeoutMs = 120_000, label = "preview" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    let response = null;
    try {
      response = await fetch(`${origin}/api/health/`, { signal: AbortSignal.timeout(5_000) });
    } catch {
      // Still starting.
    }
    if (response?.ok) {
      const answered = response.headers.get(INSTANCE_NONCE_HEADER);
      if (answered === nonce) return;
      throw new Error(`${label}: ${origin} is answered by another server (instance ${answered ?? "unnamed"})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not become ready at ${origin}`);
}

/**
 * Starts `next <mode>` for the Dashboard at `dashboardRoot` on a port the system assigns, and
 * resolves once it answers as the instance started here. `env` is layered over the process
 * environment; the instance nonce is always this start's own. A `detached` server leads its own
 * process group, so its caller can stop the whole tree; its stdout goes to `forward`.
 */
export async function startNextServer({
  dashboardRoot, mode, env = {}, label = "preview", detached = false, forward = process.stdout,
}) {
  const nonce = newInstanceNonce();
  const child = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", mode, "-H", "127.0.0.1", "-p", "0",
  ], {
    cwd: dashboardRoot,
    env: {
      ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env, DASHBOARD_INSTANCE_NONCE: nonce,
    },
    stdio: ["ignore", "pipe", "inherit"],
    detached,
  });
  try {
    const origin = await announcedOrigin(child, { label, forward });
    await waitForOwnInstance(origin, child, nonce, { label });
    return { child, origin };
  } catch (error) {
    if (child.exitCode === null) {
      try {
        process.kill(detached ? -child.pid : child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    throw error;
  }
}
