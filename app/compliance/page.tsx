import { ComplianceView } from "@/components/compliance";

export const metadata = {
  title: "Compliance — Agent Factory",
  description: "The control catalogue against the standards it answers to and against the ABB ICL, with firings by control family.",
};

export default function CompliancePage() {
  return <ComplianceView />;
}
