import { EvidenceView } from "@/components/evidence";

export const metadata = {
  title: "Evidence — Agent Factory",
  description: "An assessor's evidence pack for a control or a framework over a period: firings, signed decisions, the policy in force, the identities that acted and the chain verification of every run cited.",
};

export default function EvidencePage() {
  return <EvidenceView />;
}
