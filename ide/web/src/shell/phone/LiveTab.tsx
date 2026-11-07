import { PhoneBar, PhonePage } from "../../components/PhoneBar";
import { LivePage } from "../../widgets/live/LivePage";

/** Keep the same content and actions, with the phone shell's safe-area header. */
export function LiveTab() {
  return <>
    <PhoneBar><span className="px-2 text-dense font-semibold">Live execution</span></PhoneBar>
    <PhonePage><LivePage /></PhonePage>
  </>;
}
