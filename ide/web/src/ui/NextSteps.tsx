/** What the product says to do next. Its words mark commands and paths with backticks, for an Agent's and a terminal's
 *  reading too; here they are set as code. */
export function NextSteps({ steps, className = "" }: { steps?: string[]; className?: string }) {
  if (!steps?.length) return null;
  return (
    <ul className={`grid gap-1.5 text-fg-muted ${className}`}>
      {steps.map((step) => (
        <li key={step} className="break-words">
          {step.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i} className="font-mono text-fg">{part}</code> : part))}
        </li>
      ))}
    </ul>
  );
}
