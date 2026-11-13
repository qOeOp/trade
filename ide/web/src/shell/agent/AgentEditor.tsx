import { useState } from "react";
import { Checklist, FieldLabel, FormButton, TextField } from "../../components/chat/Field";
import { Segmented } from "../../components/Segmented";
import { agentApi, errorText, PROVIDER_LABEL, PROVIDERS, type Agent, type Provider } from "../../lib/agentApi";
import { replaceAgent } from "../../state/agent";
import { BRAND_TONE } from "../../icons/brands";
import { BrandMark } from "../../icons/Icon";

// Adding or editing an agent. The key is write-only: an existing agent shows only its last four
// characters and an empty field keeps it, except when the provider or base URL changes: the
// service then refuses without the key, so a stored key never goes to a new destination. Models come from the provider's own list once the key is
// saved; choosing them and a default, then testing, makes the agent active.
const URL_HINT: Record<Provider, string> = {
  deepseek: "https://api.deepseek.com", openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1",
};

export function AgentEditor({ agent, onDone }: { agent: Agent | null; onDone: (saved: Agent | null) => void }) {
  const [name, setName] = useState(agent?.name ?? "");
  const [provider, setProvider] = useState<Provider>(agent?.provider ?? PROVIDERS[0]);
  const [key, setKey] = useState("");
  const [baseURL, setBaseURL] = useState(agent?.baseURL ?? "");
  const [saved, setSaved] = useState<Agent | null>(agent);
  const [listed, setListed] = useState<string[]>(agent?.models ?? []);
  const [models, setModels] = useState(new Set(agent?.models ?? []));
  const [star, setStar] = useState(agent?.defaultModel ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moved = saved !== null && (provider !== saved.provider || (baseURL.trim() || null) !== saved.baseURL);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const fields = () => ({ name: name.trim() || PROVIDER_LABEL[provider], provider, baseURL: baseURL.trim() || null, models: [...models], defaultModel: star });
  // Saving the credentials first lets the service ask the provider for its models with the stored key.
  const saveAndList = () => run(async () => {
    const agentNow = saved
      ? await agentApi<Agent>(`/agents/${saved.id}`, { method: "PUT", body: { ...fields(), key } })
      : await agentApi<Agent>("/agents", { method: "POST", body: { ...fields(), key } });
    setSaved(agentNow); replaceAgent(agentNow); setKey("");
    setListed((await agentApi<{ models: string[] }>(`/agents/${agentNow.id}/models`, { method: "POST", body: {} })).models);
  });
  const finish = () => run(async () => {
    const agentNow = await agentApi<Agent>(`/agents/${saved!.id}`, { method: "PUT", body: fields() });
    replaceAgent(agentNow); onDone(agentNow);
  });
  const toggle = (m: string) => {
    const next = new Set(models);
    if (next.has(m)) next.delete(m); else next.add(m);
    setModels(next);
    if (!next.has(star ?? "")) setStar([...next][0] ?? null);
  };

  return (
    <div className="space-y-3 rounded-card border border-card-border bg-island-alt p-3">
      <h3 className="font-semibold">{agent ? `Edit ${agent.name}` : "Add an agent"}</h3>
      {/* The chosen provider's mark in its own colour, the others in the text colour. */}
      <div className="space-y-1">
        <FieldLabel>Provider</FieldLabel>
        <Segmented label="Provider" value={provider} onChange={(p) => { setProvider(p); if (!saved) setListed([]); }}
          items={PROVIDERS.map((p) => ({ id: p, label: <><BrandMark name={p} tone={p === provider ? BRAND_TONE[p] : undefined} /><span className="truncate">{PROVIDER_LABEL[p]}</span></> }))} />
      </div>
      <TextField label="Name" value={name} suggest={PROVIDER_LABEL[provider]} onValue={setName} />
      <TextField label="API key" type="password" autoComplete="off" value={key} onValue={setKey}
        placeholder={saved ? (moved ? "needed again for a new provider or URL" : `ends ${saved.keyHint}, empty keeps it`) : "never shown again"} />
      <TextField label="Base URL" value={baseURL} suggest={URL_HINT[provider]} onValue={setBaseURL}
        hint="Only for a proxy or a compatible gateway." />
      <FormButton icon={saved ? "retry" : undefined} disabled={busy || ((!saved || moved) && key.trim().length < 8)} onClick={() => void saveAndList()}>
        {saved ? "Save and list models again" : "Save and list models"}
      </FormButton>
      {listed.length > 0 && (
        <div className="space-y-1">
          <FieldLabel>Models ({models.size} chosen)</FieldLabel>
          <Checklist items={listed} checked={models} onToggle={toggle} star={star} onStar={setStar} />
        </div>
      )}
      {error && <p className="text-dense break-words text-fail-fg">{error}</p>}
      {/* macOS order: Cancel, then the default action at the far right. */}
      <div className="flex justify-end gap-2 pt-1">
        <FormButton disabled={busy} onClick={() => onDone(saved)}>Cancel</FormButton>
        <FormButton primary disabled={busy || !saved || moved || models.size === 0} onClick={() => void finish()}>Done</FormButton>
      </div>
    </div>
  );
}
