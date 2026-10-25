import { BrandMark } from "../../icons/Icon";
import { Dropdown, DropdownLabel, DropdownRadio, DropdownSeparator } from "../Dropdown";
import type { ModelOption } from "../../state/agent";

// The model the next message goes to: every model of every active agent, grouped by agent under its
// provider's mark. Changing it mid-thread is allowed; the next answer names the model that wrote it.
export function ModelPicker({ options, value, onChange }: { options: readonly ModelOption[]; value: ModelOption | null; onChange: (o: ModelOption) => void }) {
  const groups = [...new Map(options.map((o) => [o.agent, o]))].map(([agent, first]) => ({ agent, first, items: options.filter((o) => o.agent === agent) }));
  const key = (o: ModelOption) => `${o.agent}\n${o.model}`;
  return (
    <Dropdown label="Model" variant="compact" align="start"
      trigger={<span className="flex min-w-0 items-center gap-1 text-dense text-fg-muted">
        {value && <BrandMark name={value.provider} size={12} />}<span className="truncate">{value ? value.model : "No active agent"}</span>
      </span>}>
      {groups.map((group, i) => (
        <div key={group.agent}>
          {i > 0 && <DropdownSeparator />}
          <DropdownLabel><span className="inline-flex items-center gap-1"><BrandMark name={group.first.provider} size={12} />{group.first.name}</span></DropdownLabel>
          <DropdownRadio value={value ? key(value) : ""} options={group.items.map((o) => ({ value: key(o), label: o.model }))}
            onChange={(k) => { const o = options.find((x) => key(x) === k); if (o) onChange(o); }} />
        </div>
      ))}
    </Dropdown>
  );
}
