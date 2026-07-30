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
    files: ["modules/**/*.ts", "scripts/**/*.ts"],
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
      "modules/research-strategy-development/replay-execution-plane/engine/src/lib/replay-exit-order-lane.ts",
      "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-fixed-partial-terminal-runner.ts",
      "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-protective-replacement-cycle-source-runner.ts",
    ],
    rules: {
      "no-useless-assignment": "off",
    },
  },
  {
    files: [
      "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-cancellation-outbox.ts",
      "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts",
    ],
    rules: {
      "preserve-caught-error": "off",
    },
  },
  {
    files: [
      "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.test.ts",
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
      "modules/orchestration-ops/trade-flow/src/scripts/lib/program-shadow-supervisor.ts",
      "modules/orchestration-ops/trade-flow/src/scripts/lib/program-shadow.ts",
      "modules/research-strategy-development/research-control-plane/certification/replay-release-audit/src/lib/replay-independent-release-audit.test.ts",
    ],
    rules: {
      "no-unsafe-finally": "off",
    },
  },
)
