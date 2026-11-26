import { Applications } from "@/components/applications";

export const metadata = {
  title: "Applications — Saros",
  description: "The register of chatbots, RAG apps, agents and multi-agent systems governed by this control plane, with their policy, identity, activity and the controls that fired.",
};

export default function ApplicationsPage() {
  return <Applications />;
}
