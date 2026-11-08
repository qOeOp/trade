import { Tooltip } from "radix-ui";
import { FirstRun } from "./components/FirstRun";
import type { View } from "./model/types";
import { NO_VIEW, ViewProvider } from "./model/view";
import { useAtom } from "./state/atom";
import { firstRun } from "./state/firstRun";
import { usePhone } from "./state/phone";
import { PhoneShell } from "./shell/phone/PhoneShell";
import { Shell } from "./shell/Shell";
import { PaperRefusal } from "./components/PaperRefusal";
import { SessionNotice } from "./components/SessionNotice";
import { LiveDialogs } from "./widgets/live/LiveDialogs";

/** Providers only, and which shell: the view model for everyone (null until there is one, when each shell says why
 *  and Runs, Market and Agent still work), tooltips that open after 500ms and then instantly; over either shell,
 *  an expired session and a refused paper action. */
export function App({ view }: { view: View | null }) {
  const phone = usePhone();
  const first = useAtom(firstRun);
  if (first) return <FirstRun setup={first.setup} onReady={first.onReady} onOpen={() => firstRun.set(null)} />;
  return (
    <ViewProvider view={view ?? NO_VIEW}>
      <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
        {phone ? <PhoneShell /> : <Shell />}
        <LiveDialogs />
        <div className="fixed left-1/2 top-12 z-50 flex w-max max-w-[min(32rem,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2 empty:hidden">
          <SessionNotice />
          <PaperRefusal />
        </div>
      </Tooltip.Provider>
    </ViewProvider>
  );
}
