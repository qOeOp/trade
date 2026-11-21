import type { ReactNode } from "react";

/** A link that opens outside the IDE, underlined in the text colour and marked ↗. */
export const External = ({ href, children }: { href: string; children: ReactNode }) =>
  <a className="text-fg underline decoration-line-strong underline-offset-3 hover:decoration-current" href={href} target="_blank" rel="noreferrer">{children} ↗</a>;
