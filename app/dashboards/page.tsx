import { DashboardsView } from "@/components/dashboards";

export const metadata = {
  title: "Dashboards — Saros",
  description: "Three fixed boards over one window: security posture, cost and workload results, each counted from the records behind the page it links to.",
};

export default function DashboardsPage() {
  return <DashboardsView />;
}
