import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardChrome } from "@/components/dashboard-chrome";
import { LOCAL_OPERATOR_SESSION_COOKIE, readLocalOperatorSessionV1 } from "@/lib/local-operator-session";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const session = readLocalOperatorSessionV1(cookieStore.get(LOCAL_OPERATOR_SESSION_COOKIE)?.value);
  if (!session.authenticated) redirect(`/login?state=${session.state}`);
  return <DashboardChrome>{children}</DashboardChrome>;
}
