export const OPENCLAW_SMOKE_VERSION = "2026.7.1"

export function createOpenClawCodeSmokeConfig(input: {
  workspace: string
  gateway_port?: number
}): Record<string, unknown> {
  return {
    ...(input.gateway_port == null
      ? {}
      : {
          gateway: {
            mode: "local",
            bind: "loopback",
            port: input.gateway_port,
            auth: {
              token: {
                source: "env",
                provider: "default",
                id: "OPENCLAW_GATEWAY_TOKEN",
              },
            },
            controlUi: { enabled: false },
            http: {
              endpoints: {
                responses: {
                  enabled: true,
                  files: { allowUrl: false },
                  images: { allowUrl: false },
                },
                chatCompletions: { enabled: false },
              },
            },
          },
        }),
    update: { checkOnStart: false },
    plugins: { enabled: false, slots: { memory: "none" } },
    models: {
      mode: "merge",
      providers: {
        siliconflow: {
          baseUrl: "https://api.siliconflow.cn/v1",
          apiKey: {
            source: "env",
            provider: "default",
            id: "SILICONFLOW_API_KEY",
          },
          api: "openai-completions",
          timeoutSeconds: 600,
          models: [{
            id: "Qwen/Qwen3.5-27B",
            name: "Qwen3.5 27B via SiliconFlow",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 131072,
            maxTokens: 32768,
          }],
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: "siliconflow/Qwen/Qwen3.5-27B",
          fallbacks: [],
        },
        skills: [],
        skipBootstrap: true,
        timeoutSeconds: 600,
        thinkingDefault: "high",
        reasoningDefault: "off",
        sandbox: { mode: "off" },
      },
      list: [{
        id: "rd-developer-code",
        default: true,
        workspace: input.workspace,
        skills: [],
        tools: {
          profile: "coding",
          allow: ["read", "write", "edit", "apply_patch"],
          deny: [
            "group:runtime",
            "group:web",
            "group:sessions",
            "group:automation",
            "group:messaging",
            "group:nodes",
            "group:agents",
            "group:media",
            "group:ui",
          ],
        },
      }],
    },
    tools: {
      profile: "minimal",
      deny: [
        "browser",
        "canvas",
        "cron",
        "gateway",
        "sessions_spawn",
        "subagents",
        "exec",
        "process",
        "code_execution",
      ],
      fs: { workspaceOnly: true },
    },
  }
}
