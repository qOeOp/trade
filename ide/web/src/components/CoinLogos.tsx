import { useState } from "react";

// Binance's own coin logos, by base asset, from the static assets its site loads (no API; an asset
// listed only as futures may have none). Sent with no referrer: the host refuses another site's.
const logo = (base: string) => `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(base)}.png`;
const SIZE = 14, STEP = 10, MOST = 3;

/** How wide `n` logos are side by side, overlapping. */
export const logosWidth = (n: number) => (n ? SIZE + STEP * (Math.min(n, MOST) - 1) : 0);

/** The coins' logos (base assets), overlapping when there are several (at most three); each shows once
 *  its image loads and one that fails drops out, so offline there are none. */
export function CoinLogos({ coins }: { coins: readonly string[] }) {
  const [failed, setFailed] = useState<string[]>([]), [loaded, setLoaded] = useState<string[]>([]);
  const shown = coins.map(logo).filter((s) => !failed.includes(s)).slice(0, MOST);
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0">
      {shown.map((s, i) => (
        <img key={s} src={s} alt="" width={SIZE} height={SIZE} referrerPolicy="no-referrer" onLoad={() => setLoaded((l) => [...l, s])}
             onError={() => setFailed((f) => [...f, s])} className={`size-3.5 rounded-full ${i ? "-ml-1" : ""} ${loaded.includes(s) ? "" : "hidden"}`} />
      ))}
    </span>
  );
}
