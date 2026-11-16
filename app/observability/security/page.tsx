import { SecurityEventsView } from "@/components/observability-security";

export const metadata = {
  title: "Security events — Agent Factory",
  description: "Refusals, screening blocks and flags, gate decisions, operator kills and lockdown changes, newest first.",
};

export default function SecurityEventsPage() {
  return <SecurityEventsView />;
}
