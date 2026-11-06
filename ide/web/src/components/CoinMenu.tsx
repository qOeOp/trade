import { useState, type KeyboardEvent } from "react";
import { Popover } from "radix-ui";
import { Icon } from "../icons/Icon";
import { CoinLogo } from "./CoinLogo";

export type Coin = { symbol: string; side: "LONG" | "SHORT" | null };
export type CoinGroup = { title: string; coins: readonly Coin[] };

const FIND = 6;  // a list longer than this opens with a box to find a coin by name
const LABEL = 52;  // px: from the segment's left edge to the arrow, which the menu's left edge goes back over

const baseOf = (symbol: string) => symbol.replace(/USDT$/, "");
const Side = ({ side }: { side: Coin["side"] }) => (side && <span className={`text-small font-medium tracking-[0.04em] ${side === "LONG" ? "text-pnl-up" : "text-pnl-down"}`}>{side}</span>);
const CHIP = "mr-[3px] inline-flex h-5.5 items-center gap-1.5 rounded-badge bg-selection-inactive pl-1.5 text-fg";
const Content = ({ coin }: { coin: Coin }) => <><CoinLogo coin={baseOf(coin.symbol)} />{coin.symbol}<Side side={coin.side} /></>;

/** The small capsule inside a segment when there is no other coin to pick. */
export const CoinChip = ({ coin }: { coin: Coin }) => <span className={`${CHIP} pr-[7px]`}><Content coin={coin} /></span>;

/** Picks a coin from `groups`, opened by the small capsule holding `coin`, or with none picked yet by an
 *  arrow, open from the start (`onClose` when it closes). Past FIND coins a box finds one by name, Enter
 *  picks the first match, and ↑ ↓ move between rows. */
export function CoinMenu({ groups, coin, onPick, onClose }: { groups: readonly CoinGroup[]; coin: Coin | null; onPick: (symbol: string) => void; onClose?: () => void }) {
  const [open, setOpen] = useState(coin === null), [query, setQuery] = useState("");
  const set = (next: boolean) => { setOpen(next); setQuery(""); if (!next) onClose?.(); };
  const pick = (symbol: string) => { set(false); onPick(symbol); };
  const total = groups.reduce((n, g) => n + g.coins.length, 0), wanted = query.trim().toUpperCase();
  const shown = groups.map((g) => ({ ...g, coins: g.coins.filter((c) => c.symbol.includes(wanted)) })).filter((g) => g.coins.length);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-coin]")], at = rows.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    rows[e.key === "ArrowDown" ? Math.min(at + 1, rows.length - 1) : at === -1 ? 0 : Math.max(at - 1, 0)]?.focus();
  };
  return (
    <Popover.Root open={open} onOpenChange={set}>
      <Popover.Trigger aria-label="Pick a coin" className={coin ? `${CHIP} pr-1 hover:ring-1 hover:ring-inset hover:ring-line-strong data-[state=open]:ring-1 data-[state=open]:ring-inset data-[state=open]:ring-line-strong` : "-ml-1 grid h-7 place-items-center pr-1.5"}>
        {coin && <Content coin={coin} />}<span className="shrink-0 text-icon"><Icon name="chevron-down" size={12} /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={coin ? 9 : 6} alignOffset={coin ? 0 : -LABEL} collisionPadding={8} onKeyDown={move}
          className="z-50 flex max-h-[357px] w-60 flex-col rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup outline-none">
          {total > FIND && (
            <input autoFocus aria-label="Find a coin" placeholder={`Search ${total} coins`} value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => { const first = shown[0]?.coins[0]; if (e.key === "Enter" && first) pick(first.symbol); }}
                   className="mb-1 block h-6 w-full shrink-0 rounded-control border border-line-strong bg-transparent px-[7px] text-fg outline-none placeholder:text-fg-faint focus:border-focus" />
          )}
          <div className="min-h-0 overflow-auto">
            {shown.map((g) => (
              <div key={g.title}>
                {groups.length > 1 && <p className="mx-2 mb-0.5 mt-1.5 text-small text-fg-faint">{g.title}</p>}
                {g.coins.map((c) => (
                  <button key={c.symbol} type="button" data-coin onClick={() => pick(c.symbol)}
                          className={`flex h-6 w-full items-center gap-2 rounded-control px-2 text-left outline-none hover:bg-selection focus:bg-selection ${c.symbol === coin?.symbol ? "bg-selection-inactive" : ""}`}>
                    <CoinLogo coin={baseOf(c.symbol)} /><span className="flex min-w-0 flex-1 items-baseline justify-between gap-2"><span>{c.symbol}</span><Side side={c.side} /></span>
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && <p className="mx-2 my-1 text-small text-fg-faint">No match</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
