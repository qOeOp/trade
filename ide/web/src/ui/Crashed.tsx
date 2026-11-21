import { Component, type ErrorInfo, type ReactNode } from "react";
import { TextButton } from "./TextButton";

type State = { error: Error | null; stack: string; reset: unknown };

/** The page's last resort: a render that throws anywhere below shows what threw, where, and a way to load the
 *  page again, instead of React unmounting everything and leaving the bare background. A new `reset` (the next
 *  view the ledger sends) draws the page again, since the data that threw may be gone. */
export class Crashed extends Component<{ reset: unknown; children: ReactNode }, State> {
  state: State = { error: null, stack: "", reset: this.props.reset };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: { reset: unknown }, state: State): Partial<State> | null {
    return Object.is(props.reset, state.reset) ? null : { error: null, stack: "", reset: props.reset };
  }

  componentDidCatch(_error: unknown, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? "" });
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="grid h-full place-items-center overflow-y-auto p-6">
        <div className="grid max-w-3xl gap-3 text-value">
          <p className="text-fg">The page stopped drawing: {error.name}: {error.message}</p>
          <p className="text-fg-muted">It draws again when the ledger sends a new view. <TextButton onClick={() => window.location.reload()}>Reload the page</TextButton></p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-small text-fg-faint">{`${error.stack ?? ""}\n${stack}`.trim()}</pre>
        </div>
      </div>
    );
  }
}
