import { DashboardRouteContent } from "@/components/dashboard-route-content";

export const dynamic = "force-dynamic";

export default async function OperationRunDetailPage({
  params,
}: {
  params: Promise<{ runIdentity: string }>;
}) {
  const { runIdentity } = await params;
  return <DashboardRouteContent current="/operations/runs/example" runIdentity={runIdentity} />;
}
