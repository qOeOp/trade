export async function pumpCodexJsonLines(
  stream: ReadableStream<Uint8Array>,
  consume: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const newline = buffer.indexOf("\n")
      if (newline < 0) break
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) consume(line)
    }
    if (buffer.length > 4 * 1024 * 1024) throw new Error("Codex App Server stdout line exceeded limit")
  }
  const trailing = `${buffer}${decoder.decode()}`.trim()
  if (trailing) consume(trailing)
}

export async function drainCodexStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  while (!(await reader.read()).done) {
    // App Server stderr is intentionally drained without persistence.
  }
}
