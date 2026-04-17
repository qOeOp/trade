#!/usr/bin/env bun

import { checkEnv, createClient, normalizeSymbol, parseBoolean, printJSON, readFlagValue, requireConfirmation, runScript } from "./shared"

interface Config {
  symbol: string
  market: "spot" | "usdm"
  orderId: number | null
  origClientOrderId: string
  algoId: number | null
  clientAlgoId: string
  all: boolean
  algo: boolean
  yes: boolean
  timeout: number
  checkEnv: boolean
}

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --market usdm --order-id 123456 --yes
  ./scripts/main.ts --symbol BTCUSDT --market usdm --algo --all --yes

Key flags:
  --symbol <symbol>                  Required. Example: BTCUSDT
  --market <spot|usdm>               Default: usdm
  --order-id <id>                    Regular order id
  --orig-client-order-id <id>        Regular client order id
  --algo-id <id>                     Futures algo order id
  --client-algo-id <id>              Futures algo client id
  --all                              Cancel all open orders in the selected bucket
  --algo                             Use futures algo cancel endpoints
  --timeout <ms>                     Default: 10000
  --check-env                        Only validate BINANCE_API_KEY / BINANCE_API_SECRET
  --yes                              Required for live cancellation
  --help                             Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = await run(argv)
  printJSON(response)
  if (!response.ok) {
    process.exit(1)
  }
}

async function run(argv: string[]) {
  return runScript(async () => {
    const config = parseArgs(argv)
    const envStatus = checkEnv()
    if (config.checkEnv) {
      return envStatus
    }
    if (!envStatus.ok) {
      throw new Error(`missing environment variables: ${envStatus.missing.join(", ")}`)
    }

    requireConfirmation(config.yes)
    const client = createClient({ requiresAuth: true, timeout: config.timeout })
    return executeCancel(config, client)
  })
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    market: "usdm",
    orderId: null,
    origClientOrderId: "",
    algoId: null,
    clientAlgoId: "",
    all: false,
    algo: false,
    yes: false,
    timeout: 10_000,
    checkEnv: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--symbol":
        config.symbol = normalizeSymbol(readFlagValue(argv, ++index, arg))
        break
      case "--market": {
        const market = readFlagValue(argv, ++index, arg).trim().toLowerCase()
        if (market !== "spot" && market !== "usdm") {
          throw new Error(`unsupported market: ${market}`)
        }
        config.market = market
        break
      }
      case "--order-id":
        config.orderId = Number(readFlagValue(argv, ++index, arg))
        break
      case "--orig-client-order-id":
        config.origClientOrderId = readFlagValue(argv, ++index, arg)
        break
      case "--algo-id":
        config.algoId = Number(readFlagValue(argv, ++index, arg))
        break
      case "--client-algo-id":
        config.clientAlgoId = readFlagValue(argv, ++index, arg)
        break
      case "--all":
        config.all = true
        break
      case "--algo":
        config.algo = true
        break
      case "--yes":
        config.yes = true
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      case "--check-env":
        config.checkEnv = true
        break
      case "--close-position":
        parseBoolean(readFlagValue(argv, ++index, arg), "--close-position")
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (!config.checkEnv) {
    validateConfig(config)
  }

  return config
}

async function executeCancel(config: Config, client: ReturnType<typeof createClient>) {
  if (config.market === "spot") {
    if (config.all) {
      const result = await client.cancelOpenOrders({ symbol: config.symbol })
      return {
        market: config.market,
        method: "cancelOpenOrders",
        result,
      }
    }

    const result = await client.cancelOrder({
      symbol: config.symbol,
      orderId: config.orderId ?? undefined,
      origClientOrderId: config.origClientOrderId || undefined,
    })
    return {
      market: config.market,
      method: "cancelOrder",
      result,
    }
  }

  if (config.algo || config.algoId || config.clientAlgoId) {
    if (config.all) {
      const result = await client.futuresCancelAllAlgoOpenOrders({ symbol: config.symbol })
      return {
        market: config.market,
        method: "futuresCancelAllAlgoOpenOrders",
        result,
      }
    }

    const result = await client.futuresCancelAlgoOrder({
      symbol: config.symbol,
      algoId: config.algoId ?? undefined,
      clientAlgoId: config.clientAlgoId || undefined,
    })
    return {
      market: config.market,
      method: "futuresCancelAlgoOrder",
      result,
    }
  }

  if (config.all) {
    const result = await client.futuresCancelAllOpenOrders({ symbol: config.symbol })
    return {
      market: config.market,
      method: "futuresCancelAllOpenOrders",
      result,
    }
  }

  const result = await client.futuresCancelOrder({
    symbol: config.symbol,
    orderId: config.orderId ?? undefined,
    origClientOrderId: config.origClientOrderId || undefined,
  })
  return {
    market: config.market,
    method: "futuresCancelOrder",
    result,
  }
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!config.all && config.orderId == null && !config.origClientOrderId && config.algoId == null && !config.clientAlgoId) {
    throw new Error("provide --all or one identifier such as --order-id, --orig-client-order-id, --algo-id, or --client-algo-id")
  }
  if (config.market === "spot" && (config.algo || config.algoId != null || config.clientAlgoId)) {
    throw new Error("spot cancel does not support futures algo identifiers")
  }
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    throw new Error("--timeout must be greater than 0")
  }
}

export {
  executeCancel,
  parseArgs,
  run,
}

if (require.main === module) {
  void main()
}
