import { ApprovalsView } from "@/components/approvals-page";

export const metadata = {
  title: "Approvals — Saros",
  description: "The gates waiting for a person, most urgent first, and the gates answered recently with who answered and how.",
};

export default function ApprovalsPage() {
  return <ApprovalsView />;
}
