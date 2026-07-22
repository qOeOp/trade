export const PROGRAM_SHADOW_LAUNCHD_LABEL = "com.trade.program-shadow-supervisor"

export interface ProgramShadowLaunchdConfig {
  bun_path: string
  repository_root: string
  main_script_path: string
  trade_db_path: string
  ops_runtime_db_path: string
  stdout_path: string
  stderr_path: string
  interval_seconds: number
  duration_seconds?: number
}

export function renderProgramShadowLaunchAgent(config: ProgramShadowLaunchdConfig): string {
  const input = JSON.stringify({
    ops_runtime_db: config.ops_runtime_db_path,
    interval_seconds: config.interval_seconds,
    duration_seconds: config.duration_seconds ?? 0,
    observe_agent_parity: true,
  })
  const arguments_ = [
    config.bun_path,
    config.main_script_path,
    "--db",
    config.trade_db_path,
    "--run-program-shadow-supervisor",
    "--json",
    input,
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(PROGRAM_SHADOW_LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${arguments_.map((argument) => `    <string>${xml(argument)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TRADE_REPO_ROOT</key>
    <string>${xml(config.repository_root)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(config.stdout_path)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(config.stderr_path)}</string>
</dict>
</plist>
`
}

export function isMacOsProtectedUserPath(path: string, userHome: string): boolean {
  const root = userHome.replace(/\/$/, "")
  return ["Desktop", "Documents", "Downloads"]
    .map((name) => `${root}/${name}`)
    .some((protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`))
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
