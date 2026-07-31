export interface ForegroundChild {
  readonly exited: Promise<number>
  readonly exitCode: number | null
  kill(signal: NodeJS.Signals): void
}

export interface ForegroundSignalHost {
  on(signal: NodeJS.Signals, handler: () => void): unknown
  off(signal: NodeJS.Signals, handler: () => void): unknown
}

export async function drainForegroundChild(
  child: ForegroundChild,
  host: ForegroundSignalHost = process,
  signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"],
): Promise<number> {
  const handlers = new Map<NodeJS.Signals, () => void>()
  try {
    for (const signal of signals) {
      const handler = (): void => {
        if (child.exitCode == null) child.kill(signal)
      }
      handlers.set(signal, handler)
      host.on(signal, handler)
    }
    return await child.exited
  } finally {
    for (const [signal, handler] of handlers) host.off(signal, handler)
  }
}
