import { AuthPage } from "../../features/auth/components/auth-page";
import { DashboardShell } from "../../components/dashboard-shell";
import { allRoutes, foundationRoutes } from "../../lib/navigation.js";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { route: [] },
    ...foundationRoutes.map((href) => ({ route: href.slice(1).split("/") })),
    ...allRoutes.map(({ href }) => ({ route: href.slice(1).split("/") })),
  ];
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ route?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { route } = await params;
  const query = await searchParams;
  const current = route?.length ? `/${route.join("/")}` : "/login";
  if (current === "/login") return <div className="min-h-screen bg-mine-page-bg"><AuthPage /></div>;
  if (current === "/market") return <DashboardShell current="/dashboard" />;
  const sourceIntakeRequestIdentity = typeof query.sourceRequestIdentity === "string"
    ? query.sourceRequestIdentity
    : undefined;
  return <DashboardShell current={current} sourceIntakeRequestIdentity={sourceIntakeRequestIdentity} />;
}
