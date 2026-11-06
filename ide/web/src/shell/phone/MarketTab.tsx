import { useState } from "react";
import { PhoneBar, PhonePage } from "../../components/PhoneBar";
import { Sheet } from "../../components/Sheet";
import { Tabs } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { marketCoin } from "../../state/market";
import { CoinsWindow } from "../../widgets/market/CoinsWindow";
import { MarketDetails } from "../../widgets/market/MarketDetails";
import { MarketPage } from "../../widgets/market/MarketPage";
import { NewsTools, NewsWindow } from "../../widgets/market/NewsWindow";

type Below = "overview" | "coins" | "news";
const BELOW = [{ id: "overview", label: "Overview" }, { id: "coins", label: "Coins" }, { id: "news", label: "News" }] as const;

/** The Market tab: the Market page's heatmap, a level at a time, a tile opening its level or its coin as on the
 *  desktop; under it what the desktop's Details, Coins and News windows show of that level. A coin's details rise
 *  in a sheet. */
export function MarketTab() {
  const coin = useAtom(marketCoin), [below, setBelow] = useState<Below>("overview");
  return (
    <>
      <PhoneBar><h1 className="px-2 text-dense font-semibold">Market</h1></PhoneBar>
      <PhonePage>
        <div className="h-[62dvh] min-h-96"><MarketPage /></div>
        <div className="flex h-(--header-h) items-center gap-3 border-t border-line px-1 text-dense">
          <Tabs label="Market details" value={below} onChange={setBelow} items={BELOW} />
        </div>
        {below === "news" && <div className="flex items-center gap-2 px-3 pb-1 text-dense [&>h2]:hidden"><NewsTools /></div>}
        {below === "overview" ? <MarketDetails /> : below === "coins" ? <div data-page-table className="overflow-x-auto"><CoinsWindow /></div> : <div data-page-table><NewsWindow /></div>}
      </PhonePage>
      <Sheet open={coin !== null} onClose={() => marketCoin.set(null)} title={coin ?? "Coin"}>
        <MarketDetails level={false} />
      </Sheet>
    </>
  );
}
