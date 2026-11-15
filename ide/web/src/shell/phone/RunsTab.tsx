import { PhonePage } from "../../components/PhoneBar";
import { PhoneHeading, PhoneNotice } from "../../components/PhoneParts";
import { useNow } from "../../components/hooks/useNow";
import { ACTIVE } from "../../model/chain";
import { liveStatus } from "../../model/phoneRuns";
import type { LiveRun } from "../../model/liveTrading";
import { useLiveTrading } from "../../state/liveTrading";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { usePhoneRun } from "../../state/phone";
import { useTimeZone } from "../../state/timeZone";
import { nsMilliseconds } from "../../lib/time";
import { clock, LiveCard, PaperCard, UnresolvedNotice } from "./RunCards";
import { LivePage } from "./LivePage";
import { PaperPage } from "./PaperPage";
import { PhoneTop } from "./PhoneTop";

const count = (n: number, what: string) => `${n} ${what}`;

/** The Live runs a phone shows: those not ended, else the last one. */
function shownLive(runs: readonly LiveRun[]): LiveRun[] {
  const open = runs.filter((r) => !r.ended);
  return open.length ? open : runs.slice(-1);
}

/** What needs a look before anything else: a Live run left unresolved (what it left open and where to deal with it),
 *  Telegram failing, a service not answering. */
function Notices() {
  const { view } = useLiveTrading(), paper = usePaperService(), zone = useTimeZone();
  const unresolved = view.runs.filter((r) => liveStatus(r).word === "Unresolved");
  const failed = view.notify?.lastError, at = nsMilliseconds(failed?.atNs);
  return (
    <div className="space-y-2 px-3 pt-3 empty:hidden">
      {unresolved.map((r) => <UnresolvedNotice key={r.id} run={r} />)}
      {failed && <PhoneNotice tone="misses">Telegram failed{at !== null ? ` at ${clock(at, zone)}` : ""} ({failed.code}). Alerts are not reaching you.</PhoneNotice>}
      {view.availability === "unavailable" && view.runs.length > 0 && <PhoneNotice tone="misses">Live is not answering. These are its last facts.</PhoneNotice>}
      {paper === "offline" && <PhoneNotice tone="misses">Paper is not answering. These are its last facts.</PhoneNotice>}
    </div>
  );
}

/** The Runs tab, the phone's front page: every Live run and paper run still going as a card, each opening its page. */
function Home() {
  const { view } = useLiveTrading(), listing = usePaperRuns(), service = usePaperService(), now = useNow(5000);
  const live = shownLive(view.runs), runs = listing?.runs ?? [];
  const going = runs.filter((r) => ACTIVE.has(r.state)), sealed = runs.length - going.length;
  const running = view.runs.filter((r) => r.running).length;
  return (
    <>
      <PhoneTop title="Runs" />
      <PhonePage>
        <Notices />
        <PhoneHeading title="Live" aside={view.availability === "unavailable" && !view.runs.length ? "Not connected" : count(running, "running")} />
        <div className="space-y-2 px-3">
          {live.map((r) => <LiveCard key={r.id} run={r} now={now} />)}
          {!live.length && <p className="text-dense text-fg-faint">No Live run. A run starts from the desktop.</p>}
        </div>
        <PhoneHeading title="Paper" aside={service === "absent" ? "Not served" : `${count(going.length, "running")} · ${count(sealed, "sealed")}`} />
        <div className="space-y-2 px-3 pb-4">
          {going.map((r) => <PaperCard key={r.paper_id} run={r} now={now} />)}
          {!going.length && service !== "absent" && <p className="text-dense text-fg-faint">No paper run. A run starts from the desktop.</p>}
        </div>
      </PhonePage>
    </>
  );
}

/** The Runs tab: its cards, or the page of the run one opened. */
export function RunsTab() {
  const run = usePhoneRun();
  if (run?.kind === "live") return <LivePage id={run.id} />;
  if (run?.kind === "paper") return <PaperPage id={run.id} />;
  return <Home />;
}
