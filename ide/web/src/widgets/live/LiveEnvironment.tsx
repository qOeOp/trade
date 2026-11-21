import { Segmented } from "../../ui/Segmented";
import { ENVIRONMENT_NAMES, type LiveEnvironment } from "../../model/liveTrading";
import { liveEnvironment, useLiveEnvironment } from "../../state/liveWorkspace";

const ITEMS = (["live", "demo"] as const).map((id) => ({ id, label: ENVIRONMENT_NAMES[id] }));

/** The Demo/Live switch: which Binance environment the page works in, the real account or Binance Demo Trading. It
 *  picks whose key Settings shows and saves and where a new run trades; each environment keeps its own keys. */
export function LiveEnvironmentSwitch({ disabled = false }: { disabled?: boolean }) {
  const environment = useLiveEnvironment();
  return <fieldset disabled={disabled} className="w-32 shrink-0 disabled:opacity-60">
    <Segmented<LiveEnvironment> label="Binance environment" value={environment} items={ITEMS} onChange={(id) => liveEnvironment.set(id)} />
  </fieldset>;
}
