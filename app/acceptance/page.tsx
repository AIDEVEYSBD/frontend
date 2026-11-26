import { AcceptanceView } from "@/components/acceptance";

export const metadata = {
  title: "Acceptance — Saros",
  description: "The acceptance record of each use case: criteria and results, outstanding issues and sign-offs by role.",
};

export default function AcceptancePage() {
  return <AcceptanceView />;
}
