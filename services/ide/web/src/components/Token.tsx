import { useState } from "react";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import { Tip } from "./Tip";

/** A long identifier (hash, path, registration) as a chip cut in the middle, its ends kept: the whole
 *  text on hover, copied on click. */
export function Token({ value, head = 12, tail = 8 }: { value: string; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  const copy = async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1200); } };
  return (
    <Tip content={copied ? "Copied" : <span className="font-mono break-all">{value}</span>}>
      <button type="button" onClick={() => void copy()}
              className="inline-flex max-w-full items-center gap-1 rounded-badge border border-line px-1.5 font-mono text-small text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-pressed">
        <span className="truncate">{short}</span><Icon name="copy" size={12} />
      </button>
    </Tip>
  );
}
