import { AttestationsView } from "@/components/attestations";

export const metadata = {
  title: "Attestations — Agent Factory",
  description: "Owners attesting that each deployed agent still does what was approved: every agent's standing, the overdue list, and what changed in the spec since the last attestation.",
};

export default function AttestationsPage() {
  return <AttestationsView />;
}
