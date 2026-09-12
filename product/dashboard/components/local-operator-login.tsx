"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRoundIcon } from "lucide-react";

import { FloatingPaths } from "@/components/shared/floating-paths";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { StatusBadge } from "@/components/ui/status-badge";

type SessionState = {
  state: "authenticated" | "required" | "invalid" | "expired" | "configuration_unavailable";
  authenticated: boolean;
  unavailable_reason: string | null;
};

function safeReturnTo(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login")
    ? value
    : "/operations";
}

const copyByState = {
  authenticated: "Session ready",
  required: "Sign in required",
  invalid: "Credential or session rejected",
  expired: "Session expired",
  configuration_unavailable: "Local access unavailable",
} as const;

function admittedInitialState(value: string | undefined): keyof typeof copyByState {
  return value && Object.hasOwn(copyByState, value) ? value as keyof typeof copyByState : "required";
}

export function LocalOperatorLogin({
  returnTo,
  initialState,
}: {
  returnTo?: string;
  initialState?: string;
}) {
  const router = useRouter();
  const [credential, setCredential] = useState("");
  const [session, setSession] = useState<SessionState | null>(null);
  const [pending, setPending] = useState(false);
  const destination = safeReturnTo(returnTo);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => ({ response, value: await response.json() as SessionState }))
      .then(({ value }) => { if (active) setSession(value); })
      .catch(() => { if (active) setSession({ state: "configuration_unavailable", authenticated: false, unavailable_reason: "SESSION_READ_UNAVAILABLE" }); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const value = await response.json() as SessionState;
      setSession(value);
      if (response.ok && value.authenticated) {
        setCredential("");
        router.replace(destination);
        router.refresh();
      }
    } catch {
      setSession({ state: "configuration_unavailable", authenticated: false, unavailable_reason: "SESSION_WRITE_UNAVAILABLE" });
    } finally {
      setPending(false);
    }
  }

  const visualState = session?.state ?? admittedInitialState(initialState);
  const unavailable = visualState === "configuration_unavailable";

  return (
    <main className="local-login-shell">
      <section className="local-login-art" aria-label="Vibe Trading">
        <Logo className="local-login-logo" />
        <div aria-hidden="true" className="local-login-paths"><FloatingPaths position={1} /><FloatingPaths position={-1} /></div>
        <blockquote><p>&ldquo;Work Smarter, Trade Faster.&rdquo;</p><footer>~ Vincent Xu</footer></blockquote>
      </section>
      <section className="local-login-form-region">
        <div className="local-login-form-card">
          <Logo className="local-login-mobile-logo" />
          <div className="local-login-heading">
            <div><span>LOCAL OPERATOR</span><h1>Dashboard access</h1></div>
            <StatusBadge tone={unavailable ? "unavailable" : visualState === "expired" ? "warning" : session?.authenticated ? "success" : "neutral"}>
              {copyByState[visualState]}
            </StatusBadge>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="local-operator-credential">Local credential</label>
            <InputGroup>
              <InputGroupInput
                autoComplete="current-password"
                disabled={pending || unavailable}
                id="local-operator-credential"
                onChange={(event) => setCredential(event.target.value)}
                placeholder="Enter local operator credential"
                required
                type="password"
                value={credential}
              />
              <InputGroupAddon><KeyRoundIcon aria-hidden="true" /></InputGroupAddon>
            </InputGroup>
            {session && !session.authenticated ? <p className="local-login-state" role="status">{copyByState[session.state]}</p> : null}
            <Button disabled={pending || unavailable || credential.length === 0} size="sm" type="submit">
              {pending ? "Verifying…" : session?.authenticated ? "Re-authenticate" : "Continue"}
            </Button>
          </form>
          {session?.authenticated ? <Button onClick={() => { router.replace(destination); router.refresh(); }} size="sm" variant="outline">Open Dashboard</Button> : null}
        </div>
      </section>
    </main>
  );
}
