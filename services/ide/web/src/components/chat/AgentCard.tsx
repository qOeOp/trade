import { PROVIDER_LABEL, type Agent, type AgentStatus, type Step } from "../../lib/agentApi";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/registry";
import type { DataRole, TextRole } from "../../theme/roles";
import { IconButton } from "../IconButton";
import { FormButton } from "./Field";

// One configured agent: its status (active only after its test passed for its current key, URL and
// models), provider and models, the steps of its last test, and its actions.
const STATUS: Record<AgentStatus, { icon: IconName; tone: DataRole | TextRole; label: string }> = {
  active: { icon: "passed", tone: "meets", label: "Active" },
  untested: { icon: "untested", tone: "fg-faint", label: "Untested" },
  failed: { icon: "failed", tone: "fail", label: "Failed" },
};
const STEP: Record<Step["name"], string> = { key: "Key", reply: "Reply", tools: "Tools" };

// The steps as a grid, so every detail starts in one column whatever its step's label.
function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <div className="grid grid-cols-[auto_max-content_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-0.5 text-dense">
      {steps.map((s, i) => [
        <Icon key={`i${i}`} name={s.ok ? "passed" : "failed"} size={12} tone={s.ok ? "meets" : "fail"} className="self-center" />,
        <span key={`s${i}`} className="text-fg-muted">{STEP[s.name]}{s.model ? ` · ${s.model}` : ""}</span>,
        <span key={`d${i}`} className={`[overflow-wrap:anywhere] ${s.ok ? "text-fg-faint" : "text-fail"}`}>{s.detail}</span>,
      ])}
    </div>
  );
}

export function AgentCard({ agent, testing, onTest, onEdit, onDelete }: {
  agent: Agent; testing: boolean; onTest: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const status = STATUS[agent.status];
  const tested = agent.probe && agent.status !== "untested";
  return (
    <div className="space-y-2 rounded-card border border-card-border bg-island-alt px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name={status.icon} tone={status.tone} />
        <span className="truncate font-semibold">{agent.name}</span>
        <span className="shrink-0 text-dense text-fg-faint">{PROVIDER_LABEL[agent.provider]}</span>
        <span className="ml-auto flex shrink-0 gap-0.5">
          <IconButton icon="edit" label="Edit" onClick={onEdit} />
          <IconButton icon="delete" label="Delete" onClick={onDelete} />
        </span>
      </div>
      <div className="text-dense text-fg-muted">
        {status.label}{tested ? ` · tested ${agent.probe!.at.slice(0, 16).replace("T", " ")} UTC` : ""} · key {agent.keyHint}
      </div>
      <div className="flex flex-wrap gap-1">
        {agent.models.map((m) => (
          <span key={m} className={`rounded-badge border border-line px-1.5 font-mono text-dense ${agent.usable.includes(m) ? "text-fg" : "text-fg-faint"}`}>
            {m}{m === agent.defaultModel ? " · default" : ""}
          </span>
        ))}
        {agent.models.length === 0 && <span className="text-dense text-fg-faint">No model chosen</span>}
      </div>
      {tested && <Steps steps={agent.probe!.steps} />}
      <FormButton onClick={onTest} disabled={testing || agent.models.length === 0}>
        {testing ? "Testing…" : "Test"}
      </FormButton>
    </div>
  );
}
