import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/target/**",
      "data/**",
      "tmp/**",
    ],
  },
  {
    files: [".agents/skills/*/scripts/**/*.ts", "apps/**/*.ts", "scripts/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "apps/research-strategy-development/replay-execution-plane/engine/src/lib/replay-exit-order-lane.ts",
      "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-fixed-partial-terminal-runner.ts",
      "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-protective-replacement-cycle-source-runner.ts",
    ],
    rules: {
      "no-useless-assignment": "off",
    },
  },
  {
    files: [
      "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-cancellation-outbox.ts",
      "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts",
    ],
    rules: {
      "preserve-caught-error": "off",
    },
  },
  {
    files: [
      "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^(?:_|registryResolutionCount$)",
        },
      ],
    },
  },
  {
    files: [
      "apps/orchestration-ops/trade-flow/src/scripts/lib/program-shadow-supervisor.ts",
      "apps/orchestration-ops/trade-flow/src/scripts/lib/program-shadow.ts",
      "apps/research-strategy-development/research-control-plane/certification/replay-release-audit/src/lib/replay-independent-release-audit.test.ts",
    ],
    rules: {
      "no-unsafe-finally": "off",
    },
  },
)
