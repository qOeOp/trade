import { Dropdown, DropdownLabel, DropdownRadio, DropdownSeparator } from "../Dropdown";
import type { ModelOption } from "../../state/agent";

// The model the next message goes to: every model of every active agent, grouped by agent. Changing
// it mid-thread is allowed; the next answer names the model that wrote it.
export function ModelPicker({ options, value, onChange }: { options: readonly ModelOption[]; value: ModelOption | null; onChange: (o: ModelOption) => void }) {
  const groups = [...new Map(options.map((o) => [o.agent, o.name]))].map(([agent, name]) => ({ agent, name, items: options.filter((o) => o.agent === agent) }));
  const key = (o: ModelOption) => `${o.agent}\n${o.model}`;
  return (
    <Dropdown label="Model" variant="widget" align="start"
      trigger={<span className="min-w-0 truncate text-dense text-fg-muted">{value ? value.model : "No active agent"}</span>}>
      {groups.map((group, i) => (
        <div key={group.agent}>
          {i > 0 && <DropdownSeparator />}
          <DropdownLabel>{group.name}</DropdownLabel>
          <DropdownRadio value={value ? key(value) : ""} options={group.items.map((o) => ({ value: key(o), label: o.model }))}
            onChange={(k) => { const o = options.find((x) => key(x) === k); if (o) onChange(o); }} />
        </div>
      ))}
    </Dropdown>
  );
}
