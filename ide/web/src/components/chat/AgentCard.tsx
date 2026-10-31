import { Fragment } from "react";
import { PROVIDER_LABEL, type Agent, type AgentStatus, type Step } from "../../lib/agentApi";
import { BRAND_TONE } from "../../icons/brands";
import { BrandMark, Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/registry";
import type { DataRole, TextRole } from "../../theme/roles";
import { IconButton } from "../IconButton";
import { FormButton } from "./Field";

// One configured agent: its provider's mark and name, its status (active only after its test passed
// for its current key, URL and models), its models, the steps of its last test, and its actions.
const STATUS: Record<AgentStatus, { icon: IconName; tone: DataRole | TextRole; label: string }> = {
  active: { icon: "passed", tone: "meets", label: "Active" },
  untested: { icon: "untested", tone: "fg-faint", label: "Untested" },
  failed: { icon: "failed", tone: "fail", label: "Failed" },
};
const STEP: Record<Step["name"], string> = { key: "Key", reply: "Reply", tools: "Tools" };

// One step: its icon centred on the first line (a wrapped detail must not pull it down), its name and
// what happened, the details in one column.
function StepRow({ step }: { step: Step }) {
  return <>
    <span className="grid h-4.5 place-items-center"><Icon name={step.ok ? "passed" : "failed"} size={12} tone={step.ok ? "meets" : "fail"} /></span>
    <span className="text-fg-muted">{STEP[step.name]}</span>
    <span className={`[overflow-wrap:anywhere] ${step.ok ? "text-fg-faint" : "text-fail"}`}>{step.detail}</span>
  </>;
}

// The steps that test the key, then each model's steps under its name.
function Steps({ steps }: { steps: readonly Step[] }) {
  const models = [...new Set(steps.flatMap((s) => (s.model ? [s.model] : [])))];
  return (
    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-1.5 gap-y-0.5 text-dense">
      {steps.filter((s) => !s.model).map((s, i) => <StepRow key={`k${i}`} step={s} />)}
      {models.map((m) => (
        <Fragment key={m}>
          <span className="col-span-3 pt-1 font-mono text-small text-fg-faint">{m}</span>
          {steps.filter((s) => s.model === m).map((s, i) => <StepRow key={`${m}${i}`} step={s} />)}
        </Fragment>
      ))}
    </div>
  );
}

export function AgentCard({ agent, testing, onTest, onEdit, onDelete }: {
  agent: Agent; testing: boolean; onTest: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const status = STATUS[agent.status];
  const tested = agent.probe && agent.status !== "untested";
  const provider = PROVIDER_LABEL[agent.provider];
  return (
    <div className="space-y-2 rounded-card border border-card-border bg-island-alt px-3 pt-2 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark name={agent.provider} tone={BRAND_TONE[agent.provider]} />
        <span className="truncate font-semibold">{agent.name}</span>
        {!agent.name.startsWith(provider) && <span className="shrink-0 text-dense text-fg-faint">{provider}</span>}
        <span className="ml-auto flex shrink-0 gap-0.5">
          <IconButton icon="edit" label="Edit" onClick={onEdit} />
          <IconButton icon="delete" label="Delete" onClick={onDelete} />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-dense text-fg-muted">
        <Icon name={status.icon} size={12} tone={status.tone} />
        <span className="min-w-0">{status.label}{tested ? ` · tested ${agent.probe!.at.slice(0, 16).replace("T", " ")} UTC` : ""} · key {agent.keyHint}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {agent.models.map((m) => (
          <span key={m} className={`rounded-badge bg-pressed px-1.5 font-mono text-dense ${agent.usable.includes(m) ? "text-fg" : "text-fg-faint"}`}>
            {m}{m === agent.defaultModel && <span className="text-fg-faint"> · default</span>}
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
