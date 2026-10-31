import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { Kbd } from "../Kbd";

// The agent form's controls: a labelled text field, a segmented choice, a checklist and a button.
// Fields, the segmented choice and buttons share one height, 28px, IntelliJ's control height.
/** A control's label above it: its own line, 6px clear of the control (the label's bottom margin
 *  collapses with the control's 4px top margin), while a hint under the control stays 4px close. */
export const FieldLabel = ({ children }: { children: ReactNode }) => <span className="mb-1.5 block text-dense text-fg-muted">{children}</span>;

type FieldProps ={ label: string; hint?: ReactNode; value: string; onValue: (value: string) => void; suggest?: string }
  & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

/**
 * A labelled text field. A `suggest`ion shows as the placeholder; Tab, while the field is empty or
 * holds the suggestion's start, types the rest in (0.4 s at most, at once under reduced motion)
 * instead of moving on, and Tab again moves on.
 */
export function TextField({ label, hint, value, onValue, suggest, placeholder, ...input }: FieldProps) {
  const typing = useRef<number | null>(null);
  const stop = () => { if (typing.current != null) clearInterval(typing.current); typing.current = null; };
  useEffect(() => stop, []);
  const fillable = suggest != null && value !== suggest && suggest.startsWith(value);
  const fill = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab" || e.shiftKey || !fillable) return;
    e.preventDefault(); stop();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { onValue(suggest); return; }
    const step = Math.max(1, Math.ceil((suggest.length - value.length) / 14));
    let at = value.length;
    typing.current = window.setInterval(() => {
      at = Math.min(suggest.length, at + step);
      onValue(suggest.slice(0, at));
      if (at === suggest.length) stop();
    }, 28);
  };
  return (
    <label className="block space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <span className="relative block">
        <input {...input} value={value} placeholder={placeholder ?? suggest} onKeyDown={fill} onChange={(e) => { stop(); onValue(e.target.value); }}
          className={`peer block h-7 w-full rounded-control border border-line-strong bg-island px-2 outline-none placeholder:text-fg-ghost focus:border-focus focus:ring-1 focus:ring-focus ${fillable ? "pr-11" : ""}`} />
        {fillable && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-1.5 hidden items-center peer-focus:flex"><Kbd>Tab</Kbd></span>}
      </span>
      {hint != null && <span className="block text-small text-fg-faint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string; mark?: ReactNode }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      {/* Options as wide as their content and spread out, so the first and last sit the same distance
          from the edges whatever their labels' lengths. */}
      <div role="radiogroup" aria-label={label} className="flex h-7 justify-between gap-0.5 rounded-control border border-line-strong p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
            className={`inline-flex min-w-0 items-center gap-1.5 rounded-badge px-2 transition-colors hover:bg-hover ${o.value === value ? "bg-pressed text-fg" : "text-fg-muted"}`}>
            {o.mark}<span className="truncate">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Checklist({ items, checked, onToggle, star, onStar }: {
  items: readonly string[]; checked: ReadonlySet<string>; onToggle: (item: string) => void; star: string | null; onStar: (item: string) => void;
}) {
  return (
    <ul className="max-h-56 overflow-auto rounded-control border border-line-strong py-0.5">
      {items.map((item) => (
        <li key={item} className="group flex h-(--row-h) items-center gap-2 px-2 hover:bg-row-hover">
          <label className="flex min-w-0 flex-1 cursor-default items-center gap-2">
            <input type="checkbox" checked={checked.has(item)} onChange={() => onToggle(item)} className="accent-(--focus)" />
            <span className="truncate font-mono text-dense">{item}</span>
          </label>
          {/* The default is a label; another chosen model offers "make default" on hover or keyboard focus. */}
          {item === star ? <span className="shrink-0 text-small text-fg-muted">default</span> : checked.has(item) && (
            <button type="button" onClick={() => onStar(item)}
              className="shrink-0 rounded-badge px-1 text-small text-fg-faint opacity-0 transition-colors group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100">
              make default
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A 28px button: `primary` (the one that commits) is filled blue, pale while it cannot be pressed;
 *  the others are outlined. */
export function FormButton({ children, icon, primary = false, className = "", ...rest }: { children: ReactNode; icon?: Parameters<typeof Icon>[0]["name"]; primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const look = primary
    ? "border-transparent bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-pressed disabled:bg-primary-disabled disabled:text-primary-disabled-fg"
    : "border-line-strong hover:bg-hover active:bg-pressed disabled:text-fg-ghost disabled:hover:bg-transparent disabled:active:bg-transparent";
  return (
    <button type="button" {...rest}
      className={`inline-flex h-7 min-w-18 shrink-0 items-center justify-center gap-1.5 rounded-control border px-3 transition-colors disabled:cursor-default ${look} ${className}`}>
      {icon && <Icon name={icon} />}{children}
    </button>
  );
}
