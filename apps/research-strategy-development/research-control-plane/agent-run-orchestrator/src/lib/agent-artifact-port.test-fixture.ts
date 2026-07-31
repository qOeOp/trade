import { createHash } from "node:crypto"
import type { AgentArtifactRef } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { AgentArtifactPort } from "./planner-agent-run"

export function memoryArtifacts(): AgentArtifactPort {
  const content = new Map<string, string>()
  return {
    put(text, mediaType) {
      const bytes = Buffer.from(text)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      const artifact: AgentArtifactRef = {
        ref: `memory-artifact://${sha256}`,
        sha256,
        media_type: mediaType,
        bytes: bytes.byteLength,
      }
      content.set(artifact.ref, text)
      return artifact
    },
    read(artifact) {
      const text = content.get(artifact.ref)
      if (text == null) throw new Error("missing artifact")
      return text
    },
  }
}
