"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "./ui/button";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterSummary,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";

type SessionState = {
  schema_version: 1;
  state: "authenticated" | "required" | "invalid" | "expired" | "configuration_unavailable";
  authenticated: boolean;
  unavailable_reason: string | null;
  principal_ref: string | null;
  session_identity: string | null;
  issued_at: string | null;
  expires_at: string | null;
};

function formatUtc(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { timeZone: "UTC", timeZoneName: "short" }) : "unavailable";
}

export function LocalOperatorAccess() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(null);
  const [pending, setPending] = useState(true);

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      setSession(await response.json() as SessionState);
    } catch {
      setSession({
        schema_version: 1,
        state: "configuration_unavailable",
        authenticated: false,
        unavailable_reason: "SESSION_READ_UNAVAILABLE",
        principal_ref: null,
        session_identity: null,
        issued_at: null,
        expires_at: null,
      });
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <PanelFrame className="local-access-frame">
      <PanelFrameHeader
        eyebrow="LOCAL OPERATOR"
        title="Access"
        actions={<>
          <PanelFrameInfo label="View access boundary">
            <PanelFrameInfoList>
              <PanelFrameInfoFact label="Session identity"><code>{session?.session_identity ?? "unavailable"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Browser proof">Local session cookie</PanelFrameInfoFact>
              <PanelFrameInfoFact label="Effect proof">Independent bearer capability</PanelFrameInfoFact>
              <PanelFrameInfoFact label="Writes">Not admitted</PanelFrameInfoFact>
            </PanelFrameInfoList>
          </PanelFrameInfo>
          <Button disabled={pending} onClick={() => void refresh()} size="xs" variant="outline">
            <InterfaceIcons.refresh aria-hidden="true" /> Refresh
          </Button>
        </>}
      />
      <PanelFrameBody density="compact">
        {pending && !session ? <FactGroupSkeletonGrid aria-label="Reading local session" titles={["Session", "Credentials", "Authority"]} /> : (
          <FactGroupGrid>
            <FactGroup title="Session">
              <FactItem label="Principal">{session?.principal_ref ?? "unavailable"}</FactItem>
              <FactItem label="State"><StatusBadge tone={session?.authenticated ? "success" : session?.state === "expired" ? "warning" : "unavailable"}>{session?.state ?? "unavailable"}</StatusBadge></FactItem>
              <FactItem label="Re-authenticated">{formatUtc(session?.issued_at ?? null)}</FactItem>
              <FactItem label="Expires">{formatUtc(session?.expires_at ?? null)}</FactItem>
            </FactGroup>
            <FactGroup title="Credentials">
              <FactItem label="Browser session"><StatusBadge tone={session?.authenticated ? "success" : "unavailable"}>{session?.authenticated ? "available" : "unavailable"}</StatusBadge></FactItem>
              <FactItem label="Transport token"><StatusBadge tone="unavailable">not admitted</StatusBadge></FactItem>
              <FactItem label="Effect bearer"><StatusBadge tone="protected">separate</StatusBadge></FactItem>
              <FactItem label="Secret values">withheld</FactItem>
            </FactGroup>
            <FactGroup title="Authority">
              <FactItem label="Operator Authorization"><StatusBadge tone="unavailable">unavailable</StatusBadge></FactItem>
              <FactItem label="Product Edge"><StatusBadge tone="unavailable">unavailable</StatusBadge></FactItem>
              <FactItem label="Successor"><StatusBadge tone="unavailable">unavailable</StatusBadge></FactItem>
              <FactItem label="Mutation">not admitted</FactItem>
            </FactGroup>
          </FactGroupGrid>
        )}
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary={session?.authenticated ? "Local session authenticated" : "Local session unavailable"}
          secondary={session?.unavailable_reason ?? "No authority or token value is exposed."}
        />
        <PanelFrameFooterActions>
          <Button asChild size="xs" variant="outline"><Link href="/login?return_to=/settings/access">Re-authenticate</Link></Button>
          <Button disabled={!session?.authenticated} onClick={() => void signOut()} size="xs" variant="ghost">Sign out</Button>
        </PanelFrameFooterActions>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
