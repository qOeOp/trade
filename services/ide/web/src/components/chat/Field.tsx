import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { Kbd } from "../Kbd";

// The agent form's controls: a labelled text field, a segmented choice, a checklist and a bordered
// action (the form's one strong control; the panel's other actions are icon buttons).
type FieldProps = { label: string; hint?: ReactNode; value: string; onValue: (value: string) => void; suggest?: string }
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
      <span className="text-dense text-fg-muted">{label}</span>
      <span className="relative block">
        <input {...input} value={value} placeholder={placeholder ?? suggest} onKeyDown={fill} onChange={(e) => { stop(); onValue(e.target.value); }}
          className={`peer block w-full rounded-control border border-line-strong bg-island px-2 py-1 outline-none placeholder:text-fg-ghost focus:border-focus ${fillable ? "pr-11" : ""}`} />
        {fillable && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-1.5 hidden items-center peer-focus:flex"><Kbd>Tab</Kbd></span>}
      </span>
      {hint != null && <span className="block text-small text-fg-faint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-dense text-fg-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-control border border-line-strong p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
            className={`flex-1 rounded-badge px-2 py-0.5 transition-colors hover:bg-hover ${o.value === value ? "bg-pressed text-fg" : "text-fg-muted"}`}>
            {o.label}
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
        <li key={item} className="flex items-center gap-2 px-2 hover:bg-row-hover">
          <label className="flex min-w-0 flex-1 cursor-default items-center gap-2 py-0.5">
            <input type="checkbox" checked={checked.has(item)} onChange={() => onToggle(item)} className="accent-(--focus)" />
            <span className="truncate font-mono text-dense">{item}</span>
          </label>
          {checked.has(item) && (
            <button type="button" onClick={() => onStar(item)} className={`shrink-0 rounded-badge px-1 text-small hover:bg-hover ${item === star ? "text-fg" : "text-fg-faint hover:text-fg"}`}>
              {item === star ? "default" : "make default"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A bordered action; `primary` (the one that commits) has the focus colour's border. */
export function FormButton({ children, icon, primary = false, className = "", ...rest }: { children: ReactNode; icon?: Parameters<typeof Icon>[0]["name"]; primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest}
      className={`inline-flex items-center gap-1.5 rounded-control border ${primary ? "border-focus" : "border-line-strong"} px-2 py-0.5 transition-colors hover:bg-hover active:bg-pressed disabled:opacity-50 disabled:hover:bg-transparent ${className}`}>
      {icon && <Icon name={icon} />}{children}
    </button>
  );
}
