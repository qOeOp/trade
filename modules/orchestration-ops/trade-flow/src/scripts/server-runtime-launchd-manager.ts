#!/usr/bin/env bun

import {
  inspectServerRuntimeLaunchd, installServerRuntimeLaunchd, restartServerRuntimeLaunchdComponent,
  uninstallServerRuntimeLaunchd,
} from "./lib/server-runtime-launchd-manager"

const values: Record<string, string> = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  if (!name?.startsWith("--") || value == null) throw new Error("arguments must be name/value pairs")
  const key = name.slice(2)
  if (!["action", "release-root", "bun-path", "component"].includes(key) || Object.hasOwn(values, key)) throw new Error(`invalid argument: ${name}`)
  values[key] = value
}
const action = values.action
if (!["plan", "install", "status", "uninstall", "restart-component"].includes(action)) throw new Error("unsupported launchd manager action")
if (!values["release-root"]) throw new Error("--release-root is required")
const input = { release_root: values["release-root"], bun_path: values["bun-path"] ?? process.execPath }
const result = action === "install" ? installServerRuntimeLaunchd(input)
  : action === "uninstall" ? uninstallServerRuntimeLaunchd(input)
    : action === "restart-component" ? restartServerRuntimeLaunchdComponent(
      input, values.component as "l2-owner" | "l2-consumer" | "control-runtime",
    )
      : inspectServerRuntimeLaunchd(input)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
