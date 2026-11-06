import { Tooltip } from "radix-ui";
import type { View } from "./model/types";
import { ViewProvider } from "./model/view";
import { Shell } from "./shell/Shell";
import { SessionNotice } from "./components/SessionNotice";

/** Providers only: the view model for everyone, tooltips that open after 500ms and then instantly. */
export function App({ view }: { view: View }) {
  return (
    <ViewProvider view={view}>
      <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
        <Shell />
        <SessionNotice />
      </Tooltip.Provider>
    </ViewProvider>
  );
}
