import type { Metadata } from "next";

import { KpiDisplayDemo } from "../../components/kpi-display-demo";

export const metadata: Metadata = { title: "KPI Display · Trade Dashboard" };

export default function KpiDemoPage() {
  return <KpiDisplayDemo />;
}
